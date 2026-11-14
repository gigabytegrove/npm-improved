#!/usr/bin/env python3
"""Convert SHA-256-verified Docker release archives into isolated OCI contexts.

Input archives are never extracted to arbitrary paths. Source image tags and
architectures are checked before the OCI descriptors are produced. The builder
can then use oci-layout:// contexts without reading a shared Docker daemon.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import zlib

MAX_ENTRY = 12 * 1024**3
MAX_TOTAL = 16 * 1024**3
MAX_ENTRIES = 5000


def store(blobs, stream, size, compress=False):
    """Stream a Docker tar layer into a content-addressed OCI blob.

    Compress each raw layer with gzip before storing it. OCI supports these
    layers natively, and disk usage stays near the size of release archives
    instead of their several-times-larger expanded tar content.
    """
    digest = hashlib.sha256()
    written = 0
    encoder = zlib.compressobj(level=1, wbits=31) if compress else None

    with tempfile.NamedTemporaryFile(dir=blobs, prefix=".npmi-", delete=False) as tmp:
        path = Path(tmp.name)
        try:
            remaining = size
            while remaining:
                chunk = stream.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise ValueError("Truncated Docker archive entry")
                remaining -= len(chunk)
                output = encoder.compress(chunk) if encoder else chunk
                if output:
                    digest.update(output)
                    tmp.write(output)
                    written += len(output)
            if encoder:
                output = encoder.flush()
                if output:
                    digest.update(output)
                    tmp.write(output)
                    written += len(output)
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    hex_digest = digest.hexdigest()
    target = blobs / hex_digest
    if target.is_file():
        path.unlink()
    else:
        os.replace(path, target)
    return {"digest": "sha256:" + hex_digest, "size": written}


def convert(assets, output, tag):
    blobs = output / "blobs" / "sha256"
    blobs.mkdir(parents=True, exist_ok=True)
    expected_tag = f"ghcr.io/gigabytegrove/npm-improved:{tag}"
    index = {"schemaVersion": 2, "manifests": []}
    for arch in ("amd64", "arm64"):
        source = assets / f"npm-improved-{tag}-linux-{arch}.tar.gz"

        # Discover layer paths before streaming contents. Docker archives may
        # use either */layer.tar or content-addressed blob names, so file
        # suffixes cannot safely identify which members need OCI compression.
        with tarfile.open(source, mode="r:gz") as archive:
            manifest_file = archive.extractfile("manifest.json")
            if manifest_file is None:
                raise ValueError("Docker archive missing manifest")
            description = json.load(manifest_file)
        if not isinstance(description, list):
            raise ValueError("Docker archive manifest is not a list")
        matches = [m for m in description if expected_tag in m.get("RepoTags", [])]
        if len(matches) != 1:
            raise ValueError(f"Base image tag not unique for {arch}")
        record = matches[0]
        layer_names = set(record["Layers"])
        needed = layer_names | {record["Config"]}
        members = {}
        count = total = 0

        with tarfile.open(source, mode="r|gz") as tf:
            for entry in tf:
                if entry.name not in needed:
                    continue
                if not entry.isfile():
                    raise ValueError("Required Docker archive entry is not a regular file")
                count += 1
                total += entry.size
                if count > MAX_ENTRIES or total > MAX_TOTAL or entry.size > MAX_ENTRY:
                    raise ValueError("Untrusted Docker archive resource limits exceeded")
                if entry.name in members:
                    raise ValueError("Duplicate Docker archive entry")
                stream = tf.extractfile(entry)
                if stream is None:
                    raise ValueError("Unreadable Docker archive entry")
                members[entry.name] = store(
                    blobs, stream, entry.size,
                    compress=entry.name in layer_names,
                )
        if set(members) != needed:
            raise ValueError("Docker archive is missing required image contents")
        cfg = members[record["Config"]]
        config = json.loads((blobs / cfg["digest"][7:]).read_text())
        if config.get("os") != "linux" or config.get("architecture") != arch:
            raise ValueError(f"Base architecture mismatch: {arch}")
        layers = [members[name] for name in record["Layers"]]
        manifest = {
            "schemaVersion": 2,
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "config": {
                "mediaType": "application/vnd.oci.image.config.v1+json",
                **cfg,
            },
            "layers": [
                {"mediaType": "application/vnd.oci.image.layer.v1.tar+gzip", **entry}
                for entry in layers
            ],
        }
        encoded = json.dumps(manifest, separators=(",", ":")).encode()
        descriptor = store(blobs, __import__("io").BytesIO(encoded), len(encoded))
        index["manifests"].append({
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            **descriptor,
            "platform": {"os": "linux", "architecture": arch},
            "annotations": {"org.opencontainers.image.ref.name": arch},
        })
        print(f"Verified isolated OCI base: linux/{arch}", flush=True)
    (output / "oci-layout").write_text('{"imageLayoutVersion":"1.0.0"}\n')
    (output / "index.json").write_text(json.dumps(index, indent=2) + "\n")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("Usage: docker-release-to-oci.py ASSETS_DIR OUTPUT_DIR TAG")
    convert(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
