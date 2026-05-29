package file

import (
	"fmt"
	"io"
	"log"
	"os"
	"rumble-reader/chunk"
)

type AVFile struct {
	FileName       string
	FileSize       int64
	TopLevelChunks []chunk.TopLevelChunk
}

func readAVFile(file io.ReadSeeker) []chunk.TopLevelChunk {

	var chunks []chunk.TopLevelChunk

	var chunkIndex uint32 = 0
	for {
		pos, _ := file.Seek(0, io.SeekCurrent)
		chunkObj, err := readTopLevelChunk(file, chunkIndex)
		if err == io.EOF {
			// fmt.Println("reached end of file!")
			break
		}
		if err == io.ErrUnexpectedEOF {
			fmt.Println("Unexpected EOF — incomplete chunk at end of file.")
			break
		}
		if err != nil {
			log.Fatalf("Error reading chunk at 0x%X: %v", pos, err)
		}

		// Do not append empty FILL chunks, who cares about them.
		_, ok := chunkObj.(*chunk.Fill)

		if !ok {
			chunks = append(chunks, chunkObj)
			// only increment chunk index if we're actually adding a chunk
			chunkIndex++
		}
	}

	return chunks
}

func ReadAVFile(filename string) AVFile {
	file, err := os.Open(filename)

	if err != nil {
		log.Fatalf("Failed to open file: %v", err)
	}

	defer file.Close()

	info, err := file.Stat()

	if err != nil {
		log.Fatalf("Failed to get file info: %v", err)
	}

	// fmt.Printf("File: %s\nSize: %d bytes\n\n", info.Name(), info.Size())

	chunks := readAVFile(file)

	return AVFile{
		FileName:       info.Name(),
		FileSize:       info.Size(),
		TopLevelChunks: chunks,
	}
}

type AudioFile struct {
	Name       string
	RawVagData []byte // lol
	IsVagM     bool
}

func (av *AVFile) ExtractAudio() []AudioFile {

	var avs []AudioFile

	var stream *AudioFile

	for _, toplevel := range av.TopLevelChunks {

		s, ok := toplevel.(*chunk.SWVR)
		if ok {
			if stream != nil {
				avs = append(avs, *stream)
			}
			stream = &AudioFile{
				Name:       s.FileName,
				RawVagData: s.FullData,
				IsVagM:     false,
			}
		}

		if vag, ok := toplevel.(*chunk.VAGB); ok {
			stream.RawVagData = append(stream.RawVagData, vag.FulLData...)
		}

		if vagm, ok := toplevel.(*chunk.VAGM); ok {
			stream.RawVagData = append(stream.RawVagData, vagm.FulLData...)
			stream.IsVagM = true
		}
	}

	if stream != nil {
		avs = append(avs, *stream)
	}

	return avs

}
