# Python adaptation of various parts from "Spyro World Viewer" by Kly_Men_COmpany

import struct
import json


class HeaderGround1:
    fmt = "<hhHhBBBBBBBBI"
    size = struct.calcsize(fmt)
    def __init__(self, data):
        (self.y, self.x, self.i0, self.z,
            self.v1, self.c1, self.p1, self.i1,
            self.v2, self.c2, self.p2, self.i2,
            self.f) = struct.unpack(self.fmt, data)

class VertexGround1:
    fmt = "<BBBB"
    size = struct.calcsize(fmt)
    def __init__(self, data):
        self.b1, self.b2, self.b3, self.b4 = struct.unpack(self.fmt, data)

class ColorGround1:
    fmt = "<BBBB"
    size = struct.calcsize(fmt)
    def __init__(self, data):
        self.r, self.g, self.b, self.n = struct.unpack(self.fmt, data)

class Poly1Ground1:
    fmt = "<BBBBBBBB"
    size = struct.calcsize(fmt)
    def __init__(self, data):
        (self.n, self.v1, self.v2, self.v3,
            self.f, self.c1, self.c2, self.c3) = struct.unpack(self.fmt, data)

class Poly2Ground1:
    fmt = "<BBBBBBBBBBBBBBBB"
    size = struct.calcsize(fmt)
    def __init__(self, data):
        (self.v1, self.v2, self.v3, self.v4,
            self.c1, self.c2, self.c3, self.c4,
            self.t, self.r, self.s1, self.s2,
            self.i, self.s3, self.s4, self.s5) = struct.unpack(self.fmt, data)


def export_ground_json(ground_file):
    prefix = ground_file.split("_")[0] + "_"
    out_json = f"{prefix}export.json"

    vertices = []
    colors = []
    faces = []
    with open(ground_file, "rb") as stream, open(ground_file, "rb") as seeker:
        size = stream.seek(0, 2)
        stream.seek(0)
        seeker.seek(0)

        partcnt_bytes = seeker.read(4)
        if len(partcnt_bytes) != 4:
            raise RuntimeError("Failed to read part count")
        partcnt = struct.unpack("<I", partcnt_bytes)[0]

        start = 8
        j = 0

        vert_base = 0
        color_base = 0

        while partcnt > 0:
            partcnt -= 1
            j += 1

            raw_offset = seeker.read(4)
            if len(raw_offset) != 4:
                break
            offset = struct.unpack("<I", raw_offset)[0]
            if offset > size:
                break

            abs_pos = offset + start
            stream.seek(abs_pos)

            header_data = stream.read(HeaderGround1.size)
            if len(header_data) != HeaderGround1.size:
                break
            header = HeaderGround1(header_data)

            # --- LOD vertices (positions only) ---
            count = header.v1
            for _ in range(count):
                vdata = stream.read(VertexGround1.size)
                if len(vdata) != VertexGround1.size:
                    break
                v = VertexGround1(vdata)
                z = (v.b1 | ((v.b2 & 3) << 8)) + header.z
                y = ((v.b2 >> 2) | ((v.b3 & 31) << 6)) + header.y
                x = ((v.b3 >> 5) | (v.b4 << 3)) + header.x
                vertices.append([x, y, z])

            # --- LOD colors ---
            count = header.c1
            for _ in range(count):
                cdata = stream.read(ColorGround1.size)
                if len(cdata) != ColorGround1.size:
                    break
                c = ColorGround1(cdata)
                colors.append([c.r, c.g, c.b])

            # --- LOD polys (untextured) ---
            count = header.p1
            for _ in range(count):
                pdata = stream.read(Poly1Ground1.size)
                if len(pdata) != Poly1Ground1.size:
                    break
                p = Poly1Ground1(pdata)
                v1 = (p.v1 & 63)
                v2 = (p.v1 >> 6) | ((p.v2 & 15) << 2)
                v3 = (p.v2 >> 4) | ((p.v3 & 3) << 4)
                v4 = (p.v3 >> 2)
                a = vert_base + v1
                b = vert_base + v2
                c = vert_base + v3
                d = vert_base + v4
                if v1 == v2:
                    faces.append({ "indices":[b, c, d], "texture":None, "rotation":None })
                elif v2 == v3:
                    faces.append({ "indices":[a, c, d], "texture":None, "rotation":None })
                elif v3 == v4:
                    faces.append({ "indices":[a, b, d], "texture":None, "rotation":None })
                elif v4 == v1:
                    faces.append({ "indices":[a, b, c], "texture":None, "rotation":None })
                else:
                    faces.append({ "indices":[b, a, c], "texture":None, "rotation":None })
                    faces.append({ "indices":[c, a, d], "texture":None, "rotation":None })

            # --- MDL/FAR/TEX vertices (positions only) ---
            count = header.v2
            mdl_vert_start = len(vertices)
            for _ in range(count):
                vdata = stream.read(VertexGround1.size)
                if len(vdata) != VertexGround1.size:
                    break
                v = VertexGround1(vdata)
                z = (v.b1 | ((v.b2 & 3) << 8)) + header.z
                y = ((v.b2 >> 2) | ((v.b3 & 31) << 6)) + header.y
                x = ((v.b3 >> 5) | (v.b4 << 3)) + header.x
                vertices.append([x, y, z])

            # --- MDL colors ---
            count = header.c2
            for _ in range(count):
                cdata = stream.read(ColorGround1.size)
                if len(cdata) != ColorGround1.size:
                    break
                c = ColorGround1(cdata)
                colors.append([c.r, c.g, c.b])

            # --- FAR colors (ignored for JSON) ---
            count = header.c2
            stream.seek(ColorGround1.size * count, 1)

            # --- MDL/FAR/TEX polys (textured) ---
            count = header.p2
            for _ in range(count):
                pdata = stream.read(Poly2Ground1.size)
                if len(pdata) != Poly2Ground1.size:
                    break
                p = Poly2Ground1(pdata)

                a = mdl_vert_start + p.v1
                b = mdl_vert_start + p.v2
                c = mdl_vert_start + p.v3
                d = mdl_vert_start + p.v4

                if p.v1 == p.v2:
                    faces.append({ "indices":[d, c, b], "texture":p.t, "rotation":p.r })
                elif p.v2 == p.v3:
                    faces.append({ "indices":[a, c, d], "texture":p.t, "rotation":p.r })
                elif p.v3 == p.v4:
                    faces.append({ "indices":[a, b, d], "texture":p.t, "rotation":p.r })
                elif p.v4 == p.v1:
                    faces.append({ "indices":[a, b, c], "texture":p.t, "rotation":p.r })
                else:
                    faces.append({ "indices":[a, b, c], "texture":p.t, "rotation":p.r })
                    faces.append({ "indices":[a, c, d], "texture":p.t, "rotation":p.r })
            vert_base = len(vertices)
            color_base = len(colors)

    out = {
        "vertices": vertices,
        "colors": colors,
        "faces": faces,
        "uvs": None  # placeholder
    }

    with open(out_json, "w") as f:
        json.dump(out, f, indent=None)
