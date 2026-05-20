package asset

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"strings"
)

type RLst struct {
	FileName string
	Count    uint32
	Entries  []ResourceEntry
}

func (r *RLst) GetType() string {
	return "RLst"
}

type ResourceEntry struct {
	TypeTag       string
	ResourceIndex uint32
	ResourceName  string
}

func ParseRLst(data []byte, fileName string) (*RLst, error) {
	r := bytes.NewReader(data)

	var count uint32
	if err := binary.Read(r, binary.LittleEndian, &count); err != nil {
		return nil, fmt.Errorf("failed to read count: %w", err)
	}

	entries := make([]ResourceEntry, 0, count)
	for i := uint32(0); i < count; i++ {
		var tag [4]byte
		if _, err := io.ReadFull(r, tag[:]); err != nil {
			return nil, fmt.Errorf("failed to read tag (entry %d): %w", i, err)
		}

		// Reverse bytes
		for j := 0; j < 2; j++ {
			tag[j], tag[3-j] = tag[3-j], tag[j]
		}

		var index uint32
		if err := binary.Read(r, binary.LittleEndian, &index); err != nil {
			return nil, fmt.Errorf("failed to read index (entry %d): %w", i, err)
		}

		var nameBytes [24]byte
		if _, err := io.ReadFull(r, nameBytes[:]); err != nil {
			return nil, fmt.Errorf("failed to read name (entry %d): %w", i, err)
		}

		name := string(nameBytes[:])
		name = strings.TrimRight(name, "\x00") // strip null padding

		entry := ResourceEntry{
			TypeTag:       string(tag[:]),
			ResourceIndex: index,
			ResourceName:  name,
		}
		entries = append(entries, entry)
	}

	return &RLst{
		Count:    count,
		Entries:  entries,
		FileName: fileName,
	}, nil
}
