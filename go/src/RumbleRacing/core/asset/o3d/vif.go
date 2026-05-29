package o3d

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
)

type VifCommandKind string

const (
	VifCommandNOP    VifCommandKind = "NOP"
	VifCommandDIRECT VifCommandKind = "DIRECT"
	VifCommandSTROW  VifCommandKind = "STROW"
	VifCommandMASK   VifCommandKind = "MASK"
	VifCommandMSCNT  VifCommandKind = "MSCNT"
	VifCommandFLUSHE VifCommandKind = "FLUSHE"
	VifCommandCYCLE  VifCommandKind = "CYCLE"
	VifCommandUNPACK VifCommandKind = "UNPACK"
)

type UnpackType string

const (
	UnpackTypeV2_32       UnpackType = "V2_32"
	UnpackTypeV3_32       UnpackType = "V3_32"
	UnpackTypeV4_32       UnpackType = "V4_32"
	UnpackTypeV4_8        UnpackType = "V4_8"
	UnpackTypeUnsupported UnpackType = "UNSUPPORTED"
)

type UnpackExtendType string

const (
	UnpackExtendZero   UnpackExtendType = "ZERO"
	UnpackExtendSigned UnpackExtendType = "SIGNED"
)

type Quadword [16]byte

type VifCommand struct {
	Kind      VifCommandKind
	Opcode    uint8
	Num       uint8
	Immediate uint16

	Cycle  uint16
	Mask   uint32
	Strow  [4]uint32
	Direct []Quadword
	Unpack *UnpackData
}

type V4_32Entry struct {
	V1     uint32
	V2     uint32
	V3     uint32
	V4     uint32
	Offset uint64
}

type V3_32Entry struct {
	ADCBitSet bool

	V1 float32
	V2 float32
	V3 float32
}

type V2_32Entry struct {
	V1 float32
	V2 float32
}

type V4_8Entry struct {
	V1 uint8
	V2 uint8
	V3 uint8
	V4 uint8

	ADCBitSet bool
}

type UnpackData struct {
	Type  UnpackType
	V4_32 []V4_32Entry
	V3_32 []V3_32Entry
	V2_32 []V2_32Entry
	V4_8  []V4_8Entry
}

type vifParserState struct {
	cycleRegister uint16
	rowRegisters  [4]uint32
	maskRegister  uint32
}

type unpackInfo struct {
	address                   uint64
	extendType                UnpackExtendType
	unpackType                UnpackType
	addTopsToAddress          bool
	performUnpackWriteMasking bool
}

func (elda *ELDA_Data) ParseVif() (*[]VifCommand, error) {
	if len(elda.Raw.Payload) < 8 {
		return nil, fmt.Errorf("ELDA payload too small for VIF data")
	}

	data := elda.Raw.Payload[8:]
	state := vifParserState{
		cycleRegister: 0,
		rowRegisters:  [4]uint32{0, 0, 0, 0},
		maskRegister:  0,
	}

	var commands []VifCommand
	idx := 0
	dataLen := len(data)

	for idx < dataLen {
		if idx+4 > dataLen {
			break
		}

		b := data[idx : idx+4]
		command := b[3]
		num := b[2]
		immediate := binary.LittleEndian.Uint16(b[0:2])
		idx += 4

		cmd := VifCommand{
			Kind:      VifCommandKind(""),
			Opcode:    command,
			Num:       num,
			Immediate: immediate,
		}

		switch command {
		case 0x00:
			cmd.Kind = VifCommandNOP

		case 0x01:
			cmd.Kind = VifCommandCYCLE
			cmd.Cycle = immediate
			state.cycleRegister = immediate

		case 0x10:
			cmd.Kind = VifCommandFLUSHE

		case 0x17:
			cmd.Kind = VifCommandMSCNT

		case 0x20:
			cmd.Kind = VifCommandMASK
			if idx+4 > dataLen {
				return nil, io.ErrUnexpectedEOF
			}
			mask := binary.LittleEndian.Uint32(data[idx:])
			idx += 4
			cmd.Mask = mask
			state.maskRegister = mask

		case 0x30:
			cmd.Kind = VifCommandSTROW
			if idx+16 > dataLen {
				return nil, io.ErrUnexpectedEOF
			}
			var regs [4]uint32
			for i := 0; i < 4; i++ {
				regs[i] = binary.LittleEndian.Uint32(data[idx:])
				idx += 4
			}
			cmd.Strow = regs
			state.rowRegisters = regs

		case 0x50:
			cmd.Kind = VifCommandDIRECT
			if immediate == 0 {
				return nil, fmt.Errorf("DIRECT immediate=0 is not implemented")
			}
			quadCount := int(immediate)
			neededBytes := quadCount * 16
			if idx+neededBytes > dataLen {
				return nil, io.ErrUnexpectedEOF
			}

			cmd.Direct = make([]Quadword, quadCount)
			for i := 0; i < quadCount; i++ {
				copy(cmd.Direct[i][:], data[idx:idx+16])
				idx += 16
			}

		case 0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67,
			0x68, 0x69, 0x6A, 0x6B, 0x6C, 0x6D, 0x6E, 0x6F,
			0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77,
			0x78, 0x79, 0x7A, 0x7B, 0x7C, 0x7D, 0x7E, 0x7F:

			cmd.Kind = VifCommandUNPACK
			info := getUnpackInfo(command, immediate)

			unpack := UnpackData{
				Type: info.unpackType,
			}

			count := int(num)

			switch info.unpackType {
			case UnpackTypeV4_32:
				neededBytes := count * 16
				if idx+neededBytes > dataLen {
					return nil, io.ErrUnexpectedEOF
				}
				unpack.V4_32 = make([]V4_32Entry, count)
				for i := 0; i < count; i++ {
					entryOffset := uint64(idx)

					p := data[idx:]
					v1 := binary.LittleEndian.Uint32(p)
					v2 := binary.LittleEndian.Uint32(p[4:])
					v3 := binary.LittleEndian.Uint32(p[8:])
					v4 := binary.LittleEndian.Uint32(p[12:])
					idx += 16

					unpack.V4_32[i] = V4_32Entry{
						V1:     v1,
						V2:     v2,
						V3:     v3,
						V4:     v4,
						Offset: entryOffset,
					}
				}

			case UnpackTypeV3_32:
				neededBytes := count * 12
				if idx+neededBytes > dataLen {
					return nil, io.ErrUnexpectedEOF
				}
				unpack.V3_32 = make([]V3_32Entry, count)
				for i := 0; i < count; i++ {
					p := data[idx:]

					raw1 := binary.LittleEndian.Uint32(p)
					raw2 := binary.LittleEndian.Uint32(p[4:])
					raw3 := binary.LittleEndian.Uint32(p[8:])
					idx += 12

					draw := (raw3 & 0b1) == 0b1
					unpack.V3_32[i] = V3_32Entry{
						V1:        math.Float32frombits(raw1),
						V2:        math.Float32frombits(raw2),
						V3:        math.Float32frombits(raw3),
						ADCBitSet: draw,
					}
				}

			case UnpackTypeV2_32:
				neededBytes := count * 8
				if idx+neededBytes > dataLen {
					return nil, io.ErrUnexpectedEOF
				}
				unpack.V2_32 = make([]V2_32Entry, count)
				for i := 0; i < count; i++ {
					p := data[idx:]

					raw1 := binary.LittleEndian.Uint32(p)
					raw2 := binary.LittleEndian.Uint32(p[4:])
					idx += 8

					unpack.V2_32[i] = V2_32Entry{
						V1: math.Float32frombits(raw1),
						V2: math.Float32frombits(raw2),
					}
				}

			case UnpackTypeV4_8:
				neededBytes := count * 4
				if idx+neededBytes > dataLen {
					return nil, io.ErrUnexpectedEOF
				}
				unpack.V4_8 = make([]V4_8Entry, count)
				for i := 0; i < count; i++ {
					b0, b1, b2, b3 := data[idx], data[idx+1], data[idx+2], data[idx+3]
					idx += 4

					draw := (b2 & 0b1) == 0b1
					unpack.V4_8[i] = V4_8Entry{
						V1:        b0,
						V2:        b1,
						V3:        b2,
						V4:        b3,
						ADCBitSet: draw,
					}
				}
			}

			cmd.Unpack = &unpack

		default:
			return nil, fmt.Errorf("unhandled VIF command 0x%02X at offset %d", command, idx-4)
		}

		commands = append(commands, cmd)
	}

	return &commands, nil
}

func getUnpackInfo(command byte, immediate uint16) unpackInfo {
	unpackType := UnpackTypeUnsupported
	switch command {
	case 0x64, 0x74:
		unpackType = UnpackTypeV2_32
	case 0x68, 0x78:
		unpackType = UnpackTypeV3_32
	case 0x6C, 0x7C:
		unpackType = UnpackTypeV4_32
	case 0x6E, 0x7E:
		unpackType = UnpackTypeV4_8
	}

	extendType := UnpackExtendSigned
	if (immediate>>14)&0x1 == 1 {
		extendType = UnpackExtendZero
	}

	return unpackInfo{
		address:                   uint64(immediate&0x03FF) * 16,
		extendType:                extendType,
		unpackType:                unpackType,
		addTopsToAddress:          ((immediate >> 15) & 0x1) == 1,
		performUnpackWriteMasking: (command & 0x10) != 0,
	}
}
