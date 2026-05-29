package chunk

import (
	"encoding/binary"
	"io"
)

type Fill struct {
	index        uint32
	startAddress uint32
	data         []byte
}

func (c *Fill) FourCC() string {
	return "FILL"
}

func (c *Fill) TotalSize() uint32 {
	return uint32(len(c.data))
}

func (c *Fill) StartAddress() uint32 {
	return c.startAddress
}

func (c *Fill) Data() []byte {
	return c.data
}

// 3. Implement TopLevelChunk interface method
func (c *Fill) Index() uint32 {
	return c.index
}

func ReadFILLChunk(r io.ReadSeeker, startPos uint32, pos int64, index uint32) (*Fill, error) {
	// Handle special case: fill tag ends on 0x6000 boundary
	if pos%0x6000 == 0 {
		return &Fill{
			index:        index,
			startAddress: startPos,
			data:         []byte{},
		}, nil
	}

	// Normal FILL parsing

	var chunkSize uint32
	if err := binary.Read(r, binary.LittleEndian, &chunkSize); err != nil {
		return nil, err
	}

	data := make([]byte, chunkSize-8)

	if _, err := io.ReadFull(r, data); err != nil {
		return nil, err
	}

	return &Fill{
		index:        index,
		startAddress: startPos,
		data:         data,
	}, nil
}
