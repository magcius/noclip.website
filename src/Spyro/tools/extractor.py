# Python adaptation of various parts from "Spyro World Viewer" by Kly_Men_COmpany

import sys
import mmap

header_bytes = 8
sf_index = 0
sf_no_header_strikes = 0
wad_header_end = False
subfile_type_map = [
    {"level": range(10, 79, 2), "cutscene": range(3, 7, 1), "starring": range(82, 102, 1)},
    {"level": range(15, 72, 2), "cutscene": range(73, 96, 2), "starring": range(187, 197, 1)},
    {"level": range(97, 170, 2), "cutscene": range(6, 67, 3), "starring": range(183, 195, 1)}
]

base = "../../../data/"
extract_path = f"{base}Spyro1/"
extract_path2 = f"{base}Spyro2/"
extract_path3 = f"{base}Spyro3/"
wad_path = f"{base}Spyro1_raw/WAD.WAD"
wad_path2 = f"{base}Spyro2_raw/WAD.WAD"
wad_path3 = f"{base}Spyro3_raw/WAD.WAD"

game_number = 1
# Extract first game by default, or 2nd/3rd game based on arg
if len(sys.argv) > 1:
    arg = sys.argv[1:][0]
    if arg == '2':
        game_number = 2
        extract_path = extract_path2
        wad_path = wad_path2
    elif arg == '3':
        game_number = 3
        extract_path = extract_path3
        wad_path = wad_path3
    elif arg != '1':
        print("Unknown game number! Defaulting to Spyro 1...")

# Extract subfiles from WAD based on its header
with open(wad_path, "rb") as f:
    with mmap.mmap(f.fileno(), length=0, access=mmap.ACCESS_READ) as wad:
        print(f"Extracting level subfiles for Spyro {game_number}...\n")
        while not wad_header_end:
            # Every 8 bytes contains an offset and size (first 4 is offset, other 4 is the size)
            sf_offset = int.from_bytes(wad[sf_index * header_bytes:(sf_index * header_bytes) + 4],
                                       byteorder="little", signed=False)
            sf_size = int.from_bytes(wad[(sf_index * header_bytes) + 4:(sf_index * header_bytes) + 8],
                                     byteorder="little", signed=False)
            if sf_offset == 0 and sf_size == 0:
                # Header is assumed to have ended when there's 3 sequential 8 byte chunks that are all zero
                sf_no_header_strikes += 1
                if sf_no_header_strikes > 2:
                    wad_header_end = True
            else:
                sf_no_header_strikes = 0
                extension = "bin"
                for t in ["level", "cutscene", "starring"]:
                    if sf_index in subfile_type_map[game_number - 1][t]:
                        extension = t
                if extension != "bin" and sf_size > 0: # skip non-level subfiles for noclip (overlays, menus, etc.)
                    print(f"Subfile {sf_index + 1}: offset={sf_offset}, size={sf_size}, type={extension}")
                    with open(f"{extract_path}/sf{sf_index + 1}.bin", "wb") as sf:
                        sf.write(wad[sf_offset:sf_offset+sf_size])
            sf_index += 1
