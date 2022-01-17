// This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['kaitai-struct/KaitaiStream'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('kaitai-struct/KaitaiStream'));
  } else {
    root.GloverLevel = factory(root.KaitaiStream);
  }
}(typeof self !== 'undefined' ? self : this, function (KaitaiStream) {
var GloverLevel = (function() {
  function GloverLevel(_io, _parent, _root) {
    this.__type = 'GloverLevel';
    this._io = _io;
    this._parent = _parent;
    this._root = _root || this;
    this._debug = {};

    this._read();
  }
  GloverLevel.prototype._read = function() {
    this._debug.length = { start: this._io.pos, ioOffset: this._io.byteOffset };
    this.length = this._io.readU4be();
    this._debug.length.end = this._io.pos;
    this._debug.name = { start: this._io.pos, ioOffset: this._io.byteOffset };
    this.name = KaitaiStream.bytesToStr(this._io.readBytesTerm(0, false, true, true), "ASCII");
    this._debug.name.end = this._io.pos;
    this._debug.body = { start: this._io.pos, ioOffset: this._io.byteOffset };
    this.body = [];
    this._debug.body.arr = [];
    var i = 0;
    while (!this._io.isEof()) {
      this._debug.body.arr[this.body.length] = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.body.push(new Cmd(this._io, this, this._root));
      this._debug.body.arr[this.body.length - 1].end = this._io.pos;
      i++;
    }
    this._debug.body.end = this._io.pos;
  }

  var PuzzleAction0x54 = GloverLevel.PuzzleAction0x54 = (function() {
    function PuzzleAction0x54(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x54';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleAction0x54.prototype._read = function() {
      this._debug.u320x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x14 = this._io.readU2be();
      this._debug.u320x14.end = this._io.pos;
      this._debug.u320x16 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x16 = this._io.readU2be();
      this._debug.u320x16.end = this._io.pos;
      this._debug.u320x18 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x18 = this._io.readU2be();
      this._debug.u320x18.end = this._io.pos;
      this._debug.u320x1a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x1a = this._io.readU2be();
      this._debug.u320x1a.end = this._io.pos;
      this._debug.u320x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x1c = this._io.readU2be();
      this._debug.u320x1c.end = this._io.pos;
      this._debug.u320x1e = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x1e = this._io.readU2be();
      this._debug.u320x1e.end = this._io.pos;
      this._debug.u320x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x10 = this._io.readU2be();
      this._debug.u320x10.end = this._io.pos;
      this._debug.u160x0e = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0e = this._io.readU2be();
      this._debug.u160x0e.end = this._io.pos;
      this._debug.u320x24 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x24 = this._io.readU4be();
      this._debug.u320x24.end = this._io.pos;
      this._debug.u320x28 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x28 = this._io.readU4be();
      this._debug.u320x28.end = this._io.pos;
      this._debug.u320x2c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x2c = this._io.readU4be();
      this._debug.u320x2c.end = this._io.pos;
      this._debug.u160x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0a = this._io.readU2be();
      this._debug.u160x0a.end = this._io.pos;
    }

    return PuzzleAction0x54;
  })();

  var PuzzleAction0x460x470x48 = GloverLevel.PuzzleAction0x460x470x48 = (function() {
    function PuzzleAction0x460x470x48(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x460x470x48';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleAction0x460x470x48.prototype._read = function() {
      this._debug.u320x24 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x24 = this._io.readU4be();
      this._debug.u320x24.end = this._io.pos;
      this._debug.u160x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0a = this._io.readU2be();
      this._debug.u160x0a.end = this._io.pos;
    }

    return PuzzleAction0x460x470x48;
  })();

  var PlatSound0xc2 = GloverLevel.PlatSound0xc2 = (function() {
    function PlatSound0xc2(_io, _parent, _root) {
      this.__type = 'PlatSound0xc2';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSound0xc2.prototype._read = function() {
      this._debug.soundId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.soundId = this._io.readU2be();
      this._debug.soundId.end = this._io.pos;
      this._debug.volume = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.volume = this._io.readU2be();
      this._debug.volume.end = this._io.pos;
      this._debug.pitch = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.pitch = this._io.readU2be();
      this._debug.pitch.end = this._io.pos;
    }

    return PlatSound0xc2;
  })();

  var PlatSpinPause0x7c = GloverLevel.PlatSpinPause0x7c = (function() {
    function PlatSpinPause0x7c(_io, _parent, _root) {
      this.__type = 'PlatSpinPause0x7c';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpinPause0x7c.prototype._read = function() {
      this._debug.u160x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0c = this._io.readU2be();
      this._debug.u160x0c.end = this._io.pos;
      this._debug.u160x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0a = this._io.readU2be();
      this._debug.u160x0a.end = this._io.pos;
    }

    return PlatSpinPause0x7c;
  })();

  var PlatMagnet0x8b = GloverLevel.PlatMagnet0x8b = (function() {
    function PlatMagnet0x8b(_io, _parent, _root) {
      this.__type = 'PlatMagnet0x8b';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatMagnet0x8b.prototype._read = function() {
      this._debug.u160x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0c = this._io.readU2be();
      this._debug.u160x0c.end = this._io.pos;
      this._debug.u320x48 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x48 = this._io.readU4be();
      this._debug.u320x48.end = this._io.pos;
      this._debug.u320x4c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x4c = this._io.readU4be();
      this._debug.u320x4c.end = this._io.pos;
      this._debug.u320x50 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x50 = this._io.readU4be();
      this._debug.u320x50.end = this._io.pos;
      this._debug.u320x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x10 = this._io.readU4be();
      this._debug.u320x10.end = this._io.pos;
      this._debug.u320x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x14 = this._io.readU4be();
      this._debug.u320x14.end = this._io.pos;
      this._debug.u320x18 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x18 = this._io.readU4be();
      this._debug.u320x18.end = this._io.pos;
      this._debug.u320x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x1c = this._io.readU4be();
      this._debug.u320x1c.end = this._io.pos;
    }

    return PlatMagnet0x8b;
  })();

  var EnemyInstructionError = GloverLevel.EnemyInstructionError = (function() {
    function EnemyInstructionError(_io, _parent, _root) {
      this.__type = 'EnemyInstructionError';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyInstructionError.prototype._read = function() {
    }

    return EnemyInstructionError;
  })();

  var Backdrop = GloverLevel.Backdrop = (function() {
    function Backdrop(_io, _parent, _root) {
      this.__type = 'Backdrop';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Backdrop.prototype._read = function() {
      this._debug.textureId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.textureId = this._io.readU4be();
      this._debug.textureId.end = this._io.pos;
      this._debug.decalPosX = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.decalPosX = this._io.readU2be();
      this._debug.decalPosX.end = this._io.pos;
      this._debug.decalPosY = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.decalPosY = this._io.readU2be();
      this._debug.decalPosY.end = this._io.pos;
      this._debug.sortKey = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.sortKey = this._io.readU2be();
      this._debug.sortKey.end = this._io.pos;
      this._debug.offsetY = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.offsetY = this._io.readS2be();
      this._debug.offsetY.end = this._io.pos;
      this._debug.scaleX = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.scaleX = this._io.readU2be();
      this._debug.scaleX.end = this._io.pos;
      this._debug.scaleY = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.scaleY = this._io.readU2be();
      this._debug.scaleY.end = this._io.pos;
      this._debug.flipX = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.flipX = this._io.readU2be();
      this._debug.flipX.end = this._io.pos;
      this._debug.flipY = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.flipY = this._io.readU2be();
      this._debug.flipY.end = this._io.pos;
      this._debug.scrollSpeedX = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.scrollSpeedX = this._io.readU2be();
      this._debug.scrollSpeedX.end = this._io.pos;
      this._debug.unused = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.unused = this._io.readU2be();
      this._debug.unused.end = this._io.pos;
      this._debug.decalParentIdx = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.decalParentIdx = this._io.readU2be();
      this._debug.decalParentIdx.end = this._io.pos;
    }

    return Backdrop;
  })();

  var DiffuseLight = GloverLevel.DiffuseLight = (function() {
    function DiffuseLight(_io, _parent, _root) {
      this.__type = 'DiffuseLight';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    DiffuseLight.prototype._read = function() {
      this._debug.r = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.r = this._io.readU2be();
      this._debug.r.end = this._io.pos;
      this._debug.g = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.g = this._io.readU2be();
      this._debug.g.end = this._io.pos;
      this._debug.b = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.b = this._io.readU2be();
      this._debug.b.end = this._io.pos;
      this._debug.thetaX = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.thetaX = this._io.readF4be();
      this._debug.thetaX.end = this._io.pos;
      this._debug.thetaY = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.thetaY = this._io.readF4be();
      this._debug.thetaY.end = this._io.pos;
    }

    return DiffuseLight;
  })();

  var PlatPathAcceleration = GloverLevel.PlatPathAcceleration = (function() {
    function PlatPathAcceleration(_io, _parent, _root) {
      this.__type = 'PlatPathAcceleration';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatPathAcceleration.prototype._read = function() {
      this._debug.acceleration = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.acceleration = this._io.readF4be();
      this._debug.acceleration.end = this._io.pos;
    }

    return PlatPathAcceleration;
  })();

  var Buzzer = GloverLevel.Buzzer = (function() {
    function Buzzer(_io, _parent, _root) {
      this.__type = 'Buzzer';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Buzzer.prototype._read = function() {
      this._debug.u160x2a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x2a = this._io.readU2be();
      this._debug.u160x2a.end = this._io.pos;
      this._debug.tag0x24 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.tag0x24 = this._io.readU2be();
      this._debug.tag0x24.end = this._io.pos;
      this._debug.tag0x20 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.tag0x20 = this._io.readU2be();
      this._debug.tag0x20.end = this._io.pos;
      this._debug.u160x28 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x28 = this._io.readU2be();
      this._debug.u160x28.end = this._io.pos;
      this._debug.u80x2c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u80x2c = this._io.readU2be();
      this._debug.u80x2c.end = this._io.pos;
      this._debug.u80x2d = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u80x2d = this._io.readU2be();
      this._debug.u80x2d.end = this._io.pos;
      this._debug.u80x2e = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u80x2e = this._io.readU2be();
      this._debug.u80x2e.end = this._io.pos;
      this._debug.u80x2f = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u80x2f = this._io.readU2be();
      this._debug.u80x2f.end = this._io.pos;
      this._debug.u320x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x08 = this._io.readU4be();
      this._debug.u320x08.end = this._io.pos;
      this._debug.u320x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x0c = this._io.readU4be();
      this._debug.u320x0c.end = this._io.pos;
      this._debug.u320x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x10 = this._io.readU4be();
      this._debug.u320x10.end = this._io.pos;
      this._debug.u320x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x14 = this._io.readU4be();
      this._debug.u320x14.end = this._io.pos;
      this._debug.u320x18 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x18 = this._io.readU4be();
      this._debug.u320x18.end = this._io.pos;
      this._debug.u320x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x1c = this._io.readU4be();
      this._debug.u320x1c.end = this._io.pos;
      this._debug.u320x50 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x50 = this._io.readU4be();
      this._debug.u320x50.end = this._io.pos;
      this._debug.u320x54 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x54 = this._io.readU4be();
      this._debug.u320x54.end = this._io.pos;
    }

    return Buzzer;
  })();

  var PuzzleAny = GloverLevel.PuzzleAny = (function() {
    function PuzzleAny(_io, _parent, _root) {
      this.__type = 'PuzzleAny';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleAny.prototype._read = function() {
      this._debug.op = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.op = this._io.readU2be();
      this._debug.op.end = this._io.pos;
    }

    return PuzzleAny;
  })();

  var SetActorRotation = GloverLevel.SetActorRotation = (function() {
    function SetActorRotation(_io, _parent, _root) {
      this.__type = 'SetActorRotation';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    SetActorRotation.prototype._read = function() {
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
    }

    return SetActorRotation;
  })();

  var CameoInst = GloverLevel.CameoInst = (function() {
    function CameoInst(_io, _parent, _root) {
      this.__type = 'CameoInst';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    CameoInst.prototype._read = function() {
      this._debug.instType = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.instType = this._io.readU2be();
      this._debug.instType.end = this._io.pos;
      this._debug.body = { start: this._io.pos, ioOffset: this._io.byteOffset };
      switch (this.instType) {
      case 0:
        this.body = new CameoInst0(this._io, this, this._root);
        break;
      case 4:
        this.body = new CameoInst4(this._io, this, this._root);
        break;
      case 6:
        this.body = new CameoInst6(this._io, this, this._root);
        break;
      case 1:
        this.body = new CameoInst1(this._io, this, this._root);
        break;
      case 3:
        this.body = new CameoInst3(this._io, this, this._root);
        break;
      case 5:
        this.body = new CameoInst5(this._io, this, this._root);
        break;
      case 2:
        this.body = new CameoInst2(this._io, this, this._root);
        break;
      default:
        this.body = new CameoInstDefault(this._io, this, this._root);
        break;
      }
      this._debug.body.end = this._io.pos;
    }

    return CameoInst;
  })();

  var PlatMvspn0x5a = GloverLevel.PlatMvspn0x5a = (function() {
    function PlatMvspn0x5a(_io, _parent, _root) {
      this.__type = 'PlatMvspn0x5a';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatMvspn0x5a.prototype._read = function() {
      this._debug.u160x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x1c = this._io.readU2be();
      this._debug.u160x1c.end = this._io.pos;
      this._debug.u320x18 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x18 = this._io.readU4be();
      this._debug.u320x18.end = this._io.pos;
    }

    return PlatMvspn0x5a;
  })();

  var PlatMvspn0x74 = GloverLevel.PlatMvspn0x74 = (function() {
    function PlatMvspn0x74(_io, _parent, _root) {
      this.__type = 'PlatMvspn0x74';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatMvspn0x74.prototype._read = function() {
      this._debug.u320x34 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x34 = this._io.readU4be();
      this._debug.u320x34.end = this._io.pos;
      this._debug.u320x38 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x38 = this._io.readU4be();
      this._debug.u320x38.end = this._io.pos;
      this._debug.u320x3c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x3c = this._io.readU4be();
      this._debug.u320x3c.end = this._io.pos;
    }

    return PlatMvspn0x74;
  })();

  var PlatOrbit = GloverLevel.PlatOrbit = (function() {
    function PlatOrbit(_io, _parent, _root) {
      this.__type = 'PlatOrbit';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatOrbit.prototype._read = function() {
      this._debug.u16120 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u16120 = this._io.readU2be();
      this._debug.u16120.end = this._io.pos;
      this._debug.u16136 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u16136 = this._io.readU2be();
      this._debug.u16136.end = this._io.pos;
      this._debug.u16134 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u16134 = this._io.readU2be();
      this._debug.u16134.end = this._io.pos;
      this._debug.u16132 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u16132 = this._io.readU2be();
      this._debug.u16132.end = this._io.pos;
      this._debug.u32116 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u32116 = this._io.readU4be();
      this._debug.u32116.end = this._io.pos;
      this._debug.name = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this._debug.name.end = this._io.pos;
      this._debug.f112 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f112 = this._io.readF4be();
      this._debug.f112.end = this._io.pos;
      this._debug.f108 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f108 = this._io.readF4be();
      this._debug.f108.end = this._io.pos;
      this._debug.f104 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f104 = this._io.readF4be();
      this._debug.f104.end = this._io.pos;
      this._debug.f100 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f100 = this._io.readF4be();
      this._debug.f100.end = this._io.pos;
      this._debug.f96 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f96 = this._io.readF4be();
      this._debug.f96.end = this._io.pos;
      this._debug.f92 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f92 = this._io.readF4be();
      this._debug.f92.end = this._io.pos;
      this._debug.f88 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f88 = this._io.readF4be();
      this._debug.f88.end = this._io.pos;
      this._debug.f84 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f84 = this._io.readF4be();
      this._debug.f84.end = this._io.pos;
      this._debug.f80 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f80 = this._io.readF4be();
      this._debug.f80.end = this._io.pos;
      this._debug.u32176 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u32176 = this._io.readU4be();
      this._debug.u32176.end = this._io.pos;
    }

    return PlatOrbit;
  })();

  var PlatSpike = GloverLevel.PlatSpike = (function() {
    function PlatSpike(_io, _parent, _root) {
      this.__type = 'PlatSpike';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpike.prototype._read = function() {
    }

    return PlatSpike;
  })();

  var PlatSpecial0x8e = GloverLevel.PlatSpecial0x8e = (function() {
    function PlatSpecial0x8e(_io, _parent, _root) {
      this.__type = 'PlatSpecial0x8e';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpecial0x8e.prototype._read = function() {
      this._debug.enable = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.enable = this._io.readU2be();
      this._debug.enable.end = this._io.pos;
    }

    return PlatSpecial0x8e;
  })();

  var PlatActorSurfaceType = GloverLevel.PlatActorSurfaceType = (function() {
    function PlatActorSurfaceType(_io, _parent, _root) {
      this.__type = 'PlatActorSurfaceType';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatActorSurfaceType.prototype._read = function() {
      this._debug.value = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.value = this._io.readU2be();
      this._debug.value.end = this._io.pos;
    }

    return PlatActorSurfaceType;
  })();

  var Plat0x9f = GloverLevel.Plat0x9f = (function() {
    function Plat0x9f(_io, _parent, _root) {
      this.__type = 'Plat0x9f';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Plat0x9f.prototype._read = function() {
      this._debug.u320x6c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x6c = this._io.readU4be();
      this._debug.u320x6c.end = this._io.pos;
      this._debug.u320x70 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x70 = this._io.readU4be();
      this._debug.u320x70.end = this._io.pos;
      this._debug.u320x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x1c = this._io.readU4be();
      this._debug.u320x1c.end = this._io.pos;
      this._debug.u320x28 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x28 = this._io.readU4be();
      this._debug.u320x28.end = this._io.pos;
    }

    return Plat0x9f;
  })();

  var EnvironmentalSound = GloverLevel.EnvironmentalSound = (function() {
    function EnvironmentalSound(_io, _parent, _root) {
      this.__type = 'EnvironmentalSound';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnvironmentalSound.prototype._read = function() {
      this._debug.soundId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.soundId = this._io.readU2be();
      this._debug.soundId.end = this._io.pos;
      this._debug.volume = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.volume = this._io.readU2be();
      this._debug.volume.end = this._io.pos;
      this._debug.flags = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.flags = this._io.readU2be();
      this._debug.flags.end = this._io.pos;
      this._debug.h0x06 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x06 = this._io.readU2be();
      this._debug.h0x06.end = this._io.pos;
      this._debug.h0x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x08 = this._io.readU2be();
      this._debug.h0x08.end = this._io.pos;
      this._debug.h0x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x0a = this._io.readU2be();
      this._debug.h0x0a.end = this._io.pos;
      this._debug.h0x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x0c = this._io.readU2be();
      this._debug.h0x0c.end = this._io.pos;
      this._debug.h0x0e = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x0e = this._io.readU2be();
      this._debug.h0x0e.end = this._io.pos;
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
      this._debug.radius = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.radius = this._io.readF4be();
      this._debug.radius.end = this._io.pos;
    }

    return EnvironmentalSound;
  })();

  var PlatSetInitialPos = GloverLevel.PlatSetInitialPos = (function() {
    function PlatSetInitialPos(_io, _parent, _root) {
      this.__type = 'PlatSetInitialPos';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSetInitialPos.prototype._read = function() {
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
    }

    return PlatSetInitialPos;
  })();

  var EnemyInstructionB = GloverLevel.EnemyInstructionB = (function() {
    function EnemyInstructionB(_io, _parent, _root) {
      this.__type = 'EnemyInstructionB';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyInstructionB.prototype._read = function() {
      this._debug.u320x02 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x02 = this._io.readU4be();
      this._debug.u320x02.end = this._io.pos;
      this._debug.u320x06 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x06 = this._io.readU4be();
      this._debug.u320x06.end = this._io.pos;
      this._debug.u320x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x0a = this._io.readU4be();
      this._debug.u320x0a.end = this._io.pos;
      this._debug.u320x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x08 = this._io.readU4be();
      this._debug.u320x08.end = this._io.pos;
      this._debug.u320x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x0c = this._io.readU4be();
      this._debug.u320x0c.end = this._io.pos;
      this._debug.u320x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x10 = this._io.readU4be();
      this._debug.u320x10.end = this._io.pos;
      this._debug.u320x0e = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x0e = this._io.readU4be();
      this._debug.u320x0e.end = this._io.pos;
      this._debug.u320x18 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x18 = this._io.readU4be();
      this._debug.u320x18.end = this._io.pos;
      this._debug.u320x1e = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x1e = this._io.readU4be();
      this._debug.u320x1e.end = this._io.pos;
      this._debug.u320x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x14 = this._io.readU4be();
      this._debug.u320x14.end = this._io.pos;
      this._debug.u320x16 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x16 = this._io.readU2be();
      this._debug.u320x16.end = this._io.pos;
    }

    return EnemyInstructionB;
  })();

  var PlatMaxVelocity = GloverLevel.PlatMaxVelocity = (function() {
    function PlatMaxVelocity(_io, _parent, _root) {
      this.__type = 'PlatMaxVelocity';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatMaxVelocity.prototype._read = function() {
      this._debug.velocity = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.velocity = this._io.readF4be();
      this._debug.velocity.end = this._io.pos;
    }

    return PlatMaxVelocity;
  })();

  var PlatMvspn0x59 = GloverLevel.PlatMvspn0x59 = (function() {
    function PlatMvspn0x59(_io, _parent, _root) {
      this.__type = 'PlatMvspn0x59';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatMvspn0x59.prototype._read = function() {
      this._debug.u160x24 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x24 = this._io.readU2be();
      this._debug.u160x24.end = this._io.pos;
      this._debug.u320x20 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x20 = this._io.readU4be();
      this._debug.u320x20.end = this._io.pos;
      this._debug.u320x28 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x28 = this._io.readU4be();
      this._debug.u320x28.end = this._io.pos;
      this._debug.u320x2c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x2c = this._io.readU4be();
      this._debug.u320x2c.end = this._io.pos;
      this._debug.u320x30 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x30 = this._io.readU4be();
      this._debug.u320x30.end = this._io.pos;
    }

    return PlatMvspn0x59;
  })();

  var Cameo = GloverLevel.Cameo = (function() {
    function Cameo(_io, _parent, _root) {
      this.__type = 'Cameo';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Cameo.prototype._read = function() {
    }

    return Cameo;
  })();

  var PlatSpinFlip0x7d = GloverLevel.PlatSpinFlip0x7d = (function() {
    function PlatSpinFlip0x7d(_io, _parent, _root) {
      this.__type = 'PlatSpinFlip0x7d';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpinFlip0x7d.prototype._read = function() {
      this._debug.u160x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0a = this._io.readU2be();
      this._debug.u160x0a.end = this._io.pos;
      this._debug.u320x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x14 = this._io.readU4be();
      this._debug.u320x14.end = this._io.pos;
    }

    return PlatSpinFlip0x7d;
  })();

  var PlatRest0x63 = GloverLevel.PlatRest0x63 = (function() {
    function PlatRest0x63(_io, _parent, _root) {
      this.__type = 'PlatRest0x63';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatRest0x63.prototype._read = function() {
      this._debug.u160x17 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x17 = this._io.readU2be();
      this._debug.u160x17.end = this._io.pos;
      this._debug.theta = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.theta = this._io.readF4be();
      this._debug.theta.end = this._io.pos;
    }

    return PlatRest0x63;
  })();

  var Plat0xc3 = GloverLevel.Plat0xc3 = (function() {
    function Plat0xc3(_io, _parent, _root) {
      this.__type = 'Plat0xc3';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Plat0xc3.prototype._read = function() {
      this._debug.u160x86 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x86 = this._io.readU2be();
      this._debug.u160x86.end = this._io.pos;
      this._debug.u320x780x80 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x780x80 = this._io.readU2be();
      this._debug.u320x780x80.end = this._io.pos;
      this._debug.u160x84 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x84 = this._io.readU2be();
      this._debug.u160x84.end = this._io.pos;
    }

    return Plat0xc3;
  })();

  var EndLevelData = GloverLevel.EndLevelData = (function() {
    function EndLevelData(_io, _parent, _root) {
      this.__type = 'EndLevelData';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EndLevelData.prototype._read = function() {
    }

    return EndLevelData;
  })();

  var PlatFan0x8a = GloverLevel.PlatFan0x8a = (function() {
    function PlatFan0x8a(_io, _parent, _root) {
      this.__type = 'PlatFan0x8a';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatFan0x8a.prototype._read = function() {
      this._debug.u160x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0c = this._io.readU2be();
      this._debug.u160x0c.end = this._io.pos;
      this._debug.u320x48 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x48 = this._io.readU4be();
      this._debug.u320x48.end = this._io.pos;
      this._debug.u320x4c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x4c = this._io.readU4be();
      this._debug.u320x4c.end = this._io.pos;
      this._debug.u320x50 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x50 = this._io.readU4be();
      this._debug.u320x50.end = this._io.pos;
      this._debug.u320x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x10 = this._io.readU4be();
      this._debug.u320x10.end = this._io.pos;
      this._debug.u320x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x14 = this._io.readU4be();
      this._debug.u320x14.end = this._io.pos;
      this._debug.u320x18 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x18 = this._io.readU4be();
      this._debug.u320x18.end = this._io.pos;
      this._debug.u320x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x1c = this._io.readU4be();
      this._debug.u320x1c.end = this._io.pos;
    }

    return PlatFan0x8a;
  })();

  var PlatSpinBlur0x70 = GloverLevel.PlatSpinBlur0x70 = (function() {
    function PlatSpinBlur0x70(_io, _parent, _root) {
      this.__type = 'PlatSpinBlur0x70';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpinBlur0x70.prototype._read = function() {
      this._debug.idx = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.idx = this._io.readU2be();
      this._debug.idx.end = this._io.pos;
      this._debug.u320x38 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x38 = this._io.readU4be();
      this._debug.u320x38.end = this._io.pos;
      this._debug.u320x18 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x18 = this._io.readU4be();
      this._debug.u320x18.end = this._io.pos;
      this._debug.fBlur0x578 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.fBlur0x578 = this._io.readF4be();
      this._debug.fBlur0x578.end = this._io.pos;
      this._debug.count = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.count = this._io.readU2be();
      this._debug.count.end = this._io.pos;
    }

    return PlatSpinBlur0x70;
  })();

  var PlatSpinSound0xc5 = GloverLevel.PlatSpinSound0xc5 = (function() {
    function PlatSpinSound0xc5(_io, _parent, _root) {
      this.__type = 'PlatSpinSound0xc5';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpinSound0xc5.prototype._read = function() {
      this._debug.soundId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.soundId = this._io.readU2be();
      this._debug.soundId.end = this._io.pos;
      this._debug.volume = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.volume = this._io.readU2be();
      this._debug.volume.end = this._io.pos;
      this._debug.pitch = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.pitch = this._io.readU2be();
      this._debug.pitch.end = this._io.pos;
    }

    return PlatSpinSound0xc5;
  })();

  var PuzzleCondC = GloverLevel.PuzzleCondC = (function() {
    function PuzzleCondC(_io, _parent, _root) {
      this.__type = 'PuzzleCondC';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleCondC.prototype._read = function() {
      this._debug.i0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x00 = this._io.readU4be();
      this._debug.i0x00.end = this._io.pos;
      this._debug.i0x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x04 = this._io.readU4be();
      this._debug.i0x04.end = this._io.pos;
      this._debug.i0x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x08 = this._io.readU4be();
      this._debug.i0x08.end = this._io.pos;
      this._debug.i0x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x0c = this._io.readU4be();
      this._debug.i0x0c.end = this._io.pos;
      this._debug.i0x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x10 = this._io.readU4be();
      this._debug.i0x10.end = this._io.pos;
      this._debug.i0x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x14 = this._io.readU4be();
      this._debug.i0x14.end = this._io.pos;
    }

    return PuzzleCondC;
  })();

  var PlatSpin0x7f = GloverLevel.PlatSpin0x7f = (function() {
    function PlatSpin0x7f(_io, _parent, _root) {
      this.__type = 'PlatSpin0x7f';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpin0x7f.prototype._read = function() {
      this._debug.axis = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.axis = this._io.readU2be();
      this._debug.axis.end = this._io.pos;
      this._debug.initialTheta = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.initialTheta = this._io.readF4be();
      this._debug.initialTheta.end = this._io.pos;
      this._debug.speed = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.speed = this._io.readF4be();
      this._debug.speed.end = this._io.pos;
    }

    return PlatSpin0x7f;
  })();

  var PuzzleAction0x4a = GloverLevel.PuzzleAction0x4a = (function() {
    function PuzzleAction0x4a(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x4a';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleAction0x4a.prototype._read = function() {
      this._debug.u320x24 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x24 = this._io.readU4be();
      this._debug.u320x24.end = this._io.pos;
      this._debug.u320x240x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x240x0c = this._io.readU4be();
      this._debug.u320x240x0c.end = this._io.pos;
      this._debug.u160x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0a = this._io.readU2be();
      this._debug.u160x0a.end = this._io.pos;
    }

    return PuzzleAction0x4a;
  })();

  var EnemyConditionalInstruction = GloverLevel.EnemyConditionalInstruction = (function() {
    function EnemyConditionalInstruction(_io, _parent, _root) {
      this.__type = 'EnemyConditionalInstruction';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyConditionalInstruction.prototype._read = function() {
      this._debug.instr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.instr = new EnemyInstruction(this._io, this, this._root);
      this._debug.instr.end = this._io.pos;
    }

    return EnemyConditionalInstruction;
  })();

  var PlatSetTag = GloverLevel.PlatSetTag = (function() {
    function PlatSetTag(_io, _parent, _root) {
      this.__type = 'PlatSetTag';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSetTag.prototype._read = function() {
      this._debug.tag = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.tag = this._io.readU2be();
      this._debug.tag.end = this._io.pos;
    }

    return PlatSetTag;
  })();

  var Enemy0xa1 = GloverLevel.Enemy0xa1 = (function() {
    function Enemy0xa1(_io, _parent, _root) {
      this.__type = 'Enemy0xa1';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Enemy0xa1.prototype._read = function() {
      this._debug.u321 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u321 = this._io.readU4be();
      this._debug.u321.end = this._io.pos;
      this._debug.u322 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u322 = this._io.readU4be();
      this._debug.u322.end = this._io.pos;
      this._debug.u323 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u323 = this._io.readU4be();
      this._debug.u323.end = this._io.pos;
      this._debug.u324 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u324 = this._io.readU4be();
      this._debug.u324.end = this._io.pos;
      this._debug.u325 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u325 = this._io.readU4be();
      this._debug.u325.end = this._io.pos;
      this._debug.u326 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u326 = this._io.readU4be();
      this._debug.u326.end = this._io.pos;
    }

    return Enemy0xa1;
  })();

  var Vent = GloverLevel.Vent = (function() {
    function Vent(_io, _parent, _root) {
      this.__type = 'Vent';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Vent.prototype._read = function() {
      this._debug.u160x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x08 = this._io.readU2be();
      this._debug.u160x08.end = this._io.pos;
      this._debug.u160x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0a = this._io.readU2be();
      this._debug.u160x0a.end = this._io.pos;
      this._debug.parentTag = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.parentTag = this._io.readU2be();
      this._debug.parentTag.end = this._io.pos;
      this._debug.f0x38 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x38 = this._io.readF4be();
      this._debug.f0x38.end = this._io.pos;
      this._debug.f0x3c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x3c = this._io.readF4be();
      this._debug.f0x3c.end = this._io.pos;
      this._debug.f0x40 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x40 = this._io.readF4be();
      this._debug.f0x40.end = this._io.pos;
      this._debug.f0x2c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x2c = this._io.readF4be();
      this._debug.f0x2c.end = this._io.pos;
      this._debug.f0x30 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x30 = this._io.readF4be();
      this._debug.f0x30.end = this._io.pos;
      this._debug.f0x34 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x34 = this._io.readF4be();
      this._debug.f0x34.end = this._io.pos;
    }

    return Vent;
  })();

  var PuzzleCond = GloverLevel.PuzzleCond = (function() {
    function PuzzleCond(_io, _parent, _root) {
      this.__type = 'PuzzleCond';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleCond.prototype._read = function() {
      this._debug.condType = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.condType = this._io.readU2be();
      this._debug.condType.end = this._io.pos;
      this._debug.body = { start: this._io.pos, ioOffset: this._io.byteOffset };
      switch (this.condType) {
      case 39:
        this.body = new PuzzleCondC(this._io, this, this._root);
        break;
      case 35:
        this.body = new PuzzleCondC(this._io, this, this._root);
        break;
      case 38:
        this.body = new PuzzleCondD(this._io, this, this._root);
        break;
      case 40:
        this.body = new PuzzleCondD(this._io, this, this._root);
        break;
      case 37:
        this.body = new PuzzleCondC(this._io, this, this._root);
        break;
      case 41:
        this.body = new PuzzleCondE(this._io, this, this._root);
        break;
      case 36:
        this.body = new PuzzleCondD(this._io, this, this._root);
        break;
      case 34:
        this.body = new PuzzleCondB(this._io, this, this._root);
        break;
      default:
        this.body = new PuzzleCondA(this._io, this, this._root);
        break;
      }
      this._debug.body.end = this._io.pos;
    }

    return PuzzleCond;
  })();

  var PlatMvspn0x73 = GloverLevel.PlatMvspn0x73 = (function() {
    function PlatMvspn0x73(_io, _parent, _root) {
      this.__type = 'PlatMvspn0x73';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatMvspn0x73.prototype._read = function() {
      this._debug.u160x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0c = this._io.readU2be();
      this._debug.u160x0c.end = this._io.pos;
      this._debug.u320x34 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x34 = this._io.readU4be();
      this._debug.u320x34.end = this._io.pos;
      this._debug.u320x38 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x38 = this._io.readU4be();
      this._debug.u320x38.end = this._io.pos;
      this._debug.u320x3c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x3c = this._io.readU4be();
      this._debug.u320x3c.end = this._io.pos;
    }

    return PlatMvspn0x73;
  })();

  var LookAtBall0x61 = GloverLevel.LookAtBall0x61 = (function() {
    function LookAtBall0x61(_io, _parent, _root) {
      this.__type = 'LookAtBall0x61';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    LookAtBall0x61.prototype._read = function() {
      this._debug.u320x6c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x6c = this._io.readU4be();
      this._debug.u320x6c.end = this._io.pos;
      this._debug.u320x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x1c = this._io.readU4be();
      this._debug.u320x1c.end = this._io.pos;
    }

    return LookAtBall0x61;
  })();

  var LookAtHand0x60 = GloverLevel.LookAtHand0x60 = (function() {
    function LookAtHand0x60(_io, _parent, _root) {
      this.__type = 'LookAtHand0x60';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    LookAtHand0x60.prototype._read = function() {
      this._debug.u320x6c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x6c = this._io.readU4be();
      this._debug.u320x6c.end = this._io.pos;
      this._debug.u320x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x1c = this._io.readU4be();
      this._debug.u320x1c.end = this._io.pos;
    }

    return LookAtHand0x60;
  })();

  var CameoInst2 = GloverLevel.CameoInst2 = (function() {
    function CameoInst2(_io, _parent, _root) {
      this.__type = 'CameoInst2';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    CameoInst2.prototype._read = function() {
      this._debug.h0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x00 = this._io.readU2be();
      this._debug.h0x00.end = this._io.pos;
      this._debug.i0x02 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x02 = this._io.readU4be();
      this._debug.i0x02.end = this._io.pos;
      this._debug.i0x06 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x06 = this._io.readU4be();
      this._debug.i0x06.end = this._io.pos;
      this._debug.i0x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x0a = this._io.readU4be();
      this._debug.i0x0a.end = this._io.pos;
      this._debug.i0x0e = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x0e = this._io.readU4be();
      this._debug.i0x0e.end = this._io.pos;
      this._debug.h0x12 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x12 = this._io.readU2be();
      this._debug.h0x12.end = this._io.pos;
      this._debug.h0x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x14 = this._io.readU2be();
      this._debug.h0x14.end = this._io.pos;
    }

    return CameoInst2;
  })();

  var Unknown0xa9 = GloverLevel.Unknown0xa9 = (function() {
    function Unknown0xa9(_io, _parent, _root) {
      this.__type = 'Unknown0xa9';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Unknown0xa9.prototype._read = function() {
      this._debug.i0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x00 = this._io.readU4be();
      this._debug.i0x00.end = this._io.pos;
    }

    return Unknown0xa9;
  })();

  var PlatVentAdvanceFrames = GloverLevel.PlatVentAdvanceFrames = (function() {
    function PlatVentAdvanceFrames(_io, _parent, _root) {
      this.__type = 'PlatVentAdvanceFrames';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatVentAdvanceFrames.prototype._read = function() {
      this._debug.numFrames = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.numFrames = this._io.readU2be();
      this._debug.numFrames.end = this._io.pos;
    }

    return PlatVentAdvanceFrames;
  })();

  var SetExit = GloverLevel.SetExit = (function() {
    function SetExit(_io, _parent, _root) {
      this.__type = 'SetExit';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    SetExit.prototype._read = function() {
      this._debug.type = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.type = this._io.readU2be();
      this._debug.type.end = this._io.pos;
      this._debug.visible = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.visible = this._io.readU2be();
      this._debug.visible.end = this._io.pos;
    }

    return SetExit;
  })();

  var PlatOrbit0x75 = GloverLevel.PlatOrbit0x75 = (function() {
    function PlatOrbit0x75(_io, _parent, _root) {
      this.__type = 'PlatOrbit0x75';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatOrbit0x75.prototype._read = function() {
      this._debug.idx = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.idx = this._io.readU2be();
      this._debug.idx.end = this._io.pos;
      this._debug.u320x18 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x18 = this._io.readU4be();
      this._debug.u320x18.end = this._io.pos;
      this._debug.u320x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x1c = this._io.readU4be();
      this._debug.u320x1c.end = this._io.pos;
      this._debug.u320x20 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x20 = this._io.readU4be();
      this._debug.u320x20.end = this._io.pos;
      this._debug.u320x28 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x28 = this._io.readU4be();
      this._debug.u320x28.end = this._io.pos;
    }

    return PlatOrbit0x75;
  })();

  var PlatSound0xc1 = GloverLevel.PlatSound0xc1 = (function() {
    function PlatSound0xc1(_io, _parent, _root) {
      this.__type = 'PlatSound0xc1';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSound0xc1.prototype._read = function() {
      this._debug.soundId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.soundId = this._io.readU2be();
      this._debug.soundId.end = this._io.pos;
      this._debug.volume = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.volume = this._io.readU2be();
      this._debug.volume.end = this._io.pos;
      this._debug.pitch = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.pitch = this._io.readU2be();
      this._debug.pitch.end = this._io.pos;
    }

    return PlatSound0xc1;
  })();

  var PlatActorEnableWaterAnimation = GloverLevel.PlatActorEnableWaterAnimation = (function() {
    function PlatActorEnableWaterAnimation(_io, _parent, _root) {
      this.__type = 'PlatActorEnableWaterAnimation';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatActorEnableWaterAnimation.prototype._read = function() {
    }

    return PlatActorEnableWaterAnimation;
  })();

  var EnemyInstructionC = GloverLevel.EnemyInstructionC = (function() {
    function EnemyInstructionC(_io, _parent, _root) {
      this.__type = 'EnemyInstructionC';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyInstructionC.prototype._read = function() {
      this._debug.u320x02 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x02 = this._io.readU4be();
      this._debug.u320x02.end = this._io.pos;
      this._debug.u320x0e = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x0e = this._io.readU4be();
      this._debug.u320x0e.end = this._io.pos;
      this._debug.u320x18 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x18 = this._io.readU4be();
      this._debug.u320x18.end = this._io.pos;
      this._debug.u320x1e = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x1e = this._io.readU4be();
      this._debug.u320x1e.end = this._io.pos;
      this._debug.u320x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x14 = this._io.readU4be();
      this._debug.u320x14.end = this._io.pos;
      this._debug.u320x16 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x16 = this._io.readU2be();
      this._debug.u320x16.end = this._io.pos;
    }

    return EnemyInstructionC;
  })();

  var PuzzleAnd = GloverLevel.PuzzleAnd = (function() {
    function PuzzleAnd(_io, _parent, _root) {
      this.__type = 'PuzzleAnd';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleAnd.prototype._read = function() {
    }

    return PuzzleAnd;
  })();

  var Plat0x66 = GloverLevel.Plat0x66 = (function() {
    function Plat0x66(_io, _parent, _root) {
      this.__type = 'Plat0x66';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Plat0x66.prototype._read = function() {
    }

    return Plat0x66;
  })();

  var PlatSpecial0xc7 = GloverLevel.PlatSpecial0xc7 = (function() {
    function PlatSpecial0xc7(_io, _parent, _root) {
      this.__type = 'PlatSpecial0xc7';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpecial0xc7.prototype._read = function() {
      this._debug.u160x2a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x2a = this._io.readU2be();
      this._debug.u160x2a.end = this._io.pos;
      this._debug.u160x1cAnd0x24 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x1cAnd0x24 = this._io.readU2be();
      this._debug.u160x1cAnd0x24.end = this._io.pos;
      this._debug.u160x28 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x28 = this._io.readU2be();
      this._debug.u160x28.end = this._io.pos;
    }

    return PlatSpecial0xc7;
  })();

  var NullPlatform = GloverLevel.NullPlatform = (function() {
    function NullPlatform(_io, _parent, _root) {
      this.__type = 'NullPlatform';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    NullPlatform.prototype._read = function() {
    }

    return NullPlatform;
  })();

  var Powerup = GloverLevel.Powerup = (function() {
    function Powerup(_io, _parent, _root) {
      this.__type = 'Powerup';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Powerup.prototype._read = function() {
      this._debug.type = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.type = this._io.readU2be();
      this._debug.type.end = this._io.pos;
      this._debug.u160x02 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x02 = this._io.readU2be();
      this._debug.u160x02.end = this._io.pos;
      this._debug.u160x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x04 = this._io.readU2be();
      this._debug.u160x04.end = this._io.pos;
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
    }

    return Powerup;
  })();

  var PlatformConveyor = GloverLevel.PlatformConveyor = (function() {
    function PlatformConveyor(_io, _parent, _root) {
      this.__type = 'PlatformConveyor';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatformConveyor.prototype._read = function() {
      this._debug.velX = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.velX = this._io.readF4be();
      this._debug.velX.end = this._io.pos;
      this._debug.velY = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.velY = this._io.readF4be();
      this._debug.velY.end = this._io.pos;
      this._debug.velZ = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.velZ = this._io.readF4be();
      this._debug.velZ.end = this._io.pos;
    }

    return PlatformConveyor;
  })();

  var SetTeleport = GloverLevel.SetTeleport = (function() {
    function SetTeleport(_io, _parent, _root) {
      this.__type = 'SetTeleport';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    SetTeleport.prototype._read = function() {
      this._debug.targetTag = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.targetTag = this._io.readU2be();
      this._debug.targetTag.end = this._io.pos;
      this._debug.u160x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0c = this._io.readU2be();
      this._debug.u160x0c.end = this._io.pos;
      this._debug.u160x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x10 = this._io.readU2be();
      this._debug.u160x10.end = this._io.pos;
      this._debug.u160x12 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x12 = this._io.readU2be();
      this._debug.u160x12.end = this._io.pos;
      this._debug.u320x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x00 = this._io.readU4be();
      this._debug.u320x00.end = this._io.pos;
      this._debug.u320x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x04 = this._io.readU4be();
      this._debug.u320x04.end = this._io.pos;
      this._debug.u320x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x08 = this._io.readU4be();
      this._debug.u320x08.end = this._io.pos;
    }

    return SetTeleport;
  })();

  var PuzzleCondD = GloverLevel.PuzzleCondD = (function() {
    function PuzzleCondD(_io, _parent, _root) {
      this.__type = 'PuzzleCondD';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleCondD.prototype._read = function() {
      this._debug.i0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x00 = this._io.readU4be();
      this._debug.i0x00.end = this._io.pos;
      this._debug.i0x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x04 = this._io.readU4be();
      this._debug.i0x04.end = this._io.pos;
      this._debug.i0x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x08 = this._io.readU4be();
      this._debug.i0x08.end = this._io.pos;
      this._debug.i0x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x0c = this._io.readU4be();
      this._debug.i0x0c.end = this._io.pos;
    }

    return PuzzleCondD;
  })();

  var VentAppend0xa3 = GloverLevel.VentAppend0xa3 = (function() {
    function VentAppend0xa3(_io, _parent, _root) {
      this.__type = 'VentAppend0xa3';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    VentAppend0xa3.prototype._read = function() {
      this._debug.u16IdxPlus0x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u16IdxPlus0x10 = this._io.readU2be();
      this._debug.u16IdxPlus0x10.end = this._io.pos;
      this._debug.u16IdxPlus0x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u16IdxPlus0x1c = this._io.readU2be();
      this._debug.u16IdxPlus0x1c.end = this._io.pos;
    }

    return VentAppend0xa3;
  })();

  var UnknownSound0xbd = GloverLevel.UnknownSound0xbd = (function() {
    function UnknownSound0xbd(_io, _parent, _root) {
      this.__type = 'UnknownSound0xbd';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    UnknownSound0xbd.prototype._read = function() {
      this._debug.h0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x00 = this._io.readU2be();
      this._debug.h0x00.end = this._io.pos;
      this._debug.h0x02 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x02 = this._io.readU2be();
      this._debug.h0x02.end = this._io.pos;
      this._debug.h0x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x04 = this._io.readU2be();
      this._debug.h0x04.end = this._io.pos;
    }

    return UnknownSound0xbd;
  })();

  var PlatCheckpoint = GloverLevel.PlatCheckpoint = (function() {
    function PlatCheckpoint(_io, _parent, _root) {
      this.__type = 'PlatCheckpoint';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatCheckpoint.prototype._read = function() {
    }

    return PlatCheckpoint;
  })();

  var CameoInst4 = GloverLevel.CameoInst4 = (function() {
    function CameoInst4(_io, _parent, _root) {
      this.__type = 'CameoInst4';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    CameoInst4.prototype._read = function() {
      this._debug.h0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x00 = this._io.readU2be();
      this._debug.h0x00.end = this._io.pos;
      this._debug.h0x02 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x02 = this._io.readU2be();
      this._debug.h0x02.end = this._io.pos;
      this._debug.h0x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x04 = this._io.readU2be();
      this._debug.h0x04.end = this._io.pos;
      this._debug.h0x06 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x06 = this._io.readU2be();
      this._debug.h0x06.end = this._io.pos;
      this._debug.h0x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x08 = this._io.readU2be();
      this._debug.h0x08.end = this._io.pos;
    }

    return CameoInst4;
  })();

  var BallSpawnPoint = GloverLevel.BallSpawnPoint = (function() {
    function BallSpawnPoint(_io, _parent, _root) {
      this.__type = 'BallSpawnPoint';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    BallSpawnPoint.prototype._read = function() {
      this._debug.h0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x00 = this._io.readU2be();
      this._debug.h0x00.end = this._io.pos;
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
    }

    return BallSpawnPoint;
  })();

  var Unknown0x01 = GloverLevel.Unknown0x01 = (function() {
    function Unknown0x01(_io, _parent, _root) {
      this.__type = 'Unknown0x01';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Unknown0x01.prototype._read = function() {
      this._debug.f0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x00 = this._io.readF4be();
      this._debug.f0x00.end = this._io.pos;
      this._debug.f0x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x04 = this._io.readF4be();
      this._debug.f0x04.end = this._io.pos;
      this._debug.f0x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x08 = this._io.readF4be();
      this._debug.f0x08.end = this._io.pos;
    }

    return Unknown0x01;
  })();

  var PlatAnim0xc0 = GloverLevel.PlatAnim0xc0 = (function() {
    function PlatAnim0xc0(_io, _parent, _root) {
      this.__type = 'PlatAnim0xc0';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatAnim0xc0.prototype._read = function() {
    }

    return PlatAnim0xc0;
  })();

  var PlatSetParent = GloverLevel.PlatSetParent = (function() {
    function PlatSetParent(_io, _parent, _root) {
      this.__type = 'PlatSetParent';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSetParent.prototype._read = function() {
      this._debug.tag = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.tag = this._io.readU2be();
      this._debug.tag.end = this._io.pos;
    }

    return PlatSetParent;
  })();

  var PuzzleOr = GloverLevel.PuzzleOr = (function() {
    function PuzzleOr(_io, _parent, _root) {
      this.__type = 'PuzzleOr';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleOr.prototype._read = function() {
    }

    return PuzzleOr;
  })();

  var PuzzleAction0x56 = GloverLevel.PuzzleAction0x56 = (function() {
    function PuzzleAction0x56(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x56';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleAction0x56.prototype._read = function() {
      this._debug.u320x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x14 = this._io.readU4be();
      this._debug.u320x14.end = this._io.pos;
      this._debug.u320x18 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x18 = this._io.readU4be();
      this._debug.u320x18.end = this._io.pos;
      this._debug.u160x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x1c = this._io.readU2be();
      this._debug.u160x1c.end = this._io.pos;
      this._debug.u160x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0a = this._io.readU2be();
      this._debug.u160x0a.end = this._io.pos;
    }

    return PuzzleAction0x56;
  })();

  var Cmd = GloverLevel.Cmd = (function() {
    function Cmd(_io, _parent, _root) {
      this.__type = 'Cmd';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Cmd.prototype._read = function() {
      this._debug.typeCode = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.typeCode = this._io.readU2be();
      this._debug.typeCode.end = this._io.pos;
      this._debug.params = { start: this._io.pos, ioOffset: this._io.byteOffset };
      switch (this.typeCode) {
      case 120:
        this.params = new Plat0x78(this._io, this, this._root);
        break;
      case 141:
        this.params = new PlatRope(this._io, this, this._root);
        break;
      case 93:
        this.params = new NullPlatform(this._io, this, this._root);
        break;
      case 118:
        this.params = new PlatOrbitPause0x76(this._io, this, this._root);
        break;
      case 159:
        this.params = new Plat0x9f(this._io, this, this._root);
        break;
      case 194:
        this.params = new PlatSound0xc2(this._io, this, this._root);
        break;
      case 184:
        this.params = new PlatSpecial0xb8(this._io, this, this._root);
        break;
      case 105:
        this.params = new PlatCat0x69(this._io, this, this._root);
        break;
      case 142:
        this.params = new PlatSpecial0x8e(this._io, this, this._root);
        break;
      case 112:
        this.params = new PlatSpinBlur0x70(this._io, this, this._root);
        break;
      case 163:
        this.params = new VentAppend0xa3(this._io, this, this._root);
        break;
      case 131:
        this.params = new Enemy(this._io, this, this._root);
        break;
      case 167:
        this.params = new PlatPos0xa7(this._io, this, this._root);
        break;
      case 146:
        this.params = new LandActor(this._io, this, this._root);
        break;
      case 4:
        this.params = new Puzzle(this._io, this, this._root);
        break;
      case 169:
        this.params = new Unknown0xa9(this._io, this, this._root);
        break;
      case 162:
        this.params = new Vent(this._io, this, this._root);
        break;
      case 116:
        this.params = new PlatMvspn0x74(this._io, this, this._root);
        break;
      case 119:
        this.params = new PlatOrbitFlip0x77(this._io, this, this._root);
        break;
      case 6:
        this.params = new PuzzleOr(this._io, this, this._root);
        break;
      case 7:
        this.params = new PuzzleNumtimes(this._io, this, this._root);
        break;
      case 113:
        this.params = new PlatSetParent(this._io, this, this._root);
        break;
      case 121:
        this.params = new PlatScale(this._io, this, this._root);
        break;
      case 96:
        this.params = new LookAtHand0x60(this._io, this, this._root);
        break;
      case 191:
        this.params = new Unknown0xbf(this._io, this, this._root);
        break;
      case 1:
        this.params = new Unknown0x01(this._io, this, this._root);
        break;
      case 150:
        this.params = new PuzzleAction(this._io, this, this._root);
        break;
      case 97:
        this.params = new LookAtBall0x61(this._io, this, this._root);
        break;
      case 106:
        this.params = new PlatActorSurfaceType(this._io, this, this._root);
        break;
      case 145:
        this.params = new BackgroundActor0x91(this._io, this, this._root);
        break;
      case 101:
        this.params = new PlatDestructible(this._io, this, this._root);
        break;
      case 144:
        this.params = new PlatSine(this._io, this, this._root);
        break;
      case 127:
        this.params = new PlatSpin0x7f(this._io, this, this._root);
        break;
      case 100:
        this.params = new PlatCheckpoint(this._io, this, this._root);
        break;
      case 149:
        this.params = new PuzzleCond(this._io, this, this._root);
        break;
      case 115:
        this.params = new PlatMvspn0x73(this._io, this, this._root);
        break;
      case 91:
        this.params = new PlatPush0x5b(this._io, this, this._root);
        break;
      case 107:
        this.params = new PlatPathPoint(this._io, this, this._root);
        break;
      case 143:
        this.params = new PlatOrbit(this._io, this, this._root);
        break;
      case 89:
        this.params = new PlatMvspn0x59(this._io, this, this._root);
        break;
      case 104:
        this.params = new PlatformConveyor(this._io, this, this._root);
        break;
      case 98:
        this.params = new Platform(this._io, this, this._root);
        break;
      case 197:
        this.params = new PlatSpinSound0xc5(this._io, this, this._root);
        break;
      case 95:
        this.params = new PlatGoForwards0x5f(this._io, this, this._root);
        break;
      case 137:
        this.params = new SetTeleport(this._io, this, this._root);
        break;
      case 88:
        this.params = new PlatMvspn0x58(this._io, this, this._root);
        break;
      case 161:
        this.params = new Enemy0xa1(this._io, this, this._root);
        break;
      case 138:
        this.params = new PlatFan0x8a(this._io, this, this._root);
        break;
      case 3:
        this.params = new Unknown0x03(this._io, this, this._root);
        break;
      case 192:
        this.params = new PlatAnim0xc0(this._io, this, this._root);
        break;
      case 126:
        this.params = new Plat0x7e(this._io, this, this._root);
        break;
      case 165:
        this.params = new FogConfiguration(this._io, this, this._root);
        break;
      case 5:
        this.params = new PuzzleAnd(this._io, this, this._root);
        break;
      case 103:
        this.params = new PlatCrumb0x67(this._io, this, this._root);
        break;
      case 99:
        this.params = new PlatRest0x63(this._io, this, this._root);
        break;
      case 185:
        this.params = new PlatSpecial0xb9(this._io, this, this._root);
        break;
      case 180:
        this.params = new PlatSpecial0xb4(this._io, this, this._root);
        break;
      case 156:
        this.params = new EnemyAttackInstruction(this._io, this, this._root);
        break;
      case 125:
        this.params = new PlatSpinFlip0x7d(this._io, this, this._root);
        break;
      case 186:
        this.params = new Enemy0xba(this._io, this, this._root);
        break;
      case 188:
        this.params = new BackgroundActor0xbc(this._io, this, this._root);
        break;
      case 153:
        this.params = new Backdrop(this._io, this, this._root);
        break;
      case 123:
        this.params = new PlatSpin0x7b(this._io, this, this._root);
        break;
      case 160:
        this.params = new Water(this._io, this, this._root);
        break;
      case 8:
        this.params = new PuzzleAny(this._io, this, this._root);
        break;
      case 166:
        this.params = new PlatSetInitialPos(this._io, this, this._root);
        break;
      case 114:
        this.params = new PlatConf0x72(this._io, this, this._root);
        break;
      case 181:
        this.params = new Buzzer(this._io, this, this._root);
        break;
      case 148:
        this.params = new SetActorScale(this._io, this, this._root);
        break;
      case 158:
        this.params = new PlatSpecial0x9e(this._io, this, this._root);
        break;
      case 117:
        this.params = new PlatOrbit0x75(this._io, this, this._root);
        break;
      case 152:
        this.params = new AmbientLight(this._io, this, this._root);
        break;
      case 109:
        this.params = new PlatPathAcceleration(this._io, this, this._root);
        break;
      case 32000:
        this.params = new EndLevelData(this._io, this, this._root);
        break;
      case 140:
        this.params = new Wind(this._io, this, this._root);
        break;
      case 122:
        this.params = new PlatStr0x7a(this._io, this, this._root);
        break;
      case 179:
        this.params = new PlatActorEnableWaterAnimation(this._io, this, this._root);
        break;
      case 195:
        this.params = new Plat0xc3(this._io, this, this._root);
        break;
      case 130:
        this.params = new PlatSpike(this._io, this, this._root);
        break;
      case 187:
        this.params = new MrTip(this._io, this, this._root);
        break;
      case 170:
        this.params = new Cameo(this._io, this, this._root);
        break;
      case 199:
        this.params = new PlatSpecial0xc7(this._io, this, this._root);
        break;
      case 164:
        this.params = new Plat0xa4(this._io, this, this._root);
        break;
      case 182:
        this.params = new PlatSpecial0xb6(this._io, this, this._root);
        break;
      case 108:
        this.params = new PlatMaxVelocity(this._io, this, this._root);
        break;
      case 189:
        this.params = new UnknownSound0xbd(this._io, this, this._root);
        break;
      case 168:
        this.params = new SetExit(this._io, this, this._root);
        break;
      case 171:
        this.params = new CameoInst(this._io, this, this._root);
        break;
      case 193:
        this.params = new PlatSound0xc1(this._io, this, this._root);
        break;
      case 133:
        this.params = new GaribGroup(this._io, this, this._root);
        break;
      case 129:
        this.params = new PlatTopple0x81(this._io, this, this._root);
        break;
      case 151:
        this.params = new DiffuseLight(this._io, this, this._root);
        break;
      case 157:
        this.params = new Plat0x9d(this._io, this, this._root);
        break;
      case 147:
        this.params = new SetActorRotation(this._io, this, this._root);
        break;
      case 134:
        this.params = new Garib(this._io, this, this._root);
        break;
      case 102:
        this.params = new Plat0x66(this._io, this, this._root);
        break;
      case 110:
        this.params = new PlatSpecial0x6e(this._io, this, this._root);
        break;
      case 139:
        this.params = new PlatMagnet0x8b(this._io, this, this._root);
        break;
      case 155:
        this.params = new EnemyConditionalInstruction(this._io, this, this._root);
        break;
      case 2:
        this.params = new BallSpawnPoint(this._io, this, this._root);
        break;
      case 135:
        this.params = new Powerup(this._io, this, this._root);
        break;
      case 124:
        this.params = new PlatSpinPause0x7c(this._io, this, this._root);
        break;
      case 200:
        this.params = new PlatDestructibleSound(this._io, this, this._root);
        break;
      case 132:
        this.params = new Enemy0x84(this._io, this, this._root);
        break;
      case 92:
        this.params = new PlatVentAdvanceFrames(this._io, this, this._root);
        break;
      case 198:
        this.params = new Plat0xc6(this._io, this, this._root);
        break;
      case 111:
        this.params = new PlatSetTag(this._io, this, this._root);
        break;
      case 190:
        this.params = new EnvironmentalSound(this._io, this, this._root);
        break;
      case 196:
        this.params = new Plat0xc4(this._io, this, this._root);
        break;
      case 183:
        this.params = new SetGlobal0xb7(this._io, this, this._root);
        break;
      case 128:
        this.params = new PlatSpin0x80(this._io, this, this._root);
        break;
      case 90:
        this.params = new PlatMvspn0x5a(this._io, this, this._root);
        break;
      case 154:
        this.params = new EnemyNormalInstruction(this._io, this, this._root);
        break;
      default:
        this.params = new Unrecognized(this._io, this, this._root);
        break;
      }
      this._debug.params.end = this._io.pos;
    }

    return Cmd;
  })();

  var Plat0xc6 = GloverLevel.Plat0xc6 = (function() {
    function Plat0xc6(_io, _parent, _root) {
      this.__type = 'Plat0xc6';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Plat0xc6.prototype._read = function() {
      this._debug.u160x4a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x4a = this._io.readU2be();
      this._debug.u160x4a.end = this._io.pos;
      this._debug.u160x44 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x44 = this._io.readU2be();
      this._debug.u160x44.end = this._io.pos;
      this._debug.u160x48 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x48 = this._io.readU2be();
      this._debug.u160x48.end = this._io.pos;
    }

    return Plat0xc6;
  })();

  var Wind = GloverLevel.Wind = (function() {
    function Wind(_io, _parent, _root) {
      this.__type = 'Wind';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Wind.prototype._read = function() {
      this._debug.i0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x00 = this._io.readU4be();
      this._debug.i0x00.end = this._io.pos;
      this._debug.i0x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x04 = this._io.readU4be();
      this._debug.i0x04.end = this._io.pos;
      this._debug.i0x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x08 = this._io.readU4be();
      this._debug.i0x08.end = this._io.pos;
      this._debug.i0x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x0c = this._io.readU4be();
      this._debug.i0x0c.end = this._io.pos;
      this._debug.i0x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x10 = this._io.readU4be();
      this._debug.i0x10.end = this._io.pos;
      this._debug.i0x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x14 = this._io.readU4be();
      this._debug.i0x14.end = this._io.pos;
      this._debug.i0x18 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x18 = this._io.readU4be();
      this._debug.i0x18.end = this._io.pos;
      this._debug.i0x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x1c = this._io.readU4be();
      this._debug.i0x1c.end = this._io.pos;
      this._debug.i0x20 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x20 = this._io.readU4be();
      this._debug.i0x20.end = this._io.pos;
      this._debug.i0x28 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x28 = this._io.readU4be();
      this._debug.i0x28.end = this._io.pos;
      this._debug.i0x2c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x2c = this._io.readU4be();
      this._debug.i0x2c.end = this._io.pos;
      this._debug.i0x24 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x24 = this._io.readU4be();
      this._debug.i0x24.end = this._io.pos;
      this._debug.i0x30 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x30 = this._io.readU4be();
      this._debug.i0x30.end = this._io.pos;
    }

    return Wind;
  })();

  var Puzzle = GloverLevel.Puzzle = (function() {
    function Puzzle(_io, _parent, _root) {
      this.__type = 'Puzzle';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Puzzle.prototype._read = function() {
    }

    return Puzzle;
  })();

  var PlatPush0x5b = GloverLevel.PlatPush0x5b = (function() {
    function PlatPush0x5b(_io, _parent, _root) {
      this.__type = 'PlatPush0x5b';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatPush0x5b.prototype._read = function() {
      this._debug.flags = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.flags = this._io.readU2be();
      this._debug.flags.end = this._io.pos;
      this._debug.u320x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x04 = this._io.readU4be();
      this._debug.u320x04.end = this._io.pos;
      this._debug.actorF0x70 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.actorF0x70 = this._io.readF4be();
      this._debug.actorF0x70.end = this._io.pos;
      this._debug.u320x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x1c = this._io.readU4be();
      this._debug.u320x1c.end = this._io.pos;
    }

    return PlatPush0x5b;
  })();

  var PlatMvspn0x58 = GloverLevel.PlatMvspn0x58 = (function() {
    function PlatMvspn0x58(_io, _parent, _root) {
      this.__type = 'PlatMvspn0x58';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatMvspn0x58.prototype._read = function() {
      this._debug.u160x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x14 = this._io.readU2be();
      this._debug.u160x14.end = this._io.pos;
      this._debug.u320x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x10 = this._io.readU4be();
      this._debug.u320x10.end = this._io.pos;
    }

    return PlatMvspn0x58;
  })();

  var PlatDestructible = GloverLevel.PlatDestructible = (function() {
    function PlatDestructible(_io, _parent, _root) {
      this.__type = 'PlatDestructible';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatDestructible.prototype._read = function() {
      this._debug.flags = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.flags = this._io.readU2be();
      this._debug.flags.end = this._io.pos;
      this._debug.numParticles = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.numParticles = this._io.readU4be();
      this._debug.numParticles.end = this._io.pos;
      this._debug.particleObjectId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.particleObjectId = this._io.readU4be();
      this._debug.particleObjectId.end = this._io.pos;
      this._debug.name = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this._debug.name.end = this._io.pos;
    }

    return PlatDestructible;
  })();

  var PuzzleAction = GloverLevel.PuzzleAction = (function() {
    function PuzzleAction(_io, _parent, _root) {
      this.__type = 'PuzzleAction';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleAction.prototype._read = function() {
      this._debug.actionType = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.actionType = this._io.readU2be();
      this._debug.actionType.end = this._io.pos;
      this._debug.body = { start: this._io.pos, ioOffset: this._io.byteOffset };
      switch (this.actionType) {
      case 61:
        this.body = new PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40(this._io, this, this._root);
        break;
      case 73:
        this.body = new PuzzleAction0x490x4d(this._io, this, this._root);
        break;
      case 60:
        this.body = new PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40(this._io, this, this._root);
        break;
      case 62:
        this.body = new PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40(this._io, this, this._root);
        break;
      case 77:
        this.body = new PuzzleAction0x490x4d(this._io, this, this._root);
        break;
      case 85:
        this.body = new PuzzleAction0x55(this._io, this, this._root);
        break;
      case 59:
        this.body = new PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40(this._io, this, this._root);
        break;
      case 86:
        this.body = new PuzzleAction0x56(this._io, this, this._root);
        break;
      case 84:
        this.body = new PuzzleAction0x54(this._io, this, this._root);
        break;
      case 63:
        this.body = new PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40(this._io, this, this._root);
        break;
      case 53:
        this.body = new PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40(this._io, this, this._root);
        break;
      case 64:
        this.body = new PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40(this._io, this, this._root);
        break;
      case 76:
        this.body = new PuzzleAction0x4b0x4c(this._io, this, this._root);
        break;
      case 79:
        this.body = new PuzzleAction0x4f(this._io, this, this._root);
        break;
      case 72:
        this.body = new PuzzleAction0x460x470x48(this._io, this, this._root);
        break;
      case 71:
        this.body = new PuzzleAction0x460x470x48(this._io, this, this._root);
        break;
      case 70:
        this.body = new PuzzleAction0x460x470x48(this._io, this, this._root);
        break;
      case 74:
        this.body = new PuzzleAction0x4a(this._io, this, this._root);
        break;
      case 75:
        this.body = new PuzzleAction0x4b0x4c(this._io, this, this._root);
        break;
      default:
        this.body = new PuzzleActionDefault(this._io, this, this._root);
        break;
      }
      this._debug.body.end = this._io.pos;
    }

    return PuzzleAction;
  })();

  var Plat0xc4 = GloverLevel.Plat0xc4 = (function() {
    function Plat0xc4(_io, _parent, _root) {
      this.__type = 'Plat0xc4';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Plat0xc4.prototype._read = function() {
      this._debug.u160x3a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x3a = this._io.readU2be();
      this._debug.u160x3a.end = this._io.pos;
      this._debug.u160x2cAnd0x34 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x2cAnd0x34 = this._io.readU2be();
      this._debug.u160x2cAnd0x34.end = this._io.pos;
      this._debug.u160x38 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x38 = this._io.readU2be();
      this._debug.u160x38.end = this._io.pos;
    }

    return Plat0xc4;
  })();

  var Water = GloverLevel.Water = (function() {
    function Water(_io, _parent, _root) {
      this.__type = 'Water';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Water.prototype._read = function() {
      this._debug.left = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.left = this._io.readF4be();
      this._debug.left.end = this._io.pos;
      this._debug.top = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.top = this._io.readF4be();
      this._debug.top.end = this._io.pos;
      this._debug.front = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.front = this._io.readF4be();
      this._debug.front.end = this._io.pos;
      this._debug.width = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.width = this._io.readF4be();
      this._debug.width.end = this._io.pos;
      this._debug.bottom = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.bottom = this._io.readF4be();
      this._debug.bottom.end = this._io.pos;
      this._debug.depth = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.depth = this._io.readF4be();
      this._debug.depth.end = this._io.pos;
      this._debug.surfaceY = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.surfaceY = this._io.readF4be();
      this._debug.surfaceY.end = this._io.pos;
      this._debug.currentX = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.currentX = this._io.readF4be();
      this._debug.currentX.end = this._io.pos;
      this._debug.currentZ = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.currentZ = this._io.readF4be();
      this._debug.currentZ.end = this._io.pos;
      this._debug.unknown1 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.unknown1 = this._io.readU2be();
      this._debug.unknown1.end = this._io.pos;
      this._debug.objectId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.objectId = this._io.readU4be();
      this._debug.objectId.end = this._io.pos;
      this._debug.name = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this._debug.name.end = this._io.pos;
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
    }

    return Water;
  })();

  var PuzzleAction0x4f = GloverLevel.PuzzleAction0x4f = (function() {
    function PuzzleAction0x4f(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x4f';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleAction0x4f.prototype._read = function() {
      this._debug.u320x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x14 = this._io.readU4be();
      this._debug.u320x14.end = this._io.pos;
      this._debug.u320x18 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x18 = this._io.readU4be();
      this._debug.u320x18.end = this._io.pos;
      this._debug.u320x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x10 = this._io.readU4be();
      this._debug.u320x10.end = this._io.pos;
      this._debug.u160x0e = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0e = this._io.readU2be();
      this._debug.u160x0e.end = this._io.pos;
      this._debug.u160x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0a = this._io.readU2be();
      this._debug.u160x0a.end = this._io.pos;
      this._debug.u320x20 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x20 = this._io.readU4be();
      this._debug.u320x20.end = this._io.pos;
    }

    return PuzzleAction0x4f;
  })();

  var Unrecognized = GloverLevel.Unrecognized = (function() {
    function Unrecognized(_io, _parent, _root) {
      this.__type = 'Unrecognized';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Unrecognized.prototype._read = function() {
    }

    return Unrecognized;
  })();

  var PlatScale = GloverLevel.PlatScale = (function() {
    function PlatScale(_io, _parent, _root) {
      this.__type = 'PlatScale';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatScale.prototype._read = function() {
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
    }

    return PlatScale;
  })();

  var Unknown0xbf = GloverLevel.Unknown0xbf = (function() {
    function Unknown0xbf(_io, _parent, _root) {
      this.__type = 'Unknown0xbf';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Unknown0xbf.prototype._read = function() {
      this._debug.mode = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.mode = this._io.readU2be();
      this._debug.mode.end = this._io.pos;
      this._debug.i0x02 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x02 = this._io.readU4be();
      this._debug.i0x02.end = this._io.pos;
    }

    return Unknown0xbf;
  })();

  var PuzzleAction0x4b0x4c = GloverLevel.PuzzleAction0x4b0x4c = (function() {
    function PuzzleAction0x4b0x4c(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x4b0x4c';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleAction0x4b0x4c.prototype._read = function() {
      this._debug.u160x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0a = this._io.readU2be();
      this._debug.u160x0a.end = this._io.pos;
    }

    return PuzzleAction0x4b0x4c;
  })();

  var SetActorScale = GloverLevel.SetActorScale = (function() {
    function SetActorScale(_io, _parent, _root) {
      this.__type = 'SetActorScale';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    SetActorScale.prototype._read = function() {
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
    }

    return SetActorScale;
  })();

  var PlatSpecial0xb8 = GloverLevel.PlatSpecial0xb8 = (function() {
    function PlatSpecial0xb8(_io, _parent, _root) {
      this.__type = 'PlatSpecial0xb8';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpecial0xb8.prototype._read = function() {
    }

    return PlatSpecial0xb8;
  })();

  var PlatOrbitFlip0x77 = GloverLevel.PlatOrbitFlip0x77 = (function() {
    function PlatOrbitFlip0x77(_io, _parent, _root) {
      this.__type = 'PlatOrbitFlip0x77';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatOrbitFlip0x77.prototype._read = function() {
      this._debug.u160x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x08 = this._io.readU2be();
      this._debug.u160x08.end = this._io.pos;
      this._debug.u160x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x10 = this._io.readU2be();
      this._debug.u160x10.end = this._io.pos;
    }

    return PlatOrbitFlip0x77;
  })();

  var PlatDestructibleSound = GloverLevel.PlatDestructibleSound = (function() {
    function PlatDestructibleSound(_io, _parent, _root) {
      this.__type = 'PlatDestructibleSound';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatDestructibleSound.prototype._read = function() {
      this._debug.soundId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.soundId = this._io.readU2be();
      this._debug.soundId.end = this._io.pos;
      this._debug.volume = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.volume = this._io.readU2be();
      this._debug.volume.end = this._io.pos;
      this._debug.pitch = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.pitch = this._io.readU2be();
      this._debug.pitch.end = this._io.pos;
    }

    return PlatDestructibleSound;
  })();

  var AmbientLight = GloverLevel.AmbientLight = (function() {
    function AmbientLight(_io, _parent, _root) {
      this.__type = 'AmbientLight';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    AmbientLight.prototype._read = function() {
      this._debug.r = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.r = this._io.readU2be();
      this._debug.r.end = this._io.pos;
      this._debug.g = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.g = this._io.readU2be();
      this._debug.g.end = this._io.pos;
      this._debug.b = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.b = this._io.readU2be();
      this._debug.b.end = this._io.pos;
    }

    return AmbientLight;
  })();

  var Enemy = GloverLevel.Enemy = (function() {
    function Enemy(_io, _parent, _root) {
      this.__type = 'Enemy';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Enemy.prototype._read = function() {
      this._debug.enemyType = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.enemyType = this._io.readU2be();
      this._debug.enemyType.end = this._io.pos;
      this._debug.u1 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u1 = this._io.readU2be();
      this._debug.u1.end = this._io.pos;
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
      this._debug.yRotation = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.yRotation = this._io.readF4be();
      this._debug.yRotation.end = this._io.pos;
    }

    return Enemy;
  })();

  var Plat0xa4 = GloverLevel.Plat0xa4 = (function() {
    function Plat0xa4(_io, _parent, _root) {
      this.__type = 'Plat0xa4';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Plat0xa4.prototype._read = function() {
    }

    return Plat0xa4;
  })();

  var PlatSpin0x7b = GloverLevel.PlatSpin0x7b = (function() {
    function PlatSpin0x7b(_io, _parent, _root) {
      this.__type = 'PlatSpin0x7b';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpin0x7b.prototype._read = function() {
    }

    return PlatSpin0x7b;
  })();

  var PlatSpecial0xb6 = GloverLevel.PlatSpecial0xb6 = (function() {
    function PlatSpecial0xb6(_io, _parent, _root) {
      this.__type = 'PlatSpecial0xb6';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpecial0xb6.prototype._read = function() {
      this._debug.u160x34 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x34 = this._io.readU2be();
      this._debug.u160x34.end = this._io.pos;
      this._debug.u160x40 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x40 = this._io.readU2be();
      this._debug.u160x40.end = this._io.pos;
    }

    return PlatSpecial0xb6;
  })();

  var PlatCrumb0x67 = GloverLevel.PlatCrumb0x67 = (function() {
    function PlatCrumb0x67(_io, _parent, _root) {
      this.__type = 'PlatCrumb0x67';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatCrumb0x67.prototype._read = function() {
      this._debug.u160x02 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x02 = this._io.readU2be();
      this._debug.u160x02.end = this._io.pos;
      this._debug.u160x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x04 = this._io.readU2be();
      this._debug.u160x04.end = this._io.pos;
      this._debug.u160x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x08 = this._io.readU4be();
      this._debug.u160x08.end = this._io.pos;
    }

    return PlatCrumb0x67;
  })();

  var PuzzleActionDefault = GloverLevel.PuzzleActionDefault = (function() {
    function PuzzleActionDefault(_io, _parent, _root) {
      this.__type = 'PuzzleActionDefault';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleActionDefault.prototype._read = function() {
      this._debug.u320x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x10 = this._io.readU4be();
      this._debug.u320x10.end = this._io.pos;
      this._debug.u160x0e = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0e = this._io.readU2be();
      this._debug.u160x0e.end = this._io.pos;
      this._debug.u160x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0a = this._io.readU2be();
      this._debug.u160x0a.end = this._io.pos;
      this._debug.u320x20 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x20 = this._io.readU4be();
      this._debug.u320x20.end = this._io.pos;
    }

    return PuzzleActionDefault;
  })();

  var Garib = GloverLevel.Garib = (function() {
    function Garib(_io, _parent, _root) {
      this.__type = 'Garib';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Garib.prototype._read = function() {
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
      this._debug.type = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.type = this._io.readU2be();
      this._debug.type.end = this._io.pos;
      this._debug.u80x0f = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u80x0f = this._io.readU2be();
      this._debug.u80x0f.end = this._io.pos;
    }

    return Garib;
  })();

  var GaribGroup = GloverLevel.GaribGroup = (function() {
    function GaribGroup(_io, _parent, _root) {
      this.__type = 'GaribGroup';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    GaribGroup.prototype._read = function() {
      this._debug.u160xd2 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160xd2 = this._io.readU2be();
      this._debug.u160xd2.end = this._io.pos;
      this._debug.u80xd1 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u80xd1 = this._io.readU2be();
      this._debug.u80xd1.end = this._io.pos;
    }

    return GaribGroup;
  })();

  var CameoInst6 = GloverLevel.CameoInst6 = (function() {
    function CameoInst6(_io, _parent, _root) {
      this.__type = 'CameoInst6';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    CameoInst6.prototype._read = function() {
      this._debug.h0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x00 = this._io.readU2be();
      this._debug.h0x00.end = this._io.pos;
      this._debug.h0x02 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x02 = this._io.readU2be();
      this._debug.h0x02.end = this._io.pos;
      this._debug.h0x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x04 = this._io.readU2be();
      this._debug.h0x04.end = this._io.pos;
      this._debug.h0x06 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x06 = this._io.readU2be();
      this._debug.h0x06.end = this._io.pos;
    }

    return CameoInst6;
  })();

  var PlatPathPoint = GloverLevel.PlatPathPoint = (function() {
    function PlatPathPoint(_io, _parent, _root) {
      this.__type = 'PlatPathPoint';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatPathPoint.prototype._read = function() {
      this._debug.duration = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.duration = this._io.readS2be();
      this._debug.duration.end = this._io.pos;
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
    }

    return PlatPathPoint;
  })();

  var Plat0x78 = GloverLevel.Plat0x78 = (function() {
    function Plat0x78(_io, _parent, _root) {
      this.__type = 'Plat0x78';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Plat0x78.prototype._read = function() {
      this._debug.u160x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x08 = this._io.readU2be();
      this._debug.u160x08.end = this._io.pos;
    }

    return Plat0x78;
  })();

  var BackgroundActor0x91 = GloverLevel.BackgroundActor0x91 = (function() {
    function BackgroundActor0x91(_io, _parent, _root) {
      this.__type = 'BackgroundActor0x91';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    BackgroundActor0x91.prototype._read = function() {
      this._debug.objectId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.objectId = this._io.readU4be();
      this._debug.objectId.end = this._io.pos;
      this._debug.name = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this._debug.name.end = this._io.pos;
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
    }

    return BackgroundActor0x91;
  })();

  var Enemy0xba = GloverLevel.Enemy0xba = (function() {
    function Enemy0xba(_io, _parent, _root) {
      this.__type = 'Enemy0xba';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Enemy0xba.prototype._read = function() {
    }

    return Enemy0xba;
  })();

  var PuzzleCondA = GloverLevel.PuzzleCondA = (function() {
    function PuzzleCondA(_io, _parent, _root) {
      this.__type = 'PuzzleCondA';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleCondA.prototype._read = function() {
      this._debug.u320x24 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x24 = this._io.readU2be();
      this._debug.u320x24.end = this._io.pos;
      this._debug.u160x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0a = this._io.readU2be();
      this._debug.u160x0a.end = this._io.pos;
    }

    return PuzzleCondA;
  })();

  var PlatSine = GloverLevel.PlatSine = (function() {
    function PlatSine(_io, _parent, _root) {
      this.__type = 'PlatSine';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSine.prototype._read = function() {
      this._debug.u32Count = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u32Count = this._io.readU4be();
      this._debug.u32Count.end = this._io.pos;
      this._debug.u32116 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u32116 = this._io.readU4be();
      this._debug.u32116.end = this._io.pos;
      this._debug.name = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this._debug.name.end = this._io.pos;
      this._debug.f108 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f108 = this._io.readF4be();
      this._debug.f108.end = this._io.pos;
      this._debug.f104 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f104 = this._io.readF4be();
      this._debug.f104.end = this._io.pos;
      this._debug.f100 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f100 = this._io.readF4be();
      this._debug.f100.end = this._io.pos;
      this._debug.f96 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f96 = this._io.readF4be();
      this._debug.f96.end = this._io.pos;
      this._debug.f92 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f92 = this._io.readF4be();
      this._debug.f92.end = this._io.pos;
      this._debug.f88 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f88 = this._io.readF4be();
      this._debug.f88.end = this._io.pos;
      this._debug.f84 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f84 = this._io.readF4be();
      this._debug.f84.end = this._io.pos;
      this._debug.f80 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f80 = this._io.readF4be();
      this._debug.f80.end = this._io.pos;
      this._debug.u32176 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u32176 = this._io.readU4be();
      this._debug.u32176.end = this._io.pos;
      this._debug.u32172 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u32172 = this._io.readU4be();
      this._debug.u32172.end = this._io.pos;
    }

    return PlatSine;
  })();

  var PlatCat0x69 = GloverLevel.PlatCat0x69 = (function() {
    function PlatCat0x69(_io, _parent, _root) {
      this.__type = 'PlatCat0x69';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatCat0x69.prototype._read = function() {
      this._debug.u160x20 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x20 = this._io.readU2be();
      this._debug.u160x20.end = this._io.pos;
      this._debug.u320x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x00 = this._io.readU4be();
      this._debug.u320x00.end = this._io.pos;
      this._debug.u320x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x04 = this._io.readU4be();
      this._debug.u320x04.end = this._io.pos;
      this._debug.u320x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x08 = this._io.readU4be();
      this._debug.u320x08.end = this._io.pos;
      this._debug.u320x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x0c = this._io.readU4be();
      this._debug.u320x0c.end = this._io.pos;
      this._debug.u320x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x10 = this._io.readU4be();
      this._debug.u320x10.end = this._io.pos;
      this._debug.u320x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x1c = this._io.readU4be();
      this._debug.u320x1c.end = this._io.pos;
    }

    return PlatCat0x69;
  })();

  var PlatRope = GloverLevel.PlatRope = (function() {
    function PlatRope(_io, _parent, _root) {
      this.__type = 'PlatRope';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatRope.prototype._read = function() {
      this._debug.u32Count = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u32Count = this._io.readU4be();
      this._debug.u32Count.end = this._io.pos;
      this._debug.u16Idx = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u16Idx = this._io.readU2be();
      this._debug.u16Idx.end = this._io.pos;
      this._debug.u32U1 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u32U1 = this._io.readU4be();
      this._debug.u32U1.end = this._io.pos;
      this._debug.name = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this._debug.name.end = this._io.pos;
      this._debug.ustack1760 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.ustack1760 = this._io.readU4be();
      this._debug.ustack1760.end = this._io.pos;
      this._debug.ustack1761 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.ustack1761 = this._io.readU4be();
      this._debug.ustack1761.end = this._io.pos;
      this._debug.ustack1762 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.ustack1762 = this._io.readU4be();
      this._debug.ustack1762.end = this._io.pos;
      this._debug.ustack1763 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.ustack1763 = this._io.readU4be();
      this._debug.ustack1763.end = this._io.pos;
      this._debug.ustack1764 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.ustack1764 = this._io.readU4be();
      this._debug.ustack1764.end = this._io.pos;
      this._debug.ustack1765 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.ustack1765 = this._io.readU4be();
      this._debug.ustack1765.end = this._io.pos;
      this._debug.ustack1766 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.ustack1766 = this._io.readU4be();
      this._debug.ustack1766.end = this._io.pos;
      this._debug.f112 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f112 = this._io.readF4be();
      this._debug.f112.end = this._io.pos;
      this._debug.f108 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f108 = this._io.readF4be();
      this._debug.f108.end = this._io.pos;
      this._debug.f104 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f104 = this._io.readF4be();
      this._debug.f104.end = this._io.pos;
      this._debug.f100 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f100 = this._io.readF4be();
      this._debug.f100.end = this._io.pos;
      this._debug.f96 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f96 = this._io.readF4be();
      this._debug.f96.end = this._io.pos;
      this._debug.f92 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f92 = this._io.readF4be();
      this._debug.f92.end = this._io.pos;
    }

    return PlatRope;
  })();

  var PuzzleNumtimes = GloverLevel.PuzzleNumtimes = (function() {
    function PuzzleNumtimes(_io, _parent, _root) {
      this.__type = 'PuzzleNumtimes';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleNumtimes.prototype._read = function() {
      this._debug.n = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.n = this._io.readU2be();
      this._debug.n.end = this._io.pos;
    }

    return PuzzleNumtimes;
  })();

  var PlatSpin0x80 = GloverLevel.PlatSpin0x80 = (function() {
    function PlatSpin0x80(_io, _parent, _root) {
      this.__type = 'PlatSpin0x80';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpin0x80.prototype._read = function() {
      this._debug.idx = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.idx = this._io.readU2be();
      this._debug.idx.end = this._io.pos;
      this._debug.f0x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x1c = this._io.readF4be();
      this._debug.f0x1c.end = this._io.pos;
      this._debug.u320x28 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x28 = this._io.readU4be();
      this._debug.u320x28.end = this._io.pos;
      this._debug.u32Ustack56 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u32Ustack56 = this._io.readU4be();
      this._debug.u32Ustack56.end = this._io.pos;
      this._debug.u320x2c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x2c = this._io.readU4be();
      this._debug.u320x2c.end = this._io.pos;
      this._debug.f0x6c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x6c = this._io.readF4be();
      this._debug.f0x6c.end = this._io.pos;
      this._debug.f0x70 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x70 = this._io.readU2be();
      this._debug.f0x70.end = this._io.pos;
    }

    return PlatSpin0x80;
  })();

  var Plat0x7e = GloverLevel.Plat0x7e = (function() {
    function Plat0x7e(_io, _parent, _root) {
      this.__type = 'Plat0x7e';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Plat0x7e.prototype._read = function() {
      this._debug.u320x28 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x28 = this._io.readU4be();
      this._debug.u320x28.end = this._io.pos;
    }

    return Plat0x7e;
  })();

  var CameoInst1 = GloverLevel.CameoInst1 = (function() {
    function CameoInst1(_io, _parent, _root) {
      this.__type = 'CameoInst1';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    CameoInst1.prototype._read = function() {
      this._debug.h0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x00 = this._io.readU2be();
      this._debug.h0x00.end = this._io.pos;
      this._debug.i0x02 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x02 = this._io.readU4be();
      this._debug.i0x02.end = this._io.pos;
      this._debug.i0x06 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x06 = this._io.readU4be();
      this._debug.i0x06.end = this._io.pos;
      this._debug.i0x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x0a = this._io.readU4be();
      this._debug.i0x0a.end = this._io.pos;
      this._debug.h0x0e = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x0e = this._io.readU2be();
      this._debug.h0x0e.end = this._io.pos;
      this._debug.h0x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x10 = this._io.readU2be();
      this._debug.h0x10.end = this._io.pos;
    }

    return CameoInst1;
  })();

  var Plat0x9d = GloverLevel.Plat0x9d = (function() {
    function Plat0x9d(_io, _parent, _root) {
      this.__type = 'Plat0x9d';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Plat0x9d.prototype._read = function() {
    }

    return Plat0x9d;
  })();

  var EnemyNormalInstruction = GloverLevel.EnemyNormalInstruction = (function() {
    function EnemyNormalInstruction(_io, _parent, _root) {
      this.__type = 'EnemyNormalInstruction';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyNormalInstruction.prototype._read = function() {
      this._debug.instr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.instr = new EnemyInstruction(this._io, this, this._root);
      this._debug.instr.end = this._io.pos;
    }

    return EnemyNormalInstruction;
  })();

  var FogConfiguration = GloverLevel.FogConfiguration = (function() {
    function FogConfiguration(_io, _parent, _root) {
      this.__type = 'FogConfiguration';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    FogConfiguration.prototype._read = function() {
      this._debug.fogEnabled = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.fogEnabled = this._io.readU1();
      this._debug.fogEnabled.end = this._io.pos;
      this._debug.r = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.r = this._io.readU1();
      this._debug.r.end = this._io.pos;
      this._debug.g = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.g = this._io.readU1();
      this._debug.g.end = this._io.pos;
      this._debug.b = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.b = this._io.readU1();
      this._debug.b.end = this._io.pos;
      this._debug.fogDistance = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.fogDistance = this._io.readU2be();
      this._debug.fogDistance.end = this._io.pos;
      this._debug.nearClip = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.nearClip = this._io.readU2be();
      this._debug.nearClip.end = this._io.pos;
    }

    return FogConfiguration;
  })();

  var CameoInst5 = GloverLevel.CameoInst5 = (function() {
    function CameoInst5(_io, _parent, _root) {
      this.__type = 'CameoInst5';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    CameoInst5.prototype._read = function() {
      this._debug.h0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x00 = this._io.readU2be();
      this._debug.h0x00.end = this._io.pos;
      this._debug.h0x02 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x02 = this._io.readU2be();
      this._debug.h0x02.end = this._io.pos;
      this._debug.h0x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x04 = this._io.readU2be();
      this._debug.h0x04.end = this._io.pos;
    }

    return CameoInst5;
  })();

  var PlatTopple0x81 = GloverLevel.PlatTopple0x81 = (function() {
    function PlatTopple0x81(_io, _parent, _root) {
      this.__type = 'PlatTopple0x81';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatTopple0x81.prototype._read = function() {
      this._debug.idx = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.idx = this._io.readU2be();
      this._debug.idx.end = this._io.pos;
      this._debug.f0x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x1c = this._io.readF4be();
      this._debug.f0x1c.end = this._io.pos;
      this._debug.f0x28 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x28 = this._io.readF4be();
      this._debug.f0x28.end = this._io.pos;
      this._debug.f0x24 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x24 = this._io.readF4be();
      this._debug.f0x24.end = this._io.pos;
      this._debug.f0x2c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x2c = this._io.readF4be();
      this._debug.f0x2c.end = this._io.pos;
      this._debug.f0x6c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x6c = this._io.readF4be();
      this._debug.f0x6c.end = this._io.pos;
      this._debug.f0x70PivotHeight = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x70PivotHeight = this._io.readF4be();
      this._debug.f0x70PivotHeight.end = this._io.pos;
      this._debug.u160x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x10 = this._io.readU2be();
      this._debug.u160x10.end = this._io.pos;
    }

    return PlatTopple0x81;
  })();

  var PuzzleAction0x55 = GloverLevel.PuzzleAction0x55 = (function() {
    function PuzzleAction0x55(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x55';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleAction0x55.prototype._read = function() {
      this._debug.u320x24 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x24 = this._io.readU4be();
      this._debug.u320x24.end = this._io.pos;
      this._debug.u160x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0a = this._io.readU2be();
      this._debug.u160x0a.end = this._io.pos;
    }

    return PuzzleAction0x55;
  })();

  var CameoInst3 = GloverLevel.CameoInst3 = (function() {
    function CameoInst3(_io, _parent, _root) {
      this.__type = 'CameoInst3';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    CameoInst3.prototype._read = function() {
      this._debug.h0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x00 = this._io.readU2be();
      this._debug.h0x00.end = this._io.pos;
      this._debug.i0x02 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x02 = this._io.readU4be();
      this._debug.i0x02.end = this._io.pos;
      this._debug.h0x06 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x06 = this._io.readU2be();
      this._debug.h0x06.end = this._io.pos;
      this._debug.h0x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x08 = this._io.readU2be();
      this._debug.h0x08.end = this._io.pos;
    }

    return CameoInst3;
  })();

  var PlatGoForwards0x5f = GloverLevel.PlatGoForwards0x5f = (function() {
    function PlatGoForwards0x5f(_io, _parent, _root) {
      this.__type = 'PlatGoForwards0x5f';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatGoForwards0x5f.prototype._read = function() {
      this._debug.u320x2c0x6c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x2c0x6c = this._io.readU4be();
      this._debug.u320x2c0x6c.end = this._io.pos;
      this._debug.u320x2c0x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x2c0x1c = this._io.readU4be();
      this._debug.u320x2c0x1c.end = this._io.pos;
      this._debug.u320xf0 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320xf0 = this._io.readU4be();
      this._debug.u320xf0.end = this._io.pos;
      this._debug.u320x2c0x34 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x2c0x34 = this._io.readU4be();
      this._debug.u320x2c0x34.end = this._io.pos;
    }

    return PlatGoForwards0x5f;
  })();

  var PlatSpecial0x9e = GloverLevel.PlatSpecial0x9e = (function() {
    function PlatSpecial0x9e(_io, _parent, _root) {
      this.__type = 'PlatSpecial0x9e';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpecial0x9e.prototype._read = function() {
      this._debug.u320x5c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x5c = this._io.readU4be();
      this._debug.u320x5c.end = this._io.pos;
      this._debug.u320x60 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x60 = this._io.readU4be();
      this._debug.u320x60.end = this._io.pos;
      this._debug.u320x65 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x65 = this._io.readU4be();
      this._debug.u320x65.end = this._io.pos;
      this._debug.u320x68 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x68 = this._io.readU4be();
      this._debug.u320x68.end = this._io.pos;
    }

    return PlatSpecial0x9e;
  })();

  var EnemyInstruction = GloverLevel.EnemyInstruction = (function() {
    function EnemyInstruction(_io, _parent, _root) {
      this.__type = 'EnemyInstruction';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyInstruction.prototype._read = function() {
      this._debug.typeCode = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.typeCode = this._io.readU2be();
      this._debug.typeCode.end = this._io.pos;
      this._debug.u160x02 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x02 = this._io.readU2be();
      this._debug.u160x02.end = this._io.pos;
      this._debug.body = { start: this._io.pos, ioOffset: this._io.byteOffset };
      switch (this.typeCode) {
      case 14:
        this.body = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 10:
        this.body = new EnemyInstructionA(this._io, this, this._root);
        break;
      case 17:
        this.body = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 0:
        this.body = new EnemyInstructionA(this._io, this, this._root);
        break;
      case 4:
        this.body = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 24:
        this.body = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 6:
        this.body = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 20:
        this.body = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 7:
        this.body = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 1:
        this.body = new EnemyInstructionA(this._io, this, this._root);
        break;
      case 13:
        this.body = new EnemyInstructionA(this._io, this, this._root);
        break;
      case 11:
        this.body = new EnemyInstructionA(this._io, this, this._root);
        break;
      case 12:
        this.body = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 3:
        this.body = new EnemyInstructionB(this._io, this, this._root);
        break;
      case 5:
        this.body = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 19:
        this.body = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 23:
        this.body = new EnemyInstructionA(this._io, this, this._root);
        break;
      case 15:
        this.body = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 8:
        this.body = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 9:
        this.body = new EnemyInstructionA(this._io, this, this._root);
        break;
      case 21:
        this.body = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 16:
        this.body = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 18:
        this.body = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 2:
        this.body = new EnemyInstructionA(this._io, this, this._root);
        break;
      case 22:
        this.body = new EnemyInstructionA(this._io, this, this._root);
        break;
      default:
        this.body = new EnemyInstructionError(this._io, this, this._root);
        break;
      }
      this._debug.body.end = this._io.pos;
    }

    return EnemyInstruction;
  })();

  var SetGlobal0xb7 = GloverLevel.SetGlobal0xb7 = (function() {
    function SetGlobal0xb7(_io, _parent, _root) {
      this.__type = 'SetGlobal0xb7';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    SetGlobal0xb7.prototype._read = function() {
      this._debug.value = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.value = this._io.readU4be();
      this._debug.value.end = this._io.pos;
    }

    return SetGlobal0xb7;
  })();

  var PlatConf0x72 = GloverLevel.PlatConf0x72 = (function() {
    function PlatConf0x72(_io, _parent, _root) {
      this.__type = 'PlatConf0x72';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatConf0x72.prototype._read = function() {
      this._debug.u320x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x00 = this._io.readU4be();
      this._debug.u320x00.end = this._io.pos;
      this._debug.u320x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x04 = this._io.readU4be();
      this._debug.u320x04.end = this._io.pos;
      this._debug.u320x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x08 = this._io.readU4be();
      this._debug.u320x08.end = this._io.pos;
      this._debug.u320x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x0c = this._io.readU4be();
      this._debug.u320x0c.end = this._io.pos;
      this._debug.u320x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x10 = this._io.readU4be();
      this._debug.u320x10.end = this._io.pos;
      this._debug.u320x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x14 = this._io.readU4be();
      this._debug.u320x14.end = this._io.pos;
    }

    return PlatConf0x72;
  })();

  var PuzzleCondE = GloverLevel.PuzzleCondE = (function() {
    function PuzzleCondE(_io, _parent, _root) {
      this.__type = 'PuzzleCondE';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleCondE.prototype._read = function() {
      this._debug.i0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x00 = this._io.readU4be();
      this._debug.i0x00.end = this._io.pos;
      this._debug.i0x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x04 = this._io.readU4be();
      this._debug.i0x04.end = this._io.pos;
      this._debug.i0x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x08 = this._io.readU4be();
      this._debug.i0x08.end = this._io.pos;
      this._debug.i0x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x0c = this._io.readU4be();
      this._debug.i0x0c.end = this._io.pos;
      this._debug.i0x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x10 = this._io.readU4be();
      this._debug.i0x10.end = this._io.pos;
    }

    return PuzzleCondE;
  })();

  var Platform = GloverLevel.Platform = (function() {
    function Platform(_io, _parent, _root) {
      this.__type = 'Platform';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Platform.prototype._read = function() {
      this._debug.objectId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.objectId = this._io.readU4be();
      this._debug.objectId.end = this._io.pos;
      this._debug.name = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this._debug.name.end = this._io.pos;
    }

    return Platform;
  })();

  var PlatSpecial0xb4 = GloverLevel.PlatSpecial0xb4 = (function() {
    function PlatSpecial0xb4(_io, _parent, _root) {
      this.__type = 'PlatSpecial0xb4';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpecial0xb4.prototype._read = function() {
      this._debug.u80x23 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u80x23 = this._io.readU2be();
      this._debug.u80x23.end = this._io.pos;
    }

    return PlatSpecial0xb4;
  })();

  var PlatPos0xa7 = GloverLevel.PlatPos0xa7 = (function() {
    function PlatPos0xa7(_io, _parent, _root) {
      this.__type = 'PlatPos0xa7';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatPos0xa7.prototype._read = function() {
      this._debug.u8Idx = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u8Idx = this._io.readU2be();
      this._debug.u8Idx.end = this._io.pos;
    }

    return PlatPos0xa7;
  })();

  var BackgroundActor0xbc = GloverLevel.BackgroundActor0xbc = (function() {
    function BackgroundActor0xbc(_io, _parent, _root) {
      this.__type = 'BackgroundActor0xbc';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    BackgroundActor0xbc.prototype._read = function() {
      this._debug.objectId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.objectId = this._io.readU4be();
      this._debug.objectId.end = this._io.pos;
      this._debug.name = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this._debug.name.end = this._io.pos;
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
    }

    return BackgroundActor0xbc;
  })();

  var PlatSpecial0x6e = GloverLevel.PlatSpecial0x6e = (function() {
    function PlatSpecial0x6e(_io, _parent, _root) {
      this.__type = 'PlatSpecial0x6e';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpecial0x6e.prototype._read = function() {
      this._debug.flags = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.flags = this._io.readU2be();
      this._debug.flags.end = this._io.pos;
      this._debug.u320x70 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x70 = this._io.readU4be();
      this._debug.u320x70.end = this._io.pos;
    }

    return PlatSpecial0x6e;
  })();

  var CameoInstDefault = GloverLevel.CameoInstDefault = (function() {
    function CameoInstDefault(_io, _parent, _root) {
      this.__type = 'CameoInstDefault';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    CameoInstDefault.prototype._read = function() {
      this._debug.h0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x00 = this._io.readU2be();
      this._debug.h0x00.end = this._io.pos;
      this._debug.h0x02 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x02 = this._io.readU2be();
      this._debug.h0x02.end = this._io.pos;
    }

    return CameoInstDefault;
  })();

  var PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40 = GloverLevel.PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40 = (function() {
    function PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40.prototype._read = function() {
      this._debug.u320x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x14 = this._io.readU4be();
      this._debug.u320x14.end = this._io.pos;
      this._debug.u320x18 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x18 = this._io.readU4be();
      this._debug.u320x18.end = this._io.pos;
      this._debug.u320x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x1c = this._io.readU4be();
      this._debug.u320x1c.end = this._io.pos;
      this._debug.u320x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x10 = this._io.readU4be();
      this._debug.u320x10.end = this._io.pos;
      this._debug.u160x0e = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0e = this._io.readU2be();
      this._debug.u160x0e.end = this._io.pos;
      this._debug.u160x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0a = this._io.readU2be();
      this._debug.u160x0a.end = this._io.pos;
      this._debug.u320x20 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x20 = this._io.readU4be();
      this._debug.u320x20.end = this._io.pos;
    }

    return PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40;
  })();

  var PuzzleCondB = GloverLevel.PuzzleCondB = (function() {
    function PuzzleCondB(_io, _parent, _root) {
      this.__type = 'PuzzleCondB';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleCondB.prototype._read = function() {
      this._debug.i0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x00 = this._io.readU4be();
      this._debug.i0x00.end = this._io.pos;
      this._debug.i0x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x04 = this._io.readU4be();
      this._debug.i0x04.end = this._io.pos;
      this._debug.i0x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x08 = this._io.readU4be();
      this._debug.i0x08.end = this._io.pos;
      this._debug.i0x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x0c = this._io.readU4be();
      this._debug.i0x0c.end = this._io.pos;
      this._debug.i0x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x10 = this._io.readU4be();
      this._debug.i0x10.end = this._io.pos;
      this._debug.i0x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x14 = this._io.readU4be();
      this._debug.i0x14.end = this._io.pos;
      this._debug.i0x18 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x18 = this._io.readU4be();
      this._debug.i0x18.end = this._io.pos;
    }

    return PuzzleCondB;
  })();

  var PlatStr0x7a = GloverLevel.PlatStr0x7a = (function() {
    function PlatStr0x7a(_io, _parent, _root) {
      this.__type = 'PlatStr0x7a';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatStr0x7a.prototype._read = function() {
      this._debug.u320x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x0c = this._io.readU4be();
      this._debug.u320x0c.end = this._io.pos;
      this._debug.u320x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x10 = this._io.readU4be();
      this._debug.u320x10.end = this._io.pos;
      this._debug.u320x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x14 = this._io.readU4be();
      this._debug.u320x14.end = this._io.pos;
      this._debug.u160x18 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x18 = this._io.readU2be();
      this._debug.u160x18.end = this._io.pos;
      this._debug.u160x1c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x1c = this._io.readU2be();
      this._debug.u160x1c.end = this._io.pos;
    }

    return PlatStr0x7a;
  })();

  var Enemy0x84 = GloverLevel.Enemy0x84 = (function() {
    function Enemy0x84(_io, _parent, _root) {
      this.__type = 'Enemy0x84';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Enemy0x84.prototype._read = function() {
    }

    return Enemy0x84;
  })();

  var EnemyInstructionA = GloverLevel.EnemyInstructionA = (function() {
    function EnemyInstructionA(_io, _parent, _root) {
      this.__type = 'EnemyInstructionA';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyInstructionA.prototype._read = function() {
      this._debug.u320x02 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x02 = this._io.readU4be();
      this._debug.u320x02.end = this._io.pos;
      this._debug.u320x06 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x06 = this._io.readU4be();
      this._debug.u320x06.end = this._io.pos;
      this._debug.u320x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x0a = this._io.readU4be();
      this._debug.u320x0a.end = this._io.pos;
      this._debug.u320x0e = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x0e = this._io.readU4be();
      this._debug.u320x0e.end = this._io.pos;
      this._debug.u320x18 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x18 = this._io.readU4be();
      this._debug.u320x18.end = this._io.pos;
      this._debug.u320x1e = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x1e = this._io.readU4be();
      this._debug.u320x1e.end = this._io.pos;
      this._debug.u320x14 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x14 = this._io.readU4be();
      this._debug.u320x14.end = this._io.pos;
      this._debug.u320x16 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x16 = this._io.readU2be();
      this._debug.u320x16.end = this._io.pos;
    }

    return EnemyInstructionA;
  })();

  var PlatSpecial0xb9 = GloverLevel.PlatSpecial0xb9 = (function() {
    function PlatSpecial0xb9(_io, _parent, _root) {
      this.__type = 'PlatSpecial0xb9';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpecial0xb9.prototype._read = function() {
    }

    return PlatSpecial0xb9;
  })();

  var EnemyAttackInstruction = GloverLevel.EnemyAttackInstruction = (function() {
    function EnemyAttackInstruction(_io, _parent, _root) {
      this.__type = 'EnemyAttackInstruction';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyAttackInstruction.prototype._read = function() {
      this._debug.instr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.instr = new EnemyInstruction(this._io, this, this._root);
      this._debug.instr.end = this._io.pos;
    }

    return EnemyAttackInstruction;
  })();

  var LandActor = GloverLevel.LandActor = (function() {
    function LandActor(_io, _parent, _root) {
      this.__type = 'LandActor';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    LandActor.prototype._read = function() {
      this._debug.objectId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.objectId = this._io.readU4be();
      this._debug.objectId.end = this._io.pos;
      this._debug.name = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this._debug.name.end = this._io.pos;
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
    }

    return LandActor;
  })();

  var PlatOrbitPause0x76 = GloverLevel.PlatOrbitPause0x76 = (function() {
    function PlatOrbitPause0x76(_io, _parent, _root) {
      this.__type = 'PlatOrbitPause0x76';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatOrbitPause0x76.prototype._read = function() {
      this._debug.u160x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x08 = this._io.readU2be();
      this._debug.u160x08.end = this._io.pos;
      this._debug.u160x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0c = this._io.readU2be();
      this._debug.u160x0c.end = this._io.pos;
    }

    return PlatOrbitPause0x76;
  })();

  var MrTip = GloverLevel.MrTip = (function() {
    function MrTip(_io, _parent, _root) {
      this.__type = 'MrTip';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    MrTip.prototype._read = function() {
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
      this._debug.messageId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.messageId = this._io.readU2be();
      this._debug.messageId.end = this._io.pos;
    }

    return MrTip;
  })();

  var PuzzleAction0x490x4d = GloverLevel.PuzzleAction0x490x4d = (function() {
    function PuzzleAction0x490x4d(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x490x4d';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PuzzleAction0x490x4d.prototype._read = function() {
      this._debug.u320x24 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x24 = this._io.readU4be();
      this._debug.u320x24.end = this._io.pos;
      this._debug.u320x28 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x28 = this._io.readU4be();
      this._debug.u320x28.end = this._io.pos;
      this._debug.u320x2c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u320x2c = this._io.readU4be();
      this._debug.u320x2c.end = this._io.pos;
      this._debug.u160x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0a = this._io.readU2be();
      this._debug.u160x0a.end = this._io.pos;
    }

    return PuzzleAction0x490x4d;
  })();

  var CameoInst0 = GloverLevel.CameoInst0 = (function() {
    function CameoInst0(_io, _parent, _root) {
      this.__type = 'CameoInst0';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    CameoInst0.prototype._read = function() {
      this._debug.h0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x00 = this._io.readU2be();
      this._debug.h0x00.end = this._io.pos;
      this._debug.h0x02 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x02 = this._io.readU2be();
      this._debug.h0x02.end = this._io.pos;
      this._debug.h0x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x04 = this._io.readU2be();
      this._debug.h0x04.end = this._io.pos;
      this._debug.i0x06 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.i0x06 = this._io.readU4be();
      this._debug.i0x06.end = this._io.pos;
      this._debug.h0x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x0a = this._io.readU2be();
      this._debug.h0x0a.end = this._io.pos;
      this._debug.h0x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.h0x0c = this._io.readU2be();
      this._debug.h0x0c.end = this._io.pos;
    }

    return CameoInst0;
  })();

  var Unknown0x03 = GloverLevel.Unknown0x03 = (function() {
    function Unknown0x03(_io, _parent, _root) {
      this.__type = 'Unknown0x03';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Unknown0x03.prototype._read = function() {
      this._debug.f0x00 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x00 = this._io.readF4be();
      this._debug.f0x00.end = this._io.pos;
      this._debug.f0x04 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x04 = this._io.readF4be();
      this._debug.f0x04.end = this._io.pos;
      this._debug.f0x08 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x08 = this._io.readF4be();
      this._debug.f0x08.end = this._io.pos;
      this._debug.f0x0c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x0c = this._io.readF4be();
      this._debug.f0x0c.end = this._io.pos;
      this._debug.f0x10 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.f0x10 = this._io.readF4be();
      this._debug.f0x10.end = this._io.pos;
    }

    return Unknown0x03;
  })();

  return GloverLevel;
})();
return GloverLevel;
}));
