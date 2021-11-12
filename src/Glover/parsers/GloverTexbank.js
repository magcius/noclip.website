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

    this._read();
  }
  GloverTexbank.prototype._read = function() {
    this.nTextures = this._io.readU4be();
    this.asset = new Array(this.nTextures);
    for (var i = 0; i < this.nTextures; i++) {
      this.asset[i] = new Texture(this._io, this, this._root);
    }
  }

  var Texture = GloverTexbank.Texture = (function() {
    function Texture(_io, _parent, _root) {
      this.__type = 'Texture';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Texture.prototype._read = function() {
      this.id = this._io.readU4be();
      this.u2 = this._io.readU2be();
      this.flags = this._io.readU2be();
      this.u3 = this._io.readU4be();
      this.width = this._io.readU2be();
      this.height = this._io.readU2be();
      this.u5 = this._io.readU4be();
      this.length = this._io.readU4be();
      this.colorFormat = this._io.readU2be();
      this.compressionFormat = this._io.readU2be();
      this.dataPtr = this._io.readU4be();
      this.paletteOffset = this._io.readU4be();
      this.data = this._io.readBytes((this.length - 36));
    }

    return Texture;
  })();

  return GloverTexbank;
})();
return GloverTexbank;
}));
