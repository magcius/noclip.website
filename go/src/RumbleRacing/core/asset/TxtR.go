package asset

import (
	"rumble-reader/chunk/shoc"
	"strconv"
)

type TextEntry struct {
	Index int
	Value string
}

type TxtR struct {
	header      shoc.SHDR
	rawData     []byte
	TextEntries []TextEntry
}

func (t *TxtR) GetType() string {
	return "TxtR"
}

func (t *TxtR) RawData() []byte {
	return t.rawData
}

func (t *TxtR) Header() shoc.SHDR {
	return t.header
}

func ParseTxtR(buf []byte, header shoc.SHDR) (*TxtR, error) {
	resource := TxtR{
		header:  header,
		rawData: buf,
	}
	i := 0

	for i < len(buf) {
		start := i
		for i < len(buf) && buf[i] != 0 {
			i++
		}

		if i == start {
			i++
			continue
		}

		s := string(buf[start:i])

		var numPart, textPart string
		for j, ch := range s {
			if ch == ' ' {
				numPart = s[:j]
				textPart = s[j+1:]
				break
			}
		}

		num, err := strconv.Atoi(numPart)

		if err != nil {
			num = -1
		}

		resource.TextEntries = append(resource.TextEntries, TextEntry{Index: num, Value: textPart})

		i++
	}

	return &resource, nil
}
