from pathlib import Path
import argparse
import hashlib
import runpy
import struct


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('rom', type=Path)
    parser.add_argument('output', type=Path, nargs='?', default=Path(__file__).resolve().parents[2] / 'data' / 'TopGearRally')
    args = parser.parse_args()
    extractor = runpy.run_path(str(Path(__file__).with_name('extract-tgr.py')))
    decompress = extractor['decompress_track']
    extent = extractor['stream_extent']
    read = extractor['r32']
    rom = args.rom.read_bytes()
    if hashlib.sha256(rom).hexdigest() != 'd880e9bd0d7e354fa421eff6b91f776d9b7d67fdae560e038deb31efe9b0402e':
        raise ValueError('Japanese ROM SHA-256 mismatch')
    destination = args.output / 'jpn'
    destination.mkdir(parents=True, exist_ok=True)
    for index in [0, 1, 2, 3, 4, 10]:
        offset = read(rom, 0x732f4 + index * 0x17c + 0x14)
        data, stream_start = decompress(rom, offset)
        stream = rom[stream_start:stream_start + extent(data)]
        packed = struct.pack('<4I', 0x33524754, 0x80025c00, len(data), len(stream)) + data + stream
        (destination / f'track_{index}.tgr').write_bytes(packed)
    for index in range(13):
        offset = read(rom, 0x8daec + index * 0x60 + 0x14)
        data, _ = decompress(rom, offset)
        (destination / f'car_{index}.bin').write_bytes(data)
    (destination / 'car_catalog.bin').write_bytes(rom[0x8daec:0x8daec + 13 * 0x60] + rom[0x8e010:0x8e010 + 13 * 0x4c])
    dashboard_start = min(read(rom, 0x8daec + index * 0x60 + 0x20) for index in range(13))
    dashboard_end = max(read(rom, 0x8daec + index * 0x60 + 0x24) for index in range(13))
    (destination / 'dashboards.bin').write_bytes(rom[dashboard_start:dashboard_end])


if __name__ == '__main__':
    main()
