package shoc

import (
	"fmt"
)

func Decompress(src []byte, outSize int) ([]byte, error) {
	var (
		i   = 0
		dst = make([]byte, 0)
		n   = len(src)
	)

	readU8 := func(idx int) byte {
		if idx < 0 || idx >= n {
			return 0
		}
		return src[idx]
	}

	for {
		if outSize > 0 && len(dst) >= outSize {
			if len(dst) > outSize {
				dst = dst[:outSize]
			}
			return dst, nil
		}
		if i >= n {
			return dst, nil
		}
		if i+1 >= n {
			dst = append(dst, src[i:]...)
			i = n
			continue
		}

		b0 := readU8(i)
		b1 := readU8(i + 1)
		control := uint16(b0)<<8 | uint16(b1)
		i += 2

		if (control & 0x8800) == 0x8800 {
			mode := (b0 >> 4) & 7
			if mode == 0 {
				count := int(control&0x07FF) | int(b1)
				if i+count > n {
					count = max(0, n-i)
				}
				if count > 0 {
					dst = append(dst, src[i:i+count]...)
					i += count
				}
			} else {
				full := uint16(b0)<<8 | uint16(b1)
				in_t0 := int(mode) | int((full>>5)&0x38)
				var val byte
				if in_t0 > 0 && in_t0 <= len(dst) {
					val = dst[len(dst)-in_t0]
				} else {
					val = 0
				}
				repeatCount := int(b1) + 3
				if repeatCount > 0 {
					for k := 0; k < repeatCount; k++ {
						dst = append(dst, val)
					}
				}
			}
			continue
		}

		lengthNib := (b0 >> 4) & 7
		length := int(lengthNib)
		if length == 7 {
			if i >= n {
				return nil, fmt.Errorf("unexpected end of input while reading extended length at input %d", i)
			}
			ext := int(readU8(i))
			i++
			length = ext + 7
		}
		copyLen := length + 3

		full := uint16(b0)<<8 | uint16(b1)
		off := int((full & 0x0FFF) | uint16(b1))
		srcStart := len(dst) - off
		if srcStart < 0 {
			return nil, fmt.Errorf("invalid LZ offset %d (dstlen=%d)", off, len(dst))
		}

		reverse := (full & 0x8000) != 0

		if !reverse {
			controlCnt := copyLen
			if (len(dst) & srcStart & 1) != 0 {
				dst = append(dst, dst[srcStart])
				srcStart++
				controlCnt = length + 2
			}

			dstStart := len(dst)
			srcEnd := srcStart + controlCnt
			overlap := (srcStart < dstStart && srcEnd > dstStart)

			if ((dstStart | srcStart) & 1) == 0 {
				if overlap {
					words := controlCnt / 2
					rem := controlCnt % 2
					writeIdx := dstStart + controlCnt
					readIdx := srcStart + controlCnt
					if rem != 0 {
						writeIdx--
						readIdx--
						dst = append(dst, dst[readIdx])
					}
					for w := 0; w < words; w++ {
						readIdx -= 2
						hi := dst[readIdx]
						lo := dst[readIdx+1]
						dst = append(dst, hi, lo)
					}
				} else {
					words := controlCnt / 2
					rem := controlCnt % 2
					for w := 0; w < words; w++ {
						a := dst[srcStart+(w*2)]
						b := dst[srcStart+(w*2)+1]
						dst = append(dst, a, b)
					}
					if rem != 0 {
						dst = append(dst, dst[srcStart+words*2])
					}
				}
			} else {
				if overlap {
					for k := controlCnt - 1; k >= 0; k-- {
						dst = append(dst, dst[srcStart+k])
					}
				} else {
					for k := 0; k < controlCnt; k++ {
						dst = append(dst, dst[srcStart+k])
					}
				}
			}
		} else {
			p := srcStart + 2
			remain := copyLen
			for remain >= 8 {
				seq := make([]byte, 0, 8)
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
				dst = append(dst, seq...)
				p -= 8
				remain -= 8
			}
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
