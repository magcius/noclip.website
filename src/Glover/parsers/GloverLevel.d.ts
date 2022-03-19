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

    tag: number;
    platform1Tag: number;
    platform2Tag: number;
    drawFlags: number;
    r: number;
    g: number;
    b: number;
    colorJitter: number;
    end1X: number;
    end1Y: number;
    end1Z: number;
    end2X: number;
    end2Y: number;
    end2Z: number;
    drawDiameter: number;
    drawThickness: number;

    _debug: {
      tag: DebugPosition;
      platform1Tag: DebugPosition;
      platform2Tag: DebugPosition;
      drawFlags: DebugPosition;
      r: DebugPosition;
      g: DebugPosition;
      b: DebugPosition;
      colorJitter: DebugPosition;
      end1X: DebugPosition;
      end1Y: DebugPosition;
      end1Z: DebugPosition;
      end2X: DebugPosition;
      end2Y: DebugPosition;
      end2Z: DebugPosition;
      drawDiameter: DebugPosition;
      drawThickness: DebugPosition;
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
  class PlatActorSurfaceType {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatActorSurfaceType';
    _io: any;

    value: number;

    _debug: {
      value: DebugPosition;
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
  class EnemyInstructionDash {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemyInstructionDash';
    _io: any;

    destinationX: number;
    destinationY: number;
    destinationZ: number;
    velMagnitude: number;

    _debug: {
      destinationX: DebugPosition;
      destinationY: DebugPosition;
      destinationZ: DebugPosition;
      velMagnitude: DebugPosition;
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
  class Actor0xbf {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Actor0xbf';
    _io: any;

    mode: number;
    childMeshId: number;

    _debug: {
      mode: DebugPosition;
      childMeshId: DebugPosition;
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
  class EnemyFinalize {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemyFinalize';
    _io: any;


    _debug: {
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
  class PlatConstantSpin {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatConstantSpin';
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
  class VentDutyCycle {
    constructor(io: any, parent?: any, root?: any);
    __type: 'VentDutyCycle';
    _io: any;

    framesOff: number;
    framesOn: number;

    _debug: {
      framesOff: DebugPosition;
      framesOn: DebugPosition;
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
  class SetObjectSparkle {
    constructor(io: any, parent?: any, root?: any);
    __type: 'SetObjectSparkle';
    _io: any;

    period: number;

    _debug: {
      period: DebugPosition;
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
  class EnemyInstructionTurn {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemyInstructionTurn';
    _io: any;

    lookatX: number;
    lookatY: number;
    lookatZ: number;
    chooseRandomDirection: number;

    _debug: {
      lookatX: DebugPosition;
      lookatY: DebugPosition;
      lookatZ: DebugPosition;
      chooseRandomDirection: DebugPosition;
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
  class PlatCopySpinFromParent {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatCopySpinFromParent';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class Vent {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Vent';
    _io: any;

    type: number;
    u160x0a: number;
    parentTag: number;
    originX: number;
    originY: number;
    originZ: number;
    particleVelocityX: number;
    particleVelocityY: number;
    particleVelocityZ: number;

    _debug: {
      type: DebugPosition;
      u160x0a: DebugPosition;
      parentTag: DebugPosition;
      originX: DebugPosition;
      originY: DebugPosition;
      originZ: DebugPosition;
      particleVelocityX: DebugPosition;
      particleVelocityY: DebugPosition;
      particleVelocityZ: DebugPosition;
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
  class EnemyInstructionRest {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemyInstructionRest';
    _io: any;

    flags: number;
    animStartPlaying: number;

    _debug: {
      flags: DebugPosition;
      animStartPlaying: DebugPosition;
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
  class PlatActorEnableWaterAnimation {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatActorEnableWaterAnimation';
    _io: any;


    _debug: {
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

    _debug: {
      u320x02: DebugPosition;
      u320x0e: DebugPosition;
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
  class NullPlatform {
    constructor(io: any, parent?: any, root?: any);
    __type: 'NullPlatform';
    _io: any;


    _debug: {
    };
  }
}

declare namespace GloverLevel {
  class Powerup {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Powerup';
    _io: any;

    type: number;
    u160x02: number;
    u160x04: number;
    x: number;
    y: number;
    z: number;

    _debug: {
      type: DebugPosition;
      u160x02: DebugPosition;
      u160x04: DebugPosition;
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatformConveyor {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatformConveyor';
    _io: any;

    velX: number;
    velY: number;
    velZ: number;

    _debug: {
      velX: DebugPosition;
      velY: DebugPosition;
      velZ: DebugPosition;
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
  class PlatCheckpoint {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatCheckpoint';
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

    type: number;
    x: number;
    y: number;
    z: number;

    _debug: {
      type: DebugPosition;
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
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
    params: GloverLevel.Plat0x78 | GloverLevel.Rope | GloverLevel.NullPlatform | GloverLevel.PlatOrbitPause | GloverLevel.Plat0x9f | GloverLevel.PlatSound0xc2 | GloverLevel.PlatSpecial0xb8 | GloverLevel.PlatCat0x69 | GloverLevel.PlatSpecial0x8e | GloverLevel.PlatRocking | GloverLevel.VentDutyCycle | GloverLevel.Enemy | GloverLevel.PlatPos0xa7 | GloverLevel.LandActor | GloverLevel.Puzzle | GloverLevel.Unknown0xa9 | GloverLevel.Vent | GloverLevel.PlatMvspn0x74 | GloverLevel.PlatOrbitFlip0x77 | GloverLevel.PuzzleOr | GloverLevel.PuzzleNumtimes | GloverLevel.PlatSetParent | GloverLevel.PlatScale | GloverLevel.LookAtHand0x60 | GloverLevel.Actor0xbf | GloverLevel.GloverSpawnPoint | GloverLevel.PuzzleAction | GloverLevel.LookAtBall0x61 | GloverLevel.PlatActorSurfaceType | GloverLevel.BackgroundActor | GloverLevel.PlatDestructible | GloverLevel.PlatSine | GloverLevel.PlatConstantSpin | GloverLevel.PlatNoClip | GloverLevel.PuzzleCond | GloverLevel.PlatMvspn0x73 | GloverLevel.PlatPush0x5b | GloverLevel.PlatPathPoint | GloverLevel.PlatOrbit | GloverLevel.PlatMvspn0x59 | GloverLevel.PlatformConveyor | GloverLevel.Platform | GloverLevel.PlatSpinSound0xc5 | GloverLevel.PlatGoForwards0x5f | GloverLevel.SetTeleport | GloverLevel.PlatMvspn0x58 | GloverLevel.EnemySetAttentionBbox | GloverLevel.PlatFan0x8a | GloverLevel.CameraSpawnPoint | GloverLevel.PlatPlayObjectAnimation | GloverLevel.Plat0x7e | GloverLevel.FogConfiguration | GloverLevel.PuzzleAnd | GloverLevel.PlatCrumb0x67 | GloverLevel.PlatCheckpoint | GloverLevel.PlatSpecial0xb9 | GloverLevel.SetObjectSparkle | GloverLevel.EnemyAttackInstruction | GloverLevel.PlatSpinFlip | GloverLevel.Enemy0xba | GloverLevel.AnimatedBackgroundActor | GloverLevel.Backdrop | GloverLevel.PlatCopySpinFromParent | GloverLevel.Water | GloverLevel.PuzzleAny | GloverLevel.PlatSetInitialPos | GloverLevel.PlatConf0x72 | GloverLevel.Buzzer | GloverLevel.SetActorScale | GloverLevel.PlatSpecial0x9e | GloverLevel.PlatOrbitAroundPoint | GloverLevel.AmbientLight | GloverLevel.Unrecognized | GloverLevel.PlatPathAcceleration | GloverLevel.EndLevelData | GloverLevel.Wind | GloverLevel.PlatStr0x7a | GloverLevel.PlatActorEnableWaterAnimation | GloverLevel.Plat0xc3 | GloverLevel.PlatSpike | GloverLevel.MrTip | GloverLevel.Cameo | GloverLevel.PlatSpecial0xc7 | GloverLevel.Plat0xa4 | GloverLevel.BuzzerDutyCycle | GloverLevel.PlatMaxVelocity | GloverLevel.UnknownSound0xbd | GloverLevel.SetExit | GloverLevel.CameoInst | GloverLevel.PlatSound0xc1 | GloverLevel.GaribGroup | GloverLevel.PlatTopple0x81 | GloverLevel.DiffuseLight | GloverLevel.Plat0x9d | GloverLevel.SetActorRotation | GloverLevel.Garib | GloverLevel.Plat0x66 | GloverLevel.PlatSpecial0x6e | GloverLevel.PlatMagnet0x8b | GloverLevel.EnemyConditionalInstruction | GloverLevel.BallSpawnPoint | GloverLevel.Powerup | GloverLevel.PlatSpinPause0x7c | GloverLevel.PlatDestructibleSound | GloverLevel.EnemyFinalize | GloverLevel.PlatVentAdvanceFrames | GloverLevel.Plat0xc6 | GloverLevel.PlatSetTag | GloverLevel.EnvironmentalSound | GloverLevel.PlatOrbitSound0xc4 | GloverLevel.SetGlobal0xb7 | GloverLevel.PlatSpin0x80 | GloverLevel.PlatMvspn0x5a | GloverLevel.EnemyNormalInstruction | undefined;

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

    left: number;
    top: number;
    front: number;
    width: number;
    height: number;
    depth: number;
    velX: number;
    velY: number;
    velZ: number;
    turbulence: number;
    unknown0x2c: number;
    active: number;
    tag: number;

    _debug: {
      left: DebugPosition;
      top: DebugPosition;
      front: DebugPosition;
      width: DebugPosition;
      height: DebugPosition;
      depth: DebugPosition;
      velX: DebugPosition;
      velY: DebugPosition;
      velZ: DebugPosition;
      turbulence: DebugPosition;
      unknown0x2c: DebugPosition;
      active: DebugPosition;
      tag: DebugPosition;
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
    numFragments: number;
    fragmentObjectId: number;
    name: string;

    _debug: {
      flags: DebugPosition;
      numFragments: DebugPosition;
      fragmentObjectId: DebugPosition;
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
  class PlatNoClip {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatNoClip';
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
  class PlatOrbitSound0xc4 {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatOrbitSound0xc4';
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

    type: GloverLevel.Enemy.EnemyType;
    u1: number;
    x: number;
    y: number;
    z: number;
    yRotation: number;

    _debug: {
      type: DebugPosition & { enumName: string; };
      u1: DebugPosition;
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
      yRotation: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  namespace Enemy {
    enum EnemyType {
      BOVVA = 7,
      CANNON = 8,
      SAMTEX = 9,
      MALLET = 10,
      GENERALW = 11,
      LIONFISH = 12,
      CHESTER = 13,
      KEG = 14,
      REGGIE = 15,
      SWISH = 16,
      THRICE = 17,
      ROBES = 18,
      FUMBLE = 19,
      MIKE = 20,
      RAPTOR = 21,
      CRUMPET = 22,
      TRACEY = 23,
      YOOFOW = 24,
      OPEC = 25,
      CYMON = 26,
      SUCKER = 27,
      BUGLE = 28,
      DENNIS = 29,
      CHUCK = 30,
      HUBCHICKEN1 = 31,
      FRANKIE2 = 32,
      KLOSET = 33,
      WILLY = 34,
      JOFF = 35,
      CANCER = 36,
      KIRK = 37,
      ROBOT = 38,
      EVILROBOT = 39,
      SPANK = 40,
      BABYSPK2 = 41,
      EVILGLOVE = 42,
      DIBBER = 43,
      BRUNDLE = 44,
      MALCOM = 45,
      SPOTTY = 46,
      GORDON = 47,
      SIDNEY = 48,
      WEEVIL = 49,
      CHOPSTIK = 50,
      BUTTERFLY = 51,
      SPIDER = 52,
      BAT = 53,
      FROG = 54,
      DRAGFLY = 55,
      BOXTHING = 56,
      BUG = 57,
      NMEFROG = 58,
    }
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
  class PlatOrbitPause {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatOrbitPause';
    _io: any;

    numFrames: number;
    numPauses: number;

    _debug: {
      numFrames: DebugPosition;
      numPauses: DebugPosition;
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
    dynamicShadow: number;

    _debug: {
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
      type: DebugPosition;
      dynamicShadow: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class GaribGroup {
    constructor(io: any, parent?: any, root?: any);
    __type: 'GaribGroup';
    _io: any;

    puzzleIdentifier0xd2: number;
    initialState: number;

    _debug: {
      puzzleIdentifier0xd2: DebugPosition;
      initialState: DebugPosition;
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
  class AnimatedBackgroundActor {
    constructor(io: any, parent?: any, root?: any);
    __type: 'AnimatedBackgroundActor';
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
  class BackgroundActor {
    constructor(io: any, parent?: any, root?: any);
    __type: 'BackgroundActor';
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
  class EnemyInstructionMove {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemyInstructionMove';
    _io: any;

    destinationX: number;
    destinationY: number;
    destinationZ: number;
    velMagnitude: number;

    _debug: {
      destinationX: DebugPosition;
      destinationY: DebugPosition;
      destinationZ: DebugPosition;
      velMagnitude: DebugPosition;
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
  class PlatRocking {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatRocking';
    _io: any;

    axis: number;
    theta: number;
    deceleration: number;
    blurHeight: number;
    frameAdvance: number;

    _debug: {
      axis: DebugPosition;
      theta: DebugPosition;
      deceleration: DebugPosition;
      blurHeight: DebugPosition;
      frameAdvance: DebugPosition;
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
  class GloverSpawnPoint {
    constructor(io: any, parent?: any, root?: any);
    __type: 'GloverSpawnPoint';
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
  class BuzzerDutyCycle {
    constructor(io: any, parent?: any, root?: any);
    __type: 'BuzzerDutyCycle';
    _io: any;

    framesOff: number;
    framesOn: number;

    _debug: {
      framesOff: DebugPosition;
      framesOn: DebugPosition;
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
  class PlatPlayObjectAnimation {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatPlayObjectAnimation';
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
  class EnemyInstructionPlayAnimation {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemyInstructionPlayAnimation';
    _io: any;

    animIdx1: number;
    animIdx2: number;

    _debug: {
      animIdx1: DebugPosition;
      animIdx2: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class EnemyInstructionRandomWalk {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemyInstructionRandomWalk';
    _io: any;

    homeX: number;
    homeY: number;
    homeZ: number;
    extentX: number;
    extentY: number;
    extentZ: number;
    minTravelDistance: number;

    _debug: {
      homeX: DebugPosition;
      homeY: DebugPosition;
      homeZ: DebugPosition;
      extentX: DebugPosition;
      extentY: DebugPosition;
      extentZ: DebugPosition;
      minTravelDistance: DebugPosition;
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

    instrType: number;
    lifetime: number;
    params: GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionA | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionMove | GloverLevel.EnemyInstructionRest | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionPlayAnimation | GloverLevel.EnemyInstructionDash | GloverLevel.EnemyInstructionA | GloverLevel.EnemyInstructionA | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionRandomWalk | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionA | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionError | GloverLevel.EnemyInstructionA | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionC | GloverLevel.EnemyInstructionGoto | GloverLevel.EnemyInstructionTurn | GloverLevel.EnemyInstructionA | undefined;
    executionConditionParamA: number;
    executionConditionParamB: number;
    flags: GloverLevel.EnemyInstruction.InstructionFlags;
    executionCondition: GloverLevel.EnemyInstruction.ExecutionConditionType;

    _debug: {
      instrType: DebugPosition;
      lifetime: DebugPosition;
      params: DebugPosition;
      executionConditionParamA: DebugPosition;
      executionConditionParamB: DebugPosition;
      flags: DebugPosition & { enumName: string; };
      executionCondition: DebugPosition & { enumName: string; };
    };
  }
}

declare namespace GloverLevel {
  namespace EnemyInstruction {
    enum ExecutionConditionType {
      BALL_WITHIN_RANGE = 0,
      BALL_WITHIN_GROUND_RANGE = 1,
      GLOVER_WITHIN_RANGE = 2,
      GLOVER_WITHIN_GROUND_RANGE = 3,
      BALL_OR_GLOVER_WITHIN_RANGE = 4,
      BALL_OR_GLOVER_WITHIN_GROUND_RANGE = 5,
      BALL_WITHIN_ANGLE_OF_VIEW = 6,
      GLOVER_WITHIN_ANGLE_OF_VIEW = 7,
      BALL_OR_GLOVER_WITHIN_ANGLE_OF_VIEW = 8,
      PERIODIC = 9,
      ROLL_ANGLE_WITHIN_RANGE_AND_PERIODIC = 10,
      GLOVER_HOLDING_BALL = 11,
      GLOVER_NOT_HOLDING_BALL = 12,
      ENEMY_HOLDING_BALL = 13,
      ENEMY_NOT_HOLDING_BALL = 14,
      GLOVER_HOLDING_ENEMY = 15,
      GLOVER_NOT_HOLDING_ENEMY = 16,
      ON_BALL = 17,
      ON_GLOVER = 18,
      ENEMY_WITHIN_ATTENTION_BBOX = 19,
      ALWAYS = 20,
      NEVER = 21,
      RANDOM_CHANCE_PARAM_A_OVER_1000 = 22,
    }
  }
}

declare namespace GloverLevel {
  namespace EnemyInstruction {
    enum InstructionFlags {
      FACE_PLAYER = 1048576,
      FACE_BALL = 2097152,
      FACE_CLOSER_OF_PLAYER_OR_BALL = 4194304,
    }
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
  class PlatOrbitAroundPoint {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatOrbitAroundPoint';
    _io: any;

    axis: number;
    x: number;
    y: number;
    z: number;
    speed: number;

    _debug: {
      axis: DebugPosition;
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
      speed: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class Rope {
    constructor(io: any, parent?: any, root?: any);
    __type: 'Rope';
    _io: any;

    numComponents: number;
    wiggleAxis: number;
    componentObjId: number;
    name: string;
    puzzleUnknown1: number;
    swayUnknown1: number;
    swayUnknown2: number;
    swayUnknown3: number;
    swayRockingTheta: number;
    swayUnknown4: number;
    swayUnknown5: number;
    x: number;
    y: number;
    z: number;
    componentW: number;
    componentH: number;
    componentD: number;

    _debug: {
      numComponents: DebugPosition;
      wiggleAxis: DebugPosition;
      componentObjId: DebugPosition;
      name: DebugPosition;
      puzzleUnknown1: DebugPosition;
      swayUnknown1: DebugPosition;
      swayUnknown2: DebugPosition;
      swayUnknown3: DebugPosition;
      swayRockingTheta: DebugPosition;
      swayUnknown4: DebugPosition;
      swayUnknown5: DebugPosition;
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
      componentW: DebugPosition;
      componentH: DebugPosition;
      componentD: DebugPosition;
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
  class EnemyInstructionGoto {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemyInstructionGoto';
    _io: any;

    instrIdx: number;
    unused: number;

    _debug: {
      instrIdx: DebugPosition;
      unused: DebugPosition;
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

    _debug: {
      u320x02: DebugPosition;
      u320x06: DebugPosition;
      u320x0a: DebugPosition;
      u320x0e: DebugPosition;
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
  class CameraSpawnPoint {
    constructor(io: any, parent?: any, root?: any);
    __type: 'CameraSpawnPoint';
    _io: any;

    x: number;
    y: number;
    z: number;
    pitch: number;
    yaw: number;

    _debug: {
      x: DebugPosition;
      y: DebugPosition;
      z: DebugPosition;
      pitch: DebugPosition;
      yaw: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class PlatSpinFlip {
    constructor(io: any, parent?: any, root?: any);
    __type: 'PlatSpinFlip';
    _io: any;

    cooldownTimer: number;
    theta: number;

    _debug: {
      cooldownTimer: DebugPosition;
      theta: DebugPosition;
    };
  }
}

declare namespace GloverLevel {
  class EnemySetAttentionBbox {
    constructor(io: any, parent?: any, root?: any);
    __type: 'EnemySetAttentionBbox';
    _io: any;

    left: number;
    top: number;
    front: number;
    width: number;
    height: number;
    depth: number;

    _debug: {
      left: DebugPosition;
      top: DebugPosition;
      front: DebugPosition;
      width: DebugPosition;
      height: DebugPosition;
      depth: DebugPosition;
    };
  }
}

export = GloverLevel;
export as namespace GloverLevel;
