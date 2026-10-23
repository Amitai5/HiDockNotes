"""Hermetic regression checks for the TrueNAS host updater."""

import json
import unittest

from truenas_auto_update import APP_NAME, IMAGE, update_once


class FakeHost:
    def __init__(self, running="old", available="new", state="RUNNING", health="healthy"):
        self.running = running
        self.available = available
        self.state = state
        self.health = health
        self.configured_image = IMAGE
        self.commands = []
        self.fail_pull = False
        self.fail_redeploy = False
        self.stop_during_pull = False
        self.identifiers = "container-id\n"

    def run(self, command):
        self.commands.append(command)
        if command == ["midclt", "call", "app.get_instance", APP_NAME]:
            return json.dumps({"state": self.state})
        if command[:3] == ["docker", "ps", "--quiet"]:
            if command != ["docker", "ps", "--quiet", "--filter", "label=com.docker.compose.project=ix-hidocknotes", "--filter", "label=com.docker.compose.service=hidocknotes"]:
                raise AssertionError("Container lookup must target only the HiDockNotes app and service.")
            return self.identifiers
        if command[:3] == ["docker", "container", "inspect"]:
            return json.dumps([{
                "Image": self.running,
                "Config": {"Image": self.configured_image, "Labels": {"org.opencontainers.image.version": "0.15.2"}},
                "State": {"Health": {"Status": self.health}},
            }])
        if command == ["docker", "image", "inspect", IMAGE]:
            return json.dumps([{"Id": self.available}])
        if command == ["midclt", "call", "-job", "app.pull_images", APP_NAME, '{"redeploy": false}']:
            if self.fail_pull:
                raise RuntimeError("Registry unavailable")
            if self.stop_during_pull:
                self.state = "STOPPED"
            return "null"
        if command == ["midclt", "call", "-job", "app.redeploy", APP_NAME]:
            if self.fail_redeploy:
                raise RuntimeError("Redeploy failed")
            self.running = self.available
            return "{}"
        raise AssertionError("Unexpected host command: " + repr(command))

    def redeploys(self):
        return [command for command in self.commands if "app.redeploy" in command]


class TrueNasAutoUpdateTests(unittest.TestCase):
    def test_changed_image_redeploys_only_hidocknotes_and_verifies_health(self):
        host = FakeHost()
        self.assertEqual("HiDockNotes updated successfully to 0.15.2.", update_once(run=host.run))
        self.assertEqual(1, len(host.redeploys()))
        self.assertEqual("new", host.running)

    def test_unchanged_image_does_not_redeploy(self):
        host = FakeHost(running="new")
        self.assertIsNone(update_once(run=host.run))
        self.assertEqual([], host.redeploys())

    def test_stopped_app_is_left_stopped(self):
        host = FakeHost(state="STOPPED")
        self.assertIsNone(update_once(run=host.run))
        self.assertEqual([["midclt", "call", "app.get_instance", APP_NAME]], host.commands)

    def test_pinned_version_is_rejected_before_any_pull(self):
        host = FakeHost()
        host.configured_image = "ghcr.io/amitai5/hidocknotes:0.15.1"
        with self.assertRaisesRegex(RuntimeError, "before enabling"):
            update_once(run=host.run)
        self.assertFalse(any("app.pull_images" in command for command in host.commands))

    def test_missing_or_ambiguous_containers_are_not_updated(self):
        for identifiers in ["", "first\nsecond\n"]:
            with self.subTest(identifiers=identifiers):
                host = FakeHost()
                host.identifiers = identifiers
                with self.assertRaisesRegex(RuntimeError, "one running"):
                    update_once(run=host.run)
                self.assertFalse(any("app.pull_images" in command for command in host.commands))

    def test_registry_failure_does_not_redeploy(self):
        host = FakeHost()
        host.fail_pull = True
        with self.assertRaisesRegex(RuntimeError, "Registry unavailable"):
            update_once(run=host.run)
        self.assertEqual([], host.redeploys())
        self.assertEqual("old", host.running)

    def test_a_manual_stop_during_pull_is_respected(self):
        host = FakeHost()
        host.stop_during_pull = True
        self.assertIsNone(update_once(run=host.run))
        self.assertEqual([], host.redeploys())

    def test_check_mode_can_pull_but_never_redeploys(self):
        host = FakeHost()
        self.assertIn("newer", update_once(check_only=True, run=host.run))
        self.assertEqual([], host.redeploys())
        self.assertEqual("old", host.running)

    def test_failed_redeploy_is_retried_against_the_running_image(self):
        host = FakeHost()
        host.fail_redeploy = True
        with self.assertRaisesRegex(RuntimeError, "Redeploy failed"):
            update_once(run=host.run)
        host.fail_redeploy = False
        self.assertIn("successfully", update_once(run=host.run))
        self.assertEqual(2, len(host.redeploys()))

    def test_unhealthy_update_reports_failure(self):
        host = FakeHost(health="unhealthy")
        with self.assertRaisesRegex(RuntimeError, "unhealthy"):
            update_once(run=host.run)

    def test_health_timeout_reports_failure_without_silent_rollback(self):
        host = FakeHost(health="starting")
        sleeps = []
        with self.assertRaisesRegex(RuntimeError, "180 seconds"):
            update_once(run=host.run, sleep=sleeps.append)
        self.assertEqual([3] * 60, sleeps)
        self.assertEqual(1, len(host.redeploys()))

    def test_replacement_during_redeploy_checks_the_image_actually_pulled(self):
        host = FakeHost()
        original = host.run

        def run(command):
            if "app.redeploy" in command:
                host.available = "even-newer"
            return original(command)

        self.assertIn("successfully", update_once(run=run))
        self.assertEqual("even-newer", host.running)


if __name__ == "__main__":
    unittest.main()
