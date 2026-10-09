"""Offline checks for native updater release-package integrity and version policy."""
import hashlib
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
import importlib.util

SOURCE = Path(__file__).with_name("host-update-maintenance.py")
SPEC = importlib.util.spec_from_file_location("npm_host_maintenance", SOURCE)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class HostUpdaterBundleTests(unittest.TestCase):
    def archive(self, *, evil=False):
        payload = io.BytesIO()
        with tarfile.open(fileobj=payload, mode="w:gz") as tar:
            for name in module.PROGRAMS:
                content = b"1.4.2\n" if name == ".version" else b"#!/bin/sh\nexit 0\n"
                member = tarfile.TarInfo(name)
                member.mode = 0o755
                member.size = len(content)
                tar.addfile(member, io.BytesIO(content))
            if evil:
                member = tarfile.TarInfo("../../etc/passwd")
                member.size = 4
                tar.addfile(member, io.BytesIO(b"oops"))
        return payload.getvalue()

    def sums(self, archive):
        return (hashlib.sha256(archive).hexdigest() +
                "  npm-improved-v1.4.2-host-updater.tar.gz\n").encode()

    def test_verified_package_contains_only_expected_native_scripts(self):
        tarball = self.archive()
        with tempfile.TemporaryDirectory() as dirname:
            stage = Path(dirname)
            module.verify_and_extract("1.4.2", self.sums(tarball), tarball, stage)
            self.assertEqual((stage / ".version").read_text(), "1.4.2\n")
            self.assertEqual(
                set(file.relative_to(stage).as_posix() for file in stage.rglob("*") if file.is_file()),
                set(module.PROGRAMS),
            )

    def test_checksum_mismatch_rejected(self):
        tarball = self.archive()
        with tempfile.TemporaryDirectory() as dirname:
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                module.verify_and_extract("1.4.2", self.sums(tarball), tarball + b"bad",
                                          Path(dirname))

    def test_unsafe_archive_paths_rejected(self):
        tarball = self.archive(evil=True)
        with tempfile.TemporaryDirectory() as dirname:
            with self.assertRaisesRegex(ValueError, "unexpected"):
                module.verify_and_extract("1.4.2", self.sums(tarball), tarball,
                                          Path(dirname))

    def test_only_forward_versions_install(self):
        self.assertTrue(module.newer_than("1.4.2", "1.4.1"))
        self.assertFalse(module.newer_than("1.4.2", "1.4.2"))
        self.assertFalse(module.newer_than("1.4.2", "1.4.3"))
        self.assertTrue(module.newer_than("1.4.2", "legacy"))
        for value in ("../../tmp/x", "1.4.2-rc", "", "latest"):
            with tempfile.TemporaryDirectory() as dirname:
                with self.assertRaisesRegex(ValueError, "stable semantic version"):
                    module.verify_and_extract(value, b"", b"", Path(dirname))


if __name__ == "__main__":
    unittest.main()
