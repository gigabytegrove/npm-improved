"""Regression tests with valid TAR layers, both raw and already gzip-compressed.

The previous fixture used arbitrary bytes rather than a Docker TAR layer; it
could not detect double-compression and produced false reassurance.
"""
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

SOURCE = Path(__file__).with_name("docker-release-to-oci.py")
SPEC = importlib.util.spec_from_file_location("npmi_release_oci", SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def tar_bytes(entries):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as archive:
        for name, content in entries:
            member = tarfile.TarInfo(name)
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
    return buf.getvalue()


class OCIConverterTests(unittest.TestCase):
    def test_raw_and_already_gzip_layers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            assets = root / "assets"
            assets.mkdir()
            expected = {}
            for arch in ("amd64", "arm64"):
                uncompressed = tar_bytes([("etc/npmi-verified", b"valid-release-archive" * 100)])
                # Simulate classic Docker save on AMD64, content-addressed
                # Docker save with an already compressed layer on ARM64.
                layer = uncompressed if arch == "amd64" else gzip.compress(uncompressed)
                config = json.dumps({
                    "os": "linux", "architecture": arch,
                    "rootfs": {"type": "layers", "diff_ids": [
                        "sha256:" + hashlib.sha256(uncompressed).hexdigest(),
                    ]},
                }).encode()
                manifest = json.dumps([{
                    "Config": "blobs/sha256/config.json",
                    "RepoTags": ["ghcr.io/gigabytegrove/npm-improved:v1.7.8"],
                    "Layers": ["blobs/sha256/layer-data"],
                }]).encode()
                source = tar_bytes([
                    ("manifest.json", manifest),
                    ("blobs/sha256/config.json", config),
                    ("blobs/sha256/layer-data", layer),
                ])
                (assets / f"npm-improved-v1.7.8-linux-{arch}.tar.gz").write_bytes(
                    gzip.compress(source))
                expected[arch] = uncompressed

            destination = root / "oci"
            MODULE.convert(assets, destination, "v1.7.8")
            index = json.loads((destination / "index.json").read_text())
            self.assertEqual(len(index["manifests"]), 2)
            for entry in index["manifests"]:
                arch = entry["platform"]["architecture"]
                manifest_file = destination / "blobs/sha256" / entry["digest"][7:]
                image = json.loads(manifest_file.read_text())
                layer = image["layers"][0]
                self.assertEqual(layer["mediaType"], MODULE.LAYER_GZIP if hasattr(MODULE, "LAYER_GZIP") else "application/vnd.oci.image.layer.v1.tar+gzip")
                blob = (destination / "blobs/sha256" / layer["digest"][7:]).read_bytes()
                self.assertEqual(hashlib.sha256(blob).hexdigest(), layer["digest"][7:])
                self.assertEqual(len(blob), layer["size"])
                self.assertEqual(gzip.decompress(blob), expected[arch])
                with tarfile.open(fileobj=io.BytesIO(gzip.decompress(blob)), mode="r:") as check:
                    self.assertIsNotNone(check.getmember("etc/npmi-verified"))

    def test_invalid_tar_is_rejected_before_build(self):
        with tempfile.TemporaryDirectory() as temp:
            data = b"not a TAR" * 100
            with self.assertRaisesRegex(ValueError, "invalid tar"):
                MODULE.store(
                    Path(temp), io.BytesIO(data), len(data), compress=True,
                    expected_diff_id="sha256:" + "0" * 64,
                )

    def test_corrupt_layer_digest_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            data = tar_bytes([("test.txt", b"correct layer")])
            with self.assertRaisesRegex(ValueError, "diff_ids"):
                MODULE.store(
                    Path(temp), io.BytesIO(data), len(data), compress=True,
                    expected_diff_id="sha256:" + "0" * 64,
                )


if __name__ == "__main__":
    unittest.main()
