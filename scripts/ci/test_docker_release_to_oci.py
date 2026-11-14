"""Regression checks for bounded, gzip-layer OCI base conversion.

Uses synthetic Docker archives; does not contact Docker or the network.
"""
import importlib.util
import io
import gzip
import hashlib
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

SOURCE = Path(__file__).with_name("docker-release-to-oci.py")
SPEC = importlib.util.spec_from_file_location("npmi_release_oci", SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class OCIConverterTests(unittest.TestCase):
    def test_streaming_content_addressed_layers_are_gzip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            assets = root / "assets"
            assets.mkdir()
            for arch in ("amd64", "arm64"):
                config_name = f"blobs/sha256/config-{arch}"
                layer_name = f"blobs/sha256/content-layer-{arch}"
                config = json.dumps({"os": "linux", "architecture": arch}).encode()
                layer = (f"FROM {arch}\n".encode() + b"binary-content\x00" * 60000)
                manifest = json.dumps([{
                    "Config": config_name,
                    "RepoTags": ["ghcr.io/gigabytegrove/npm-improved:v1.7.8"],
                    "Layers": [layer_name],
                }]).encode()
                archive_path = assets / f"npm-improved-v1.7.8-linux-{arch}.tar.gz"
                with tarfile.open(archive_path, mode="w:gz") as archive:
                    for name, payload in (
                        (config_name, config),
                        (layer_name, layer),
                        ("manifest.json", manifest),
                    ):
                        member = tarfile.TarInfo(name)
                        member.size = len(payload)
                        archive.addfile(member, io.BytesIO(payload))
            dest = root / "oci"
            MODULE.convert(assets, dest, "v1.7.8")
            index = json.loads((dest / "index.json").read_text())
            self.assertEqual(len(index["manifests"]), 2)
            for record in index["manifests"]:
                arch = record["platform"]["architecture"]
                blob = dest / "blobs" / "sha256" / record["digest"].split(":", 1)[1]
                manifest = json.loads(blob.read_bytes())
                entry = manifest["layers"][0]
                self.assertEqual(entry["mediaType"], "application/vnd.oci.image.layer.v1.tar+gzip")
                compressed = (dest / "blobs" / "sha256" / entry["digest"].split(":", 1)[1]).read_bytes()
                plain = gzip.decompress(compressed)
                self.assertTrue(plain.startswith(f"FROM {arch}".encode()))
                self.assertLess(len(compressed), len(plain) // 8)
                self.assertEqual(hashlib.sha256(compressed).hexdigest(), entry["digest"][7:])
                self.assertEqual(len(compressed), entry["size"])


if __name__ == "__main__":
    unittest.main()
