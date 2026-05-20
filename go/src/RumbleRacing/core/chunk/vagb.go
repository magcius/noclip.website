package chunk

import (
	"encoding/binary"
	"io"
)

type VAGB struct {
	index        uint32
	startAddress uint32
	data         []byte

	FulLData []byte
}

func (c *VAGB) FourCC() string {
	return "VAGB"
}

func (c *VAGB) TotalSize() uint32 {
	return uint32(len(c.data))
}

func (c *VAGB) StartAddress() uint32 {
	return c.startAddress
}

func (c *VAGB) Data() []byte {
	return c.data
}

// 3. Implement TopLevelChunk interface method
func (c *VAGB) Index() uint32 {
	return c.index
}

func ReadVAGBChunk(r io.ReadSeeker, startPos uint32, pos int64, index uint32) (*VAGB, error) {
	var chunkSize uint32
	if err := binary.Read(r, binary.LittleEndian, &chunkSize); err != nil {
		return nil, err
	}

	data := make([]byte, chunkSize-8)

	if _, err := io.ReadFull(r, data); err != nil {
		return nil, err
	}

	fullData := make([]byte, chunkSize)
	r.Seek(int64(startPos), io.SeekStart)

	if _, err := io.ReadFull(r, fullData); err != nil {
		return nil, err
	}

	return &VAGB{
		index:        index,
		startAddress: startPos,
		data:         data,
		FulLData:     fullData,
	}, nil
}
