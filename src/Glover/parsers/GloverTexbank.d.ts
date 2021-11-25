// This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild

interface DebugPosition {
  start: number;
  end: number;
  ioOffset: number;
}

declare class GloverTexbank {
  constructor(io: any, parent?: any, root?: any);
  __type: 'GloverTexbank';
  _io: any;

  nTextures: number;
  asset: GloverTexbank.Texture[];

  _debug: {
    nTextures: DebugPosition;
    asset: DebugPosition;
  };
}

declare namespace GloverTexbank {
  class Texture {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Texture';
    _io: any;

    id: number;
    u2: number;
    flags: number;
    u3: number;
    width: number;
    height: number;
    masks: number;
    maskt: number;
    length: number;
    colorFormat: GloverTexbank.TextureColorFormat;
    compressionFormat: GloverTexbank.TextureCompressionFormat;
    dataPtr: number;
    paletteOffset: number;
    data: Uint8Array;

    _debug: {
      id: DebugPosition;
      u2: DebugPosition;
      flags: DebugPosition;
      u3: DebugPosition;
      width: DebugPosition;
      height: DebugPosition;
      masks: DebugPosition;
      maskt: DebugPosition;
      length: DebugPosition;
      colorFormat: DebugPosition & { enumName: string; };
      compressionFormat: DebugPosition & { enumName: string; };
      dataPtr: DebugPosition;
      paletteOffset: DebugPosition;
      data: DebugPosition;
    };
  }
}

declare namespace GloverTexbank {
  enum TextureCompressionFormat {
    CI4 = 0,
    CI8 = 1,
    UNCOMPRESSED_16B = 2,
    UNCOMPRESSED_32B = 3,
  }
}

declare namespace GloverTexbank {
  enum TextureColorFormat {
    RGBA = 0,
    YUV = 1,
    CI = 2,
    IA = 3,
    I = 4,
  }
}

export = GloverTexbank;
export as namespace GloverTexbank;
