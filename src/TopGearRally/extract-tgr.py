#!/usr/bin/env python
from __future__ import annotations

from pathlib import Path
import argparse
import hashlib
import logging
import struct
import sys
import zlib

log = logging.getLogger(__name__)

TRACK_ROM_OFFSETS = {
    0: 0x211C10,
    1: 0x300500,
    2: 0x3D3050,
    3: 0x551180,
    4: 0x65C140,
    10: 0x7D1240,
}
POINTER_BASE = 0x80025C00
TGR3_MAGIC = 0x33524754
ROM_SHA256 = 'af2ac2550273fa340d84e3674a2d3c60a921a47b5dbf19662fe006c379fafc40'
ROM_NONE = 0xFFFFFFFF
TEXTURE_FORMAT_CI4 = 1
TEXTURE_STRIDE = 0x24
FRAME_STRIDE = 12
CI4_PALETTE_BYTES = 0x20
PALETTE_BYTES = 0x200
PARTICLE_TEXTURE_ROM = 0xA4790
PARTICLE_TEXTURE_BYTES = 64 * 64
RAW_ASSETS = {
    'font_large.ia8': (0x90E00, 704 * 80),
    'font_small.ia8': (0x9EA00, 392 * 40),
    'font_tables.bin': (0xA2740, 0x60 + 0xDC + 0xEC),
    'font_gradients.bin': (0x8CDF0, 4 * 0x140),
    'data_segment.bin': (0x60000, 0x50000),
    'dashboards.bin': (0xE0900, 0xB700),
    'start_lights.bin': (0x1CB410, 0x1D9CF0 - 0x1CB410),
}
COMPRESSED_ASSETS = (
    0x1DA030,
    0x1DBA40,
    0x1DCD70,
    0x1E09F0,
    0x1E3DB0,
    0x1E2B40,
    0x1E1CA0,
    0x202950,
    0x203BE0,
    0x204F60,
    0x205FD0,
    0x206310,
    0x1F60A0,
    0x207CA0,
    0x1C07C0,
    0xDADE0,
    0x1C77A0,
    0x1C79B0,
    0xAEE40,
    0xB2BE0,
    0xB6D40,
    0xBAEF0,
    0xBEBB0,
    0xC2DC0,
    0xC6900,
    0xCA3E0,
    0xCDF60,
    0xD1810,
    0xD4A80,
    0xD8490,
    0xD9160,
    0xAD400,
    0xAD740,
    0xADB00,
)
TRACK_DESCRIPTORS = 0x71854
TRACK_DESCRIPTOR_STRIDE = 0x17C
SECTION_HEADER_SIZE = 0x20


def r32(d: bytes, o: int) -> int:
    return int(struct.unpack_from('>I', d, o)[0])


def r16(d: bytes, o: int) -> int:
    return int(struct.unpack_from('>H', d, o)[0])


def decompress_track(rom: bytes, offset: int) -> tuple[bytes, int]:
    size = r32(rom, offset + 4)
    pos = offset + 8
    out = bytearray()
    while len(out) < size:
        chunk = r32(rom, pos)
        pos += 4
        out += zlib.decompress(rom[pos : pos + chunk])
        pos += chunk
        pos += pos & 1
    return bytes(out[:size]), r32(rom, offset) + offset


def stream_extent(td: bytes) -> int:
    extent = 0
    table = r32(td, 0x1C) - POINTER_BASE
    for i in range(r32(td, 0x18)):
        o = table + i * TEXTURE_STRIDE
        if r32(td, o) == 0:
            continue
        bits = r32(td, o + 0x20)
        fmt = (bits >> 24) & 0xF
        size = bits & 0x3FFFF
        pal_size = CI4_PALETTE_BYTES if fmt == TEXTURE_FORMAT_CI4 else PALETTE_BYTES
        source = r32(td, o + 8)
        if not bits & (1 << 20):
            if r32(td, o + 4):
                extent = max(extent, ((source & 0xFFF) << 5) + pal_size)
            continue
        anim = source - POINTER_BASE
        for k in range(r16(td, anim + 2)):
            _, image, palette = struct.unpack_from('>III', td, anim + 8 + k * FRAME_STRIDE)
            if image != ROM_NONE:
                extent = max(extent, image + size)
            if palette != ROM_NONE:
                extent = max(extent, palette + pal_size)
    return extent


def main() -> int:
    parser = argparse.ArgumentParser(description='Export Top Gear Rally tracks for noclip.website.')
    parser.add_argument('rom', type=Path, help='Path to the USA N64 ROM (z64).')
    parser.add_argument(
        'output_dir',
        nargs='?',
        default=Path(__file__).resolve().parents[2] / 'data' / 'TopGearRally',
        type=Path,
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    rom = args.rom.read_bytes()
    if hashlib.sha256(rom).hexdigest() != ROM_SHA256:
        log.error('ROM SHA-256 mismatch.')
        return 1
    args.output_dir.mkdir(parents=True, exist_ok=True)
    particle = args.output_dir / 'particle.i8'
    particle.write_bytes(rom[PARTICLE_TEXTURE_ROM : PARTICLE_TEXTURE_ROM + PARTICLE_TEXTURE_BYTES])
    log.info('%s: particle texture', particle)
    for name, (offset, size) in RAW_ASSETS.items():
        (args.output_dir / name).write_bytes(rom[offset : offset + size])
    for offset in COMPRESSED_ASSETS:
        asset, _ = decompress_track(rom, offset)
        (args.output_dir / f'asset_{offset:06x}.bin').write_bytes(asset)
    for track, offset in sorted(TRACK_ROM_OFFSETS.items()):
        descriptor = TRACK_DESCRIPTORS + track * TRACK_DESCRIPTOR_STRIDE
        sections = bytearray()
        for section_rom in (r32(rom, descriptor + 0x1C), r32(rom, descriptor + 0x24)):
            data, _ = decompress_track(rom, section_rom + SECTION_HEADER_SIZE)
            sections += rom[section_rom : section_rom + SECTION_HEADER_SIZE] + data
        (args.output_dir / f'sections_{track}.bin').write_bytes(sections)
        td, stream_start = decompress_track(rom, offset)
        stream = rom[stream_start : stream_start + stream_extent(td)]
        out = struct.pack('<4I', TGR3_MAGIC, POINTER_BASE, len(td), len(stream)) + td + stream
        path = args.output_dir / f'track_{track}.tgr'
        path.write_bytes(out)
        log.info('%s: track 0x%x bytes, stream 0x%x bytes', path, len(td), len(stream))
    return 0


if __name__ == '__main__':
    sys.exit(main())
