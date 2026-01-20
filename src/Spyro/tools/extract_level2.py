# Python adaptation of various parts from "Spyro World Viewer" by Kly_Men_COmpany

import os
import struct

MAX_SIZE = 1024 * 1024 * 16
VRAM_SIZE = 524288


def copy_from(dst_f, src_f, count):
    if count > MAX_SIZE:
        raise RuntimeError("Copy size too large")
    if count > 0:
        dst_f.write(src_f.read(count))


def read_u32(f):
    data = f.read(4)
    if len(data) < 4:
        raise EOFError("Unexpected EOF while reading u32")
    return struct.unpack("<I", data)[0]


def check_pattern(pattern_bytes: bytes) -> bool:
    p = pattern_bytes
    return not (
        ((p[0] & 0x0F) == 0) and
        ((p[1] >> 4) == 0) and
        (p[2] == 0) and
        (p[3] == 0) and
        ((p[4] & 0x0F) == 0) and
        ((p[5] >> 4) == 0) and
        (p[6] == 0) and
        (p[7] == 0) and
        ((p[8] & 0x0F) == 0) and
        ((p[9] >> 4) == 0) and
        (p[10] == 0) and
        (p[11] == 0)
    )


def extract_level(level_subfile):
    s = level_subfile.split('/sf')
    prefix = f"{s[0]}/sf{s[1].split(".")[0]}_"
    ground_file_name = f"{prefix}ground.bin"
    sky_file_name = f"{prefix}sky.bin"
    vram_file_name = f"{prefix}vram.bin"
    list_file_name = f"{prefix}list.bin"
    good = False
    stream = None
    save = None
    is_starring = "starring" in level_subfile
    try:
        stream = open(level_subfile, "rb")
        start = 0
        stream.seek(0, os.SEEK_END)
        size = stream.tell()
        startsub = start
        sizesub = size
        if size < 16:
            raise RuntimeError("Subfile too small")

        # VRAM
        print("Vram", end="\t\t...")
        stream.seek(start, os.SEEK_SET)
        offset = read_u32(stream)
        if start - startsub + size > sizesub:
            raise RuntimeError("Bounds error")
        stream.seek(start + offset, os.SEEK_SET)
        with open(vram_file_name, "wb") as save:
            count = 524288
            remaining = sizesub - (stream.tell() - startsub)
            if remaining < count:
                count = remaining
            copy_from(save, stream, count)

        # Texture/list
        stream.seek(start + 8, os.SEEK_SET)
        offset = read_u32(stream)
        size2 = read_u32(stream)
        start2 = start + offset
        if start2 - startsub + size2 > sizesub:
            raise RuntimeError("Bounds error")
        stream.seek(start2, os.SEEK_SET)
        offset = read_u32(stream)
        stream.seek(-4, os.SEEK_CUR)
        with open(list_file_name, "wb") as save:
            copy_from(save, stream, offset + 16)
        print("Ok!")
        print("\t\tSky", end="\t\t...")

        # Sky
        if is_starring:
            stream.seek(start2, os.SEEK_SET)
            ss = read_u32(stream)
            cc = read_u32(stream)
            sky_size = ss + 4
            sky_data = stream.read(sky_size)
            with open(sky_file_name, "wb") as save:
                save.write(sky_data)
            print("Ok! (starring)")
        else:
            try:
                stream.seek(start2, os.SEEK_SET)
                offset = read_u32(stream)
                stream.seek(offset - 4, os.SEEK_CUR)
                offset = read_u32(stream)
                stream.seek(offset - 4, os.SEEK_CUR)
                offset = read_u32(stream)
                stream.seek(offset - 4, os.SEEK_CUR)
                offset = read_u32(stream)
                stream.seek(offset - 4, os.SEEK_CUR)
                test_pos = stream.tell()
                pattern = stream.read(12)
                if len(pattern) < 12:
                    raise RuntimeError("Sky pattern read error")
                if check_pattern(pattern):
                    stream.seek(test_pos, os.SEEK_SET)
                    offset = read_u32(stream)
                    stream.seek(offset - 4, os.SEEK_CUR)
                    offset = read_u32(stream)
                    if offset == 0:
                        stream.seek(test_pos, os.SEEK_SET)
                    else:
                        stream.seek(offset - 4, os.SEEK_CUR)
                        offset = read_u32(stream)
                        if offset == 0:
                            stream.seek(test_pos, os.SEEK_SET)
                        stream.seek(8, os.SEEK_CUR)
                offset = read_u32(stream)
                stream.seek(offset - 4, os.SEEK_CUR)
                offset = read_u32(stream)
                with open(sky_file_name, "wb") as save:
                    copy_from(save, stream, offset - 4)
                print("Ok!")
            except Exception:
                print("Error!")

        # Ground
        print("\t\tGround  ", end="\t...")
        stream.seek(start2, os.SEEK_SET)
        offset = read_u32(stream)
        stream.seek(offset - 4, os.SEEK_CUR)
        offset = read_u32(stream)
        with open(ground_file_name, "wb") as save:
            copy_from(save, stream, offset - 4)
        print("Ok!")
        good = True
    except Exception as e:
        if good:
            print("Good")
        else:
            print("Error!")
            print("Exception:", e)
    finally:
        if stream is not None:
            stream.close()
