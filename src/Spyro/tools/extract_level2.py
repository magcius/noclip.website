# Python adaptation of various parts from "Spyro World Viewer" by Kly_Men_COmpany

import os
import struct

MAX_SIZE = 1024 * 1024 * 16
VRAM_SIZE = 524288


def read_u32(f):
    data = f.read(4)
    if len(data) < 4:
        raise Exception("Unexpected EOF")
    return struct.unpack("<I", data)[0]


def copy_from(dst, src, count):
    if count > MAX_SIZE:
        raise Exception("Abort: too large")
    if count > 0:
        dst.write(src.read(count))


def check_pattern(pattern) -> bool:
    return not (
        ((pattern[0] & 15) == 0) and
        ((pattern[1] >> 4) == 0) and
        (pattern[2] == 0) and
        (pattern[3] == 0) and
        ((pattern[4] & 15) == 0) and
        ((pattern[5] >> 4) == 0) and
        (pattern[6] == 0) and
        (pattern[7] == 0) and
        ((pattern[8] & 15) == 0) and
        ((pattern[9] >> 4) == 0) and
        (pattern[10] == 0) and
        (pattern[11] == 0)
    )


def extract_level2(level_subfile, game_number):
    if game_number == 3 and "43" in level_subfile:
        return
    s = level_subfile.split('/sf')
    prefix = f"{s[0]}/sf{s[1].split(".")[0]}_"
    ground_file_name = f"{prefix}ground.bin"
    sky_file_name = f"{prefix}sky.bin"
    vram_file_name = f"{prefix}vram.bin"
    list_file_name = f"{prefix}list.bin"

    with open(level_subfile, "rb") as stream:
        start = 0
        size = os.path.getsize(level_subfile)
        startsub = start
        sizesub = size
        if size < 16:
            raise Exception("Abort")

        # VRAM
        stream.seek(start)
        offset = read_u32(stream)
        if start - startsub + size > sizesub:
            raise Exception("Abort")
        stream.seek(start + offset)
        count = VRAM_SIZE
        remaining = sizesub - (stream.tell() - startsub)
        if remaining < count:
            count = remaining

        with open(vram_file_name, "wb") as save:
            copy_from(save, stream, count)

        # Texture list
        stream.seek(start + 8)
        offset = read_u32(stream)
        size2 = read_u32(stream)

        start = start + offset
        if start - startsub + size2 > sizesub:
            raise Exception("Abort")

        stream.seek(start)
        offset = read_u32(stream)
        stream.seek(-4, os.SEEK_CUR)

        with open(list_file_name, "wb") as save:
            copy_from(save, stream, offset + 16)

        # Sky
        try:
            stream.seek(start)

            offset = read_u32(stream)
            if (stream.tell() - start + offset - 8) > size2 or offset < 4:
                raise Exception("Abort")
            stream.seek(offset - 4, os.SEEK_CUR)

            offset = read_u32(stream)
            if (stream.tell() - start + offset - 8) > size2:
                raise Exception("Abort")
            stream.seek(offset - 4, os.SEEK_CUR)

            offset = read_u32(stream)
            if (stream.tell() - start + offset - 8) > size2 or offset < 4:
                raise Exception("Abort")
            stream.seek(offset - 4, os.SEEK_CUR)

            offset = read_u32(stream)
            if (stream.tell() - start + offset - 8) > size2 or offset < 4:
                raise Exception("Abort")

            stream.seek(offset - 4, os.SEEK_CUR)
            test = stream.tell()

            pattern = list(stream.read(12))

            def goto_label():
                off = read_u32(stream)
                if (stream.tell() - start + off - 8) > size2 or off < 4:
                    raise Exception("Abort")
                with open(sky_file_name, "wb") as save:
                    copy_from(save, stream, off - 4)
                return True

            if check_pattern(pattern):
                stream.seek(test)
                offset = read_u32(stream)
                if (stream.tell() - start + offset - 8) > size2 or offset < 4:
                    raise Exception("Abort")
                stream.seek(offset - 4, os.SEEK_CUR)

                offset = read_u32(stream)
                if offset == 0:
                    stream.seek(test)
                    goto_label()
                    return

                if (stream.tell() - start + offset - 8) > size2 or offset < 4:
                    raise Exception("Abort")
                stream.seek(offset - 4, os.SEEK_CUR)

                offset = read_u32(stream)
                if offset == 0:
                    stream.seek(test)
                    goto_label()
                    return

                stream.seek(8, os.SEEK_CUR)

            offset = read_u32(stream)
            if (stream.tell() - start + offset - 8) > size2 or offset < 4:
                raise Exception("Abort")
            stream.seek(offset - 4, os.SEEK_CUR)

            goto_label()
        except:
            print("Error!")

        # Ground
        stream.seek(start)
        offset = read_u32(stream)
        stream.seek(offset - 4, os.SEEK_CUR)
        offset = read_u32(stream)
        with open(ground_file_name, "wb") as save:
            copy_from(save, stream, offset - 4)

        # Sublevels' ground
        if game_number == 3:
            i = 1
            while True:
                i += 1
                stream.seek(startsub + 16 * i, os.SEEK_SET)
                offset = read_u32(stream)
                size3 = read_u32(stream)

                start = startsub + offset
                if start - startsub + size3 > sizesub:
                    break

                stream.seek(start, os.SEEK_SET)
                offset = read_u32(stream)
                if (stream.tell() - start + offset - 8) > size3 or offset < 4:
                    break
                stream.seek(offset - 4, os.SEEK_CUR)

                while True:
                    if stream.tell() - start > size3 - 4:
                        raise Exception("Abort 3")
                    offset = read_u32(stream)
                    if offset != 0:
                        break
                while True:
                    if stream.tell() - start > size3 - 4:
                        raise Exception("Abort 3")
                    offset = read_u32(stream)
                    if offset == 0:
                        break
                while True:
                    if stream.tell() - start > size3 - 4:
                        raise Exception("Abort 3")
                    offset = read_u32(stream)
                    if offset != 0:
                        break
                while True:
                    if stream.tell() - start > size3 - 4:
                        raise Exception("Abort 3")
                    offset = read_u32(stream)
                    if offset == 0:
                        break
                while True:
                    if stream.tell() - start > size3 - 4:
                        raise Exception("Abort 3")
                    offset = read_u32(stream)
                    if offset != 0:
                        break

                if (stream.tell() - start + offset - 8) > size3 or offset < 4:
                    break

                outname = ground_file_name.replace("ground", f"ground{i}")
                with open(outname, "wb") as save:
                    copy_from(save, stream, offset - 4)
