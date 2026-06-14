export function decompress(src: Uint8Array, outSize: number): Uint8Array {
  let i = 0;
  let dst: number[] = [];
  const n = src.length;

  const readU8 = (idx: number): number => {
    if (idx < 0 || idx >= n) return 0;
    return src[idx];
  };

  while (true) {
    if (outSize > 0 && dst.length >= outSize) {
      if (dst.length > outSize) dst.length = outSize;
      return new Uint8Array(dst);
    }
    if (i >= n) return new Uint8Array(dst);
    if (i + 1 >= n) {
      for (let k = i; k < n; k++) dst.push(src[k]);
      i = n;
      continue;
    }

    const b0 = readU8(i);
    const b1 = readU8(i + 1);
    const control = ((b0 << 8) | b1) >>> 0;
    i += 2;

    if ((control & 0x8800) === 0x8800) {
      const mode = (b0 >> 4) & 7;
      if (mode === 0) {
        let count = (control & 0x07ff) | b1;
        if (i + count > n) count = Math.max(0, n - i);
        for (let k = 0; k < count; k++) dst.push(src[i + k]);
        i += count;
      } else {
        const full = ((b0 << 8) | b1) >>> 0;
        const in_t0 = mode | ((full >> 5) & 0x38);
        let val = 0;
        if (in_t0 > 0 && in_t0 <= dst.length) {
          val = dst[dst.length - in_t0];
        }
        const repeatCount = b1 + 3;
        for (let k = 0; k < repeatCount; k++) dst.push(val);
      }
      continue;
    }

    const lengthNib = (b0 >> 4) & 7;
    let length = lengthNib;
    if (length === 7) {
      if (i >= n)
        throw new Error(
          `unexpected end of input while reading extended length at input ${i}`,
        );
      length = readU8(i) + 7;
      i++;
    }
    const copyLen = length + 3;

    const full = ((b0 << 8) | b1) >>> 0;
    const off = (full & 0x0fff) | b1;
    let srcStart = dst.length - off;
    if (srcStart < 0)
      throw new Error(`invalid LZ offset ${off} (dstlen=${dst.length})`);

    const reverse = (full & 0x8000) !== 0;

    if (!reverse) {
      let controlCnt = copyLen;
      if ((dst.length & srcStart & 1) !== 0) {
        dst.push(dst[srcStart]);
        srcStart++;
        controlCnt = length + 2;
      }

      const dstStart = dst.length;
      const srcEnd = srcStart + controlCnt;
      const overlap = srcStart < dstStart && srcEnd > dstStart;

      if (((dstStart | srcStart) & 1) === 0) {
        if (overlap) {
          const words = Math.floor(controlCnt / 2);
          const rem = controlCnt % 2;
          let readIdx = srcStart + controlCnt;
          if (rem !== 0) {
            readIdx--;
            dst.push(dst[readIdx]);
          }
          for (let w = 0; w < words; w++) {
            readIdx -= 2;
            dst.push(dst[readIdx]);
            dst.push(dst[readIdx + 1]);
          }
        } else {
          const words = Math.floor(controlCnt / 2);
          const rem = controlCnt % 2;
          for (let w = 0; w < words; w++) {
            dst.push(dst[srcStart + w * 2]);
            dst.push(dst[srcStart + w * 2 + 1]);
          }
          if (rem !== 0) dst.push(dst[srcStart + words * 2]);
        }
      } else {
        if (overlap) {
          for (let k = controlCnt - 1; k >= 0; k--) dst.push(dst[srcStart + k]);
        } else {
          for (let k = 0; k < controlCnt; k++) dst.push(dst[srcStart + k]);
        }
      }
    } else {
      let p = srcStart + 2;
      let remain = copyLen;
      while (remain >= 8) {
        if (p < 0 || p >= dst.length)
          throw new Error(`reverse read OOB p=${p} (dstlen=${dst.length})`);
        const seq: number[] = [dst[p]];
        for (let neg = 1; neg <= 7; neg++) {
          const idx = p - neg;
          if (idx < 0 || idx >= dst.length)
            throw new Error(
              `reverse read OOB idx=${idx} (dstlen=${dst.length})`,
            );
          seq.push(dst[idx]);
        }
        for (const b of seq) dst.push(b);
        p -= 8;
        remain -= 8;
      }
      while (remain > 0) {
        if (p < 0 || p >= dst.length)
          throw new Error(
            `reverse remainder read OOB p=${p} (dstlen=${dst.length})`,
          );
        dst.push(dst[p]);
        p--;
        remain--;
      }
    }
  }
}
