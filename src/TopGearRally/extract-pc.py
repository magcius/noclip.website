from pathlib import Path
import argparse
import struct


BASE = 0x80025C00
TRACKS = {0: 'desert', 1: 'mountain', 2: 'coast', 3: 'mine', 4: 'amazon'}
PC_ONLY_TRACKS = {5: ('race', 'skytexmountain'), 14: ('bonus', 'skytexmountain')}
CARS = ['ce', 'es', 'ns', 'rs', 'sp', 'ps', 'm3', 'ip', 'ld', 'hm', 'mt', 'cu', 'bb']
OFFSETS = [0xaee40, 0xb2be0, 0xb6d40, 0xbaef0, 0xbebb0, 0xc2dc0, 0xc6900, 0xca3e0, 0xcdf60, 0xd1810, 0xd4a80, 0xd8490, 0xd9160]


def u32(data: bytes | bytearray, offset: int) -> int:
    return struct.unpack_from('>I', data, offset)[0]


def export_track(pc: bytes, original: bytes) -> bytes:
    _, base, size, _ = struct.unpack_from('<4I', original)
    data = bytearray(original[16:16 + size])
    table = u32(data, 0x1c) - base
    pc_table = u32(pc, 0x1c) - BASE
    count = u32(data, 0x18)
    if u32(pc, 0x18) != count:
        raise ValueError('PC and N64 texture counts differ')
    stream_start = u32(pc, 0)
    for i in range(count):
        dst = table + i * 0x24
        src = pc_table + i * 0x24
        image, palette = struct.unpack_from('>II', data, dst)
        pc_image, pc_palette, source = struct.unpack_from('>III', pc, src)
        flags = u32(pc, src + 0x20)
        image_size = flags & 0x3ffff
        palette_size = 32 if (flags >> 24) & 15 == 1 else 512
        if pc[src + 0x0c:src + 0x10] != data[dst + 0x0c:dst + 0x10]:
            raise ValueError(f'Texture {i} dimensions differ')
        if image and pc_image and image_size:
            start = pc_image - BASE
            target = image - base
            if target + image_size > size or start + image_size > stream_start:
                raise ValueError(f'Texture {i} image exceeds data')
            data[target:target + image_size] = pc[start:start + image_size]
        if palette and pc_palette:
            start = pc_palette - BASE
            target = palette - base
            data[target:target + palette_size] = pc[start:start + palette_size]
        if flags & (1 << 20):
            animation = source - BASE
            frame_count = struct.unpack_from('>H', pc, animation + 2)[0]
            if frame_count == 2 and u32(pc, animation + 8) == 0xffffffff and palette:
                palette_offset = u32(pc, animation + 0x1c)
                if palette_offset != 0xffffffff:
                    start = stream_start + palette_offset
                    target = palette - base
                    data[target:target + palette_size] = pc[start:start + palette_size]
            source = base + len(data)
            data.extend(pc[animation:animation + 8 + frame_count * 12])
        struct.pack_into('>I', data, dst + 8, source)
        struct.pack_into('>I', data, dst + 0x20, flags)
    stream = pc[stream_start:]
    return struct.pack('<4I', 0x33524754, base, len(data), len(stream)) + data + stream


def export_pc_only_track(pc: bytes) -> bytes:
    stream_start = u32(pc, 0)
    data = pc[:stream_start]
    stream = pc[stream_start:]
    return struct.pack('<4I', 0x33524754, BASE, len(data), len(stream)) + data + stream


def export_sky_sections(cargfx: Path, sky: str) -> bytes:
    return b''.join((cargfx / f'{name}.lut4').read_bytes() + (cargfx / f'{name}.ci4').read_bytes() for name in (sky, f'{sky}n'))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('pc_data', type=Path)
    parser.add_argument('output', type=Path, nargs='?', default=Path(__file__).resolve().parents[2] / 'data' / 'TopGearRally')
    args = parser.parse_args()
    destination = args.output / 'pc'
    destination.mkdir(parents=True, exist_ok=True)
    for index, name in TRACKS.items():
        pc = (args.pc_data / 'tracks' / f'{name}.trk').read_bytes()
        original = (args.output / f'track_{index}.tgr').read_bytes()
        (destination / f'track_{index}.tgr').write_bytes(export_track(pc, original))
    for index, (name, sky) in PC_ONLY_TRACKS.items():
        pc = (args.pc_data / 'tracks' / f'{name}.trk').read_bytes()
        (destination / f'track_{index}.tgr').write_bytes(export_pc_only_track(pc))
        (destination / f'sections_{index}.bin').write_bytes(export_sky_sections(args.pc_data / 'cargfx', sky))
    for name, offset in zip(CARS, OFFSETS):
        data = (args.pc_data / 'cars' / f'{name}.rca').read_bytes()
        if data[:4] != b'RCar':
            raise ValueError(f'Invalid car: {name}')
        (destination / f'asset_{offset:06x}.bin').write_bytes(data[0x8000:])
    for name in ['pj', 'tr', 'mn']:
        data = (args.pc_data / 'cars' / f'{name}.rca').read_bytes()
        if data[:4] != b'RCar':
            raise ValueError(f'Invalid car: {name}')
        (destination / f'car_{name}.bin').write_bytes(data[0x8000:])


if __name__ == '__main__':
    main()
