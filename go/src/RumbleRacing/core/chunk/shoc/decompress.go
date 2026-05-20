package shoc

import (
	"fmt"
)

func Decompress(src []byte, outSize int) ([]byte, error) {
	var (
		i   = 0               // input index (pointer into src)
		dst = make([]byte, 0) // output buffer
		n   = len(src)
	)

	readU8 := func(idx int) byte {
		if idx < 0 || idx >= n {
			return 0
		}
		return src[idx]
	}

	// helper: ensure we can safely access src bytes when reading counts/extended length
	for {
		// stop when we've produced enough
		if outSize > 0 && len(dst) >= outSize {
			if len(dst) > outSize {
				dst = dst[:outSize]
			}
			return dst, nil
		}
		if i >= n {
			return dst, nil
		}
		// At least two bytes expected for a header; if not present copy remaining input as literal and finish.
		if i+1 >= n {
			// append remainder as literal bytes (fallback behavior)
			dst = append(dst, src[i:]...)
			i = n
			continue
		}

		b0 := readU8(i)
		b1 := readU8(i + 1)
		control := uint16(b0)<<8 | uint16(b1)
		i += 2

		// If high bits mark RLE/Literal block
		if (control & 0x8800) == 0x8800 {
			mode := (b0 >> 4) & 7
			if mode == 0 {
				// Literal: note decompiled code uses (control & 0x7FF) | b1 in one decomp,
				// but the common interpretation is literal count in low 11 bits. Use the more robust form:
				count := int(control&0x07FF) | int(b1) // mirror the decomp expression (keeps compatibility)
				// ensure not to read past input
				if i+count > n {
					count = max(0, n-i)
				}
				if count > 0 {
					dst = append(dst, src[i:i+count]...)
					i += count
				}
			} else {
				// RLE: build the in_t0 offset as decompiled: mode | ((full>>5) & 0x38)
				full := uint16(b0)<<8 | uint16(b1)
				in_t0 := int(mode) | int((full>>5)&0x38)
				// source byte is dst[len(dst)-in_t0]
				var val byte
				if in_t0 > 0 && in_t0 <= len(dst) {
					val = dst[len(dst)-in_t0]
				} else {
					// fallback zero when offset invalid (mirror earlier implementations)
					val = 0
				}
				repeatCount := int(b1) + 3
				if repeatCount > 0 {
					// simple repeat append
					for k := 0; k < repeatCount; k++ {
						dst = append(dst, val)
					}
				}
			}
			continue
		}

		// LZ backreference
		lengthNib := (b0 >> 4) & 7
		length := int(lengthNib)
		if length == 7 {
			// extended length stored in next byte
			if i >= n {
				return nil, fmt.Errorf("unexpected end of input while reading extended length at input %d", i)
			}
			ext := int(readU8(i))
			i++
			length = ext + 7
		}
		// actual copy length is length + 3
		copyLen := length + 3

		// compute offset exactly as decomp: puVar26 = puVar17 + -( (control & 0xfff) | b1 )
		full := uint16(b0)<<8 | uint16(b1)
		// Note: the decomp used `control` (which it had earlier as b0<<8) combined with b1 in various odd ways.
		// We replicate the offset computation used in the decomp: (control & 0x0fff) | b1
		off := int((full & 0x0FFF) | uint16(b1))
		// source start in dst
		srcStart := len(dst) - off
		if srcStart < 0 {
			return nil, fmt.Errorf("invalid LZ offset %d (dstlen=%d)", off, len(dst))
		}

		reverse := (full & 0x8000) != 0

		if !reverse {
			// Non-reverse path: the decomp checks alignment and may copy a single byte first if (dstPtr & srcStart & 1) != 0
			controlCnt := copyLen
			if (len(dst) & srcStart & 1) != 0 {
				// copy one byte first
				// This is an exact micro-semantic from the decompiled function.
				dst = append(dst, dst[srcStart])
				srcStart++
				controlCnt = length + 2
			}

			// Determine copy direction in overlapping case:
			// If srcStart < dstStart and ranges overlap [srcStart, srcStart+controlCnt) and [dstStart,dstStart+controlCnt),
			// perform backward copy to replicate C memmove/memcpy behavior when overlapping (original impl may rely on direction).
			dstStart := len(dst)
			srcEnd := srcStart + controlCnt
			// dstEnd := dstStart + controlCnt
			overlap := (srcStart < dstStart && srcEnd > dstStart)

			// Now choose word-vs-byte copy based on alignment rule in decomp:
			if ((dstStart | srcStart) & 1) == 0 {
				// word-aligned path (copy 2 bytes at a time, then remaining one if needed)
				// We'll use uint16 reads/writes but *explicitly* choose copy direction when overlap.
				if overlap {
					// copy backwards by words (and tail)
					// compute number of full words and remainder
					words := controlCnt / 2
					rem := controlCnt % 2
					// start indices for backward copy
					// final write position index for last byte will be dstStart+controlCnt-1
					writeIdx := dstStart + controlCnt
					readIdx := srcStart + controlCnt
					// if remainder, handle last odd byte first
					if rem != 0 {
						// last byte index
						writeIdx--
						readIdx--
						dst = append(dst, dst[readIdx])
					}
					// copy words backward
					for w := 0; w < words; w++ {
						// read last two bytes
						readIdx -= 2
						hi := dst[readIdx]
						lo := dst[readIdx+1]
						// write them at end (we append in correct order)
						dst = append(dst, hi, lo)
					}
				} else {
					// non-overlapping or srcStart >= dstStart: forward word copy
					words := controlCnt / 2
					rem := controlCnt % 2
					for w := 0; w < words; w++ {
						// append two bytes from source window
						a := dst[srcStart+(w*2)]
						b := dst[srcStart+(w*2)+1]
						dst = append(dst, a, b)
					}
					if rem != 0 {
						dst = append(dst, dst[srcStart+words*2])
					}
				}
			} else {
				// byte-wise copy
				if overlap {
					// copy backward by bytes
					for k := controlCnt - 1; k >= 0; k-- {
						dst = append(dst, dst[srcStart+k])
					}
				} else {
					// forward byte copy
					for k := 0; k < controlCnt; k++ {
						dst = append(dst, dst[srcStart+k])
					}
				}
			}
		} else {
			// reverse branch: follow decomp style:
			// in decompiled code they set in_t0_qw = puVar26 + 2 and perform a sequence of writes:
			// they iterate blocks of 8 and in each block write: p[0], p[-1], p[-2], ..., p[-7] then decrement p by 8
			p := srcStart + 2
			remain := copyLen
			// handle blocks of 8
			for remain >= 8 {
				// build sequence p[0], p[-1], ..., p[-7]
				seq := make([]byte, 0, 8)
				// safe bounds check — if we go OOB, return error rather than panic
				if p < 0 || p >= len(dst) {
					return nil, fmt.Errorf("reverse read OOB p=%d (dstlen=%d)", p, len(dst))
				}
				seq = append(seq, dst[p])
				for neg := 1; neg <= 7; neg++ {
					idx := p - neg
					if idx < 0 || idx >= len(dst) {
						return nil, fmt.Errorf("reverse read OOB idx=%d (dstlen=%d)", idx, len(dst))
					}
					seq = append(seq, dst[idx])
				}
				// append seq in that order
				dst = append(dst, seq...)
				p -= 8
				remain -= 8
			}
			// remainder: write rem bytes by reading from p downward
			for remain > 0 {
				if p < 0 || p >= len(dst) {
					return nil, fmt.Errorf("reverse remainder read OOB p=%d (dstlen=%d)", p, len(dst))
				}
				dst = append(dst, dst[p])
				p--
				remain--
			}
		}
	}
}
