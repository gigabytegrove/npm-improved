"""Bounded, unprivileged regression checks for the native updater bootstrap.

Only the isolated systemctl decision block is exercised; no systemd units,
Docker containers, or production files are touched by these tests.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install-host-updater"


class HostUpdaterSelfReloadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = INSTALLER.read_text()
        start = cls.source.index("# A protocol-1 updater calls this installer")
        end = cls.source.index(
            "# Readiness is written only after all programs and systemd units are ready.",
            start,
        )
        cls.decision = cls.source[start:end]

    def test_retry_period_is_bounded(self):
        self.assertIn("OnUnitInactiveSec=5min", self.source)
        self.assertNotIn("OnUnitActiveSec=6h", self.source)

    def _run(self, active):
        with tempfile.TemporaryDirectory() as temp:
            log = Path(temp) / "calls"
            shell = """
UNIT=npmi-synthetic
MOCK_ACTIVE=$ACTIVE
systemctl() {
    case "$1" in
      is-active|is-enabled)
        test "$MOCK_ACTIVE" = 1
        ;;
      start)
        MOCK_ACTIVE=1
        printf '%s\\n' "$*" >> "$LOG"
        ;;
      daemon-reload|enable)
        printf '%s\\n' "$*" >> "$LOG"
        ;;
      *)
        return 2
        ;;
    esac
}
""" + self.decision
            result = subprocess.run(
                ["bash", "-e", "-c", shell],
                capture_output=True, text=True, timeout=10,
                env={**os.environ, "ACTIVE": str(int(active)), "LOG": str(log)},
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            return log.read_text() if log.exists() else ""

    def test_existing_active_service_never_self_reloads(self):
        self.assertEqual(self._run(True), "")

    def test_missing_service_activates_and_verifies(self):
        log = self._run(False)
        self.assertIn("daemon-reload", log)
        self.assertIn("enable", log)
        self.assertIn("start --no-block", log)


if __name__ == "__main__":
    unittest.main()
