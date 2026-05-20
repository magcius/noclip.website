package chunk

import (
	"encoding/binary"
	"io"
)

type VAGM struct {
	index        uint32
	startAddress uint32
	data         []byte

	FulLData []byte
}

func (c *VAGM) FourCC() string {
	return "VAGM"
}

func (c *VAGM) TotalSize() uint32 {
	return uint32(len(c.data))
}

func (c *VAGM) StartAddress() uint32 {
	return c.startAddress
}

func (c *VAGM) Data() []byte {
	return c.data
}

// 3. Implement TopLevelChunk interface method
func (c *VAGM) Index() uint32 {
	return c.index
}

func ReadVAGMChunk(r io.ReadSeeker, startPos uint32, pos int64, index uint32) (*VAGM, error) {
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

	return &VAGM{
		index:        index,
		startAddress: startPos,
		data:         data,
		FulLData:     fullData,
	}, nil
}
