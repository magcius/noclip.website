package asset

import (
	"encoding/binary"
	"math"
	"math/rand/v2"
)

type Actor struct {
	rawData []byte

	ActorType uint8

	X float32
	Y float32
	Z float32

	XBytes []byte
	YBytes []byte
	ZBytes []byte

	ScaleX float32
	ScaleY float32
	ScaleZ float32

	AngleX float32
	AngleY float32
	AngleZ float32

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

	actor.XBytes = xBytes
	actor.YBytes = yBytes
	actor.ZBytes = zBytes

	ScaleX := int16(binary.LittleEndian.Uint16(header[0x1E : 0x1E+2]))
	ScaleY := int16(binary.LittleEndian.Uint16(header[0x20 : 0x20+2]))
	ScaleZ := int16(binary.LittleEndian.Uint16(header[0x22 : 0x22+2]))

	actor.ScaleX = ActorStatic_ComputeScaleFactor(int32(ScaleX))
	actor.ScaleY = ActorStatic_ComputeScaleFactor(int32(ScaleY))
	actor.ScaleZ = ActorStatic_ComputeScaleFactor(int32(ScaleZ))

	AngleX := int16(binary.LittleEndian.Uint16(header[0x14 : 0x14+2]))
	AngleY := int16(binary.LittleEndian.Uint16(header[0x16 : 0x16+2]))
	AngleZ := int16(binary.LittleEndian.Uint16(header[0x18 : 0x18+2]))

	actor.AngleX = ActorStatic_ComputeAngle(int32(AngleX))
	actor.AngleY = ActorStatic_ComputeAngle(int32(AngleY))
	actor.AngleZ = ActorStatic_ComputeAngle(int32(AngleZ))

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

// Vibe slop, if something about scale factor is broken, investigate this.
func ActorStatic_ComputeScaleFactor(param1 int32) float32 {
	if param1 < 0 {
		// Replicates the (-0.5, 0.5) random range from the original
		randFloat := rand.Float32() - 0.5
		return float32(param1*-2)*0.00024414062*randFloat + 1.0
	}
	return float32(param1) * 0.00024414062
}

// Vibe slop, if something about angle is broken, investigate this.
func ActorStatic_ComputeAngle(param1 int32) float32 {
	if param1 < 0 {
		// Random angle in (0, 2π)
		return rand.Float32() * 6.2831855
	}
	// Fixed-point degrees to radians: param1/16 * (π/180)
	return float32(param1) * 0.0625 * 0.017453292
}
