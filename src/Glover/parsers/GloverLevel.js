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

    this._read();
  }
  GloverLevel.prototype._read = function() {
    this.length = this._io.readU4be();
    this.name = KaitaiStream.bytesToStr(this._io.readBytesTerm(0, false, true, true), "ASCII");
    this.body = [];
    var i = 0;
    while (!this._io.isEof()) {
      this.body.push(new Cmd(this._io, this, this._root));
      i++;
    }
  }

  var PlatSpecial0x68 = GloverLevel.PlatSpecial0x68 = (function() {
    function PlatSpecial0x68(_io, _parent, _root) {
      this.__type = 'PlatSpecial0x68';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatSpecial0x68.prototype._read = function() {
      this.u320x5c = this._io.readU4be();
      this.u320x60 = this._io.readU4be();
      this.u320x65 = this._io.readU4be();
    }

    return PlatSpecial0x68;
  })();

  var PuzzleAction0x54 = GloverLevel.PuzzleAction0x54 = (function() {
    function PuzzleAction0x54(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x54';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleAction0x54.prototype._read = function() {
      this.u320x14 = this._io.readU2be();
      this.u320x16 = this._io.readU2be();
      this.u320x18 = this._io.readU2be();
      this.u320x1a = this._io.readU2be();
      this.u320x1c = this._io.readU2be();
      this.u320x1e = this._io.readU2be();
      this.u320x10 = this._io.readU2be();
      this.u160x0e = this._io.readU2be();
      this.u320x24 = this._io.readU4be();
      this.u320x28 = this._io.readU4be();
      this.u320x2c = this._io.readU4be();
      this.u160x0a = this._io.readU2be();
    }

    return PuzzleAction0x54;
  })();

  var PuzzleAction0x460x470x48 = GloverLevel.PuzzleAction0x460x470x48 = (function() {
    function PuzzleAction0x460x470x48(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x460x470x48';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleAction0x460x470x48.prototype._read = function() {
      this.u320x24 = this._io.readU4be();
      this.u160x0a = this._io.readU2be();
    }

    return PuzzleAction0x460x470x48;
  })();

  var PlatSound0xc2 = GloverLevel.PlatSound0xc2 = (function() {
    function PlatSound0xc2(_io, _parent, _root) {
      this.__type = 'PlatSound0xc2';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatSound0xc2.prototype._read = function() {
      this.soundId = this._io.readU2be();
      this.volume = this._io.readU2be();
      this.pitch = this._io.readU2be();
    }

    return PlatSound0xc2;
  })();

  var PlatSpinPause0x7c = GloverLevel.PlatSpinPause0x7c = (function() {
    function PlatSpinPause0x7c(_io, _parent, _root) {
      this.__type = 'PlatSpinPause0x7c';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatSpinPause0x7c.prototype._read = function() {
      this.u160x0c = this._io.readU2be();
      this.u160x0a = this._io.readU2be();
    }

    return PlatSpinPause0x7c;
  })();

  var PlatMagnet0x8b = GloverLevel.PlatMagnet0x8b = (function() {
    function PlatMagnet0x8b(_io, _parent, _root) {
      this.__type = 'PlatMagnet0x8b';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatMagnet0x8b.prototype._read = function() {
      this.u160x0c = this._io.readU2be();
      this.u320x48 = this._io.readU4be();
      this.u320x4c = this._io.readU4be();
      this.u320x50 = this._io.readU4be();
      this.u320x10 = this._io.readU4be();
      this.u320x14 = this._io.readU4be();
      this.u320x18 = this._io.readU4be();
      this.u320x1c = this._io.readU4be();
    }

    return PlatMagnet0x8b;
  })();

  var EnemyInstructionError = GloverLevel.EnemyInstructionError = (function() {
    function EnemyInstructionError(_io, _parent, _root) {
      this.__type = 'EnemyInstructionError';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    EnemyInstructionError.prototype._read = function() {
    }

    return EnemyInstructionError;
  })();

  var PlatAnimPhase0x5c = GloverLevel.PlatAnimPhase0x5c = (function() {
    function PlatAnimPhase0x5c(_io, _parent, _root) {
      this.__type = 'PlatAnimPhase0x5c';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatAnimPhase0x5c.prototype._read = function() {
      this.value = this._io.readU2be();
    }

    return PlatAnimPhase0x5c;
  })();

  var Backdrop = GloverLevel.Backdrop = (function() {
    function Backdrop(_io, _parent, _root) {
      this.__type = 'Backdrop';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Backdrop.prototype._read = function() {
      this.textureId = this._io.readU4be();
      this.h10x04 = this._io.readU2be();
      this.h10x06 = this._io.readU2be();
      this.h10x08 = this._io.readU2be();
      this.h20x0a = this._io.readU2be();
      this.h20x0c = this._io.readU2be();
      this.h20x0e = this._io.readU2be();
      this.h20x10 = this._io.readU2be();
      this.h20x12 = this._io.readU2be();
      this.h20x14 = this._io.readU2be();
      this.h20x16 = this._io.readU2be();
      this.mysteryDeref = this._io.readU2be();
    }

    return Backdrop;
  })();

  var DiffuseLight = GloverLevel.DiffuseLight = (function() {
    function DiffuseLight(_io, _parent, _root) {
      this.__type = 'DiffuseLight';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    DiffuseLight.prototype._read = function() {
      this.r = this._io.readU2be();
      this.g = this._io.readU2be();
      this.b = this._io.readU2be();
      this.theta1 = this._io.readF4be();
      this.theta2 = this._io.readF4be();
    }

    return DiffuseLight;
  })();

  var Buzzer = GloverLevel.Buzzer = (function() {
    function Buzzer(_io, _parent, _root) {
      this.__type = 'Buzzer';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Buzzer.prototype._read = function() {
      this.u160x2a = this._io.readU2be();
      this.tag0x24 = this._io.readU2be();
      this.tag0x20 = this._io.readU2be();
      this.u160x28 = this._io.readU2be();
      this.u80x2c = this._io.readU2be();
      this.u80x2d = this._io.readU2be();
      this.u80x2e = this._io.readU2be();
      this.u80x2f = this._io.readU2be();
      this.u320x08 = this._io.readU4be();
      this.u320x0c = this._io.readU4be();
      this.u320x10 = this._io.readU4be();
      this.u320x14 = this._io.readU4be();
      this.u320x18 = this._io.readU4be();
      this.u320x1c = this._io.readU4be();
      this.u320x50 = this._io.readU4be();
      this.u320x54 = this._io.readU4be();
    }

    return Buzzer;
  })();

  var PuzzleAny = GloverLevel.PuzzleAny = (function() {
    function PuzzleAny(_io, _parent, _root) {
      this.__type = 'PuzzleAny';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleAny.prototype._read = function() {
      this.op = this._io.readU2be();
    }

    return PuzzleAny;
  })();

  var SetActorRotation = GloverLevel.SetActorRotation = (function() {
    function SetActorRotation(_io, _parent, _root) {
      this.__type = 'SetActorRotation';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    SetActorRotation.prototype._read = function() {
      this.x = this._io.readF4be();
      this.y = this._io.readF4be();
      this.z = this._io.readF4be();
    }

    return SetActorRotation;
  })();

  var CameoInst = GloverLevel.CameoInst = (function() {
    function CameoInst(_io, _parent, _root) {
      this.__type = 'CameoInst';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    CameoInst.prototype._read = function() {
      this.instType = this._io.readU2be();
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
    }

    return CameoInst;
  })();

  var PlatMvspn0x5a = GloverLevel.PlatMvspn0x5a = (function() {
    function PlatMvspn0x5a(_io, _parent, _root) {
      this.__type = 'PlatMvspn0x5a';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatMvspn0x5a.prototype._read = function() {
      this.u160x1c = this._io.readU2be();
      this.u320x18 = this._io.readU4be();
    }

    return PlatMvspn0x5a;
  })();

  var PlatMvspn0x74 = GloverLevel.PlatMvspn0x74 = (function() {
    function PlatMvspn0x74(_io, _parent, _root) {
      this.__type = 'PlatMvspn0x74';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatMvspn0x74.prototype._read = function() {
      this.u320x34 = this._io.readU4be();
      this.u320x38 = this._io.readU4be();
      this.u320x3c = this._io.readU4be();
    }

    return PlatMvspn0x74;
  })();

  var PlatOrbit = GloverLevel.PlatOrbit = (function() {
    function PlatOrbit(_io, _parent, _root) {
      this.__type = 'PlatOrbit';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatOrbit.prototype._read = function() {
      this.u16120 = this._io.readU2be();
      this.u16136 = this._io.readU2be();
      this.u16134 = this._io.readU2be();
      this.u16132 = this._io.readU2be();
      this.u32116 = this._io.readU4be();
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this.f112 = this._io.readF4be();
      this.f108 = this._io.readF4be();
      this.f104 = this._io.readF4be();
      this.f100 = this._io.readF4be();
      this.f96 = this._io.readF4be();
      this.f92 = this._io.readF4be();
      this.f88 = this._io.readF4be();
      this.f84 = this._io.readF4be();
      this.f80 = this._io.readF4be();
      this.u32176 = this._io.readU4be();
    }

    return PlatOrbit;
  })();

  var PlatSpike = GloverLevel.PlatSpike = (function() {
    function PlatSpike(_io, _parent, _root) {
      this.__type = 'PlatSpike';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

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

      this._read();
    }
    PlatSpecial0x8e.prototype._read = function() {
      this.enable = this._io.readU2be();
    }

    return PlatSpecial0x8e;
  })();

  var Plat0x9f = GloverLevel.Plat0x9f = (function() {
    function Plat0x9f(_io, _parent, _root) {
      this.__type = 'Plat0x9f';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Plat0x9f.prototype._read = function() {
      this.u320x6c = this._io.readU4be();
      this.u320x70 = this._io.readU4be();
      this.u320x1c = this._io.readU4be();
      this.u320x28 = this._io.readU4be();
    }

    return Plat0x9f;
  })();

  var EnvironmentalSound = GloverLevel.EnvironmentalSound = (function() {
    function EnvironmentalSound(_io, _parent, _root) {
      this.__type = 'EnvironmentalSound';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    EnvironmentalSound.prototype._read = function() {
      this.soundId = this._io.readU2be();
      this.volume = this._io.readU2be();
      this.flags = this._io.readU2be();
      this.h0x06 = this._io.readU2be();
      this.h0x08 = this._io.readU2be();
      this.h0x0a = this._io.readU2be();
      this.h0x0c = this._io.readU2be();
      this.h0x0e = this._io.readU2be();
      this.x = this._io.readF4be();
      this.y = this._io.readF4be();
      this.z = this._io.readF4be();
      this.radius = this._io.readF4be();
    }

    return EnvironmentalSound;
  })();

  var EnemyInstructionB = GloverLevel.EnemyInstructionB = (function() {
    function EnemyInstructionB(_io, _parent, _root) {
      this.__type = 'EnemyInstructionB';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    EnemyInstructionB.prototype._read = function() {
      this.u320x02 = this._io.readU4be();
      this.u320x06 = this._io.readU4be();
      this.u320x0a = this._io.readU4be();
      this.u320x08 = this._io.readU4be();
      this.u320x0c = this._io.readU4be();
      this.u320x10 = this._io.readU4be();
      this.u320x0e = this._io.readU4be();
      this.u320x18 = this._io.readU4be();
      this.u320x1e = this._io.readU4be();
      this.u320x14 = this._io.readU4be();
      this.u320x16 = this._io.readU2be();
    }

    return EnemyInstructionB;
  })();

  var PlatMvspn0x59 = GloverLevel.PlatMvspn0x59 = (function() {
    function PlatMvspn0x59(_io, _parent, _root) {
      this.__type = 'PlatMvspn0x59';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatMvspn0x59.prototype._read = function() {
      this.u160x24 = this._io.readU2be();
      this.u320x20 = this._io.readU4be();
      this.u320x28 = this._io.readU4be();
      this.u320x2c = this._io.readU4be();
      this.u320x30 = this._io.readU4be();
    }

    return PlatMvspn0x59;
  })();

  var Cameo = GloverLevel.Cameo = (function() {
    function Cameo(_io, _parent, _root) {
      this.__type = 'Cameo';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

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

      this._read();
    }
    PlatSpinFlip0x7d.prototype._read = function() {
      this.u160x0a = this._io.readU2be();
      this.u320x14 = this._io.readU4be();
    }

    return PlatSpinFlip0x7d;
  })();

  var PlatRest0x63 = GloverLevel.PlatRest0x63 = (function() {
    function PlatRest0x63(_io, _parent, _root) {
      this.__type = 'PlatRest0x63';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatRest0x63.prototype._read = function() {
      this.u160x17 = this._io.readU2be();
      this.theta = this._io.readF4be();
    }

    return PlatRest0x63;
  })();

  var Plat0xc3 = GloverLevel.Plat0xc3 = (function() {
    function Plat0xc3(_io, _parent, _root) {
      this.__type = 'Plat0xc3';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Plat0xc3.prototype._read = function() {
      this.u160x86 = this._io.readU2be();
      this.u320x780x80 = this._io.readU2be();
      this.u160x84 = this._io.readU2be();
    }

    return Plat0xc3;
  })();

  var EndLevelData = GloverLevel.EndLevelData = (function() {
    function EndLevelData(_io, _parent, _root) {
      this.__type = 'EndLevelData';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

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

      this._read();
    }
    PlatFan0x8a.prototype._read = function() {
      this.u160x0c = this._io.readU2be();
      this.u320x48 = this._io.readU4be();
      this.u320x4c = this._io.readU4be();
      this.u320x50 = this._io.readU4be();
      this.u320x10 = this._io.readU4be();
      this.u320x14 = this._io.readU4be();
      this.u320x18 = this._io.readU4be();
      this.u320x1c = this._io.readU4be();
    }

    return PlatFan0x8a;
  })();

  var PlatSpinBlur0x70 = GloverLevel.PlatSpinBlur0x70 = (function() {
    function PlatSpinBlur0x70(_io, _parent, _root) {
      this.__type = 'PlatSpinBlur0x70';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatSpinBlur0x70.prototype._read = function() {
      this.idx = this._io.readU2be();
      this.u320x38 = this._io.readU4be();
      this.u320x18 = this._io.readU4be();
      this.fBlur0x578 = this._io.readF4be();
      this.count = this._io.readU2be();
    }

    return PlatSpinBlur0x70;
  })();

  var PlatSpinSound0xc5 = GloverLevel.PlatSpinSound0xc5 = (function() {
    function PlatSpinSound0xc5(_io, _parent, _root) {
      this.__type = 'PlatSpinSound0xc5';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatSpinSound0xc5.prototype._read = function() {
      this.soundId = this._io.readU2be();
      this.volume = this._io.readU2be();
      this.pitch = this._io.readU2be();
    }

    return PlatSpinSound0xc5;
  })();

  var PuzzleCondC = GloverLevel.PuzzleCondC = (function() {
    function PuzzleCondC(_io, _parent, _root) {
      this.__type = 'PuzzleCondC';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleCondC.prototype._read = function() {
      this.i0x00 = this._io.readU4be();
      this.i0x04 = this._io.readU4be();
      this.i0x08 = this._io.readU4be();
      this.i0x0c = this._io.readU4be();
      this.i0x10 = this._io.readU4be();
      this.i0x14 = this._io.readU4be();
    }

    return PuzzleCondC;
  })();

  var PlatSpin0x7f = GloverLevel.PlatSpin0x7f = (function() {
    function PlatSpin0x7f(_io, _parent, _root) {
      this.__type = 'PlatSpin0x7f';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatSpin0x7f.prototype._read = function() {
      this.axis = this._io.readU2be();
      this.initialTheta = this._io.readF4be();
      this.speed = this._io.readF4be();
    }

    return PlatSpin0x7f;
  })();

  var PuzzleAction0x4a = GloverLevel.PuzzleAction0x4a = (function() {
    function PuzzleAction0x4a(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x4a';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleAction0x4a.prototype._read = function() {
      this.u320x24 = this._io.readU4be();
      this.u320x240x0c = this._io.readU4be();
      this.u160x0a = this._io.readU2be();
    }

    return PuzzleAction0x4a;
  })();

  var EnemyConditionalInstruction = GloverLevel.EnemyConditionalInstruction = (function() {
    function EnemyConditionalInstruction(_io, _parent, _root) {
      this.__type = 'EnemyConditionalInstruction';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    EnemyConditionalInstruction.prototype._read = function() {
      this.instr = new EnemyInstruction(this._io, this, this._root);
    }

    return EnemyConditionalInstruction;
  })();

  var PlatPathPoint0x6b = GloverLevel.PlatPathPoint0x6b = (function() {
    function PlatPathPoint0x6b(_io, _parent, _root) {
      this.__type = 'PlatPathPoint0x6b';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatPathPoint0x6b.prototype._read = function() {
      this.frameId = this._io.readU2be();
      this.x = this._io.readF4be();
      this.y = this._io.readF4be();
      this.z = this._io.readF4be();
    }

    return PlatPathPoint0x6b;
  })();

  var Enemy0xa1 = GloverLevel.Enemy0xa1 = (function() {
    function Enemy0xa1(_io, _parent, _root) {
      this.__type = 'Enemy0xa1';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Enemy0xa1.prototype._read = function() {
      this.u321 = this._io.readU4be();
      this.u322 = this._io.readU4be();
      this.u323 = this._io.readU4be();
      this.u324 = this._io.readU4be();
      this.u325 = this._io.readU4be();
      this.u326 = this._io.readU4be();
    }

    return Enemy0xa1;
  })();

  var Vent = GloverLevel.Vent = (function() {
    function Vent(_io, _parent, _root) {
      this.__type = 'Vent';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Vent.prototype._read = function() {
      this.u160x08 = this._io.readU2be();
      this.u160x0a = this._io.readU2be();
      this.tag = this._io.readU2be();
      this.f0x38 = this._io.readF4be();
      this.f0x3c = this._io.readF4be();
      this.f0x40 = this._io.readF4be();
      this.f0x2c = this._io.readF4be();
      this.f0x30 = this._io.readF4be();
      this.f0x34 = this._io.readF4be();
    }

    return Vent;
  })();

  var PuzzleCond = GloverLevel.PuzzleCond = (function() {
    function PuzzleCond(_io, _parent, _root) {
      this.__type = 'PuzzleCond';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleCond.prototype._read = function() {
      this.condType = this._io.readU2be();
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
    }

    return PuzzleCond;
  })();

  var PlatMvspn0x73 = GloverLevel.PlatMvspn0x73 = (function() {
    function PlatMvspn0x73(_io, _parent, _root) {
      this.__type = 'PlatMvspn0x73';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatMvspn0x73.prototype._read = function() {
      this.u160x0c = this._io.readU2be();
      this.u320x34 = this._io.readU4be();
      this.u320x38 = this._io.readU4be();
      this.u320x3c = this._io.readU4be();
    }

    return PlatMvspn0x73;
  })();

  var LookAtBall0x61 = GloverLevel.LookAtBall0x61 = (function() {
    function LookAtBall0x61(_io, _parent, _root) {
      this.__type = 'LookAtBall0x61';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    LookAtBall0x61.prototype._read = function() {
      this.u320x6c = this._io.readU4be();
      this.u320x1c = this._io.readU4be();
    }

    return LookAtBall0x61;
  })();

  var LookAtHand0x60 = GloverLevel.LookAtHand0x60 = (function() {
    function LookAtHand0x60(_io, _parent, _root) {
      this.__type = 'LookAtHand0x60';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    LookAtHand0x60.prototype._read = function() {
      this.u320x6c = this._io.readU4be();
      this.u320x1c = this._io.readU4be();
    }

    return LookAtHand0x60;
  })();

  var CameoInst2 = GloverLevel.CameoInst2 = (function() {
    function CameoInst2(_io, _parent, _root) {
      this.__type = 'CameoInst2';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    CameoInst2.prototype._read = function() {
      this.h0x00 = this._io.readU2be();
      this.i0x02 = this._io.readU4be();
      this.i0x06 = this._io.readU4be();
      this.i0x0a = this._io.readU4be();
      this.i0x0e = this._io.readU4be();
      this.h0x12 = this._io.readU2be();
      this.h0x14 = this._io.readU2be();
    }

    return CameoInst2;
  })();

  var Unknown0xa9 = GloverLevel.Unknown0xa9 = (function() {
    function Unknown0xa9(_io, _parent, _root) {
      this.__type = 'Unknown0xa9';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Unknown0xa9.prototype._read = function() {
      this.i0x00 = this._io.readU4be();
    }

    return Unknown0xa9;
  })();

  var Plat0x6c = GloverLevel.Plat0x6c = (function() {
    function Plat0x6c(_io, _parent, _root) {
      this.__type = 'Plat0x6c';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Plat0x6c.prototype._read = function() {
      this.f0x1c = this._io.readF4be();
    }

    return Plat0x6c;
  })();

  var PlatPathSpeed0x6d = GloverLevel.PlatPathSpeed0x6d = (function() {
    function PlatPathSpeed0x6d(_io, _parent, _root) {
      this.__type = 'PlatPathSpeed0x6d';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatPathSpeed0x6d.prototype._read = function() {
      this.speed = this._io.readF4be();
    }

    return PlatPathSpeed0x6d;
  })();

  var SetExit = GloverLevel.SetExit = (function() {
    function SetExit(_io, _parent, _root) {
      this.__type = 'SetExit';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    SetExit.prototype._read = function() {
      this.behaviorU160x40 = this._io.readU2be();
      this.visible = this._io.readU2be();
    }

    return SetExit;
  })();

  var PlatOrbit0x75 = GloverLevel.PlatOrbit0x75 = (function() {
    function PlatOrbit0x75(_io, _parent, _root) {
      this.__type = 'PlatOrbit0x75';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatOrbit0x75.prototype._read = function() {
      this.idx = this._io.readU2be();
      this.u320x18 = this._io.readU4be();
      this.u320x1c = this._io.readU4be();
      this.u320x20 = this._io.readU4be();
      this.u320x28 = this._io.readU4be();
    }

    return PlatOrbit0x75;
  })();

  var PlatSound0xc1 = GloverLevel.PlatSound0xc1 = (function() {
    function PlatSound0xc1(_io, _parent, _root) {
      this.__type = 'PlatSound0xc1';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatSound0xc1.prototype._read = function() {
      this.soundId = this._io.readU2be();
      this.volume = this._io.readU2be();
      this.pitch = this._io.readU2be();
    }

    return PlatSound0xc1;
  })();

  var EnemyInstructionC = GloverLevel.EnemyInstructionC = (function() {
    function EnemyInstructionC(_io, _parent, _root) {
      this.__type = 'EnemyInstructionC';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    EnemyInstructionC.prototype._read = function() {
      this.u320x02 = this._io.readU4be();
      this.u320x0e = this._io.readU4be();
      this.u320x18 = this._io.readU4be();
      this.u320x1e = this._io.readU4be();
      this.u320x14 = this._io.readU4be();
      this.u320x16 = this._io.readU2be();
    }

    return EnemyInstructionC;
  })();

  var PuzzleAnd = GloverLevel.PuzzleAnd = (function() {
    function PuzzleAnd(_io, _parent, _root) {
      this.__type = 'PuzzleAnd';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

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

      this._read();
    }
    Plat0x66.prototype._read = function() {
    }

    return Plat0x66;
  })();

  var PlatPos0xa6 = GloverLevel.PlatPos0xa6 = (function() {
    function PlatPos0xa6(_io, _parent, _root) {
      this.__type = 'PlatPos0xa6';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatPos0xa6.prototype._read = function() {
      this.x = this._io.readF4be();
      this.y = this._io.readF4be();
      this.z = this._io.readF4be();
    }

    return PlatPos0xa6;
  })();

  var PlatSpecial0xc7 = GloverLevel.PlatSpecial0xc7 = (function() {
    function PlatSpecial0xc7(_io, _parent, _root) {
      this.__type = 'PlatSpecial0xc7';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatSpecial0xc7.prototype._read = function() {
      this.u160x2a = this._io.readU2be();
      this.u160x1cAnd0x24 = this._io.readU2be();
      this.u160x28 = this._io.readU2be();
    }

    return PlatSpecial0xc7;
  })();

  var Powerup = GloverLevel.Powerup = (function() {
    function Powerup(_io, _parent, _root) {
      this.__type = 'Powerup';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Powerup.prototype._read = function() {
      this.u160x00 = this._io.readU2be();
      this.u160x02 = this._io.readU2be();
      this.u160x04 = this._io.readU2be();
      this.f0x06 = this._io.readF4be();
      this.f0x0a = this._io.readF4be();
      this.f0x0e = this._io.readF4be();
    }

    return Powerup;
  })();

  var SetTeleport = GloverLevel.SetTeleport = (function() {
    function SetTeleport(_io, _parent, _root) {
      this.__type = 'SetTeleport';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    SetTeleport.prototype._read = function() {
      this.targetTag = this._io.readU2be();
      this.u160x0c = this._io.readU2be();
      this.u160x10 = this._io.readU2be();
      this.u160x12 = this._io.readU2be();
      this.u320x00 = this._io.readU4be();
      this.u320x04 = this._io.readU4be();
      this.u320x08 = this._io.readU4be();
    }

    return SetTeleport;
  })();

  var PuzzleCondD = GloverLevel.PuzzleCondD = (function() {
    function PuzzleCondD(_io, _parent, _root) {
      this.__type = 'PuzzleCondD';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleCondD.prototype._read = function() {
      this.i0x00 = this._io.readU4be();
      this.i0x04 = this._io.readU4be();
      this.i0x08 = this._io.readU4be();
      this.i0x0c = this._io.readU4be();
    }

    return PuzzleCondD;
  })();

  var VentAppend0xa3 = GloverLevel.VentAppend0xa3 = (function() {
    function VentAppend0xa3(_io, _parent, _root) {
      this.__type = 'VentAppend0xa3';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    VentAppend0xa3.prototype._read = function() {
      this.u16IdxPlus0x10 = this._io.readU2be();
      this.u16IdxPlus0x1c = this._io.readU2be();
    }

    return VentAppend0xa3;
  })();

  var UnknownSound0xbd = GloverLevel.UnknownSound0xbd = (function() {
    function UnknownSound0xbd(_io, _parent, _root) {
      this.__type = 'UnknownSound0xbd';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    UnknownSound0xbd.prototype._read = function() {
      this.h0x00 = this._io.readU2be();
      this.h0x02 = this._io.readU2be();
      this.h0x04 = this._io.readU2be();
    }

    return UnknownSound0xbd;
  })();

  var Plat0x5d = GloverLevel.Plat0x5d = (function() {
    function Plat0x5d(_io, _parent, _root) {
      this.__type = 'Plat0x5d';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Plat0x5d.prototype._read = function() {
    }

    return Plat0x5d;
  })();

  var PlatCheckpoint = GloverLevel.PlatCheckpoint = (function() {
    function PlatCheckpoint(_io, _parent, _root) {
      this.__type = 'PlatCheckpoint';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

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

      this._read();
    }
    CameoInst4.prototype._read = function() {
      this.h0x00 = this._io.readU2be();
      this.h0x02 = this._io.readU2be();
      this.h0x04 = this._io.readU2be();
      this.h0x06 = this._io.readU2be();
      this.h0x08 = this._io.readU2be();
    }

    return CameoInst4;
  })();

  var BallSpawnPoint = GloverLevel.BallSpawnPoint = (function() {
    function BallSpawnPoint(_io, _parent, _root) {
      this.__type = 'BallSpawnPoint';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    BallSpawnPoint.prototype._read = function() {
      this.h0x00 = this._io.readU2be();
      this.x = this._io.readF4be();
      this.y = this._io.readF4be();
      this.z = this._io.readF4be();
    }

    return BallSpawnPoint;
  })();

  var Unknown0x01 = GloverLevel.Unknown0x01 = (function() {
    function Unknown0x01(_io, _parent, _root) {
      this.__type = 'Unknown0x01';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Unknown0x01.prototype._read = function() {
      this.f0x00 = this._io.readF4be();
      this.f0x04 = this._io.readF4be();
      this.f0x08 = this._io.readF4be();
    }

    return Unknown0x01;
  })();

  var PlatAnim0xc0 = GloverLevel.PlatAnim0xc0 = (function() {
    function PlatAnim0xc0(_io, _parent, _root) {
      this.__type = 'PlatAnim0xc0';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatAnim0xc0.prototype._read = function() {
    }

    return PlatAnim0xc0;
  })();

  var PuzzleOr = GloverLevel.PuzzleOr = (function() {
    function PuzzleOr(_io, _parent, _root) {
      this.__type = 'PuzzleOr';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

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

      this._read();
    }
    PuzzleAction0x56.prototype._read = function() {
      this.u320x14 = this._io.readU4be();
      this.u320x18 = this._io.readU4be();
      this.u160x1c = this._io.readU2be();
      this.u160x0a = this._io.readU2be();
    }

    return PuzzleAction0x56;
  })();

  var Cmd = GloverLevel.Cmd = (function() {
    function Cmd(_io, _parent, _root) {
      this.__type = 'Cmd';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Cmd.prototype._read = function() {
      this.typeCode = this._io.readU2be();
      switch (this.typeCode) {
      case 120:
        this.params = new Plat0x78(this._io, this, this._root);
        break;
      case 141:
        this.params = new PlatRope(this._io, this, this._root);
        break;
      case 93:
        this.params = new Plat0x5d(this._io, this, this._root);
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
        this.params = new PlatMvspnSetparent(this._io, this, this._root);
        break;
      case 121:
        this.params = new PlatScale0x79(this._io, this, this._root);
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
        this.params = new PlatOrActor0x6a(this._io, this, this._root);
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
        this.params = new PlatPathPoint0x6b(this._io, this, this._root);
        break;
      case 143:
        this.params = new PlatOrbit(this._io, this, this._root);
        break;
      case 89:
        this.params = new PlatMvspn0x59(this._io, this, this._root);
        break;
      case 104:
        this.params = new PlatSpecial0x68(this._io, this, this._root);
        break;
      case 98:
        this.params = new Platform0x62(this._io, this, this._root);
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
        this.params = new PlatPos0xa6(this._io, this, this._root);
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
        this.params = new Unknown0x98(this._io, this, this._root);
        break;
      case 109:
        this.params = new PlatPathSpeed0x6d(this._io, this, this._root);
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
        this.params = new Render0xb3(this._io, this, this._root);
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
        this.params = new Plat0x6c(this._io, this, this._root);
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
        this.params = new PlatAnimPhase0x5c(this._io, this, this._root);
        break;
      case 198:
        this.params = new Plat0xc6(this._io, this, this._root);
        break;
      case 111:
        this.params = new PlatPuzzle0x6f(this._io, this, this._root);
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
    }

    return Cmd;
  })();

  var Plat0xc6 = GloverLevel.Plat0xc6 = (function() {
    function Plat0xc6(_io, _parent, _root) {
      this.__type = 'Plat0xc6';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Plat0xc6.prototype._read = function() {
      this.u160x4a = this._io.readU2be();
      this.u160x44 = this._io.readU2be();
      this.u160x48 = this._io.readU2be();
    }

    return Plat0xc6;
  })();

  var Wind = GloverLevel.Wind = (function() {
    function Wind(_io, _parent, _root) {
      this.__type = 'Wind';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Wind.prototype._read = function() {
      this.i0x00 = this._io.readU4be();
      this.i0x04 = this._io.readU4be();
      this.i0x08 = this._io.readU4be();
      this.i0x0c = this._io.readU4be();
      this.i0x10 = this._io.readU4be();
      this.i0x14 = this._io.readU4be();
      this.i0x18 = this._io.readU4be();
      this.i0x1c = this._io.readU4be();
      this.i0x20 = this._io.readU4be();
      this.i0x28 = this._io.readU4be();
      this.i0x2c = this._io.readU4be();
      this.i0x24 = this._io.readU4be();
      this.i0x30 = this._io.readU4be();
    }

    return Wind;
  })();

  var Puzzle = GloverLevel.Puzzle = (function() {
    function Puzzle(_io, _parent, _root) {
      this.__type = 'Puzzle';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

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

      this._read();
    }
    PlatPush0x5b.prototype._read = function() {
      this.flags = this._io.readU2be();
      this.u320x04 = this._io.readU4be();
      this.actorF0x70 = this._io.readF4be();
      this.u320x1c = this._io.readU4be();
    }

    return PlatPush0x5b;
  })();

  var PlatMvspn0x58 = GloverLevel.PlatMvspn0x58 = (function() {
    function PlatMvspn0x58(_io, _parent, _root) {
      this.__type = 'PlatMvspn0x58';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatMvspn0x58.prototype._read = function() {
      this.u160x14 = this._io.readU2be();
      this.u320x10 = this._io.readU4be();
    }

    return PlatMvspn0x58;
  })();

  var PlatDestructible = GloverLevel.PlatDestructible = (function() {
    function PlatDestructible(_io, _parent, _root) {
      this.__type = 'PlatDestructible';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatDestructible.prototype._read = function() {
      this.flags = this._io.readU2be();
      this.nParticles = this._io.readU4be();
      this.particleObjectId = this._io.readU4be();
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
    }

    return PlatDestructible;
  })();

  var PuzzleAction = GloverLevel.PuzzleAction = (function() {
    function PuzzleAction(_io, _parent, _root) {
      this.__type = 'PuzzleAction';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleAction.prototype._read = function() {
      this.actionType = this._io.readU2be();
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
    }

    return PuzzleAction;
  })();

  var Plat0xc4 = GloverLevel.Plat0xc4 = (function() {
    function Plat0xc4(_io, _parent, _root) {
      this.__type = 'Plat0xc4';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Plat0xc4.prototype._read = function() {
      this.u160x3a = this._io.readU2be();
      this.u160x2cAnd0x34 = this._io.readU2be();
      this.u160x38 = this._io.readU2be();
    }

    return Plat0xc4;
  })();

  var Water = GloverLevel.Water = (function() {
    function Water(_io, _parent, _root) {
      this.__type = 'Water';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Water.prototype._read = function() {
      this.left = this._io.readF4be();
      this.top = this._io.readF4be();
      this.front = this._io.readF4be();
      this.width = this._io.readF4be();
      this.bottom = this._io.readF4be();
      this.depth = this._io.readF4be();
      this.surfaceY = this._io.readF4be();
      this.currentX = this._io.readF4be();
      this.currentZ = this._io.readF4be();
      this.unknown1 = this._io.readU2be();
      this.objectId = this._io.readU4be();
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this.x = this._io.readF4be();
      this.y = this._io.readF4be();
      this.z = this._io.readF4be();
    }

    return Water;
  })();

  var PuzzleAction0x4f = GloverLevel.PuzzleAction0x4f = (function() {
    function PuzzleAction0x4f(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x4f';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleAction0x4f.prototype._read = function() {
      this.u320x14 = this._io.readU4be();
      this.u320x18 = this._io.readU4be();
      this.u320x10 = this._io.readU4be();
      this.u160x0e = this._io.readU2be();
      this.u160x0a = this._io.readU2be();
      this.u320x20 = this._io.readU4be();
    }

    return PuzzleAction0x4f;
  })();

  var Unrecognized = GloverLevel.Unrecognized = (function() {
    function Unrecognized(_io, _parent, _root) {
      this.__type = 'Unrecognized';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Unrecognized.prototype._read = function() {
    }

    return Unrecognized;
  })();

  var Unknown0xbf = GloverLevel.Unknown0xbf = (function() {
    function Unknown0xbf(_io, _parent, _root) {
      this.__type = 'Unknown0xbf';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Unknown0xbf.prototype._read = function() {
      this.mode = this._io.readU2be();
      this.i0x02 = this._io.readU4be();
    }

    return Unknown0xbf;
  })();

  var PuzzleAction0x4b0x4c = GloverLevel.PuzzleAction0x4b0x4c = (function() {
    function PuzzleAction0x4b0x4c(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x4b0x4c';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleAction0x4b0x4c.prototype._read = function() {
      this.u160x0a = this._io.readU2be();
    }

    return PuzzleAction0x4b0x4c;
  })();

  var SetActorScale = GloverLevel.SetActorScale = (function() {
    function SetActorScale(_io, _parent, _root) {
      this.__type = 'SetActorScale';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    SetActorScale.prototype._read = function() {
      this.x = this._io.readF4be();
      this.y = this._io.readF4be();
      this.z = this._io.readF4be();
    }

    return SetActorScale;
  })();

  var PlatSpecial0xb8 = GloverLevel.PlatSpecial0xb8 = (function() {
    function PlatSpecial0xb8(_io, _parent, _root) {
      this.__type = 'PlatSpecial0xb8';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

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

      this._read();
    }
    PlatOrbitFlip0x77.prototype._read = function() {
      this.u160x08 = this._io.readU2be();
      this.u160x10 = this._io.readU2be();
    }

    return PlatOrbitFlip0x77;
  })();

  var PlatDestructibleSound = GloverLevel.PlatDestructibleSound = (function() {
    function PlatDestructibleSound(_io, _parent, _root) {
      this.__type = 'PlatDestructibleSound';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatDestructibleSound.prototype._read = function() {
      this.soundId = this._io.readU2be();
      this.volume = this._io.readU2be();
      this.pitch = this._io.readU2be();
    }

    return PlatDestructibleSound;
  })();

  var Enemy = GloverLevel.Enemy = (function() {
    function Enemy(_io, _parent, _root) {
      this.__type = 'Enemy';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Enemy.prototype._read = function() {
      this.enemyType = this._io.readU2be();
      this.u1 = this._io.readU2be();
      this.x = this._io.readF4be();
      this.y = this._io.readF4be();
      this.z = this._io.readF4be();
      this.yRotation = this._io.readF4be();
    }

    return Enemy;
  })();

  var PlatPuzzle0x6f = GloverLevel.PlatPuzzle0x6f = (function() {
    function PlatPuzzle0x6f(_io, _parent, _root) {
      this.__type = 'PlatPuzzle0x6f';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatPuzzle0x6f.prototype._read = function() {
      this.tag = this._io.readU2be();
    }

    return PlatPuzzle0x6f;
  })();

  var Plat0xa4 = GloverLevel.Plat0xa4 = (function() {
    function Plat0xa4(_io, _parent, _root) {
      this.__type = 'Plat0xa4';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Plat0xa4.prototype._read = function() {
    }

    return Plat0xa4;
  })();

  var PlatOrActor0x6a = GloverLevel.PlatOrActor0x6a = (function() {
    function PlatOrActor0x6a(_io, _parent, _root) {
      this.__type = 'PlatOrActor0x6a';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatOrActor0x6a.prototype._read = function() {
      this.value = this._io.readU2be();
    }

    return PlatOrActor0x6a;
  })();

  var PlatSpin0x7b = GloverLevel.PlatSpin0x7b = (function() {
    function PlatSpin0x7b(_io, _parent, _root) {
      this.__type = 'PlatSpin0x7b';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

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

      this._read();
    }
    PlatSpecial0xb6.prototype._read = function() {
      this.u160x34 = this._io.readU2be();
      this.u160x40 = this._io.readU2be();
    }

    return PlatSpecial0xb6;
  })();

  var PlatCrumb0x67 = GloverLevel.PlatCrumb0x67 = (function() {
    function PlatCrumb0x67(_io, _parent, _root) {
      this.__type = 'PlatCrumb0x67';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatCrumb0x67.prototype._read = function() {
      this.u160x02 = this._io.readU2be();
      this.u160x04 = this._io.readU2be();
      this.u160x08 = this._io.readU4be();
    }

    return PlatCrumb0x67;
  })();

  var PuzzleActionDefault = GloverLevel.PuzzleActionDefault = (function() {
    function PuzzleActionDefault(_io, _parent, _root) {
      this.__type = 'PuzzleActionDefault';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleActionDefault.prototype._read = function() {
      this.u320x10 = this._io.readU4be();
      this.u160x0e = this._io.readU2be();
      this.u160x0a = this._io.readU2be();
      this.u320x20 = this._io.readU4be();
    }

    return PuzzleActionDefault;
  })();

  var Garib = GloverLevel.Garib = (function() {
    function Garib(_io, _parent, _root) {
      this.__type = 'Garib';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Garib.prototype._read = function() {
      this.x = this._io.readF4be();
      this.y = this._io.readF4be();
      this.z = this._io.readF4be();
      this.u80x0e = this._io.readU2be();
      this.u80x0f = this._io.readU2be();
    }

    return Garib;
  })();

  var GaribGroup = GloverLevel.GaribGroup = (function() {
    function GaribGroup(_io, _parent, _root) {
      this.__type = 'GaribGroup';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    GaribGroup.prototype._read = function() {
      this.u160xd2 = this._io.readU2be();
      this.u80xd1 = this._io.readU2be();
    }

    return GaribGroup;
  })();

  var CameoInst6 = GloverLevel.CameoInst6 = (function() {
    function CameoInst6(_io, _parent, _root) {
      this.__type = 'CameoInst6';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    CameoInst6.prototype._read = function() {
      this.h0x00 = this._io.readU2be();
      this.h0x02 = this._io.readU2be();
      this.h0x04 = this._io.readU2be();
      this.h0x06 = this._io.readU2be();
    }

    return CameoInst6;
  })();

  var Plat0x78 = GloverLevel.Plat0x78 = (function() {
    function Plat0x78(_io, _parent, _root) {
      this.__type = 'Plat0x78';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Plat0x78.prototype._read = function() {
      this.u160x08 = this._io.readU2be();
    }

    return Plat0x78;
  })();

  var BackgroundActor0x91 = GloverLevel.BackgroundActor0x91 = (function() {
    function BackgroundActor0x91(_io, _parent, _root) {
      this.__type = 'BackgroundActor0x91';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    BackgroundActor0x91.prototype._read = function() {
      this.objectId = this._io.readU4be();
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this.x = this._io.readF4be();
      this.y = this._io.readF4be();
      this.z = this._io.readF4be();
    }

    return BackgroundActor0x91;
  })();

  var Enemy0xba = GloverLevel.Enemy0xba = (function() {
    function Enemy0xba(_io, _parent, _root) {
      this.__type = 'Enemy0xba';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

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

      this._read();
    }
    PuzzleCondA.prototype._read = function() {
      this.u320x24 = this._io.readU2be();
      this.u160x0a = this._io.readU2be();
    }

    return PuzzleCondA;
  })();

  var PlatSine = GloverLevel.PlatSine = (function() {
    function PlatSine(_io, _parent, _root) {
      this.__type = 'PlatSine';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatSine.prototype._read = function() {
      this.u32Count = this._io.readU4be();
      this.u32116 = this._io.readU4be();
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this.f108 = this._io.readF4be();
      this.f104 = this._io.readF4be();
      this.f100 = this._io.readF4be();
      this.f96 = this._io.readF4be();
      this.f92 = this._io.readF4be();
      this.f88 = this._io.readF4be();
      this.f84 = this._io.readF4be();
      this.f80 = this._io.readF4be();
      this.u32176 = this._io.readU4be();
      this.u32172 = this._io.readU4be();
    }

    return PlatSine;
  })();

  var PlatCat0x69 = GloverLevel.PlatCat0x69 = (function() {
    function PlatCat0x69(_io, _parent, _root) {
      this.__type = 'PlatCat0x69';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatCat0x69.prototype._read = function() {
      this.u160x20 = this._io.readU2be();
      this.u320x00 = this._io.readU4be();
      this.u320x04 = this._io.readU4be();
      this.u320x08 = this._io.readU4be();
      this.u320x0c = this._io.readU4be();
      this.u320x10 = this._io.readU4be();
      this.u320x1c = this._io.readU4be();
    }

    return PlatCat0x69;
  })();

  var PlatRope = GloverLevel.PlatRope = (function() {
    function PlatRope(_io, _parent, _root) {
      this.__type = 'PlatRope';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatRope.prototype._read = function() {
      this.u32Count = this._io.readU4be();
      this.u16Idx = this._io.readU2be();
      this.u32U1 = this._io.readU4be();
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this.ustack1760 = this._io.readU4be();
      this.ustack1761 = this._io.readU4be();
      this.ustack1762 = this._io.readU4be();
      this.ustack1763 = this._io.readU4be();
      this.ustack1764 = this._io.readU4be();
      this.ustack1765 = this._io.readU4be();
      this.ustack1766 = this._io.readU4be();
      this.f112 = this._io.readF4be();
      this.f108 = this._io.readF4be();
      this.f104 = this._io.readF4be();
      this.f100 = this._io.readF4be();
      this.f96 = this._io.readF4be();
      this.f92 = this._io.readF4be();
    }

    return PlatRope;
  })();

  var PuzzleNumtimes = GloverLevel.PuzzleNumtimes = (function() {
    function PuzzleNumtimes(_io, _parent, _root) {
      this.__type = 'PuzzleNumtimes';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleNumtimes.prototype._read = function() {
      this.n = this._io.readU2be();
    }

    return PuzzleNumtimes;
  })();

  var PlatSpin0x80 = GloverLevel.PlatSpin0x80 = (function() {
    function PlatSpin0x80(_io, _parent, _root) {
      this.__type = 'PlatSpin0x80';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatSpin0x80.prototype._read = function() {
      this.idx = this._io.readU2be();
      this.f0x1c = this._io.readF4be();
      this.u320x28 = this._io.readU4be();
      this.u32Ustack56 = this._io.readU4be();
      this.u320x2c = this._io.readU4be();
      this.f0x6c = this._io.readF4be();
      this.f0x70 = this._io.readU2be();
    }

    return PlatSpin0x80;
  })();

  var Plat0x7e = GloverLevel.Plat0x7e = (function() {
    function Plat0x7e(_io, _parent, _root) {
      this.__type = 'Plat0x7e';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Plat0x7e.prototype._read = function() {
      this.u320x28 = this._io.readU4be();
    }

    return Plat0x7e;
  })();

  var Unknown0x98 = GloverLevel.Unknown0x98 = (function() {
    function Unknown0x98(_io, _parent, _root) {
      this.__type = 'Unknown0x98';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Unknown0x98.prototype._read = function() {
      this.h0x00 = this._io.readU2be();
      this.h0x02 = this._io.readU2be();
      this.h0x04 = this._io.readU2be();
    }

    return Unknown0x98;
  })();

  var CameoInst1 = GloverLevel.CameoInst1 = (function() {
    function CameoInst1(_io, _parent, _root) {
      this.__type = 'CameoInst1';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    CameoInst1.prototype._read = function() {
      this.h0x00 = this._io.readU2be();
      this.i0x02 = this._io.readU4be();
      this.i0x06 = this._io.readU4be();
      this.i0x0a = this._io.readU4be();
      this.h0x0e = this._io.readU2be();
      this.h0x10 = this._io.readU2be();
    }

    return CameoInst1;
  })();

  var Plat0x9d = GloverLevel.Plat0x9d = (function() {
    function Plat0x9d(_io, _parent, _root) {
      this.__type = 'Plat0x9d';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

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

      this._read();
    }
    EnemyNormalInstruction.prototype._read = function() {
      this.instr = new EnemyInstruction(this._io, this, this._root);
    }

    return EnemyNormalInstruction;
  })();

  var FogConfiguration = GloverLevel.FogConfiguration = (function() {
    function FogConfiguration(_io, _parent, _root) {
      this.__type = 'FogConfiguration';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    FogConfiguration.prototype._read = function() {
      this.fogEnabled = this._io.readU1();
      this.r = this._io.readU1();
      this.g = this._io.readU1();
      this.b = this._io.readU1();
      this.fogDistance = this._io.readU2be();
      this.nearClip = this._io.readU2be();
    }

    return FogConfiguration;
  })();

  var Platform0x62 = GloverLevel.Platform0x62 = (function() {
    function Platform0x62(_io, _parent, _root) {
      this.__type = 'Platform0x62';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Platform0x62.prototype._read = function() {
      this.objectId = this._io.readU4be();
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
    }

    return Platform0x62;
  })();

  var CameoInst5 = GloverLevel.CameoInst5 = (function() {
    function CameoInst5(_io, _parent, _root) {
      this.__type = 'CameoInst5';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    CameoInst5.prototype._read = function() {
      this.h0x00 = this._io.readU2be();
      this.h0x02 = this._io.readU2be();
      this.h0x04 = this._io.readU2be();
    }

    return CameoInst5;
  })();

  var Render0xb3 = GloverLevel.Render0xb3 = (function() {
    function Render0xb3(_io, _parent, _root) {
      this.__type = 'Render0xb3';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Render0xb3.prototype._read = function() {
    }

    return Render0xb3;
  })();

  var PlatTopple0x81 = GloverLevel.PlatTopple0x81 = (function() {
    function PlatTopple0x81(_io, _parent, _root) {
      this.__type = 'PlatTopple0x81';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatTopple0x81.prototype._read = function() {
      this.idx = this._io.readU2be();
      this.f0x1c = this._io.readF4be();
      this.f0x28 = this._io.readF4be();
      this.f0x24 = this._io.readF4be();
      this.f0x2c = this._io.readF4be();
      this.f0x6c = this._io.readF4be();
      this.f0x70PivotHeight = this._io.readF4be();
      this.u160x10 = this._io.readU2be();
    }

    return PlatTopple0x81;
  })();

  var PlatScale0x79 = GloverLevel.PlatScale0x79 = (function() {
    function PlatScale0x79(_io, _parent, _root) {
      this.__type = 'PlatScale0x79';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatScale0x79.prototype._read = function() {
      this.x = this._io.readF4be();
      this.y = this._io.readF4be();
      this.z = this._io.readF4be();
    }

    return PlatScale0x79;
  })();

  var PuzzleAction0x55 = GloverLevel.PuzzleAction0x55 = (function() {
    function PuzzleAction0x55(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x55';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleAction0x55.prototype._read = function() {
      this.u320x24 = this._io.readU4be();
      this.u160x0a = this._io.readU2be();
    }

    return PuzzleAction0x55;
  })();

  var CameoInst3 = GloverLevel.CameoInst3 = (function() {
    function CameoInst3(_io, _parent, _root) {
      this.__type = 'CameoInst3';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    CameoInst3.prototype._read = function() {
      this.h0x00 = this._io.readU2be();
      this.i0x02 = this._io.readU4be();
      this.h0x06 = this._io.readU2be();
      this.h0x08 = this._io.readU2be();
    }

    return CameoInst3;
  })();

  var PlatGoForwards0x5f = GloverLevel.PlatGoForwards0x5f = (function() {
    function PlatGoForwards0x5f(_io, _parent, _root) {
      this.__type = 'PlatGoForwards0x5f';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatGoForwards0x5f.prototype._read = function() {
      this.u320x2c0x6c = this._io.readU4be();
      this.u320x2c0x1c = this._io.readU4be();
      this.u320xf0 = this._io.readU4be();
      this.u320x2c0x34 = this._io.readU4be();
    }

    return PlatGoForwards0x5f;
  })();

  var PlatSpecial0x9e = GloverLevel.PlatSpecial0x9e = (function() {
    function PlatSpecial0x9e(_io, _parent, _root) {
      this.__type = 'PlatSpecial0x9e';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatSpecial0x9e.prototype._read = function() {
      this.u320x5c = this._io.readU4be();
      this.u320x60 = this._io.readU4be();
      this.u320x65 = this._io.readU4be();
      this.u320x68 = this._io.readU4be();
    }

    return PlatSpecial0x9e;
  })();

  var EnemyInstruction = GloverLevel.EnemyInstruction = (function() {
    function EnemyInstruction(_io, _parent, _root) {
      this.__type = 'EnemyInstruction';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    EnemyInstruction.prototype._read = function() {
      this.typeCode = this._io.readU2be();
      this.u160x02 = this._io.readU2be();
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
    }

    return EnemyInstruction;
  })();

  var SetGlobal0xb7 = GloverLevel.SetGlobal0xb7 = (function() {
    function SetGlobal0xb7(_io, _parent, _root) {
      this.__type = 'SetGlobal0xb7';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    SetGlobal0xb7.prototype._read = function() {
      this.value = this._io.readU4be();
    }

    return SetGlobal0xb7;
  })();

  var PlatConf0x72 = GloverLevel.PlatConf0x72 = (function() {
    function PlatConf0x72(_io, _parent, _root) {
      this.__type = 'PlatConf0x72';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatConf0x72.prototype._read = function() {
      this.u320x00 = this._io.readU4be();
      this.u320x04 = this._io.readU4be();
      this.u320x08 = this._io.readU4be();
      this.u320x0c = this._io.readU4be();
      this.u320x10 = this._io.readU4be();
      this.u320x14 = this._io.readU4be();
    }

    return PlatConf0x72;
  })();

  var PuzzleCondE = GloverLevel.PuzzleCondE = (function() {
    function PuzzleCondE(_io, _parent, _root) {
      this.__type = 'PuzzleCondE';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleCondE.prototype._read = function() {
      this.i0x00 = this._io.readU4be();
      this.i0x04 = this._io.readU4be();
      this.i0x08 = this._io.readU4be();
      this.i0x0c = this._io.readU4be();
      this.i0x10 = this._io.readU4be();
    }

    return PuzzleCondE;
  })();

  var PlatSpecial0xb4 = GloverLevel.PlatSpecial0xb4 = (function() {
    function PlatSpecial0xb4(_io, _parent, _root) {
      this.__type = 'PlatSpecial0xb4';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatSpecial0xb4.prototype._read = function() {
      this.u80x23 = this._io.readU2be();
    }

    return PlatSpecial0xb4;
  })();

  var PlatPos0xa7 = GloverLevel.PlatPos0xa7 = (function() {
    function PlatPos0xa7(_io, _parent, _root) {
      this.__type = 'PlatPos0xa7';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatPos0xa7.prototype._read = function() {
      this.u8Idx = this._io.readU2be();
    }

    return PlatPos0xa7;
  })();

  var BackgroundActor0xbc = GloverLevel.BackgroundActor0xbc = (function() {
    function BackgroundActor0xbc(_io, _parent, _root) {
      this.__type = 'BackgroundActor0xbc';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    BackgroundActor0xbc.prototype._read = function() {
      this.objectId = this._io.readU4be();
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this.x = this._io.readF4be();
      this.y = this._io.readF4be();
      this.z = this._io.readF4be();
    }

    return BackgroundActor0xbc;
  })();

  var PlatSpecial0x6e = GloverLevel.PlatSpecial0x6e = (function() {
    function PlatSpecial0x6e(_io, _parent, _root) {
      this.__type = 'PlatSpecial0x6e';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatSpecial0x6e.prototype._read = function() {
      this.flags = this._io.readU2be();
      this.u320x70 = this._io.readU4be();
    }

    return PlatSpecial0x6e;
  })();

  var CameoInstDefault = GloverLevel.CameoInstDefault = (function() {
    function CameoInstDefault(_io, _parent, _root) {
      this.__type = 'CameoInstDefault';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    CameoInstDefault.prototype._read = function() {
      this.h0x00 = this._io.readU2be();
      this.h0x02 = this._io.readU2be();
    }

    return CameoInstDefault;
  })();

  var PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40 = GloverLevel.PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40 = (function() {
    function PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40.prototype._read = function() {
      this.u320x14 = this._io.readU4be();
      this.u320x18 = this._io.readU4be();
      this.u320x1c = this._io.readU4be();
      this.u320x10 = this._io.readU4be();
      this.u160x0e = this._io.readU2be();
      this.u160x0a = this._io.readU2be();
      this.u320x20 = this._io.readU4be();
    }

    return PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40;
  })();

  var PuzzleCondB = GloverLevel.PuzzleCondB = (function() {
    function PuzzleCondB(_io, _parent, _root) {
      this.__type = 'PuzzleCondB';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleCondB.prototype._read = function() {
      this.i0x00 = this._io.readU4be();
      this.i0x04 = this._io.readU4be();
      this.i0x08 = this._io.readU4be();
      this.i0x0c = this._io.readU4be();
      this.i0x10 = this._io.readU4be();
      this.i0x14 = this._io.readU4be();
      this.i0x18 = this._io.readU4be();
    }

    return PuzzleCondB;
  })();

  var PlatStr0x7a = GloverLevel.PlatStr0x7a = (function() {
    function PlatStr0x7a(_io, _parent, _root) {
      this.__type = 'PlatStr0x7a';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatStr0x7a.prototype._read = function() {
      this.u320x0c = this._io.readU4be();
      this.u320x10 = this._io.readU4be();
      this.u320x14 = this._io.readU4be();
      this.u160x18 = this._io.readU2be();
      this.u160x1c = this._io.readU2be();
    }

    return PlatStr0x7a;
  })();

  var Enemy0x84 = GloverLevel.Enemy0x84 = (function() {
    function Enemy0x84(_io, _parent, _root) {
      this.__type = 'Enemy0x84';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

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

      this._read();
    }
    EnemyInstructionA.prototype._read = function() {
      this.u320x02 = this._io.readU4be();
      this.u320x06 = this._io.readU4be();
      this.u320x0a = this._io.readU4be();
      this.u320x0e = this._io.readU4be();
      this.u320x18 = this._io.readU4be();
      this.u320x1e = this._io.readU4be();
      this.u320x14 = this._io.readU4be();
      this.u320x16 = this._io.readU2be();
    }

    return EnemyInstructionA;
  })();

  var PlatSpecial0xb9 = GloverLevel.PlatSpecial0xb9 = (function() {
    function PlatSpecial0xb9(_io, _parent, _root) {
      this.__type = 'PlatSpecial0xb9';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

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

      this._read();
    }
    EnemyAttackInstruction.prototype._read = function() {
      this.instr = new EnemyInstruction(this._io, this, this._root);
    }

    return EnemyAttackInstruction;
  })();

  var LandActor = GloverLevel.LandActor = (function() {
    function LandActor(_io, _parent, _root) {
      this.__type = 'LandActor';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    LandActor.prototype._read = function() {
      this.objectId = this._io.readU4be();
      this.name = KaitaiStream.bytesToStr(this._io.readBytes(8), "ASCII");
      this.x = this._io.readF4be();
      this.y = this._io.readF4be();
      this.z = this._io.readF4be();
    }

    return LandActor;
  })();

  var PlatOrbitPause0x76 = GloverLevel.PlatOrbitPause0x76 = (function() {
    function PlatOrbitPause0x76(_io, _parent, _root) {
      this.__type = 'PlatOrbitPause0x76';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatOrbitPause0x76.prototype._read = function() {
      this.u160x08 = this._io.readU2be();
      this.u160x0c = this._io.readU2be();
    }

    return PlatOrbitPause0x76;
  })();

  var MrTip = GloverLevel.MrTip = (function() {
    function MrTip(_io, _parent, _root) {
      this.__type = 'MrTip';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    MrTip.prototype._read = function() {
      this.x = this._io.readF4be();
      this.y = this._io.readF4be();
      this.z = this._io.readF4be();
      this.messageId = this._io.readU2be();
    }

    return MrTip;
  })();

  var PlatMvspnSetparent = GloverLevel.PlatMvspnSetparent = (function() {
    function PlatMvspnSetparent(_io, _parent, _root) {
      this.__type = 'PlatMvspnSetparent';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PlatMvspnSetparent.prototype._read = function() {
      this.parentTag = this._io.readU2be();
    }

    return PlatMvspnSetparent;
  })();

  var PuzzleAction0x490x4d = GloverLevel.PuzzleAction0x490x4d = (function() {
    function PuzzleAction0x490x4d(_io, _parent, _root) {
      this.__type = 'PuzzleAction0x490x4d';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    PuzzleAction0x490x4d.prototype._read = function() {
      this.u320x24 = this._io.readU4be();
      this.u320x28 = this._io.readU4be();
      this.u320x2c = this._io.readU4be();
      this.u160x0a = this._io.readU2be();
    }

    return PuzzleAction0x490x4d;
  })();

  var CameoInst0 = GloverLevel.CameoInst0 = (function() {
    function CameoInst0(_io, _parent, _root) {
      this.__type = 'CameoInst0';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    CameoInst0.prototype._read = function() {
      this.h0x00 = this._io.readU2be();
      this.h0x02 = this._io.readU2be();
      this.h0x04 = this._io.readU2be();
      this.i0x06 = this._io.readU4be();
      this.h0x0a = this._io.readU2be();
      this.h0x0c = this._io.readU2be();
    }

    return CameoInst0;
  })();

  var Unknown0x03 = GloverLevel.Unknown0x03 = (function() {
    function Unknown0x03(_io, _parent, _root) {
      this.__type = 'Unknown0x03';
      this._io = _io;
      this._parent = _parent;
      this._root = _root || this;

      this._read();
    }
    Unknown0x03.prototype._read = function() {
      this.f0x00 = this._io.readF4be();
      this.f0x04 = this._io.readF4be();
      this.f0x08 = this._io.readF4be();
      this.f0x0c = this._io.readF4be();
      this.f0x10 = this._io.readF4be();
    }

    return Unknown0x03;
  })();

  return GloverLevel;
})();
return GloverLevel;
}));
