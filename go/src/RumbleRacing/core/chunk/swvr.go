package chunk

import (
	"bytes"
	"encoding/binary"
	"io"
)

type SWVR struct {
	index        uint32
	startAddress uint32
	data         []byte

	FileName string
	FullData []byte
}

func (c *SWVR) FourCC() string {
	return "SWVR"
}

func (c *SWVR) TotalSize() uint32 {
	return uint32(len(c.data))
}

func (c *SWVR) StartAddress() uint32 {
	return c.startAddress
}

func (c *SWVR) Data() []byte {
	return c.data
}

// 3. Implement TopLevelChunk interface method
func (c *SWVR) Index() uint32 {
	return c.index
}

func ReadSWVRChunk(r io.ReadSeeker, startPos uint32, pos int64, index uint32) (*SWVR, error) {
	var chunkSize uint32
	if err := binary.Read(r, binary.LittleEndian, &chunkSize); err != nil {
		return nil, err
	}

	data := make([]byte, chunkSize-8)

	if _, err := io.ReadFull(r, data); err != nil {
		return nil, err
	}

	// get all data, including initial headers/size.
	// we do this because the tools to convert these files expect this.
	fullData := make([]byte, chunkSize)
	r.Seek(int64(startPos), io.SeekStart)
	if _, err := io.ReadFull(r, fullData); err != nil {
		return nil, err
	}

	// Names are capped at 16 characters, some end earlier. stop at first null byte
	raw := data[12 : 12+16]
	if i := bytes.IndexByte(raw, 0); i != -1 {
		raw = raw[:i]
	}
	fileName := string(raw)

	return &SWVR{
		index:        index,
		startAddress: startPos,
		data:         data,
		FullData:     fullData,
		FileName:     fileName,
	}, nil
}
