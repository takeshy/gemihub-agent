"""Build and deploy a Git commit to the existing Agent environment."""

import argparse
import json
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile
import time
from uuid import uuid4


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PROJECT = "geminihub-486523"
VM = "gemihub-dev"
REGION = "asia-northeast1"
ZONE = f"{REGION}-b"
REPOSITORY = f"{REGION}-docker.pkg.dev/{PROJECT}/{VM}/app"
INSTANCE = f"projects/{PROJECT}/zones/{ZONE}/instances/{VM}"
MANAGED_KEYS = {f"{VM}-{key}" for key in ("config", "compose", "caddy", "runner")}


def output(*args, cwd=ROOT):
    return subprocess.run(args, cwd=cwd, stdout=subprocess.PIPE, text=True, check=True).stdout.strip()


def approved_plan(plan, image):
    changes = plan["resource_changes"]
    for change in changes:
        if change["change"]["actions"] != ["no-op"] and change["address"] != "google_compute_instance.dev":
            raise ValueError(f"Unexpected infrastructure change: {change['address']}")
    vm, = [item["change"] for item in changes if item["address"] == "google_compute_instance.dev"]
    if vm["actions"] not in (["update"], ["no-op"]):
        raise ValueError("The saved plan must update the existing Agent VM")
    before, after = vm["before"], vm["after"]
    if before["id"] != INSTANCE or after["id"] != INSTANCE:
        raise ValueError("The saved plan points to a different VM")
    if vm.get("after_unknown", {}).get("metadata") or any(
        after.get(key) != before.get(key) for key in before.keys() | after.keys() if key != "metadata"
    ):
        raise ValueError("The saved plan changes VM settings beyond metadata")
    old, new = before["metadata"], after["metadata"]
    changed = {key for key in old.keys() | new.keys() if old.get(key) != new.get(key)}
    if changed - MANAGED_KEYS or MANAGED_KEYS - new.keys():
        raise ValueError("The saved plan changes metadata outside the Agent release")
    old_config = json.loads(old[f"{VM}-config"])
    new_config = json.loads(new[f"{VM}-config"])
    if new_config != {**old_config, "image": image}:
        raise ValueError("The saved plan changes the Agent model or secret references")
    return old[f"{VM}-caddy"], sorted(changed)


def build_image(source, commit):
    tag = f"{REPOSITORY}:git-{commit[:12]}-{uuid4().hex[:8]}"
    build_id = output(
        "gcloud", "builds", "submit", ".", f"--project={PROJECT}", f"--region={REGION}",
        "--config=infra/dev/cloudbuild.yaml",
        f"--service-account=projects/{PROJECT}/serviceAccounts/{VM}-build@{PROJECT}.iam.gserviceaccount.com",
        f"--gcs-source-staging-dir=gs://{PROJECT}-{VM}-build-source/source",
        f"--substitutions=_IMAGE={tag}", "--async", "--format=value(id)", cwd=source,
    )
    if not re.fullmatch(r"[a-f0-9-]{36}", build_id):
        raise ValueError("Cloud Build did not return a build ID")
    print(f"Cloud Build: {build_id}", flush=True)
    for _ in range(70):
        build = json.loads(output("gcloud", "builds", "describe", build_id, f"--project={PROJECT}", f"--region={REGION}", "--format=json"))
        status = build["status"]
        if status == "SUCCESS":
            digest, = [item["digest"] for item in build["results"]["images"] if item["name"] == tag]
            if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
                raise ValueError("Cloud Build did not return a valid image digest")
            return f"{REPOSITORY}@{digest}"
        if status not in ("PENDING", "QUEUED", "WORKING"):
            raise RuntimeError(f"Cloud Build {build_id}: {status}")
        time.sleep(15)
    raise TimeoutError(f"Cloud Build {build_id} is still running")


def deploy(ref):
    for executable in ("git", "tar", "gcloud", "terraform"):
        if not shutil.which(executable):
            raise RuntimeError(f"Required command not found: {executable}")
    commit = output("git", "rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}")
    instance = json.loads(output(
        "gcloud", "compute", "instances", "describe", VM, f"--project={PROJECT}", f"--zone={ZONE}", "--format=json(metadata)",
    ))
    values = {item["key"]: item["value"] for item in instance["metadata"]["items"]}
    config = json.loads(values[f"{VM}-config"])
    if config["project"] != PROJECT or not config["model"]:
        raise ValueError("The existing Agent deployment settings could not be read")

    print(f"Deploying {commit} to {VM}", flush=True)
    with tempfile.TemporaryDirectory(prefix="gemihub-agent-deploy-") as directory:
        stage = Path(directory)
        source = stage / "source"
        source.mkdir()
        archive = stage / "source.tar"
        subprocess.run(["git", "archive", "--format=tar", f"--output={archive}", commit], cwd=ROOT, check=True)
        subprocess.run(["tar", "-xf", str(archive), "-C", str(source)], check=True)
        image = build_image(source, commit)
        terraform = ("terraform", f"-chdir={source / 'infra/dev'}")
        subprocess.run([*terraform, "init", "-input=false", "-lockfile=readonly", "-backend-config=backend.hcl.example"], check=True)
        plan = stage / "release.tfplan"
        output(*terraform, "plan", "-input=false", "-no-color", f"-out={plan}",
               f"-var=project_id={PROJECT}", f"-var=vertex_model={config['model']}", f"-var=app_image={image}")
        previous_caddy, changed = approved_plan(json.loads(output(*terraform, "show", "-json", str(plan))), image)
        print("Agent metadata: " + (", ".join(changed) or "already current"), flush=True)
        subprocess.run([*terraform, "apply", "-input=false", str(plan)], check=True)
        with (HERE / "deploy-on-vm.py").open("rb") as script:
            subprocess.run([
                "gcloud", "compute", "ssh", VM, f"--project={PROJECT}", f"--zone={ZONE}",
                "--tunnel-through-iap", "--quiet",
                "--command=" + shlex.join(["sudo", "python3", "-", image, previous_caddy]),
            ], stdin=script, check=True)
    print(f"Deployed {commit} to https://dev.gemihub.net/")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ref", nargs="?", default="HEAD", help="Git commit, tag, or branch to deploy (default: HEAD)")
    args = parser.parse_args()
    try:
        deploy(args.ref)
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Deployment failed: {error}\n")
