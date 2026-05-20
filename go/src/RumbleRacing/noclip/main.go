//go:build js && wasm

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image/png"
	"rumble-reader-noclip/helpers"
	"rumble-reader/asset"
	"rumble-reader/asset/o3d"
	"rumble-reader/asset/txf"
	"rumble-reader/file"
	"strings"
	"syscall/js"
)

func main() {
	js.Global().Set("parseTrackFile", js.FuncOf(parseTrackFile))
	select {} // keep alive
}

func parseTrackFile(this js.Value, args []js.Value) any {
	uint8Arr := args[0]     // Uint8Array
	isGlobalFile := args[1] // bool

	length := uint8Arr.Get("length").Int()
	data := make([]byte, length)

	js.CopyBytesToGo(data, uint8Arr)

	// now data is a real go []byte
	fmt.Println("Got bytes:", len(data))

	result := processTrackFile(data, isGlobalFile.Bool())

	dataString, err := json.Marshal(result)
	if err != nil {
		fmt.Println(err)
		panic("Something horrible happened converting to JSON:")
	}

	return string(dataString)
}

type RumbleRacingTrackFile struct {
	Obfs     []ObfData
	O3Ds     []O3DData
	Actors   []ActorData
	Textures []TextureData
}

type ObfData struct {
	Name     string
	RootNode helpers.ObfJsonNode
}

type O3DData struct {
	Name          string
	ResourceIndex uint32
	IsAnimated    bool
	Obfs          []ObfData
}

type ActorData struct {
	Name          string
	ResourceIndex uint32

	X      float32
	Y      float32
	Z      float32
	ScaleX float32
	ScaleY float32
	ScaleZ float32
	AngleX float32
	AngleY float32
	AngleZ float32

	O3DResourceIndex uint32
}

type TextureData struct {
	TextureId uint16
	PngBytes  []byte
}

func processTrackFile(rawData []byte, isGlobalFile bool) RumbleRacingTrackFile {

	out := RumbleRacingTrackFile{
		Obfs:     []ObfData{},
		Textures: []TextureData{},
		O3Ds:     []O3DData{},
		Actors:   []ActorData{},
	}

	reader := bytes.NewReader(rawData)

	track := file.TrackFile{
		FileName:       "DEBUG",
		FileSize:       int64(len(rawData)),
		TopLevelChunks: file.ReadTrackChunks(reader),
	}

	// fmt.Println("TOTLA ", len(track.TopLevelChunks))

	resourceList := track.GetResourceList()

	for _, res := range resourceList.Entries {
		// fmt.Println(idx, res.ResourceIndex, res.TypeTag, res.ResourceName)

		// We only care about certain resources, don't waste time parsing irrelevant stuff
		// you might not like it, but this is what peak Go programming looks like
		if res.TypeTag != "Cact" &&
			res.TypeTag != "txf " &&
			res.TypeTag != "txf2" &&
			res.TypeTag != "obf " &&
			res.TypeTag != "o3d " &&
			res.TypeTag != "o3da" {
			continue
		}

		// Only extract certain files from the global track file
		// we don't want to waste time processing huge car textures and models when we never use them.
		if isGlobalFile && !strings.Contains(res.ResourceName, "GLOBAL") {
			// fmt.Println("skipping:", res.ResourceName)
			continue
		}

		resource, err := track.GetResource(res)

		if err != nil {
			fmt.Println("Error fetching resource", res.ResourceName, err)
			continue
		}

		switch thing := resource.(type) {
		case *asset.Actor:
			{
				// fmt.Println("ACTOR FOUND:", thing.ActorType, thing.X, thing.Y, thing.Z)
				// we only care about actors that have models for now..
				if thing.O3DResourceIndex > 0 {
					out.Actors = append(out.Actors, ActorData{
						Name:             res.ResourceName,
						ResourceIndex:    res.ResourceIndex,
						X:                thing.X,
						Y:                thing.Y,
						Z:                thing.Z,
						ScaleX:           thing.ScaleX,
						ScaleY:           thing.ScaleY,
						ScaleZ:           thing.ScaleZ,
						AngleX:           thing.AngleX,
						AngleY:           thing.AngleY,
						AngleZ:           thing.AngleZ,
						O3DResourceIndex: thing.O3DResourceIndex,
					})
				}
			}
		case *o3d.Obf:
			{
				out.Obfs = append(out.Obfs, ObfData{
					Name:     res.ResourceName,
					RootNode: *helpers.BuildObfNode(thing.RootNode),
				})
			}
		case *o3d.O3D:
			{
				obfs := []ObfData{}

				for idx, obf := range thing.Obfs {
					obfs = append(obfs, ObfData{
						Name:     fmt.Sprintf("obf_%d", idx),
						RootNode: *helpers.BuildObfNode(obf.RootNode),
					})
				}

				out.O3Ds = append(out.O3Ds, O3DData{
					Name:          res.ResourceName,
					ResourceIndex: res.ResourceIndex,
					IsAnimated:    thing.IsAnimated,
					Obfs:          obfs,
				})
			}
		case *txf.TXF:
			{
				for _, tex := range thing.GetTextures() {
					var buf bytes.Buffer
					png.Encode(&buf, tex.Files[0].Image)
					out.Textures = append(out.Textures, TextureData{
						TextureId: tex.TextureId,
						PngBytes:  buf.Bytes(),
					})
				}
			}
		default:
			{
				panic("UNHANDLED ASSET " + thing.GetType())
			}
		}
	}

	return out
}
