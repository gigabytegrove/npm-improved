"""Offline checks for native updater release-package integrity and version policy."""
import hashlib
import io
import socket
from unittest import mock
from urllib.error import HTTPError, URLError
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


    def test_duplicate_archive_entry_rejected(self):
        payload = io.BytesIO()
        with tarfile.open(fileobj=payload, mode="w:gz") as tar:
            for name in module.PROGRAMS + (module.PROGRAMS[0],):
                content = b"1.4.2\n" if name == ".version" else b"test"
                member = tarfile.TarInfo(name)
                member.size = len(content)
                tar.addfile(member, io.BytesIO(content))
        package = payload.getvalue()
        with tempfile.TemporaryDirectory() as dirname:
            with self.assertRaisesRegex(ValueError, "unexpected"):
                module.verify_and_extract("1.4.2", self.sums(package), package,
                                          Path(dirname))

    def test_expanded_archive_size_cap(self):
        payload = io.BytesIO()
        with tarfile.open(fileobj=payload, mode="w:gz") as tar:
            for idx, name in enumerate(module.PROGRAMS):
                content = (b"x" * (module.MAX_PACKAGE_BYTES // 2)
                           if idx else b"1.4.2\n")
                member = tarfile.TarInfo(name)
                member.size = len(content)
                tar.addfile(member, io.BytesIO(content))
        package = payload.getvalue()
        with tempfile.TemporaryDirectory() as dirname:
            with self.assertRaisesRegex(ValueError, "expands beyond"):
                module.verify_and_extract("1.4.2", self.sums(package), package,
                                          Path(dirname))

    def test_host_dns_failures_are_explained_without_raw_tracebacks(self):
        failure = URLError(socket.gaierror(-3, "Temporary failure in name resolution"))
        message = module.explain_maintenance_error(failure)
        self.assertIn("Docker host", message)
        self.assertIn("DNS", message)
        self.assertIn("GitHub", message)
        self.assertNotIn("[Errno -3]", message)

    def test_transient_dns_failures_retry_then_succeed(self):
        response = io.BytesIO(b"verified release content")
        failure = URLError(socket.gaierror(-3, "Temporary failure in name resolution"))
        with mock.patch.object(module, "urlopen", side_effect=[failure, response]) as loader, \
             mock.patch.object(module.time, "sleep") as sleep:
            self.assertEqual(module.fetch("https://github.com/test-release"), b"verified release content")
            self.assertEqual(loader.call_count, 2)
            sleep.assert_called_once_with(2)

    def test_permanent_http_error_does_not_retry(self):
        failure = HTTPError("https://github.com/release", 404, "Not Found", {}, None)
        with mock.patch.object(module, "urlopen", side_effect=failure) as loader, \
             mock.patch.object(module.time, "sleep") as sleep:
            with self.assertRaises(HTTPError):
                module.fetch("https://github.com/release")
            loader.assert_called_once()
            sleep.assert_not_called()

    def test_explicit_reinstall_refreshes_same_version_host_updater(self):
        tarball = self.archive()
        root_info = {"mode": "native-host-service", "component_version": "1.4.2"}
        with tempfile.TemporaryDirectory() as dirname:
            root = Path(dirname)
            root_info["project_dir"] = str(root)
            def download(url):
                return self.sums(tarball) if url.endswith("SHA256SUMS.txt") else tarball
            with mock.patch.object(module, "read_ready", return_value=root_info), \
                 mock.patch.object(module.subprocess, "run") as installer:
                self.assertFalse(module.maintain(root, "1.4.2", downloader=download))
                installer.assert_not_called()
                self.assertTrue(module.maintain(root, "1.4.2", downloader=download, force=True))
                installer.assert_called_once()
                self.assertEqual(installer.call_args.args[0][0], "/bin/bash")

    def test_native_updater_downgrade_rejected_even_if_forced(self):
        with tempfile.TemporaryDirectory() as dirname:
            root = Path(dirname)
            ready = {"mode": "native-host-service", "project_dir": str(root),
                     "component_version": "1.7.0"}
            with mock.patch.object(module, "read_ready", return_value=ready):
                with self.assertRaisesRegex(ValueError, "downgrade"):
                    module.maintain(root, "1.6.15", force=True)

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
