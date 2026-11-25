import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location("dev_runner", Path(__file__).parents[1] / "run.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)
REPOSITORY = "asia-northeast1-docker.pkg.dev/fixture-project/gemihub-dev/app"


class DeploymentTest(unittest.TestCase):
    def run_deployment(self, failure=None, deployed=None, image="sha256:new"):
        calls = []
        config = {"project": "fixture-project", "image": f"{REPOSITORY}:fixture", "model": "fixture-model", "secrets": {}}
        secrets = {"SESSION_SECRET": "x" * 32, "PARENT_AUTH_SECRET": "y" * 32, "PARENT_INTEGRATION_SECRET": "z" * 32, "PARENT_ADMIN_EMAILS": "operator@example.com"}

        class Response:
            def __enter__(self):
                import base64
                import io
                import json
                return io.BytesIO(json.dumps({"payload": {"data": base64.b64encode(json.dumps(secrets).encode()).decode()}}).encode())

            def __exit__(self, *_):
                pass

        def run(command, **kwargs):
            calls.append(command)
            if failure and failure(command):
                raise subprocess.CalledProcessError(1, command)
            return subprocess.CompletedProcess(command, 0)

        with tempfile.TemporaryDirectory() as directory:
            real_path = Path
            history = real_path(directory) / "deployed-images.json"
            if deployed:
                history.write_text(json.dumps(deployed))
            def record_check(*args):
                calls.append(["health-check"])
                if failure and failure(["health-check"]):
                    raise subprocess.CalledProcessError(1, ["health-check"])
            def record_prune(repository, keep):
                calls.append(["prune", repository, keep])
            with patch.object(runner, "metadata", side_effect=lambda path: config if path.endswith("config") else {"access_token": "fixture-token"}), patch.object(runner.urllib.request, "urlopen", return_value=Response()), patch.object(runner, "Path", side_effect=lambda path: real_path(directory) / real_path(path).name), patch.object(runner.subprocess, "run", side_effect=run), patch.object(runner, "service_image", return_value="sha256:old"), patch.object(runner, "docker_output", return_value=[image]), patch.object(runner, "check_services", side_effect=record_check), patch.object(runner, "prune_agent_images", side_effect=record_prune):
                try:
                    runner.main()
                except subprocess.CalledProcessError:
                    if failure is None:
                        raise
            return calls, json.loads(history.read_text())

    def test_validates_before_stopping_and_reloads_after_services_are_started(self):
        commands, history = self.run_deployment()
        validate = next(i for i, command in enumerate(commands) if "validate" in command)
        stop = next(i for i, command in enumerate(commands) if "stop" in command)
        start = next(i for i, command in enumerate(commands) if "up" in command)
        reload = next(i for i, command in enumerate(commands) if "reload" in command)
        self.assertLess(validate, stop)
        self.assertLess(start, reload)
        self.assertIn("--remove-orphans", commands[start])
        self.assertEqual(commands[reload + 1:], [["health-check"], ["prune", REPOSITORY, {"sha256:new", "sha256:old"}]])
        self.assertEqual(history, {"current": "sha256:new", "previous": "sha256:old"})

    def test_bad_caddy_configuration_never_stops_the_current_app(self):
        commands, _ = self.run_deployment(lambda command: "validate" in command)
        self.assertFalse(any("stop" in command or "up" in command or "reload" in command for command in commands))

    def test_failed_service_start_never_reloads_the_proxy(self):
        commands, _ = self.run_deployment(lambda command: "up" in command)
        self.assertFalse(any("reload" in command for command in commands))

    def test_failed_health_check_does_not_prune_or_replace_history(self):
        commands, history = self.run_deployment(lambda command: "health-check" in command)
        self.assertFalse(any("prune" in command for command in commands))
        self.assertEqual(history, {"current": "sha256:old", "previous": None})

    def test_retry_of_same_image_preserves_previous_image(self):
        history = {"current": "sha256:new", "previous": "sha256:old"}
        commands, saved = self.run_deployment(deployed=history)
        self.assertEqual(saved, history)
        self.assertEqual(commands[-1], ["prune", REPOSITORY, {"sha256:new", "sha256:old"}])

    def test_restarting_first_seen_image_leaves_unknown_rollback_candidates(self):
        commands, history = self.run_deployment(image="sha256:old")
        self.assertFalse(any("prune" in command for command in commands))
        self.assertEqual(history, {"current": "sha256:old", "previous": None})

    def test_cleanup_preserves_used_and_other_repository_images(self):
        hybrid = REPOSITORY.removesuffix("/app") + "/hybrid"
        rows = [
            f"{REPOSITORY} new sha256:new", f"{REPOSITORY} previous sha256:old",
            f"{REPOSITORY} stopped sha256:used", f"{REPOSITORY} obsolete sha256:obsolete",
            f"{REPOSITORY} <none> sha256:untagged", f"{REPOSITORY} <none> sha256:shared",
            f"{hybrid} tagged sha256:shared", f"{hybrid} obsolete sha256:hybrid",
            "<none> <none> sha256:unknown",
        ]
        with patch.object(runner, "docker_output", side_effect=[["stopped-container"], ["sha256:used"], rows]), patch.object(runner.subprocess, "run", new_callable=Mock) as remove:
            runner.prune_agent_images(REPOSITORY, {"sha256:new", "sha256:old"})
        self.assertEqual([call.args[0] for call in remove.call_args_list], [
            ["docker", "image", "rm", "--no-prune", REPOSITORY + ":obsolete"],
            ["docker", "image", "rm", "--no-prune", "sha256:untagged"],
        ])


if __name__ == "__main__":
    unittest.main()
