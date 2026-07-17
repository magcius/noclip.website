import os
import mmap
import ndspy.codeCompression

base = "../../../data/"
extract_path = f"{base}KingdomHeartsDDD"
rbin_path = f"{base}KingdomHeartsDDD_raw/"
rbins = ["_grpdef", "chara_boss", "chara_d_obj", "chara_e_obj", "chara_enemy", "chara_f_obj", "chara_gim", "chara_high", "chara_npc", "chara_pc", "chara_wep", "effect", "event", "game", "item", "map", "menu", "minigame", "mission", "setdata"]

# Credit: https://openkh.dev/ddd/file/rbin.html
# Also requires "ndspy" library for BLZ decompression

def read_zero_term_string(rbin, start) -> str:
    b = bytearray()
    o = start
    while True:
        c = rbin[o:o + 1]
        if not c or c == b'\x00':
            break
        b.extend(c)
        o += 1
    return b.decode("utf-8")

for rbin_name in rbins:
    print(rbin_name)
    print("-" * 16)
    with open(rbin_path + rbin_name + ".rbin", "rb") as f:
        with mmap.mmap(f.fileno(), length=0, access=mmap.ACCESS_READ) as rbin:
            magic = rbin[0:4].decode("utf-8")
            if not magic == "CRAR":
                raise Exception("Not a valid rbin file!")
            else:
                file_count = int.from_bytes(rbin[6:8], byteorder="little", signed=False)

                mount = rbin[16:32].decode("utf-8").replace('\x00', '')
                output_dir = os.path.join(extract_path, mount)
                if not os.path.exists(output_dir):
                    os.makedirs(output_dir)

                entry_offset = 32
                for i in range(file_count):
                    name_offset = int.from_bytes(rbin[entry_offset + 4:entry_offset + 8], byteorder="little", signed=False)
                    size_flag = int.from_bytes(rbin[entry_offset + 8:entry_offset + 12], byteorder="little", signed=False)
                    data_offset = int.from_bytes(rbin[entry_offset + 12:entry_offset + 16], byteorder="little", signed=False)
                    is_compressed = (size_flag >> 31) & 1
                    subfile_size = size_flag & ((1 << 31) - 1)
                    subfile_name = read_zero_term_string(rbin, entry_offset + 4 + name_offset)

                    print(f"{i}: {subfile_name}, {is_compressed}, {subfile_size}")

                    output_path = os.path.join(output_dir, subfile_name)

                    subfile_data = rbin[data_offset:data_offset + subfile_size]
                    with open(output_path, 'wb') as out_file:
                        if not is_compressed:
                            out_file.write(subfile_data)
                        else:
                            decompressed_data = ndspy.codeCompression.decompress(subfile_data)
                            out_file.write(decompressed_data)

                    entry_offset += 16
