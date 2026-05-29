package o3d

import (
	"encoding/binary"
	"fmt"
)

type Obf struct {
	RawBytes []byte

	RawObfChunks []ObfChunk
	RootNode     *ObfNode
}

type ObfNodeJson struct {
	Metadata NodeMetadata   `json:"metadata"`
	Children []*ObfNodeJson `json:"children,omitempty"`
}

type TextureEntry struct {
	ELDAOffset uint32
	TextureId  int
}
type TextureMeta struct {
	NumTextures   int16
	TextureEnties []TextureEntry
}

type NodeMetadata struct {
	X float32
	Y float32
	Z float32
	W float32

	RawZDebug   string
	RawZAddress int

	DataLen      int
	HeaderOffset int

	TextureMetadata TextureMeta
}

type ObfNode struct {
	RawChunk ObfChunk
	Metadata NodeMetadata
	Geometry *Geometry

	Parent      *ObfNode // 0x1C
	LastChild   *ObfNode // 0x20
	PrevSibling *ObfNode // 0x24
	Child       *ObfNode // 0x28
}

func ParseObf(buf []byte) (*Obf, error) {

	obfAsset := Obf{
		RawBytes: buf,
		RootNode: &ObfNode{},
	}

	// Skip past the .Obf header, like the game does
	obfBytes := buf[0x18:]

	// fmt.Println(hex.Dump(obfBytes))
	// fmt.Println("PARSE OBF CHUNKS")

	chunks, err := parseObfChunks(obfBytes)
	if err != nil {
		return nil, err
	}

	obfAsset.RawObfChunks = chunks

	buildTree(obfAsset.RootNode, 0, chunks)

	return &obfAsset, nil
}

func buildTree(node *ObfNode, currDataIndex int, data []ObfChunk) int {
	node.RawChunk = data[currDataIndex]

	node.Metadata.X = node.RawChunk.ELHE.X
	node.Metadata.Y = node.RawChunk.ELHE.Y
	node.Metadata.Z = node.RawChunk.ELHE.Z
	node.Metadata.W = node.RawChunk.ELHE.W
	node.Metadata.DataLen = int(len(node.RawChunk.ELDA.Raw.Payload))
	node.Metadata.HeaderOffset = node.RawChunk.ELHE.Raw.Offset
	node.Metadata.RawZDebug = fmt.Sprintf("%08x", node.RawChunk.ELHE.RawZDebug)
	node.Metadata.RawZAddress = node.RawChunk.ELHE.RawZAddress

	vif, err := node.RawChunk.ELDA.ParseVif()

	if err != nil {
		panic(err)
	}

	// Build texture metadata from ELTL/ELDA data
	node.Metadata.TextureMetadata = buildTextureMetadata(node.RawChunk.ELHE, node.RawChunk.ELTL, node.RawChunk.ELDA)

	// geometry, err := GetGeometry(node.Metadata.TextureMetadata)
	geometry, err := GetGeometry(*vif, node.Metadata.TextureMetadata)

	if err != nil {
		panic(err)
	}

	node.Geometry = geometry

	// for _, submesh := range geometry.SubMeshes {
	// 	fmt.Println("GEOMETRY: ", submesh.Texture)
	// }
	// node.Metadata.VifCommandCount = len(vif.Commands)

	nodeCount := 1

	if node.RawChunk.ELHE.ChildCount != 0 {
		var lastChild *ObfNode
		nextDataIndex := currDataIndex + 1

		for i := 0; i < int(node.RawChunk.ELHE.ChildCount); i++ {
			childNode := &ObfNode{}
			childNode.Parent = node

			if i == 0 {
				childNode.PrevSibling = nil
			} else {
				childNode.PrevSibling = lastChild
			}
			lastChild = childNode
			node.LastChild = childNode

			childNodeCount := buildTree(childNode, nextDataIndex, data)
			nextDataIndex += childNodeCount
			nodeCount += childNodeCount
		}
	}

	return nodeCount
}

func NodeToJson(node *ObfNode) *ObfNodeJson {
	j := &ObfNodeJson{
		Metadata: node.Metadata,
	}
	child := node.LastChild
	for child != nil {
		j.Children = append(j.Children, NodeToJson(child))
		child = child.PrevSibling
	}
	return j
}

func buildTextureMetadata(elhe *ELHE_Header, eltl *ELTL_TextureList, elda *ELDA_Data) TextureMeta {
	textureMeta := TextureMeta{
		NumTextures:   elhe.MaybeNumTextures,
		TextureEnties: []TextureEntry{},
	}

	if elhe.MaybeNumTextures <= 0 {
		return textureMeta
	}

	eltl_data := eltl.Raw.Payload[8:]
	elda_data := elda.Raw.Payload[8:]

	for i := 0; i < int(elhe.MaybeNumTextures); i++ {
		offset := binary.LittleEndian.Uint32(eltl_data[i*4 : i*4+4])
		offset *= 4 // the game multiplies this number by four
		textureId := int(binary.LittleEndian.Uint32(elda_data[offset : offset+4]))

		entry := TextureEntry{
			ELDAOffset: offset,
			TextureId:  textureId,
		}

		textureMeta.TextureEnties = append(textureMeta.TextureEnties, entry)
	}

	return textureMeta
}
