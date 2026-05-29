package txf

import (
	"encoding/binary"
	"fmt"
)

type HEAD struct {
	Size uint32

	// Offsets in comments are offset from start of TXF File
	// this is because I reverse engineered them relative to the beginning of the TXF file.
	AllocBytes       uint16   // 0x10
	TotalTextures    uint16   // 0x12
	CLHEIterations   uint8    // 0x14
	ZTHEsCount       uint8    // 0x15
	HeadPointerCount uint8    // 0x16
	UnusedByte       uint8    // 0x17
	ZTHEFilePointers []uint32 // 4 byte absolute pointers to ZTHEs starting data within the entire TXF file. Repeats until end of HEAD section
}

func parseHEAD(buf []byte) (*HEAD, error) {

	// typical of all chunks, extract it anyway
	size := binary.LittleEndian.Uint32(buf[4:8])

	// HEAD data
	alloc := binary.LittleEndian.Uint16(buf[8:10])

	totalTextures := binary.LittleEndian.Uint16(buf[10:12])

	// missing something here
	clheIterations := buf[12]
	zthesCount := buf[13]
	headPointerCount := buf[14]
	unusedByte := buf[15]

	pointers := buf[16:]

	// fmt.Println(totalTextures, clheIterations, zthesCount, headPointerCount, unusedByte)

	if len(pointers)/4 != int(headPointerCount) {
		fmt.Println(len(pointers)/4, int(headPointerCount))
		panic("remaining head pointers byte length is not equal to the pointer count")
	}

	var ptrs []uint32

	for i := 0; i+4 <= len(pointers); i += 4 {
		nextPointer := binary.LittleEndian.Uint32(pointers[i : i+4])
		ptrs = append(ptrs, nextPointer)
	}

	// fmt.Println(hex.Dump(pointers))
	// fmt.Println(hex.Dump(buf))

	return &HEAD{
		Size:             size,
		AllocBytes:       alloc,
		TotalTextures:    totalTextures,
		CLHEIterations:   clheIterations,
		ZTHEsCount:       zthesCount,
		HeadPointerCount: headPointerCount,
		UnusedByte:       unusedByte,
		ZTHEFilePointers: ptrs,
	}, nil
}
