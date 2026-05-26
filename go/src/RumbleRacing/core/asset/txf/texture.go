package txf

import (
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"rumble-reader/helpers"
)

type TextureFile struct {
	IsMipMap bool
	Height   uint16
	Width    uint16
	Image    *image.RGBA
}

type Texture struct {
	Name      string
	TextureId uint16
	Files     []TextureFile
}

func (txf *TXF) GetTextures() []Texture {

	var textures []Texture

	for i, zthe := range txf.textureHeaders {
		// panic(txf.header.ZTHEsCount)
		for j, tex := range zthe.Textures {
			clhe := txf.clutHeader.Entries[tex.CLUTHeaderIndex]
			extracted := extractTexturesFromZTHE(txf, clhe, tex, i, j, int(tex.CLUTHeaderIndex))
			textures = append(textures, extracted...)
		}
	}

	return textures
}

const (
	// Texel storage format
	PSMCT32 = 0 // [RGBA32], directly stored in 4 bytes
	PSMCT16 = 2 // [RGBA16, RGBA16] across 4 bytes

	// Indexed color (CLUT Types)
	PSMT8 = 19 // 8 bits per index = 0 -> 255 palette indices
	PSMT4 = 20 // 4 bits per index = 0 -> 16 palette indices
)

// Please ignore how awful this function is, I'm aware it's bad.
func extractTexturesFromZTHE(txf *TXF, clutHeader CLHEEntry, zthe ZTHETexture, ztheIndex int, textureIndex int, clhe_index int) []Texture {
	var mipMaps []TextureFile
	var textures []Texture

	paletteStart := clutHeader.CLDAStartOffset

	// TODO:
	// change behavior based on CLUT and texel mode
	// calculate palette size
	// if PSTM8, the size is 512

	for k, txImage := range zthe.Images {

		// only extract chicken
		// if ztheIndex != 14 || textureIndex != 1 {
		// 	continue
		// }

		var paletteSize uint32
		// clut size is based on whether it's
		switch zthe.TexelStorageFormat {
		case PSMT8:
			// TODO: focus on psmt4 for now.
			// fmt.Println("SKIP LOOKUP:", clutHeader.CLUTImageSizeLookup)
			// continue
			// 8 bits per index, or 2^8
			paletteSize = 256
		case PSMT4:
			// 4 bits per index, or 2^4
			paletteSize = 16
		default:
			panic("Unhandled indexed texel format!")
		}

		var pixelBytes int
		// next, multiply the paletteSize based on number of bytes each pixel/mode takes up
		// going to be 4 bytes per pixel for 32 bit color, or 2 bytes for 16 bit
		switch clutHeader.PixelFormat {
		case PSMCT32: // PSMCT32, 32 bits color per pixel
			pixelBytes = 4
			paletteSize *= 4
		case PSMCT16: // PSMCT16, 16 bits color per pixel
			// continue // TODO: uncomment when fixed
			pixelBytes = 2
			paletteSize *= 2
		default:
			panic("Unhandled clut size!")
		}
		// fmt.Println("Do", zthe.TexelStorageFormat, clutHeader.PixelFormat)
		// continue

		paletteDataUnswizzled := txf.clutData.RawData[paletteStart : paletteStart+paletteSize]

		// represents the final transformed array of CLUT data depending on storage mode
		var swizzled []helpers.PixelBytes
		var err error

		// swizzle clut based on index type
		// I think only 8 bit indexing needs to be swizzled.
		switch zthe.TexelStorageFormat {
		case PSMT8:
			// panic("Shouldn't be here")
			grouped := helpers.GroupBytesIntoChunks(paletteDataUnswizzled, pixelBytes)
			// fmt.Println(len(grouped))
			swizzled, err = helpers.SwizzleClutPstm8(grouped)
			if err != nil {
				panic(err)
			}
		case PSMT4:
			// I don't think this needs to be swizzled, so just group?
			grouped := helpers.GroupBytesIntoChunks(paletteDataUnswizzled, pixelBytes)
			swizzled, err = helpers.SwizzleClutPstm4_16(grouped)
			// fmt.Println(grouped)
			// fmt.Println(swizzled)
			// fmt.Println("zthe:", ztheIndex)
			if err != nil {
				panic(err)
			}
		default:
			// fmt.Println(zthe.TexelStorageFormat)
			panic("unhandled!")
		}

		height := txImage.BlockHeightPixels
		width := zthe.BlockWidthPixels >> k

		img := image.NewRGBA(image.Rect(0, 0, int(width), int(height)))

		// Extract texture data (one byte per pixel)
		start := txImage.TXDAAddressOffset
		size := uint32(height) * uint32(width)
		// if we are using 1 byte or half byte index, the color index needs to change
		colorSize := size

		switch zthe.TexelStorageFormat {
		case PSMT8: // in byte indexed color, the size is already fine
		case PSMT4:
			colorSize /= 2 // but if using half the bits, the size is half
		default:
			panic("Something went wrong!")
		}

		if int(start)+int(colorSize) > len(txf.textureData.RawData) {
			panic("Texture data OOB")
		}

		data := txf.textureData.RawData[start : start+colorSize]
		for pxIndex := range int(size) {

			// get the color index
			var colorIndex uint32
			switch zthe.TexelStorageFormat {
			case PSMT8:
				// panic("Something went wrong")
				// just a normal byte
				colorIndex = uint32(data[pxIndex])
			case PSMT4:

				// 1. Get the 32 bit offset
				// each 32 bit word holds 8 indices
				wordOffset := pxIndex / 8
				// fmt.Println("px ", pxIndex, "at offset", wordOffset, (len(data)))
				// 2. get the word.
				wordStart := wordOffset * 4
				// TODO: swap little for big change order?
				word := binary.LittleEndian.Uint32(data[wordStart : wordStart+4])

				// pixel index is index % 8 bits?
				wordIndex := pxIndex % 8
				shift := uint(wordIndex * 4)
				lookup := (word >> shift) & 0xF
				// fmt.Println("px ", pxIndex, "at word ", wordOffset, len(data), word, wordStart)
				colorIndex = lookup

				// half the pxIndex will get you the byte base
				// base := pxIndex / 2
				// twoColors := uint32(data[base])

				// low := (twoColors & 0xF0) >> 4
				// high := twoColors & 0xF
				// // TODO: might need to swap logic here
				// if (pxIndex % 2) != 0 {
				// 	colorIndex = low
				// } else {
				// 	colorIndex = high
				// }
			}

			idx := colorIndex

			// px := binary.LittleEndian.Uint16(swizzledPalette[idx : idx+2])
			// fmt.Println(zthe.TexelStorageFormat, size)
			finalPixel := swizzled[idx]

			var R uint8
			var G uint8
			var B uint8
			var A uint8

			switch clutHeader.PixelFormat {
			case PSMCT16:
				R, G, B, A = extract16bitRGBA(finalPixel) // 255uint8(a1 * 255)
			case PSMCT32:
				// fmt.Println(hex.Dump(paletteDataUnswizzled))
				// fmt.Println(swizzled)
				// fmt.Println("final pixel:", finalPixel.Bytes, "idx/colorIdx", idx, colorIndex)
				// fmt.Println(len(txf.clutHeader.Entries))
				R, G, B, A = extract32bitRGBA(finalPixel)
			default:
				panic("Something went wrong!")
			}

			x := pxIndex % int(width)
			y := pxIndex / int(width)

			img.Set(x, y, color.RGBA{R, G, B, A})
		}

		// fmt.Println("LOOKUP:", clutHeader.CLUTImageSizeLookup)
		mipMaps = append(mipMaps, TextureFile{
			Height:   height,
			Width:    width,
			Image:    img,
			IsMipMap: k > 0,
		})
	}

	textures = append(textures, Texture{
		// Name:  fmt.Sprintf("id_%d_%d_%d_%d", zthe.Something, ztheIndex, textureIndex, clhe_index),
		Name:      fmt.Sprintf("texture_%d", zthe.TextureId),
		TextureId: zthe.TextureId,
		Files:     mipMaps,
	})

	return textures
}

func extract32bitRGBA(finalPixel helpers.PixelBytes) (uint8, uint8, uint8, uint8) {
	if len(finalPixel.Bytes) != 4 {
		panic("You messed up.")
	}
	// TODO: might need to swap this?
	// word := binary.LittleEndian.Uint32(finalPixel.Bytes)

	R := finalPixel.Bytes[0]
	G := finalPixel.Bytes[1]
	B := finalPixel.Bytes[2]
	A := uint8(float32(finalPixel.Bytes[3]) / 128.0 * 255.0)

	// A := 255 //finalPixel.Bytes[3]
	// A := (word & 0xFF000000) >> (8 * 3)
	// B := (word & 0x00FF0000) >> (8 * 2)
	// G := (word & 0x0000FF00) >> (8 * 1)
	// R := (word & 0x000000FF)

	// fmt.Println(len(finalPixel.Bytes), hex.Dump(finalPixel.Bytes), word)
	// panic("unimplemented")

	return uint8(R), uint8(G), uint8(B), uint8(A)
}

func extract16bitRGBA(finalPixel helpers.PixelBytes) (uint8, uint8, uint8, uint8) {
	if len(finalPixel.Bytes) != 2 {
		panic("You messed up 16bit RGBA")
	}
	px := binary.LittleEndian.Uint16(finalPixel.Bytes)

	// Extract 5:5:5 bits
	r5 := px & 0x1F
	g5 := (px >> 5) & 0x1F
	b5 := (px >> 10) & 0x1F
	// a1 := (px >> 15) & 0x1

	R := uint8((r5 * 255) / 31)
	G := uint8((g5 * 255) / 31)
	B := uint8((b5 * 255) / 31)
	A := uint8(255)

	// TODO: understand why the alpha a1 isn't working..
	// This is a total hack that treats pure black pixels as fully transparent.
	// This seems to work OK so far, but surely this isn't technically correct.
	if R == 0 && G == 0 && B == 0 {
		A = 0
	}

	return R, G, B, A
}
