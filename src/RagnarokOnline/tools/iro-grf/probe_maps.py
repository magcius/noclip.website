#!/usr/bin/env python3
"""
Bonus: stage a small set of maps for visual inspection.

Given a GRF and a list of map ids, this script:
  1. Extracts each map's .rsw / .gnd / .gat into <out_dir>/data/.
  2. Parses each .rsw to discover the .rsm models it references.
  3. Extracts those .rsm files into <out_dir>/data/model/...
  4. Parses each .rsm to discover the .bmp/.tga textures it references.
  5. Extracts those textures into <out_dir>/data/texture/...

It only does enough of the RSW/RSM parsing to read filenames; full geometry
parsing is left to the actual TS renderer downstream.
"""

from __future__ import annotations

import argparse
import io
import os
import struct
import sys
from typing import Iterable

# Reuse the GRF reader as a library. Both scripts live in the same dir.
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
from read_grf import iter_grf, extract_entry  # type: ignore


def _read_cp949_name(blob: bytes, offset: int, length: int) -> str:
    """Decode a fixed-length, null-terminated CP949 string from blob."""
    chunk = blob[offset:offset + length]
    nul = chunk.find(b"\x00")
    if nul >= 0:
        chunk = chunk[:nul]
    try:
        return chunk.decode("cp949")
    except UnicodeDecodeError:
        return chunk.decode("cp949", errors="replace")


def collect_rsm_names_from_rsw(rsw_bytes: bytes) -> list[str]:
    """Parse a .rsw object table just enough to collect .rsm filenames.

    Mirrors the relevant slice of src/RagnarokOnline/rsw.ts: read header,
    skip the various pre-object sections by version, then walk the object
    table reading OT_MODEL (= 1) entries to pluck modelName[80].
    """

    OT_MODEL, OT_LIGHT, OT_SOUND, OT_EFFECT = 1, 2, 3, 4

    buf = rsw_bytes
    pos = 0

    def u8():
        nonlocal pos
        v = buf[pos]
        pos += 1
        return v

    def i32():
        nonlocal pos
        v = struct.unpack_from("<i", buf, pos)[0]
        pos += 4
        return v

    def f32():
        nonlocal pos
        v = struct.unpack_from("<f", buf, pos)[0]
        pos += 4
        return v

    def name(n):
        nonlocal pos
        s = _read_cp949_name(buf, pos, n)
        pos += n
        return s

    def skip(n):
        nonlocal pos
        pos += n

    magic = buf[0:4]
    if magic != b"GRSW":
        raise ValueError(f"bad RSW magic {magic!r}")
    pos = 4
    major = u8()
    minor = u8()

    def ge(M, m):
        return (major, minor) >= (M, m)

    build_number = 0
    if ge(2, 5):
        build_number = i32()
        skip(1)  # unknown render flag
    elif ge(2, 2):
        build_number = u8()

    ini_file = name(40)
    gnd_file = name(40)
    gat_file = name(40) if ge(1, 4) else ""
    scr_file = name(40)

    # Water plane block (skipped wholesale). RSW 2.6 moved this to GND 1.8/1.9.
    # Mirrors rsw.ts: v1.8 added the {type, waveHeight, waveSpeed, wavePitch}
    # quartet; v1.9 added a trailing waterAnimSpeed i32 on top of that. Reading
    # the trailing i32 unconditionally at v1.8 over-runs by 4 bytes and causes
    # downstream object-table fields (notably RSM model names) to come out as
    # CP949 garbage.
    if not ge(2, 6):
        f32()  # waterLevel (v1.3+)
        if ge(1, 8):
            i32(); f32(); f32(); f32()  # type, waveHeight, waveSpeed, wavePitch
        elif ge(1, 3):
            i32()  # type
        if ge(1, 9):
            i32()  # waterAnimSpeed
    # Light block
    if ge(1, 5):
        i32()  # longitude
        i32()  # latitude
        skip(12)  # diffuse rgb
        skip(12)  # ambient rgb
    if ge(1, 7):
        f32()  # shadow opacity
    if ge(1, 6):
        i32(); i32(); i32(); i32()  # ground top/bottom/left/right

    count = i32()
    if count < 0 or count > 200_000:
        raise ValueError(f"bad RSW object count {count}")

    names: list[str] = []
    for _ in range(count):
        otype = i32()
        if otype == OT_MODEL:
            if ge(1, 3):
                name(40)  # name
                i32()     # animType
                f32()     # animSpeed
                i32()     # blockType
                if major == 2 and minor == 6 and build_number >= 162:
                    skip(1)  # unknown render/collision flag
            model_name = name(80)
            name(80)  # nodeName
            skip(12)  # pos
            skip(12)  # rot
            skip(12)  # scale
            if model_name:
                names.append(model_name)
        elif otype == OT_LIGHT:
            skip(80 + 12 + 12 + 4)
        elif otype == OT_SOUND:
            if major >= 2:
                skip(80 + 80 + 12 + 4 + 4 + 4 + 4 + 4)
            else:
                skip(80 + 80 + 12 + 4 + 4 + 4 + 4)
        elif otype == OT_EFFECT:
            skip(80 + 12 + 4 + 4 + 16)
        else:
            # Unknown tag: bail out, partial result is fine.
            sys.stderr.write(
                f"  rsw: unknown object type {otype} at object {_}, stopping early\n"
            )
            break
    return names


def collect_textures_from_rsm(rsm_bytes: bytes) -> list[str]:
    """Parse a .rsm just enough to pluck the texture-name table.

    Layout (canonical): magic "GRSM", major/minor (u8/u8), then a fixed
    32-byte chunk (anim length, shade type, alpha, reserved), then int32
    textureCount, then textureCount * char[40] (CP949). Newer versions
    differ before the texture list (e.g. v2.x adds version-specific blocks)
    so we tolerate small offsets by scanning around the expected position.
    """

    if rsm_bytes[0:4] != b"GRSM":
        raise ValueError("bad RSM magic")
    major = rsm_bytes[4]
    minor = rsm_bytes[5]

    # Walk the canonical 1.x/2.x prefix. For newer formats the texture list
    # may have moved; in that case we fall through to a heuristic.
    pos = 6
    try:
        if (major, minor) >= (2, 2):
            # 2.2+: anim length (i32), shade type (i32), alpha (u8),
            # frame rate (f32), reserved (16 bytes), textures (i32 count then strings).
            pos += 4 + 4 + 1 + 4 + 16
            count = struct.unpack_from("<i", rsm_bytes, pos)[0]
            pos += 4
        elif (major, minor) >= (1, 4):
            # 1.4+: anim length (i32), shade type (i32), alpha (u8), reserved (16 bytes)
            pos += 4 + 4 + 1 + 16
            count = struct.unpack_from("<i", rsm_bytes, pos)[0]
            pos += 4
        else:
            # 1.0-1.3: anim length (i32), shade type (i32), reserved (16 bytes)
            pos += 4 + 4 + 16
            count = struct.unpack_from("<i", rsm_bytes, pos)[0]
            pos += 4
    except struct.error:
        return []

    if count < 0 or count > 100_000 or pos + count * 40 > len(rsm_bytes):
        # Heuristic fallback: scan for ASCII-ish strings ending in .bmp/.tga
        return _scan_texture_names(rsm_bytes)

    names: list[str] = []
    for _ in range(count):
        names.append(_read_cp949_name(rsm_bytes, pos, 40))
        pos += 40
    if not any(n.lower().endswith((".bmp", ".tga", ".png")) for n in names):
        # The header layout we guessed was wrong; fall back.
        return _scan_texture_names(rsm_bytes)
    return [n for n in names if n]


def _scan_texture_names(rsm_bytes: bytes) -> list[str]:
    """Last-resort: extract ASCII-printable substrings ending in known
    texture extensions. Useful when the RSM version is newer than what
    we know how to walk."""

    out: list[str] = []
    extensions = (b".bmp", b".tga", b".png", b".BMP", b".TGA", b".PNG")
    blob = rsm_bytes
    n = len(blob)
    i = 0
    while i < n:
        for ext in extensions:
            j = blob.find(ext, i)
            if j < 0:
                continue
            # walk back to find string start
            start = j
            while start > 0 and 0x20 <= blob[start - 1] <= 0xFE:
                start -= 1
            cand = blob[start:j + len(ext)]
            try:
                s = cand.decode("cp949")
                if 4 < len(s) <= 256:
                    out.append(s)
            except UnicodeDecodeError:
                pass
            i = j + len(ext)
            break
        else:
            break
    # dedupe, preserve order
    seen = set()
    deduped = []
    for s in out:
        if s in seen:
            continue
        seen.add(s)
        deduped.append(s)
    return deduped


def _write(out_dir: str, archive_path: str, data: bytes) -> str:
    rel = archive_path.replace("\\", "/").lstrip("/")
    target = os.path.normpath(os.path.join(out_dir, rel))
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "wb") as f:
        f.write(data)
    return target


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("grf")
    p.add_argument("out_dir")
    p.add_argument("maps", help="comma-separated list of map ids, e.g. lasagna,dicastes01")
    args = p.parse_args()

    wanted = [m.strip().lower() for m in args.maps.split(",") if m.strip()]
    out_dir = os.path.abspath(args.out_dir)
    os.makedirs(out_dir, exist_ok=True)

    with open(args.grf, "rb") as fh:
        # First pass: build a lookup of paths we may need.
        sys.stderr.write("indexing GRF...\n")
        index: dict[str, object] = {}
        header, entries = iter_grf(fh)
        for e in entries:
            index[e.path.lower()] = e
        sys.stderr.write(f"  indexed {len(index)} entries\n")

        # Per-map extraction.
        wanted_models: set[str] = set()
        wanted_textures: set[str] = set()

        for mid in wanted:
            sys.stderr.write(f"map {mid}:\n")
            for ext in ("rsw", "gnd", "gat"):
                key = f"data\\{mid}.{ext}"
                ent = index.get(key.lower())
                if ent is None:
                    sys.stderr.write(f"  missing {key}\n")
                    continue
                data = extract_entry(fh, ent)
                if data is None:
                    sys.stderr.write(f"  skip {key} (encrypted or corrupt)\n")
                    continue
                _write(out_dir, ent.path, data)
                if ext == "rsw":
                    try:
                        models = collect_rsm_names_from_rsw(data)
                    except Exception as err:
                        sys.stderr.write(f"  rsw parse failed for {mid}: {err}\n")
                        models = []
                    sys.stderr.write(f"  {len(models)} model refs\n")
                    for m in models:
                        if m:
                            wanted_models.add(m)

        # Extract models.
        sys.stderr.write(f"extracting {len(wanted_models)} model files...\n")
        models_written = 0
        for m in sorted(wanted_models):
            # RSW model names are paths relative to data\model\
            key = f"data\\model\\{m}".lower()
            ent = index.get(key)
            if ent is None:
                sys.stderr.write(f"  miss data\\model\\{m}\n")
                continue
            data = extract_entry(fh, ent)
            if data is None:
                continue
            _write(out_dir, ent.path, data)
            models_written += 1
            try:
                texs = collect_textures_from_rsm(data)
                for t in texs:
                    if t:
                        wanted_textures.add(t)
            except Exception as err:
                sys.stderr.write(f"  rsm parse failed for {m}: {err}\n")
        sys.stderr.write(f"  wrote {models_written} models\n")

        # Extract textures.
        sys.stderr.write(f"extracting {len(wanted_textures)} texture files...\n")
        tex_written = 0
        for t in sorted(wanted_textures):
            key = f"data\\texture\\{t}".lower()
            ent = index.get(key)
            if ent is None:
                sys.stderr.write(f"  miss data\\texture\\{t}\n")
                continue
            data = extract_entry(fh, ent)
            if data is None:
                continue
            _write(out_dir, ent.path, data)
            tex_written += 1
        sys.stderr.write(f"  wrote {tex_written} textures\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
