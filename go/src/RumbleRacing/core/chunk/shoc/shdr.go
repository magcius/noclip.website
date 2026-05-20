package shoc

import (
	"encoding/binary"
	"encoding/json"
	"rumble-reader/helpers"
)

type SHDR struct {
	ShocIndex     uint32
	Unk0          uint32
	AssetType     string
	AssetIndex    uint32
	TotalDataSize uint32

	data []byte
}

func (s *SHDR) FourCC() string {
	return "SHDR"
}

func (s *SHDR) Data() []byte {
	return s.data
}

func parseSHDR(data []byte, shocIndex uint32) *SHDR {

	fourCCbytes := append([]byte(nil), data[4:8]...)
	helpers.ReverseBytesInPlace(fourCCbytes)
	fourCC := string(fourCCbytes)

	unk := binary.LittleEndian.Uint32(data[0:4])
	index := binary.LittleEndian.Uint32(data[8 : 8+4])
	// Indicies seem to be one-based
	// index -= 1
	size := binary.LittleEndian.Uint32(data[8+4 : 8+4+4])

	return &SHDR{
		ShocIndex:     shocIndex,
		Unk0:          unk,
		AssetType:     fourCC,
		AssetIndex:    index,
		TotalDataSize: size,
		data:          data,
	}
}

func (c *SHDR) MarshalJSON() ([]byte, error) {
	arr := []interface{}{c.FourCC(), c.AssetType}
	return json.Marshal(arr)
}
