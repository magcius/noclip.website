package txf

import (
	"encoding/binary"
)

type ZTHE struct {
	TextureCount uint32
	Textures     []ZTHETexture

	RawData []byte
}

type ZTHETexture struct {
	Images             []ZTHETextureMetaHeader
	TexelStorageFormat uint8
	ImageCount         uint8 // Each texture could have up to 4 mip-mapped sub-textures
	BlockWidthPixels   uint16
	CLUTHeaderIndex    uint8
	TextureId          uint16 // Potential texture ID that 3d model looks up?

	RawData []byte
}

type ZTHETextureMetaHeader struct {
	TXDAAddressOffset   uint32
	Unk                 uint16
	BlockHeightPixels   uint16
	SelfPlusMemAllocRes uint16
	RamDestWidth        uint16
}

func parseZTHE(buf []byte) (*ZTHE, error) {

	// size := binary.LittleEndian.Uint32(buf[4:8])
	// fmt.Println(size)
	raw := buf

	texCount := binary.LittleEndian.Uint32(buf[8 : 8+4])
	buf = buf[8+4:]

	var textures []ZTHETexture

	for i := 0; i+0x48 <= len(buf); i += 0x48 {
		data := buf[i : i+0x48]
		rawTexture := data
		// fmt.Println(hex.Dump(data[0:8]))

		var metaHeaders []ZTHETextureMetaHeader

		imageCount := data[0x31]

		for j := 0; j < int(imageCount); j++ {
			offset := j * 0xc
			hData := data[offset : offset+0xc]
			// fmt.Println("meta:", hex.Dump(hData))

			metaHeaders = append(metaHeaders, ZTHETextureMetaHeader{
				TXDAAddressOffset:   binary.LittleEndian.Uint32(hData[0:4]),
				Unk:                 binary.LittleEndian.Uint16(hData[0x4 : 0x4+2]),
				BlockHeightPixels:   binary.LittleEndian.Uint16(hData[0x6 : 0x6+2]),
				SelfPlusMemAllocRes: binary.LittleEndian.Uint16(hData[0x8 : 0x8+2]),
				RamDestWidth:        binary.LittleEndian.Uint16(hData[0xa : 0xa+2]),
			})
		}

		textures = append(textures, ZTHETexture{
			TexelStorageFormat: data[0x30],
			ImageCount:         imageCount,
			BlockWidthPixels:   binary.LittleEndian.Uint16(data[0x3e:(0x3e + 2)]),
			Images:             metaHeaders,
			TextureId:          binary.LittleEndian.Uint16(data[0x34:(0x34 + 2)]),
			CLUTHeaderIndex:    data[0x44],
			RawData:            rawTexture,
		})
	}

	if int(texCount) != len(textures) {
		panic("TexCount != length of textures!")
	}

	return &ZTHE{
		TextureCount: texCount,
		Textures:     textures,
		RawData:      raw,
	}, nil
}
