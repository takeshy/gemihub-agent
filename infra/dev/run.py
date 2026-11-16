"""Fetch runtime secrets without logging payloads, then start the prebuilt stack."""
import base64
import json
import os
from pathlib import Path
import subprocess
import urllib.request


def metadata(path):
    request = urllib.request.Request("http://metadata.google.internal/computeMetadata/v1/" + path,
                                    headers={"Metadata-Flavor": "Google"})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


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
    subprocess.run(compose + ["pull"], env=runtime, check=True)
    subprocess.run(compose + ["run", "--rm", "--no-deps", "caddy", "caddy", "validate", "--config", "/etc/caddy/Caddyfile"], env=runtime, check=True)
    subprocess.run(compose + ["stop", "app"], env=runtime, check=True)
    subprocess.run(compose + ["run", "--rm", "--no-deps", "app", "node", "infra/dev/init-parent.mjs"], env=runtime, check=True)
    subprocess.run(compose + ["up", "-d", "--remove-orphans"], env=runtime, check=True)
    # The Caddy container often survives an update; changing the mounted file alone does not reload it.
    subprocess.run(compose + ["exec", "-T", "caddy", "caddy", "reload", "--config", "/etc/caddy/Caddyfile"], env=runtime, check=True)


if __name__ == "__main__":
    main()
