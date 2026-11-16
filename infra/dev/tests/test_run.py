import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("dev_runner", Path(__file__).parents[1] / "run.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class DeploymentTest(unittest.TestCase):
    def run_deployment(self, failure=None):
        calls = []
        config = {"project": "fixture-project", "image": "registry/app:fixture", "model": "fixture-model", "secrets": {}}
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

        with tempfile.TemporaryDirectory() as directory:
            real_path = Path
            with patch.object(runner, "metadata", side_effect=lambda path: config if path.endswith("config") else {"access_token": "fixture-token"}), patch.object(runner.urllib.request, "urlopen", return_value=Response()), patch.object(runner, "Path", side_effect=lambda path: real_path(directory) / real_path(path).name), patch.object(runner.subprocess, "run", side_effect=run):
                try:
                    runner.main()
                except subprocess.CalledProcessError:
                    if failure is None:
                        raise
        return calls

    def test_validates_before_stopping_and_reloads_after_services_are_started(self):
        commands = self.run_deployment()
        validate = next(i for i, command in enumerate(commands) if "validate" in command)
        stop = next(i for i, command in enumerate(commands) if "stop" in command)
        start = next(i for i, command in enumerate(commands) if "up" in command)
        reload = next(i for i, command in enumerate(commands) if "reload" in command)
        self.assertLess(validate, stop)
        self.assertLess(start, reload)
        self.assertIn("--remove-orphans", commands[start])

    def test_bad_caddy_configuration_never_stops_the_current_app(self):
        commands = self.run_deployment(lambda command: "validate" in command)
        self.assertFalse(any("stop" in command or "up" in command or "reload" in command for command in commands))

    def test_failed_service_start_never_reloads_the_proxy(self):
        commands = self.run_deployment(lambda command: "up" in command)
        self.assertFalse(any("reload" in command for command in commands))


if __name__ == "__main__":
    unittest.main()
