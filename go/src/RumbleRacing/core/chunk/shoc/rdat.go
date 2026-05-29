package shoc

import (
	"encoding/binary"
	"encoding/json"
)

type Rdat struct {
	OutBufferSize uint32
	data          []byte
}

func (s *Rdat) FourCC() string {
	return "Rdat"
}

func (s *Rdat) Data() []byte {
	return s.data
}

func parseRdat(data []byte) *Rdat {

	size := binary.LittleEndian.Uint32(data[0:4])
	data = data[4:]

	return &Rdat{
		OutBufferSize: size,
		data:          data,
	}
}

func (c *Rdat) MarshalJSON() ([]byte, error) {
	arr := []interface{}{c.FourCC()}
	return json.Marshal(arr)
}
