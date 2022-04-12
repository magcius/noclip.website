import { commonClass, commonSetup, decorClass, templeClass } from './Common';
import { TriggerObj } from './Triggers';
import { LGTPointLgt, LGTProjecte, Torch, Torch2 } from './Lights';
import { ObjectInstance } from '../objects';
import { angle16ToRads, readUint32 } from '../util';
import { World } from '../world';
import { getRandomInt } from '../../SuperMarioGalaxy/ActorUtil';
import { MaterialRenderContext, StandardMaterial } from '../materials';
import * as GX from '../../gx/gx_enum';
import { SFAClass } from './SFAClass';
import { SFAMaterialBuilder } from '../MaterialBuilder';

export const SFA_CLASSES: {[num: number]: typeof SFAClass} = {
    [77]: commonClass(0x3d, 0x3e),
    [198]: commonClass(),
    [201]: commonClass(0x2a),
    [204]: commonClass(0x2a),
    [207]: commonClass(0x28), // CannonClawO
    [209]: class extends SFAClass { // TumbleWeedB
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x1a);
            obj.roll = angle16ToRads((data.getUint8(0x18) - 127) * 128);
            obj.pitch = angle16ToRads((data.getUint8(0x19) - 127) * 128);
            obj.scale = data.getFloat32(0x1c);
        }
    },
    [213]: class extends SFAClass { // Kaldachom
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.scale = 0.5 + data.getInt8(0x28) / 15;
        }
    },
    [214]: commonClass(0x1a, 0x19, 0x18),
    [222]: commonClass(),
    [227]: commonClass(),
    [231]: class extends SFAClass { // BurnableVin
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x18);
            obj.scale = 5 * data.getInt16(0x1a) / 32767;
            if (obj.scale < 0.05)
                obj.scale = 0.05;
        }
    },
    [232]: class extends SFAClass { // checkpoint4
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x29);
            obj.scale = Math.max(data.getUint8(0x2a), 5) / 128;
        }
    },
    [233]: commonClass(),
    [234]: commonClass(),
    [235]: commonClass(),
    [237]: commonClass(0x1b, 0x22, 0x23), // SH_LargeSca
    [238]: commonClass(),
    [239]: class extends SFAClass { // CCboulder
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x22);
            obj.position[1] += 0.5;
        }
    },
    [240]: commonClass(0x18),
    [244]: commonClass(0x18), // VFP_RoundDo
    [248]: commonClass(),
    [249]: class extends SFAClass { // ProjectileS
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x1f, 0x1c);
            const objScale = data.getUint8(0x1d);
            if (objScale !== 0)
                obj.scale *= objScale / 64;
        }
    },
    [250]: class extends SFAClass { // InvisibleHi
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            const scaleParam = data.getUint8(0x1d);
            if (scaleParam !== 0)
                obj.scale *= scaleParam / 64;
        }
    },
    [251]: commonClass(0x18),
    [254]: commonClass(0x1d, undefined, undefined, 0.005), // MagicPlant
    [255]: class extends SFAClass { // MagicDustMi
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.setModelNum(data.getInt8(0x26));
        }
    },
    [256]: commonClass(0x1a),
    [258]: commonClass(), // StayPoint
    [259]: class extends SFAClass { // CurveFish
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.scale *= data.getUint8(0x18) / 100;
        }
    },
    [260]: commonClass(0x18),
    [261]: commonClass(0x18),
    [266]: class extends SFAClass { // Fall_Ladder
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x18);
            obj.position[1] += data.getInt16(0x1a);
            obj.setModelNum(data.getInt8(0x19));
        }
    },
    [269]: class extends SFAClass { // PortalSpell
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x18);
            obj.pitch = angle16ToRads(data.getInt16(0x1c) << 8); // Yes, getInt16 is correct.
            obj.scale = 3.15;
        }
    },
    [272]: class extends SFAClass { // SH_Portcull
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x1f);
            const objScale = data.getUint8(0x21) / 64;
            if (objScale === 0)
                obj.scale = 1.0;
            else
                obj.scale *= objScale;
        }
    },
    [273]: commonClass(0x1a, 0x19, 0x18),
    [274]: commonClass(0x1c),
    [275]: commonClass(0x1c),
    [280]: commonClass(),
    [282]: decorClass(),
    [283]: commonClass(),
    [284]: commonClass(0x18),
    [285]: commonClass(0x18),
    [287]: commonClass(0x23), // MagicCaveTo
    [289]: commonClass(0x18),
    [288]: commonClass(0x19), // TrickyGuard
    [291]: commonClass(),
    [293]: class extends SFAClass { // curve
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x2c, 0x2d);
            // FIXME: some curve modes have a roll parameter at 0x38
        }
    },
    [294]: TriggerObj,
    [296]: class extends SFAClass {
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            let objScale = data.getUint8(0x1c);
            if (objScale < 10)
                objScale = 10;
            objScale /= 64;
            obj.scale *= objScale;
            obj.yaw = angle16ToRads((data.getUint8(0x1d) & 0x3f) << 10)
            // TODO: set model # and animation
        }
    },
    [297]: class extends SFAClass { // CampFire
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            const scaleParam = data.getUint8(0x1a);
            if (scaleParam !== 0)
                obj.scale = 0.01 * scaleParam;
        }
    },
    [298]: class extends SFAClass { // WM_krazoast
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            if (obj.objType.typeNum === 482) {
            } else if (obj.objType.typeNum === 888 || obj.objType.typeNum === 889) {
                commonSetup(obj, data, 0x18);
            }
        }
    },
    [299]: class extends SFAClass { // FXEmit
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x24, 0x23, 0x22);
            obj.scale = 0.1;
        }
    },
    [300]: commonClass(0x18),
    [302]: decorClass(),
    [303]: decorClass(),
    [304]: commonClass(),
    [306]: commonClass(0x1c, 0x1b, 0x1a), // WaterFallSp
    [307]: commonClass(),
    [308]: class extends commonClass() { // texscroll2
        public override mount(obj: ObjectInstance, world: World) {
            if (world.mapInstance === null)
                throw Error(`No map available when spawning texscroll`);

            const block = world.mapInstance.getBlockAtPosition(obj.posInMap[0], obj.posInMap[2]);
            if (block === null) {
                console.warn(`Couldn't find block for texscroll object`);
            } else {
                const scrollableIndex = obj.objParams.getInt16(0x18);
                const speedX = obj.objParams.getInt8(0x1e);
                const speedY = obj.objParams.getInt8(0x1f);

                const tabValue = readUint32(obj.world.resColl.tablesTab, 0, 0xe);
                const targetTexId = readUint32(obj.world.resColl.tablesBin, 0, tabValue + scrollableIndex) & 0x7fff;
                // Note: & 0x7fff above is an artifact of how the game stores tex id's.
                // Bit 15 set means the texture comes directly from TEX1 and does not go through TEXTABLE.

                let fail = true;
                const materials = block.getMaterials();
                for (let i = 0; i < materials.length; i++) {
                    if (materials[i] !== undefined) {
                        const mat = materials[i]! as StandardMaterial;
                        for (let j = 0; j < mat.shader.layers.length; j++) {
                            const layer = mat.shader.layers[j];
                            if (layer.texId === targetTexId) {
                                fail = false;
                                // Found the texture! Make it scroll now.
                                // console.log(`Making texId ${targetTexId} scroll!`);
                                const theTexture = obj.world.resColl.texFetcher.getTexture(obj.world.device, targetTexId, true)!;
                                const dxPerFrame = (speedX << 16) / theTexture.width;
                                const dyPerFrame = (speedY << 16) / theTexture.height;
                                layer.scrollSlot = mat.factory.addScrollSlot(dxPerFrame, dyPerFrame);
                                mat.rebuild();
                            }
                        }
                    }
                }

                if (fail)
                    console.warn(`Couldn't find material texture for scrolling`);
            }
        }

        // TODO: implement unmount
    },
    [309]: commonClass(),
    [312]: commonClass(),
    [313]: commonClass(),
    [316]: commonClass(),
    [317]: commonClass(),
    [318]: class extends SFAClass { // DIM2Explode
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            const modelNum = data.getInt8(0x18);
            obj.setModelNum(modelNum);
        }
    },
    [319]: commonClass(),
    [320]: commonClass(),
    [321]: commonClass(),
    [329]: class extends SFAClass { // CFTreasWind
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            const scaleParam = data.getInt8(0x19);
            let objScale;
            if (scaleParam === 0)
                objScale = 90;
            else
                objScale = 4 * scaleParam;
            obj.scale *= objScale / 90;
        }
    },
    [330]: class extends SFAClass { // CFPowerBase
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x18);
            const modelParam = data.getInt16(0x1e);
            if (modelParam === 0x55)
                obj.setModelNum(2);
            else if (modelParam === 0x56)
                obj.setModelNum(1);
        }
    },
    [332]: commonClass(),
    [343]: commonClass(),
    [344]: commonClass(),
    [346]: class extends SFAClass { // SH_BombWall
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.yaw = angle16ToRads(data.getInt16(0x1a));
            obj.pitch = angle16ToRads(data.getInt16(0x1c));
            obj.roll = angle16ToRads(data.getInt16(0x1e));
            let objScale = data.getInt8(0x3d);
            if (objScale === 0)
                objScale = 20;
            obj.scale *= objScale / 20;
        }
    },
    [347]: commonClass(0x18),
    [356]: class extends SFAClass { // CFLevelCont
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.world.envfxMan.loadEnvfx(0x56);
            obj.world.envfxMan.loadEnvfx(0xd);
            obj.world.envfxMan.loadEnvfx(0x11);
            obj.world.envfxMan.loadEnvfx(0xe);
        }
    },
    [359]: class extends SFAClass { // SpiritDoorL
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x18);
            let objScale = data.getInt8(0x19) / 64;
            if (objScale === 0)
                objScale = 1;
            obj.scale *= objScale;
        }
    },
    [363]: commonClass(0x18),
    [372]: class extends SFAClass { // CCriverflow
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x18);
            obj.scale += data.getUint8(0x19) / 512;
        }
    },
    [373]: commonClass(),
    [382]: class extends SFAClass { // MMP_levelco
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            // FIXME: other envfx are used in certain scenarios
            obj.world.envfxMan.loadEnvfx(0x13a);
            obj.world.envfxMan.loadEnvfx(0x138);
            obj.world.envfxMan.loadEnvfx(0x139);
        }
    },
    [383]: class extends SFAClass { // MSVine
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x1f);
            const scaleParam = data.getUint8(0x21);
            if (scaleParam !== 0)
                obj.scale *= scaleParam / 64;
        }
    },
    [385]: class extends SFAClass { // MMP_trenchF
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x1b, 0x1a, 0x19);
            obj.scale = 0.1;
        }
    },
    [387]: commonClass(),
    [389]: commonClass(),
    [390]: commonClass(0x1a), // CCgasvent
    [391]: commonClass(0x1a),
    [392]: commonClass(0x1a),
    [393]: commonClass(0x18),
    [394]: commonClass(0x1a),
    [395]: class extends SFAClass { // CClevcontro
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.world.envfxMan.loadEnvfx(0x23f);
            obj.world.envfxMan.loadEnvfx(0x240);
            obj.world.envfxMan.loadEnvfx(0x241);
        }
    },
    [415]: class extends SFAClass { // NW_treebrid
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x18);
            obj.pitch = angle16ToRads(data.getInt16(0x1a));
            obj.roll = angle16ToRads(data.getInt16(0x1c));
        }
    },
    [416]: commonClass(),
    [417]: commonClass(0x1c),
    [418]: commonClass(),
    [419]: commonClass(),
    [420]: commonClass(),
    [421]: class extends SFAClass { // NW_levcontr
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.world.envfxMan.loadEnvfx(0xb4);
            obj.world.envfxMan.loadEnvfx(0xb5);
            obj.world.envfxMan.loadEnvfx(0xb6);
            obj.world.envfxMan.loadEnvfx(0xb7);
        }
    },
    [423]: commonClass(),
    [424]: commonClass(undefined, undefined, undefined, 0.008), // SH_killermu (Note: This enemy has different anim speeds depending on current state)
    [425]: commonClass(0x1f),
    [427]: commonClass(0x18),
    [429]: class extends SFAClass { // SH_thorntai
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x19, undefined, undefined, 0.006);
            obj.scale *= data.getUint16(0x1c) / 1000;
        }
    },
    [430]: class extends SFAClass { // SH_LevelCon
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            // TODO: Load additional env fx
            // The game has entire tables of effects based on time of day, game progress, etc.
            obj.world.envfxMan.loadEnvfx(0x1b2);
            obj.world.envfxMan.loadEnvfx(0x1b3);
            obj.world.envfxMan.loadEnvfx(0x1b4);
        }

        override mount() {
            
        }
    },
    [437]: commonClass(),
    [438]: class extends SFAClass { // SC_LevelCon
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.world.envfxMan.loadEnvfx(0x4f);
            obj.world.envfxMan.loadEnvfx(0x50);
            obj.world.envfxMan.loadEnvfx(0x245);
        }

        public override mount(obj: ObjectInstance, world: World) {
            world.envfxMan.mistEnable = true;
            world.envfxMan.mistBottom = -1000.0;
            world.envfxMan.mistTop = world.envfxMan.mistBottom + 50.0;
        }

        public override unmount(obj: ObjectInstance, world: World) {
            world.envfxMan.mistEnable = false;
        }
    },
    [439]: class extends SFAClass { // SC_MusicTre
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x1a);
            obj.roll = angle16ToRads((data.getUint8(0x18) - 127) * 128);
            obj.pitch = angle16ToRads((data.getUint8(0x19) - 127) * 128);
            obj.scale = 3.6 * data.getFloat32(0x1c);
        }
    },
    [440]: commonClass(0x1a), // SC_totempol
    [442]: commonClass(),
    [445]: commonClass(0x18),
    [447]: commonClass(0x1c),
    [448]: commonClass(),
    [451]: commonClass(0x18),
    [452]: commonClass(0x18),
    [453]: commonClass(0x18),
    [454]: class extends SFAClass { // DIMCannon
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            if (obj.objType.typeNum !== 0x1d6)
                commonSetup(obj, data, 0x28);
        }
    },
    [455]: commonClass(0x18),
    [456]: commonClass(0x1c),
    [457]: commonClass(0x18),
    [459]: commonClass(0x18),
    [461]: class extends SFAClass { // DIM_LevelCo
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.world.envfxMan.loadEnvfx(0x160);
            obj.world.envfxMan.loadEnvfx(0x15a);
            obj.world.envfxMan.loadEnvfx(0x15c);
            obj.world.envfxMan.loadEnvfx(0x15f);
        }
    },
    [465]: commonClass(),
    [469]: commonClass(0x18),
    [472]: commonClass(0x1c),
    [473]: commonClass(0x18),
    [477]: commonClass(0x18),
    [487]: commonClass(),
    [488]: commonClass(),
    [489]: class extends SFAClass { // SB_Propelle
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            const modelNum = data.getInt8(0x1a);
            obj.setModelNum(modelNum);
        }
    },
    [490]: commonClass(),
    [491]: commonClass(),
    [492]: commonClass(),
    [496]: commonClass(0x18),
    [497]: class extends SFAClass { // SB_DeckDoor
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x18);
            const modelNum = data.getInt8(0x19) != 0 ? 1 : 0;
            obj.setModelNum(modelNum);
        }
    },
    [500]: class extends SFAClass { // SB_Lamp
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            if (obj.objType.typeNum === 0x3e4)
                commonSetup(obj, data, 0x1a);
            else
                commonSetup(obj, data, 0x18);
            obj.pitch = 0;
            obj.roll = 0;
        }
    },
    [502]: class extends SFAClass {
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            if (obj.objType.typeNum !== 0x803)
                commonSetup(obj, data, 0x18);
        }
    },
    [509]: commonClass(),
    [510]: commonClass(0x18),
    [513]: commonClass(0x18),
    [518]: Torch,
    [521]: class extends SFAClass { // WM_LevelCon
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.world.envfxMan.loadEnvfx(0x3c);
        }
    },
    [523]: commonClass(),
    [524]: class extends SFAClass { // WM_spiritpl
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x18);
            obj.pitch = angle16ToRads(data.getInt16(0x1a) << 8); // Yes, getInt16 is correct.
        }
    },
    [525]: commonClass(0x18),
    [533]: commonClass(),
    [535]: commonClass(0x1e),
    [538]: class extends SFAClass { // VFP_statueb
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            const scaleParam = data.getInt16(0x1c);
            if (scaleParam > 1) {
                obj.scale *= scaleParam;
            }
        }
    },
    [541]: commonClass(0x18), // VFPLift2
    [542]: commonClass(0x18), // VFP_Block1
    [543]: commonClass(0x18), // VFPLavaBloc
    [544]: class extends SFAClass { // VFP_DoorSwi
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x18, 0x19);
            // Roll is 16 bits
            obj.roll = angle16ToRads(data.getInt16(0x1c));
        }
    },
    [549]: commonClass(),
    [550]: class extends SFAClass { // VFP_lavapoo
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            let scaleParam = data.getInt16(0x1a);
            if (scaleParam === 0)
                scaleParam = 500;
            obj.scale = 1 / (scaleParam / getRandomInt(600, 1000));
        }
    },
    [551]: class extends SFAClass { // VFP_lavasta
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.position[1] += data.getInt16(0x1a);
        }
    },
    [552]: commonClass(0x18), // VFPSpPl
    [576]: commonClass(),
    [579]: commonClass(0x18),
    [597]: commonClass(0x18),
    [598]: commonClass(0x18),
    [599]: commonClass(0x18),
    [602]: class extends SFAClass { // StaticCamer
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.yaw = angle16ToRads(-data.getInt16(0x1c));
            obj.pitch = angle16ToRads(-data.getInt16(0x1e));
            obj.roll = angle16ToRads(-data.getInt16(0x20));
        }
    },
    [603]: commonClass(0x1f),
    [609]: commonClass(0x18),
    [613]: commonClass(0x1e),
    [614]: commonClass(0x18),
    [616]: commonClass(),
    [617]: commonClass(0x18),
    [619]: commonClass(0x18),
    [620]: class extends SFAClass {
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            if (obj.objType.typeNum !== 0x86a && obj.objType.typeNum !== 0x86b)
                commonSetup(obj, data, 0x18);
        }
    },
    [622]: commonClass(),
    [623]: commonClass(0x18),
    [627]: class extends SFAClass { // FlameMuzzle
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x18, 0x19);
            obj.roll = 0;
            const scaleParam = data.getInt16(0x1c);
            if (scaleParam != 0)
                obj.scale *= 0.1 * scaleParam;
        }
    },
    [641]: commonClass(0x18),
    [642]: commonClass(),
    [643]: commonClass(0x18),
    [644]: class extends SFAClass { // SPMapDR
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x1a, 0x1b);
            obj.setModelNum(data.getInt8(0x18));
        }
    },
    [645]: commonClass(),
    [646]: commonClass(),
    [648]: class extends SFAClass { // SPDrape
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x18);
            const scaleParam = data.getInt16(0x1a);
            if (scaleParam !== 0)
                obj.scale = 10 * scaleParam / 32767.0;
        }
    },
    [650]: commonClass(0x18),
    [653]: class extends SFAClass { // WCLevelCont
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.world.envfxMan.loadEnvfx(0x1fb);
            obj.world.envfxMan.loadEnvfx(0x1ff);
            obj.world.envfxMan.loadEnvfx(0x1fc);
            obj.world.envfxMan.loadEnvfx(0x1fd);
        }
    },
    [654]: templeClass(),
    [656]: class extends SFAClass { // WCPushBlock
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.setModelNum(data.getInt8(0x19));
        }
    },
    [657]: class extends SFAClass { // WCTile
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.position[1] += 25.0;
            obj.setModelNum(data.getInt8(0x19));
        }
    },
    [658]: templeClass(),
    [659]: class extends SFAClass { // CFSunTemple
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x18, 0x19, 0x1a);
            obj.setModelNum(data.getInt8(0x21));
        }
    },
    [660]: commonClass(0x18),
    [661]: templeClass(),
    [662]: templeClass(),
    [663]: class extends SFAClass { // WCTempleBri
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x18);
            obj.setModelNum(data.getInt8(0x19));
            // Caution: This will modify the materials for all instances of the model.
            // TODO: find a cleaner way to do this
            const mats = obj.modelInst!.getMaterials();
            for (let i = 0; i < mats.length; i++) {
                const mat = mats[i];
                if (mat !== undefined && mat instanceof StandardMaterial) {
                    mat.setBlendOverride((mb: SFAMaterialBuilder<MaterialRenderContext>) => {
                        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
                        mb.setZMode(true, GX.CompareType.LEQUAL, false);
                    });
                    mat.rebuild();
                }
            }
        }
    },
    [664]: class extends SFAClass { // WCFloorTile
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.yaw = angle16ToRads(-0x4000);
        }
    },
    [666]: commonClass(),
    [671]: commonClass(0x18),
    [672]: class extends SFAClass { // ARWGoldRing
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.yaw = angle16ToRads(-0x8000);
        }
    },
    [674]: commonClass(),
    [678]: commonClass(0x18, 0x19, 0x1a), // ARWBigAster
    [679]: class extends SFAClass { // ARWProximit
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            obj.yaw = angle16ToRads(getRandomInt(0, 0xffff));
            obj.pitch = angle16ToRads(getRandomInt(0, 0xffff));
            obj.roll = angle16ToRads(getRandomInt(0, 0xffff));
        }
    },
    [681]: LGTPointLgt, // LGTPointLgt
    [682]: commonClass(0x18, 0x19),
    [683]: LGTProjecte,
    [685]: decorClass(0.005), // TODO: Speed depends on romlist objtype
    [686]: decorClass(),
    [687]: decorClass(0.0025),
    [688]: decorClass(),
    [689]: Torch2,
    [690]: commonClass(0x1a, 0x19, 0x18),
    [691]: class extends SFAClass { // SkyVortS
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data);
            // Caution: This will modify the materials for all instances of the model.
            // TODO: find a cleaner way to do this
            const mats = obj.modelInst!.getMaterials();
            for (let i = 0; i < mats.length; i++) {
                const mat = mats[i];
                if (mat !== undefined && mat instanceof StandardMaterial) {
                    mat.setBlendOverride((mb: SFAMaterialBuilder<MaterialRenderContext>) => {
                        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
                        mb.setZMode(true, GX.CompareType.LEQUAL, false);
                    });
                    mat.rebuild();
                }
            }
        }
    },
    [693]: commonClass(),
    [694]: class extends SFAClass { // CNThitObjec
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            if (data.getInt8(0x19) === 2)
                obj.yaw = angle16ToRads(data.getInt16(0x1c));
        }
    },
};
