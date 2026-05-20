package chunk

import (
	"encoding/binary"
	"encoding/json"
	"io"
)

type Ctrl struct {
	index        uint32
	fourCC       string
	startAddress uint32
	data         []byte
}

func (c *Ctrl) FourCC() string {
	return "CTRL"
}

func (c *Ctrl) TotalSize() uint32 {
	return uint32(len(c.data))
}

func (c *Ctrl) StartAddress() uint32 {
	return c.startAddress
}

func (c *Ctrl) Data() []byte {
	return c.data
}

// 3. Implement TopLevelChunk interface method
func (c *Ctrl) Index() uint32 {
	return c.index
}

func ReadCTRLChunk(r io.ReadSeeker, startPos uint32, index uint32) (*Ctrl, error) {
	var chunkSize uint32
	if err := binary.Read(r, binary.LittleEndian, &chunkSize); err != nil {
		return nil, err
	}

	data := make([]byte, chunkSize-8)
	if _, err := io.ReadFull(r, data); err != nil {
		return nil, err
	}

	return &Ctrl{
		index:        index,
		fourCC:       "CTRL",
		startAddress: startPos,
		data:         data,
	}, nil
}

func (c *Ctrl) MarshalJSON() ([]byte, error) {
	arr := []interface{}{c.fourCC}
	return json.Marshal(arr)
}

func (c *Fill) MarshalJSON() ([]byte, error) {
	arr := []interface{}{c.FourCC()}
	return json.Marshal(arr)
}
