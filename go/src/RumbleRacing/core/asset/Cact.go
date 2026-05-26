package asset

import (
	"encoding/binary"
	"math"
)

type Actor struct {
	rawData []byte

	ActorType uint8

	X float32
	Y float32
	Z float32

	O3DResourceIndex uint32
}

func ParseActor(buf []byte) (*Actor, error) {
	actor := Actor{
		rawData: buf,
	}

	chunks, err := ParseChunks(buf)

	if err != nil {
		return nil, err
	}

	header := chunks[0].Payload[8:]

	actor.ActorType = header[4]

	xBytes := header[8 : 8+4]
	yBytes := header[8+4 : 8+4+4]
	zBytes := header[8+8 : 8+4+8]

	actor.X = math.Float32frombits(binary.LittleEndian.Uint32(xBytes))
	actor.Y = math.Float32frombits(binary.LittleEndian.Uint32(yBytes))
	actor.Z = math.Float32frombits(binary.LittleEndian.Uint32(zBytes))

	resource := chunks[1]

	actor.O3DResourceIndex = binary.LittleEndian.Uint32(resource.Payload[0x10 : 0x10+4])

	return &actor, nil
}

func (t *Actor) GetType() string {
	return "Cact"
}

func (t *Actor) RawData() []byte {
	return t.rawData
}
