package txf

type CLDA struct {
	RawData []byte
}

func parseCLDA(buf []byte) (*CLDA, error) {
	// just strip head + size and return raw data for lookups when generating textures

	return &CLDA{
		RawData: buf[8:],
	}, nil
}
