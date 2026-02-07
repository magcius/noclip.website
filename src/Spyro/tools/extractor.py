# Python adaptation of various parts from "Spyro World Viewer" by Kly_Men_COmpany

import os
import sys
import mmap
from extract_level import extract_level
from extract_level2 import extract_level2

header_bytes = 8
sf_index = 0
sf_no_header_strikes = 0
wad_header_end = False
game_number = 1

extract_path = "../../../data/Spyro1/"
extract_path2 = "../../../data/Spyro2/"
wad_path = "../../../data/Spyro1_raw/WAD.WAD"
wad_path2 = "../../../data/Spyro2_raw/WAD.WAD"

# Extract first game by default, or second game if argument of "2" is given
if len(sys.argv) > 1:
    arg = sys.argv[1:][0]
    if arg == '2':
        game_number = 2
        extract_path = extract_path2
        wad_path = wad_path2
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
                if game_number == 1:
                    if sf_index % 2 == 0 and 10 <= sf_index <= 78:
                        extension = "level"
                    elif 3 <= sf_index <= 6:
                        extension = "cutscene"
                    elif 82 <= sf_index <= 101:
                        extension = "starring"
                else:
                    if sf_index % 2 == 1 and 15 <= sf_index <= 71:
                        extension = "level"
                    elif sf_index % 2 == 1 and 73 <= sf_index <= 95:
                        extension = "cutscene"
                    elif 187 <= sf_index <= 196:
                        extension = "starring"
                if extension != "bin": # skip non-level subfiles
                    print(f"Subfile {sf_index + 1}: offset={sf_offset}, size={sf_size}, type={extension}")
                    with open(f"{extract_path}/sf{sf_index + 1}.{extension}", "wb") as sf:
                        sf.write(wad[sf_offset:sf_offset+sf_size])
            sf_index += 1

print("\nExtracting sub-subfiles...")
to_remove = []
for file in os.listdir(extract_path):
    if ".level" in file or ".cutscene" in file or ".starring" in file:
        if game_number == 1:
            extract_level(f"{extract_path}/{file}")
        else:
            extract_level2(f"{extract_path}/{file}")
        to_remove.append(file)

# Delete leftover level subfiles
for file in to_remove:
    os.remove(f"{extract_path}/{file}")

print("Done!")
