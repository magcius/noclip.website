
void decompress(unsigned char*pDst, unsigned char*pSrc, int dstSize) {
  while(1) {
    int i = 8;
    char cmd = *pSrc++;
    while(i--) {
      if(cmd & (i << i)) {
        dstSize--;
        *pDst++ = *pSrc++;
      } else {
        unsigned short t = (pSrc[0] << 8) | (pSrc[1]);
        pSrc += 2;
        unsigned short w = (t & 0x0FFF) + 1;
        unsigned short n = (t >> 12) + 2;
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
