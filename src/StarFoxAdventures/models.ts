import { nArray } from '../util';
import { mat4, ReadonlyMat4, vec3 } from 'gl-matrix';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { DataFetcher } from '../DataFetcher';
import * as GX_Material from '../gx/gx_material';
import { Color } from '../Color';

import { GameInfo } from './scenes';
import { MapLight, SFAMaterial } from './materials';
import { Keyframe, SFAAnimationController } from './animation';
import { MaterialFactory } from './materials';
import { dataSubarray, readUint32, setInt8Clamped, setInt16Clamped, mat4PostTranslate } from './util';
import { loadRes } from './resource';
import { TextureFetcher } from './textures';
import { Shape, ShapeRenderContext } from './shapes';
import { SceneRenderContext, SFARenderLists } from './render';
import { Skeleton, SkeletonInstance } from './skeleton';
import { loadModel, ModelVersion } from './modelloader';
import { transformVec3Mat4w0, transformVec3Mat4w1 } from '../MathHelpers';
import { LightType } from './WorldLights';
import { ObjectInstance } from './objects';
import { AABB } from '../Geometry';

interface Joint {
    parent: number;
    boneNum: number;
    translation: vec3;
    bindTranslation: vec3;
}

interface CoarseBlend {
    joint0: number;
    influence0: number;
    joint1: number;
    influence1: number;
}

type CreateModelShapesFunc = () => ModelShapes;

interface Fur {
    shape: Shape;
    numLayers: number;
}

export interface ModelRenderContext {
    sceneCtx: SceneRenderContext;
    showDevGeometry: boolean;
    ambienceIdx: number;
    outdoorAmbientColor: Color;
    object?: ObjectInstance;
    setupLights: (lights: GX_Material.Light[], typeMask: LightType) => void;
    mapLights?: MapLight[];
    cullByAabb?: boolean;
}

const BLOCK_FUR_RENDER_LAYER = 23;

const scratchMtx0 = mat4.create();
const scratchMtx1 = mat4.create();
const scratchMtx2 = mat4.create();
const scratchMtx3 = mat4.create();
const scratchVec0 = vec3.create();
const scratchBox0 = new AABB();

export class ModelShapes {
    // There is a Shape array for each draw step (opaques, translucents 1, and translucents 2)
    public shapes: Shape[][] = [];
    public furs: Fur[] = [];
    public waters: Shape[] = [];

    constructor(public model: Model, public posBuffer: DataView, public nrmBuffer?: DataView) {
    }

    public reloadVertices() {
        for (let i = 0; i < this.shapes.length; i++) {
            const shapes = this.shapes[i];
            for (let j = 0; j < shapes.length; j++)
                shapes[j].reloadVertices();
        }

        for (let i = 0; i < this.furs.length; i++)
            this.furs[i].shape.reloadVertices();

        for (let i = 0; i < this.waters.length; i++)
            this.waters[i].reloadVertices();
    }

    public addRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelCtx: ModelRenderContext, renderLists: SFARenderLists | null, matrix: mat4, matrixPalette: ReadonlyMat4[], overrideSortDepth?: number, overrideSortLayer?: number) {
        const lights = nArray(8, () => new GX_Material.Light());

        if (!this.model.isMapBlock && ((this.model.lightFlags & 0xc) === 0))
            modelCtx.setupLights(lights, LightType.POINT | LightType.DIRECTIONAL);
        else
            modelCtx.setupLights(lights, LightType.POINT);

        const shapeCtx: ShapeRenderContext = {
            modelCtx,
            setupLights: (dst: GX_Material.Light[]) => {
                for (let i = 0; i < dst.length; i++)
                    dst[i].copy(lights[i]);
            }
        };

        for (let i = 0; i < 3; i++) {
            if (this.shapes[i] !== undefined) {
                if (renderLists !== null)
                    renderInstManager.setCurrentRenderInstList(renderLists.world[i]);
                for (let j = 0; j < this.shapes[i].length; j++) {
                    const shape = this.shapes[i][j];
                    if (shape.isDevGeometry && !modelCtx.showDevGeometry)
                        continue;

                    mat4.copy(scratchMtx0, matrix);
                    mat4PostTranslate(scratchMtx0, this.model.modelTranslate);

                    let draw = true;
                    if (modelCtx.cullByAabb && shape.geom.aabb !== undefined) {
                        scratchBox0.transform(shape.geom.aabb, scratchMtx0);
                        draw = modelCtx.sceneCtx.viewerInput.camera.frustum.contains(scratchBox0);
                    }

                    if (draw)
                        shape.addRenderInsts(device, renderInstManager, scratchMtx0, shapeCtx, {}, matrixPalette, overrideSortDepth, overrideSortLayer);
                }
            }
        }
        
        if (renderLists !== null)
            renderInstManager.setCurrentRenderInstList(renderLists.waters);
        for (let i = 0; i < this.waters.length; i++) {
            mat4.copy(scratchMtx0, matrix);
            mat4PostTranslate(scratchMtx0, this.model.modelTranslate);
            this.waters[i].addRenderInsts(device, renderInstManager, scratchMtx0, shapeCtx, {}, matrixPalette);
        }
        
        if (renderLists !== null)
            renderInstManager.setCurrentRenderInstList(renderLists.furs);
        for (let i = 0; i < this.furs.length; i++) {
            const fur = this.furs[i];
            for (let j = 0; j < fur.numLayers; j++) {
                mat4.copy(scratchMtx0, matrix);
                mat4PostTranslate(scratchMtx0, 
                    [this.model.modelTranslate[0],
                    this.model.modelTranslate[1] + 0.4 * (j + 1),
                    this.model.modelTranslate[2]]);

                fur.shape.addRenderInsts(device, renderInstManager, scratchMtx0, shapeCtx, {
                    furLayer: j,
                }, matrixPalette, undefined, BLOCK_FUR_RENDER_LAYER);
            }
        }
    }

    public destroy(device: GfxDevice) {
        for (let i = 0; i < this.shapes.length; i++) {
            const shapes = this.shapes[i];
            for (let j = 0; j < shapes.length; j++)
                shapes[j].destroy(device);
        }
        this.shapes = [];

        for (let i = 0; i < this.furs.length; i++)
            this.furs[i].shape.destroy(device);
        this.furs = [];

        for (let i = 0; i < this.waters.length; i++)
            this.waters[i].destroy(device);
        this.waters = [];
    }
}

export interface FineSkin {
    vertexCount: number;
    bufferOffset: number;
    bone0: number;
    bone1: number;
    weights: DataView;
}

export class Model {
    public createModelShapes: CreateModelShapesFunc;
    public sharedModelShapes: ModelShapes | null = null;

    public modelData: DataView;

    public joints: Joint[] = [];
    public coarseBlends: CoarseBlend[] = [];
    public invBindTranslations: vec3[] = [];

    public modelTranslate: vec3 = vec3.create();
    public cullRadius: number = 10;
    public lightFlags: number = 0;

    public materials: (SFAMaterial | undefined)[] = [];

    public originalPosBuffer: DataView;
    public originalNrmBuffer: DataView;

    public hasFineSkinning: boolean = false;
    public hasBetaFineSkinning: boolean = false;
    public fineSkinPositionQuantizeScale: number = 0; // factor = 2 ^^ fineSkinQuantizeScale
    public fineSkinNormalQuantizeScale: number = 0;
    public fineSkinNBTNormals: boolean = false;
    public posFineSkins: FineSkin[] = [];
    public nrmFineSkins: FineSkin[] = [];
    
    public skeleton?: Skeleton;

    public isMapBlock: boolean;

    public constructor(public version: ModelVersion) {
    }

    public createInstanceShapes(): ModelShapes {
        if (this.hasFineSkinning) {
            // Fine-skinned models must use per-instance shapes
            return this.createModelShapes();
        } else {
            // Models without fine skinning can use per-model shapes
            return this.sharedModelShapes!;
        }
    }

    public getMaterials() {
        return this.materials;
    }

    public destroy(device: GfxDevice) {
        if (this.sharedModelShapes !== null) {
            this.sharedModelShapes.destroy(device);
            this.sharedModelShapes = null;
        }
    }
}

export class ModelInstance {
    private modelShapes: ModelShapes;

    public skeletonInst?: SkeletonInstance;

    public matrixPalette: mat4[] = [];
    private skinningDirty: boolean = true;
    private amap: DataView;
    public poses: Keyframe;

    constructor(public model: Model) {
        const numMatrices = this.model.joints.length + this.model.coarseBlends.length;
        if (numMatrices !== 0) {
            this.skeletonInst = new SkeletonInstance(this.model.skeleton!);
            this.matrixPalette = nArray(numMatrices, () => mat4.create());
        } else {
            this.matrixPalette = [mat4.create()];
        }

        this.skinningDirty = true;

        this.modelShapes = model.createInstanceShapes();
    }

    public getAmap(modelAnimNum: number): DataView {
        const stride = (((this.model.joints.length + 8) / 8)|0) * 8;
        return dataSubarray(this.amap, modelAnimNum * stride, stride);
    }

    public setAmap(amap: DataView) {
        this.amap = amap;
    }

    public getMaterials() {
        return this.model.getMaterials();
    }
    
    public resetPose() {
        mat4.identity(scratchMtx0);
        for (let i = 0; i < this.model.joints.length; i++)
            this.skeletonInst!.setPoseMatrix(i, scratchMtx0);

        this.skinningDirty = true;
    }
    
    public setJointPose(jointNum: number, mtx: mat4) {
        if (jointNum < 0 || jointNum >= this.model.joints.length)
            return;

        this.skeletonInst!.setPoseMatrix(jointNum, mtx);
        this.skinningDirty = true;
    }
    
    public addRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelCtx: ModelRenderContext, renderLists: SFARenderLists | null, matrix: mat4, overrideSortDepth?: number, overrideSortLayer?: number) {
        this.updateSkinning();
        this.modelShapes.addRenderInsts(device, renderInstManager, modelCtx, renderLists, matrix, this.matrixPalette, overrideSortDepth, overrideSortLayer);
    }
    
    private updateSkinning() {
        if (!this.skinningDirty)
            return;

        // Compute matrices for rigid joints (no blending)
        for (let i = 0; i < this.model.joints.length; i++) {
            const joint = this.model.joints[i];

            // For vertices with only one joint-influence, positions are stored in joint-local space
            // as an optimization.
            mat4.copy(this.matrixPalette[joint.boneNum], this.skeletonInst!.getJointMatrix(joint.boneNum));

            // FIXME: Check beta models
        }

        // Compute matrices for coarse blending
        for (let i = 0; i < this.model.coarseBlends.length; i++) {
            const blend = this.model.coarseBlends[i];

            // For vertices with more than one joint-influence, positions are stored in model space.
            // Therefore, inverse bind translations must be applied.
            mat4.translate(scratchMtx0, this.matrixPalette[blend.joint0], this.model.invBindTranslations[blend.joint0]);
            mat4.multiplyScalar(scratchMtx0, scratchMtx0, blend.influence0);
            mat4.translate(scratchMtx1, this.matrixPalette[blend.joint1], this.model.invBindTranslations[blend.joint1]);
            mat4.multiplyScalarAndAdd(this.matrixPalette[this.model.joints.length + i], scratchMtx0, scratchMtx1, blend.influence1)
        }

        this.performFineSkinning();

        this.skinningDirty = false;
    }

    private performFineSkinning() {
        if (!this.model.hasFineSkinning)
            return;

        const boneMtx0 = scratchMtx2;
        const boneMtx1 = scratchMtx3;
        const pos = scratchVec0;

        // The original game performs fine skinning on the CPU.
        // A more appropriate place for these calculations might be in a vertex shader.
        let quant = 1 << this.model.fineSkinPositionQuantizeScale;
        let dequant = 1 / quant;
        for (let i = 0; i < this.model.posFineSkins.length; i++) {
            const skin = this.model.posFineSkins[i];

            mat4.copy(boneMtx0, this.matrixPalette[skin.bone0]);
            mat4.copy(boneMtx1, this.matrixPalette[skin.bone1]);
            if (!this.model.hasBetaFineSkinning) {
                mat4.translate(boneMtx0, boneMtx0, this.model.invBindTranslations[skin.bone0]);
                mat4.translate(boneMtx1, boneMtx1, this.model.invBindTranslations[skin.bone1]);
            }

            const src = this.model.originalPosBuffer;
            const dst = this.modelShapes.posBuffer;
            let bufferOffs = skin.bufferOffset;
            let weightOffs = 0;
            for (let j = 0; j < skin.vertexCount; j++) {
                pos[0] = src.getInt16(bufferOffs) * dequant;
                pos[1] = src.getInt16(bufferOffs + 2) * dequant;
                pos[2] = src.getInt16(bufferOffs + 4) * dequant;

                const weight0 = skin.weights.getUint8(weightOffs) / 128;
                const weight1 = skin.weights.getUint8(weightOffs + 1) / 128;
                mat4.multiplyScalar(scratchMtx0, boneMtx0, weight0);
                mat4.multiplyScalarAndAdd(scratchMtx0, scratchMtx0, boneMtx1, weight1);
                transformVec3Mat4w1(pos, scratchMtx0, pos);

                setInt16Clamped(dst, bufferOffs + 0, pos[0] * quant);
                setInt16Clamped(dst, bufferOffs + 2, pos[1] * quant);
                setInt16Clamped(dst, bufferOffs + 4, pos[2] * quant);

                bufferOffs += 6;
                weightOffs += 2;
            }
        }

        quant = 1 << this.model.fineSkinNormalQuantizeScale;
        dequant = 1 / quant;
        for (let i = 0; i < this.model.nrmFineSkins.length; i++) {
            const skin = this.model.nrmFineSkins[i];

            mat4.copy(boneMtx0, this.matrixPalette[skin.bone0]);
            mat4.copy(boneMtx1, this.matrixPalette[skin.bone1]);
            if (!this.model.hasBetaFineSkinning) {
                mat4.translate(boneMtx0, boneMtx0, this.model.invBindTranslations[skin.bone0]);
                mat4.translate(boneMtx1, boneMtx1, this.model.invBindTranslations[skin.bone1]);
            }

            // FIXME: Handle NBT mode. I don't know whether any models use fine skinning and NBT,
            // but the original game is able to handle such models.
            const src = this.model.originalNrmBuffer;
            const dst = this.modelShapes.nrmBuffer!;
            let bufferOffs = skin.bufferOffset;
            let weightOffs = 0;
            for (let j = 0; j < skin.vertexCount; j++) {
                pos[0] = src.getInt8(bufferOffs + 0) * dequant;
                pos[1] = src.getInt8(bufferOffs + 1) * dequant;
                pos[2] = src.getInt8(bufferOffs + 2) * dequant;

                const weight0 = skin.weights.getUint8(weightOffs) / 128;
                const weight1 = skin.weights.getUint8(weightOffs + 1) / 128;
                // The output normal is not scaled to magnitude 1. This doesn't matter, since the GX
                // allegedly rescales normals automatically.
                mat4.multiplyScalar(scratchMtx0, boneMtx0, weight0);
                mat4.multiplyScalarAndAdd(scratchMtx0, scratchMtx0, boneMtx1, weight1);
                transformVec3Mat4w0(pos, scratchMtx0, pos);

                // XXX: the following might be more accurate to the game?
                // transformVec3Mat4w0(nrm0, boneMtx0, pos);
                // transformVec3Mat4w0(nrm1, boneMtx1, pos);
                // vec3.scale(pos, nrm0, weight0);
                // vec3.scaleAndAdd(pos, pos, nrm1, weight1);

                setInt8Clamped(dst, bufferOffs + 0, pos[0] * quant);
                setInt8Clamped(dst, bufferOffs + 1, pos[1] * quant);
                setInt8Clamped(dst, bufferOffs + 2, pos[2] * quant);

                bufferOffs += 3;
                weightOffs += 2;
            }
        }

        // Rerun all display lists
        this.modelShapes.reloadVertices();
    }

    public destroy(device: GfxDevice) {
        // Destroy our shapes only if they are not shared
        if (this.model.sharedModelShapes === null) {
            this.modelShapes.destroy(device);
        }
    }
}

class ModelsFile {
    private tab: DataView;
    private bin: ArrayBufferSlice;
    private models: (Model | undefined)[] = [];

    private constructor(private materialFactory: MaterialFactory, private texFetcher: TextureFetcher, private animController: SFAAnimationController, private modelVersion: ModelVersion) {
    }

    private async init(gameInfo: GameInfo, dataFetcher: DataFetcher, subdir: string) {
        const pathBase = gameInfo.pathBase;
        const [tab, bin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/${subdir}/MODELS.tab`),
            dataFetcher.fetchData(`${pathBase}/${subdir}/MODELS.bin`),
        ]);
        this.tab = tab.createDataView();
        this.bin = bin;
    }

    public static async create(gameInfo: GameInfo, dataFetcher: DataFetcher, subdir: string, materialFactory: MaterialFactory, texFetcher: TextureFetcher, animController: SFAAnimationController, modelVersion: ModelVersion): Promise<ModelsFile> {
        const self = new ModelsFile(materialFactory, texFetcher, animController, modelVersion);
        await self.init(gameInfo, dataFetcher, subdir);
        return self;
    }

    public hasModel(num: number): boolean {
        if (num < 0 || num * 4 >= this.tab.byteLength)
            return false;

        return readUint32(this.tab, 0, num) !== 0;
    }

    public getNumModels(): number {
        return (this.tab.byteLength / 4)|0;
    }

    public getModel(num: number): Model {
        if (this.models[num] === undefined) {
            console.log(`Loading model #${num} ...`);
    
            const modelTabValue = readUint32(this.tab, 0, num);
            if (modelTabValue === 0)
                throw Error(`Model #${num} not found`);
    
            const modelOffs = modelTabValue & 0xffffff;
            const modelData = loadRes(this.bin.subarray(modelOffs + 0x24));
            this.models[num] = loadModel(modelData.createDataView(), this.texFetcher, this.materialFactory, this.modelVersion);
        }

        return this.models[num]!;
    }

    public destroy(device: GfxDevice) {
        for (let model of this.models)
            if (model !== undefined)
                model.destroy(device);
    }
}

export class ModelFetcher {
    private files: {[subdir: string]: ModelsFile} = {};

    private constructor(private gameInfo: GameInfo, private texFetcher: TextureFetcher, private materialFactory: MaterialFactory, private animController: SFAAnimationController, private modelVersion: ModelVersion) {
    }

    public static async create(gameInfo: GameInfo, texFetcher: Promise<TextureFetcher>, materialFactory: MaterialFactory, animController: SFAAnimationController, modelVersion: ModelVersion = ModelVersion.Final): Promise<ModelFetcher> {
        return new ModelFetcher(gameInfo, await texFetcher, materialFactory, animController, modelVersion);
    }

    private async loadSubdir(subdir: string, dataFetcher: DataFetcher) {
        if (this.files[subdir] === undefined) {
            this.files[subdir] = await ModelsFile.create(this.gameInfo, dataFetcher, subdir, this.materialFactory, this.texFetcher, this.animController, this.modelVersion);

            // XXX: These maps require additional model files to be loaded
            if (subdir === 'shipbattle')
                await this.loadSubdir('', dataFetcher);
            else if (subdir === 'shop')
                await this.loadSubdir('swaphol', dataFetcher);
        }
    }

    public async loadSubdirs(subdirs: string[], dataFetcher: DataFetcher) {
        const promises = [];
        for (let subdir of subdirs)
            promises.push(this.loadSubdir(subdir, dataFetcher));

        await Promise.all(promises);
    }

    public getNumModels() {
        let result = 0;
        for (let s in this.files) {
            const file = this.files[s];
            result = Math.max(result, file.getNumModels());
        }

        return result;
    }

    private getModelsFileWithModel(modelNum: number): ModelsFile | null {
        for (let s in this.files) {
            if (this.files[s].hasModel(modelNum))
                return this.files[s];
        }

        return null;
    }

    public getModel(num: number): Model | null {
        const file = this.getModelsFileWithModel(num);
        if (file === null) {
            console.warn(`Model ID ${num} was not found in any loaded subdirectories (${Object.keys(this.files)})`);
            return null;
        }

        return file.getModel(num);
    }

    public createModelInstance(num: number): ModelInstance {
        const model = this.getModel(num);
        if (model === null)
            throw Error(`Model ${num} not found`);
        return new ModelInstance(model);
    }

    public destroy(device: GfxDevice) {
        for (let file in this.files) {
            this.files[file].destroy(device);
        }
        this.files = {};
    }
}