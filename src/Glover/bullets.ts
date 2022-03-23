import * as Textures from './textures';
import * as Viewer from '../viewer';

import { GenericRenderable, SceneLighting } from './render';
import { Flipbook, ParticlePool, framesets } from './particles';
import { GloverFlipbookRenderer } from './sprite';
import { GloverActorRenderer } from './actor';
import { ObjectDirectory, GloverWaterVolume } from './scenes';
import { SRC_FRAME_TO_MS } from './timing';
import { hashStr } from './util';

import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";

import { mat4, vec3, vec4, quat } from 'gl-matrix';
import { assert } from '../util';

const identityRotation: quat = quat.create();

var bulletFlipbooks:Flipbook[] = [
  { // 0 (+0x00)
    frameset: framesets["sfair"],
    frameDelay: 0,
    type: 3,
    startAlpha: 255,
    endAlpha: 160,
    startSize: 192,
    endSize: 192,
    flags: 0x10000,
  },
  { // 1 (+0x10)
    frameset: framesets["fardus"],
    frameDelay: 0,
    type: 3,
    startAlpha: 255,
    endAlpha: 200,
    startSize: 160,
    endSize: 160,
    flags: 0x10000,
  },
  { // 2 (+0x20)
    frameset: framesets["smk"],
    frameDelay: 16,
    type: 2,
    startAlpha: 200,
    endAlpha: 32,
    startSize: 128,
    endSize: 128,
    flags: 0x10000,
  },
  { // 3 (+0x30)
    frameset: framesets["egg"],
    frameDelay: 0,
    type: 4,
    startAlpha: 255,
    endAlpha: 255,
    startSize: 48,
    endSize: 48,
    flags: 0x0,
  },
  { // 4 (+0x40)
    frameset: framesets["tear"],
    frameDelay: 0,
    type: 5,
    startAlpha: 160,
    endAlpha: 160,
    startSize: 16,
    endSize: 48,
    flags: 0x10000,
  },
  { // 5 (+0x50)
    frameset: framesets["smk"],
    frameDelay: 64,
    type: 2,
    startAlpha: 190,
    endAlpha: 100,
    startSize: 128,
    endSize: 128,
    flags: 0x10000,
  },
  { // 6 (+0x60)
    frameset: framesets["firea"],
    frameDelay: 0,
    type: 5,
    startAlpha: 140,
    endAlpha: 20,
    startSize: 25,
    endSize: 120,
    flags: 0x10000,
  },
  { // 7 (+0x70)
    frameset: framesets["fireb"],
    frameDelay: 32,
    type: 2,
    startAlpha: 200,
    endAlpha: 30,
    startSize: 40,
    endSize: 80,
    flags: 0x10000,
  },
  { // 8 (+0x80)
    frameset: framesets["balls"],
    frameDelay: 0,
    type: 0,
    startAlpha: 255,
    endAlpha: 255,
    startSize: 64,
    endSize: 64,
    flags: 0x0,
  },
  { // 9 (+0x90)
    frameset: framesets["cross"],
    frameDelay: 0,
    type: 1,
    startAlpha: 160,
    endAlpha: 160,
    startSize: 32,
    endSize: 32,
    flags: 0x10000,
  }
]

// TODO: once finalized, export an interface:
var bulletParameters = [
  {"actorBeh0x0": 0.009999999776482582, "actorBehMobility": 15.0, "actorDecel0x70": 1.0, "actorFlags": 0x0, "actorMaximumRadius": 7.0, "bulletFlags": 0x1, "flipbook1Color": {"a": 0, "b": 0, "g": 128, "r": 255}, "flipbook1Idx": 0, "flipbook1Ptr": 2149515920, "flipbook2Color": {"a": 0, "b": 255, "g": 255, "r": 255}, "flipbook2Idx": 1, "flipbook2Ptr": 2149515936, "destroyFunc": 0, "frameAdvanceFunc": 0, "lifetime": 5000, "name": "", "numBillboards": 2, "objectPtr": 0, "trailParticleType": 10, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 65, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 65, 48, 0, 0, 65, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 1.0, "unk0x8c": 0.03999999910593033, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 17}, 
  {"actorBeh0x0": 0.009999999776482582, "actorBehMobility": 10.0, "actorDecel0x70": 1.0, "actorFlags": 0x0, "actorMaximumRadius": 7.0, "bulletFlags": 0x2, "flipbook1Color": {"a": 0, "b": 255, "g": 160, "r": 0}, "flipbook1Idx": 0, "flipbook1Ptr": 2149515920, "flipbook2Color": {"a": 0, "b": 255, "g": 255, "r": 255}, "flipbook2Idx": 1, "flipbook2Ptr": 2149515936, "destroyFunc": 0, "frameAdvanceFunc": 0, "lifetime": 5000, "name": "", "numBillboards": 2, "objectPtr": 0, "trailParticleType": 12, "unk0x16": 0, "unk0x28": [191, 128, 0, 0, 65, 0, 0, 0, 63, 128, 0, 0, 63, 128, 0, 0, 65, 0, 0, 0, 63, 128, 0, 0, 191, 128, 0, 0, 65, 0, 0, 0, 191, 128, 0, 0, 63, 128, 0, 0, 65, 0, 0, 0, 191, 128, 0, 0, 65, 32, 0, 0, 64, 224, 0, 0, 64, 160, 0, 0, 193, 32, 0, 0, 64, 224, 0, 0, 64, 160, 0, 0, 65, 32, 0, 0, 64, 224, 0, 0, 192, 160, 0, 0, 193, 32, 0, 0, 64, 224, 0, 0, 192, 160, 0, 0], "unk0x88": 0.5, "unk0x8c": 0.019999999552965164, "unk0x91": 24, "unk0x92": 4, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 40, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 18}, 
  {"actorBeh0x0": 0.009999999776482582, "actorBehMobility": 15.0, "actorDecel0x70": 1.0, "actorFlags": 0x98, "actorMaximumRadius": 7.0, "bulletFlags": 0x4, "flipbook1Color": {"a": 0, "b": 200, "g": 0, "r": 255}, "flipbook1Idx": 0, "flipbook1Ptr": 2149515920, "flipbook2Color": {"a": 0, "b": 255, "g": 255, "r": 255}, "flipbook2Idx": 1, "flipbook2Ptr": 2149515936, "destroyFunc": 2149231952, "frameAdvanceFunc": 0, "lifetime": 100, "name": "", "numBillboards": 2, "objectPtr": 0, "trailParticleType": 10, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 65, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 224, 0, 0, 64, 224, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.4000000059604645, "unk0x8c": 0.019999999552965164, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 1092616192, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 17}, 
  {"actorBeh0x0": 0.0, "actorBehMobility": 30.0, "actorDecel0x70": 1.0, "actorFlags": 0x20000, "actorMaximumRadius": 7.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 255, "g": 255, "r": 255}, "flipbook1Idx": -1, "flipbook1Ptr": 2149515904, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 0, "frameAdvanceFunc": 0, "lifetime": 6, "name": "", "numBillboards": 1, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 64, 160, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 160, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 192, 224, 0, 0, 192, 128, 0, 0, 0, 0, 0, 0, 64, 224, 0, 0, 192, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 2, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 13}, 

  // Fire 1
  {"actorBeh0x0": 3.0, "actorBehMobility": 50.0, "actorDecel0x70": 1.0, "actorFlags": 0x60000, "actorMaximumRadius": 5.0, "bulletFlags": 0x10, "flipbook1Color": {"a": 0, "b": 0, "g": 200, "r": 255}, "flipbook1Idx": 6, "flipbook1Ptr": 2149516016, "flipbook2Color": {"a": 0, "b": 255, "g": 255, "r": 255}, "flipbook2Idx": 7, "flipbook2Ptr": 2149516032, "destroyFunc": 0, "frameAdvanceFunc": 0, "lifetime": 16, "name": "", "numBillboards": 2, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 1}, 
  
  {"actorBeh0x0": 1.0, "actorBehMobility": 15.0, "actorDecel0x70": 1.0, "actorFlags": 0x60000, "actorMaximumRadius": 5.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 255, "g": 255, "r": 255}, "flipbook1Idx": 2, "flipbook1Ptr": 2149515952, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 0, "frameAdvanceFunc": 0, "lifetime": 0, "name": "", "numBillboards": 1, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 1}, 

  // Fire 2
  {"actorBeh0x0": 3.0, "actorBehMobility": 15.0, "actorDecel0x70": 1.0, "actorFlags": 0x60000, "actorMaximumRadius": 5.0, "bulletFlags": 0x10, "flipbook1Color": {"a": 0, "b": 0, "g": 180, "r": 255}, "flipbook1Idx": 6, "flipbook1Ptr": 2149516016, "flipbook2Color": {"a": 0, "b": 255, "g": 255, "r": 255}, "flipbook2Idx": 7, "flipbook2Ptr": 2149516032, "destroyFunc": 0, "frameAdvanceFunc": 0, "lifetime": 16, "name": "", "numBillboards": 2, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 192, 64, 0, 0, 65, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 0, 0, 193, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 5}, 
  
  {"actorBeh0x0": 0.009999999776482582, "actorBehMobility": 5.0, "actorDecel0x70": 1.0, "actorFlags": 0x20000, "actorMaximumRadius": 7.0, "bulletFlags": 0x2, "flipbook1Color": {"a": 0, "b": 50, "g": 255, "r": 50}, "flipbook1Idx": 0, "flipbook1Ptr": 2149515920, "flipbook2Color": {"a": 0, "b": 255, "g": 255, "r": 255}, "flipbook2Idx": 1, "flipbook2Ptr": 2149515936, "destroyFunc": 0, "frameAdvanceFunc": 0, "lifetime": 70, "name": "", "numBillboards": 2, "objectPtr": 0, "trailParticleType": 10, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 65, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 193, 96, 0, 0, 65, 224, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.20000000298023224, "unk0x8c": 0.019999999552965164, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 1092616192, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 17}, 
  {"actorBeh0x0": 3.0, "actorBehMobility": 10.0, "actorDecel0x70": 1.0, "actorFlags": 0x60090, "actorMaximumRadius": 5.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 255, "g": 255, "r": 255}, "flipbook1Idx": -1, "flipbook1Ptr": 2149515904, "flipbook2Color": {"a": 0, "b": 255, "g": 255, "r": 255}, "flipbook2Idx": 1, "flipbook2Ptr": 2149515936, "destroyFunc": 2149231952, "frameAdvanceFunc": 0, "lifetime": 30, "name": "", "numBillboards": 1, "objectPtr": 0, "trailParticleType": 11, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 193, 128, 0, 0, 65, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 65, 176, 0, 0, 65, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 1}, 
  {"actorBeh0x0": 3.0, "actorBehMobility": 30.0, "actorDecel0x70": 0.949999988079071, "actorFlags": 0x20191, "actorMaximumRadius": 5.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 255, "g": 255, "r": 255}, "flipbook1Idx": 3, "flipbook1Ptr": 2149515968, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 2149231420, "frameAdvanceFunc": 0, "lifetime": 60, "name": "", "numBillboards": 1, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 65, 32, 0, 0, 65, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 192, 224, 0, 0, 193, 96, 0, 0, 193, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 17, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 2}, 
  {"actorBeh0x0": 3.0, "actorBehMobility": 30.0, "actorDecel0x70": 1.0, "actorFlags": 0x60010, "actorMaximumRadius": 1.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": null, "flipbook1Ptr": 0, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 2149232124, "frameAdvanceFunc": 2149239760, "lifetime": 60, "name": "sting.ndo", "numBillboards": 0, "objectPtr": 2151286012, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 193, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 193, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 1}, 
  {"actorBeh0x0": 5.0, "actorBehMobility": 1.5, "actorDecel0x70": 0.8999999761581421, "actorFlags": 0x118, "actorMaximumRadius": 27.0, "bulletFlags": 0x2, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": null, "flipbook1Ptr": 0, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 0, "frameAdvanceFunc": 2149238040, "lifetime": 250, "name": "bubble2.ndo", "numBillboards": 0, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 63, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 192, 160, 0, 0, 65, 160, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.4000000059604645, "unk0x8c": 0.03999999910593033, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 1092616192, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 33}, 
  {"actorBeh0x0": 3.0, "actorBehMobility": 2.5, "actorDecel0x70": 1.0, "actorFlags": 0x110, "actorMaximumRadius": 13.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": null, "flipbook1Ptr": 0, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 0, "frameAdvanceFunc": 2149237656, "lifetime": 1000, "name": "bubble1.ndo", "numBillboards": 0, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 63, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 192, 160, 0, 0, 65, 160, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.20000000298023224, "unk0x8c": 0.03999999910593033, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 33}, 
  
  // Fountain
  {"actorBeh0x0": 4.0, "actorBehMobility": 30.0, "actorDecel0x70": 0.949999988079071, "actorFlags": 0x80000c1, "actorMaximumRadius": 5.0, "bulletFlags": 0x2, "flipbook1Color": {"a": 0, "b": 255, "g": 255, "r": 255}, "flipbook1Idx": 4, "flipbook1Ptr": 2149515984, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 0x801aacd4, "frameAdvanceFunc": 0x801ac2f4, "lifetime": 1000, "name": "", "numBillboards": 1, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 191, 128, 0, 0, 65, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 65, 160, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.10000000149011612, "unk0x8c": 0.10000000149011612, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0x40c00000, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 6}, 

  {"actorBeh0x0": 4.0, "actorBehMobility": 30.0, "actorDecel0x70": 1.0, "actorFlags": 0x60090, "actorMaximumRadius": 10.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": null, "flipbook1Ptr": 0, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 2149231952, "frameAdvanceFunc": 0, "lifetime": 1000, "name": "cancerclaw.ndo", "numBillboards": 0, "objectPtr": 0, "trailParticleType": 1, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 65, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 65, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 2, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 69}, 
  {"actorBeh0x0": 20.0, "actorBehMobility": 30.0, "actorDecel0x70": 0.9800000190734863, "actorFlags": 0x19, "actorMaximumRadius": 10.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": null, "flipbook1Ptr": 0, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 0, "frameAdvanceFunc": 2149236024, "lifetime": 200, "name": "bomb.ndo", "numBillboards": 0, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 65, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 66}, 
  {"actorBeh0x0": 2.0, "actorBehMobility": 30.0, "actorDecel0x70": 0.9599999785423279, "actorFlags": 0x20099, "actorMaximumRadius": 20.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": null, "flipbook1Ptr": 0, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 2149231496, "frameAdvanceFunc": 0, "lifetime": 200, "name": "klospie.ndo", "numBillboards": 0, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 65, 0, 0, 0, 65, 96, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 63, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 17, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 66}, 
  {"actorBeh0x0": 3.0, "actorBehMobility": 15.0, "actorDecel0x70": 0.949999988079071, "actorFlags": 0x0, "actorMaximumRadius": 5.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": 5, "flipbook1Ptr": 2149516000, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 0, "frameAdvanceFunc": 0, "lifetime": 0, "name": "", "numBillboards": 1, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 1}, 
  {"actorBeh0x0": 999999.0, "actorBehMobility": 50.0, "actorDecel0x70": 1.0, "actorFlags": 0x8000139, "actorMaximumRadius": 17.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": null, "flipbook1Ptr": 0, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 2149231664, "frameAdvanceFunc": 2149234060, "lifetime": 500, "name": "snowball.ndo", "numBillboards": 0, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 1}, 
  {"actorBeh0x0": 100000.0, "actorBehMobility": 50.0, "actorDecel0x70": 1.0, "actorFlags": 0x88080139, "actorMaximumRadius": 17.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": null, "flipbook1Ptr": 0, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 2149231568, "frameAdvanceFunc": 2149232812, "lifetime": 500, "name": "boulder.ndo", "numBillboards": 0, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 1}, 
  {"actorBeh0x0": 100000.0, "actorBehMobility": 50.0, "actorDecel0x70": 1.0, "actorFlags": 0xc0199, "actorMaximumRadius": 17.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": null, "flipbook1Ptr": 0, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 2149231376, "frameAdvanceFunc": 0, "lifetime": 500, "name": "pre1tooth.ndo", "numBillboards": 0, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 1}, 
  {"actorBeh0x0": 100000.0, "actorBehMobility": 50.0, "actorDecel0x70": 0.8999999761581421, "actorFlags": 0x260109, "actorMaximumRadius": 9.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 255, "g": 255, "r": 255}, "flipbook1Idx": 8, "flipbook1Ptr": 2149516048, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 0, "frameAdvanceFunc": 0, "lifetime": 500, "name": "", "numBillboards": 1, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 1}, 
  {"actorBeh0x0": 10.0, "actorBehMobility": 50.0, "actorDecel0x70": 1.0, "actorFlags": 0x4031, "actorMaximumRadius": 9.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": null, "flipbook1Ptr": 0, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 0, "frameAdvanceFunc": 2149233668, "lifetime": 60, "name": "gball.ndo", "numBillboards": 0, "objectPtr": 2151285956, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 65, 240, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 193, 192, 0, 0, 65, 96, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 1}, 
  {"actorBeh0x0": 100000.0, "actorBehMobility": 50.0, "actorDecel0x70": 1.0, "actorFlags": 0x8180139, "actorMaximumRadius": 25.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": null, "flipbook1Ptr": 0, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 2149231616, "frameAdvanceFunc": 2149232960, "lifetime": 500, "name": "fireball.ndo", "numBillboards": 0, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 65, 176, 0, 0, 65, 240, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 65, 0, 0, 0, 64, 160, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 1}, 
  {"actorBeh0x0": 3.0, "actorBehMobility": 50.0, "actorDecel0x70": 1.0, "actorFlags": 0x8004199, "actorMaximumRadius": 12.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": null, "flipbook1Ptr": 0, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 2149231256, "frameAdvanceFunc": 0, "lifetime": 100, "name": "cannon.ndo", "numBillboards": 0, "objectPtr": 2151286040, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 1}, 
  {"actorBeh0x0": 10.0, "actorBehMobility": 50.0, "actorDecel0x70": 1.0, "actorFlags": 0x1004039, "actorMaximumRadius": 36.0, "bulletFlags": 0x0, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": null, "flipbook1Ptr": 0, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 2149230760, "frameAdvanceFunc": 2149233392, "lifetime": 60, "name": "gball.ndo", "numBillboards": 0, "objectPtr": 2151285956, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 65, 32, 0, 0, 66, 190, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 65, 32, 0, 0, 65, 96, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.0, "unk0x8c": 0.0, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 1}, 
  {"actorBeh0x0": 9.999999747378752e-05, "actorBehMobility": 50.0, "actorDecel0x70": 1.0, "actorFlags": 0x20080, "actorMaximumRadius": 46.0, "bulletFlags": 0x2, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": null, "flipbook1Ptr": 0, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 2149230804, "frameAdvanceFunc": 2149232584, "lifetime": 80, "name": "missile.ndo", "numBillboards": 0, "objectPtr": 0, "trailParticleType": 12, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 65, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 65, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 128, 0, 0, 0, 0, 0, 0, 66, 200, 0, 0, 64, 160, 0, 0, 0, 0, 0, 0, 66, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.6000000238418579, "unk0x8c": 0.019999999552965164, "unk0x91": 24, "unk0x92": 2, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 65}, 
  {"actorBeh0x0": 10.0, "actorBehMobility": 90.0, "actorDecel0x70": 1.0, "actorFlags": 0x20000, "actorMaximumRadius": 36.0, "bulletFlags": 0x2, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": null, "flipbook1Ptr": 0, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 2149230412, "frameAdvanceFunc": 2149232804, "lifetime": 40, "name": "bolt.ndo", "numBillboards": 0, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 193, 160, 0, 0, 66, 160, 0, 0, 0, 0, 0, 0, 193, 160, 0, 0, 66, 160, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 65, 240, 0, 0, 65, 160, 0, 0, 0, 0, 0, 0, 65, 240, 0, 0, 65, 160, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 2.0, "unk0x8c": 0.05000000074505806, "unk0x91": 24, "unk0x92": 2, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 0, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 1}, 
  {"actorBeh0x0": 20.0, "actorBehMobility": 30.0, "actorDecel0x70": 0.9800000190734863, "actorFlags": 0x11, "actorMaximumRadius": 30.0, "bulletFlags": 0x2, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook1Idx": null, "flipbook1Ptr": 0, "flipbook2Color": {"a": 0, "b": 0, "g": 0, "r": 0}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 2149232092, "frameAdvanceFunc": 2149234828, "lifetime": 400, "name": "spiderbomb.ndo", "numBillboards": 0, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 193, 0, 0, 0, 0, 0, 0, 0, 193, 144, 0, 0, 193, 0, 0, 0, 0, 0, 0, 0, 65, 144, 0, 0, 193, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 193, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 193, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 193, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 0.5, "unk0x8c": 0.009999999776482582, "unk0x91": 24, "unk0x92": 3, "unk0x93": 0, "unk0x98": 0, "unk0x9e": 65486, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 34}, 
  {"actorBeh0x0": 0.009999999776482582, "actorBehMobility": 15.0, "actorDecel0x70": 1.0, "actorFlags": 0x18, "actorMaximumRadius": 2.0, "bulletFlags": 0x4, "flipbook1Color": {"a": 0, "b": 0, "g": 0, "r": 255}, "flipbook1Idx": 453, "flipbook1Ptr": 2149523172, "flipbook2Color": {"a": 0, "b": 255, "g": 255, "r": 255}, "flipbook2Idx": null, "flipbook2Ptr": 0, "destroyFunc": 0, "frameAdvanceFunc": 0, "lifetime": 400, "name": "", "numBillboards": 1, "objectPtr": 0, "trailParticleType": 24, "unk0x16": 0, "unk0x28": [0, 0, 0, 0, 0, 0, 0, 0, 65, 112, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 191, 0, 0, 0, 192, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "unk0x88": 8.0, "unk0x8c": 0.800000011920929, "unk0x91": 24, "unk0x92": 1, "unk0x93": 0, "unk0x98": 1092616192, "unk0x9e": 500, "unk0xa1": 0, "unk0xa2": 0, "unk0xa3": 0, "bulletParamFlags": 33}
];


export class Bullet {
    public active: boolean = true;

    public flipbooks: GloverFlipbookRenderer[] = [];

    public actor: GloverActorRenderer | null = null;

    public lastPosition: vec3 = vec3.create();
    public nextPosition: vec3 = vec3.create();

    public position: vec3 = vec3.create();
    public velocity: vec3 = vec3.create();

    public scale: vec3 = vec3.create();

    private lastFrameAdvance: number = 0;
    private frameCount: number = 0;
    private lifetime: number = 0;

    private callbackRequestedDestruct: boolean;

    constructor (device: GfxDevice, cache: GfxRenderCache, textureHolder: Textures.GloverTextureHolder, objects: ObjectDirectory, sceneLights: SceneLighting, protected pool: BulletPool, protected waterVolumes: GloverWaterVolume[]) {
        const params = bulletParameters[this.pool.bulletType];

        assert(params.numBillboards < 3);
        if (params.flipbook1Idx !== null) {
            const flipbook = new GloverFlipbookRenderer(
                device, cache, textureHolder, bulletFlipbooks[params.flipbook1Idx]);
            flipbook.setPrimColor(params.flipbook1Color.r, params.flipbook1Color.g, params.flipbook1Color.b);
            this.flipbooks.push(flipbook);
        }
        if (params.flipbook2Idx !== null) {
            const flipbook = new GloverFlipbookRenderer(
                device, cache, textureHolder, bulletFlipbooks[params.flipbook2Idx]);
            flipbook.setPrimColor(params.flipbook2Color.r, params.flipbook2Color.g, params.flipbook2Color.b);
            this.flipbooks.push(flipbook);
        }
        
        // TODO: hold off on this until there is sufficient
        //       collision implemented so they don't just fall
        //       through the floor:
        // if (params.name !== "") {
        //     const objId = hashStr(params.name);
        //     const objRoot = objects.get(objId);
        //     if (objRoot === undefined) {
        //         throw `Object 0x${objId.toString(16)} is not loaded!`;
        //     }
        //     this.actor = new GloverActorRenderer(device, cache, textureHolder, objRoot, sceneLights);
        // }
    } 

    public spawn(position: vec3) {
        const params = bulletParameters[this.pool.bulletType];

        vec3.copy(this.nextPosition, position);
        vec3.copy(this.lastPosition, position);
        this.velocity = vec3.fromValues(0,0,0);
        this.active = true;
        for (let flipbook of this.flipbooks) {
            flipbook.reset();
        }
        this.setLifetime(params.lifetime);
        this.frameCount = 0;
        this.scale = vec3.fromValues(.5, .5, .5);
        this.callbackRequestedDestruct = false;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const params = bulletParameters[this.pool.bulletType];

        if (!this.active) {
            return;
        }

        this.lastFrameAdvance += viewerInput.deltaTime;
        if (this.lastFrameAdvance > SRC_FRAME_TO_MS) {
            vec3.copy(this.lastPosition, this.nextPosition);
            
            if (this.lifetime > 0) {
                this.lifetime -= 1
            }
            this.lastFrameAdvance = 0

            if (this.callbackRequestedDestruct) {
                this.destruct();
                this.active = false;
            }

            this.callbackRequestedDestruct = this.frameAdvance(viewerInput);

            vec3.add(this.nextPosition, this.nextPosition, this.velocity);

            vec3.scale(this.velocity, this.velocity, params.actorDecel0x70);

            const velMag = vec3.length(this.velocity);
            if (velMag > params.actorBehMobility) {
              vec3.scale(this.velocity, this.velocity, params.actorBehMobility / velMag);
            }

            if ((params.actorFlags & 1) !== 0) {
                const gravAccel = (params.actorFlags & 0x40) == 0 ? 1.2 : 0.6;
                const terminalVelocity = (params.actorFlags & 0x1000000) == 0 ? -15 : -100000;
                this.velocity[1] = Math.max(this.velocity[1] - gravAccel, terminalVelocity);
            }

            // TODO: spawn trail particles --
            // if ((G_BULLET_PARAMS[bullet->bulletType].trailParticleType != 0x18) &&
            //    (trailParticle =
            //          spawnParticle((uint)G_BULLET_PARAMS[bullet->bulletType].trailParticleType,
            //                        &(bullet->actor).last_pos,&POINT3D_ORIGIN_D3C4,(void *)0x0,
            //                        (Particle *)0x0), trailParticle != (Particle *)0x0)) {
            //   (trailParticle->billboard).color.r = (&DAT_801f19c4)[((char)bullet->idx_0x162 + 1) * 8];
            //   (trailParticle->billboard).color.g = (&DAT_801f19c5)[((char)bullet->idx_0x162 + 1) * 8];
            //   (trailParticle->billboard).color.b = (&DAT_801f19c6)[((char)bullet->idx_0x162 + 1) * 8];
            //   if (bullet->bulletType == '\x1a') {
            //     sVar3 = (trailParticle->billboard).width;
            //     sVar4 = (trailParticle->billboard).height;
            //     (trailParticle->billboard).width = (short)((int)sVar3 << 2) + sVar3;
            //     (trailParticle->billboard).height = (short)((int)sVar4 << 2) + sVar4;
            //     (trailParticle->billboard).endSize = (trailParticle->billboard).endSize * 5;
            //     (trailParticle->billboard).startSize = (trailParticle->billboard).startSize * 5;
            //   }
            // }
            // if (bullet->bulletType == '\x02') {
            //  aPStack104[0].z = 0.0;
            //  aPStack104[0].y = 0.0;
            //  aPStack104[0].x = DAT_8010b510;
            //  iVar9 = random(7);
            //  rotateVectorAroundY(aPStack104,aPStack104,(float)iVar9);
            //  particleSpawn_801ae2e8(10,&(bullet->actor).last_pos,aPStack104,bullet->idx_0x163);
            // }
        }

        vec3.lerp(this.position, this.lastPosition, this.nextPosition, Math.min(1.0, this.lastFrameAdvance/(SRC_FRAME_TO_MS*1.1)));


        if (this.lifetime == 0 && this.flipbooks.every((flipbook)=>!flipbook.playing)) {
            this.destruct();
            this.active = false;
        }

        for (let flipbook of this.flipbooks) {
            mat4.fromRotationTranslationScale(flipbook.drawMatrix, identityRotation, this.position, this.scale);
            flipbook.prepareToRender(device, renderInstManager, viewerInput);
        }

        if (this.actor !== null) {
            mat4.fromRotationTranslationScale(this.actor.modelMatrix, identityRotation, this.position, this.scale);
            this.actor.prepareToRender(device, renderInstManager, viewerInput);
        }
    }

    public setLifetime(frames: number): void {
        if (frames > 0) {
            for (let flipbook of this.flipbooks) {
                flipbook.setLifetime(frames * SRC_FRAME_TO_MS);
            }            
        }
        this.lifetime = frames;
    }

    public destroy(device: GfxDevice): void {
        for (let flipbook of this.flipbooks) {
            flipbook.destroy(device);
        }
        if (this.actor !== null) {
            this.actor.destroy(device);
        }
    }

    protected frameAdvance(viewerInput: Viewer.ViewerRenderInput): boolean {
        return false;
    }

    protected destruct(): void {
    }
}

class WaterBullet extends Bullet {

    private collidingVolume: GloverWaterVolume | null = null;

    protected override frameAdvance(viewerInput: Viewer.ViewerRenderInput): boolean {
        for (let waterVolume of this.waterVolumes) {
            if (waterVolume.inBbox(this.position) && this.position[1] <= waterVolume.surface_y) {
                this.collidingVolume = waterVolume;
                return true;
            }
        }
        return false;
    }

    protected override destruct(): void {
        if (this.collidingVolume !== null) {
            // TODO: splashy little droplets
            if (Math.random() * 10 < 5) {
                this.collidingVolume.surfaceRipple(this.position, this.velocity);
                this.collidingVolume.splash(this.position, 1, 2.0);
            }
        }
    }
}

const bulletSubclasses: Map<number, any> = new Map<number, any>([
    [13, WaterBullet]
])

export class BulletPool implements GenericRenderable {
    private bullets: Bullet[] = [];

    public visible: boolean = true;

    constructor (private device: GfxDevice, private cache: GfxRenderCache, private textureHolder: Textures.GloverTextureHolder, private objects: ObjectDirectory, private sceneLights: SceneLighting, public readonly bulletType: number, private waterVolumes: GloverWaterVolume[]) {
    }

    public spawn(position: vec3): Bullet {
        let newBullet = null;
        for (let bullet of this.bullets) {
            if (!bullet.active) {
                newBullet = bullet;
                break;
            }
        }
        if (newBullet === null) {
            if (bulletSubclasses.has(this.bulletType)) {
                newBullet = new (bulletSubclasses.get(this.bulletType)!)(this.device, this.cache, this.textureHolder, this.objects, this.sceneLights, this, this.waterVolumes);
            } else {
                newBullet = new Bullet(this.device, this.cache, this.textureHolder, this.objects, this.sceneLights, this, this.waterVolumes);
            }
            this.bullets.push(newBullet);
        }
        newBullet.spawn(position);
        return newBullet
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible) {
            return;
        }
        for (let bullet of this.bullets) {
            if (bullet.active) {
                bullet.prepareToRender(device, renderInstManager, viewerInput);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        for (let bullet of this.bullets) {
            bullet.destroy(device)
        }
    }
}

