# Python adaptation of various parts from "Spyro World Viewer" by Kly_Men_COmpany

import os
import mmap
from extract_level import extract_level

header_bytes = 8
sf_index = 0
sf_no_header_strikes = 0
wad_header_end = False

extract_path = "../../../data/Spyro1/extract"
wad_path = "../../../data/Spyro1/WAD.WAD"

# Extract subfiles from WAD based on its header
with open(wad_path, "rb") as f:
    with mmap.mmap(f.fileno(), length=0, access=mmap.ACCESS_READ) as wad:
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
                if sf_index % 2 == 0 and 10 <= sf_index <= 78:
                    extension = "level"
                elif 3 <= sf_index <= 6:
                    extension = "cutscene"
                elif 82 <= sf_index <= 101:
                    extension = "starring"
                if extension != "bin": # skip non-level subfiles
                    print(f"Subfile {sf_index + 1}: offset={sf_offset}, size={sf_size}, type={extension}")
                    with open(f"{extract_path}/sf{sf_index + 1}.{extension}", "wb") as sf:
                        sf.write(wad[sf_offset:sf_offset+sf_size])
            sf_index += 1

to_remove = []
# Extract sub-subfiles from levels
for file in os.listdir(extract_path):
    if ".level" in file or ".cutscene" in file or ".starring" in file:
        extract_level(f"{extract_path}/{file}")
        to_remove.append(file)

# Delete leftover level subfiles
for file in to_remove:
    os.remove(extract_path + "/" + file)
