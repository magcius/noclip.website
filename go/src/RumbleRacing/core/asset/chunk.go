package asset

import (
	"encoding/binary"
	"fmt"
	"rumble-reader/helpers"
)

type Chunk struct {
	Offset  int
	Magic   [4]byte
	Size    uint32
	Payload []byte
}

func (c Chunk) MagicString() string {
	return string(c.Magic[:])
}

func ParseChunks(data []byte) ([]Chunk, error) {
	var chunks []Chunk
	offset := 0
	for offset < len(data) {
		if offset+8 > len(data) {
			return nil, fmt.Errorf("incomplete chunk header at offset %d", offset)
		}
		var magic [4]byte
		copy(magic[:], data[offset:offset+4])
		size := binary.LittleEndian.Uint32(data[offset+4 : offset+8])
		if size < 8 {
			return nil, fmt.Errorf("invalid chunk size %d for %q", size, magic)
		}
		chunkEnd := offset + int(size)
		if chunkEnd > len(data) {
			return nil, fmt.Errorf("chunk %q size %d exceeds remaining data", magic, size)
		}
		payload := data[offset:chunkEnd]

		helpers.ReverseBytesInPlace(magic[:])

		chunks = append(chunks, Chunk{
			Magic:   magic,
			Size:    size,
			Payload: payload,
		})
		offset = chunkEnd
	}
	return chunks, nil
}
