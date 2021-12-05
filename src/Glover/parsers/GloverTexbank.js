// This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['kaitai-struct/KaitaiStream'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('kaitai-struct/KaitaiStream'));
  } else {
    root.GloverTexbank = factory(root.KaitaiStream);
  }
}(typeof self !== 'undefined' ? self : this, function (KaitaiStream) {
var GloverTexbank = (function() {
  GloverTexbank.TextureCompressionFormat = Object.freeze({
    CI4: 0,
    CI8: 1,
    UNCOMPRESSED_16B: 2,
    UNCOMPRESSED_32B: 3,

    0: "CI4",
    1: "CI8",
    2: "UNCOMPRESSED_16B",
    3: "UNCOMPRESSED_32B",
  });

  GloverTexbank.TextureColorFormat = Object.freeze({
    RGBA: 0,
    YUV: 1,
    CI: 2,
    IA: 3,
    I: 4,

    0: "RGBA",
    1: "YUV",
    2: "CI",
    3: "IA",
    4: "I",
  });

  function GloverTexbank(_io, _parent, _root) {
    this.__type = 'GloverTexbank';
    this._io = _io;
    this._parent = _parent;
    this._root = _root || this;
    this._debug = {};

    this._read();
  }
  GloverTexbank.prototype._read = function() {
    this._debug.nTextures = { start: this._io.pos, ioOffset: this._io.byteOffset };
    this.nTextures = this._io.readU4be();
    this._debug.nTextures.end = this._io.pos;
    this._debug.asset = { start: this._io.pos, ioOffset: this._io.byteOffset };
    this.asset = new Array(this.nTextures);
    this._debug.asset.arr = new Array(this.nTextures);
    for (var i = 0; i < this.nTextures; i++) {
      this._debug.asset.arr[i] = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.asset[i] = new Texture(this._io, this, this._root);
      this._debug.asset.arr[i].end = this._io.pos;
    }
    this._debug.asset.end = this._io.pos;
  }

  var Texture = GloverTexbank.Texture = (function() {
    function Texture(_io, _parent, _root) {
      this.__type = 'Texture';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Texture.prototype._read = function() {
      this._debug.id = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.id = this._io.readU4be();
      this._debug.id.end = this._io.pos;
      this._debug.paletteAnimIdxMin = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.paletteAnimIdxMin = this._io.readU1();
      this._debug.paletteAnimIdxMin.end = this._io.pos;
      this._debug.paletteAnimIdxMax = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.paletteAnimIdxMax = this._io.readU1();
      this._debug.paletteAnimIdxMax.end = this._io.pos;
      this._debug.flags = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.flags = this._io.readU2be();
      this._debug.flags.end = this._io.pos;
      this._debug.frameIncrement = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.frameIncrement = this._io.readS2be();
      this._debug.frameIncrement.end = this._io.pos;
      this._debug.frameCounter = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.frameCounter = this._io.readS2be();
      this._debug.frameCounter.end = this._io.pos;
      this._debug.width = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.width = this._io.readU2be();
      this._debug.width.end = this._io.pos;
      this._debug.height = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.height = this._io.readU2be();
      this._debug.height.end = this._io.pos;
      this._debug.masks = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.masks = this._io.readU2be();
      this._debug.masks.end = this._io.pos;
      this._debug.maskt = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.maskt = this._io.readU2be();
      this._debug.maskt.end = this._io.pos;
      this._debug.length = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.length = this._io.readU4be();
      this._debug.length.end = this._io.pos;
      this._debug.colorFormat = { start: this._io.pos, ioOffset: this._io.byteOffset, enumName: "GloverTexbank.TextureColorFormat" };
      this.colorFormat = this._io.readU2be();
      this._debug.colorFormat.end = this._io.pos;
      this._debug.compressionFormat = { start: this._io.pos, ioOffset: this._io.byteOffset, enumName: "GloverTexbank.TextureCompressionFormat" };
      this.compressionFormat = this._io.readU2be();
      this._debug.compressionFormat.end = this._io.pos;
      this._debug.dataPtr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.dataPtr = this._io.readU4be();
      this._debug.dataPtr.end = this._io.pos;
      this._debug.paletteOffset = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.paletteOffset = this._io.readU4be();
      this._debug.paletteOffset.end = this._io.pos;
      this._debug.data = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.data = this._io.readBytes((this.length - 36));
      this._debug.data.end = this._io.pos;
    }

    return Texture;
  })();

  return GloverTexbank;
})();
return GloverTexbank;
}));
