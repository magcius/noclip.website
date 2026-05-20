package asset

import "rumble-reader/chunk/shoc"

type Asset interface {
	GetType() string
	RawData() []byte
}

type GenericAsset struct {
	header  shoc.SHDR
	tag     string
	rawData []byte
}

func (g *GenericAsset) GetType() string {
	return g.tag
}

func (g *GenericAsset) RawData() []byte {
	return g.rawData
}

func (g *GenericAsset) Header() shoc.SHDR {
	return g.header
}

func ParseGenericAsset(buf []byte, tag string, header shoc.SHDR) (*GenericAsset, error) {
	resource := GenericAsset{
		header:  header,
		rawData: buf,
		tag:     tag,
	}

	return &resource, nil
}
