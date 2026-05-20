package helpers

import (
	"fmt"
)

// Pixel Storage Mode 8
// represents 0 -> 0xff texel indexing format
// this is how the 2 byte per RGBA color CLUT is re-arraigned.

// TwoBytePair represents a 16-bit data unit read from the linear array.
type PixelBytes struct {
	Bytes []byte
}

// Coord represents the (X, Y) location in the 16x16 CLUT grid.
type Coord struct {
	X uint8
	Y uint8
}

// mapLinearIndexToCoord implements the custom indexing (swizzling) algorithm
// to map a linear 8-bit index (0-255) to its (X, Y) coordinate in the 16x16 grid.
func mapLinearIndexToCoord(linearIndex uint8) Coord {
	// Logic derived from the IDTEX8 CLUT pattern:

	// yMajor: The most significant bit of the index, determining the top/bottom half (Y[3] is derived from I[6], not I[7] directly)
	yMajor := linearIndex >> 6 // Bits I[7:6] -> H, which affects Y

	iBlock := linearIndex & 0x3F // I[5:0]

	xMajor := iBlock >> 4 // Bits I[5:4]

	xBase := (xMajor & 1) << 3 // X base offset (0 or 8) is determined by I[4] here, which is part of the pattern

	xOffset := iBlock & 0x07 // Bits I[2:0]

	x := xBase + xOffset // Final X coordinate

	yMinorBase := (xMajor >> 1) << 1

	yMinorOffset := (iBlock >> 3) & 1 // Bit I[3]

	y := (yMajor << 2) + yMinorBase + yMinorOffset // Final Y coordinate

	return Coord{X: x, Y: y}
}

// GroupBytesIntoChunks splits the byte slice into chunks of size N.
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

// SwizzleClutPstm8 takes a flat array of 256 elements (data) and reorders them
// into a new 1D slice (length 256) according to the CLUT indexing scheme for Pstm8.
func SwizzleClutPstm8[T any](data []T) ([]T, error) {
	if len(data) != 256 {
		var zeroSlice []T
		return zeroSlice, fmt.Errorf("input array must contain exactly 256 elements, but got %d", len(data))
	}

	result := make([]T, 256)

	for i := 0; i < 256; i++ {
		linearIndex := uint8(i)

		coord := mapLinearIndexToCoord(linearIndex)

		// Calculate the flat index in the output array (Y*16 + X)
		flatIndex := int(coord.Y)*16 + int(coord.X)

		// Map the original linear data[i] to its new flat grid position.
		result[flatIndex] = data[i]
	}

	return result, nil
}

// SwizzleClutPstm4_16 handles the 16-color IDTEX4 CLUT layout (8x2 tile).
func SwizzleClutPstm4_16[T any](data []T) ([]T, error) {
	if len(data) != 16 {
		var zero []T
		return zero, fmt.Errorf("input must be 16 elements, got %d", len(data))
	}

	result := make([]T, 16)

	for i := 0; i < 16; i++ {
		y := i / 8 // row (0..1)
		x := i % 8 // col (0..7)
		flatIndex := y*8 + x

		result[flatIndex] = data[i]
	}

	return result, nil
}
