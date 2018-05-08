
#include <stdint.h>

static uint8_t expand3to8(uint8_t n) {
    return (n << (8 - 3)) | (n << (8 - 6)) | (n >> (9 - 8));
}

static uint8_t expand4to8(uint8_t n) {
    return (n << 4) | n;
}

static uint8_t expand5to8(uint8_t n) {
    return (n << (8 - 5)) | (n >> (10 - 8));
}

static uint8_t expand6to8(uint8_t n) {
    return (n << (8 - 6)) | (n >> (12 - 8));
}

// GX uses a HW approximation of 3/8 + 5/8 instead of 1/3 + 2/3.
static uint8_t s3tcblend(uint8_t a, uint8_t b) {
    // return (a*3 + b*5) / 8;
    return (((a << 1) + a) + ((b << 2) + b)) >> 3;
}

static uint16_t read16be(uint8_t*b) {
    return (b[0] << 8 | b[1]);
}

// XXX(jstpierre): VS Code Intellisense seems to hate this attribute declaration...
#ifdef __INTELLISENSE__
#define EXPORT
#else
#define EXPORT __attribute__((visibility("default")))
#endif

EXPORT void decode_CMPR(uint8_t*pDst, uint8_t*pSrc, uint32_t w, uint32_t h) {
    for (uint32_t yy = 0; yy < h; yy += 8) {
        for (uint32_t xx = 0; xx < w; xx += 8) {
            for (uint32_t yb = 0; yb < 8; yb += 4) {
                for (uint32_t xb = 0; xb < 8; xb += 4) {
                    uint8_t colorTable[16];

                    // CMPR difference: Big-endian color1/2
                    uint16_t color1 = read16be(&pSrc[0]);
                    uint16_t color2 = read16be(&pSrc[2]);

                    // Fill in first two colors in color table.
                    colorTable[0] = expand5to8((color1 >> 11) & 0x1F);
                    colorTable[1] = expand6to8((color1 >> 5) & 0x3F);
                    colorTable[2] = expand5to8(color1 & 0x1F);
                    colorTable[3] = 0xFF;

                    colorTable[4] = expand5to8((color2 >> 11) & 0x1F);
                    colorTable[5] = expand6to8((color2 >> 5) & 0x3F);
                    colorTable[6] = expand5to8(color2 & 0x1F);
                    colorTable[7] = 0xFF;

                    if (color1 > color2) {
                        // Predict gradients.
                        colorTable[8]  = s3tcblend(colorTable[4], colorTable[0]);
                        colorTable[9]  = s3tcblend(colorTable[5], colorTable[1]);
                        colorTable[10] = s3tcblend(colorTable[6], colorTable[2]);
                        colorTable[11] = 0xFF;

                        colorTable[12] = s3tcblend(colorTable[0], colorTable[4]);
                        colorTable[13] = s3tcblend(colorTable[1], colorTable[5]);
                        colorTable[14] = s3tcblend(colorTable[2], colorTable[6]);
                        colorTable[15] = 0xFF;
                    } else {
                        colorTable[8]  = (colorTable[0] + colorTable[4]) >> 1;
                        colorTable[9]  = (colorTable[1] + colorTable[5]) >> 1;
                        colorTable[10] = (colorTable[2] + colorTable[6]) >> 1;
                        colorTable[11] = 0xFF;

                        // CMPR difference: GX fills with an alpha 0 midway point here.
                        colorTable[12] = colorTable[8];
                        colorTable[13] = colorTable[9];
                        colorTable[14] = colorTable[10];
                        colorTable[15] = 0x00;
                    }

                    for (uint8_t y = 0; y < 4; y++) {
                        uint8_t bits = pSrc[0x04 + y];
                        for (uint8_t x = 0; x < 4; x++) {
                            uint32_t dstPx = (yy + yb + y) * w + xx + xb + x;
                            uint32_t dstOffs = dstPx * 4;
                            uint8_t colorIdx = (bits >> 6) & 0x03;
                            pDst[dstOffs + 0] = colorTable[colorIdx * 4 + 0];
                            pDst[dstOffs + 1] = colorTable[colorIdx * 4 + 1];
                            pDst[dstOffs + 2] = colorTable[colorIdx * 4 + 2];
                            pDst[dstOffs + 3] = colorTable[colorIdx * 4 + 3];
                            bits <<= 2;
                        }
                    }

                    pSrc += 8;
                }
            }
        }
    }
}

#define DECODE_TILED_BEGIN(bw, bh) \
    for (uint32_t yy = 0; yy < h; yy += bh) { \
        for (uint32_t xx = 0; xx < w; xx += bw) { \
            for (uint32_t y = 0; y < bh; y++) { \
                for (uint32_t x = 0; x < bw; x++) { \
                    uint32_t dstPixel = (w * (yy + y)) + xx + x; \
                    uint32_t dstOffs = dstPixel * 4; \

#define DECODE_TILED_END() \
                } \
            } \
        } \
    }

EXPORT void decode_I8(uint8_t*pDst, uint8_t*pSrc, uint32_t w, uint32_t h) {
    DECODE_TILED_BEGIN(8, 4)
        uint8_t i = *pSrc++;
        pDst[dstOffs + 0] = i;
        pDst[dstOffs + 1] = i;
        pDst[dstOffs + 2] = i;
        pDst[dstOffs + 3] = i;
    DECODE_TILED_END()
}

EXPORT void decode_I4(uint8_t*pDst, uint8_t*pSrc, uint32_t w, uint32_t h) {
    uint8_t b = 0;

    DECODE_TILED_BEGIN(8, 8)
        uint8_t ii = *pSrc;
        uint8_t i4 = (b == 1 ? (ii >> 4) : ii) & 0x0F;
        uint8_t i = expand4to8(i4);
        pDst[dstOffs + 0] = i;
        pDst[dstOffs + 1] = i;
        pDst[dstOffs + 2] = i;
        pDst[dstOffs + 3] = i;
        if (b == 1)
            pSrc++;
        b = (b + 1) % 2;
    DECODE_TILED_END()
}
