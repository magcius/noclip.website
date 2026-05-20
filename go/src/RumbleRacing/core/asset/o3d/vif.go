package o3d

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"strings"
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
	Debug  string
	Offset uint64
}

type V3_32Entry struct {
	ADCBitSet bool

	V1    float32
	V2    float32
	V3    float32
	Debug string
}

type V2_32Entry struct {
	V1    float32
	V2    float32
	Debug string
}

type V4_8Entry struct {
	V1 uint8
	V2 uint8
	V3 uint8
	V4 uint8

	ADCBitSet bool
	Debug     string
}

type UnpackData struct {
	Type                UnpackType
	Address             uint64
	ExtendType          UnpackExtendType
	AddTopsToAddress    bool
	PerformWriteMasking bool
	Offset              uint64
	V4_32               []V4_32Entry
	V3_32               []V3_32Entry
	V2_32               []V2_32Entry
	V4_8                []V4_8Entry
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
	reader := bytes.NewReader(data)
	state := vifParserState{
		cycleRegister: 0,
		rowRegisters:  [4]uint32{0, 0, 0, 0},
		maskRegister:  0,
	}

	var commands []VifCommand

	for reader.Len() > 0 {
		var commandWord uint32
		if err := binary.Read(reader, binary.LittleEndian, &commandWord); err != nil {
			if err == io.EOF {
				break
			}
			return nil, err
		}

		command := uint8(commandWord >> 24)
		num := uint8((commandWord >> 16) & 0xFF)
		immediate := uint16(commandWord & 0xFFFF)

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
			var mask uint32
			if err := binary.Read(reader, binary.LittleEndian, &mask); err != nil {
				return nil, err
			}
			cmd.Mask = mask
			state.maskRegister = mask

		case 0x30:
			cmd.Kind = VifCommandSTROW
			var regs [4]uint32
			for i := 0; i < 4; i++ {
				if err := binary.Read(reader, binary.LittleEndian, &regs[i]); err != nil {
					return nil, err
				}
			}
			cmd.Strow = regs
			state.rowRegisters = regs

		case 0x50:
			cmd.Kind = VifCommandDIRECT
			if immediate == 0 {
				return nil, fmt.Errorf("DIRECT immediate=0 is not implemented")
			}
			quadCount := int(immediate)
			direct := make([]Quadword, 0, quadCount)
			for i := 0; i < quadCount; i++ {
				var quad Quadword
				if err := binary.Read(reader, binary.LittleEndian, &quad); err != nil {
					return nil, err
				}
				direct = append(direct, quad)
			}
			cmd.Direct = direct

		case 0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67,
			0x68, 0x69, 0x6A, 0x6B, 0x6C, 0x6D, 0x6E, 0x6F,
			0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77,
			0x78, 0x79, 0x7A, 0x7B, 0x7C, 0x7D, 0x7E, 0x7F:
			cmd.Kind = VifCommandUNPACK
			info := getUnpackInfo(command, immediate)

			if info.performUnpackWriteMasking {
				supported := (info.unpackType == UnpackTypeV3_32 && state.maskRegister == 0x40404040 && state.rowRegisters == [4]uint32{1065353216, 1065353216, 1065353216, 1065353216}) ||
					(info.unpackType == UnpackTypeV2_32 && state.maskRegister == 0x50505050 && state.rowRegisters == [4]uint32{1065353216, 1065353216, 1065353216, 1065353216})
				if !supported {
					return nil, fmt.Errorf("UNPACK write masking not implemented for command 0x%02X at offset %d", command, len(data)-reader.Len())
				}
			}

			commandStart := uint64(len(data) - reader.Len())
			unpack := UnpackData{
				Type:                info.unpackType,
				Address:             info.address,
				ExtendType:          info.extendType,
				AddTopsToAddress:    info.addTopsToAddress,
				PerformWriteMasking: info.performUnpackWriteMasking,
				Offset:              commandStart,
			}

			switch info.unpackType {
			case UnpackTypeV4_32:
				unpack.V4_32 = make([]V4_32Entry, 0, int(num))
				for i := 0; i < int(num); i++ {
					entryOffset := uint64(len(data) - reader.Len())
					var v V4_32Entry
					if err := binary.Read(reader, binary.LittleEndian, &v.V1); err != nil {
						return nil, err
					}
					if err := binary.Read(reader, binary.LittleEndian, &v.V2); err != nil {
						return nil, err
					}
					if err := binary.Read(reader, binary.LittleEndian, &v.V3); err != nil {
						return nil, err
					}
					if err := binary.Read(reader, binary.LittleEndian, &v.V4); err != nil {
						return nil, err
					}
					v.Offset = entryOffset
					v.Debug = fmt.Sprintf("offset: %d, row regs: %v mask: 0x%08X", entryOffset, state.rowRegisters, state.maskRegister)
					unpack.V4_32 = append(unpack.V4_32, v)
				}

			case UnpackTypeV3_32:
				unpack.V3_32 = make([]V3_32Entry, 0, int(num))
				for i := 0; i < int(num); i++ {
					entryOffset := uint64(len(data) - reader.Len())
					var raw1, raw2, raw3 uint32
					if err := binary.Read(reader, binary.LittleEndian, &raw1); err != nil {
						return nil, err
					}
					if err := binary.Read(reader, binary.LittleEndian, &raw2); err != nil {
						return nil, err
					}
					if err := binary.Read(reader, binary.LittleEndian, &raw3); err != nil {
						return nil, err
					}
					draw := (raw3 & 0b1) == 0b1
					unpack.V3_32 = append(unpack.V3_32, V3_32Entry{
						V1:        math.Float32frombits(raw1),
						V2:        math.Float32frombits(raw2),
						V3:        math.Float32frombits(raw3),
						ADCBitSet: draw,
						Debug:     fmt.Sprintf("draw: %v, offset: %d, row regs: %v mask: 0x%08X", draw, entryOffset, state.rowRegisters, state.maskRegister),
					})
				}

			case UnpackTypeV2_32:
				unpack.V2_32 = make([]V2_32Entry, 0, int(num))
				for i := 0; i < int(num); i++ {
					entryOffset := uint64(len(data) - reader.Len())
					var raw1, raw2 uint32
					if err := binary.Read(reader, binary.LittleEndian, &raw1); err != nil {
						return nil, err
					}
					if err := binary.Read(reader, binary.LittleEndian, &raw2); err != nil {
						return nil, err
					}
					unpack.V2_32 = append(unpack.V2_32, V2_32Entry{
						V1:    math.Float32frombits(raw1),
						V2:    math.Float32frombits(raw2),
						Debug: fmt.Sprintf("offset: %d, row regs: %v mask: 0x%08X", entryOffset, state.rowRegisters, state.maskRegister),
					})
				}

			case UnpackTypeV4_8:
				unpack.V4_8 = make([]V4_8Entry, 0, int(num))
				for i := 0; i < int(num); i++ {
					entryOffset := uint64(len(data) - reader.Len())
					var bytesEntry [4]byte
					if err := binary.Read(reader, binary.LittleEndian, &bytesEntry); err != nil {
						return nil, err
					}
					draw := (bytesEntry[2] & 0b1) == 0b1
					unpack.V4_8 = append(unpack.V4_8, V4_8Entry{
						V1:        bytesEntry[0],
						V2:        bytesEntry[1],
						V3:        bytesEntry[2],
						V4:        bytesEntry[3],
						ADCBitSet: draw,
						Debug:     fmt.Sprintf("draw?: %v offset: %d, row regs: %v mask: 0x%08X", draw, entryOffset, state.rowRegisters, state.maskRegister),
					})
				}
			}

			cmd.Unpack = &unpack

		default:
			return nil, fmt.Errorf("unhandled VIF command 0x%02X at offset %d", command, len(data)-reader.Len()-4)
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

func (elda *ELDA_Data) DumpVifText(elhe *ELHE_Header) (string, error) {
	vif, err := elda.ParseVif()
	if err != nil {
		return "", err
	}

	var sb strings.Builder
	sb.WriteString("VIF Commands Dump\n")
	sb.WriteString("=================\n\n")
	sb.WriteString(fmt.Sprintf("Header Offset: %d\n\n", elhe.Raw.Offset))

	for i, cmd := range *vif {
		sb.WriteString(fmt.Sprintf("Command %d: %s (Opcode: 0x%02X, Num: %d, Immediate: 0x%04X)\n",
			i, cmd.Kind, cmd.Opcode, cmd.Num, cmd.Immediate))

		switch cmd.Kind {
		case VifCommandCYCLE:
			sb.WriteString(fmt.Sprintf("  Cycle: %d\n", cmd.Cycle))
		case VifCommandMASK:
			sb.WriteString(fmt.Sprintf("  Mask: 0x%08X\n", cmd.Mask))
		case VifCommandSTROW:
			sb.WriteString(fmt.Sprintf("  Strow: %v\n", cmd.Strow))
		case VifCommandDIRECT:
			{
				sb.WriteString(fmt.Sprintf("  Direct: %d quadwords\n", len(cmd.Direct)))
				for i, qw := range cmd.Direct {
					sb.WriteString(fmt.Sprintf("    QW[%d]: ", i))

					for _, b := range qw {
						sb.WriteString(fmt.Sprintf("%02X ", b))
					}

					sb.WriteString("\n")
				}
			}
		case VifCommandUNPACK:
			if cmd.Unpack != nil {
				sb.WriteString(fmt.Sprintf("  Unpack Type: %s, Address: 0x%X, Offset: %d\n",
					cmd.Unpack.Type, cmd.Unpack.Address, cmd.Unpack.Offset))
				sb.WriteString(fmt.Sprintf("  Extend Type: %s, Add Tops: %v, Write Masking: %v\n",
					cmd.Unpack.ExtendType, cmd.Unpack.AddTopsToAddress, cmd.Unpack.PerformWriteMasking))

				switch cmd.Unpack.Type {
				case UnpackTypeV4_32:
					for j, entry := range cmd.Unpack.V4_32 {
						sb.WriteString(fmt.Sprintf("    V4_32[%d]: %d, %d, %d, %d (%s)\n",
							j, entry.V1, entry.V2, entry.V3, entry.V4, entry.Debug))
					}
				case UnpackTypeV3_32:
					for j, entry := range cmd.Unpack.V3_32 {
						sb.WriteString(fmt.Sprintf("    V3_32[%d]: %f, %f, %f (%s)\n",
							j, entry.V1, entry.V2, entry.V3, entry.Debug))
					}
				case UnpackTypeV2_32:
					for j, entry := range cmd.Unpack.V2_32 {
						sb.WriteString(fmt.Sprintf("    V2_32[%d]: %f, %f (%s)\n",
							j, entry.V1, entry.V2, entry.Debug))
					}
				case UnpackTypeV4_8:
					for j, entry := range cmd.Unpack.V4_8 {
						sb.WriteString(fmt.Sprintf("    V4_8[%d]: %d, %d, %d, %d (%s)\n",
							j, entry.V1, entry.V2, entry.V3, entry.V4, entry.Debug))
					}
				}
			}
		}
		sb.WriteString("\n")
	}

	return sb.String(), nil
}
