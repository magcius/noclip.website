import { mat4, vec3 } from 'gl-matrix';
import { DataFetcher } from '../DataFetcher';
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { ColorTexture } from '../gfx/helpers/RenderTargetHelpers';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { getDebugOverlayCanvas2D, drawWorldSpaceText, drawWorldSpacePoint, drawWorldSpaceLine } from "../DebugJunk";

import { ModelInstance, ModelViewState } from './models';
import { dataSubarray, angle16ToRads, readVec3 } from './util';
import { Anim, interpolateKeyframes, Keyframe, applyKeyframeToModel } from './animation';
import { World } from './world';
import { getRandomInt } from '../SuperMarioGalaxy/ActorUtil';

// An ObjectType is used to spawn ObjectInstance's.
// Each ObjectType inherits from an ObjectClass, where it shares most of its assets and logic.

export class ObjectType {
    public name: string;
    public scale: number = 1.0;
    public objClass: number;
    public modelNums: number[] = [];
    public isDevObject: boolean = false;
    public ambienceNum: number = 0;

    constructor(public typeNum: number, private data: DataView, private isEarlyObject: boolean) {
        // FIXME: where are these fields for early objects?
        this.scale = this.data.getFloat32(0x4);
        this.objClass = this.data.getInt16(0x50);

        this.name = '';
        let offs = isEarlyObject ? 0x58 : 0x91;
        let c;
        while ((c = this.data.getUint8(offs)) != 0) {
            this.name += String.fromCharCode(c);
            offs++;
        }

        const numModels = data.getUint8(0x55);
        const modelListOffs = data.getUint32(0x8);
        for (let i = 0; i < numModels; i++) {
            const modelNum = data.getUint32(modelListOffs + i * 4);
            this.modelNums.push(modelNum);
        }

        const flags = data.getUint32(0x44);
        this.isDevObject = !!(flags & 1);

        this.ambienceNum = data.getUint8(0x8e);
    }
}

export class ObjectInstance {
    private modelInst: ModelInstance | null = null;

    private position: vec3 = vec3.create();
    private yaw: number = 0;
    private pitch: number = 0;
    private roll: number = 0;
    private scale: number = 1.0;
    private srtMatrix: mat4 = mat4.create();
    private srtDirty: boolean = true;

    private modelAnimNum: number | null = null;
    private anim: Anim | null = null;
    private modanim: DataView;
    private layerVals0x3: number;
    private layerVals0x5: number;

    private ambienceNum: number = 0;

    constructor(private world: World, private objType: ObjectType, private objParams: DataView, posInMap: vec3) {
        this.scale = objType.scale;

        const ambienceParam = (objParams.getUint8(0x5) & 0x18) >>> 3;
        if (ambienceParam !== 0) {
            this.ambienceNum = ambienceParam - 1;
            // console.log(`ambience for ${this.objType.name} set by objparams: ${this.ambienceNum}`);
        } else {
            this.ambienceNum = objType.ambienceNum;
            // console.log(`ambience for ${this.objType.name} set by objtype: ${this.ambienceNum}`);
        }
        
        this.layerVals0x3 = objParams.getUint8(0x3);
        this.layerVals0x5 = objParams.getUint8(0x5);
        this.position = readVec3(objParams, 0x8);
        const objClass = this.objType.objClass;
        const typeNum = this.objType.typeNum;
        
        this.setModelNum(0);

        if (objClass === 201 ||
            objClass === 204
        ) {
            // e.g. sharpclawGr
            this.yaw = angle16ToRads(objParams.getInt8(0x2a) << 8);
        } else if (objClass === 198 ||
            objClass === 222 ||
            objClass === 227 ||
            objClass === 233 ||
            objClass === 234 ||
            objClass === 235 ||
            objClass === 238 ||
            objClass === 248 ||
            objClass === 280 ||
            objClass === 283 ||
            objClass === 291 ||
            objClass === 304 ||
            objClass === 307 ||
            objClass === 309 ||
            objClass === 312 ||
            objClass === 313 ||
            objClass === 316 ||
            objClass === 317 ||
            objClass === 319 ||
            objClass === 320 ||
            objClass === 321 ||
            objClass === 332 ||
            objClass === 343 ||
            objClass === 344 ||
            objClass === 373 ||
            objClass === 387 ||
            objClass === 389 ||
            objClass === 416 ||
            objClass === 418 ||
            objClass === 419 ||
            objClass === 420 ||
            objClass === 423 ||
            objClass === 424 ||
            objClass === 437 ||
            objClass === 442 ||
            objClass === 448 ||
            objClass === 465 ||
            objClass === 487 ||
            objClass === 490 ||
            objClass === 491 ||
            objClass === 492 ||
            objClass === 509 ||
            objClass === 523 ||
            objClass === 533 ||
            objClass === 549 ||
            objClass === 576 ||
            objClass === 616 ||
            objClass === 622 ||
            objClass === 642 ||
            objClass === 645 ||
            objClass === 646 ||
            objClass === 666 ||
            objClass === 674 ||
            objClass === 691 ||
            objClass === 693
        ) {
            // e.g. setuppoint
            // Do nothing
        } else if (objClass === 207) {
            // e.g. CannonClawO
            this.yaw = angle16ToRads(objParams.getInt8(0x28) << 8);
        } else if (objClass === 209) {
            // e.g. TumbleWeedB
            this.roll = angle16ToRads((objParams.getUint8(0x18) - 127) * 128);
            this.pitch = angle16ToRads((objParams.getUint8(0x19) - 127) * 128);
            this.yaw = angle16ToRads(objParams.getUint8(0x1a) << 8);
            this.scale = objParams.getFloat32(0x1c);
        } else if (objClass === 213) {
            // e.g. Kaldachom
            this.scale = 0.5 + objParams.getInt8(0x28) / 15;
        } else if (objClass === 231) {
            // e.g. BurnableVin
            this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            this.scale = 5 * objParams.getInt16(0x1a) / 32767;
            if (this.scale < 0.05) {
                this.scale = 0.05;
            }
        } else if (objClass === 237) {
            // e.g. SH_LargeSca
            this.yaw = (objParams.getInt8(0x1b) << 8) * Math.PI / 32768;
            this.pitch = (objParams.getInt8(0x22) << 8) * Math.PI / 32768;
            this.roll = (objParams.getInt8(0x23) << 8) * Math.PI / 32768;
        } else if (objClass === 239) {
            // e.g. CCboulder
            this.yaw = angle16ToRads(objParams.getUint8(0x22) << 8);
            this.position[1] += 0.5;
        } else if (objClass === 249) {
            // e.g. ProjectileS
            this.yaw = (objParams.getInt8(0x1f) << 8) * Math.PI / 32768;
            this.pitch = (objParams.getInt8(0x1c) << 8) * Math.PI / 32768;
            const objScale = objParams.getUint8(0x1d);
            if (objScale !== 0) {
                this.scale *= objScale / 64;
            }
        } else if (objClass === 250) {
            // e.g. InvisibleHi
            const scaleParam = objParams.getUint8(0x1d);
            if (scaleParam !== 0) {
                this.scale *= scaleParam / 64;
            }
        } else if (objClass === 251 ||
            objClass === 285 ||
            objClass === 347 ||
            objClass === 363 ||
            objClass === 393 ||
            objClass === 427 ||
            objClass === 445 ||
            objClass === 451 ||
            objClass === 452 ||
            objClass === 453 ||
            objClass === 455 ||
            objClass === 457 ||
            objClass === 459 ||
            objClass === 469 ||
            objClass === 473 ||
            objClass === 477 ||
            objClass === 496 ||
            (objClass === 502 && typeNum !== 0x803) ||
            objClass === 510 ||
            objClass === 513 ||
            objClass === 525 ||
            objClass === 579 ||
            objClass === 597 ||
            objClass === 598 ||
            objClass === 599 ||
            objClass === 609 ||
            objClass === 614 ||
            objClass === 617 ||
            objClass === 619 ||
            (objClass === 620 && typeNum !== 0x86a && typeNum !== 0x86b) ||
            objClass === 623 ||
            objClass === 641 ||
            objClass === 643 ||
            objClass === 650 ||
            objClass === 660 ||
            objClass === 671
        ) {
            // e.g. SC_Pressure
            this.yaw = angle16ToRads(objParams.getUint8(0x18) << 8);
        } else if (objClass === 254) {
            // e.g. MagicPlant
            this.yaw = angle16ToRads(objParams.getInt8(0x1d) << 8);
        } else if (objClass === 255) {
            // e.g. MagicDustMi
            this.setModelNum(objParams.getInt8(0x26));
        } else if (objClass === 256 ||
            objClass === 391 ||
            objClass === 392 ||
            objClass === 394
        ) {
            // e.g. TrickyWarp
            this.yaw = angle16ToRads(objParams.getInt8(0x1a) << 8);
        } else if (objClass === 259) {
            // e.g. CurveFish
            this.scale *= objParams.getUint8(0x18) / 100;
        } else if (objClass === 240 ||
            objClass === 260 ||
            objClass === 261
        ) {
            // e.g. WarpPoint, SmallBasket, LargeCrate
            this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
        } else if (objClass === 266) {
            // e.g. Fall_Ladder
            this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            this.position[1] += objParams.getInt16(0x1a);
            this.setModelNum(objParams.getInt8(0x19));
        } else if (objClass === 269) {
            // e.g. PortalSpell
            this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            this.pitch = angle16ToRads(objParams.getInt16(0x1c) << 8); // Yes, getInt16 is correct.
            this.scale = 3.15;
        } else if (objClass === 272) {
            // e.g. SH_Portcull
            this.yaw = (objParams.getInt8(0x1f) << 8) * Math.PI / 32768;
            const objScale = objParams.getUint8(0x21) / 64;
            if (objScale === 0) {
                this.scale = 1.0;
            } else {
                this.scale *= objScale;
            }
        } else if (objClass === 274 ||
            objClass === 275 ||
            objClass === 417 ||
            objClass === 447 ||
            objClass === 456 ||
            objClass === 472
        ) {
            // e.g. SH_newseqob
            this.yaw = angle16ToRads(objParams.getInt8(0x1c) << 8);
        } else if (objClass === 284 ||
            objClass === 289 ||
            objClass === 300
        ) {
            // e.g. StaffBoulde
            this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            // TODO: scale depends on subtype param
        } else if (objClass === 287) {
            // e.g. MagicCaveTo
            this.yaw = angle16ToRads(objParams.getUint8(0x23) << 8);
        } else if (objClass === 288) {
            // e.g. TrickyGuard
            this.yaw = (objParams.getInt8(0x19) << 8) * Math.PI / 32768;
        } else if (objClass === 293) {
            // e.g. curve
            this.yaw = angle16ToRads(objParams.getInt8(0x2c) << 8);
            this.pitch = angle16ToRads(objParams.getInt8(0x2d) << 8);
            // FIXME: mode 8 and 0x1a also have roll at 0x38
        } else if (objClass === 294 && typeNum === 77) {
            this.yaw = angle16ToRads(objParams.getInt8(0x3d) << 8);
            this.pitch = angle16ToRads(objParams.getInt8(0x3e) << 8);
        } else if (objClass === 296) {
            let objScale = objParams.getUint8(0x1c);
            if (objScale < 10) {
                objScale = 10;
            }
            objScale /= 64;
            this.scale *= objScale;
            this.yaw = angle16ToRads((objParams.getUint8(0x1d) & 0x3f) << 10)
            // TODO: set model # and animation
        } else if (objClass === 297) {
            // e.g. CampFire
            const scaleParam = objParams.getUint8(0x1a);
            if (scaleParam !== 0) {
                this.scale = 0.01 * scaleParam;
            }
        } else if (objClass === 298 && [888, 889].includes(typeNum)) {
            // e.g. WM_krazoast
            this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
        } else if (objClass === 299) {
            // e.g. FXEmit
            this.scale = 0.1;
            this.yaw = angle16ToRads(objParams.getInt8(0x24) << 8);
            this.pitch = angle16ToRads(objParams.getInt8(0x23) << 8);
            this.roll = angle16ToRads(objParams.getInt8(0x22) << 8);
        } else if (objClass === 306) {
            // e.g. WaterFallSp
            this.roll = angle16ToRads(objParams.getInt8(0x1a) << 8);
            this.pitch = angle16ToRads(objParams.getInt8(0x1b) << 8);
            this.yaw = angle16ToRads(objParams.getInt8(0x1c) << 8);
        } else if (objClass === 308) {
            // e.g. texscroll2
            if (world.mapInstance === null) {
                throw Error(`No map available when spawning texscroll`);
            }

            const block = world.mapInstance.getBlockAtPosition(posInMap[0], posInMap[2]);
            if (block === null) {
                console.warn(`couldn't find block for texscroll object`);
            } else {
                const scrollableIndex = objParams.getInt16(0x18);
                const speedX = objParams.getInt8(0x1e);
                const speedY = objParams.getInt8(0x1f);

                const tabValue = this.world.resColl.tablesTab.getUint32(0xe * 4);
                const targetTexId = this.world.resColl.tablesBin.getUint32(tabValue * 4 + scrollableIndex * 4) & 0x7fff;
                // Note: & 0x7fff above is an artifact of how the game stores tex id's.
                // Bit 15 set means the texture comes directly from TEX1 and does not go through TEXTABLE.

                let fail = true;
                const materials = block.getMaterials();
                for (let i = 0; i < materials.length; i++) {
                    if (materials[i] !== undefined) {
                        const mat = materials[i]!;
                        for (let j = 0; j < mat.shader.layers.length; j++) {
                            const layer = mat.shader.layers[j];
                            if (layer.texId === targetTexId) {
                                fail = false;
                                // Found the texture! Make it scroll now.
                                console.log(`Making texId ${targetTexId} scroll!`);
                                const theTexture = this.world.resColl.texFetcher.getTexture(this.world.device, targetTexId, true)!;
                                const dxPerFrame = (speedX << 16) / theTexture.width;
                                const dyPerFrame = (speedY << 16) / theTexture.height;
                                layer.scrollingTexMtx = mat.factory.setupScrollingTexMtx(dxPerFrame, dyPerFrame);
                                mat.rebuild();
                            }
                        }
                    }
                }

                if (fail) {
                    console.warn(`Couldn't find material texture for scrolling`);
                }
            }
        } else if (objClass === 318) {
            // e.g. DIM2Explode
            const modelNum = objParams.getInt8(0x18);
            this.setModelNum(modelNum);
        } else if (objClass === 329) {
            // e.g. CFTreasWind
            const scaleParam = objParams.getInt8(0x19);
            let objScale;
            if (scaleParam === 0) {
                objScale = 90;
            } else {
                objScale = 4 * scaleParam;
            }
            this.scale *= objScale / 90;
        } else if (objClass === 330) {
            // e.g. CFPowerBase
            this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            const modelParam = objParams.getInt16(0x1e);
            if (modelParam === 0x55) {
                this.setModelNum(2);
            } else if (modelParam === 0x56) {
                this.setModelNum(1);
            }
        } else if (objClass === 346) {
            // e.g. SH_BombWall
            this.yaw = angle16ToRads(objParams.getInt16(0x1a));
            this.pitch = angle16ToRads(objParams.getInt16(0x1c));
            this.roll = angle16ToRads(objParams.getInt16(0x1e));
            let objScale = objParams.getInt8(0x2d);
            if (objScale === 0) {
                objScale = 20;
            }
            this.scale *= objScale / 20;
        } else if (objClass === 356) {
            // e.g. CFLevelCont
            this.world.envfxMan.loadEnvfx(0x56);
            this.world.envfxMan.loadEnvfx(0xd);
            this.world.envfxMan.loadEnvfx(0x11);
            this.world.envfxMan.loadEnvfx(0xe);
        } else if (objClass === 359) {
            // e.g. SpiritDoorL
            this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            let objScale = objParams.getInt8(0x19) / 64;
            if (objScale === 0) {
                objScale = 1;
            }
            this.scale *= objScale;
        } else if (objClass === 372) {
            // e.g. CCriverflow
            this.yaw = angle16ToRads(objParams.getUint8(0x18) << 8);
            this.scale += objParams.getUint8(0x19) / 512;
        } else if (objClass === 382) {
            // e.g. MMP_levelco
            // FIXME: other envfx are used in certain scenarios
            this.world.envfxMan.loadEnvfx(0x13a);
            this.world.envfxMan.loadEnvfx(0x138);
            this.world.envfxMan.loadEnvfx(0x139);
        } else if (objClass === 383) {
            // e.g. MSVine
            this.yaw = angle16ToRads(objParams.getUint8(0x1f) << 8);
            const scaleParam = objParams.getUint8(0x21);
            if (scaleParam !== 0) {
                this.scale *= scaleParam / 64;
            }
        } else if (objClass === 385) {
            // e.g. MMP_trenchF
            this.roll = angle16ToRads(objParams.getInt8(0x19) << 8);
            this.pitch = angle16ToRads(objParams.getInt8(0x1a) << 8);
            this.yaw = angle16ToRads(objParams.getInt8(0x1b) << 8);
            this.scale = 0.1;
        } else if (objClass === 390) {
            // e.g. CCgasvent
            this.yaw = angle16ToRads(objParams.getUint8(0x1a) << 8);
        } else if (objClass === 395) {
            // e.g. CClevcontro
            this.world.envfxMan.loadEnvfx(0x23f);
            this.world.envfxMan.loadEnvfx(0x240);
            this.world.envfxMan.loadEnvfx(0x241);
        } else if (objClass === 415) {
            // e.g. NW_treebrid
            this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            this.pitch = angle16ToRads(objParams.getInt16(0x1a));
            this.roll = angle16ToRads(objParams.getInt16(0x1c));
        } else if (objClass === 421) {
            // e.g. NW_levcontr
            this.world.envfxMan.loadEnvfx(0xb4);
            this.world.envfxMan.loadEnvfx(0xb5);
            this.world.envfxMan.loadEnvfx(0xb6);
            this.world.envfxMan.loadEnvfx(0xb7);
        } else if (objClass === 429) {
            // e.g. ThornTail
            this.yaw = (objParams.getInt8(0x19) << 8) * Math.PI / 32768;
            this.scale *= objParams.getUint16(0x1c) / 1000;
        } else if (objClass === 430) {
            // e.g. SH_LevelCon
            // TODO: Load additional env fx
            // The game has entire tables of effects based on time of day, game progress, etc.
            this.world.envfxMan.loadEnvfx(0x1b2);
            this.world.envfxMan.loadEnvfx(0x1b3);
            this.world.envfxMan.loadEnvfx(0x1b4);
        } else if (objClass === 438) {
            // e.g. SC_LevelCon
            this.world.envfxMan.loadEnvfx(0x4f);
            this.world.envfxMan.loadEnvfx(0x50);
            this.world.envfxMan.loadEnvfx(0x245);
        } else if (objClass === 439) {
            // e.g. SC_MusicTre
            this.roll = angle16ToRads((objParams.getUint8(0x18) - 127) * 128);
            this.pitch = angle16ToRads((objParams.getUint8(0x19) - 127) * 128);
            this.yaw = angle16ToRads(objParams.getUint8(0x1a) << 8);
            this.scale = 3.6 * objParams.getFloat32(0x1c);
        } else if (objClass === 440) {
            // e.g. SC_totempol
            this.yaw = angle16ToRads(objParams.getUint8(0x1a) << 8);
        } else if (objClass === 454 && typeNum !== 0x1d6) {
            // e.g. DIMCannon
            this.yaw = angle16ToRads(objParams.getInt8(0x28) << 8);
        } else if (objClass === 461) {
            // e.g. DIM_LevelCo
            this.world.envfxMan.loadEnvfx(0x160);
            this.world.envfxMan.loadEnvfx(0x15a);
            this.world.envfxMan.loadEnvfx(0x15c);
            this.world.envfxMan.loadEnvfx(0x15f);
        } else if (objClass === 489) {
            // e.g. SB_Propelle
            const modelNum = objParams.getInt8(0x1a);
            this.setModelNum(modelNum);
        } else if (objClass === 497) {
            // e.g. SB_DeckDoor
            this.yaw = angle16ToRads(objParams.getUint8(0x18) << 8);
            const modelNum = objParams.getInt8(0x19) != 0 ? 1 : 0;
            this.setModelNum(modelNum);
        } else if (objClass === 500) {
            // e.g. SB_Lamp
            if (typeNum === 0x3e4) {
                this.yaw = angle16ToRads(objParams.getUint8(0x1a) << 8);
            } else {
                this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            }
            this.pitch = 0;
            this.roll = 0;
        } else if (objClass === 518) {
            // e.g. PoleFlame
            this.yaw = angle16ToRads((objParams.getUint8(0x18) & 0x3f) << 10);
            const objScale = objParams.getInt16(0x1a);
            if (objScale < 1) {
                this.scale = 0.1;
            } else {
                this.scale = objScale / 8192;
            }
        } else if (objClass === 524) {
            // e.g. WM_spiritpl
            this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            this.pitch = angle16ToRads(objParams.getInt16(0x1a) << 8); // Yes, getInt16 is correct.
        } else if (objClass === 538) {
            // e.g. VFP_statueb
            const scaleParam = objParams.getInt16(0x1c);
            if (scaleParam > 1) {
                this.scale *= scaleParam;
            }
        } else if (objClass === 550) {
            // e.g. VFP_lavapoo
            let scaleParam = objParams.getInt16(0x1a);
            if (scaleParam === 0) {
                scaleParam = 500;
            }
            this.scale = 1 / (scaleParam / getRandomInt(600, 1000));
        } else if (objClass === 602) {
            // e.g. StaticCamer
            this.yaw = angle16ToRads(-objParams.getInt16(0x1c));
            this.pitch = angle16ToRads(-objParams.getInt16(0x1e));
            this.roll = angle16ToRads(-objParams.getInt16(0x20));
        } else if (objClass === 425 ||
            objClass === 603
        ) {
            // e.g. MSPlantingS
            this.yaw = angle16ToRads(objParams.getUint8(0x1f) << 8);
        } else if (objClass === 535 ||
            objClass === 613
        ) {
            // e.g. DR_Creator
            this.yaw = angle16ToRads(objParams.getInt8(0x1e) << 8);
        } else if (objClass === 627) {
            // e.g. FlameMuzzle
            const scaleParam = objParams.getInt16(0x1c);
            if (scaleParam != 0) {
                this.scale *= 0.1 * scaleParam;
            }
            this.roll = 0;
            this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            this.pitch = angle16ToRads(objParams.getUint8(0x19) << 8);
        } else if (objClass === 644) {
            // e.g. SPMapDR
            this.yaw = angle16ToRads(objParams.getUint8(0x1a) << 8);
            this.pitch = angle16ToRads(objParams.getUint8(0x1b) << 8);
            this.setModelNum(objParams.getInt8(0x18));
        } else if (objClass === 648) {
            // e.g. SPDrape
            this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            const scaleParam = objParams.getInt16(0x1a);
            if (scaleParam !== 0) {
                this.scale = 10 * scaleParam / 32767.0;
            }
        } else if (objClass === 653) {
            // e.g. WCLevelCont
            this.world.envfxMan.loadEnvfx(0x1fb);
            this.world.envfxMan.loadEnvfx(0x1ff);
            this.world.envfxMan.loadEnvfx(0x1fc);
            this.world.envfxMan.loadEnvfx(0x1fd);
        } else if (objClass === 656) {
            // e.g. WCPushBlock
            this.setModelNum(objParams.getInt8(0x19));
        } else if (objClass === 657) {
            // e.g. WCTile
            this.position[1] += 25.0;
            this.setModelNum(objParams.getInt8(0x19));
        } else if (objClass === 659) {
            // e.g. CFSunTemple
            this.yaw = angle16ToRads(objParams.getUint8(0x18) << 8);
            this.pitch = angle16ToRads(objParams.getUint8(0x19) << 8);
            this.roll = angle16ToRads(objParams.getUint8(0x1a) << 8);
            this.setModelNum(objParams.getInt8(0x21));
        } else if (objClass === 654 ||
            objClass === 658 ||
            objClass === 661 ||
            objClass === 662 ||
            objClass === 663
        ) {
            // e.g. WCTempleDia
            this.yaw = angle16ToRads(objParams.getUint8(0x18) << 8);
            this.setModelNum(objParams.getInt8(0x19));
        } else if (objClass === 664) {
            // e.g. WCFloorTile
            this.yaw = angle16ToRads(-0x4000);
        } else if (objClass === 672) {
            // e.g. ARWGoldRing
            this.yaw = angle16ToRads(-0x8000);
        } else if (objClass === 678) {
            // e.g. ARWBigAster
            this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            this.pitch = angle16ToRads(objParams.getInt8(0x19) << 8);
            this.roll = angle16ToRads(objParams.getInt8(0x1a) << 8);
        } else if (objClass === 679) {
            // e.g. ARWProximit
            this.yaw = angle16ToRads(getRandomInt(0, 0xffff));
            this.pitch = angle16ToRads(getRandomInt(0, 0xffff));
            this.roll = angle16ToRads(getRandomInt(0, 0xffff));
        } else if (objClass === 681 ||
            objClass === 682
        ) {
            // e.g. LGTDirectio
            this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            this.pitch = angle16ToRads(objParams.getInt8(0x19) << 8);
        } else if (objClass === 683) {
            // e.g. LGTProjecte
            this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            this.pitch = angle16ToRads(objParams.getInt8(0x19) << 8);
            this.roll = angle16ToRads(objParams.getInt8(0x34) << 8);
        } else if (objClass === 214 ||
            objClass === 273 ||
            objClass === 689 ||
            objClass === 690
        ) {
            // e.g. CmbSrc
            this.roll = angle16ToRads(objParams.getUint8(0x18) << 8);
            this.pitch = angle16ToRads(objParams.getUint8(0x19) << 8);
            this.yaw = angle16ToRads(objParams.getUint8(0x1a) << 8);
        } else if (objClass === 282 ||
            objClass === 302 ||
            objClass === 303 ||
            objClass === 685 ||
            objClass === 686 ||
            objClass === 687 ||
            objClass === 688
        ) {
            // e.g. Boulder, LongGrassCl
            this.roll = angle16ToRads(objParams.getUint8(0x18) << 8);
            this.pitch = angle16ToRads(objParams.getUint8(0x19) << 8);
            this.yaw = angle16ToRads(objParams.getUint8(0x1a) << 8);
            const scaleParam = objParams.getUint8(0x1b);
            if (scaleParam !== 0) {
                this.scale *= scaleParam / 255;
            }
        } else if (objClass === 694) {
            // e.g. CNThitObjec
            if (objParams.getInt8(0x19) === 2) {
                this.yaw = angle16ToRads(objParams.getInt16(0x1c));
            }
        } else {
            console.log(`Don't know how to setup object class ${objClass} objType ${typeNum}`);
        }
    }

    public getSRT(): mat4 {
        if (this.srtDirty) {
            mat4.fromTranslation(this.srtMatrix, this.position);
            mat4.scale(this.srtMatrix, this.srtMatrix, [this.scale, this.scale, this.scale]);
            mat4.rotateY(this.srtMatrix, this.srtMatrix, this.yaw);
            mat4.rotateX(this.srtMatrix, this.srtMatrix, this.pitch);
            mat4.rotateZ(this.srtMatrix, this.srtMatrix, this.roll);
            this.srtDirty = false;
        }

        return this.srtMatrix;
    }

    public getType(): ObjectType {
        return this.objType;
    }

    public getClass(): number {
        return this.objType.objClass;
    }

    public getName(): string {
        return this.objType.name;
    }

    public getPosition(): vec3 {
        return this.position;
    }

    public setPosition(pos: vec3) {
        vec3.copy(this.position, pos);
        this.srtDirty = true;
    }

    public setModelNum(num: number) {
        try {
            const modelNum = this.objType.modelNums[num];

            const modelInst = this.world.resColl.modelFetcher.createModelInstance(modelNum);
            const amap = this.world.resColl.amapColl.getAmap(modelNum);
            modelInst.setAmap(amap);
            this.modanim = this.world.resColl.modanimColl.getModanim(modelNum);
            this.modelInst = modelInst;

            if (this.modanim.byteLength > 0 && amap.byteLength > 0) {
                this.setModelAnimNum(0);
            }
        } catch (e) {
            console.warn(`Failed to load model ${num} due to exception:`);
            console.error(e);
            this.modelInst = null;
        }
    }

    public setModelAnimNum(num: number) {
        this.modelAnimNum = num;
        const modanim = this.modanim.getUint16(num * 2);
        this.setAnim(this.world.resColl.animColl.getAnim(modanim));
    }

    public setAnim(anim: Anim | null) {
        this.anim = anim;
    }

    public isInLayer(layer: number): boolean {
        if (layer === 0) {
            return true;
        } else if (layer < 9) {
            return ((this.layerVals0x3 >>> (layer - 1)) & 1) === 0;
        } else {
            return ((this.layerVals0x5 >>> (16 - layer)) & 1) === 0;
        }
    }

    private curKeyframe: Keyframe | undefined = undefined;

    public update() {
        if (this.modelInst !== null && this.anim !== null && (!this.modelInst.model.hasFineSkinning || this.world.animController.enableFineSkinAnims)) {
            const poseMtx = mat4.create();
            // TODO: use time values from animation data?
            const amap = this.modelInst.getAmap(this.modelAnimNum!);
            const kfTime = (this.world.animController.animController.getTimeInSeconds() * 4) % this.anim.keyframes.length;
            const kf0Num = Math.floor(kfTime);
            let kf1Num = kf0Num + 1;
            if (kf1Num >= this.anim.keyframes.length) {
                kf1Num = 0;
            }
            const kf0 = this.anim.keyframes[kf0Num];
            const kf1 = this.anim.keyframes[kf1Num];
            const ratio = kfTime - kf0Num;
            this.curKeyframe = interpolateKeyframes(kf0, kf1, ratio, this.curKeyframe);
            applyKeyframeToModel(this.curKeyframe, this.modelInst, amap);
        }
    }

    public render(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, sceneTexture: ColorTexture, drawStep: number) {
        if (drawStep !== 0) {
            return; // TODO: Implement additional draw steps
        }

        // TODO: don't update in render function?
        this.update();

        if (this.modelInst !== null && this.modelInst !== undefined) {
            const mtx = this.getSRT();
            const modelViewState: ModelViewState = {
                showDevGeometry: true,
                ambienceNum: this.ambienceNum,
            };
            this.modelInst.prepareToRender(device, renderInstManager, viewerInput, mtx, sceneTexture, drawStep, modelViewState);

            // Draw bones
            const drawBones = false;
            if (drawBones) {
                const ctx = getDebugOverlayCanvas2D();
                // TODO: Draw pyramid shapes instead of lines
                for (let i = 1; i < this.modelInst.model.joints.length; i++) {
                    const joint = this.modelInst.model.joints[i];
                    const jointMtx = mat4.clone(this.modelInst.boneMatrices[i]);
                    mat4.mul(jointMtx, jointMtx, mtx);
                    const jointPt = vec3.create();
                    mat4.getTranslation(jointPt, jointMtx);
                    if (joint.parent != 0xff) {
                        const parentMtx = mat4.clone(this.modelInst.boneMatrices[joint.parent]);
                        mat4.mul(parentMtx, parentMtx, mtx);
                        const parentPt = vec3.create();
                        mat4.getTranslation(parentPt, parentMtx);
                        drawWorldSpaceLine(ctx, viewerInput.camera, parentPt, jointPt);
                    } else {
                        drawWorldSpacePoint(ctx, viewerInput.camera, jointPt);
                    }
                }
            }
        }
    }
}

export class ObjectManager {
    private objectsTab: DataView;
    private objectsBin: DataView;
    private objindexBin: DataView | null;
    private objectTypes: ObjectType[] = [];

    private constructor(private world: World, private useEarlyObjects: boolean) {
    }

    public static async create(world: World, dataFetcher: DataFetcher, useEarlyObjects: boolean): Promise<ObjectManager> {
        const self = new ObjectManager(world, useEarlyObjects);

        const pathBase = world.gameInfo.pathBase;
        const [objectsTab, objectsBin, objindexBin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/OBJECTS.tab`),
            dataFetcher.fetchData(`${pathBase}/OBJECTS.bin`),
            !self.useEarlyObjects ? dataFetcher.fetchData(`${pathBase}/OBJINDEX.bin`) : null,
        ]);
        self.objectsTab = objectsTab.createDataView();
        self.objectsBin = objectsBin.createDataView();
        self.objindexBin = !self.useEarlyObjects ? objindexBin!.createDataView() : null;

        return self;
    }

    public getObjectType(typeNum: number, skipObjindex: boolean = false): ObjectType {
        if (!this.useEarlyObjects && !skipObjindex) {
            typeNum = this.objindexBin!.getUint16(typeNum * 2);
        }

        if (this.objectTypes[typeNum] === undefined) {
            const offs = this.objectsTab.getUint32(typeNum * 4);
            const objType = new ObjectType(typeNum, dataSubarray(this.objectsBin, offs), this.useEarlyObjects);
            this.objectTypes[typeNum] = objType;
        }

        return this.objectTypes[typeNum];
    }

    public createObjectInstance(typeNum: number, objParams: DataView, posInMap: vec3, skipObjindex: boolean = false) {
        const objType = this.getObjectType(typeNum, skipObjindex);
        const objInst = new ObjectInstance(this.world, objType, objParams, posInMap);
        return objInst;
    }
}