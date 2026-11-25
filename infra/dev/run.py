"""Fetch runtime secrets without logging payloads, then start the prebuilt stack."""
import base64
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request


def metadata(path):
    request = urllib.request.Request("http://metadata.google.internal/computeMetadata/v1/" + path,
                                    headers={"Metadata-Flavor": "Google"})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def docker_output(*args):
    return subprocess.run(["docker", *args], check=True, capture_output=True, text=True).stdout.splitlines()


def container_images(containers):
    return docker_output("container", "inspect", "--format", "{{.Image}}", *containers) if containers else []


def service_image(service):
    containers = docker_output("ps", "-aq", "--filter", "label=com.docker.compose.project=gemihub-dev",
                               "--filter", f"label=com.docker.compose.service={service}",
                               "--filter", "label=com.docker.compose.oneoff=False")
    images = container_images(containers)
    if len(images) > 1:
        raise RuntimeError(f"Expected one Agent {service} container")
    return images[0] if images else None


def prune_agent_images(repository, keep):
    used = set(container_images(docker_output("ps", "-aq")))
    rows = [line.split() for line in docker_output("image", "ls", "--no-trunc", "--format",
                                                   "{{.Repository}} {{.Tag}} {{.ID}}")]
    for repo, tag, image in rows:
        if repo != repository or image in keep or image in used:
            continue
        if tag == "<none>" and any(other_repo != repository and other_id == image
                                   for other_repo, _, other_id in rows):
            continue
        reference = image if tag == "<none>" else f"{repo}:{tag}"
        subprocess.run(["docker", "image", "rm", "--no-prune", reference], check=False)


def save_deployed_images(path, current, previous):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"current": current, "previous": previous}) + "\n")
    temporary.replace(path)


def check_services(image):
    for service in ("app", "challenge-demo"):
        if service_image(service) != image:
            raise RuntimeError(f"Agent {service} did not start with the deployed image")
    checks = [
        ("dev.gemihub.net", "/"),
        ("admin.dev.gemihub.net", "/api/session"),
        ("shop.dev.gemihub.net", "/api/session"),
        ("shop.dev.gemihub.net", "/s/komado/"),
    ]
    for attempt in range(30):
        for host, path in checks:
            result = subprocess.run(["curl", "--silent", "--max-time", "3", "--output", "/dev/null",
                                     "--write-out", "%{http_code}", "--resolve", f"{host}:443:127.0.0.1",
                                     f"https://{host}{path}"], capture_output=True, text=True)
            if result.returncode or result.stdout != "200":
                break
        else:
            return
        if attempt < 29:
            time.sleep(2)
    raise RuntimeError(f"Agent HTTPS health check failed for {host}{path}")


def main():
    config = metadata("instance/attributes/gemihub-dev-config")
    token = metadata("instance/service-accounts/default/token")["access_token"]

    def secret(name):
        url = f"https://secretmanager.googleapis.com/v1/projects/{config['project']}/secrets/{name}/versions/latest:access"
        request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
        with urllib.request.urlopen(request, timeout=30) as response:
            return base64.b64decode(json.load(response)["payload"]["data"]).decode()

    env = json.loads(secret("gemihub-dev-runtime"))
    env.update({key: secret(name).strip() for key, name in config["secrets"].items()})
    for key in ["SESSION_SECRET", "PARENT_AUTH_SECRET", "PARENT_INTEGRATION_SECRET"]:
        if len(env.get(key, "")) < 32:
            raise ValueError(f"{key} must contain at least 32 characters")
    if not env.get("PARENT_ADMIN_EMAILS"):
        raise ValueError("PARENT_ADMIN_EMAILS must contain the operator email")
    lines = []
    for key, value in env.items():
        # Values are plain tokens/addresses. Reject characters interpreted by Compose dotenv.
        if not key.replace("_", "").isalnum() or not isinstance(value, str) or any(c in value for c in "\r\n\x00$'\"\\"):
            raise ValueError("Runtime configuration contains unsupported characters")
        lines.append(f"{key}={value}")
    path = Path("/etc/gemihub-dev/secrets.env")
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    path.write_text("\n".join(lines) + "\n")
    subprocess.run(["docker", "login", "asia-northeast1-docker.pkg.dev", "--username", "oauth2accesstoken", "--password-stdin"],
                   input=token, text=True, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    runtime = {**os.environ, "APP_IMAGE": config["image"], "PROJECT_ID": config["project"], "VERTEX_MODEL": config["model"]}
    compose = ["docker-compose", "-p", "gemihub-dev", "-f", "/opt/gemihub-dev/compose.yaml"]
    repository = f"asia-northeast1-docker.pkg.dev/{config['project']}/gemihub-dev/app"
    image_reference = config["image"]
    agent_image = image_reference.startswith((repository + ":", repository + "@"))
    if agent_image:
        history = Path("/var/lib/gemihub-dev/deployed-images.json")
        try:
            deployed = json.loads(history.read_text())
        except FileNotFoundError:
            deployed = {"current": service_image("app"), "previous": None}
            save_deployed_images(history, **deployed)
    subprocess.run(compose + ["pull"], env=runtime, check=True)
    subprocess.run(compose + ["run", "--rm", "--no-deps", "caddy", "caddy", "validate", "--config", "/etc/caddy/Caddyfile"], env=runtime, check=True)
    subprocess.run(compose + ["stop", "app"], env=runtime, check=True)
    subprocess.run(compose + ["run", "--rm", "--no-deps", "app", "node", "infra/dev/init-parent.mjs"], env=runtime, check=True)
    subprocess.run(compose + ["up", "-d", "--remove-orphans"], env=runtime, check=True)
    # The Caddy container often survives an update; changing the mounted file alone does not reload it.
    subprocess.run(compose + ["exec", "-T", "caddy", "caddy", "reload", "--config", "/etc/caddy/Caddyfile"], env=runtime, check=True)
    if agent_image:
        image, = docker_output("image", "inspect", "--format", "{{.Id}}", image_reference)
        check_services(image)
        previous = deployed["previous"] if deployed["current"] == image else deployed["current"]
        save_deployed_images(history, image, previous)
        if previous:
            try:
                prune_agent_images(repository, {image, previous})
            except subprocess.CalledProcessError:
                print("Agent image cleanup skipped because the Docker inventory could not be read.")


if __name__ == "__main__":
    main()
