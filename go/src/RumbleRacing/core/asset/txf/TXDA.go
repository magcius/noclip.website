package txf

type TXDA struct {
	RawData []byte
}

func parseTXDA(buf []byte) (*TXDA, error) {

	// just strip head + size and return raw data for lookups when generating textures

	return &TXDA{
		RawData: buf[8:],
	}, nil
}
