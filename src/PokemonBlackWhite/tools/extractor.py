import argparse
import hashlib
import json
import struct
from pathlib import Path

ARCHIVES = {
    'maps.narc': 'a/0/0/8',
    'map_changes.narc': 'a/0/1/0',
    'matrices.narc': 'a/0/0/9',
    'headers.narc': 'a/0/1/2',
    'areas.bin': 'a/0/1/3',
    'terrain_textures.narc': 'a/0/1/4',
    'building_textures.narc': 'a/1/7/6',
    'buildings.narc': 'a/2/2/9',
    'texture_animations.narc': 'a/0/6/9',
    'pattern_animations.narc': 'a/0/7/0',
    'entities.narc': 'a/1/2/5',
}


def take(data, offset, size):
    if offset < 0 or size < 0 or offset + size > len(data):
        raise ValueError(f'Invalid range: {offset} + {size} / {len(data)}')
    return data[offset:offset + size]


def read_files(data):
    if len(data) < 0x200:
        raise ValueError('Truncated Nintendo DS header')
    code = data[12:16].decode('ascii')
    if code[:3] not in ('IRA', 'IRB'):
        raise ValueError(f'Expected Pokémon Black/White, found {code}')
    fnt_offset, fnt_size, fat_offset, fat_size = struct.unpack_from('<IIII', data, 0x40)
    fnt = take(data, fnt_offset, fnt_size)
    fat = take(data, fat_offset, fat_size)
    result = {}
    visited = set()

    def walk(directory, prefix):
        if directory in visited:
            raise ValueError('Cycle in Nintendo DS directory table')
        visited.add(directory)
        pos, file_id, _ = struct.unpack('<IHH', take(fnt, (directory - 0xF000) * 8, 8))
        while True:
            tag = take(fnt, pos, 1)[0]
            pos += 1
            if tag == 0:
                return
            name = take(fnt, pos, tag & 0x7F).decode('ascii')
            pos += tag & 0x7F
            if not name or name in ('.', '..') or '/' in name or '\\' in name:
                raise ValueError('Invalid Nintendo DS filename')
            path = prefix + name
            if tag & 0x80:
                child, = struct.unpack('<H', take(fnt, pos, 2))
                pos += 2
                walk(child, path + '/')
            else:
                start, end = struct.unpack('<II', take(fat, file_id * 8, 8))
                result[path] = take(data, start, end - start)
                file_id += 1

    walk(0xF000, '')
    return code, result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('rom', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    data = args.rom.read_bytes()
    code, files = read_files(data)
    version = 'White' if code.startswith('IRA') else 'Black'
    output = args.output or Path('data') / 'PokemonBlackWhite' / version
    selected = {}
    for name, path in ARCHIVES.items():
        content = files[path]
        if name.endswith('.narc'):
            if content[:4] != b'NARC' or struct.unpack_from('<I', content, 8)[0] != len(content):
                raise ValueError(f'Invalid archive: {path}')
        selected[name] = content
    output.mkdir(parents=True, exist_ok=True)
    for name, content in selected.items():
        destination = output / name
        if destination.exists() and destination.read_bytes() != content:
            raise ValueError(f'Refusing to replace different game data: {destination}')
    for name, content in selected.items():
        (output / name).write_bytes(content)
    manifest = {
        'gameCode': code,
        'version': version,
        'romSha256': hashlib.sha256(data).hexdigest(),
        'files': {name: {'source': ARCHIVES[name], 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
                  for name, content in selected.items()},
    }
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Extracted {len(selected)} archives for Pokémon {version} to {output}')


if __name__ == '__main__':
    main()
