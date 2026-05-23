#!/usr/bin/env python3
"""
GRF reader for Gravity's archive format, with first-class support for the
"Event Horizon" 0x300 variant used by recent iRO clients (2024-10 onward).

The 0x300 variant differs from the long-established 0x200 layout in two
places:

  * The 46-byte header reinterprets the four bytes that used to hold a 32-bit
    "Seed" + the high half of the file-table offset as a single 64-bit
    file-table offset. The guard is "bytes 35..37 are all zero AND the version
    is 3.0"; otherwise the same byte range is read as the legacy uint32
    offset + int32 seed.
  * Each file-table record carries an Int64 data offset instead of UInt32,
    so the entry stride grows from 17 to 21 bytes.

Everything else (zlib-compressed file table at the offset, per-entry
filename / sizes / flags layout, CP949 filenames, slash normalisation) is
shared with 0x200.

This is a clean Python reimplementation against the open-source GRF Editor
reference (Tokeiburu/GRFEditor). It only handles the read path required to
enumerate (and optionally extract) files; it does not implement the legacy
0x100 / Alpha branches or any of the encrypted-file-table code paths.

Usage
-----
  ./read_grf.py list <path.grf>                    # one filename per line
  ./read_grf.py info <path.grf>                    # header summary + counts
  ./read_grf.py grep <path.grf> <regex>            # filter list by regex
  ./read_grf.py extract <path.grf> <out_dir> <regex>
                                                   # extract matches into out_dir,
                                                   # preserving the in-archive
                                                   # directory layout

Filenames are written as UTF-8 (decoded from CP949) with backslashes
normalised to forward slashes for the extracted-file layout.
"""

from __future__ import annotations

import argparse
import os
import re
import struct
import sys
import zlib
from dataclasses import dataclass
from typing import Iterator, Optional


HEADER_SIZE = 46
MAGIC_EXPECTED = b"Master of Magic\x00"  # legacy magic
MAGIC_EVENT_HORIZON = b"Event Horizon\x00"  # 0x300 marker seen in modern clients

# Bit flags lifted from the GRF Editor EntryType enum (re-expressed in plain
# Python). Names mirror upstream so the code stays grep-able against the C#
# reference, but the values are the canonical bit positions.
FLAG_FILE = 1 << 0
FLAG_HEADER_CRYPTED = 1 << 1
FLAG_DATA_CRYPTED = 1 << 2
FLAG_REMOVE = 1 << 4
FLAG_GRAVITY_ENCRYPTED = 1 << 7


@dataclass
class GrfHeader:
    magic: bytes
    key: bytes
    file_table_offset: int
    real_files_count: int
    major: int
    minor: int

    @property
    def version_tuple(self) -> tuple[int, int]:
        return (self.major, self.minor)


@dataclass
class GrfEntry:
    """One record from the inflated file table."""

    path: str            # CP949-decoded, backslash-normalised in-archive path
    size_compressed: int
    size_aligned: int    # on-disk size (padded to 8 byte boundary for AES)
    size_decompressed: int
    flags: int
    data_offset: int     # absolute byte offset within the GRF file

    @property
    def is_directory(self) -> bool:
        return self.flags == 0  # EntryType.Directory == 0

    @property
    def is_gravity_encrypted(self) -> bool:
        return bool(self.flags & FLAG_GRAVITY_ENCRYPTED)

    @property
    def is_header_crypted(self) -> bool:
        return bool(self.flags & FLAG_HEADER_CRYPTED)

    @property
    def is_data_crypted(self) -> bool:
        return bool(self.flags & FLAG_DATA_CRYPTED)


# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------

def _read_header(fh) -> GrfHeader:
    fh.seek(0)
    raw = fh.read(HEADER_SIZE)
    if len(raw) != HEADER_SIZE:
        raise ValueError(f"GRF too short to contain a header ({len(raw)} bytes)")

    magic = raw[0:16]
    key = raw[16:30]
    version = struct.unpack_from("<I", raw, 42)[0]
    major = (version >> 8) & 0xFF
    minor = version & 0xFF

    # The 0x300 "Event Horizon" branch: file-table offset becomes Int64 at
    # byte 30, file-count is Int32 at byte 38. The guard upstream uses bytes
    # 35..37 == 0 to confirm we really are looking at a 64-bit offset and
    # not a legacy 0x300 from before the Oct-2024 extension.
    if (major, minor) == (3, 0) and raw[35] == 0 and raw[36] == 0 and raw[37] == 0:
        file_table_offset = struct.unpack_from("<q", raw, 30)[0]
        real_files_count = struct.unpack_from("<i", raw, 38)[0]
    else:
        file_table_offset = struct.unpack_from("<I", raw, 30)[0]
        seed = struct.unpack_from("<i", raw, 34)[0]
        raw_count = struct.unpack_from("<i", raw, 38)[0]
        real_files_count = raw_count - seed - 7

    if magic not in (MAGIC_EXPECTED, MAGIC_EVENT_HORIZON):
        # We do not bail out: keep the original magic available so callers can
        # decide what to do (the read path itself only needs the offset/count).
        sys.stderr.write(
            f"warning: unexpected magic {magic!r}; continuing anyway\n"
        )

    return GrfHeader(
        magic=magic,
        key=key,
        file_table_offset=file_table_offset,
        real_files_count=real_files_count,
        major=major,
        minor=minor,
    )


# ---------------------------------------------------------------------------
# File table
# ---------------------------------------------------------------------------

def _read_file_table_blob(fh, header: GrfHeader) -> bytes:
    """Seek to the file table, read & inflate it. Returns the raw record blob.

    Note: file_table_offset is stored relative to the end of the 46-byte
    header, matching the convention used for per-entry data offsets.
    """

    fh.seek(header.file_table_offset + HEADER_SIZE)

    if header.version_tuple == (3, 0):
        # 0x300 prefixes the (compressed_size, uncompressed_size) pair with
        # a 4-byte field that has been zero in every sample observed so far.
        leading = fh.read(4)
        if len(leading) != 4:
            raise ValueError("Truncated GRF at file-table leading word")

    size_header = fh.read(8)
    if len(size_header) != 8:
        raise ValueError("Truncated GRF at file-table size header")

    compressed_size, uncompressed_size = struct.unpack("<ii", size_header)
    if compressed_size <= 0 or uncompressed_size <= 0:
        raise ValueError(
            f"Invalid file-table sizes: compressed={compressed_size} "
            f"uncompressed={uncompressed_size}"
        )

    compressed = fh.read(compressed_size)
    if len(compressed) != compressed_size:
        raise ValueError(
            f"Truncated GRF: wanted {compressed_size} compressed bytes, got {len(compressed)}"
        )

    # We use a decompressobj so a corrupt or over-long stream gets bounded to
    # the advertised uncompressed_size.
    dec = zlib.decompressobj()
    blob = dec.decompress(compressed, uncompressed_size)
    blob += dec.flush()
    if len(blob) != uncompressed_size:
        sys.stderr.write(
            f"warning: inflated file table is {len(blob)} bytes, "
            f"expected {uncompressed_size}\n"
        )
    return blob


def _iter_entries(blob: bytes, header: GrfHeader) -> Iterator[GrfEntry]:
    """Walk the inflated table, yielding one GrfEntry per record.

    Per-entry layout (version 0x300):
        - filename, null-terminated, CP949
        - int32  size_compressed
        - int32  size_aligned
        - int32  size_decompressed
        - uint8  flags
        - int64  data_offset (relative to header end; we add HEADER_SIZE)

    For 0x200, the trailing offset is uint32 (so the post-name stride is 17
    bytes instead of 21). Everything else is identical.
    """

    stride_after_name = 21 if header.version_tuple == (3, 0) else 17
    pos = 0
    length = len(blob)

    while pos < length:
        # Find the null terminator that ends the filename.
        nul = blob.find(b"\x00", pos)
        if nul < 0:
            raise ValueError(f"Unterminated filename starting at offset {pos}")

        name_raw = blob[pos:nul]
        try:
            path = name_raw.decode("cp949")
        except UnicodeDecodeError:
            path = name_raw.decode("cp949", errors="replace")
        path = path.replace("/", "\\")

        pos = nul + 1
        if pos + stride_after_name > length:
            raise ValueError(
                f"Truncated entry record for {path!r}: "
                f"need {stride_after_name} bytes, have {length - pos}"
            )

        size_compressed = struct.unpack_from("<i", blob, pos)[0]
        size_aligned = struct.unpack_from("<i", blob, pos + 4)[0]
        size_decompressed = struct.unpack_from("<i", blob, pos + 8)[0]
        flags = blob[pos + 12]

        if header.version_tuple == (3, 0):
            data_offset_rel = struct.unpack_from("<q", blob, pos + 13)[0]
        else:
            data_offset_rel = struct.unpack_from("<I", blob, pos + 13)[0]

        pos += stride_after_name

        yield GrfEntry(
            path=path,
            size_compressed=size_compressed,
            size_aligned=size_aligned,
            size_decompressed=size_decompressed,
            flags=flags,
            data_offset=data_offset_rel + HEADER_SIZE,
        )


def iter_grf(fh) -> tuple[GrfHeader, Iterator[GrfEntry]]:
    header = _read_header(fh)
    blob = _read_file_table_blob(fh, header)
    return header, _iter_entries(blob, header)


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

def extract_entry(fh, entry: GrfEntry) -> Optional[bytes]:
    """Read & inflate one entry's content.

    Returns None and logs a warning for entries we cannot handle (Gravity
    encryption, header/data DES-style scrambling, zero-size files).
    """

    if entry.is_directory:
        return None
    if entry.size_aligned == 0 or entry.size_decompressed == 0:
        return b""

    if entry.is_gravity_encrypted:
        sys.stderr.write(f"skip (gravity-encrypted): {entry.path}\n")
        return None
    if entry.is_header_crypted or entry.is_data_crypted:
        sys.stderr.write(f"skip (DES-style scrambled, flags=0x{entry.flags:02x}): {entry.path}\n")
        return None

    fh.seek(entry.data_offset)
    payload = fh.read(entry.size_compressed)
    if len(payload) != entry.size_compressed:
        sys.stderr.write(
            f"skip (short read for {entry.path}: wanted {entry.size_compressed}, got {len(payload)})\n"
        )
        return None

    try:
        data = zlib.decompress(payload, bufsize=max(entry.size_decompressed, 1))
    except zlib.error as err:
        sys.stderr.write(f"skip ({entry.path}: zlib error {err})\n")
        return None
    return data


def _safe_outpath(out_dir: str, archive_path: str) -> str:
    # The archive path uses backslashes; normalise to native separators and
    # strip any leading slash that would escape out_dir.
    rel = archive_path.replace("\\", "/").lstrip("/")
    full = os.path.normpath(os.path.join(out_dir, rel))
    if not full.startswith(os.path.abspath(out_dir) + os.sep) and full != os.path.abspath(out_dir):
        # Path traversal guard. Should not happen with well-formed GRFs but
        # we are not trusting attacker-controlled data here.
        raise ValueError(f"refusing to write outside out_dir: {archive_path}")
    return full


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def cmd_info(args: argparse.Namespace) -> int:
    with open(args.grf, "rb") as fh:
        header, entries = iter_grf(fh)
        total = 0
        ext_counts: dict[str, int] = {}
        for entry in entries:
            total += 1
            ext = os.path.splitext(entry.path.lower())[1]
            ext_counts[ext] = ext_counts.get(ext, 0) + 1
    print(f"magic                  : {header.magic!r}")
    print(f"key                    : {header.key!r}")
    print(f"version                : {header.major}.{header.minor}")
    print(f"file_table_offset      : {header.file_table_offset} (0x{header.file_table_offset:x})")
    print(f"header.real_files_count: {header.real_files_count}")
    print(f"entries iterated       : {total}")
    print("top extensions:")
    for ext, count in sorted(ext_counts.items(), key=lambda kv: -kv[1])[:20]:
        print(f"  {ext or '<none>':<10s} {count}")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    with open(args.grf, "rb") as fh:
        _, entries = iter_grf(fh)
        out = sys.stdout
        for entry in entries:
            if entry.is_directory:
                continue
            out.write(entry.path + "\n")
    return 0


def cmd_grep(args: argparse.Namespace) -> int:
    pattern = re.compile(args.pattern, re.IGNORECASE)
    with open(args.grf, "rb") as fh:
        _, entries = iter_grf(fh)
        for entry in entries:
            if entry.is_directory:
                continue
            if pattern.search(entry.path):
                sys.stdout.write(entry.path + "\n")
    return 0


def cmd_extract(args: argparse.Namespace) -> int:
    pattern = re.compile(args.pattern, re.IGNORECASE)
    out_dir = os.path.abspath(args.out_dir)
    os.makedirs(out_dir, exist_ok=True)
    written = 0
    skipped = 0
    with open(args.grf, "rb") as fh:
        header, entries = iter_grf(fh)
        for entry in entries:
            if entry.is_directory:
                continue
            if not pattern.search(entry.path):
                continue
            data = extract_entry(fh, entry)
            if data is None:
                skipped += 1
                continue
            target = _safe_outpath(out_dir, entry.path)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as out:
                out.write(data)
            written += 1
            if written % 200 == 0:
                sys.stderr.write(f"  wrote {written} files...\n")
    sys.stderr.write(f"done: wrote {written}, skipped {skipped}\n")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Read Gravity GRF archives (0x200 + 0x300).")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_info = sub.add_parser("info", help="Print header summary + extension breakdown")
    p_info.add_argument("grf")
    p_info.set_defaults(func=cmd_info)

    p_list = sub.add_parser("list", help="Print one filename per line")
    p_list.add_argument("grf")
    p_list.set_defaults(func=cmd_list)

    p_grep = sub.add_parser("grep", help="Filter filenames by case-insensitive regex")
    p_grep.add_argument("grf")
    p_grep.add_argument("pattern")
    p_grep.set_defaults(func=cmd_grep)

    p_extract = sub.add_parser("extract", help="Extract files matching a regex into out_dir")
    p_extract.add_argument("grf")
    p_extract.add_argument("out_dir")
    p_extract.add_argument("pattern")
    p_extract.set_defaults(func=cmd_extract)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
