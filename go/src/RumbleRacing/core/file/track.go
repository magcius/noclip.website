package file

import (
	"fmt"
	"io"
	"log"
	"os"
	"rumble-reader/asset"
	"rumble-reader/asset/o3d"
	"rumble-reader/asset/txf"
	"rumble-reader/chunk"
	"rumble-reader/chunk/shoc"
	"strings"
)

type TrackFile struct {
	FileName       string
	FileSize       int64
	TopLevelChunks []chunk.TopLevelChunk
}

func ReadTrackChunks(file io.ReadSeeker) []chunk.TopLevelChunk {

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

func ReadTrackFile(filename string) TrackFile {
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

	chunks := ReadTrackChunks(file)

	return TrackFile{
		FileName:       info.Name(),
		FileSize:       info.Size(),
		TopLevelChunks: chunks,
	}
}

func (t TrackFile) GetResourceList() *asset.RLst {

	// FE2 has multiple resource lists.
	// Let's just combine them and treat it as one giant list for now.
	var newList = asset.RLst{
		Count:   0,
		Entries: []asset.ResourceEntry{},
	}

	headers := t.getHeadersForType("RLst")

	for _, header := range headers {
		// fmt.Println(header.Unk0, header.AssetType, header.AssetIndex, header.TotalDataSize)

		rList, err := asset.ParseRLst(t.getDataForHeader(header), t.FileName)
		if err != nil {
			panic(err)
		}

		newList.Count += rList.Count
		newList.Entries = append(newList.Entries, rList.Entries...)
	}

	return &newList
}

func (t TrackFile) getHeadersForType(assetType string) []shoc.SHDR {
	var headers []shoc.SHDR

	// Get the SHDRs for all assetTypes in the file
	for _, chunk := range t.TopLevelChunks {
		// get SHOC
		shc, ok := chunk.(*shoc.Shoc)
		if ok {
			// Get Headers
			header, ok := shc.MetaData.(*shoc.SHDR)
			if ok {
				if header.AssetType == assetType {
					headers = append(headers, *header)
				}
			}
		}
	}

	return headers
}

func (t TrackFile) getHeaderForResource(res asset.ResourceEntry) *shoc.SHDR {
	for _, chunk := range t.TopLevelChunks {
		// get SHOC
		shc, ok := chunk.(*shoc.Shoc)
		if ok {
			// Get Headers
			header, ok := shc.MetaData.(*shoc.SHDR)
			if ok {
				if header.AssetType == res.TypeTag {
					// fmt.Println("target", res.TypeTag, res.ResourceIndex, "comparing", header.AssetType, header.AssetIndex)
					if header.AssetIndex == res.ResourceIndex {
						// fmt.Println("FOUND!", "target", res.TypeTag, res.ResourceIndex, "comparing", header.AssetType, header.AssetIndex)
						return header
					}
				}
			}
		}
	}

	return nil
}

func (t TrackFile) getDataForHeader(header shoc.SHDR) []byte {

	var assetData []byte

	// hdrShoc := t.TopLevelChunks[header.ShocIndex]
	// fmt.Println("getting data for:", header.AssetType, "size:", header.TotalDataSize, "asset idx:", header.AssetIndex, "| header address:", hdrShoc.StartAddress())
	// fmt.Println("Header addr", hdrShoc.StartAddress())

	shocCount := 1
	for {
		topLevel := t.TopLevelChunks[header.ShocIndex+uint32(shocCount)]

		theShoc, ok := topLevel.(*shoc.Shoc)

		if !ok {
			// skip past filler/unrelated chunks
			continue
		}

		// fmt.Println(theShoc.StartAddress(), theShoc.MetaData.FourCC(), "size:", len(theShoc.Data()))

		switch data := theShoc.MetaData.(type) {
		case *shoc.SDAT:
			assetData = append(assetData, data.Data()...)
		case *shoc.Rdat:
			decompressed, err := shoc.Decompress(data.Data(), int(data.OutBufferSize))
			if err != nil {
				fmt.Println("Error decompressing", header.AssetType, header.AssetIndex)
				return make([]byte, 0)
				// panic(err)
			}
			assetData = append(assetData, decompressed...)
		default:
			panic("Unhandled SHOC type!" + data.FourCC())
		}

		shocCount++
		// fmt.Println("total size", len(assetData))

		// making a pretty big assumption here,
		// that the contiguous shoc data equals header's size value
		if len(assetData) >= int(header.TotalDataSize) {
			break
		}
	}

	return assetData
}

func (t TrackFile) GetResource(resource asset.ResourceEntry) (asset.Asset, error) {
	// fmt.Println("attempting to get", resource.ResourceName, resource.TypeTag, "at resource index", resource.ResourceIndex)
	header := t.getHeaderForResource(resource)
	data := t.getDataForHeader(*header)
	switch resource.TypeTag {
	case "TxtR":
		return asset.ParseTxtR(data, *header)
	case "Cact":
		return asset.ParseActor(data)
	case "obf ":
		return o3d.ParseObf(data)
	case "o3d ":
		return o3d.ParseO3D(false, data, *header, resource.ResourceName)
	case "o3da":
		return o3d.ParseO3D(true, data, *header, resource.ResourceName)
	case "txf ", "txf2":
		name := fmt.Sprintf("%d_%s", resource.ResourceIndex, resource.ResourceName)
		return txf.ParseTXF(data, *header, name)
	default:
		return asset.ParseGenericAsset(data, strings.TrimSpace(resource.TypeTag), *header)
	}
}
