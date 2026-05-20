package chunk

import (
	"encoding/binary"
	"io"
)

type Generic struct {
	index        uint32
	fourCC       string
	startAddress uint32
	data         []byte
}

func (c *Generic) FourCC() string {
	return c.fourCC
}

func (c *Generic) TotalSize() uint32 {
	return uint32(len(c.data))
}

func (c *Generic) StartAddress() uint32 {
	return c.startAddress
}

func (c *Generic) Data() []byte {
	return c.data
}

// 3. Implement TopLevelChunk interface method
func (c *Generic) Index() uint32 {
	return c.index
}

func ReadGenericChunk(r io.ReadSeeker, fourCC string, startPos uint32, index uint32) (*Generic, error) {
	var chunkSize uint32
	if err := binary.Read(r, binary.LittleEndian, &chunkSize); err != nil {
		return nil, err
	}

	data := make([]byte, chunkSize-8)
	if _, err := io.ReadFull(r, data); err != nil {
		return nil, err
	}

	return &Generic{
		index:        index,
		fourCC:       fourCC,
		startAddress: startPos,
		data:         data,
	}, nil
}
