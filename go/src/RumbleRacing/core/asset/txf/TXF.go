package txf

import (
	"encoding/binary"
	"errors"
	"fmt"
	"rumble-reader/chunk/shoc"
)

type TXF struct {
	rawData []byte

	resourceName string
	shocHeader   shoc.SHDR

	header         *HEAD
	textureHeaders []*ZTHE
	clutHeader     *CLHE
	textureData    *TXDA
	clutData       *CLDA
}

func ParseTXF(buf []byte, hdr shoc.SHDR, resName string) (*TXF, error) {
	txfAsset := TXF{
		rawData:      buf,
		shocHeader:   hdr,
		resourceName: resName,
	}

	chunks, err := splitTaggedChunks(buf[8:])

	if err != nil {
		panic(err)
	}

	for _, chunk := range chunks {
		// fmt.Println(chunkIndex, len(chunk), string(chunk[0:4]))
		tag := string(chunk[0:4])

		switch tag {
		case "HEAD":
			{
				if head, err := parseHEAD(chunk); err == nil {
					if txfAsset.header != nil {
						return nil, errors.New("multiple HEAD in TXF file")
					}
					txfAsset.header = head
				}
			}
		case "ZTHE":
			{
				if zthe, err := parseZTHE(chunk); err == nil {
					txfAsset.textureHeaders = append(txfAsset.textureHeaders, zthe)
				}
			}
		case "CLHE":
			if clhe, err := parseCLHE(chunk); err == nil {
				if txfAsset.clutHeader != nil {
					return nil, errors.New("multiple CLHE in TXF file")
				}
				txfAsset.clutHeader = clhe
			}
		case "TXDA":
			if txda, err := parseTXDA(chunk); err == nil {
				if txfAsset.textureData != nil {
					return nil, errors.New("multiple TXDA in TXF file")
				}
				txfAsset.textureData = txda
			}
		case "CLDA":
			if clda, err := parseCLDA(chunk); err == nil {
				if txfAsset.clutData != nil {
					return nil, errors.New("multiple CLDA in TXF file")
				}
				txfAsset.clutData = clda
			}
		default:
			{
				panic("Unknown TXF chunk tag: " + tag)
			}
		}
	}

	if int(txfAsset.header.CLHEIterations) != len(txfAsset.clutHeader.Entries) {
		// panic("txf header clheIterations is not equal to actual entries in CLUT header")
	}

	return &txfAsset, nil
}

func splitTaggedChunks(buf []byte) ([][]byte, error) {
	var chunks [][]byte
	offset := 0

	for offset+8 <= len(buf) {
		tag := buf[offset : offset+4]
		// fmt.Println(string(tag))
		size := binary.LittleEndian.Uint32(buf[offset+4 : offset+8])
		offset += 8

		if offset+int(size) > len(buf) {
			return nil, fmt.Errorf("invalid size %d at offset %d", size, offset)
		}

		data := buf[offset : offset+int(size)]
		offset += int(size)

		chunk := make([]byte, 0, 8+len(data))
		chunk = append(chunk, tag...)
		chunk = append(chunk,
			buf[offset-int(size)-4:offset-int(size)]...,
		)
		chunk = append(chunk, data...)

		chunks = append(chunks, chunk)
	}

	return chunks, nil
}

func (g *TXF) GetType() string {
	return "txf"
}

func (g *TXF) RawData() []byte {
	return g.rawData
}

func (g *TXF) Header() shoc.SHDR {
	return g.shocHeader
}
