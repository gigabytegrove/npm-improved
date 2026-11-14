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


def tar_header_valid(header):
    """Validate the TAR header checksum; do not rely on file extensions."""
    if len(header) < 512:
        return False
    if header == bytes(512):
        return True
    try:
        checksum = int(header[148:156].strip(b" \\x00"), 8)
    except ValueError:
        return False
    return checksum == sum(header[:148]) + 8 * 32 + sum(header[156:512])


def store(blobs, stream, size, compress=False, expected_diff_id=None):
    """Copy Docker archive entry to OCI without double-compressing gzip layers.

    Verify the *decompressed* layer SHA-256 against rootfs.diff_ids in the
    Docker image config. Reject malformed layers before BuildKit sees them.
    """
    if size > MAX_ENTRY:
        raise ValueError("Docker archive member exceeds size limit")
    first = stream.read(min(512, size))
    remaining = size - len(first)
    is_layer = expected_diff_id is not None
    already_gzip = is_layer and first.startswith(b"\\x1f\\x8b\\x08")
    if is_layer and first.startswith(b"\\x28\\xb5\\x2f\\xfd"):
        raise ValueError("Unsupported zstd Docker layer: refusing to mislabel as gzip")
    if is_layer and not already_gzip and not tar_header_valid(first):
        raise ValueError("Source Docker layer has an invalid tar header")
    compressor = zlib.compressobj(level=1, wbits=31) if is_layer and not already_gzip else None
    decompressor = zlib.decompressobj(wbits=31) if already_gzip else None
    written_digest = hashlib.sha256()
    plain_digest = hashlib.sha256()
    first_plain = bytearray()
    written = 0
    with tempfile.NamedTemporaryFile(dir=blobs, prefix=".npmi-", delete=False) as tmp:
        path = Path(tmp.name)
        try:
            pending = [first]
            while pending or remaining:
                if pending:
                    data = pending.pop()
                else:
                    data = stream.read(min(1024 * 1024, remaining))
                    if not data:
                        raise ValueError("Truncated Docker image archive")
                    remaining -= len(data)
                plain = decompressor.decompress(data) if decompressor else data
                if is_layer:
                    plain_digest.update(plain)
                    if len(first_plain) < 512:
                        first_plain.extend(plain[:512 - len(first_plain)])
                encoded = compressor.compress(data) if compressor else data
                if encoded:
                    tmp.write(encoded)
                    written_digest.update(encoded)
                    written += len(encoded)
            if compressor:
                encoded = compressor.flush()
                if encoded:
                    tmp.write(encoded)
                    written_digest.update(encoded)
                    written += len(encoded)
            if decompressor and not decompressor.eof:
                raise ValueError("Truncated gzip-compressed Docker layer")
            if is_layer:
                if not tar_header_valid(first_plain):
                    raise ValueError("Decompressed Docker layer is not a valid tar archive")
                if "sha256:" + plain_digest.hexdigest() != expected_diff_id:
                    raise ValueError("Docker layer does not match image config rootfs.diff_ids")
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    blob = blobs / written_digest.hexdigest()
    if blob.is_file():
        path.unlink()
    else:
        os.replace(path, blob)
    return {"digest": "sha256:" + written_digest.hexdigest(), "size": written}


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
        with tarfile.open(source, mode="r:gz") as archive:
            config_stream = archive.extractfile(record["Config"])
            if config_stream is None:
                raise ValueError("Docker image is missing its referenced config")
            config = json.load(config_stream)
        diff_ids = (config.get("rootfs") or {}).get("diff_ids", [])
        if len(diff_ids) != len(record["Layers"]):
            raise ValueError("Docker image layer count does not match rootfs.diff_ids")
        layer_diff_ids = dict(zip(record["Layers"], diff_ids))
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
                    expected_diff_id=layer_diff_ids.get(entry.name),
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
