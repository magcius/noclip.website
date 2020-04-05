import { mat4, vec3 } from 'gl-matrix';
import { DataFetcher } from '../DataFetcher';
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { ColorTexture } from '../gfx/helpers/RenderTargetHelpers';
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderer";
import { getDebugOverlayCanvas2D, drawWorldSpaceText, drawWorldSpacePoint, drawWorldSpaceLine } from "../DebugJunk";

import { GameInfo } from './scenes';
import { Model, ModelCollection, ModelInstance } from './models';
import { SFATextureCollection } from './textures';
import { dataSubarray, angle16ToRads } from './util';
import { MaterialFactory } from './shaders';
import { SFAAnimationController } from './animation';
import { MapInstance } from './maps';

// An ObjectType is used to spawn ObjectInstance's.
// Each ObjectType inherits from an ObjectClass, where it shares most of its assets and logic.

export class ObjectType {
    public name: string;
    public scale: number = 1.0;
    public objClass: number;
    public modelInsts: ModelInstance[] = [];

    constructor(public typeNum: number, private data: DataView, private isEarlyObject: boolean) {
        // FIXME: where are these fields for early objects?
        this.scale = data.getFloat32(0x4);
        this.objClass = data.getInt16(0x50);

        this.name = '';
        let offs = isEarlyObject ? 0x58 : 0x91;
        let c;
        while ((c = data.getUint8(offs)) != 0) {
            this.name += String.fromCharCode(c);
            offs++;
        }
    }

    public async create(device: GfxDevice, materialFactory: MaterialFactory, modelColl: ModelCollection) {
        const data = this.data;

        const numModels = data.getUint8(0x55);
        const modelListOffs = data.getUint32(0x8);
        for (let i = 0; i < numModels; i++) {
            const modelNum = data.getUint32(modelListOffs + i * 4);
            try {
                const model = modelColl.createModelInstance(device, materialFactory, modelNum);
                this.modelInsts.push(model);
            } catch (e) {
                console.warn(`Failed to load model ${modelNum} due to exception:`);
                console.error(e);
            }
        }
    }
}

export class ObjectInstance {
    private modelInst: ModelInstance | null = null;
    private position: vec3 = vec3.create();
    private yaw: number = 0;
    private pitch: number = 0;
    private roll: number = 0;
    private scale: number = 1.0;

    constructor(device: GfxDevice, private objType: ObjectType, private objParams: DataView, texColl: SFATextureCollection, posInMap: vec3, mapInstance: MapInstance, tablesTab: DataView, tablesBin: DataView) {
        this.scale = objType.scale;
        
        this.position = vec3.fromValues(
            objParams.getFloat32(0x8),
            objParams.getFloat32(0xc),
            objParams.getFloat32(0x10)
        );
        const objClass = this.objType.objClass;
        const typeNum = this.objType.typeNum;
        this.modelInst = this.objType.modelInsts[0];

        if (objClass === 201) {
            // e.g. sharpclawGr
            this.yaw = (objParams.getInt8(0x2a) << 8) * Math.PI / 32768;
        } else if (objClass === 222 ||
            objClass === 227 ||
            objClass === 233 ||
            objClass === 234 ||
            objClass === 235 ||
            objClass === 280 ||
            objClass === 283 ||
            objClass === 291 ||
            objClass === 304 ||
            objClass === 312 ||
            objClass === 313 ||
            objClass === 316 ||
            objClass === 319 ||
            objClass === 343 ||
            objClass === 344 ||
            objClass === 387 ||
            objClass === 389 ||
            objClass === 423 ||
            objClass === 424 ||
            objClass === 437 ||
            objClass === 442 ||
            objClass === 487 ||
            objClass === 509 ||
            objClass === 533 ||
            objClass === 576 ||
            objClass === 642 ||
            objClass === 666 ||
            objClass === 691
        ) {
            // e.g. setuppoint
            // Do nothing
        } else if (objClass === 207) {
            // e.g. CannonClawO
            this.yaw = angle16ToRads(objParams.getInt8(0x28) << 8);
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
            objClass === 393 ||
            objClass === 445 ||
            objClass === 579 ||
            objClass === 510 ||
            objClass === 513 ||
            objClass === 525 ||
            objClass === 609 ||
            objClass === 617 ||
            objClass === 650
        ) {
            // e.g. SC_Pressure
            this.yaw = angle16ToRads(objParams.getUint8(0x18) << 8);
        } else if (objClass === 254) {
            // e.g. MagicPlant
            this.yaw = (objParams.getInt8(0x1d) << 8) * Math.PI / 32768;
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
            objClass === 275
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
            this.yaw = (objParams.getInt8(0x2c) << 8) * Math.PI / 32768;
            this.pitch = (objParams.getInt8(0x2d) << 8) * Math.PI / 32768;
            // FIXME: mode 8 and 0x1a also have roll at 0x38
        } else if (objClass === 294 && typeNum === 77) {
            this.yaw = (objParams.getInt8(0x3d) << 8) * Math.PI / 32768;
            this.pitch = (objParams.getInt8(0x3e) << 8) * Math.PI / 32768;
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
            this.roll = (objParams.getInt8(0x1a) << 8) * Math.PI / 32768;
            this.pitch = (objParams.getInt8(0x1b) << 8) * Math.PI / 32768;
            this.yaw = (objParams.getInt8(0x1c) << 8) * Math.PI / 32768;
        } else if (objClass === 308) {
            // e.g. texscroll2
            const block = mapInstance.getBlockAtPosition(posInMap[0], posInMap[2]);
            if (block === null) {
                console.warn(`couldn't find block for texscroll object`);
            } else {
                const scrollableIndex = objParams.getInt16(0x18);
                const speedX = objParams.getInt8(0x1e);
                const speedY = objParams.getInt8(0x1f);

                const tabValue = tablesTab.getUint32(0xe * 4);
                const targetTexId = tablesBin.getUint32(tabValue * 4 + scrollableIndex * 4) & 0x7fff;
                // Note: & 0x7fff above is an artifact of how the game stores tex id's.
                // Bit 15 set means the texture comes directly from TEX1 and does not go through TEXTABLE.

                const materials = block.getMaterials();
                for (let i = 0; i < materials.length; i++) {
                    if (materials[i] !== undefined) {
                        const mat = materials[i]!;
                        for (let j = 0; j < mat.shader.layers.length; j++) {
                            const layer = mat.shader.layers[j];
                            if (layer.texId === targetTexId) {
                                // Found the texture! Make it scroll now.
                                const theTexture = texColl.getTexture(device, targetTexId, true)!;
                                const dxPerFrame = (speedX << 16) / theTexture.width;
                                const dyPerFrame = (speedY << 16) / theTexture.height;
                                layer.scrollingTexMtx = mat.factory.setupScrollingTexMtx(dxPerFrame, dyPerFrame);
                                mat.rebuild();
                            }
                        }
                    }
                }
            }
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
        } else if (objClass === 346) {
            // e.g. SH_BombWall
            this.yaw = objParams.getInt16(0x1a) * Math.PI / 32768;
            this.pitch = objParams.getInt16(0x1c) * Math.PI / 32768;
            this.roll = objParams.getInt16(0x1e) * Math.PI / 32768;
            let objScale = objParams.getInt8(0x2d);
            if (objScale === 0) {
                objScale = 20;
            }
            this.scale *= objScale / 20;
        } else if (objClass === 372) {
            // e.g. CCriverflow
            this.yaw = angle16ToRads(objParams.getUint8(0x18) << 8);
            this.scale += objParams.getUint8(0x19) / 512;
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
        } else if (objClass === 429) {
            // e.g. ThornTail
            this.yaw = (objParams.getInt8(0x19) << 8) * Math.PI / 32768;
            this.scale *= objParams.getUint16(0x1c) / 1000;
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
        } else if (objClass === 627) {
            // e.g. FlameMuzzle
            const scaleParam = objParams.getInt16(0x1c);
            if (scaleParam != 0) {
                this.scale *= 0.1 * scaleParam;
            }
            this.roll = 0;
            this.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            this.pitch = angle16ToRads(objParams.getUint8(0x19) << 8);
        } else if (objClass === 683) {
            // e.g. LGTProjecte
            this.yaw = (objParams.getInt8(0x18) << 8) * Math.PI / 32768;
            this.pitch = (objParams.getInt8(0x19) << 8) * Math.PI / 32768;
            this.roll = (objParams.getInt8(0x34) << 8) * Math.PI / 32768;
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

    public async create() {

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

    public render(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, sceneTexture: ColorTexture, drawStep: number) {
        if (drawStep !== 0) {
            return; // TODO: Implement additional draw steps
        }

        if (this.modelInst !== null && this.modelInst !== undefined) {
            const mtx = mat4.create();
            mat4.fromTranslation(mtx, this.position);
            mat4.scale(mtx, mtx, [this.scale, this.scale, this.scale]);
            mat4.rotateY(mtx, mtx, this.yaw);
            mat4.rotateX(mtx, mtx, this.pitch);
            mat4.rotateZ(mtx, mtx, this.roll);

            this.modelInst.prepareToRender(device, renderInstManager, viewerInput, mtx, sceneTexture, drawStep);

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
    private modelColl: ModelCollection;
    private objectTypes: ObjectType[] = [];
    private tablesTab: DataView;
    private tablesBin: DataView;

    constructor(private gameInfo: GameInfo, private texColl: SFATextureCollection, private animController: SFAAnimationController, private useEarlyObjects: boolean) {
    }

    public async create(dataFetcher: DataFetcher, subdir: string) {
        const pathBase = this.gameInfo.pathBase;
        this.modelColl = new ModelCollection(this.texColl, this.animController, this.gameInfo);
        const [objectsTab, objectsBin, objindexBin, _, tablesTab, tablesBin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/OBJECTS.tab`),
            dataFetcher.fetchData(`${pathBase}/OBJECTS.bin`),
            !this.useEarlyObjects ? dataFetcher.fetchData(`${pathBase}/OBJINDEX.bin`) : null,
            this.modelColl.create(dataFetcher, subdir),
            dataFetcher.fetchData(`${pathBase}/TABLES.tab`),
            dataFetcher.fetchData(`${pathBase}/TABLES.bin`),
        ]);
        this.objectsTab = objectsTab.createDataView();
        this.objectsBin = objectsBin.createDataView();
        this.objindexBin = !this.useEarlyObjects ? objindexBin!.createDataView() : null;
        this.tablesTab = tablesTab.createDataView();
        this.tablesBin = tablesBin.createDataView();
    }

    public async loadObjectType(device: GfxDevice, materialFactory: MaterialFactory, typeNum: number, skipObjindex: boolean = false): Promise<ObjectType> {
        if (!this.useEarlyObjects && !skipObjindex) {
            typeNum = this.objindexBin!.getUint16(typeNum * 2);
        }

        if (this.objectTypes[typeNum] === undefined) {
            const offs = this.objectsTab.getUint32(typeNum * 4);
            const objType = new ObjectType(typeNum, dataSubarray(this.objectsBin, offs), this.useEarlyObjects);
            await objType.create(device, materialFactory, this.modelColl);
            this.objectTypes[typeNum] = objType;
        }

        return this.objectTypes[typeNum];
    }

    public async createObjectInstance(device: GfxDevice, materialFactory: MaterialFactory, typeNum: number, objParams: DataView, posInMap: vec3, mapInstance: MapInstance, skipObjindex: boolean = false) {
        const objType = await this.loadObjectType(device, materialFactory, typeNum, skipObjindex);
        const objInst = new ObjectInstance(device, objType, objParams, this.texColl, posInMap, mapInstance, this.tablesTab, this.tablesBin);
        await objInst.create();
        return objInst;
    }
}