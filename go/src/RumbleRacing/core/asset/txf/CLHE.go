package txf

import (
	"encoding/binary"
)

type CLHE struct {
	Entries []CLHEEntry
}

type CLHEEntry struct {
	CLDAStartOffset     uint32
	Unk2                uint16
	VRAM_Dest           uint16
	CLUTImageSizeLookup uint16
	PixelFormat         uint16
}

func parseCLHE(buf []byte) (*CLHE, error) {
	buf = buf[8:]
	// repeated 12 bytes
	var entries []CLHEEntry

	for i := 0; i+0xc <= len(buf); i += 0xc {
		data := buf[i : i+0xc]
		// fmt.Println(hex.Dump(data))
		entries = append(entries, CLHEEntry{
			CLDAStartOffset:     binary.LittleEndian.Uint32(data[0:4]),
			Unk2:                binary.LittleEndian.Uint16(data[0x4 : 0x4+2]),
			VRAM_Dest:           binary.LittleEndian.Uint16(data[0x6 : 0x6+2]),
			CLUTImageSizeLookup: binary.LittleEndian.Uint16(data[0x8 : 0x8+2]),
			PixelFormat:         binary.LittleEndian.Uint16(data[0xa : 0xa+2]),
		})
	}
	// fmt.Println(len(buf))

	return &CLHE{
		Entries: entries,
	}, nil
}
