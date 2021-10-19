import { mat4, vec3, quat } from 'gl-matrix';
import { DataFetcher } from '../DataFetcher';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import * as GX_Material from '../gx/gx_material';
import * as GX from '../gx/gx_enum';
import { getDebugOverlayCanvas2D, drawWorldSpacePoint, drawWorldSpaceLine, drawWorldSpaceText } from "../DebugJunk";
import { colorNewFromRGBA } from '../Color';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder';
import { computeViewMatrix } from '../Camera';
import { ViewerRenderInput } from '../viewer';
import { getRandomInt } from '../SuperMarioGalaxy/ActorUtil';
import { SFA_CLASSES } from './Objects/Classes';
import { SFAClass } from './Objects/SFAClass';

import { StandardMaterial } from './materials';
import { ModelInstance, ModelRenderContext } from './models';
import { dataSubarray, angle16ToRads, readVec3, mat4FromSRT, readUint32, readUint16, getCamPos } from './util';
import { Anim, interpolateKeyframes, Keyframe, applyKeyframeToModel } from './animation';
import { World } from './world';
import { SceneRenderContext, SFARenderLists } from './render';
import { getMatrixTranslation } from '../MathHelpers';

const scratchColor0 = colorNewFromRGBA(1, 1, 1, 1);
const scratchVec0 = vec3.create();
const scratchVec1 = vec3.create();
const scratchMtx0 = mat4.create();
const scratchMtx1 = mat4.create();

// An SFAClass holds common data and logic for one or more ObjectTypes.
// An ObjectType serves as a template to spawn ObjectInstances.

export interface ObjectUpdateContext {
    viewerInput: ViewerRenderInput;
}

export const CommonObjectParams_SIZE = 0x14;
interface CommonObjectParams {
    objType: number;
    ambienceValue: number;
    layerValues: number[/* 2 */];
    position: vec3;
    id: number;
}

function parseCommonObjectParams(objParams: DataView): CommonObjectParams {
    return {
        objType: objParams.getUint16(0x0),
        ambienceValue: (objParams.getUint8(0x5) >>> 3) & 0x3,
        layerValues: [
            objParams.getUint8(0x3),
            objParams.getUint8(0x5),
        ],
        position: readVec3(objParams, 0x8),
        id: objParams.getUint32(0x14),
    };
}

export class ObjectType {
    public name: string;
    public scale: number = 1.0;
    public objClass: number;
    public modelNums: number[] = [];
    public isDevObject: boolean = false;
    public adjustCullRadius: number = 0;
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

        // console.log(`object ${this.name} scale ${this.scale}`);

        const numModels = data.getUint8(0x55);
        const modelListOffs = data.getUint32(0x8);
        for (let i = 0; i < numModels; i++) {
            const modelNum = readUint32(data, modelListOffs, i);
            this.modelNums.push(modelNum);
        }

        const flags = data.getUint32(0x44);
        this.isDevObject = !!(flags & 1);
        if (this.objClass === 293) {
            // XXX: Object type "curve" is not marked as a dev object, but it should be treated as one.
            this.isDevObject = true;
        }

        this.adjustCullRadius = data.getUint8(0x73);

        this.ambienceNum = data.getUint8(0x8e);
    }
}

export interface ObjectRenderContext {
    sceneCtx: SceneRenderContext;
    showDevGeometry: boolean;
    setupLights: (lights: GX_Material.Light[], modelCtx: ModelRenderContext) => void;
}

export interface Light {
    position: vec3;
}

const OBJECT_RENDER_LAYER = 31; // FIXME: For some spawn flags, 7 is used.

export class ObjectInstance {
    public modelInst: ModelInstance | null = null;

    public parent: ObjectInstance | null = null;

    public commonObjectParams: CommonObjectParams;
    public position: vec3 = vec3.create();
    public yaw: number = 0;
    public pitch: number = 0;
    public roll: number = 0;
    public scale: number = 1.0;
    private srtMatrix: mat4 = mat4.create();
    private srtDirty: boolean = true;
    private cullRadius: number = 10;

    private modelAnimNum: number | null = null;
    private anim: Anim | null = null;
    private modanim: DataView;

    private ambienceNum: number = 0;

    public animSpeed: number = 0.1; // Default to a sensible value.
    // In the game, each object class is responsible for driving its own animations
    // at the appropriate speed.

    public internalClass?: SFAClass;

    constructor(public world: World, public objType: ObjectType, public objParams: DataView, public posInMap: vec3) {
        this.scale = objType.scale;

        this.commonObjectParams = parseCommonObjectParams(objParams);

        if (this.commonObjectParams.ambienceValue !== 0)
            this.ambienceNum = this.commonObjectParams.ambienceValue - 1;
        else
            this.ambienceNum = objType.ambienceNum;

        vec3.copy(this.position, this.commonObjectParams.position);
        
        const objClass = this.objType.objClass;
        const typeNum = this.objType.typeNum;
        
        this.setModelNum(0);

        if (objClass in SFA_CLASSES) {
            try {
                this.internalClass = new SFA_CLASSES[objClass](this, objParams);
            } catch (e) {
                console.warn(`Failed to setup object class ${objClass} type ${typeNum} due to exception:`);
                console.error(e);
            }
        } else {
            console.log(`Don't know how to setup object class ${objClass} objType ${typeNum}`);
        }
    }

    public mount() {
        if (this.internalClass !== undefined)
            this.internalClass.mount(this, this.world);
    }

    public unmount() {
        if (this.internalClass !== undefined)
            this.internalClass.unmount(this, this.world);
    }

    public setParent(parent: ObjectInstance | null) {
        this.parent = parent;
        if (parent !== null)
            console.log(`attaching this object (${this.objType.name}) to parent ${parent?.objType.name}`);
    }

    public getLocalSRT(): mat4 {
        if (this.srtDirty) {
            mat4FromSRT(this.srtMatrix, this.scale, this.scale, this.scale,
                this.yaw, this.pitch, this.roll,
                this.position[0], this.position[1], this.position[2]);
            this.srtDirty = false;
        }

        return this.srtMatrix;
    }

    public getSRTForChildren(): mat4 {
        const result = mat4.create();
        mat4.fromTranslation(result, this.position);
        // mat4.scale(result, result, [this.scale, this.scale, this.scale]);
        mat4.rotateY(result, result, this.yaw);
        mat4.rotateX(result, result, this.pitch);
        mat4.rotateZ(result, result, this.roll);
        return result;
    }

    public getWorldSRT(out: mat4) {
        const localSrt = this.getLocalSRT();
        if (this.parent !== null) {
            mat4.mul(out, this.parent.getSRTForChildren(), localSrt);
        } else {
            mat4.copy(out, localSrt);
        }
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

            this.cullRadius = 10;
            if (this.modelInst.model.cullRadius > this.cullRadius)
                this.cullRadius = this.modelInst.model.cullRadius;
            if (this.objType.adjustCullRadius !== 0)
                this.cullRadius *= 10 * this.objType.adjustCullRadius / 255;

            if (this.modanim.byteLength > 0 && amap.byteLength > 0)
                this.setModelAnimNum(0);
        } catch (e) {
            console.warn(`Failed to load model ${num} due to exception:`);
            console.error(e);
            this.modelInst = null;
        }
    }

    public setModelAnimNum(num: number) {
        this.modelAnimNum = num;
        const modanim = readUint16(this.modanim, 0, num);
        this.setAnim(this.world.resColl.animColl.getAnim(modanim));
    }

    public setAnim(anim: Anim | null) {
        this.anim = anim;
    }

    public isInLayer(layer: number): boolean {
        if (layer === 0)
            return true;
        else if (layer < 9)
            return ((this.commonObjectParams.layerValues[0] >>> (layer - 1)) & 1) === 0;
        else
            return ((this.commonObjectParams.layerValues[1] >>> (16 - layer)) & 1) === 0;
    }

    private curKeyframe: Keyframe | undefined = undefined;

    public update(updateCtx: ObjectUpdateContext) {
        if (this.internalClass !== undefined)
            this.internalClass.update(this, updateCtx);
    }

    private isFrustumCulled(viewerInput: ViewerRenderInput): boolean {
        const worldMtx = scratchMtx0;
        this.getWorldSRT(worldMtx);
        const worldPos = scratchVec0;
        getMatrixTranslation(worldPos, worldMtx);
        return !viewerInput.camera.frustum.containsSphere(worldPos, this.cullRadius * this.scale);
    }

    public addRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists | null, objectCtx: ObjectRenderContext) {
        if (this.modelInst !== null && this.modelInst !== undefined && !this.isFrustumCulled(objectCtx.sceneCtx.viewerInput)) {
            // Update animation
            if (this.anim !== null && (!this.modelInst.model.hasFineSkinning || this.world.animController.enableFineSkinAnims)) {
                // TODO: use time values from animation data?
                const amap = this.modelInst.getAmap(this.modelAnimNum!);
                const kfTime = (this.world.animController.animController.getTimeInFrames() * this.animSpeed) % this.anim.keyframes.length;

                const kf0Num = Math.floor(kfTime);
                let kf1Num = kf0Num + 1;
                if (kf1Num >= this.anim.keyframes.length)
                    kf1Num = 0;

                const kf0 = this.anim.keyframes[kf0Num];
                const kf1 = this.anim.keyframes[kf1Num];
                const ratio = kfTime - kf0Num;
                this.curKeyframe = interpolateKeyframes(kf0, kf1, ratio, this.curKeyframe);
                applyKeyframeToModel(this.curKeyframe, this.modelInst, amap);
            }

            const worldMtx = scratchMtx0;
            this.getWorldSRT(worldMtx);
            const viewMtx = scratchMtx1;
            computeViewMatrix(viewMtx, objectCtx.sceneCtx.viewerInput.camera);
            const worldPos = scratchVec0;
            getMatrixTranslation(worldPos, worldMtx);
            const viewPos = scratchVec1;
            vec3.transformMat4(viewPos, worldPos, viewMtx);
            this.world.envfxMan.getAmbientColor(scratchColor0, this.ambienceNum);
            // const debugCtx = getDebugOverlayCanvas2D();
            // drawWorldSpacePoint(debugCtx, objectCtx.sceneCtx.viewerInput.camera.clipFromWorldMatrix, worldPos);
            // drawWorldSpaceText(debugCtx, objectCtx.sceneCtx.viewerInput.camera.clipFromWorldMatrix, worldPos, this.objType.name + " (" + -viewPos[2] + ")");
            this.modelInst.addRenderInsts(device, renderInstManager, {
                ...objectCtx,
                outdoorAmbientColor: scratchColor0,
            }, renderLists, worldMtx, -viewPos[2], OBJECT_RENDER_LAYER);
        }
    }

    public destroy(device: GfxDevice) {
        this.modelInst?.destroy(device);
        this.modelInst = null;
    }
}

export class ObjectManager {
    private objectsTab: DataView;
    private objectsBin: DataView;
    private objindexBin: DataView | null;
    private objectTypes: ObjectType[] = [];

    private constructor(private world: World, private useEarlyObjects: boolean) {
    }

    private async init(dataFetcher: DataFetcher) {
        const pathBase = this.world.gameInfo.pathBase;
        const [objectsTab, objectsBin, objindexBin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/OBJECTS.tab`),
            dataFetcher.fetchData(`${pathBase}/OBJECTS.bin`),
            !this.useEarlyObjects ? dataFetcher.fetchData(`${pathBase}/OBJINDEX.bin`) : null,
        ]);
        this.objectsTab = objectsTab.createDataView();
        this.objectsBin = objectsBin.createDataView();
        this.objindexBin = !this.useEarlyObjects ? objindexBin!.createDataView() : null;
    }

    public static async create(world: World, dataFetcher: DataFetcher, useEarlyObjects: boolean): Promise<ObjectManager> {
        const self = new ObjectManager(world, useEarlyObjects);
        await self.init(dataFetcher);
        return self;
    }

    public getObjectType(typeNum: number, skipObjindex: boolean = false): ObjectType {
        if (!this.useEarlyObjects && !skipObjindex)
            typeNum = readUint16(this.objindexBin!, 0, typeNum);

        if (this.objectTypes[typeNum] === undefined) {
            const offs = readUint32(this.objectsTab, 0, typeNum);
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