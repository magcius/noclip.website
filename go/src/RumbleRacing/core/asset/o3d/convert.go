package o3d

import (
	"rumble-reader/chunk/shoc"
)

func (r *O3D) GetType() string {
	if r.IsAnimated {
		return "o3da"
	}
	return "o3d"
}

func (t *O3D) RawData() []byte {
	return t.rawData
}

func (t *O3D) Header() shoc.SHDR {
	return t.shocHeader
}

func (o *Obf) GetType() string {
	return "obf"
}

func (o *Obf) RawData() []byte {
	return o.RawBytes
}
