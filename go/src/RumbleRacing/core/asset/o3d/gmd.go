package o3d

type Gmd struct {
	rawData []byte
}

func parseGmd(buf []byte) (*Gmd, error) {
	gmdAsset := Gmd{
		rawData: buf,
	}

	return &gmdAsset, nil
}
