package shoc

import "encoding/json"

type SDAT struct {
	data []byte
}

func (s *SDAT) FourCC() string {
	return "SDAT"
}

func (s *SDAT) Data() []byte {
	return s.data
}

func parseSDAT(data []byte) *SDAT {
	return &SDAT{
		data: data,
	}
}

func (c *SDAT) MarshalJSON() ([]byte, error) {
	arr := []interface{}{c.FourCC()}
	return json.Marshal(arr)
}
