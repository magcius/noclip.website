#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>

typedef void *(__stdcall *ReadFromMemFn)(int len, void *data);
typedef void *(__stdcall *GetFileInfoFn)(void *file);
typedef void(__stdcall *CopyTexFn)(void *tex, int imageIndex, int mipIndex, void *layout,
                                   int destW, int destH, int destStride, void *dest);
typedef int(__stdcall *HasAlphaFn)(void *tex);
typedef void(__stdcall *FreeFileFn)(void *file);

#define FI_TEXTURE_COUNT 16
#define FI_TEXTURES 20
#define TEX_WIDTH 8
#define TEX_HEIGHT 12

static int rdI(void *base, int off) { return *(int *)((char *)base + off); }
static void *rdP(void *base, int off) { return *(void **)((char *)base + off); }

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: gr2_texbake in.gr2 out_prefix\n"); return 2; }

    HMODULE h = LoadLibraryA("granny2.dll");
    if (!h) { fprintf(stderr, "ERROR: LoadLibrary granny2.dll: %lu\n", (unsigned long)GetLastError()); return 3; }
    ReadFromMemFn ReadFromMem = (ReadFromMemFn)GetProcAddress(h, "_GrannyReadEntireFileFromMemory@8");
    GetFileInfoFn GetFileInfo = (GetFileInfoFn)GetProcAddress(h, "_GrannyGetFileInfo@4");
    CopyTexFn CopyTex = (CopyTexFn)GetProcAddress(h, "_GrannyCopyTextureImage@32");
    HasAlphaFn HasAlpha = (HasAlphaFn)GetProcAddress(h, "_GrannyTextureHasAlpha@4");
    FreeFileFn FreeFile = (FreeFileFn)GetProcAddress(h, "_GrannyFreeFile@4");

    void **ppLayout = (void **)GetProcAddress(h, "GrannyRGBA8888PixelFormat");
    if (!ReadFromMem || !GetFileInfo || !CopyTex || !ppLayout) {
        fprintf(stderr, "ERROR: missing granny export(s)\n"); return 4;
    }
    void *layout = *ppLayout;

    FILE *f = fopen(argv[1], "rb");
    if (!f) { perror("open input"); return 5; }
    fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET);
    void *data = malloc((size_t)sz);
    if (fread(data, 1, (size_t)sz, f) != (size_t)sz) { perror("read"); return 5; }
    fclose(f);

    void *file = ReadFromMem((int)sz, data);
    if (!file) { fprintf(stderr, "ERROR: GrannyReadEntireFileFromMemory failed\n"); return 6; }
    void *info = GetFileInfo(file);
    if (!info) { fprintf(stderr, "ERROR: GrannyGetFileInfo failed\n"); return 7; }

    int texCount = rdI(info, FI_TEXTURE_COUNT);
    void **textures = (void **)rdP(info, FI_TEXTURES);
    fprintf(stderr, "%s: %d textures\n", argv[1], texCount);

    for (int i = 0; i < texCount; i++) {
        void *tex = textures[i];
        int w = rdI(tex, TEX_WIDTH), hh = rdI(tex, TEX_HEIGHT);
        if (w <= 0 || hh <= 0) { fprintf(stderr, "  tex %d: bad size %dx%d, skipped\n", i, w, hh); continue; }
        void *dest = calloc(1, (size_t)w * hh * 4);
        CopyTex(tex, 0, 0, layout, w, hh, w * 4, dest);
        int alpha = HasAlpha ? HasAlpha(tex) : 1;

        char outName[1024];
        snprintf(outName, sizeof(outName), "%s.%d.tex", argv[2], i);
        FILE *o = fopen(outName, "wb");
        if (!o) { perror("open out"); free(dest); continue; }
        uint8_t header[16] = { 'G', 'T', 'E', 'X' };
        *(uint32_t *)(header + 4) = (uint32_t)w;
        *(uint32_t *)(header + 8) = (uint32_t)hh;
        *(uint32_t *)(header + 12) = alpha ? 1u : 0u;
        fwrite(header, 1, 16, o);
        fwrite(dest, 1, (size_t)w * hh * 4, o);
        fclose(o);
        free(dest);
        fprintf(stderr, "  tex %d: %dx%d alpha=%d -> %s\n", i, w, hh, alpha, outName);
    }

    if (FreeFile) FreeFile(file);
    return 0;
}
