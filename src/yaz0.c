
#include <stdint.h>

static uint16_t read16be(uint8_t*b) {
    return (b[0] << 8 | b[1]);
}

__attribute__((visibility("default")))
void decompress(uint8_t*pDst, uint8_t*pSrc, int dstSize) {
  while(1) {
    int i = 8;
    uint8_t cmd = *pSrc++;
    while(i--) {
      if(cmd & (1 << i)) {
        dstSize--;
        *pDst++ = *pSrc++;
      } else {
        uint16_t t = read16be(pSrc);
        pSrc += 2;
        uint16_t w = (t & 0x0FFF) + 1;
        uint16_t n = (t >> 12) + 2;
        if(n == 2)
          n += *pSrc++ + 0x10;
        dstSize -= n;
        while(n--) {
          *pDst = pDst[-w];
          pDst++;
        }
      }
      if(dstSize <= 0)
        return;
    }
  }
}
