package file

import (
	"io"
	"rumble-reader/chunk"
	"rumble-reader/chunk/shoc"
)

func readTopLevelChunk(r io.ReadSeeker, chunkIndex uint32) (chunk.TopLevelChunk, error) {
	startPosSigned, _ := r.Seek(0, io.SeekCurrent)
	startPos := uint32(startPosSigned)

	tag := make([]byte, 4)
	if _, err := io.ReadFull(r, tag); err != nil {
		return nil, err
	}

	// Reverse bytes if little-endian
	for i := 0; i < 2; i++ {
		tag[i], tag[3-i] = tag[3-i], tag[i]
	}
	fourcc := string(tag)

	pos, _ := r.Seek(0, io.SeekCurrent)

	switch fourcc {
	case "CTRL":
		return chunk.ReadCTRLChunk(r, startPos, chunkIndex)
	case "SHOC":
		return shoc.ReadSHOCChunk(r, startPos, chunkIndex)
	case "FILL":
		return chunk.ReadFILLChunk(r, startPos, pos, chunkIndex)
	case "SWVR":
		return chunk.ReadSWVRChunk(r, startPos, pos, chunkIndex)
	case "VAGB":
		return chunk.ReadVAGBChunk(r, startPos, pos, chunkIndex)
	case "VAGM":
		return chunk.ReadVAGMChunk(r, startPos, pos, chunkIndex)
	default:
		return chunk.ReadGenericChunk(r, fourcc, startPos, chunkIndex)
	}
}
