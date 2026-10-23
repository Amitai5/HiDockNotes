#!/usr/bin/env python3
"""Update only the HiDockNotes TrueNAS app when its latest image has changed."""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time

APP_NAME = "hidocknotes"
IMAGE = "ghcr.io/amitai5/hidocknotes:latest"


def run_command(arguments):
    """Run a local command without a shell and propagate errors."""
    result = subprocess.run(arguments, check=True, capture_output=True, text=True, timeout=1200)
    return result.stdout


def running_container(run):
    """Find the single running service by its Compose labels, not its generated name."""
    identifiers = run([
        "docker", "ps", "--quiet",
        "--filter", "label=com.docker.compose.project=ix-" + APP_NAME,
        "--filter", "label=com.docker.compose.service=" + APP_NAME,
    ]).split()
    if len(identifiers) != 1:
        raise RuntimeError("Expected one running HiDockNotes service; leaving the app alone.")
    container = json.loads(run(["docker", "container", "inspect", identifiers[0]]))[0]
    if container["Config"]["Image"] != IMAGE:
        raise RuntimeError("Set the HiDockNotes image to " + IMAGE + " before enabling automatic updates.")
    return container


def update_once(check_only=False, run=run_command, sleep=time.sleep):
    """Pull through TrueNAS and redeploy only if the running image differs."""
    app = json.loads(run(["midclt", "call", "app.get_instance", APP_NAME]))
    if app["state"] != "RUNNING":
        return "HiDockNotes is not running; skipped." if check_only else None
    running_container(run)

    # Pull first without stopping the app. A registry failure leaves it running.
    run(["midclt", "call", "-job", "app.pull_images", APP_NAME, '{"redeploy": false}'])
    app = json.loads(run(["midclt", "call", "app.get_instance", APP_NAME]))
    if app["state"] != "RUNNING":
        return "HiDockNotes stopped during the check; skipped." if check_only else None
    current = running_container(run)
    candidate = json.loads(run(["docker", "image", "inspect", IMAGE]))[0]
    if current["Image"] == candidate["Id"]:
        return "HiDockNotes is already up to date." if check_only else None
    if check_only:
        return "A newer HiDockNotes image is ready; the scheduled task will apply it."

    # The running image is the comparison baseline, so a previous failed redeploy
    # is retried even when the new image was already pulled on the last run.
    print("Applying a new HiDockNotes image through TrueNAS...", flush=True)
    run(["midclt", "call", "-job", "app.redeploy", APP_NAME])
    candidate = json.loads(run(["docker", "image", "inspect", IMAGE]))[0]
    for _ in range(60):
        current = running_container(run)
        if current["Image"] != candidate["Id"]:
            raise RuntimeError("TrueNAS did not deploy the current latest image.")
        health = current["State"].get("Health", {}).get("Status")
        if health == "healthy":
            version = current["Config"].get("Labels", {}).get("org.opencontainers.image.version", "unknown")
            return "HiDockNotes updated successfully to " + version + "."
        if health == "unhealthy":
            raise RuntimeError("The updated app is unhealthy. Check its TrueNAS container logs.")
        sleep(3)
    raise RuntimeError("The updated app did not become healthy within 180 seconds. Check its container logs.")


def main():
    """Run once under a host lock; TrueNAS Cron Jobs supplies the schedule."""
    import fcntl

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Pull and compare images without redeploying.")
    options = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError("Run this TrueNAS host task as root; the app itself remains UID/GID 568.")
    os.environ["PATH"] = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    for executable in ("midclt", "docker"):
        if not shutil.which(executable):
            raise RuntimeError(executable + " was not found. Run this on the TrueNAS host, outside the container.")
    with open("/run/hidocknotes-auto-update.lock", "a", encoding="utf8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        result = update_once(options.check)
        if result:
            print(result)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.SubprocessError, ValueError, KeyError, OSError) as error:
        print("HiDockNotes automatic update failed: " + str(error), file=sys.stderr)
        sys.exit(1)
