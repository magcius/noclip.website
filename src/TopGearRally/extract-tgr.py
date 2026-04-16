#!/usr/bin/env python
"""
Export Top Gear Rally track data for noclip.website.

Extracts and decompresses track geometry from the USA N64 ROM, patches streaming palette/texture
data, flips the START banner texture, and outputs TGR2 files with dual summer/winter palette
support.

Output: data/TopGearRally/track_*.bin (TGR2 format)

Usage:
  export_noclip_tracks.py [ROM_FILE] [OUTPUT_DIR]
"""

from __future__ import annotations

from enum import IntEnum
from pathlib import Path
from typing import TYPE_CHECKING, Any, NamedTuple, cast
import argparse
import hashlib
import logging
import operator
import struct
import sys
import zlib

if TYPE_CHECKING:
    from collections.abc import Iterator, Sequence

log = logging.getLogger(__name__)
ne = operator.ne


def _find_git_root() -> Path:
    # Walk up from the script directory to find the git repository root.
    d = Path(__file__).resolve().parent
    for p in d.parents:
        if (p / '.git').exists():
            return p
    msg = 'Could not find .git root.'
    raise RuntimeError(msg)


NOCLIP_ROOT = _find_git_root()
"""Root directory of the noclip repository. Used to locate the ROM and output directory."""
DEFAULT_OUTPUT_DIR = NOCLIP_ROOT / 'data' / 'TopGearRally'
"""Directory where exported track data will be saved (relative to repository root)."""
DEFAULT_ROM_PATH = NOCLIP_ROOT.parent / 'usa.z64'
"""Default Path to the Top Gear Rally ROM file."""
TRACK_ROM_OFFSETS = {
    0: 0x211C10,  # Desert
    1: 0x300500,  # Mountain
    2: 0x3D3050,  # Coastline
    3: 0x551180,  # Mine
    4: 0x65C140,  # Amazon
    10: 0x7D1240,  # Season Winner (gamewin)
}
"""
Track index -> ROM geometry offset (points to compressed chunk list).

Geometry offset points to: [word0=total_comp_size] [decomp_size] [chunk_size, zlib, ...]
"""
POINTER_BASE = 0x80025C00
"""Base address for pointers within track data (DRAM address corresponding to ``td[0]``)."""
TGR2_MAGIC = 0x32524754
"""Magic number for TGR2 files ("TGR2" in ASCII)."""
TGR2_HEADER_SIZE = 0x30  # 48 bytes
"""Size of TGR2 header before track data starts."""
IMG_FMT_CI = 2
"""CI4 image format identifier in the N64 RDP."""
TRACK_COASTLINE = 2
"""Coastline track index."""
BANNER_HALVES = 2
"""Number of texture halves in a standard START banner."""
MIN_KEYFRAMES = 2
"""Minimum keyframe count for an animated channel."""
WEATHER_SWAP_SENTINEL = 0xFFFFFFFF
"""Weather-swap sentinel: time_flags[0] value indicating a weather-swap channel."""
ROM_SHA256 = 'af2ac2550273fa340d84e3674a2d3c60a921a47b5dbf19662fe006c379fafc40'
"""Expected SHA-256 digest of the Top Gear Rally (USA) ROM."""
MIN_MIP_DIM = 2
"""Minimum mipmap dimension before stopping mip chain."""


class DLCommand(IntEnum):
    """N64 F3DEX display list command opcodes."""

    ENDDL = 0xB8
    """End of display list."""
    DL_BRANCH = 0x06
    """Branch to another display list."""
    SETTIMG = 0xFD
    """Set texture image source address."""
    SETTILE = 0xF5
    """Set tile descriptor."""
    LOADBLOCK = 0xF3
    """Load texture block into TMEM."""
    SETTILESIZE = 0xF2
    """Set tile size parameters."""
    TRI1 = 0xBF
    """Draw one triangle."""
    TRI2 = 0xB1
    """Draw two triangles."""


class BannerTexEntry(NamedTuple):
    """A single banner texture entry with address, dimensions, and format."""

    addr: int
    """Byte offset within track data where the texture is located."""
    width: int
    """Width of the texture in pixels."""
    height: int
    """Height of the texture in pixels."""
    fmt: str = 'ci4'
    """Image format, e.g. 'ci4' or 'ia8'."""
    row_pitch: int | None = None
    """Row pitch in bytes for the texture data. If ``None``, defaults to width (no padding)."""


def decompress_track(rom: bytes, geom_offset: int) -> tuple[bytes, int]:
    """
    Decompress track geometry data from ROM.

    Format at ``geom_offset``:
      ``+0x00``: u32 BE - total size of first compressed chunk region
      ``+0x04``: u32 BE - decompressed size
      ``+0x08``: [u32 BE chunk_comp_size, zlib_data[chunk_comp_size], ...]
                 (chunks are 2-byte aligned)

    Returns (decompressed_data, stream_end_offset).
    ``stream_end_offset`` = ``word0`` + ``geom_offset`` (for palette streaming).

    Parameters
    ----------
    rom : bytes
        The full ROM data.
    geom_offset : int
        The byte offset within the ROM where the track geometry data starts.

    Returns
    -------
    tuple[bytes, int]
        A tuple containing:
        - decompressed_data: The full decompressed track data as bytes.
        - stream_end_offset: The byte offset in the ROM where the compressed chunk region ends
          (used as the base address for streaming palette/texture data).
    """
    word0 = struct.unpack_from('>I', rom, geom_offset)[0]
    decomp_size = struct.unpack_from('>I', rom, geom_offset + 4)[0]
    stream_end = word0 + geom_offset
    log.debug(
        'Decompressing from ROM 0x%06x, expected %d bytes, stream_end=0x%06x.',
        geom_offset,
        decomp_size,
        stream_end,
    )
    result = bytearray()
    pos = geom_offset + 8
    n_chunks = 0
    while len(result) < decomp_size:
        if pos + 4 > len(rom):
            break
        chunk_comp_size = struct.unpack_from('>I', rom, pos)[0]
        pos += 4
        if chunk_comp_size == 0:
            break
        chunk_data = rom[pos : pos + chunk_comp_size]
        try:
            result.extend(zlib.decompress(chunk_data))
        except zlib.error:
            log.debug('zlib error at chunk %d (ROM 0x%06x).', n_chunks, pos)
            break
        pos += chunk_comp_size
        n_chunks += 1
        # Chunks are 2-byte aligned.
        if pos & 1:
            pos += 1
    if len(result) < decomp_size:
        log.debug(
            'Partial decompression: got %d/%d bytes (%d chunks).',
            len(result),
            decomp_size,
            n_chunks,
        )
    else:
        log.debug('Decompressed %d chunks.', n_chunks)
    return bytes(result[:decomp_size]), stream_end


def r32(d: bytes | bytearray, o: int) -> int:
    """Read a big-endian u32 from data at offset."""
    return cast('int', struct.unpack_from('>I', d, o)[0])


def r16(d: bytes | bytearray, o: int) -> int:
    """Read a big-endian u16 from data at offset."""
    return cast('int', struct.unpack_from('>H', d, o)[0])


def r32s(d: bytes | bytearray, o: int) -> int:
    """Read a big-endian signed u32 from data at offset."""
    return cast('int', struct.unpack_from('>i', d, o)[0])


def extract_animated_textures(
    td: bytes | bytearray, pb: int, ds: int, rom: bytes, stream_end: int
) -> list[dict[str, Any]]:
    """
    Extract animated texture channels with multiple keyframes.

    Returns a list of dicts:

    .. code-block:: python
      {
          'dest_offset': int,  # byte offset within track data where texture goes
          'tex_size': int,  # size of each keyframe texture in bytes
          'keyframes': [  # list of keyframe entries
              {
                  'time': int,  # time value (frame-based counter)
                  'tex_data': bytes,  # raw texture data from ROM
              },
              ...,
          ],
      }

    Parameters
    ----------
    td : bytes | bytearray
        The track data.
    pb : int
        The pointer base address for the track data (DRAM address corresponding to ``td[0]``).
    ds : int
        The size of the track data in bytes.
    rom : bytes
        The full ROM data, used to read the texture data for each keyframe.
    stream_end : int
        The byte offset in the ROM where the compressed chunk region ends (base address for
        streaming palette/texture data).

    Returns
    -------
    list[dict[str, Any]]
        A list of animated texture channels with their keyframes and texture data.
    """
    nch = r32(td, 0x18)
    ctp = r32(td, 0x1C)
    ct_off = ctp - pb
    log.debug('Scanning %d streaming channels for animated textures.', nch)
    channels = []
    for ci in range(nch):
        c = ct_off + ci * 0x24
        if c + 0x24 > ds:
            break
        flags = r32(td, c + 0x20)
        if not (flags & (1 << 20)):
            continue
        dest0 = r32(td, c)
        kf_ptr = r32(td, c + 8)
        if kf_ptr < pb or kf_ptr >= pb + ds:
            continue
        kf_off = kf_ptr - pb
        if kf_off + 8 > ds:
            continue
        n_kf = r16(td, kf_off + 2)
        if n_kf < MIN_KEYFRAMES:
            continue
        kf0 = kf_off + 8
        if kf0 + 12 > ds:
            continue
        # Skip weather-swap channels.
        if n_kf == MIN_KEYFRAMES and r32(td, kf0) == WEATHER_SWAP_SENTINEL:
            continue
        primary_size = flags & 0x3FFFF
        if primary_size == 0 or dest0 < pb or dest0 >= pb + ds:
            continue
        dest_offset = dest0 - pb
        if dest_offset + primary_size > ds:
            continue
        keyframes = []
        for ki in range(n_kf):
            kf = kf_off + 8 + ki * 12
            if kf + 12 > ds:
                break
            time_val = r32(td, kf)
            tex_rom = r32s(td, kf + 4)
            if tex_rom < 0:
                continue
            src = stream_end + tex_rom
            if src + primary_size > len(rom):
                continue
            keyframes.append({
                'time': time_val,
                'tex_data': rom[src : src + primary_size],
            })
        if len(keyframes) >= MIN_KEYFRAMES:
            log.debug(
                '  Ch%d: %d keyframes, dest=0x%06x, size=0x%x.',
                ci,
                len(keyframes),
                dest_offset,
                primary_size,
            )
            channels.append({
                'dest_offset': dest_offset,
                'tex_size': primary_size,
                'keyframes': keyframes,
            })
    log.debug('Found %d animated texture channels.', len(channels))
    return channels


def _patch_static_palettes(
    td: bytes | bytearray,
    pb: int,
    ds: int,
    rom: bytes,
    stream_end: int,
    nch: int,
    ct_off: int,
    summer_td: bytearray,
    winter_td: bytearray,
) -> int:
    # Patch static palette channels (bit20=0, type=1) into summer and winter track data.
    log.debug('Pass 1: Patching static palette channels.')
    n_static = 0
    for ci in range(nch):
        c = ct_off + ci * 0x24
        if c + 0x24 > len(td):
            break
        dest1 = r32(td, c + 4)
        if dest1 == 0 or dest1 < pb or dest1 >= pb + ds:
            continue
        ch2 = r32(td, c + 8)
        flags = r32(td, c + 0x20)
        if ne((flags >> 24) & 0xF, 1):
            continue
        if flags & (1 << 20):
            continue
        src = stream_end + (ch2 & 0xFFF) * 32
        d = dest1 - pb
        if src + 32 > len(rom) or d + 32 > ds:
            continue
        pal = rom[src : src + 32]
        summer_td[d : d + 32] = pal
        winter_td[d : d + 32] = pal
        n_static += 1
    log.debug('  Patched %d static palette channels.', n_static)
    return n_static


def _patch_static_textures(
    td: bytes | bytearray,
    pb: int,
    ds: int,
    rom: bytes,
    stream_end: int,
    nch: int,
    ct_off: int,
    summer_td: bytearray,
    winter_td: bytearray,
) -> int:
    # Patch static texture channels (bit20=0, type!=1) with non-zero ROM offset.
    log.debug('Pass 1b: Patching static texture channels.')
    n_static_tex = 0
    for ci in range(nch):
        c = ct_off + ci * 0x24
        if c + 0x24 > len(td):
            break
        flags = r32(td, c + 0x20)
        if flags & (1 << 20):
            continue  # skip animated
        fmt_type = (flags >> 24) & 0xF
        if fmt_type == 1:
            continue  # skip palette-only (handled in Pass 1)
        primary_size = flags & 0x3FFFF
        if primary_size == 0:
            continue
        dest0 = r32(td, c)
        if dest0 == 0 or dest0 < pb or dest0 >= pb + ds:
            continue
        ch2 = r32(td, c + 8)
        rom_off_unit = ch2 & 0xFFF
        if rom_off_unit == 0:
            continue  # no ROM data to load — already correct from decompression.
        rom_off = rom_off_unit * 32
        src = stream_end + rom_off
        d = dest0 - pb
        if src + primary_size > len(rom) or d + primary_size > ds:
            continue
        tex = rom[src : src + primary_size]
        summer_td[d : d + primary_size] = tex
        winter_td[d : d + primary_size] = tex
        log.debug('  Ch%d: static tex 0x%x bytes -> 0x%08x.', ci, primary_size, dest0)
        n_static_tex += 1
    log.debug('  Patched %d static texture channels.', n_static_tex)
    return n_static_tex


def _patch_weather_swap_channel(
    td: bytes | bytearray,
    pb: int,
    ds: int,
    rom: bytes,
    stream_end: int,
    dest0: int,
    dest1: int,
    kf0: int,
    primary_size: int,
    pal_size: int,
    summer_td: bytearray,
    winter_td: bytearray,
) -> None:
    # Patch a single weather-swap animated channel into summer/winter data.
    kf1 = kf0 + 12
    if kf1 + 12 > len(td):
        return
    # Summer palette from KF1.
    summer_pal_rom = r32s(td, kf1 + 8)
    if dest1 and dest1 >= pb and dest1 < pb + ds and summer_pal_rom >= 0:
        src = stream_end + summer_pal_rom
        d = dest1 - pb
        if src + pal_size <= len(rom) and d + pal_size <= ds:
            summer_td[d : d + pal_size] = rom[src : src + pal_size]
    # Winter texture + palette from KF0.
    winter_tex_rom = r32s(td, kf0 + 4)
    winter_pal_rom = r32s(td, kf0 + 8)
    if dest0 and dest0 >= pb and dest0 < pb + ds and winter_tex_rom >= 0:
        src = stream_end + winter_tex_rom
        d = dest0 - pb
        if src + primary_size <= len(rom) and d + primary_size <= ds:
            winter_td[d : d + primary_size] = rom[src : src + primary_size]
    if dest1 and dest1 >= pb and dest1 < pb + ds and winter_pal_rom >= 0:
        src = stream_end + winter_pal_rom
        d = dest1 - pb
        if src + pal_size <= len(rom) and d + pal_size <= ds:
            winter_td[d : d + pal_size] = rom[src : src + pal_size]


def _patch_normal_animated_channel(
    rom: bytes,
    stream_end: int,
    pb: int,
    ds: int,
    td: bytes | bytearray,
    dest0: int,
    dest1: int,
    kf0: int,
    primary_size: int,
    pal_size: int,
    summer_td: bytearray,
    winter_td: bytearray,
) -> tuple[int, int]:
    # Patch a single non-weather animated channel. Returns (tex_count, pal_count).
    n_tex = 0
    n_pal = 0
    tex_rom = r32s(td, kf0 + 4)
    pal_rom = r32s(td, kf0 + 8)
    if dest0 and dest0 >= pb and dest0 < pb + ds and tex_rom >= 0:
        src = stream_end + tex_rom
        d = dest0 - pb
        if src + primary_size <= len(rom) and d + primary_size <= ds:
            summer_td[d : d + primary_size] = rom[src : src + primary_size]
            winter_td[d : d + primary_size] = rom[src : src + primary_size]
            n_tex += 1
    if dest1 and dest1 >= pb and dest1 < pb + ds and pal_rom >= 0:
        src = stream_end + pal_rom
        d = dest1 - pb
        if src + pal_size <= len(rom) and d + pal_size <= ds:
            summer_td[d : d + pal_size] = rom[src : src + pal_size]
            winter_td[d : d + pal_size] = rom[src : src + pal_size]
            n_pal += 1
    return n_tex, n_pal


def _patch_animated_channels(
    td: bytes | bytearray,
    pb: int,
    ds: int,
    rom: bytes,
    stream_end: int,
    nch: int,
    ct_off: int,
    summer_td: bytearray,
    winter_td: bytearray,
) -> tuple[int, int, int]:
    # Patch animated channels (bit20=1), both weather-swap and non-weather.
    # Returns (n_weather, n_anim_tex, n_anim_pal) counts.
    log.debug('Pass 2: Patching animated channels.')
    n_weather = 0
    n_anim_tex = 0
    n_anim_pal = 0
    for ci in range(nch):
        c = ct_off + ci * 0x24
        if c + 0x24 > len(td):
            break
        dest0 = r32(td, c)
        dest1 = r32(td, c + 4)
        kf_ptr = r32(td, c + 8)
        flags = r32(td, c + 0x20)
        if not (flags & (1 << 20)):
            continue
        if kf_ptr < pb or kf_ptr >= pb + ds:
            continue
        kf_off = kf_ptr - pb
        if kf_off + 8 > len(td):
            continue
        n_kf = r16(td, kf_off + 2)
        if n_kf < 1:
            continue
        kf0 = kf_off + 8
        if kf0 + 12 > len(td):
            continue
        primary_size = flags & 0x3FFFF
        pal_size = 0x200 if ne((flags >> 24) & 0xF, 1) else 0x20
        is_weather = n_kf == MIN_KEYFRAMES and r32(td, kf0) == WEATHER_SWAP_SENTINEL
        if is_weather:
            n_weather += 1
            _patch_weather_swap_channel(
                td,
                pb,
                ds,
                rom,
                stream_end,
                dest0,
                dest1,
                kf0,
                primary_size,
                pal_size,
                summer_td,
                winter_td,
            )
        else:
            t, p = _patch_normal_animated_channel(
                rom,
                stream_end,
                pb,
                ds,
                td,
                dest0,
                dest1,
                kf0,
                primary_size,
                pal_size,
                summer_td,
                winter_td,
            )
            n_anim_tex += t
            n_anim_pal += p
    log.debug('  Animated: %d weather, %d tex, %d pal.', n_weather, n_anim_tex, n_anim_pal)
    return n_weather, n_anim_tex, n_anim_pal


def _build_winter_overrides(
    summer_td: bytearray, winter_td: bytearray, ds: int
) -> list[tuple[int, int, bytes]]:
    # Build the winter override diff table (byte-level diff, grouped by 0x20 alignment).
    seen = {}
    for off in range(ds):
        if summer_td[off] != winter_td[off]:
            base = (off // 0x20) * 0x20
            if base not in seen and base + 0x20 <= ds:
                seen[base] = (base, 0x20, bytes(winter_td[base : base + 0x20]))
    return sorted(seen.values())


def patch_palettes(
    td: bytes | bytearray, pb: int, ds: int, rom: bytes, stream_end: int
) -> tuple[bytearray, list[tuple[int, int, bytes]]]:
    """
    Patch streaming palette/texture data into the track data.

    Returns (summer_td, winter_overrides) where:
    - ``summer_td``: track data with summer palettes applied.
    - ``winter_overrides``: list of (dest_off, size, winter_data) tuples.

    Parameters
    ----------
    td : bytes | bytearray
        The track data to patch.
    pb : int
        The pointer base address for the track data (DRAM address corresponding to ``td[0]``).
    ds : int
        The size of the track data in bytes.
    rom : bytes
        The full ROM data, used to read the palette/texture data for patching.
    stream_end : int
        The byte offset in the ROM where the compressed chunk region ends (base address for
        streaming palette/texture data).

    Returns
    -------
    tuple[bytearray, list[tuple[int, int, bytes]]]
        A tuple containing:
        - ``summer_td``: A bytearray of the track data with summer palettes applied.
        - ``winter_overrides``: A list of tuples (dest_offset, size, winter_data) for the winter
          palette/texture overrides.
    """
    nch = r32(td, 0x18)
    ctp = r32(td, 0x1C)
    ct_off = ctp - pb
    summer_td = bytearray(td)
    winter_td = bytearray(td)
    _patch_static_palettes(td, pb, ds, rom, stream_end, nch, ct_off, summer_td, winter_td)
    _patch_static_textures(td, pb, ds, rom, stream_end, nch, ct_off, summer_td, winter_td)
    _patch_animated_channels(td, pb, ds, rom, stream_end, nch, ct_off, summer_td, winter_td)
    return summer_td, _build_winter_overrides(summer_td, winter_td, ds)


def _find_all_ci4_in_dl(
    td: bytes | bytearray, pb: int, dl_off: int, visited: set[int] | None = None
) -> Iterator[tuple[int, int, int]]:
    # Walk DL following branches, yield ALL CI4 LOADBLOCK texture addresses and sizes.
    if visited is None:
        visited = set()
    if dl_off in visited or dl_off < 0 or dl_off + 8 > len(td):
        return
    visited.add(dl_off)
    pc = dl_off
    last_settimg = None
    tile_fmt = {}
    pending_tex = None  # address from most recent LOADBLOCK.
    for _ in range(2000):
        if pc + 8 > len(td):
            break
        w0 = struct.unpack_from('>I', td, pc)[0]
        w1 = struct.unpack_from('>I', td, pc + 4)[0]
        cmd = (w0 >> 24) & 0xFF
        match cmd:
            case DLCommand.ENDDL:
                break
            case DLCommand.DL_BRANCH if pb <= w1 < pb + len(td):
                yield from _find_all_ci4_in_dl(td, pb, w1 - pb, visited)
            case DLCommand.SETTIMG:
                last_settimg = w1
            case DLCommand.SETTILE:
                tile = (w1 >> 24) & 7
                tile_fmt[tile] = (w0 >> 21) & 7
            case DLCommand.LOADBLOCK:
                if last_settimg is not None:
                    pending_tex = last_settimg
            case DLCommand.SETTILESIZE:
                tile = (w1 >> 24) & 7
                if tile == 0:
                    cur_w = (((w1 >> 12) & 0xFFF) - ((w0 >> 12) & 0xFFF)) // 4 + 1
                    cur_h = ((w1 & 0xFFF) - (w0 & 0xFFF)) // 4 + 1
                    if pending_tex is not None and tile_fmt.get(0) == IMG_FMT_CI:
                        if pending_tex >= pb and pending_tex < pb + len(td):
                            yield (pending_tex - pb, cur_w, cur_h)
                        pending_tex = None
            # Also catch LOADBLOCK that reuses tile 0 without new SETTILESIZE.
            case DLCommand.TRI1 | DLCommand.TRI2 if (
                pending_tex is not None and tile_fmt.get(0) == IMG_FMT_CI and cur_w and cur_h
            ):
                if pending_tex >= pb and pending_tex < pb + len(td):
                    yield (pending_tex - pb, cur_w, cur_h)
                pending_tex = None
        pc += 8


def flip_ci4_horizontal(data: bytearray, offset: int, width: int, height: int) -> None:
    """
    Flip a CI4 texture horizontally (left-right mirror) in place.

    Reverses byte order within each row and swaps nibbles in each byte.

    Parameters
    ----------
    data : bytearray
        The track data containing the texture to modify in place.
    offset : int
        The byte offset within `data` where the texture starts.
    width : int
        The width of the texture in pixels (must be even since each byte has 2 pixels).
    height : int
        The height of the texture in pixels.
    """
    row_bytes = width // 2
    for y in range(height):
        rs = offset + y * row_bytes
        row = bytearray(data[rs : rs + row_bytes])
        row.reverse()
        for i in range(len(row)):
            row[i] = ((row[i] & 0x0F) << 4) | ((row[i] & 0xF0) >> 4)
        data[rs : rs + row_bytes] = row


def flip_ia8_horizontal(
    data: bytearray, offset: int, width: int, height: int, row_pitch: int | None = None
) -> None:
    """
    Flip an IA8 texture horizontally (left-right mirror) in place.

    Each pixel is 1 byte. Handles TMEM interleave (XOR 4 on odd rows) by deinterleaving before
    flip and re-interleaving after.

    Parameters
    ----------
    data : bytearray
        The track data containing the texture to modify in place.
    offset : int
        The byte offset within `data` where the texture starts.
    width : int
        The width of the texture in pixels.
    height : int
        The height of the texture in pixels.
    row_pitch : int | None
        The number of bytes between the start of each row in memory. If ``None``, defaults to width
        (no padding).
    """
    if row_pitch is None:
        row_pitch = width
    for y in range(height):
        rs = offset + y * row_pitch
        # Deinterleave odd rows (swap 4-byte halves in each 8-byte group).
        if y & 1:
            for i in range(0, row_pitch, 8):
                a = data[rs + i : rs + i + 4]
                b = data[rs + i + 4 : rs + i + 8]
                data[rs + i : rs + i + 4] = b
                data[rs + i + 4 : rs + i + 8] = a
        # Flip visible pixels.
        row = bytearray(data[rs : rs + width])
        row.reverse()
        data[rs : rs + width] = row
        # Re-interleave odd rows.
        if y & 1:
            for i in range(0, row_pitch, 8):
                a = data[rs + i : rs + i + 4]
                b = data[rs + i + 4 : rs + i + 8]
                data[rs + i : rs + i + 4] = b
                data[rs + i + 4 : rs + i + 8] = a


def fix_coastline_banner_vertices(td: bytearray, pb: int, ds: int) -> None:
    """
    Fix Coastline banner by reversing S coordinates on mirrored quads.

    Coastline's banner uses a symmetric mesh where both STA and TRA textures are mapped to
    overlapping front/back face quads. The axis permutation in noclip swaps left/right, making one
    set of quads appear mirrored.

    Fix: reverse S coordinates (S = S_max - S) on the quads that appear on the wrong side in noclip
    (STA Quad1 v16-19, TRA Quad2 v28-31).

    Parameters
    ----------
    td : bytearray
        The track data to modify in place.
    pb : int
        The pointer base address for the track data (DRAM address corresponding to td[0]).
    ds : int
        The size of the track data in bytes.
    """
    # VTX data address from DL at 0x0a6c08: 0x800cc900
    vtx_addr = 0x800CC900
    vtx_off = vtx_addr - pb
    if vtx_off < 0 or vtx_off + 32 * 16 > ds:
        return
    s_max = 2048  # 64 pixels * 32 (fixed point 10.5)
    # Reverse S on STA Quad1 (v16-19) and TRA Quad2 (v28-31)
    for vi in (16, 17, 18, 19, 28, 29, 30, 31):
        s_off = vtx_off + vi * 16 + 8  # S is at byte 8 in each 16-byte vertex
        s_val = struct.unpack_from('>h', td, s_off)[0]
        s_new = s_max - s_val
        struct.pack_into('>h', td, s_off, s_new)
    # Workaround: Cancel the FIRST STA draw (left half) and make the FIRST TRA draw
    # (left half, normally back-facing/culled) front-facing instead.
    # Result: left half = TRA (flipped to ART), right half = STA → "ART" + "STA" = START
    # NOP the first STA TRI2 at 0x0a6c90 (replace with RDPPIPESYNC).
    if ds >= 0x0A6C90 + 8:
        struct.pack_into('>I', td, 0x0A6C90, 0xE7000000)  # RDPPIPESYNC
        struct.pack_into('>I', td, 0x0A6C94, 0x00000000)
    # Reverse winding of TRA TRI2 #1 at 0x0a6cc8 to make it front-facing.
    # Original: (24,25,26)(24,26,27) → Reversed: (24,26,25)(24,27,26)
    if ds >= 0x0A6CC8 + 8:
        struct.pack_into('>I', td, 0x0A6CC8, 0xB1303432)  # (24,26,25)
        struct.pack_into('>I', td, 0x0A6CCC, 0x00303634)  # (24,27,26)
    # Flip TRA texture horizontally so "TRA" reads as "ART".
    tra_tex_off = 0x800733D8 - pb
    if tra_tex_off + 1024 <= ds:
        flip_ci4_horizontal(td, tra_tex_off, 64, 32)
        # Also flip mipmaps.
        mip_off = tra_tex_off + 1024
        for level in range(1, 3):
            mw, mh = 64 >> level, 32 >> level
            if mw < MIN_MIP_DIM or mh < 1:
                break
            flip_ci4_horizontal(td, mip_off, mw, mh)
            mip_off += (mw * mh) // 2


def zero_out_textures(td: bytearray, pb: int, ds: int, track_idx: int) -> None:
    """
    Zero out specific texture data to hide unwanted elements per track.

    Parameters
    ----------
    td : bytearray
        The track data to modify in place.
    pb : int
        The pointer base address for the track data (DRAM address corresponding to td[0]).
    ds : int
        The size of the track data in bytes.
    track_idx : int
        The track index, used to look up the relevant textures to zero out.
    """
    # Textures to zero out: (track_idx, DRAM_addr, size_in_bytes)
    # Season Winner: RALLY Champion banner + camera flash boxes + their palettes
    zero_textures = {
        10: (
            (0x8003ED38, 0x400),  # RALLY Champion banner texture
            (0x80043650, 0x400),  # Left or right side of banner texture
            (0x80043830, 0x400),  # Left or right side of banner texture
            (0x800266D8, 0x20),  # RALLY Champion palette (16 entries RGBA5551)
            (0x80026778, 0x20),  # Camera flash palette (16 entries RGBA5551)
        ),
    }
    textures = zero_textures.get(track_idx, ())
    for addr, size in textures:
        if addr < pb or addr >= pb + ds:
            continue
        off = addr - pb
        sz = min(size, ds - off)
        td[off : off + sz] = b'\x00' * sz
        log.debug('  Zeroed 0x%x bytes at 0x%08x.', sz, addr)


def _banner_tex_total_size(w: int, h: int, fmt: str = 'ci4') -> int:
    # Compute total size of a banner texture including mipmaps.
    if fmt == 'ia8':
        return w * h  # No mipmaps for IA8 banners.
    s = (w * h) // 2
    for lv in range(1, 3):
        mw, mh = w >> lv, h >> lv
        if mw < MIN_MIP_DIM or mh < 1:
            break
        s += (mw * mh) // 2
    return s


def _swap_banner_halves(
    td: bytearray, pb: int, ds: int, a: BannerTexEntry, b: BannerTexEntry
) -> None:
    # Swap two banner texture halves in track data.
    a_off = a.addr - pb
    b_off = b.addr - pb
    a_size = _banner_tex_total_size(a.width, a.height, a.fmt)
    b_size = _banner_tex_total_size(b.width, b.height, b.fmt)
    if a_size == b_size and a_off + a_size <= ds and b_off + b_size <= ds:
        a_data = bytes(td[a_off : a_off + a_size])
        b_data = bytes(td[b_off : b_off + b_size])
        td[a_off : a_off + a_size] = b_data
        td[b_off : b_off + b_size] = a_data


def flip_banner_textures(td: bytearray, pb: int, ds: int, track_idx: int) -> None:
    """
    Flip banner CI4 textures horizontally to correct mirrored text.

    The START banner text is composed of two CI4 64x32 textures (e.g. "ART" and "STA" halves). These
    addresses are known per track from the texture viewer's cache indices.

    Parameters
    ----------
    td : bytearray
        The track data to modify in place.
    pb : int
        The pointer base address for the track data (DRAM address corresponding to ``td[0]``).
    ds : int
        The size of the track data in bytes.
    track_idx : int
        The track index, used to look up the relevant banner texture addresses.
    """
    # Known banner texture addresses per track (DRAM addresses).
    # Format is CI4 by default, or IA8 if specified.
    banner_textures: dict[int, tuple[BannerTexEntry, ...]] = {
        0: (BannerTexEntry(0x80082538, 64, 32), BannerTexEntry(0x80082A78, 64, 32)),  # Desert
        1: (BannerTexEntry(0x800957C0, 64, 32), BannerTexEntry(0x80095D00, 64, 32)),  # Mountain
        # Coastline (2): symmetric overlapping mesh - both textures cover
        # full banner with cutout alpha compositing. Needs vertex S-coord
        # fix, not texture flip.
        3: (BannerTexEntry(0x800822A0, 126, 32, 'ia8', 128),),  # Strip Mine (IA8)
        4: (BannerTexEntry(0x80092F90, 64, 32), BannerTexEntry(0x800934D0, 64, 32)),  # Jungle
        10: (),  # Season Winner: hidden via palette zeroing.
    }
    textures = banner_textures.get(track_idx, ())
    # Step 1: Flip each texture horizontally.
    for entry in textures:
        if entry.addr < pb or entry.addr >= pb + ds:
            continue
        tex_off = entry.addr - pb
        if entry.fmt == 'ia8':
            pitch = entry.row_pitch if entry.row_pitch is not None else entry.width
            size = pitch * entry.height
            if tex_off + size > ds:
                continue
            flip_ia8_horizontal(td, tex_off, entry.width, entry.height, pitch)
        else:
            size = (entry.width * entry.height) // 2
            if tex_off + size > ds:
                continue
            flip_ci4_horizontal(td, tex_off, entry.width, entry.height)
            # Also flip mipmap levels.
            mip_off = tex_off + size
            for level in range(1, 3):
                mw, mh = entry.width >> level, entry.height >> level
                if mw < MIN_MIP_DIM or mh < 1:
                    break
                flip_ci4_horizontal(td, mip_off, mw, mh)
                mip_off += (mw * mh) // 2
    # Step 2: Swap the two texture halves so they appear on the correct
    # side of the banner.
    if len(textures) == BANNER_HALVES:
        _swap_banner_halves(td, pb, ds, textures[0], textures[1])


def build_tgr2(
    td: bytearray,
    pb: int,
    ds: int,
    sky_dl_off: int,
    inst_off: int,
    inst_cnt: int,
    winter_overrides: Sequence[tuple[int, int, bytes]],
    anim_tex_channels: Sequence[dict[str, Any]] | None = None,
) -> bytearray:
    """
    Build a TGR2 file from track data, winter overrides, and animated textures.

    Parameters
    ----------
    td : bytearray
        The track data with summer palettes applied.
    pb : int
        The pointer base address for the track data (DRAM address corresponding to td[0]).
    ds : int
        The size of the track data in bytes.
    sky_dl_off : int
        The byte offset within track data where the sky DL starts, or 0 if not present.
    inst_off : int
        The byte offset within track data where the instance table starts.
    inst_cnt : int
        The number of instances in the instance table.
    winter_overrides : Sequence[tuple[int, int, bytes]]
        List of (dest_off, size, winter_data) tuples for the winter override table.
    anim_tex_channels : Sequence[dict] | None
        List of animated texture channels, where each channel is a dict with keys:``dest_offset``,
        ``tex_size``, and ``keyframes`` (sequence of dicts with keys ``time`` and ``tex_data``).

    Returns
    -------
    bytearray
        The complete TGR2 file data.
    """
    data_offset = TGR2_HEADER_SIZE
    winter_table_offset = data_offset + ds
    winter_blob = bytearray()
    for dest_off, size, data in winter_overrides:
        winter_blob.extend(struct.pack('<I', dest_off))
        winter_blob.extend(struct.pack('<H', size))
        winter_blob.extend(struct.pack('<H', 0))
        winter_blob.extend(data)
    # Build animated texture blob. Starts with a channel count word, followed by per-channel headers
    # (dest offset, texture size, keyframe count) and then each keyframe's time word and raw texture
    # data.
    anim_tex_blob = bytearray()
    anim_channels = anim_tex_channels or ()
    anim_tex_blob.extend(struct.pack('<I', len(anim_channels)))
    for ch in anim_channels:
        anim_tex_blob.extend(struct.pack('<I', ch['dest_offset']))
        anim_tex_blob.extend(struct.pack('<I', ch['tex_size']))
        anim_tex_blob.extend(struct.pack('<I', len(ch['keyframes'])))
        for kf in ch['keyframes']:
            anim_tex_blob.extend(struct.pack('<I', kf['time']))
            anim_tex_blob.extend(kf['tex_data'])
    anim_tex_offset = winter_table_offset + len(winter_blob)
    header = bytearray(TGR2_HEADER_SIZE)
    struct.pack_into('<I', header, 0, TGR2_MAGIC)
    struct.pack_into('<I', header, 4, 1)  # Version.
    struct.pack_into('<I', header, 8, pb)
    struct.pack_into('<I', header, 12, ds)
    struct.pack_into('<I', header, 16, inst_off)
    struct.pack_into('<I', header, 20, inst_cnt)
    struct.pack_into('<I', header, 24, sky_dl_off)
    struct.pack_into('<I', header, 28, data_offset)
    struct.pack_into('<I', header, 32, winter_table_offset)
    struct.pack_into('<I', header, 36, len(winter_overrides))
    # Use reserved fields for animated textures.
    struct.pack_into('<I', header, 40, anim_tex_offset)
    struct.pack_into('<I', header, 44, len(anim_channels))
    return header + bytes(td) + winter_blob + anim_tex_blob


def main() -> int:
    """Export Top Gear Rally track data as TGR2 files."""
    parser = argparse.ArgumentParser(
        description='Export Top Gear Rally tracks for noclip.website.',
    )
    parser.add_argument(
        'rom',
        nargs='?',
        default=DEFAULT_ROM_PATH,
        type=Path,
        help='Path to USA N64 ROM.',
    )
    parser.add_argument(
        'output_dir',
        nargs='?',
        default=DEFAULT_OUTPUT_DIR,
        type=Path,
        help='Directory to write output TGR2 files.',
    )
    parser.add_argument(
        '-d',
        '--debug',
        action='store_true',
        help='Enable debug log messages.',
    )
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format='%(levelname)s: %(message)s',
    )
    rom_path: Path = args.rom
    if not rom_path.exists():
        log.error('ROM not found: %s', rom_path)
        return 1
    rom = rom_path.read_bytes()
    digest = hashlib.sha256(rom).hexdigest()
    if digest != ROM_SHA256:
        log.error('ROM SHA-256 mismatch: expected %s, got %s.', ROM_SHA256, digest)
        return 1
    log.info('ROM: %d bytes, SHA-256 verified.', len(rom))
    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    for track_idx, geom_offset in sorted(TRACK_ROM_OFFSETS.items()):
        log.info('Track %d (geom @ 0x%06x)', track_idx, geom_offset)
        # Decompress track data from ROM.
        td, stream_end = decompress_track(rom, geom_offset)
        pb = POINTER_BASE
        ds = len(td)
        log.info('  Decompressed %d bytes, stream data @ 0x%06x', ds, stream_end)
        # Read instance table info from track header.
        inst_ptr = r32(td, 0x60)
        inst_cnt = r32(td, 0x64)
        inst_off = inst_ptr - pb
        sky_ptr = r32(td, 0x50)
        sky_dl_off = sky_ptr - pb if sky_ptr >= pb and sky_ptr < pb + ds else 0
        log.debug(
            '  Instances: %d at offset 0x%06x, sky DL at 0x%06x.', inst_cnt, inst_off, sky_dl_off
        )
        # Patch streaming palettes/textures.
        summer_td, winter_overrides = patch_palettes(td, pb, ds, rom, stream_end)
        log.info('  Patched palettes: %d winter overrides', len(winter_overrides))
        # Flip banner CI4 textures horizontally to correct mirrored text caused by the N64->GL
        # coordinate axis permutation (except Coastline).
        flip_banner_textures(summer_td, pb, ds, track_idx)
        log.info('  Banner textures flipped for track %d.', track_idx)
        # Coastline: fix banner via vertex S coordinate reversal on mirrored quads.
        if track_idx == TRACK_COASTLINE:
            fix_coastline_banner_vertices(summer_td, pb, ds)
            log.info('  Coastline banner vertices fixed.')
        # Zero out specific textures that should be hidden on certain tracks (e.g., Season Winner's
        # RALLY Champion banner and related textures).
        zero_out_textures(summer_td, pb, ds, track_idx)
        # Extract animated texture channels (waterfalls, torches, bird wings, etc.).
        if anim_tex := extract_animated_textures(td, pb, ds, rom, stream_end):
            total_kf = sum(len(ch['keyframes']) for ch in anim_tex)
            log.info(
                '  Animated textures: %d channels, %d total keyframes',
                len(anim_tex),
                total_kf,
            )
        # Build TGR2 output.
        output = build_tgr2(
            summer_td, pb, ds, sky_dl_off, inst_off, inst_cnt, winter_overrides, anim_tex
        )
        output_path = output_dir / f'track_{track_idx}.bin'
        Path(output_path).write_bytes(output)
        log.info('  Output: %d bytes -> %s', len(output), output_path)
    log.info('Done.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
