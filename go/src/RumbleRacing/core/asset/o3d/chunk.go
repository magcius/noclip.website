package o3d

import (
	"encoding/binary"
	"fmt"
	"math"
	"rumble-reader/asset"
)

// Element Header?
type ELHE_Header struct {
	Raw asset.Chunk

	// Relevant Ghidra RE struct data:
	ChildCount       uint16 // 0x00
	MaybeNumTextures int16  // 0x02

	X float32 // 0x48
	Y float32 // 0x4C
	Z float32 // 0x50
	W float32 // 0x54

	RawZDebug   uint32
	RawZAddress int
}

// Element Texture/Translation?
type ELTL_TextureList struct {
	Raw asset.Chunk
}

// Raw element Data: mostly VIF + some texture/other metadata
type ELDA_Data struct {
	Raw asset.Chunk
}

type ObfChunk struct {
	ELHE *ELHE_Header
	ELTL *ELTL_TextureList
	ELDA *ELDA_Data
}

func parseObfChunks(data []byte) ([]ObfChunk, error) {
	var chunks []ObfChunk
	offset := 0

	currentObfChunk := ObfChunk{}
	chunkIndex := 0

	// fmt.Println(hex.Dump(data))
	for offset < len(data) {
		if offset+8 > len(data) {
			return nil, fmt.Errorf("incomplete chunk header at offset %d", offset)
		}
		var magic [4]byte
		copy(magic[:], data[offset:offset+4])

		size := binary.LittleEndian.Uint32(data[offset+4 : offset+8])
		// fmt.Println("OFFSET: ", offset, "SIZE:", size)

		// if size < 8 {
		// 	return nil, fmt.Errorf("invalid chunk size %d for %q", size, magic)
		// }
		chunkEnd := offset + int(size) + 8
		if chunkEnd > len(data) {
			return nil, fmt.Errorf("chunk %q size %d exceeds remaining data", magic, size)
		}
		payload := data[offset:chunkEnd]

		// If the chunk is HEAD, ignore it
		chunk := asset.Chunk{
			Offset:  offset,
			Magic:   magic,
			Size:    size,
			Payload: payload,
		}

		// Ignore HEAD chunk, skip past it
		if chunk.MagicString() == "HEAD" {
			offset = chunkEnd
			continue
		}

		chunkTypeCheck := chunkIndex % 3

		switch chunkTypeCheck {
		case 0:
			if currentObfChunk.ELHE != nil {
				panic("ELHE NOT NIL")
			}
			if chunk.MagicString() != "ELHE" {
				panic("NOT AN ELHE!")
			}

			elhe, err := parseELHE(chunk)
			if err != nil {
				panic("Something went wrong!")
			}
			currentObfChunk.ELHE = elhe

		case 1:
			if currentObfChunk.ELTL != nil {
				panic("ELTL NOT NIL")
			}
			if chunk.MagicString() != "ELTL" {
				panic("NOT AN ELTL!")
			}

			eltl, err := parseELTL(chunk)
			if err != nil {
				panic("Something went wrong!")
			}
			currentObfChunk.ELTL = eltl

		case 2:
			if currentObfChunk.ELDA != nil {
				panic("ELDA NOT NIL")
			}
			if chunk.MagicString() != "ELDA" {
				panic("NOT AN ELDA!")
			}

			elda, err := parseELDA(chunk)
			if err != nil {
				panic("Something went wrong!")
			}
			currentObfChunk.ELDA = elda
		}

		offset = chunkEnd
		chunkIndex++

		// fmt.Println(chunkIndex)
		if currentObfChunk.ELDA != nil && currentObfChunk.ELHE != nil && currentObfChunk.ELTL != nil {
			chunks = append(chunks, currentObfChunk)
			// fmt.Println("RESET")
			currentObfChunk = ObfChunk{}
		}
	}

	return chunks, nil
}

func parseELHE(chunk asset.Chunk) (*ELHE_Header, error) {
	base := 0x8
	elhe := ELHE_Header{
		Raw:              chunk,
		ChildCount:       binary.LittleEndian.Uint16(chunk.Payload[base : base+2]),
		MaybeNumTextures: int16(binary.LittleEndian.Uint16(chunk.Payload[base+0x2 : base+0x2+2])),
		// Unk2:             binary.LittleEndian.Uint16(chunk.Payload[base+0x6 : base+0x6+2]),
		X: math.Float32frombits(binary.LittleEndian.Uint32(chunk.Payload[base+0x48 : base+0x48+4])),
		Y: math.Float32frombits(binary.LittleEndian.Uint32(chunk.Payload[base+0x4C : base+0x4C+4])),
		Z: math.Float32frombits(binary.LittleEndian.Uint32(chunk.Payload[base+0x50 : base+0x50+4])),
		W: math.Float32frombits(binary.LittleEndian.Uint32(chunk.Payload[base+0x54 : base+0x54+4])),

		RawZDebug:   binary.LittleEndian.Uint32(chunk.Payload[base+0x50 : base+0x50+4]),
		RawZAddress: chunk.Offset + base + 0x50,
	}

	return &elhe, nil
}

func parseELTL(chunk asset.Chunk) (*ELTL_TextureList, error) {
	eltl := ELTL_TextureList{
		Raw: chunk,
	}

	return &eltl, nil
}

func parseELDA(chunk asset.Chunk) (*ELDA_Data, error) {
	elda := ELDA_Data{
		Raw: chunk,
	}

	return &elda, nil
}
