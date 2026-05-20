package shoc

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"rumble-reader/helpers"
)

type Shoc struct {
	index        uint32
	startAddress uint32
	MetaData     ShocMetaChunk
	data         []byte
}

func (c *Shoc) FourCC() string {
	return "SHOC"
}

func (c *Shoc) TotalSize() uint32 {
	return uint32(len(c.data))
}

func (c *Shoc) StartAddress() uint32 {
	return c.startAddress
}

func (c *Shoc) Data() []byte {
	return c.data
}

// 3. Implement TopLevelChunk interface method
func (c *Shoc) Index() uint32 {
	return c.index
}

func ReadSHOCChunk(r io.ReadSeeker, startPos uint32, index uint32) (*Shoc, error) {
	var chunkSize uint32
	if err := binary.Read(r, binary.LittleEndian, &chunkSize); err != nil {
		return nil, err
	}

	data := make([]byte, chunkSize-8)
	if _, err := io.ReadFull(r, data); err != nil {
		return nil, err
	}

	return &Shoc{
		index:        index,
		startAddress: startPos,
		data:         data,
		MetaData:     parseSubChunk(data, index),
	}, nil
}

func parseSubChunk(data []byte, shocIndex uint32) ShocMetaChunk {

	fourCCbytes := append([]byte(nil), data[8:12]...)
	helpers.ReverseBytesInPlace(fourCCbytes)
	fourCC := string(fourCCbytes)

	switch fourCC {
	case "SHDR":
		return parseSHDR(data[12:], shocIndex)
	case "SDAT":
		return parseSDAT(data[12:])
	case "Rdat":
		return parseRdat(data[12:])
	default:
		panic("Unhandled SHOC sub-chunk: " + fourCC)
	}
}

// Shoc internal structure
type ShocMetaChunk interface {
	FourCC() string
	Data() []byte
}

func (c *Shoc) MarshalJSON() ([]byte, error) {
	arr := []interface{}{c.FourCC(), c.MetaData, c.startAddress}
	return json.Marshal(arr)
}
