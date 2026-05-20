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

// ParseTxtR parses a byte buffer containing multiple null-terminated strings.
// Each string starts with a decimal number, followed by a space, then some text.
// Example input (as bytes):
//
//	"123 apple\x00" + "456 banana\x00" + "789 cherry\x00"
func ParseTxtR(buf []byte, header shoc.SHDR) (*TxtR, error) {
	resource := TxtR{
		header:  header,
		rawData: buf,
	}
	i := 0

	for i < len(buf) {
		// Find end of current string (null terminator)
		start := i
		for i < len(buf) && buf[i] != 0 {
			i++
		}

		// Empty string or malformed input
		if i == start {
			i++ // skip null terminator
			continue
		}

		// Extract one string
		s := string(buf[start:i])
		// fmt.Println(s)

		// Split into number + text
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
			// return nil, fmt.Errorf("invalid number in entry %q: %w", s, err)
		}

		resource.TextEntries = append(resource.TextEntries, TextEntry{Index: num, Value: textPart})

		i++ // skip null terminator
	}

	return &resource, nil
}
