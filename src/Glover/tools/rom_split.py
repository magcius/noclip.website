#!/usr/bin/env python3
import argparse
import os
import re
import struct

import yaml


def getLevelInfo(file):
    start_offset = file.tell()
    file_length = struct.unpack(">I", file.read(4))[0]
    end_offset = start_offset + file_length

    lev_name = b""
    while True:
        next_chr = file.read(1)
        if next_chr == b"\x00":
            break
        else:
            lev_name += next_chr
    lev_name = lev_name.decode()

    file.seek(start_offset)
    return file_length, lev_name


if __name__=="__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("rom", type=str,
                        help="rom file")
    parser.add_argument("file_table", type=str,
                        help="file table YAML")
    parser.add_argument("output_dir", type=str,
                        help="directory to write files into")
    args = parser.parse_args()

    try:
        os.makedirs(args.output_dir)
    except FileExistsError:
        pass

    with open(args.file_table, "r") as f:
        file_table = yaml.safe_load(f)

    with open(args.rom, "rb") as f:
        for file in file_table["bank_files"]:
            file_len = file["dataEndOffset"] - file["dataStartOffset"]
            f.seek(file["dataStartOffset"])
            file_data = f.read(file_len)
            if file["type"] == "texture_bank":
                sub_extension = ".tex"
            elif file["type"] == "object_bank":
                sub_extension = ".obj"
            if file_data[0:4] == b"FLA2":
                file_name = file["name"] + sub_extension + ".fla"
            else:
                file_name = file["name"] + sub_extension + ".bin"
            with open(os.path.join(args.output_dir, file_name), "wb") as f_out:
                f_out.write(file_data)
        
        nLevels = 0
        f.seek(file_table["landscapes"]["dataStartOffset"])
        while f.tell() < file_table["landscapes"]["dataEndOffset"]:
            lev_len, lev_name = getLevelInfo(f)
            print("Extracting level {:} '{:}' ({:} bytes at offset 0x{:08X}".format(
                nLevels, lev_name, lev_len, f.tell()))
            lev_name = re.sub(r'[^a-zA-Z0-9]', '', lev_name)
            file_name = "{:02d}.{:}.n64.lev".format(nLevels, lev_name)
            with open(os.path.join(args.output_dir, file_name), "wb") as f_out:
                f_out.write(f.read(lev_len))
            nLevels += 1
        print ("{:} levels extracted".format(nLevels))