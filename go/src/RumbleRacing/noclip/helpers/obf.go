package helpers

import (
	"fmt"
	"rumble-reader/asset/o3d"
)

type JsonBuffer struct {
	BufferIndex int
	TextureId   int
	Name        string
	Vertices    [][3]float32
	UVs         [][2]float32
	Normals     [][3]float32
	Indices     []uint32
}

type ObfJsonNode struct {
	HeaderOffset int
	Buffers      []JsonBuffer
	Children     []ObfJsonNode
}

func BuildObfNode(node *o3d.ObfNode) *ObfJsonNode {
	jNode := &ObfJsonNode{
		HeaderOffset: node.Metadata.HeaderOffset,
	}

	if node != nil && node.RawChunk.ELDA.Raw.Size > 8 {
		for bufIdx, buf := range node.Geometry.Buffers {
			var (
				indices   []uint32
				positions [][3]float32
				uvs       [][2]float32
				normals   [][3]float32
			)

			for _, strip := range buf.Primitives {
				base := uint32(len(positions))

				for i := range strip.Vertices {
					v := strip.Vertices[i]
					n := strip.Normals[i]
					u := strip.UVs[i]
					positions = append(positions, [3]float32{v.X, v.Y, v.Z})
					normals = append(normals, [3]float32{n.X, n.Y, n.Z})
					uvs = append(uvs, [2]float32{u.U, u.V})
				}

				isFlipped := false
				for i := 2; i < len(strip.Vertices); i++ {
					if strip.Normals[i].ADCBitSet {
						if !strip.Normals[i-1].ADCBitSet {
							isFlipped = false
						} else {
							isFlipped = !isFlipped
						}
						A, B, C := base+uint32(i-2), base+uint32(i-1), base+uint32(i)
						if isFlipped {
							indices = append(indices, A, B, C)
						} else {
							indices = append(indices, B, A, C)
						}
					}
				}
			}

			if len(indices) == 0 {
				continue
			}

			jNode.Buffers = append(jNode.Buffers, JsonBuffer{
				BufferIndex: bufIdx,
				TextureId:   buf.TextureId,
				Name:        fmt.Sprintf("%d_buf%d", node.Metadata.HeaderOffset, bufIdx),
				Vertices:    positions,
				UVs:         uvs,
				Normals:     normals,
				Indices:     indices,
			})
		}
	}

	child := node.LastChild
	for child != nil {
		jNode.Children = append(jNode.Children, *BuildObfNode(child))
		child = child.PrevSibling
	}

	return jNode
}
