package chunk

import (
	"encoding/hex"
	"fmt"
)

type Chunk interface {
	FourCC() string
	TotalSize() uint32
	StartAddress() uint32
	Data() []byte
}

type TopLevelChunk interface {
	Chunk
	Index() uint32
}

func Print(c TopLevelChunk, doHex bool) {
	fmt.Printf(" %d | %#x | %s | (%d / %#x bytes)\n", c.Index(), c.StartAddress(), c.FourCC(), c.TotalSize(), c.TotalSize())
	if doHex {
		fmt.Println(hex.Dump(c.Data()))
	}
}
