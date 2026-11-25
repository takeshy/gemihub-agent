"""Refresh the Agent stack on its existing VM, retaining the shared proxy routes."""

import argparse
import base64
import fcntl
import json
from pathlib import Path
import subprocess
from urllib.request import Request, urlopen


ROOT = Path("/opt/gemihub-dev")
METADATA = "http://metadata.google.internal/computeMetadata/v1/instance/attributes/gemihub-dev-"


def metadata(key):
    with urlopen(Request(METADATA + key, headers={"Metadata-Flavor": "Google"}), timeout=10) as response:
        return response.read()


def merge_caddy(live, previous, current):
    # Co-hosted routes are appended to the managed Caddyfile. Preserve them byte for byte
    # and refuse an unrecognized live file rather than guessing which routes to replace.
    for managed in (current, previous):
        prefix = managed.rstrip()
        if live.rstrip() == prefix:
            return current
        if live.startswith(prefix + b"\n\n"):
            return current.rstrip() + live[len(prefix):]
    raise ValueError("Live Caddyfile differs from the expected Agent configuration")


def deploy(image, previous_caddy):
    def check_image():
        if json.loads(metadata("config"))["image"] != image:
            raise RuntimeError("VM metadata no longer points to the requested release")

    with open("/run/lock/gemihub-dev-deploy.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        check_image()
        configs = {key: base64.b64decode(metadata(key), validate=True) for key in ("compose", "runner", "caddy")}
        caddyfile = ROOT / "Caddyfile"
        before = caddyfile.read_bytes()
        try:
            after = merge_caddy(before, previous_caddy, configs["caddy"])
        except ValueError:
            # A previous attempt may have updated VM metadata but stopped before refreshing the live files.
            running_caddy = subprocess.check_output(
                ["docker", "exec", "gemihub-dev_app_1", "cat", "/app/infra/dev/Caddyfile"],
            )
            after = merge_caddy(before, running_caddy, configs["caddy"])
        subprocess.run(
            ["docker", "exec", "-i", "gemihub-dev_caddy_1", "caddy", "validate",
             "--config", "/dev/stdin", "--adapter", "caddyfile"],
            input=after,
            check=True,
        )
        check_image()
        if caddyfile.read_bytes() != before:
            raise RuntimeError("Shared Caddy configuration changed during validation")
        if after != before:
            # Keep the inode for the existing Caddy container's file bind mount.
            caddyfile.write_bytes(after)
        for key, name in (("compose", "compose.yaml"), ("runner", "run.py")):
            target = ROOT / name
            temporary = target.with_suffix(target.suffix + ".update")
            temporary.write_bytes(configs[key])
            temporary.replace(target)
        subprocess.run(["systemctl", "restart", "gemihub-dev"], check=True)
        check_image()
        subprocess.run(["systemctl", "is-active", "gemihub-dev"], check=True)
        expected = subprocess.check_output(["docker", "image", "inspect", "--format", "{{.Id}}", image], text=True).strip()
        running = subprocess.check_output(
            ["docker", "inspect", "--format", "{{.Image}} {{.State.Running}}",
             "gemihub-dev_app_1", "gemihub-dev_challenge-demo_1"],
            text=True,
        ).splitlines()
        if running != [f"{expected} true"] * 2:
            raise RuntimeError("The Agent containers are not running the requested image")
        print(f"Running image: {image}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image")
    parser.add_argument("previous_caddy", help="Base64 copy of the previously managed Caddyfile")
    args = parser.parse_args()
    deploy(args.image, base64.b64decode(args.previous_caddy, validate=True))
