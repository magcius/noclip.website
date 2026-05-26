#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

typedef int(__stdcall *DecompressFn)(int Format, int CompressedBytesSize, void *CompressedBytes,
                                     int Stop0, int Stop1, int Stop2, void *DecompressedBytes);

static uint32_t rd32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static void wr32(uint8_t *p, uint32_t v) {
    p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24);
}
static size_t align4(size_t x) { return (x + 3u) & ~(size_t)3u; }

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: gr2_decompress in.gr2 out.gr2\n");
        return 2;
    }

    HMODULE h = LoadLibraryA("granny2.dll");
    if (!h) {
        fprintf(stderr, "ERROR: LoadLibrary(granny2.dll) failed: %lu\n", (unsigned long)GetLastError());
        return 3;
    }
    DecompressFn Decompress = (DecompressFn)GetProcAddress(h, "_GrannyDecompressData@28");
    if (!Decompress) {
        fprintf(stderr, "ERROR: GetProcAddress(_GrannyDecompressData@28) failed\n");
        return 4;
    }

    FILE *f = fopen(argv[1], "rb");
    if (!f) { perror("open input"); return 5; }
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *in = (uint8_t *)malloc((size_t)sz);
    if (fread(in, 1, (size_t)sz, f) != (size_t)sz) { perror("read input"); return 5; }
    fclose(f);

    if (sz < 0x60) { fprintf(stderr, "ERROR: file too small\n"); return 5; }

    uint32_t sectionArrayOffset = 0x20 + rd32(in + 0x2c);
    uint32_t sectionCount = rd32(in + 0x30);
    uint32_t headerEnd = sectionArrayOffset + sectionCount * 44;

    if ((size_t)sectionArrayOffset > (size_t)sz || (size_t)headerEnd > (size_t)sz) {
        fprintf(stderr, "ERROR: section table @%u..%u exceeds file size %ld\n",
                sectionArrayOffset, headerEnd, sz);
        return 7;
    }

    size_t outCap = headerEnd + 64;
    for (uint32_t i = 0; i < sectionCount; i++) {
        const uint8_t *s = in + sectionArrayOffset + i * 44;
        outCap += rd32(s + 12) + rd32(s + 32) * 12 + 32;
    }
    uint8_t *out = (uint8_t *)calloc(1, outCap);
    memcpy(out, in, headerEnd);

    size_t cursor = align4(headerEnd);
    for (uint32_t i = 0; i < sectionCount; i++) {
        const uint8_t *sin = in + sectionArrayOffset + i * 44;
        uint32_t comp = rd32(sin + 0), dataOff = rd32(sin + 4), compSize = rd32(sin + 8),
                 decSize = rd32(sin + 12), align = rd32(sin + 16), stop0 = rd32(sin + 20),
                 stop1 = rd32(sin + 24), fixOff = rd32(sin + 28), fixCnt = rd32(sin + 32);

        if ((size_t)dataOff + (size_t)compSize > (size_t)sz) {
            fprintf(stderr, "ERROR: section %u data range %u+%u exceeds file size %ld\n",
                    i, dataOff, compSize, sz);
            return 7;
        }
        if (fixCnt > 0 && ((size_t)fixOff + (size_t)fixCnt * 12 > (size_t)sz)) {
            fprintf(stderr, "ERROR: section %u fixup range %u+%u*12 exceeds file size %ld\n",
                    i, fixOff, fixCnt, sz);
            return 7;
        }

        size_t newDataOff = cursor;
        if (decSize > 0) {
            if (comp == 0) {
                memcpy(out + cursor, in + dataOff, decSize);
            } else {

                uint8_t *cbuf = (uint8_t *)calloc(1, compSize + 16);
                memcpy(cbuf, in + dataOff, compSize);
                int ok = Decompress((int)comp, (int)compSize, cbuf, (int)stop0, (int)stop1, (int)decSize, out + cursor);
                free(cbuf);

                if (!ok)
                    fprintf(stderr, "  note: section %u Decompress returned 0 (type %u)\n", i, comp);
            }
        }
        cursor = align4(cursor + decSize);

        size_t newFixOff = 0;
        if (fixCnt > 0) {
            newFixOff = cursor;
            memcpy(out + cursor, in + fixOff, (size_t)fixCnt * 12);
            cursor = align4(cursor + (size_t)fixCnt * 12);
        }

        uint8_t *sout = out + sectionArrayOffset + i * 44;
        wr32(sout + 0, 0);
        wr32(sout + 4, (uint32_t)newDataOff);
        wr32(sout + 8, decSize);
        wr32(sout + 12, decSize);
        wr32(sout + 16, align);
        wr32(sout + 20, 0);
        wr32(sout + 24, 0);
        wr32(sout + 28, fixCnt ? (uint32_t)newFixOff : 0);
        wr32(sout + 32, fixCnt);
        wr32(sout + 36, 0);
        wr32(sout + 40, 0);
    }

    wr32(out + 0x24, (uint32_t)cursor);

    FILE *o = fopen(argv[2], "wb");
    if (!o) { perror("open output"); return 6; }
    fwrite(out, 1, cursor, o);
    fclose(o);
    fprintf(stderr, "OK: %s -> %s (%u sections, %zu bytes)\n", argv[1], argv[2], sectionCount, cursor);
    return 0;
}
