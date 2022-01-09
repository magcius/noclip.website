// This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild

interface DebugPosition {
  start: number;
  end: number;
  ioOffset: number;
}

declare class GloverLevel {
  constructor(io: any, parent?: any, root?: any);
  __type: 'GloverLevel';
  _io: any;

  length: number;
  name: string;
  body: GloverLevel.Cmd[];

  _debug: {
    length: DebugPosition;
    name: DebugPosition;
    body: DebugPosition;
  };
}

declare namespace GloverLevel {
  class PlatSpecial0x68 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpecial0x68';
    _io: any;

    u320x5c: number;
    u320x60: number;
    u320x65: number;

    _debug: {
      u320x5c: DebugPosition;
      u320x60: DebugPosition;
      u320x65: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleAction0x54 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleAction0x54';
    _io: any;

    u320x14: number;
    u320x16: number;
    u320x18: number;
    u320x1a: number;
    u320x1c: number;
    u320x1e: number;
    u320x10: number;
    u160x0e: number;
    u320x24: number;
    u320x28: number;
    u320x2c: number;
    u160x0a: number;

    _debug: {
      u320x14: DebugPosition;
      u320x16: DebugPosition;
      u320x18: DebugPosition;
      u320x1a: DebugPosition;
      u320x1c: DebugPosition;
      u320x1e: DebugPosition;
      u320x10: DebugPosition;
      u160x0e: DebugPosition;
      u320x24: DebugPosition;
      u320x28: DebugPosition;
      u320x2c: DebugPosition;
      u160x0a: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleAction0x460x470x48 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleAction0x460x470x48';
    _io: any;

    u320x24: number;
    u160x0a: number;

    _debug: {
      u320x24: DebugPosition;
      u160x0a: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSound0xc2 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSound0xc2';
    _io: any;

    soundId: number;
    volume: number;
    pitch: number;

    _debug: {
      soundId: DebugPosition;
      volume: DebugPosition;
      pitch: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSpinPause0x7c {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpinPause0x7c';
    _io: any;

    u160x0c: number;
    u160x0a: number;

    _debug: {
      u160x0c: DebugPosition;
      u160x0a: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatMagnet0x8b {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatMagnet0x8b';
    _io: any;

    u160x0c: number;
    u320x48: number;
    u320x4c: number;
    u320x50: number;
    u320x10: number;
    u320x14: number;
    u320x18: number;
    u320x1c: number;

    _debug: {
      u160x0c: DebugPosition;
      u320x48: DebugPosition;
      u320x4c: DebugPosition;
      u320x50: DebugPosition;
      u320x10: DebugPosition;
      u320x14: DebugPosition;
      u320x18: DebugPosition;
      u320x1c: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class EnemyInstructionError {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemyInstructionError';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class Backdrop {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Backdrop';
    _io: any;

    textureId: number;
    decalPosX: number;
    decalPosY: number;
    sortKey: number;
    offsetY: number;
    scaleX: number;
    scaleY: number;
    flipX: number;
    flipY: number;
    scrollSpeedX: number;
    unused: number;
    decalParentIdx: number;

    _debug: {
      textureId: DebugPosition;
      decalPosX: DebugPosition;
      decalPosY: DebugPosition;
      sortKey: DebugPosition;
      offsetY: DebugPosition;
      scaleX: DebugPosition;
      scaleY: DebugPosition;
      flipX: DebugPosition;
      flipY: DebugPosition;
      scrollSpeedX: DebugPosition;
      unused: DebugPosition;
      decalParentIdx: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class DiffuseLight {
    constructor(io: any, parent?: any, root?: any);
    __type: 'DiffuseLight';
    _io: any;

    r: number;
    g: number;
    b: number;
    thetaX: number;
    thetaY: number;

    _debug: {
      r: DebugPosition;
      g: DebugPosition;
      b: DebugPosition;
      thetaX: DebugPosition;
      thetaY: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatPathAcceleration {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatPathAcceleration';
    _io: any;

    acceleration: number;

    _debug: {
      acceleration: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Buzzer {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Buzzer';
    _io: any;

    u160x2a: number;
    tag0x24: number;
    tag0x20: number;
    u160x28: number;
    u80x2c: number;
    u80x2d: number;
    u80x2e: number;
    u80x2f: number;
    u320x08: number;
    u320x0c: number;
    u320x10: number;
    u320x14: number;
    u320x18: number;
    u320x1c: number;
    u320x50: number;
    u320x54: number;

    _debug: {
      u160x2a: DebugPosition;
      tag0x24: DebugPosition;
      tag0x20: DebugPosition;
      u160x28: DebugPosition;
      u80x2c: DebugPosition;
      u80x2d: DebugPosition;
      u80x2e: DebugPosition;
      u80x2f: DebugPosition;
      u320x08: DebugPosition;
      u320x0c: DebugPosition;
      u320x10: DebugPosition;
      u320x14: DebugPosition;
      u320x18: DebugPosition;
      u320x1c: DebugPosition;
      u320x50: DebugPosition;
      u320x54: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleAny {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleAny';
    _io: any;

    op: number;

    _debug: {
      op: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class SetActorRotation {
    constructor(io: any, parent?: any, root?: any);
    __type: 'SetActorRotation';
    _io: any;

    x: number;
    y: number;
    z: number;

    _debug: {
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class CameoInst {
    constructor(io: any, parent?: any, root?: any);
    __type: 'CameoInst';
    _io: any;

    instType: number;
    body: GloverLevel.CameoInst0 | GloverLevel.CameoInst4 | GloverLevel.CameoInst6 | GloverLevel.CameoInst1 | GloverLevel.CameoInst3 | GloverLevel.CameoInst5 | GloverLevel.CameoInstDefault | GloverLevel.CameoInst2 | undefined;

    _debug: {
      instType: DebugPosition;
      body: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatMvspn0x5a {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatMvspn0x5a';
    _io: any;

    u160x1c: number;
    u320x18: number;

    _debug: {
      u160x1c: DebugPosition;
      u320x18: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatMvspn0x74 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatMvspn0x74';
    _io: any;

    u320x34: number;
    u320x38: number;
    u320x3c: number;

    _debug: {
      u320x34: DebugPosition;
      u320x38: DebugPosition;
      u320x3c: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatOrbit {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatOrbit';
    _io: any;

    u16120: number;
    u16136: number;
    u16134: number;
    u16132: number;
    u32116: number;
    name: string;
    f112: number;
    f108: number;
    f104: number;
    f100: number;
    f96: number;
    f92: number;
    f88: number;
    f84: number;
    f80: number;
    u32176: number;

    _debug: {
      u16120: DebugPosition;
      u16136: DebugPosition;
      u16134: DebugPosition;
      u16132: DebugPosition;
      u32116: DebugPosition;
      name: DebugPosition;
      f112: DebugPosition;
      f108: DebugPosition;
      f104: DebugPosition;
      f100: DebugPosition;
      f96: DebugPosition;
      f92: DebugPosition;
      f88: DebugPosition;
      f84: DebugPosition;
      f80: DebugPosition;
      u32176: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSpike {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpike';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class PlatSpecial0x8e {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpecial0x8e';
    _io: any;

    enable: number;

    _debug: {
      enable: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Plat0x9f {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Plat0x9f';
    _io: any;

    u320x6c: number;
    u320x70: number;
    u320x1c: number;
    u320x28: number;

    _debug: {
      u320x6c: DebugPosition;
      u320x70: DebugPosition;
      u320x1c: DebugPosition;
      u320x28: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class EnvironmentalSound {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnvironmentalSound';
    _io: any;

    soundId: number;
    volume: number;
    flags: number;
    h0x06: number;
    h0x08: number;
    h0x0a: number;
    h0x0c: number;
    h0x0e: number;
    x: number;
    y: number;
    z: number;
    radius: number;

    _debug: {
      soundId: DebugPosition;
      volume: DebugPosition;
      flags: DebugPosition;
      h0x06: DebugPosition;
      h0x08: DebugPosition;
      h0x0a: DebugPosition;
      h0x0c: DebugPosition;
      h0x0e: DebugPosition;
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
      radius: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSetInitialPos {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSetInitialPos';
    _io: any;

    x: number;
    y: number;
    z: number;

    _debug: {
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class EnemyInstructionB {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemyInstructionB';
    _io: any;

    u320x02: number;
    u320x06: number;
    u320x0a: number;
    u320x08: number;
    u320x0c: number;
    u320x10: number;
    u320x0e: number;
    u320x18: number;
    u320x1e: number;
    u320x14: number;
    u320x16: number;

    _debug: {
      u320x02: DebugPosition;
      u320x06: DebugPosition;
      u320x0a: DebugPosition;
      u320x08: DebugPosition;
      u320x0c: DebugPosition;
      u320x10: DebugPosition;
      u320x0e: DebugPosition;
      u320x18: DebugPosition;
      u320x1e: DebugPosition;
      u320x14: DebugPosition;
      u320x16: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatMaxVelocity {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatMaxVelocity';
    _io: any;

    velocity: number;

    _debug: {
      velocity: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatMvspn0x59 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatMvspn0x59';
    _io: any;

    u160x24: number;
    u320x20: number;
    u320x28: number;
    u320x2c: number;
    u320x30: number;

    _debug: {
      u160x24: DebugPosition;
      u320x20: DebugPosition;
      u320x28: DebugPosition;
      u320x2c: DebugPosition;
      u320x30: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Cameo {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Cameo';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class PlatSpinFlip0x7d {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpinFlip0x7d';
    _io: any;

    u160x0a: number;
    u320x14: number;

    _debug: {
      u160x0a: DebugPosition;
      u320x14: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatRest0x63 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatRest0x63';
    _io: any;

    u160x17: number;
    theta: number;

    _debug: {
      u160x17: DebugPosition;
      theta: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Plat0xc3 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Plat0xc3';
    _io: any;

    u160x86: number;
    u320x780x80: number;
    u160x84: number;

    _debug: {
      u160x86: DebugPosition;
      u320x780x80: DebugPosition;
      u160x84: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class EndLevelData {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EndLevelData';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class PlatFan0x8a {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatFan0x8a';
    _io: any;

    u160x0c: number;
    u320x48: number;
    u320x4c: number;
    u320x50: number;
    u320x10: number;
    u320x14: number;
    u320x18: number;
    u320x1c: number;

    _debug: {
      u160x0c: DebugPosition;
      u320x48: DebugPosition;
      u320x4c: DebugPosition;
      u320x50: DebugPosition;
      u320x10: DebugPosition;
      u320x14: DebugPosition;
      u320x18: DebugPosition;
      u320x1c: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSpinBlur0x70 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpinBlur0x70';
    _io: any;

    idx: number;
    u320x38: number;
    u320x18: number;
    fBlur0x578: number;
    count: number;

    _debug: {
      idx: DebugPosition;
      u320x38: DebugPosition;
      u320x18: DebugPosition;
      fBlur0x578: DebugPosition;
      count: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSpinSound0xc5 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpinSound0xc5';
    _io: any;

    soundId: number;
    volume: number;
    pitch: number;

    _debug: {
      soundId: DebugPosition;
      volume: DebugPosition;
      pitch: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleCondC {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleCondC';
    _io: any;

    i0x00: number;
    i0x04: number;
    i0x08: number;
    i0x0c: number;
    i0x10: number;
    i0x14: number;

    _debug: {
      i0x00: DebugPosition;
      i0x04: DebugPosition;
      i0x08: DebugPosition;
      i0x0c: DebugPosition;
      i0x10: DebugPosition;
      i0x14: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSpin0x7f {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpin0x7f';
    _io: any;

    axis: number;
    initialTheta: number;
    speed: number;

    _debug: {
      axis: DebugPosition;
      initialTheta: DebugPosition;
      speed: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleAction0x4a {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleAction0x4a';
    _io: any;

    u320x24: number;
    u320x240x0c: number;
    u160x0a: number;

    _debug: {
      u320x24: DebugPosition;
      u320x240x0c: DebugPosition;
      u160x0a: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class EnemyConditionalInstruction {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemyConditionalInstruction';
    _io: any;

    instr: GloverLevel.EnemyInstruction;

    _debug: {
      instr: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSetTag {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSetTag';
    _io: any;

    tag: number;

    _debug: {
      tag: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Enemy0xa1 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Enemy0xa1';
    _io: any;

    u321: number;
    u322: number;
    u323: number;
    u324: number;
    u325: number;
    u326: number;

    _debug: {
      u321: DebugPosition;
      u322: DebugPosition;
      u323: DebugPosition;
      u324: DebugPosition;
      u325: DebugPosition;
      u326: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Vent {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Vent';
    _io: any;

    u160x08: number;
    u160x0a: number;
    tag: number;
    f0x38: number;
    f0x3c: number;
    f0x40: number;
    f0x2c: number;
    f0x30: number;
    f0x34: number;

    _debug: {
      u160x08: DebugPosition;
      u160x0a: DebugPosition;
      tag: DebugPosition;
      f0x38: DebugPosition;
      f0x3c: DebugPosition;
      f0x40: DebugPosition;
      f0x2c: DebugPosition;
      f0x30: DebugPosition;
      f0x34: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleCond {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleCond';
    _io: any;

    condType: number;
    body: GloverLevel.PuzzleCondC | GloverLevel.PuzzleCondC | GloverLevel.PuzzleCondD | GloverLevel.PuzzleCondD | GloverLevel.PuzzleCondA | GloverLevel.PuzzleCondC | GloverLevel.PuzzleCondE | GloverLevel.PuzzleCondD | GloverLevel.PuzzleCondB | undefined;

    _debug: {
      condType: DebugPosition;
      body: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatMvspn0x73 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatMvspn0x73';
    _io: any;

    u160x0c: number;
    u320x34: number;
    u320x38: number;
    u320x3c: number;

    _debug: {
      u160x0c: DebugPosition;
      u320x34: DebugPosition;
      u320x38: DebugPosition;
      u320x3c: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class LookAtBall0x61 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'LookAtBall0x61';
    _io: any;

    u320x6c: number;
    u320x1c: number;

    _debug: {
      u320x6c: DebugPosition;
      u320x1c: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class LookAtHand0x60 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'LookAtHand0x60';
    _io: any;

    u320x6c: number;
    u320x1c: number;

    _debug: {
      u320x6c: DebugPosition;
      u320x1c: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class CameoInst2 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'CameoInst2';
    _io: any;

    h0x00: number;
    i0x02: number;
    i0x06: number;
    i0x0a: number;
    i0x0e: number;
    h0x12: number;
    h0x14: number;

    _debug: {
      h0x00: DebugPosition;
      i0x02: DebugPosition;
      i0x06: DebugPosition;
      i0x0a: DebugPosition;
      i0x0e: DebugPosition;
      h0x12: DebugPosition;
      h0x14: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Unknown0xa9 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Unknown0xa9';
    _io: any;

    i0x00: number;

    _debug: {
      i0x00: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatVentAdvanceFrames {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatVentAdvanceFrames';
    _io: any;

    numFrames: number;

    _debug: {
      numFrames: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class SetExit {
    constructor(io: any, parent?: any, root?: any);
    __type: 'SetExit';
    _io: any;

    type: number;
    visible: number;

    _debug: {
      type: DebugPosition;
      visible: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatOrbit0x75 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatOrbit0x75';
    _io: any;

    idx: number;
    u320x18: number;
    u320x1c: number;
    u320x20: number;
    u320x28: number;

    _debug: {
      idx: DebugPosition;
      u320x18: DebugPosition;
      u320x1c: DebugPosition;
      u320x20: DebugPosition;
      u320x28: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSound0xc1 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSound0xc1';
    _io: any;

    soundId: number;
    volume: number;
    pitch: number;

    _debug: {
      soundId: DebugPosition;
      volume: DebugPosition;
      pitch: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class EnemyInstructionC {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemyInstructionC';
    _io: any;

    u320x02: number;
    u320x0e: number;
    u320x18: number;
    u320x1e: number;
    u320x14: number;
    u320x16: number;

    _debug: {
      u320x02: DebugPosition;
      u320x0e: DebugPosition;
      u320x18: DebugPosition;
      u320x1e: DebugPosition;
      u320x14: DebugPosition;
      u320x16: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleAnd {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleAnd';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class Plat0x66 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Plat0x66';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class PlatSpecial0xc7 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpecial0xc7';
    _io: any;

    u160x2a: number;
    u160x1cAnd0x24: number;
    u160x28: number;

    _debug: {
      u160x2a: DebugPosition;
      u160x1cAnd0x24: DebugPosition;
      u160x28: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Powerup {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Powerup';
    _io: any;

    u160x00: number;
    u160x02: number;
    u160x04: number;
    f0x06: number;
    f0x0a: number;
    f0x0e: number;

    _debug: {
      u160x00: DebugPosition;
      u160x02: DebugPosition;
      u160x04: DebugPosition;
      f0x06: DebugPosition;
      f0x0a: DebugPosition;
      f0x0e: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class SetTeleport {
    constructor(io: any, parent?: any, root?: any);
    __type: 'SetTeleport';
    _io: any;

    targetTag: number;
    u160x0c: number;
    u160x10: number;
    u160x12: number;
    u320x00: number;
    u320x04: number;
    u320x08: number;

    _debug: {
      targetTag: DebugPosition;
      u160x0c: DebugPosition;
      u160x10: DebugPosition;
      u160x12: DebugPosition;
      u320x00: DebugPosition;
      u320x04: DebugPosition;
      u320x08: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleCondD {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleCondD';
    _io: any;

    i0x00: number;
    i0x04: number;
    i0x08: number;
    i0x0c: number;

    _debug: {
      i0x00: DebugPosition;
      i0x04: DebugPosition;
      i0x08: DebugPosition;
      i0x0c: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class VentAppend0xa3 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'VentAppend0xa3';
    _io: any;

    u16IdxPlus0x10: number;
    u16IdxPlus0x1c: number;

    _debug: {
      u16IdxPlus0x10: DebugPosition;
      u16IdxPlus0x1c: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class UnknownSound0xbd {
    constructor(io: any, parent?: any, root?: any);
    __type: 'UnknownSound0xbd';
    _io: any;

    h0x00: number;
    h0x02: number;
    h0x04: number;

    _debug: {
      h0x00: DebugPosition;
      h0x02: DebugPosition;
      h0x04: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Plat0x5d {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Plat0x5d';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class PlatCheckpoint {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatCheckpoint';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class CameoInst4 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'CameoInst4';
    _io: any;

    h0x00: number;
    h0x02: number;
    h0x04: number;
    h0x06: number;
    h0x08: number;

    _debug: {
      h0x00: DebugPosition;
      h0x02: DebugPosition;
      h0x04: DebugPosition;
      h0x06: DebugPosition;
      h0x08: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class BallSpawnPoint {
    constructor(io: any, parent?: any, root?: any);
    __type: 'BallSpawnPoint';
    _io: any;

    h0x00: number;
    x: number;
    y: number;
    z: number;

    _debug: {
      h0x00: DebugPosition;
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Unknown0x01 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Unknown0x01';
    _io: any;

    f0x00: number;
    f0x04: number;
    f0x08: number;

    _debug: {
      f0x00: DebugPosition;
      f0x04: DebugPosition;
      f0x08: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatAnim0xc0 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatAnim0xc0';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class PlatSetParent {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSetParent';
    _io: any;

    tag: number;

    _debug: {
      tag: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleOr {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleOr';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class PuzzleAction0x56 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleAction0x56';
    _io: any;

    u320x14: number;
    u320x18: number;
    u160x1c: number;
    u160x0a: number;

    _debug: {
      u320x14: DebugPosition;
      u320x18: DebugPosition;
      u160x1c: DebugPosition;
      u160x0a: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Cmd {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Cmd';
    _io: any;

    typeCode: number;
    params: GloverLevel.Plat0x78 | GloverLevel.PlatRope | GloverLevel.Plat0x5d | GloverLevel.PlatOrbitPause0x76 | GloverLevel.Plat0x9f | GloverLevel.PlatSound0xc2 | GloverLevel.PlatSpecial0xb8 | GloverLevel.PlatCat0x69 | GloverLevel.PlatSpecial0x8e | GloverLevel.PlatSpinBlur0x70 | GloverLevel.VentAppend0xa3 | GloverLevel.Enemy | GloverLevel.PlatPos0xa7 | GloverLevel.LandActor | GloverLevel.Puzzle | GloverLevel.Unknown0xa9 | GloverLevel.Vent | GloverLevel.PlatMvspn0x74 | GloverLevel.PlatOrbitFlip0x77 | GloverLevel.PuzzleOr | GloverLevel.PuzzleNumtimes | GloverLevel.PlatSetParent | GloverLevel.PlatScale | GloverLevel.LookAtHand0x60 | GloverLevel.Unknown0xbf | GloverLevel.Unknown0x01 | GloverLevel.PuzzleAction | GloverLevel.LookAtBall0x61 | GloverLevel.PlatOrActor0x6a | GloverLevel.BackgroundActor0x91 | GloverLevel.PlatDestructible | GloverLevel.PlatSine | GloverLevel.PlatSpin0x7f | GloverLevel.PlatCheckpoint | GloverLevel.PuzzleCond | GloverLevel.PlatMvspn0x73 | GloverLevel.PlatPush0x5b | GloverLevel.PlatPathPoint | GloverLevel.PlatOrbit | GloverLevel.PlatMvspn0x59 | GloverLevel.PlatSpecial0x68 | GloverLevel.Platform | GloverLevel.PlatSpinSound0xc5 | GloverLevel.PlatGoForwards0x5f | GloverLevel.SetTeleport | GloverLevel.PlatMvspn0x58 | GloverLevel.Enemy0xa1 | GloverLevel.PlatFan0x8a | GloverLevel.Unknown0x03 | GloverLevel.PlatAnim0xc0 | GloverLevel.Plat0x7e | GloverLevel.FogConfiguration | GloverLevel.PuzzleAnd | GloverLevel.PlatCrumb0x67 | GloverLevel.PlatRest0x63 | GloverLevel.PlatSpecial0xb9 | GloverLevel.PlatSpecial0xb4 | GloverLevel.EnemyAttackInstruction | GloverLevel.PlatSpinFlip0x7d | GloverLevel.Enemy0xba | GloverLevel.BackgroundActor0xbc | GloverLevel.Backdrop | GloverLevel.PlatSpin0x7b | GloverLevel.Water | GloverLevel.PuzzleAny | GloverLevel.PlatSetInitialPos | GloverLevel.PlatConf0x72 | GloverLevel.Buzzer | GloverLevel.SetActorScale | GloverLevel.PlatSpecial0x9e | GloverLevel.PlatOrbit0x75 | GloverLevel.AmbientLight | GloverLevel.Unrecognized | GloverLevel.PlatPathAcceleration | GloverLevel.EndLevelData | GloverLevel.Wind | GloverLevel.PlatStr0x7a | GloverLevel.Render0xb3 | GloverLevel.Plat0xc3 | GloverLevel.PlatSpike | GloverLevel.MrTip | GloverLevel.Cameo | GloverLevel.PlatSpecial0xc7 | GloverLevel.Plat0xa4 | GloverLevel.PlatSpecial0xb6 | GloverLevel.PlatMaxVelocity | GloverLevel.UnknownSound0xbd | GloverLevel.SetExit | GloverLevel.CameoInst | GloverLevel.PlatSound0xc1 | GloverLevel.GaribGroup | GloverLevel.PlatTopple0x81 | GloverLevel.DiffuseLight | GloverLevel.Plat0x9d | GloverLevel.SetActorRotation | GloverLevel.Garib | GloverLevel.Plat0x66 | GloverLevel.PlatSpecial0x6e | GloverLevel.PlatMagnet0x8b | GloverLevel.EnemyConditionalInstruction | GloverLevel.BallSpawnPoint | GloverLevel.Powerup | GloverLevel.PlatSpinPause0x7c | GloverLevel.PlatDestructibleSound | GloverLevel.Enemy0x84 | GloverLevel.PlatVentAdvanceFrames | GloverLevel.Plat0xc6 | GloverLevel.PlatSetTag | GloverLevel.EnvironmentalSound | GloverLevel.Plat0xc4 | GloverLevel.SetGlobal0xb7 | GloverLevel.PlatSpin0x80 | GloverLevel.PlatMvspn0x5a | GloverLevel.EnemyNormalInstruction | undefined;

    _debug: {
      typeCode: DebugPosition;
      params: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Plat0xc6 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Plat0xc6';
    _io: any;

    u160x4a: number;
    u160x44: number;
    u160x48: number;

    _debug: {
      u160x4a: DebugPosition;
      u160x44: DebugPosition;
      u160x48: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Wind {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Wind';
    _io: any;

    i0x00: number;
    i0x04: number;
    i0x08: number;
    i0x0c: number;
    i0x10: number;
    i0x14: number;
    i0x18: number;
    i0x1c: number;
    i0x20: number;
    i0x28: number;
    i0x2c: number;
    i0x24: number;
    i0x30: number;

    _debug: {
      i0x00: DebugPosition;
      i0x04: DebugPosition;
      i0x08: DebugPosition;
      i0x0c: DebugPosition;
      i0x10: DebugPosition;
      i0x14: DebugPosition;
      i0x18: DebugPosition;
      i0x1c: DebugPosition;
      i0x20: DebugPosition;
      i0x28: DebugPosition;
      i0x2c: DebugPosition;
      i0x24: DebugPosition;
      i0x30: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Puzzle {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Puzzle';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class PlatPush0x5b {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatPush0x5b';
    _io: any;

    flags: number;
    u320x04: number;
    actorF0x70: number;
    u320x1c: number;

    _debug: {
      flags: DebugPosition;
      u320x04: DebugPosition;
      actorF0x70: DebugPosition;
      u320x1c: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatMvspn0x58 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatMvspn0x58';
    _io: any;

    u160x14: number;
    u320x10: number;

    _debug: {
      u160x14: DebugPosition;
      u320x10: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatDestructible {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatDestructible';
    _io: any;

    flags: number;
    numParticles: number;
    particleObjectId: number;
    name: string;

    _debug: {
      flags: DebugPosition;
      numParticles: DebugPosition;
      particleObjectId: DebugPosition;
      name: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleAction {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleAction';
    _io: any;

    actionType: number;
    body: GloverLevel.PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40 | GloverLevel.PuzzleAction0x490x4d | GloverLevel.PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40 | GloverLevel.PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40 | GloverLevel.PuzzleAction0x490x4d | GloverLevel.PuzzleAction0x55 | GloverLevel.PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40 | GloverLevel.PuzzleAction0x56 | GloverLevel.PuzzleAction0x54 | GloverLevel.PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40 | GloverLevel.PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40 | GloverLevel.PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40 | GloverLevel.PuzzleAction0x4b0x4c | GloverLevel.PuzzleActionDefault | GloverLevel.PuzzleAction0x4f | GloverLevel.PuzzleAction0x460x470x48 | GloverLevel.PuzzleAction0x460x470x48 | GloverLevel.PuzzleAction0x460x470x48 | GloverLevel.PuzzleAction0x4a | GloverLevel.PuzzleAction0x4b0x4c | undefined;

    _debug: {
      actionType: DebugPosition;
      body: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Plat0xc4 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Plat0xc4';
    _io: any;

    u160x3a: number;
    u160x2cAnd0x34: number;
    u160x38: number;

    _debug: {
      u160x3a: DebugPosition;
      u160x2cAnd0x34: DebugPosition;
      u160x38: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Water {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Water';
    _io: any;

    left: number;
    top: number;
    front: number;
    width: number;
    bottom: number;
    depth: number;
    surfaceY: number;
    currentX: number;
    currentZ: number;
    unknown1: number;
    objectId: number;
    name: string;
    x: number;
    y: number;
    z: number;

    _debug: {
      left: DebugPosition;
      top: DebugPosition;
      front: DebugPosition;
      width: DebugPosition;
      bottom: DebugPosition;
      depth: DebugPosition;
      surfaceY: DebugPosition;
      currentX: DebugPosition;
      currentZ: DebugPosition;
      unknown1: DebugPosition;
      objectId: DebugPosition;
      name: DebugPosition;
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleAction0x4f {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleAction0x4f';
    _io: any;

    u320x14: number;
    u320x18: number;
    u320x10: number;
    u160x0e: number;
    u160x0a: number;
    u320x20: number;

    _debug: {
      u320x14: DebugPosition;
      u320x18: DebugPosition;
      u320x10: DebugPosition;
      u160x0e: DebugPosition;
      u160x0a: DebugPosition;
      u320x20: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Unrecognized {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Unrecognized';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class PlatScale {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatScale';
    _io: any;

    x: number;
    y: number;
    z: number;

    _debug: {
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Unknown0xbf {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Unknown0xbf';
    _io: any;

    mode: number;
    i0x02: number;

    _debug: {
      mode: DebugPosition;
      i0x02: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleAction0x4b0x4c {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleAction0x4b0x4c';
    _io: any;

    u160x0a: number;

    _debug: {
      u160x0a: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class SetActorScale {
    constructor(io: any, parent?: any, root?: any);
    __type: 'SetActorScale';
    _io: any;

    x: number;
    y: number;
    z: number;

    _debug: {
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSpecial0xb8 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpecial0xb8';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class PlatOrbitFlip0x77 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatOrbitFlip0x77';
    _io: any;

    u160x08: number;
    u160x10: number;

    _debug: {
      u160x08: DebugPosition;
      u160x10: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatDestructibleSound {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatDestructibleSound';
    _io: any;

    soundId: number;
    volume: number;
    pitch: number;

    _debug: {
      soundId: DebugPosition;
      volume: DebugPosition;
      pitch: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class AmbientLight {
    constructor(io: any, parent?: any, root?: any);
    __type: 'AmbientLight';
    _io: any;

    r: number;
    g: number;
    b: number;

    _debug: {
      r: DebugPosition;
      g: DebugPosition;
      b: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Enemy {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Enemy';
    _io: any;

    enemyType: number;
    u1: number;
    x: number;
    y: number;
    z: number;
    yRotation: number;

    _debug: {
      enemyType: DebugPosition;
      u1: DebugPosition;
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
      yRotation: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Plat0xa4 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Plat0xa4';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class PlatOrActor0x6a {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatOrActor0x6a';
    _io: any;

    value: number;

    _debug: {
      value: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSpin0x7b {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpin0x7b';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class PlatSpecial0xb6 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpecial0xb6';
    _io: any;

    u160x34: number;
    u160x40: number;

    _debug: {
      u160x34: DebugPosition;
      u160x40: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatCrumb0x67 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatCrumb0x67';
    _io: any;

    u160x02: number;
    u160x04: number;
    u160x08: number;

    _debug: {
      u160x02: DebugPosition;
      u160x04: DebugPosition;
      u160x08: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleActionDefault {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleActionDefault';
    _io: any;

    u320x10: number;
    u160x0e: number;
    u160x0a: number;
    u320x20: number;

    _debug: {
      u320x10: DebugPosition;
      u160x0e: DebugPosition;
      u160x0a: DebugPosition;
      u320x20: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Garib {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Garib';
    _io: any;

    x: number;
    y: number;
    z: number;
    type: number;
    u80x0f: number;

    _debug: {
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
      type: DebugPosition;
      u80x0f: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class GaribGroup {
    constructor(io: any, parent?: any, root?: any);
    __type: 'GaribGroup';
    _io: any;

    u160xd2: number;
    u80xd1: number;

    _debug: {
      u160xd2: DebugPosition;
      u80xd1: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class CameoInst6 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'CameoInst6';
    _io: any;

    h0x00: number;
    h0x02: number;
    h0x04: number;
    h0x06: number;

    _debug: {
      h0x00: DebugPosition;
      h0x02: DebugPosition;
      h0x04: DebugPosition;
      h0x06: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatPathPoint {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatPathPoint';
    _io: any;

    duration: number;
    x: number;
    y: number;
    z: number;

    _debug: {
      duration: DebugPosition;
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Plat0x78 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Plat0x78';
    _io: any;

    u160x08: number;

    _debug: {
      u160x08: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class BackgroundActor0x91 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'BackgroundActor0x91';
    _io: any;

    objectId: number;
    name: string;
    x: number;
    y: number;
    z: number;

    _debug: {
      objectId: DebugPosition;
      name: DebugPosition;
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Enemy0xba {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Enemy0xba';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class PuzzleCondA {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleCondA';
    _io: any;

    u320x24: number;
    u160x0a: number;

    _debug: {
      u320x24: DebugPosition;
      u160x0a: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSine {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSine';
    _io: any;

    u32Count: number;
    u32116: number;
    name: string;
    f108: number;
    f104: number;
    f100: number;
    f96: number;
    f92: number;
    f88: number;
    f84: number;
    f80: number;
    u32176: number;
    u32172: number;

    _debug: {
      u32Count: DebugPosition;
      u32116: DebugPosition;
      name: DebugPosition;
      f108: DebugPosition;
      f104: DebugPosition;
      f100: DebugPosition;
      f96: DebugPosition;
      f92: DebugPosition;
      f88: DebugPosition;
      f84: DebugPosition;
      f80: DebugPosition;
      u32176: DebugPosition;
      u32172: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatCat0x69 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatCat0x69';
    _io: any;

    u160x20: number;
    u320x00: number;
    u320x04: number;
    u320x08: number;
    u320x0c: number;
    u320x10: number;
    u320x1c: number;

    _debug: {
      u160x20: DebugPosition;
      u320x00: DebugPosition;
      u320x04: DebugPosition;
      u320x08: DebugPosition;
      u320x0c: DebugPosition;
      u320x10: DebugPosition;
      u320x1c: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatRope {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatRope';
    _io: any;

    u32Count: number;
    u16Idx: number;
    u32U1: number;
    name: string;
    ustack1760: number;
    ustack1761: number;
    ustack1762: number;
    ustack1763: number;
    ustack1764: number;
    ustack1765: number;
    ustack1766: number;
    f112: number;
    f108: number;
    f104: number;
    f100: number;
    f96: number;
    f92: number;

    _debug: {
      u32Count: DebugPosition;
      u16Idx: DebugPosition;
      u32U1: DebugPosition;
      name: DebugPosition;
      ustack1760: DebugPosition;
      ustack1761: DebugPosition;
      ustack1762: DebugPosition;
      ustack1763: DebugPosition;
      ustack1764: DebugPosition;
      ustack1765: DebugPosition;
      ustack1766: DebugPosition;
      f112: DebugPosition;
      f108: DebugPosition;
      f104: DebugPosition;
      f100: DebugPosition;
      f96: DebugPosition;
      f92: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleNumtimes {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleNumtimes';
    _io: any;

    n: number;

    _debug: {
      n: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSpin0x80 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpin0x80';
    _io: any;

    idx: number;
    f0x1c: number;
    u320x28: number;
    u32Ustack56: number;
    u320x2c: number;
    f0x6c: number;
    f0x70: number;

    _debug: {
      idx: DebugPosition;
      f0x1c: DebugPosition;
      u320x28: DebugPosition;
      u32Ustack56: DebugPosition;
      u320x2c: DebugPosition;
      f0x6c: DebugPosition;
      f0x70: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Plat0x7e {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Plat0x7e';
    _io: any;

    u320x28: number;

    _debug: {
      u320x28: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class CameoInst1 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'CameoInst1';
    _io: any;

    h0x00: number;
    i0x02: number;
    i0x06: number;
    i0x0a: number;
    h0x0e: number;
    h0x10: number;

    _debug: {
      h0x00: DebugPosition;
      i0x02: DebugPosition;
      i0x06: DebugPosition;
      i0x0a: DebugPosition;
      h0x0e: DebugPosition;
      h0x10: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Plat0x9d {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Plat0x9d';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class EnemyNormalInstruction {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemyNormalInstruction';
    _io: any;

    instr: GloverLevel.EnemyInstruction;

    _debug: {
      instr: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class FogConfiguration {
    constructor(io: any, parent?: any, root?: any);
    __type: 'FogConfiguration';
    _io: any;

    fogEnabled: number;
    r: number;
    g: number;
    b: number;
    fogDistance: number;
    nearClip: number;

    _debug: {
      fogEnabled: DebugPosition;
      r: DebugPosition;
      g: DebugPosition;
      b: DebugPosition;
      fogDistance: DebugPosition;
      nearClip: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class CameoInst5 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'CameoInst5';
    _io: any;

    h0x00: number;
    h0x02: number;
    h0x04: number;

    _debug: {
      h0x00: DebugPosition;
      h0x02: DebugPosition;
      h0x04: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Render0xb3 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Render0xb3';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class PlatTopple0x81 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatTopple0x81';
    _io: any;

    idx: number;
    f0x1c: number;
    f0x28: number;
    f0x24: number;
    f0x2c: number;
    f0x6c: number;
    f0x70PivotHeight: number;
    u160x10: number;

    _debug: {
      idx: DebugPosition;
      f0x1c: DebugPosition;
      f0x28: DebugPosition;
      f0x24: DebugPosition;
      f0x2c: DebugPosition;
      f0x6c: DebugPosition;
      f0x70PivotHeight: DebugPosition;
      u160x10: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleAction0x55 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleAction0x55';
    _io: any;

    u320x24: number;
    u160x0a: number;

    _debug: {
      u320x24: DebugPosition;
      u160x0a: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class CameoInst3 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'CameoInst3';
    _io: any;

    h0x00: number;
    i0x02: number;
    h0x06: number;
    h0x08: number;

    _debug: {
      h0x00: DebugPosition;
      i0x02: DebugPosition;
      h0x06: DebugPosition;
      h0x08: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatGoForwards0x5f {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatGoForwards0x5f';
    _io: any;

    u320x2c0x6c: number;
    u320x2c0x1c: number;
    u320xf0: number;
    u320x2c0x34: number;

    _debug: {
      u320x2c0x6c: DebugPosition;
      u320x2c0x1c: DebugPosition;
      u320xf0: DebugPosition;
      u320x2c0x34: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSpecial0x9e {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpecial0x9e';
    _io: any;

    u320x5c: number;
    u320x60: number;
    u320x65: number;
    u320x68: number;

    _debug: {
      u320x5c: DebugPosition;
      u320x60: DebugPosition;
      u320x65: DebugPosition;
      u320x68: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class EnemyInstruction {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemyInstruction';
    _io: any;

    typeCode: number;
    u160x02: number;
    body: GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionA | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionA | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionA | GloverLevel.EnemyInstructionA | GloverLevel.EnemyInstructionA | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionB | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionA | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionError | GloverLevel.EnemyInstructionA | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionA | GloverLevel.EnemyInstructionA | undefined;

    _debug: {
      typeCode: DebugPosition;
      u160x02: DebugPosition;
      body: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class SetGlobal0xb7 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'SetGlobal0xb7';
    _io: any;

    value: number;

    _debug: {
      value: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatConf0x72 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatConf0x72';
    _io: any;

    u320x00: number;
    u320x04: number;
    u320x08: number;
    u320x0c: number;
    u320x10: number;
    u320x14: number;

    _debug: {
      u320x00: DebugPosition;
      u320x04: DebugPosition;
      u320x08: DebugPosition;
      u320x0c: DebugPosition;
      u320x10: DebugPosition;
      u320x14: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleCondE {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleCondE';
    _io: any;

    i0x00: number;
    i0x04: number;
    i0x08: number;
    i0x0c: number;
    i0x10: number;

    _debug: {
      i0x00: DebugPosition;
      i0x04: DebugPosition;
      i0x08: DebugPosition;
      i0x0c: DebugPosition;
      i0x10: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Platform {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Platform';
    _io: any;

    objectId: number;
    name: string;

    _debug: {
      objectId: DebugPosition;
      name: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSpecial0xb4 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpecial0xb4';
    _io: any;

    u80x23: number;

    _debug: {
      u80x23: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatPos0xa7 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatPos0xa7';
    _io: any;

    u8Idx: number;

    _debug: {
      u8Idx: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class BackgroundActor0xbc {
    constructor(io: any, parent?: any, root?: any);
    __type: 'BackgroundActor0xbc';
    _io: any;

    objectId: number;
    name: string;
    x: number;
    y: number;
    z: number;

    _debug: {
      objectId: DebugPosition;
      name: DebugPosition;
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSpecial0x6e {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpecial0x6e';
    _io: any;

    flags: number;
    u320x70: number;

    _debug: {
      flags: DebugPosition;
      u320x70: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class CameoInstDefault {
    constructor(io: any, parent?: any, root?: any);
    __type: 'CameoInstDefault';
    _io: any;

    h0x00: number;
    h0x02: number;

    _debug: {
      h0x00: DebugPosition;
      h0x02: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleAction0x350x3b0x3c0x3d0x3e0x3f0x40';
    _io: any;

    u320x14: number;
    u320x18: number;
    u320x1c: number;
    u320x10: number;
    u160x0e: number;
    u160x0a: number;
    u320x20: number;

    _debug: {
      u320x14: DebugPosition;
      u320x18: DebugPosition;
      u320x1c: DebugPosition;
      u320x10: DebugPosition;
      u160x0e: DebugPosition;
      u160x0a: DebugPosition;
      u320x20: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleCondB {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleCondB';
    _io: any;

    i0x00: number;
    i0x04: number;
    i0x08: number;
    i0x0c: number;
    i0x10: number;
    i0x14: number;
    i0x18: number;

    _debug: {
      i0x00: DebugPosition;
      i0x04: DebugPosition;
      i0x08: DebugPosition;
      i0x0c: DebugPosition;
      i0x10: DebugPosition;
      i0x14: DebugPosition;
      i0x18: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatStr0x7a {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatStr0x7a';
    _io: any;

    u320x0c: number;
    u320x10: number;
    u320x14: number;
    u160x18: number;
    u160x1c: number;

    _debug: {
      u320x0c: DebugPosition;
      u320x10: DebugPosition;
      u320x14: DebugPosition;
      u160x18: DebugPosition;
      u160x1c: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Enemy0x84 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Enemy0x84';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class EnemyInstructionA {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemyInstructionA';
    _io: any;

    u320x02: number;
    u320x06: number;
    u320x0a: number;
    u320x0e: number;
    u320x18: number;
    u320x1e: number;
    u320x14: number;
    u320x16: number;

    _debug: {
      u320x02: DebugPosition;
      u320x06: DebugPosition;
      u320x0a: DebugPosition;
      u320x0e: DebugPosition;
      u320x18: DebugPosition;
      u320x1e: DebugPosition;
      u320x14: DebugPosition;
      u320x16: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSpecial0xb9 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpecial0xb9';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class EnemyAttackInstruction {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemyAttackInstruction';
    _io: any;

    instr: GloverLevel.EnemyInstruction;

    _debug: {
      instr: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class LandActor {
    constructor(io: any, parent?: any, root?: any);
    __type: 'LandActor';
    _io: any;

    objectId: number;
    name: string;
    x: number;
    y: number;
    z: number;

    _debug: {
      objectId: DebugPosition;
      name: DebugPosition;
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatOrbitPause0x76 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatOrbitPause0x76';
    _io: any;

    u160x08: number;
    u160x0c: number;

    _debug: {
      u160x08: DebugPosition;
      u160x0c: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class MrTip {
    constructor(io: any, parent?: any, root?: any);
    __type: 'MrTip';
    _io: any;

    x: number;
    y: number;
    z: number;
    messageId: number;

    _debug: {
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
      messageId: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PuzzleAction0x490x4d {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PuzzleAction0x490x4d';
    _io: any;

    u320x24: number;
    u320x28: number;
    u320x2c: number;
    u160x0a: number;

    _debug: {
      u320x24: DebugPosition;
      u320x28: DebugPosition;
      u320x2c: DebugPosition;
      u160x0a: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class CameoInst0 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'CameoInst0';
    _io: any;

    h0x00: number;
    h0x02: number;
    h0x04: number;
    i0x06: number;
    h0x0a: number;
    h0x0c: number;

    _debug: {
      h0x00: DebugPosition;
      h0x02: DebugPosition;
      h0x04: DebugPosition;
      i0x06: DebugPosition;
      h0x0a: DebugPosition;
      h0x0c: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Unknown0x03 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Unknown0x03';
    _io: any;

    f0x00: number;
    f0x04: number;
    f0x08: number;
    f0x0c: number;
    f0x10: number;

    _debug: {
      f0x00: DebugPosition;
      f0x04: DebugPosition;
      f0x08: DebugPosition;
      f0x0c: DebugPosition;
      f0x10: DebugPosition;
    };
  }
}

export = GloverLevel;
export as namespace GloverLevel;
