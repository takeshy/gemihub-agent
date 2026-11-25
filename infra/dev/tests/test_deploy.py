from copy import deepcopy
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import unittest
from unittest.mock import patch


def load(name):
    spec = spec_from_file_location(name, Path(__file__).parents[1] / f"{name}.py")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


client = load("deploy")
vm_runner = load("deploy-on-vm")
IMAGE = client.REPOSITORY + "@sha256:" + "1" * 64


def saved_plan():
    before = {
        "id": client.INSTANCE, "machine_type": "e2-small",
        "metadata": {
            "enable-oslogin": "TRUE",
            "gemihub-dev-config": json.dumps({"project": client.PROJECT, "model": "current", "image": "old", "secrets": {}}),
            "gemihub-dev-compose": "compose", "gemihub-dev-caddy": "proxy", "gemihub-dev-runner": "runner",
        },
    }
    after = deepcopy(before)
    after["metadata"]["gemihub-dev-config"] = json.dumps({"project": client.PROJECT, "model": "current", "image": IMAGE, "secrets": {}})
    return {"resource_changes": [{"address": "google_compute_instance.dev", "change": {
        "actions": ["update"], "before": before, "after": after, "after_unknown": {},
    }}]}


class PortableDeploymentTest(unittest.TestCase):
    def test_plan_accepts_only_the_existing_vm_and_release_metadata(self):
        plan = saved_plan()
        plan["resource_changes"][0]["change"]["after"]["metadata"]["gemihub-dev-caddy"] = "new-proxy"
        self.assertEqual(client.approved_plan(plan, IMAGE), ("proxy", ["gemihub-dev-caddy", "gemihub-dev-config"]))

    def test_plan_rejects_other_resources_and_changes_outside_the_release(self):
        plan = saved_plan()
        plan["resource_changes"].append({"address": "google_dns_record_set.dev", "change": {"actions": ["update"]}})
        with self.assertRaisesRegex(ValueError, "Unexpected infrastructure change"):
            client.approved_plan(plan, IMAGE)
        plan = saved_plan()
        plan["resource_changes"][0]["change"]["after"]["machine_type"] = "e2-standard-2"
        with self.assertRaisesRegex(ValueError, "beyond metadata"):
            client.approved_plan(plan, IMAGE)
        plan = saved_plan()
        plan["resource_changes"][0]["change"]["after"]["metadata"]["enable-oslogin"] = "FALSE"
        with self.assertRaisesRegex(ValueError, "outside the Agent release"):
            client.approved_plan(plan, IMAGE)
        plan = saved_plan()
        config = plan["resource_changes"][0]["change"]["after"]["metadata"]
        config["gemihub-dev-config"] = config["gemihub-dev-config"].replace("current", "other")
        with self.assertRaisesRegex(ValueError, "model or secret references"):
            client.approved_plan(plan, IMAGE)

    def test_cloud_build_returns_the_digest_of_the_submitted_commit(self):
        build_id = "12345678-1234-1234-1234-123456789012"
        digest = IMAGE.split("@")[1]
        submitted = []

        def command(*args, **kwargs):
            if args[2] == "submit":
                submitted.extend(args)
                return build_id
            tag = next(arg.split("=", 2)[2] for arg in submitted if arg.startswith("--substitutions="))
            return json.dumps({"status": "SUCCESS", "results": {"images": [{"name": tag, "digest": digest}]}})

        with patch.object(client, "output", side_effect=command):
            self.assertEqual(client.build_image(Path("/tmp/source"), "a" * 40), IMAGE)
        self.assertTrue(any(":git-aaaaaaaaaaaa-" in arg for arg in submitted))

    def test_caddy_update_retains_cohosted_routes_even_when_retried(self):
        before = b"dev.example {\n  respond old\n}\n"
        after = b"dev.example {\n  respond new\n}\n"
        suffix = b"\n\nhybrid.example {\n  respond hybrid\n}\n"
        self.assertEqual(vm_runner.merge_caddy(before, before, after), after)
        self.assertEqual(vm_runner.merge_caddy(before.rstrip() + suffix, before, after), after.rstrip() + suffix)
        self.assertEqual(vm_runner.merge_caddy(after.rstrip() + suffix, before, after), after.rstrip() + suffix)
        with self.assertRaisesRegex(ValueError, "Live Caddyfile differs"):
            vm_runner.merge_caddy(b"unexpected\n" + before, before, after)


if __name__ == "__main__":
    unittest.main()
