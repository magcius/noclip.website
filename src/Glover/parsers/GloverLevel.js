// This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./kaitai-struct/KaitaiStream'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./kaitai-struct/KaitaiStream'));
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
      this._debug.tag = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.tag = this._io.readU2be();
      this._debug.tag.end = this._io.pos;
      this._debug.platform1Tag = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.platform1Tag = this._io.readU2be();
      this._debug.platform1Tag.end = this._io.pos;
      this._debug.platform2Tag = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.platform2Tag = this._io.readU2be();
      this._debug.platform2Tag.end = this._io.pos;
      this._debug.drawFlags = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.drawFlags = this._io.readU2be();
      this._debug.drawFlags.end = this._io.pos;
      this._debug.r = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.r = this._io.readU2be();
      this._debug.r.end = this._io.pos;
      this._debug.g = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.g = this._io.readU2be();
      this._debug.g.end = this._io.pos;
      this._debug.b = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.b = this._io.readU2be();
      this._debug.b.end = this._io.pos;
      this._debug.colorJitter = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.colorJitter = this._io.readU2be();
      this._debug.colorJitter.end = this._io.pos;
      this._debug.end1X = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.end1X = this._io.readF4be();
      this._debug.end1X.end = this._io.pos;
      this._debug.end1Y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.end1Y = this._io.readF4be();
      this._debug.end1Y.end = this._io.pos;
      this._debug.end1Z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.end1Z = this._io.readF4be();
      this._debug.end1Z.end = this._io.pos;
      this._debug.end2X = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.end2X = this._io.readF4be();
      this._debug.end2X.end = this._io.pos;
      this._debug.end2Y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.end2Y = this._io.readF4be();
      this._debug.end2Y.end = this._io.pos;
      this._debug.end2Z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.end2Z = this._io.readF4be();
      this._debug.end2Z.end = this._io.pos;
      this._debug.drawDiameter = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.drawDiameter = this._io.readF4be();
      this._debug.drawDiameter.end = this._io.pos;
      this._debug.drawThickness = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.drawThickness = this._io.readF4be();
      this._debug.drawThickness.end = this._io.pos;
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

  var EnemyInstructionDash = GloverLevel.EnemyInstructionDash = (function() {
    function EnemyInstructionDash(_io, _parent, _root) {
      this.__type = 'EnemyInstructionDash';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyInstructionDash.prototype._read = function() {
      this._debug.destinationX = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.destinationX = this._io.readF4be();
      this._debug.destinationX.end = this._io.pos;
      this._debug.destinationY = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.destinationY = this._io.readF4be();
      this._debug.destinationY.end = this._io.pos;
      this._debug.destinationZ = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.destinationZ = this._io.readF4be();
      this._debug.destinationZ.end = this._io.pos;
      this._debug.velMagnitude = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.velMagnitude = this._io.readF4be();
      this._debug.velMagnitude.end = this._io.pos;
    }

    return EnemyInstructionDash;
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

  var Actor0xbf = GloverLevel.Actor0xbf = (function() {
    function Actor0xbf(_io, _parent, _root) {
      this.__type = 'Actor0xbf';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Actor0xbf.prototype._read = function() {
      this._debug.mode = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.mode = this._io.readU2be();
      this._debug.mode.end = this._io.pos;
      this._debug.childMeshId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.childMeshId = this._io.readU4be();
      this._debug.childMeshId.end = this._io.pos;
    }

    return Actor0xbf;
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

  var EnemyFinalize = GloverLevel.EnemyFinalize = (function() {
    function EnemyFinalize(_io, _parent, _root) {
      this.__type = 'EnemyFinalize';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyFinalize.prototype._read = function() {
    }

    return EnemyFinalize;
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

  var PlatConstantSpin = GloverLevel.PlatConstantSpin = (function() {
    function PlatConstantSpin(_io, _parent, _root) {
      this.__type = 'PlatConstantSpin';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatConstantSpin.prototype._read = function() {
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

    return PlatConstantSpin;
  })();

  var VentDutyCycle = GloverLevel.VentDutyCycle = (function() {
    function VentDutyCycle(_io, _parent, _root) {
      this.__type = 'VentDutyCycle';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    VentDutyCycle.prototype._read = function() {
      this._debug.framesOff = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.framesOff = this._io.readS2be();
      this._debug.framesOff.end = this._io.pos;
      this._debug.framesOn = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.framesOn = this._io.readS2be();
      this._debug.framesOn.end = this._io.pos;
    }

    return VentDutyCycle;
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

  var SetObjectSparkle = GloverLevel.SetObjectSparkle = (function() {
    function SetObjectSparkle(_io, _parent, _root) {
      this.__type = 'SetObjectSparkle';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    SetObjectSparkle.prototype._read = function() {
      this._debug.period = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.period = this._io.readU2be();
      this._debug.period.end = this._io.pos;
    }

    return SetObjectSparkle;
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

  var EnemyInstructionTurn = GloverLevel.EnemyInstructionTurn = (function() {
    function EnemyInstructionTurn(_io, _parent, _root) {
      this.__type = 'EnemyInstructionTurn';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyInstructionTurn.prototype._read = function() {
      this._debug.lookatX = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lookatX = this._io.readF4be();
      this._debug.lookatX.end = this._io.pos;
      this._debug.lookatY = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lookatY = this._io.readF4be();
      this._debug.lookatY.end = this._io.pos;
      this._debug.lookatZ = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lookatZ = this._io.readF4be();
      this._debug.lookatZ.end = this._io.pos;
      this._debug.chooseRandomDirection = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.chooseRandomDirection = this._io.readU4be();
      this._debug.chooseRandomDirection.end = this._io.pos;
    }

    return EnemyInstructionTurn;
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

  var PlatCopySpinFromParent = GloverLevel.PlatCopySpinFromParent = (function() {
    function PlatCopySpinFromParent(_io, _parent, _root) {
      this.__type = 'PlatCopySpinFromParent';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatCopySpinFromParent.prototype._read = function() {
    }

    return PlatCopySpinFromParent;
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
      this._debug.type = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.type = this._io.readU2be();
      this._debug.type.end = this._io.pos;
      this._debug.u160x0a = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x0a = this._io.readU2be();
      this._debug.u160x0a.end = this._io.pos;
      this._debug.parentTag = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.parentTag = this._io.readU2be();
      this._debug.parentTag.end = this._io.pos;
      this._debug.originX = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.originX = this._io.readF4be();
      this._debug.originX.end = this._io.pos;
      this._debug.originY = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.originY = this._io.readF4be();
      this._debug.originY.end = this._io.pos;
      this._debug.originZ = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.originZ = this._io.readF4be();
      this._debug.originZ.end = this._io.pos;
      this._debug.particleVelocityX = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.particleVelocityX = this._io.readF4be();
      this._debug.particleVelocityX.end = this._io.pos;
      this._debug.particleVelocityY = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.particleVelocityY = this._io.readF4be();
      this._debug.particleVelocityY.end = this._io.pos;
      this._debug.particleVelocityZ = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.particleVelocityZ = this._io.readF4be();
      this._debug.particleVelocityZ.end = this._io.pos;
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

  var EnemyInstructionRest = GloverLevel.EnemyInstructionRest = (function() {
    function EnemyInstructionRest(_io, _parent, _root) {
      this.__type = 'EnemyInstructionRest';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyInstructionRest.prototype._read = function() {
      this._debug.flags = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.flags = this._io.readU4be();
      this._debug.flags.end = this._io.pos;
      this._debug.animStartPlaying = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.animStartPlaying = this._io.readU4be();
      this._debug.animStartPlaying.end = this._io.pos;
    }

    return EnemyInstructionRest;
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
      this._debug.u160x17 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.u160x17 = this._io.readU2be();
      this._debug.u160x17.end = this._io.pos;
      this._debug.theta = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.theta = this._io.readF4be();
      this._debug.theta.end = this._io.pos;
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
      this._debug.type = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.type = this._io.readU2be();
      this._debug.type.end = this._io.pos;
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
        this.params = new Rope(this._io, this, this._root);
        break;
      case 93:
        this.params = new NullPlatform(this._io, this, this._root);
        break;
      case 118:
        this.params = new PlatOrbitPause(this._io, this, this._root);
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
        this.params = new PlatRocking(this._io, this, this._root);
        break;
      case 163:
        this.params = new VentDutyCycle(this._io, this, this._root);
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
        this.params = new Actor0xbf(this._io, this, this._root);
        break;
      case 1:
        this.params = new GloverSpawnPoint(this._io, this, this._root);
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
        this.params = new BackgroundActor(this._io, this, this._root);
        break;
      case 101:
        this.params = new PlatDestructible(this._io, this, this._root);
        break;
      case 144:
        this.params = new PlatSine(this._io, this, this._root);
        break;
      case 127:
        this.params = new PlatConstantSpin(this._io, this, this._root);
        break;
      case 100:
        this.params = new PlatNoClip(this._io, this, this._root);
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
        this.params = new EnemySetAttentionBbox(this._io, this, this._root);
        break;
      case 138:
        this.params = new PlatFan0x8a(this._io, this, this._root);
        break;
      case 3:
        this.params = new CameraSpawnPoint(this._io, this, this._root);
        break;
      case 192:
        this.params = new PlatPlayObjectAnimation(this._io, this, this._root);
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
        this.params = new PlatCheckpoint(this._io, this, this._root);
        break;
      case 185:
        this.params = new PlatSpecial0xb9(this._io, this, this._root);
        break;
      case 180:
        this.params = new SetObjectSparkle(this._io, this, this._root);
        break;
      case 156:
        this.params = new EnemyAttackInstruction(this._io, this, this._root);
        break;
      case 125:
        this.params = new PlatSpinFlip(this._io, this, this._root);
        break;
      case 186:
        this.params = new Enemy0xba(this._io, this, this._root);
        break;
      case 188:
        this.params = new AnimatedBackgroundActor(this._io, this, this._root);
        break;
      case 153:
        this.params = new Backdrop(this._io, this, this._root);
        break;
      case 123:
        this.params = new PlatCopySpinFromParent(this._io, this, this._root);
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
        this.params = new PlatOrbitAroundPoint(this._io, this, this._root);
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
        this.params = new BuzzerDutyCycle(this._io, this, this._root);
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
        this.params = new EnemyFinalize(this._io, this, this._root);
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
        this.params = new PlatOrbitSound0xc4(this._io, this, this._root);
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
      this._debug.height = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.height = this._io.readF4be();
      this._debug.height.end = this._io.pos;
      this._debug.depth = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.depth = this._io.readF4be();
      this._debug.depth.end = this._io.pos;
      this._debug.velX = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.velX = this._io.readF4be();
      this._debug.velX.end = this._io.pos;
      this._debug.velY = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.velY = this._io.readF4be();
      this._debug.velY.end = this._io.pos;
      this._debug.velZ = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.velZ = this._io.readF4be();
      this._debug.velZ.end = this._io.pos;
      this._debug.turbulence = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.turbulence = this._io.readF4be();
      this._debug.turbulence.end = this._io.pos;
      this._debug.unknown0x2c = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.unknown0x2c = this._io.readU4be();
      this._debug.unknown0x2c.end = this._io.pos;
      this._debug.active = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.active = this._io.readU4be();
      this._debug.active.end = this._io.pos;
      this._debug.tag = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.tag = this._io.readU4be();
      this._debug.tag.end = this._io.pos;
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
      this._debug.numFragments = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.numFragments = this._io.readU4be();
      this._debug.numFragments.end = this._io.pos;
      this._debug.fragmentObjectId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.fragmentObjectId = this._io.readU4be();
      this._debug.fragmentObjectId.end = this._io.pos;
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

  var PlatNoClip = GloverLevel.PlatNoClip = (function() {
    function PlatNoClip(_io, _parent, _root) {
      this.__type = 'PlatNoClip';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatNoClip.prototype._read = function() {
    }

    return PlatNoClip;
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

  var PlatOrbitSound0xc4 = GloverLevel.PlatOrbitSound0xc4 = (function() {
    function PlatOrbitSound0xc4(_io, _parent, _root) {
      this.__type = 'PlatOrbitSound0xc4';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatOrbitSound0xc4.prototype._read = function() {
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

    return PlatOrbitSound0xc4;
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
    Enemy.EnemyType = Object.freeze({
      BOVVA: 7,
      CANNON: 8,
      SAMTEX: 9,
      MALLET: 10,
      GENERALW: 11,
      LIONFISH: 12,
      CHESTER: 13,
      KEG: 14,
      REGGIE: 15,
      SWISH: 16,
      THRICE: 17,
      ROBES: 18,
      FUMBLE: 19,
      MIKE: 20,
      RAPTOR: 21,
      CRUMPET: 22,
      TRACEY: 23,
      YOOFOW: 24,
      OPEC: 25,
      CYMON: 26,
      SUCKER: 27,
      BUGLE: 28,
      DENNIS: 29,
      CHUCK: 30,
      HUBCHICKEN1: 31,
      FRANKIE2: 32,
      KLOSET: 33,
      WILLY: 34,
      JOFF: 35,
      CANCER: 36,
      KIRK: 37,
      ROBOT: 38,
      EVILROBOT: 39,
      SPANK: 40,
      BABYSPK2: 41,
      EVILGLOVE: 42,
      DIBBER: 43,
      BRUNDLE: 44,
      MALCOM: 45,
      SPOTTY: 46,
      GORDON: 47,
      SIDNEY: 48,
      WEEVIL: 49,
      CHOPSTIK: 50,
      BUTTERFLY: 51,
      SPIDER: 52,
      BAT: 53,
      FROG: 54,
      DRAGFLY: 55,
      BOXTHING: 56,
      BUG: 57,
      NMEFROG: 58,

      7: "BOVVA",
      8: "CANNON",
      9: "SAMTEX",
      10: "MALLET",
      11: "GENERALW",
      12: "LIONFISH",
      13: "CHESTER",
      14: "KEG",
      15: "REGGIE",
      16: "SWISH",
      17: "THRICE",
      18: "ROBES",
      19: "FUMBLE",
      20: "MIKE",
      21: "RAPTOR",
      22: "CRUMPET",
      23: "TRACEY",
      24: "YOOFOW",
      25: "OPEC",
      26: "CYMON",
      27: "SUCKER",
      28: "BUGLE",
      29: "DENNIS",
      30: "CHUCK",
      31: "HUBCHICKEN1",
      32: "FRANKIE2",
      33: "KLOSET",
      34: "WILLY",
      35: "JOFF",
      36: "CANCER",
      37: "KIRK",
      38: "ROBOT",
      39: "EVILROBOT",
      40: "SPANK",
      41: "BABYSPK2",
      42: "EVILGLOVE",
      43: "DIBBER",
      44: "BRUNDLE",
      45: "MALCOM",
      46: "SPOTTY",
      47: "GORDON",
      48: "SIDNEY",
      49: "WEEVIL",
      50: "CHOPSTIK",
      51: "BUTTERFLY",
      52: "SPIDER",
      53: "BAT",
      54: "FROG",
      55: "DRAGFLY",
      56: "BOXTHING",
      57: "BUG",
      58: "NMEFROG",
    });

    function Enemy(_io, _parent, _root) {
      this.__type = 'Enemy';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Enemy.prototype._read = function() {
      this._debug.type = { start: this._io.pos, ioOffset: this._io.byteOffset, enumName: "GloverLevel.Enemy.EnemyType" };
      this.type = this._io.readU2be();
      this._debug.type.end = this._io.pos;
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

  var PlatOrbitPause = GloverLevel.PlatOrbitPause = (function() {
    function PlatOrbitPause(_io, _parent, _root) {
      this.__type = 'PlatOrbitPause';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatOrbitPause.prototype._read = function() {
      this._debug.numFrames = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.numFrames = this._io.readU2be();
      this._debug.numFrames.end = this._io.pos;
      this._debug.numPauses = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.numPauses = this._io.readU2be();
      this._debug.numPauses.end = this._io.pos;
    }

    return PlatOrbitPause;
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
      this._debug.dynamicShadow = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.dynamicShadow = this._io.readU2be();
      this._debug.dynamicShadow.end = this._io.pos;
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
      this._debug.puzzleIdentifier0xd2 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.puzzleIdentifier0xd2 = this._io.readU2be();
      this._debug.puzzleIdentifier0xd2.end = this._io.pos;
      this._debug.initialState = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.initialState = this._io.readS2be();
      this._debug.initialState.end = this._io.pos;
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

  var AnimatedBackgroundActor = GloverLevel.AnimatedBackgroundActor = (function() {
    function AnimatedBackgroundActor(_io, _parent, _root) {
      this.__type = 'AnimatedBackgroundActor';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    AnimatedBackgroundActor.prototype._read = function() {
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

    return AnimatedBackgroundActor;
  })();

  var BackgroundActor = GloverLevel.BackgroundActor = (function() {
    function BackgroundActor(_io, _parent, _root) {
      this.__type = 'BackgroundActor';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    BackgroundActor.prototype._read = function() {
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

    return BackgroundActor;
  })();

  var EnemyInstructionMove = GloverLevel.EnemyInstructionMove = (function() {
    function EnemyInstructionMove(_io, _parent, _root) {
      this.__type = 'EnemyInstructionMove';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyInstructionMove.prototype._read = function() {
      this._debug.destinationX = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.destinationX = this._io.readF4be();
      this._debug.destinationX.end = this._io.pos;
      this._debug.destinationY = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.destinationY = this._io.readF4be();
      this._debug.destinationY.end = this._io.pos;
      this._debug.destinationZ = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.destinationZ = this._io.readF4be();
      this._debug.destinationZ.end = this._io.pos;
      this._debug.velMagnitude = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.velMagnitude = this._io.readF4be();
      this._debug.velMagnitude.end = this._io.pos;
    }

    return EnemyInstructionMove;
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

  var PlatRocking = GloverLevel.PlatRocking = (function() {
    function PlatRocking(_io, _parent, _root) {
      this.__type = 'PlatRocking';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatRocking.prototype._read = function() {
      this._debug.axis = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.axis = this._io.readU2be();
      this._debug.axis.end = this._io.pos;
      this._debug.theta = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.theta = this._io.readF4be();
      this._debug.theta.end = this._io.pos;
      this._debug.deceleration = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.deceleration = this._io.readF4be();
      this._debug.deceleration.end = this._io.pos;
      this._debug.blurHeight = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.blurHeight = this._io.readF4be();
      this._debug.blurHeight.end = this._io.pos;
      this._debug.frameAdvance = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.frameAdvance = this._io.readU2be();
      this._debug.frameAdvance.end = this._io.pos;
    }

    return PlatRocking;
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

  var GloverSpawnPoint = GloverLevel.GloverSpawnPoint = (function() {
    function GloverSpawnPoint(_io, _parent, _root) {
      this.__type = 'GloverSpawnPoint';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    GloverSpawnPoint.prototype._read = function() {
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

    return GloverSpawnPoint;
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

  var BuzzerDutyCycle = GloverLevel.BuzzerDutyCycle = (function() {
    function BuzzerDutyCycle(_io, _parent, _root) {
      this.__type = 'BuzzerDutyCycle';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    BuzzerDutyCycle.prototype._read = function() {
      this._debug.framesOff = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.framesOff = this._io.readU2be();
      this._debug.framesOff.end = this._io.pos;
      this._debug.framesOn = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.framesOn = this._io.readU2be();
      this._debug.framesOn.end = this._io.pos;
    }

    return BuzzerDutyCycle;
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

  var PlatPlayObjectAnimation = GloverLevel.PlatPlayObjectAnimation = (function() {
    function PlatPlayObjectAnimation(_io, _parent, _root) {
      this.__type = 'PlatPlayObjectAnimation';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatPlayObjectAnimation.prototype._read = function() {
    }

    return PlatPlayObjectAnimation;
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

  var EnemyInstructionPlayAnimation = GloverLevel.EnemyInstructionPlayAnimation = (function() {
    function EnemyInstructionPlayAnimation(_io, _parent, _root) {
      this.__type = 'EnemyInstructionPlayAnimation';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyInstructionPlayAnimation.prototype._read = function() {
      this._debug.animIdx1 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.animIdx1 = this._io.readS4be();
      this._debug.animIdx1.end = this._io.pos;
      this._debug.animIdx2 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.animIdx2 = this._io.readS4be();
      this._debug.animIdx2.end = this._io.pos;
    }

    return EnemyInstructionPlayAnimation;
  })();

  var EnemyInstructionRandomWalk = GloverLevel.EnemyInstructionRandomWalk = (function() {
    function EnemyInstructionRandomWalk(_io, _parent, _root) {
      this.__type = 'EnemyInstructionRandomWalk';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyInstructionRandomWalk.prototype._read = function() {
      this._debug.homeX = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.homeX = this._io.readF4be();
      this._debug.homeX.end = this._io.pos;
      this._debug.homeY = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.homeY = this._io.readF4be();
      this._debug.homeY.end = this._io.pos;
      this._debug.homeZ = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.homeZ = this._io.readF4be();
      this._debug.homeZ.end = this._io.pos;
      this._debug.extentX = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.extentX = this._io.readF4be();
      this._debug.extentX.end = this._io.pos;
      this._debug.extentY = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.extentY = this._io.readF4be();
      this._debug.extentY.end = this._io.pos;
      this._debug.extentZ = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.extentZ = this._io.readF4be();
      this._debug.extentZ.end = this._io.pos;
      this._debug.minTravelDistance = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.minTravelDistance = this._io.readF4be();
      this._debug.minTravelDistance.end = this._io.pos;
    }

    return EnemyInstructionRandomWalk;
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
    EnemyInstruction.ExecutionConditionType = Object.freeze({
      BALL_WITHIN_RANGE: 0,
      BALL_WITHIN_GROUND_RANGE: 1,
      GLOVER_WITHIN_RANGE: 2,
      GLOVER_WITHIN_GROUND_RANGE: 3,
      BALL_OR_GLOVER_WITHIN_RANGE: 4,
      BALL_OR_GLOVER_WITHIN_GROUND_RANGE: 5,
      BALL_WITHIN_ANGLE_OF_VIEW: 6,
      GLOVER_WITHIN_ANGLE_OF_VIEW: 7,
      BALL_OR_GLOVER_WITHIN_ANGLE_OF_VIEW: 8,
      PERIODIC: 9,
      ROLL_ANGLE_WITHIN_RANGE_AND_PERIODIC: 10,
      GLOVER_HOLDING_BALL: 11,
      GLOVER_NOT_HOLDING_BALL: 12,
      ENEMY_HOLDING_BALL: 13,
      ENEMY_NOT_HOLDING_BALL: 14,
      GLOVER_HOLDING_ENEMY: 15,
      GLOVER_NOT_HOLDING_ENEMY: 16,
      ON_BALL: 17,
      ON_GLOVER: 18,
      ENEMY_WITHIN_ATTENTION_BBOX: 19,
      ALWAYS: 20,
      NEVER: 21,
      RANDOM_CHANCE_PARAM_A_OVER_1000: 22,

      0: "BALL_WITHIN_RANGE",
      1: "BALL_WITHIN_GROUND_RANGE",
      2: "GLOVER_WITHIN_RANGE",
      3: "GLOVER_WITHIN_GROUND_RANGE",
      4: "BALL_OR_GLOVER_WITHIN_RANGE",
      5: "BALL_OR_GLOVER_WITHIN_GROUND_RANGE",
      6: "BALL_WITHIN_ANGLE_OF_VIEW",
      7: "GLOVER_WITHIN_ANGLE_OF_VIEW",
      8: "BALL_OR_GLOVER_WITHIN_ANGLE_OF_VIEW",
      9: "PERIODIC",
      10: "ROLL_ANGLE_WITHIN_RANGE_AND_PERIODIC",
      11: "GLOVER_HOLDING_BALL",
      12: "GLOVER_NOT_HOLDING_BALL",
      13: "ENEMY_HOLDING_BALL",
      14: "ENEMY_NOT_HOLDING_BALL",
      15: "GLOVER_HOLDING_ENEMY",
      16: "GLOVER_NOT_HOLDING_ENEMY",
      17: "ON_BALL",
      18: "ON_GLOVER",
      19: "ENEMY_WITHIN_ATTENTION_BBOX",
      20: "ALWAYS",
      21: "NEVER",
      22: "RANDOM_CHANCE_PARAM_A_OVER_1000",
    });

    EnemyInstruction.InstructionFlags = Object.freeze({
      FACE_PLAYER: 1048576,
      FACE_BALL: 2097152,
      FACE_CLOSER_OF_PLAYER_OR_BALL: 4194304,

      1048576: "FACE_PLAYER",
      2097152: "FACE_BALL",
      4194304: "FACE_CLOSER_OF_PLAYER_OR_BALL",
    });

    function EnemyInstruction(_io, _parent, _root) {
      this.__type = 'EnemyInstruction';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyInstruction.prototype._read = function() {
      this._debug.instrType = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.instrType = this._io.readU2be();
      this._debug.instrType.end = this._io.pos;
      this._debug.lifetime = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lifetime = this._io.readS2be();
      this._debug.lifetime.end = this._io.pos;
      this._debug.params = { start: this._io.pos, ioOffset: this._io.byteOffset };
      switch (this.instrType) {
      case 14:
        this.params = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 10:
        this.params = new EnemyInstructionA(this._io, this, this._root);
        break;
      case 17:
        this.params = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 0:
        this.params = new EnemyInstructionMove(this._io, this, this._root);
        break;
      case 4:
        this.params = new EnemyInstructionRest(this._io, this, this._root);
        break;
      case 24:
        this.params = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 6:
        this.params = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 20:
        this.params = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 7:
        this.params = new EnemyInstructionPlayAnimation(this._io, this, this._root);
        break;
      case 1:
        this.params = new EnemyInstructionDash(this._io, this, this._root);
        break;
      case 13:
        this.params = new EnemyInstructionA(this._io, this, this._root);
        break;
      case 11:
        this.params = new EnemyInstructionA(this._io, this, this._root);
        break;
      case 12:
        this.params = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 3:
        this.params = new EnemyInstructionRandomWalk(this._io, this, this._root);
        break;
      case 5:
        this.params = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 19:
        this.params = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 23:
        this.params = new EnemyInstructionA(this._io, this, this._root);
        break;
      case 15:
        this.params = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 8:
        this.params = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 9:
        this.params = new EnemyInstructionA(this._io, this, this._root);
        break;
      case 21:
        this.params = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 16:
        this.params = new EnemyInstructionC(this._io, this, this._root);
        break;
      case 18:
        this.params = new EnemyInstructionGoto(this._io, this, this._root);
        break;
      case 2:
        this.params = new EnemyInstructionTurn(this._io, this, this._root);
        break;
      case 22:
        this.params = new EnemyInstructionA(this._io, this, this._root);
        break;
      default:
        this.params = new EnemyInstructionError(this._io, this, this._root);
        break;
      }
      this._debug.params.end = this._io.pos;
      this._debug.executionConditionParamA = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.executionConditionParamA = this._io.readF4be();
      this._debug.executionConditionParamA.end = this._io.pos;
      this._debug.executionConditionParamB = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.executionConditionParamB = this._io.readF4be();
      this._debug.executionConditionParamB.end = this._io.pos;
      this._debug.flags = { start: this._io.pos, ioOffset: this._io.byteOffset, enumName: "GloverLevel.EnemyInstruction.InstructionFlags" };
      this.flags = this._io.readU4be();
      this._debug.flags.end = this._io.pos;
      this._debug.executionCondition = { start: this._io.pos, ioOffset: this._io.byteOffset, enumName: "GloverLevel.EnemyInstruction.ExecutionConditionType" };
      this.executionCondition = this._io.readU2be();
      this._debug.executionCondition.end = this._io.pos;
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

  var PlatOrbitAroundPoint = GloverLevel.PlatOrbitAroundPoint = (function() {
    function PlatOrbitAroundPoint(_io, _parent, _root) {
      this.__type = 'PlatOrbitAroundPoint';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatOrbitAroundPoint.prototype._read = function() {
      this._debug.axis = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.axis = this._io.readU2be();
      this._debug.axis.end = this._io.pos;
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
      this._debug.speed = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.speed = this._io.readF4be();
      this._debug.speed.end = this._io.pos;
    }

    return PlatOrbitAroundPoint;
  })();

  var Rope = GloverLevel.Rope = (function() {
    function Rope(_io, _parent, _root) {
      this.__type = 'Rope';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    Rope.prototype._read = function() {
      this._debug.numComponents = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.numComponents = this._io.readU4be();
      this._debug.numComponents.end = this._io.pos;
      this._debug.wiggleAxis = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.wiggleAxis = this._io.readU2be();
      this._debug.wiggleAxis.end = this._io.pos;
      this._debug.componentObjId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.componentObjId = this._io.readU4be();
      this._debug.componentObjId.end = this._io.pos;
      this._debug.name = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this._debug.name.end = this._io.pos;
      this._debug.puzzleUnknown1 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.puzzleUnknown1 = this._io.readF4be();
      this._debug.puzzleUnknown1.end = this._io.pos;
      this._debug.swayUnknown1 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.swayUnknown1 = this._io.readF4be();
      this._debug.swayUnknown1.end = this._io.pos;
      this._debug.swayUnknown2 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.swayUnknown2 = this._io.readF4be();
      this._debug.swayUnknown2.end = this._io.pos;
      this._debug.swayUnknown3 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.swayUnknown3 = this._io.readF4be();
      this._debug.swayUnknown3.end = this._io.pos;
      this._debug.swayRockingTheta = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.swayRockingTheta = this._io.readU4be();
      this._debug.swayRockingTheta.end = this._io.pos;
      this._debug.swayUnknown4 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.swayUnknown4 = this._io.readU4be();
      this._debug.swayUnknown4.end = this._io.pos;
      this._debug.swayUnknown5 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.swayUnknown5 = this._io.readF4be();
      this._debug.swayUnknown5.end = this._io.pos;
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
      this._debug.componentW = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.componentW = this._io.readF4be();
      this._debug.componentW.end = this._io.pos;
      this._debug.componentH = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.componentH = this._io.readF4be();
      this._debug.componentH.end = this._io.pos;
      this._debug.componentD = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.componentD = this._io.readF4be();
      this._debug.componentD.end = this._io.pos;
    }

    return Rope;
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

  var EnemyInstructionGoto = GloverLevel.EnemyInstructionGoto = (function() {
    function EnemyInstructionGoto(_io, _parent, _root) {
      this.__type = 'EnemyInstructionGoto';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemyInstructionGoto.prototype._read = function() {
      this._debug.instrIdx = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.instrIdx = this._io.readU4be();
      this._debug.instrIdx.end = this._io.pos;
      this._debug.unused = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.unused = this._io.readU4be();
      this._debug.unused.end = this._io.pos;
    }

    return EnemyInstructionGoto;
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

  var CameraSpawnPoint = GloverLevel.CameraSpawnPoint = (function() {
    function CameraSpawnPoint(_io, _parent, _root) {
      this.__type = 'CameraSpawnPoint';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    CameraSpawnPoint.prototype._read = function() {
      this._debug.x = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.x = this._io.readF4be();
      this._debug.x.end = this._io.pos;
      this._debug.y = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.y = this._io.readF4be();
      this._debug.y.end = this._io.pos;
      this._debug.z = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.z = this._io.readF4be();
      this._debug.z.end = this._io.pos;
      this._debug.pitch = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.pitch = this._io.readF4be();
      this._debug.pitch.end = this._io.pos;
      this._debug.yaw = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.yaw = this._io.readF4be();
      this._debug.yaw.end = this._io.pos;
    }

    return CameraSpawnPoint;
  })();

  var PlatSpinFlip = GloverLevel.PlatSpinFlip = (function() {
    function PlatSpinFlip(_io, _parent, _root) {
      this.__type = 'PlatSpinFlip';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    PlatSpinFlip.prototype._read = function() {
      this._debug.cooldownTimer = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.cooldownTimer = this._io.readU2be();
      this._debug.cooldownTimer.end = this._io.pos;
      this._debug.theta = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.theta = this._io.readF4be();
      this._debug.theta.end = this._io.pos;
    }

    return PlatSpinFlip;
  })();

  var EnemySetAttentionBbox = GloverLevel.EnemySetAttentionBbox = (function() {
    function EnemySetAttentionBbox(_io, _parent, _root) {
      this.__type = 'EnemySetAttentionBbox';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;
      this._debug = {};

      this._read();
    }
    EnemySetAttentionBbox.prototype._read = function() {
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
      this._debug.height = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.height = this._io.readF4be();
      this._debug.height.end = this._io.pos;
      this._debug.depth = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.depth = this._io.readF4be();
      this._debug.depth.end = this._io.pos;
    }

    return EnemySetAttentionBbox;
  })();

  return GloverLevel;
})();
return GloverLevel;
}));
