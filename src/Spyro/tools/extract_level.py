# Python adaptation of various parts from "Spyro World Viewer" by Kly_Men_COmpany

import os
import struct

MAX_SIZE = 1024 * 1024 * 16
VRAM_SIZE = 524288


def copy_from(dest, src, count):
    if count > MAX_SIZE:
        raise RuntimeError("Too large")
    if count > 0:
        dest.write(src.read(count))


def extract_level(level_subfile):
    s = level_subfile.split('/sf')
    prefix = f"{s[0]}/sf{s[1].split(".")[0]}_"
    ground_file_name = f"{prefix}ground.bin"
    sky_file_name = f"{prefix}sky1.bin"
    vram_file_name = f"{prefix}vram.bin"
    list_file_name = f"{prefix}list.bin"

    try:
        with open(level_subfile, "rb") as stream:
            start_offset = 0
            sf_size = os.path.getsize(level_subfile)

            if sf_size < 16:
                raise RuntimeError("Too small")

            # VRAM
            stream.seek(start_offset)
            vram_offset = struct.unpack("<I", stream.read(4))[0]
            if start_offset + sf_size > os.path.getsize(level_subfile):
                raise RuntimeError("Invalid offset")
            stream.seek(start_offset + vram_offset)

            with open(vram_file_name, "wb") as out_vram:
                copy_from(out_vram, stream, VRAM_SIZE)

            # Texture/list
            stream.seek(start_offset + 8)
            list_offset = struct.unpack("<I", stream.read(4))[0]
            list_size   = struct.unpack("<I", stream.read(4))[0]
            start_offset += list_offset
            if start_offset + list_size > os.path.getsize(level_subfile):
                raise RuntimeError("Invalid size")
            stream.seek(start_offset)
            list_offset = struct.unpack("<I", stream.read(4))[0]
            stream.seek(-4, os.SEEK_CUR)

            with open(list_file_name, "wb") as out_list:
                copy_from(out_list, stream, list_offset + 16)

            # Ground
            stream.seek(start_offset)
            ground_offset = struct.unpack("<I", stream.read(4))[0]
            if (stream.tell() - start_offset + ground_offset - 8) > list_size or ground_offset < 4:
                raise RuntimeError("Bad ground offset")
            stream.seek(ground_offset - 4, os.SEEK_CUR)

            ground_offset = struct.unpack("<I", stream.read(4))[0]
            if (stream.tell() - start_offset + ground_offset - 8) > list_size or ground_offset < 4:
                raise RuntimeError("Bad ground offset")

            with open(ground_file_name, "wb") as out_ground:
                copy_from(out_ground, stream, ground_offset - 4)

            # Sky
            sky_offset = struct.unpack("<I", stream.read(4))[0]
            sky_test_pos = stream.tell()
            sky_count = sky_offset
            if (stream.tell() - start_offset + sky_offset - 8) > list_size or sky_offset < 4:
                raise RuntimeError("Bad sky offset")
            stream.seek(sky_offset - 4, os.SEEK_CUR)

            sky_offset = struct.unpack("<I", stream.read(4))[0]
            if (stream.tell() - start_offset + sky_offset - 8) > list_size:
                raise RuntimeError("Bad sky offset")

            if sky_offset > 3:
                stream.seek(sky_offset - 4, os.SEEK_CUR)
                sky_offset = struct.unpack("<I", stream.read(4))[0]
                stream.seek(sky_offset - 4, os.SEEK_CUR)
                sky_offset = struct.unpack("<I", stream.read(4))[0]
            else:
                stream.seek(sky_test_pos)
                sky_offset = sky_count

            with open(sky_file_name, "wb") as out_sky:
                copy_from(out_sky, stream, sky_offset - 4)

            # Ignore extra skys for noclip but they are in the WAD
            # sky_index = 1
            # while True:
            #     sky_index += 1
            #     while True:
            #         if stream.tell() - start_offset > list_size - 4:
            #             raise RuntimeError("End of sky")
            #         sky_offset = struct.unpack("<I", stream.read(4))[0]
            #         if sky_offset == 0xFFFFFFFF:
            #             break
            #     while True:
            #         if stream.tell() - start_offset > list_size - 4:
            #             raise RuntimeError("End of sky")
            #         sky_offset = struct.unpack("<I", stream.read(4))[0]
            #         if sky_offset == 0:
            #             break
            #     while True:
            #         if stream.tell() - start_offset > list_size - 4:
            #             raise RuntimeError("End of sky")
            #         sky_offset = struct.unpack("<I", stream.read(4))[0]
            #         if sky_offset != 0:
            #             break
            #     if (stream.tell() - start_offset + sky_offset - 8) > list_size or sky_offset < 4:
            #         raise RuntimeError("Bad sky offset")
            #     sky_name = sky_pattern.replace("*", str(sky_index))
            #     with open(sky_name, "wb") as out_sky:
            #         copy_from(out_sky, stream, sky_offset - 4)
    except Exception as e:
        print(f"Exception: {e}")
