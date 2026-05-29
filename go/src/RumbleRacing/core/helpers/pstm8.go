package helpers

import (
	"fmt"
)

type PixelBytes struct {
	Bytes []byte
}

type Coord struct {
	X uint8
	Y uint8
}

func mapLinearIndexToCoord(linearIndex uint8) Coord {
	yMajor := linearIndex >> 6
	iBlock := linearIndex & 0x3F
	xMajor := iBlock >> 4
	xBase := (xMajor & 1) << 3
	xOffset := iBlock & 0x07
	x := xBase + xOffset
	yMinorBase := (xMajor >> 1) << 1
	yMinorOffset := (iBlock >> 3) & 1
	y := (yMajor << 2) + yMinorBase + yMinorOffset
	return Coord{X: x, Y: y}
}

func GroupBytesIntoChunks(data []byte, chunkSize int) []PixelBytes {
	if chunkSize <= 0 {
		panic("chunkSize must be greater than 0")
	}

	if len(data)%chunkSize != 0 {
		fmt.Printf("Warning: data length %d not divisible by chunkSize %d\n",
			len(data), chunkSize)
	}

	var chunks []PixelBytes
	for i := 0; i < len(data); i += chunkSize {
		end := i + chunkSize
		if end > len(data) {
			end = len(data)
		}
		chunk := make([]byte, end-i)
		copy(chunk, data[i:end])
		// fmt.Println(i, end, chunk, len(data))
		chunks = append(chunks, PixelBytes{
			Bytes: chunk,
		})
	}

	return chunks
}

func SwizzleClutPstm8[T any](data []T) ([]T, error) {
	if len(data) != 256 {
		var zeroSlice []T
		return zeroSlice, fmt.Errorf("input array must contain exactly 256 elements, but got %d", len(data))
	}

	result := make([]T, 256)

	for i := 0; i < 256; i++ {
		linearIndex := uint8(i)
		coord := mapLinearIndexToCoord(linearIndex)
		flatIndex := int(coord.Y)*16 + int(coord.X)
		result[flatIndex] = data[i]
	}

	return result, nil
}

func SwizzleClutPstm4_16[T any](data []T) ([]T, error) {
	if len(data) != 16 {
		var zero []T
		return zero, fmt.Errorf("input must be 16 elements, got %d", len(data))
	}

	result := make([]T, 16)

	for i := 0; i < 16; i++ {
		y := i / 8
		x := i % 8
		flatIndex := y*8 + x

		result[flatIndex] = data[i]
	}

	return result, nil
}
