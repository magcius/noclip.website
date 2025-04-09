import {
    ReadonlyMat4,
    ReadonlyVec3,
    mat3,
    mat4,
    quat,
    vec2,
    vec3,
    vec4,
} from "gl-matrix";
import {
    ConvexHull,
    WowAABBox,
    WowAdt,
    WowAdtChunkDescriptor,
    WowAdtLiquidLayer,
    WowAdtWmoDefinition,
    WowBlp,
    WowDatabase,
    WowDoodad,
    WowDoodadDef,
    WowGlobalWmoDefinition,
    WowLightResult,
    WowLiquidResult,
    WowM2,
    WowM2AnimationManager,
    WowM2BlendingMode,
    WowM2BoneFlags,
    WowM2MaterialFlags,
    WowM2ParticleEmitter,
    WowM2ParticleShaderType,
    WowMapFileDataIDs,
    WowModelBatch,
    WowSkin,
    WowSkinSubmesh,
    WowSkyboxMetadata,
    WowVec3,
    WowWmo,
    WowWmoGroupDescriptor,
    WowWmoGroupFlags,
    WowWmoGroupInfo,
    WowWmoHeaderFlags,
    WowWmoLiquidResult,
    WowWmoMaterial,
    WowWmoMaterialBatch,
    WowWmoMaterialFlags,
    WowWmoMaterialPixelShader,
    WowWmoMaterialVertexShader,
} from "../../rust/pkg/noclip_support";
import { DataFetcher } from "../DataFetcher.js";
import { AABB, Frustum } from "../Geometry.js";
import {
    Mat4Identity,
    MathConstants,
    computeModelMatrixSRT,
    randomRange,
    saturate,
    scaleMatrix,
    setMatrixTranslation,
    transformVec3Mat4w0,
} from "../MathHelpers.js";
import { getDerivativeBezier, getPointBezier } from "../Spline.js";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers.js";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers.js";
import {
    fillMatrix4x2,
    fillMatrix4x4,
    fillVec3v,
    fillVec4,
    fillVec4v,
} from "../gfx/helpers/UniformBufferHelpers.js";
import {
    GfxBlendFactor,
    GfxBlendMode,
    GfxBuffer,
    GfxBufferUsage,
    GfxChannelWriteMask,
    GfxCompareMode,
    GfxCullMode,
    GfxDevice,
    GfxFormat,
    GfxIndexBufferDescriptor,
    GfxInputLayout,
    GfxInputLayoutBufferDescriptor,
    GfxMegaStateDescriptor,
    GfxTexture,
    GfxVertexAttributeDescriptor,
    GfxVertexBufferDescriptor,
    GfxVertexBufferFrequency,
    makeTextureDescriptor2D,
} from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import {
    GfxRenderInst,
    GfxRendererLayer,
    makeSortKey,
    makeSortKeyOpaque,
    makeSortKeyTranslucent,
} from "../gfx/render/GfxRenderInstManager.js";
import { rust } from "../rustlib.js";
import { assert } from "../util.js";
import { ModelProgram, WmoProgram } from "./program.js";
import {
    MapArray,
    View,
    adtSpaceFromPlacementSpace,
    modelSpaceFromPlacementSpace,
    placementSpaceFromAdtSpace,
    placementSpaceFromModelSpace,
} from "./scenes.js";
import { Sheepfile } from "./util.js";

export class Database {
    private inner: WowDatabase;

    public async load(cache: WowCache) {
        const [
            lightDbData,
            lightDataDbData,
            lightParamsDbData,
            liquidTypes,
            lightSkyboxData,
        ] = await Promise.all([
            cache.fetchDataByFileID(1375579), // lightDbData
            cache.fetchDataByFileID(1375580), // lightDataDbData
            cache.fetchDataByFileID(1334669), // lightParamsDbData
            cache.fetchDataByFileID(1371380), // liquidTypes
            cache.fetchDataByFileID(1308501), // lightSkyboxData
        ]);

        this.inner = rust.WowDatabase.new(
            lightDbData,
            lightDataDbData,
            lightParamsDbData,
            liquidTypes,
            lightSkyboxData,
        );
    }

    public getAllSkyboxes(mapId: number): WowSkyboxMetadata[] {
        return this.inner.get_all_skyboxes(mapId);
    }

    public getGlobalLightingData(
        lightdbMapId: number,
        coords: ReadonlyVec3,
        time: number,
    ): WowLightResult {
        return this.inner.get_lighting_data(
            lightdbMapId,
            coords[0],
            coords[1],
            coords[2],
            time,
        );
    }

    public getLiquidType(liquidType: number): WowLiquidResult | undefined {
        return this.inner.get_liquid_type(liquidType);
    }
}

type LoadFunc<T> = (fileId: number) => Promise<T>;

// fileID, uniqueID, lodLevel
type WmoDefinitionKey = [number, number, number];

export class WowCache {
    private sheepfile: Sheepfile;
    private promiseCache = new Map<number, Promise<any>>();
    private promiseCacheLiquidTypes = new Map<number, Promise<LiquidType>>(); // liquid types aren't fileIDs
    private wmoDefinitionCache = new Map<string, WmoDefinition>(); // keys are WmoDefinitionKey.toString()
    private models: ModelData[] = [];

    constructor(
        public dataFetcher: DataFetcher,
        public db: Database,
    ) {
        this.sheepfile = new Sheepfile(this.dataFetcher);
    }

    public async load() {
        await this.sheepfile.load();
        await this.db.load(this);
    }

    public getFileDataId(fileName: string): number {
        if (fileName === "") {
            throw new Error(`must provide valid filename`);
        }
        const result = this.sheepfile.getFileDataId(fileName);
        if (result === undefined) {
            throw new Error(
                `failed to find FileDataId for fileName ${fileName}`,
            );
        } else {
            return result;
        }
    }

    public getWmoDefinition(
        def: WowAdtWmoDefinition,
        data: WmoData,
        lodLevel: number,
    ): WmoDefinition {
        const key: WmoDefinitionKey = [def.name_id, def.unique_id, lodLevel];
        const keyString = key.toString();
        let result = this.wmoDefinitionCache.get(keyString);
        if (!result) {
            result = WmoDefinition.fromAdtDefinition(def, data);
            this.wmoDefinitionCache.set(keyString, result);
        }
        return result;
    }

    public async fetchFileByID<T>(
        fileId: number,
        constructor: (data: Uint8Array) => T,
    ): Promise<T> {
        const buf = await this.fetchDataByFileID(fileId);
        const result = constructor(buf);
        return result;
    }

    public async fetchDataByFileID(fileId: number): Promise<Uint8Array> {
        const data = await this.sheepfile.loadFileId(fileId);
        if (!data) {
            throw new Error(`no data for fileId ${fileId}`);
        }
        return data;
    }

    public clear() {
        this.promiseCache.clear();
        this.promiseCacheLiquidTypes.clear();
    }

    private getOrLoad<T>(
        fileId: number,
        loadFunc: LoadFunc<T>,
        cache = this.promiseCache,
    ): Promise<T> {
        let promise = cache.get(fileId) as Promise<T>;
        if (promise === undefined) {
            promise = loadFunc(fileId);
            cache.set(fileId, promise);
        }
        return promise;
    }

    public async loadModel(fileId: number): Promise<ModelData> {
        return this.getOrLoad(fileId, async (fileId: number) => {
            const d = new ModelData(fileId);
            await d.load(this);
            this.models.push(d);
            return d;
        });
    }

    public async loadWmo(fileId: number): Promise<WmoData> {
        return this.getOrLoad(fileId, async (fileId: number) => {
            const d = new WmoData(fileId);
            await d.load(this);
            return d;
        });
    }

    public async loadBlp(fileId: number): Promise<WowBlp> {
        return this.getOrLoad(fileId, async (fileId: number) => {
            return await this.fetchFileByID(fileId, rust.WowBlp.new);
        });
    }

    public async loadLiquidType(type: number): Promise<LiquidType> {
        return this.getOrLoad(
            type,
            async (type: number) => {
                const liquidTypeDb = this.db.getLiquidType(type);
                if (!liquidTypeDb) {
                    throw new Error(
                        `WowDatabase didn't have LiquidType ${type}`,
                    );
                }
                const liquidType = new LiquidType(this, type, liquidTypeDb);
                await liquidType.load(this);
                return liquidType;
            },
            this.promiseCacheLiquidTypes,
        );
    }

    public destroy(device: GfxDevice): void {
        this.sheepfile.destroy();
        this.models.forEach(model => model.destroy(device));
        this.clear();
    }
}

export const enum ProceduralTexture {
    River = 0,
    Ocean = 0,
    Wmo = 0,
}

export const enum LiquidCategory {
    Water = 0,
    Ocean = 1,
    Lava = 2,
    Slime = 3,
}

export class LiquidType {
    public flags: number;
    public category: LiquidCategory;
    public name: string;
    public blps: Map<number, BlpData> = new Map();
    public animatedTextureIds: number[] | undefined;
    public proceduralTexture: ProceduralTexture | undefined;
    public textureIds: (number | undefined)[] = [];

    constructor(cache: WowCache, public type: number, liquid: WowLiquidResult) {
        this.flags = liquid.flags;
        this.name = liquid.name;
        if (this.name.includes("Slime")) {
            this.category = LiquidCategory.Slime;
        } else if (this.name.includes("Magma") || this.name.includes("Lava")) {
            this.category = LiquidCategory.Lava;
        } else if (this.name.includes("Ocean")) {
            this.category = LiquidCategory.Ocean;
        } else {
            this.category = LiquidCategory.Water;
        }
        const positionalTemplate = liquid.tex0;
        if (positionalTemplate) {
            const positionals = [];
            for (let i = 1; i < 31; i++) {
                const fileName = positionalTemplate.replace("%d", i.toString());
                try {
                    const fileDataId = cache.getFileDataId(fileName);
                    assert(
                        fileDataId !== undefined,
                        "couldn't find positional texture",
                    );
                    positionals.push(fileDataId);
                } catch (e) {
                    if (i !== 1) {
                        break;
                    } else {
                        throw e;
                    }
                }
            }
            this.animatedTextureIds = positionals;
        }
        const maybeProcedural = liquid.tex1;
        if (maybeProcedural && maybeProcedural.startsWith("procedural")) {
            if (maybeProcedural.includes("River")) {
                this.proceduralTexture = ProceduralTexture.River;
            } else if (maybeProcedural.includes("Ocean")) {
                this.proceduralTexture = ProceduralTexture.Ocean;
            } else if (maybeProcedural.includes("Wmo")) {
                this.proceduralTexture = ProceduralTexture.Wmo;
            }
        } else {
            this.textureIds.push(this.pathToFileId(cache, maybeProcedural));
        }
        this.textureIds.push(this.pathToFileId(cache, liquid.tex2));
        this.textureIds.push(this.pathToFileId(cache, liquid.tex3));
        this.textureIds.push(this.pathToFileId(cache, liquid.tex4));
        this.textureIds.push(this.pathToFileId(cache, liquid.tex5));
        liquid.free();
    }

    public async load(cache: WowCache): Promise<undefined> {
        if (this.animatedTextureIds) {
            const blp = await Promise.all(
                this.animatedTextureIds.map((blpId) => cache.loadBlp(blpId)),
            );
            for (let i = 0; i < blp.length; i++)
                this.blps.set(
                    this.animatedTextureIds[i],
                    new BlpData(this.animatedTextureIds[i], blp[i]),
                );
        }
    }

    private pathToFileId(cache: WowCache, path: string): number | undefined {
        if (path === "") {
            return undefined;
        }
        return cache.getFileDataId(this.fixPath(path));
    }

    private fixPath(path: string): string {
        if (!path.endsWith(".blp")) {
            path += ".blp";
        }
        return path;
    }
}

function convertWowVec3(wowVec3: WowVec3): vec3 {
    const result = vec3.fromValues(wowVec3.x, wowVec3.y, wowVec3.z);
    wowVec3.free();
    return result;
}

function convertWowAABB(aabb: WowAABBox): AABB {
    const min = aabb.min;
    const max = aabb.max;
    const result = new AABB(min.x, min.y, min.z, max.x, max.y, max.z);
    aabb.free();
    min.free();
    max.free();
    return result;
}

export class SkyboxData {
    public modelKey: string;
    public modelFileId: number | undefined;
    public modelData: ModelData | undefined;

    constructor(public filename: string, public flags: number) {
        this.modelKey = filename;
        if (this.filename.endsWith(".mdx")) {
            this.modelKey = this.modelKey.replace(".mdx", ".m2");
        }
    }

    public async load(cache: WowCache) {
        this.modelFileId = cache.getFileDataId(this.modelKey);
        if (this.modelFileId === undefined) {
            throw new Error(
                `couldn't find fileDataId for skybox "${this.modelKey}"`,
            );
        }
        this.modelData = await cache.loadModel(this.modelFileId);
    }
}

export class ParticleEmitter {
    public textures: (BlpData | null)[] = [];
    public fragShaderType: number;
    public blendMode: WowM2BlendingMode;
    public texScaleY: number;
    public texScaleX: number;
    public alphaTest: number;
    private texHeight: number;
    private texWidth: number;
    private pixelData: Float32Array;
    private dataTexture: GfxTexture | undefined;
    private sortKeyBase = 0;

    constructor(public index: number, public emitter: WowM2ParticleEmitter, private model: ModelData) {
        let textureIds = emitter.get_texture_ids();
        for (let i=0; i<3; i++) {
            if (textureIds[i] !== undefined) {
                this.textures.push(model.blps[textureIds[i]]);
            } else {
                this.textures.push(null);
            }
        }
        this.fragShaderType = this.emitter.frag_shader_type;
        this.blendMode = this.emitter.blend_mode;
        this.alphaTest = this.emitter.alpha_test;
        this.texScaleX = this.emitter.tex_scale_x;
        this.texScaleY = this.emitter.tex_scale_y;
        this.texHeight = this.maxParticles();
        this.texWidth = rust.WowM2ParticleEmitter.get_texels_per_particle();
        this.pixelData = new Float32Array(this.texHeight * this.texWidth * 4);
        this.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT + this.index);
    }

    public maxParticles(): number {
        return this.emitter.max_particles;
    }

    public setMegaStateFlags(renderInst: GfxRenderInst) {
        setM2BlendModeMegaState(renderInst, this.blendMode, true);
        renderInst.sortKey = this.sortKeyBase;
    }

    private ensureTexture(device: GfxDevice) {
        if (this.dataTexture === undefined) {
            this.dataTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.F32_RGBA, this.texWidth, this.texHeight, 1));
        }
    }

    public update(dtMilliseconds: number, animationManager: WowM2AnimationManager) {
        const bone = this.model.boneData[this.emitter.bone];
        this.emitter.update(
            dtMilliseconds,
            animationManager,
            bone.transform as Float32Array,
            bone.postBillboardTransform as Float32Array,
        );
    }

    public updateDataTex(device: GfxDevice): GfxTexture {
        this.ensureTexture(device);
        this.emitter.fill_texture(this.pixelData);
        device.uploadTextureData(this.dataTexture!, 0, [this.pixelData]);
        return this.dataTexture!;
    }

    public numParticles(): number {
        return this.emitter.num_particles();
    }

    public destroy(device: GfxDevice) {
        if (this.dataTexture)
            device.destroyTexture(this.dataTexture);
    }
}

export class ModelData {
    private scratchMat4 = mat4.create();
    public skins: SkinData[] = [];
    public blps: BlpData[] = [];
    public vertexBuffer: Uint8Array;
    public vertexColors: Float32Array;
    public numTextureTransformations: number;
    public textureWeights: Float32Array;
    public textureRotations: Float32Array;
    public textureScalings: Float32Array;
    public textureTranslations: Float32Array;
    public numColors: number;
    public numBones: number;
    public flags: number;
    public boneRotations: Float32Array;
    public boneScalings: Float32Array;
    public boneTranslations: Float32Array;
    public boneData: BoneData[] = [];
    public textureTransforms: mat4[] = [];
    public materials: [WowM2BlendingMode, WowM2MaterialFlags][] = [];
    public animationManager: WowM2AnimationManager;
    public textureLookupTable: Uint16Array;
    public boneLookupTable: Uint16Array;
    public textureTransparencyLookupTable: Uint16Array;
    public textureTransformLookupTable: Uint16Array;
    public modelAABB: AABB;
    public numLights: number;
    public ambientLightColors: Float32Array;
    public diffuseLightColors: Float32Array;
    public lightAttenuationStarts: Float32Array;
    public lightAttenuationEnds: Float32Array;
    public lightVisibilities: Uint8Array;
    public lightBones: Int16Array;
    public lightPositions: Float32Array;
    public particleEmitters: ParticleEmitter[] = [];

    constructor(public fileId: number) {}

    private loadTextures(cache: WowCache, m2: WowM2): Promise<BlpData[]> {
        const textureEntries = m2.take_legacy_textures();
        return Promise.all(
            textureEntries.map(async (entry, i) => {
                const flags = entry.flags;
                let fileID = m2.texture_ids[i];
                if (fileID === undefined)
                    fileID = cache.getFileDataId(entry.filename);
                entry.free();

                if (fileID === 0) return null!;

                // XXX(jstpierre): Blackrock Depths seems to have invalid texture IDs on world/khazmodan/blackrock/passivedoodads/golemparts/cannongolemwaist.m2
                return new BlpData(fileID, await cache.loadBlp(fileID), flags);
            }),
        );
    }

    public lookupTexture(n: number): BlpData | null {
        if (this.textureLookupTable[n] !== undefined) {
            if (this.blps[this.textureLookupTable[n]] !== undefined) {
                return this.blps[this.textureLookupTable[n]];
            }
        }
        return null;
    }

    private loadSkins(cache: WowCache, m2: WowM2): Promise<SkinData[]> {
        return Promise.all(
            Array.from(m2.skin_ids).map(async (fileId) => {
                const skin = await cache.fetchFileByID(
                    fileId,
                    rust.WowSkin.new,
                );
                const skinData = new SkinData(skin, this);
                return skinData;
            }),
        );
    }

    public async load(cache: WowCache): Promise<undefined> {
        const m2 = await cache.fetchFileByID(this.fileId, rust.WowM2.new);
        this.flags = m2.flags;

        this.vertexBuffer = m2.take_vertex_data();
        this.modelAABB = convertWowAABB(m2.get_bounding_box());

        this.textureLookupTable = m2.take_texture_lookup();
        this.boneLookupTable = m2.take_bone_lookup();
        this.textureTransformLookupTable = m2.take_texture_transform_lookup();
        this.textureTransparencyLookupTable =
            m2.take_texture_transparency_lookup();

        const m2Materials = m2.materials;
        this.materials = m2Materials.map((mat) => {
            return [mat.blending_mode, rust.WowM2MaterialFlags.new(mat.flags)];
        });
        m2Materials.forEach((mat) => mat.free());

        this.blps = await this.loadTextures(cache, m2);
        this.skins = await this.loadSkins(cache, m2);

        this.particleEmitters = m2
            .take_particle_emitters()
            .map((emitter, i) => {
                return new ParticleEmitter(i, emitter, this);
            });

        this.animationManager = m2.take_animation_manager();
        this.textureWeights = new Float32Array(this.animationManager.get_num_texture_weights());
        this.numTextureTransformations = this.animationManager.get_num_transformations();
        this.textureTranslations = new Float32Array(this.numTextureTransformations * 3);
        this.textureRotations = new Float32Array(this.numTextureTransformations * 4);
        this.textureScalings = new Float32Array(this.numTextureTransformations * 3);
        this.numBones = this.animationManager.get_num_bones();
        this.boneTranslations = new Float32Array(this.numBones * 3);
        this.boneRotations = new Float32Array(this.numBones * 4);
        this.boneScalings = new Float32Array(this.numBones * 3);
        this.numColors = this.animationManager.get_num_colors();
        this.numLights = this.animationManager.get_num_lights();
        assert(
            this.numLights <= 4,
            `model ${this.fileId} has ${this.numLights} lights`,
        );
        this.vertexColors = new Float32Array(this.numColors * 4);
        this.ambientLightColors = new Float32Array(this.numLights * 4);
        this.diffuseLightColors = new Float32Array(this.numLights * 4);
        this.lightAttenuationStarts = new Float32Array(this.numLights);
        this.lightAttenuationEnds = new Float32Array(this.numLights);
        this.lightVisibilities = new Uint8Array(this.numLights);
        this.lightBones = this.animationManager.get_light_bones();
        this.lightPositions = this.animationManager.get_light_positions();
        for (let i = 0; i < this.numTextureTransformations; i++) {
            this.textureTransforms.push(mat4.create());
        }

        const boneParents = this.animationManager.get_bone_parents();
        const boneFlags = this.animationManager.get_bone_flags();
        const bonePivots = this.animationManager.get_bone_pivots();
        for (let i = 0; i < this.numBones; i++) {
            const bonePivot = bonePivots[i];
            const pivot = mat4.fromTranslation(mat4.create(), [bonePivot.x, bonePivot.y, bonePivot.z]);
            const antiPivot = mat4.fromTranslation(mat4.create(), [-bonePivot.x, -bonePivot.y, -bonePivot.z]);
            const bone = new BoneData(pivot, antiPivot, boneFlags[i], boneParents[i]);
            if (bone.parentBoneId >= 0) {
                bone.isSphericalBillboard ||= this.boneData[bone.parentBoneId].isSphericalBillboard;
            }
            this.boneData.push(bone);

            bonePivot.free();
        }

        m2.free();
    }

    public updateAnimation(view: View) {
        this.animationManager.update(view.deltaTime);
        this.animationManager.update_textures(
            this.textureWeights,
            this.textureTranslations,
            this.textureRotations,
            this.textureScalings,
        );
        this.animationManager.update_bones(
            this.boneTranslations,
            this.boneRotations,
            this.boneScalings,
        );
        this.animationManager.update_vertex_colors(this.vertexColors);
        this.animationManager.update_lights(
            this.ambientLightColors,
            this.diffuseLightColors,
            this.lightAttenuationStarts,
            this.lightAttenuationEnds,
            this.lightVisibilities,
        );

        for (let i = 0; i < this.numTextureTransformations; i++) {
            const rot = this.textureRotations.slice(i * 4, (i + 1) * 4);
            const trans = this.textureTranslations.slice(i * 3, (i + 1) * 3);
            const scale = this.textureScalings.slice(i * 3, (i + 1) * 3);
            const dst = this.textureTransforms[i];
            mat4.fromRotationTranslationScaleOrigin(dst, rot, trans, scale, [0.5, 0.5, 0]);
        }

        const localBoneTransform = this.scratchMat4;
        for (let i = 0; i < this.numBones; i++) {
            const bone = this.boneData[i];
            assert(bone.parentBoneId < i, "bone parent > bone");
            mat4.fromRotationTranslationScale(
                localBoneTransform,
                this.boneRotations.slice(i * 4, (i + 1) * 4),
                this.boneTranslations.slice(i * 3, (i + 1) * 3),
                this.boneScalings.slice(i * 3, (i + 1) * 3),
            );
            mat4.mul(localBoneTransform, bone.pivot, localBoneTransform);
            if (bone.parentBoneId >= 0) {
                const parentBone = this.boneData[bone.parentBoneId];
                if (bone.isSphericalBillboard) {
                    mat4.mul(bone.transform, parentBone.transform, bone.antiPivot);
                    mat4.mul(bone.postBillboardTransform, parentBone.postBillboardTransform, localBoneTransform);
                } else {
                    mat4.mul(localBoneTransform, localBoneTransform, bone.antiPivot);
                    mat4.mul(bone.postBillboardTransform, parentBone.postBillboardTransform, localBoneTransform);
                }
            } else {
                if (bone.isSphericalBillboard) {
                    mat4.copy(bone.transform, bone.antiPivot);
                    mat4.copy(bone.postBillboardTransform, localBoneTransform);
                } else {
                    mat4.mul(localBoneTransform, localBoneTransform, bone.antiPivot);
                    mat4.copy(bone.postBillboardTransform, localBoneTransform);
                }
            }
        }

        this.particleEmitters.forEach((emitter) => {
            emitter.update(view.deltaTime, this.animationManager);
        });
    }

    public getVertexColor(index: number): vec4 {
        if (index * 4 < this.vertexColors.length) {
            return this.vertexColors.slice(index * 4, (index + 1) * 4);
        }
        return [1, 1, 1, 1];
    }

    public destroy(device: GfxDevice) {
        this.particleEmitters.forEach(emitter => emitter.destroy(device));
    }
}

export class BlpData {
    constructor(
        public fileId: number,
        public inner: WowBlp,
        public flags: number = 0,
    ) {}
}

function makeSortKeyBase(blendMode: WowM2BlendingMode, layer: number = 0): number {
    if (blendMode === rust.WowM2BlendingMode.Opaque)
        return makeSortKeyOpaque(GfxRendererLayer.OPAQUE, layer);
    else if (blendMode === rust.WowM2BlendingMode.AlphaKey)
        return makeSortKeyOpaque(GfxRendererLayer.ALPHA_TEST, layer);
    else
        return makeSortKeyTranslucent(GfxRendererLayer.TRANSLUCENT + layer);
}

export class WmoBatchData {
    public indexStart: number;
    public indexCount: number;
    public materialId: number;
    public material: WowWmoMaterial;
    public materialFlags: WowWmoMaterialFlags;
    public vertexShader: WowWmoMaterialVertexShader;
    public pixelShader: WowWmoMaterialPixelShader;
    public textures: (BlpData | null)[] = [];
    public visible = true;
    public sidnColor: vec4;
    public sortKeyBase = 0;

    constructor(batch: WowWmoMaterialBatch, wmo: WmoData) {
        this.indexStart = batch.start_index;
        this.indexCount = batch.index_count;
        if (batch.use_material_id_large > 0) {
            this.materialId = batch.material_id_large;
        } else {
            this.materialId = batch.material_id;
        }
        this.material = wmo.materials[this.materialId];
        for (let blpId of [this.material.texture_1, this.material.texture_2, this.material.texture_3]) {
            if (blpId === 0) {
                this.textures.push(null);
            } else {
                this.textures.push(wmo.blps.get(blpId)!);
            }
        }
        const sidnColor = this.material.sidn_color;
        this.sidnColor = vec4.fromValues(
            sidnColor.r / 255.0,
            sidnColor.g / 255.0,
            sidnColor.b / 255.0,
            sidnColor.a / 255.0,
        );
        sidnColor.free();
        this.materialFlags = rust.WowWmoMaterialFlags.new(this.material.flags);
        this.vertexShader = this.material.get_vertex_shader();
        this.pixelShader = this.material.get_pixel_shader();

        this.sortKeyBase = makeSortKeyBase(this.material.blend_mode);
    }

    public setMegaStateFlags(renderInst: GfxRenderInst) {
        setM2BlendModeMegaState(renderInst, this.material.blend_mode, this.materialFlags.unculled);
        renderInst.sortKey = this.sortKeyBase;
    }
}

export class BoneData {
    public transform = mat4.create();
    public postBillboardTransform = mat4.create();
    public isSphericalBillboard: boolean;

    constructor(public pivot: mat4, public antiPivot: mat4, public flags: WowM2BoneFlags, public parentBoneId: number) {
        this.isSphericalBillboard = flags.spherical_billboard;
    }
}

export class WmoData {
    public wmo: WowWmo;
    public flags: WowWmoHeaderFlags;
    public groupInfos: WowWmoGroupInfo[] = [];
    public groupIdToIndex: Map<number, number> = new Map();
    public groupDefAABBs: Map<number, AABB> = new Map();
    public blps: Map<number, BlpData> = new Map();
    public materials: WowWmoMaterial[] = [];
    public models: Map<number, ModelData> = new Map();
    public modelIds: Uint32Array;
    public liquidTypes: Map<number, LiquidType> = new Map();
    public liquids: LiquidInstance[] = [];
    public skyboxModel: ModelData | null = null;
    public groupIds: number[] = [];
    public groupLiquids: MapArray<number, number> = new MapArray();
    public groupDescriptors: WowWmoGroupDescriptor[] = [];
    public vertexBuffer: Uint8Array;
    public indexBuffer: Uint16Array;

    constructor(public fileId: number) {}

    private loadTextures(cache: WowCache): Promise<unknown> {
        const textureSet = new Set<number>();
        for (const material of this.materials) {
            if (material.texture_1 !== 0) textureSet.add(material.texture_1);
            if (material.texture_2 !== 0) textureSet.add(material.texture_2);
            if (material.texture_3 !== 0) textureSet.add(material.texture_3);
        }

        return Promise.all(
            Array.from(textureSet).map(async (fileId) => {
                try {
                    this.blps.set(
                        fileId,
                        new BlpData(fileId, await cache.loadBlp(fileId)),
                    );
                } catch (e) {
                    console.error(`failed to fetch BLP: ${e}`);
                }
            }),
        );
    }

    private loadModels(cache: WowCache): Promise<unknown> {
        return Promise.all(
            Array.from(this.modelIds).map(async (fileId) => {
                if (fileId === 0) return;
                this.models.set(fileId, await cache.loadModel(fileId));
            }),
        );
    }

    private loadGroups(cache: WowCache): Promise<unknown> {
        this.groupInfos = this.wmo.group_infos;
        return Promise.all(
            Array.from(this.wmo.group_file_ids).map(async (fileId, i) => {
                this.groupIds.push(fileId);
                this.groupIdToIndex.set(fileId, i);
                const groupData = await cache.fetchDataByFileID(fileId);
                this.wmo.append_group(fileId, groupData);

                const groupInfo = this.groupInfos[i];
                this.groupDefAABBs.set(
                    fileId,
                    convertWowAABB(groupInfo.bounding_box),
                );
            }),
        );
    }

    private async loadLiquids(cache: WowCache) {
        for (let groupId of this.groupIds) {
            const liquids = this.wmo.take_liquid_data(groupId);
            if (liquids) {
                for (let liquid of liquids) {
                    const instance = LiquidInstance.fromWmoLiquid(liquid);
                    const index = this.liquids.length;
                    this.liquids.push(instance);
                    this.groupLiquids.append(groupId, index);
                    if (!this.liquidTypes.has(instance.liquidType)) {
                        this.liquidTypes.set(
                            instance.liquidType,
                            await cache.loadLiquidType(instance.liquidType),
                        );
                    }
                }
            }
        }
    }

    public async load(cache: WowCache): Promise<void> {
        this.wmo = await cache.fetchFileByID(this.fileId, rust.WowWmo.new);
        this.flags = this.wmo.header.get_flags();
        if (this.wmo.skybox_file_id) {
            this.skyboxModel = await cache.loadModel(this.wmo.skybox_file_id);
        }
        if (this.wmo.skybox_name) {
            console.warn(`WMO skybox name ${this.wmo.skybox_name}`);
        }
        assert(!this.flags.lod, "wmo with lod");

        this.materials = this.wmo.textures;
        this.modelIds = this.wmo.doodad_file_ids;

        await Promise.all([
            this.loadTextures(cache),
            this.loadModels(cache),
            this.loadGroups(cache),
        ]);
        await this.loadLiquids(cache);

        for (const fileId of this.wmo.group_file_ids) {
            this.groupDescriptors.push(this.wmo.get_group_descriptor(fileId));
            if (this.groupDescriptors[this.groupDescriptors.length - 1].antiportal) {
                console.log('antiportal detected!!!', fileId);
            }
        }

        this.vertexBuffer = this.wmo.take_vertex_data();
        this.indexBuffer = this.wmo.take_indices();
    }

    public getBatches(group: WowWmoGroupDescriptor): WmoBatchData[] {
        let wowBatches = this.wmo.get_group_batches(group.group_id);
        return wowBatches.map(batch => new WmoBatchData(batch, this));
    }

    public getGroup(groupId: number): WowWmoGroupDescriptor | undefined {
        const index = this.groupIdToIndex.get(groupId);
        if (index !== undefined) {
            return this.groupDescriptors[index];
        }
        return undefined;
    }
}


export class SkinData {
    public submeshes: WowSkinSubmesh[];
    public indexBuffer: Uint16Array;
    public batches: ModelBatch[];

    constructor(public skin: WowSkin, model: ModelData) {
        this.submeshes = skin.submeshes;
        this.batches = skin.batches.map((batch) => new ModelBatch(batch, this.skin, model));
        this.indexBuffer = skin.take_indices();
    }
}

export class ModelBatch {
    public vertexShaderId: number;
    public fragmentShaderId: number;
    public blendMode: WowM2BlendingMode;
    public materialFlags: WowM2MaterialFlags;
    public submesh: WowSkinSubmesh;
    public layer: number;
    public tex0: BlpData;
    public tex1: BlpData | null;
    public tex2: BlpData | null;
    public tex3: BlpData | null;
    private sortKeyBase = 0;

    constructor(public batch: WowModelBatch, public skin: WowSkin, public model: ModelData) {
        this.fragmentShaderId = batch.get_pixel_shader();
        this.vertexShaderId = batch.get_vertex_shader();
        this.submesh = skin.submeshes[batch.skin_submesh_index];
        [this.blendMode, this.materialFlags] = model.materials[this.batch.material_index];
        this.layer = this.batch.material_layer;
        this.tex0 = this.getBlp(0)!;
        this.tex1 = this.getBlp(1);
        this.tex2 = this.getBlp(2);
        this.tex3 = this.getBlp(3);
        this.sortKeyBase = makeSortKeyBase(this.blendMode, this.layer);
    }

    public setMegaStateFlags(renderInst: GfxRenderInst) {
        setM2BlendModeMegaState(
            renderInst,
            this.blendMode,
            this.materialFlags.two_sided,
            this.materialFlags.depth_write,
            this.materialFlags.depth_tested,
        );
        renderInst.sortKey = this.sortKeyBase;
    }

    private getBlp(n: number): BlpData | null {
        if (n < this.batch.texture_count) {
            return this.model.lookupTexture(this.batch.texture_combo_index + n);
        }
        return null;
    }

    private getCurrentVertexColor(): vec4 {
        return this.model.getVertexColor(this.batch.color_index);
    }

    private getTextureTransform(texIndex: number): ReadonlyMat4 {
        const lookupIndex = this.batch.texture_transform_combo_index + texIndex;
        const transformIndex = this.model.textureTransformLookupTable[lookupIndex];
        if (transformIndex !== undefined && transformIndex < this.model.textureTransforms.length)
            return this.model.textureTransforms[transformIndex];
        return Mat4Identity;
    }

    public getTextureWeight(texIndex: number): number {
        const lookupIndex = this.batch.texture_weight_combo_index + texIndex;
        const transparencyIndex = this.model.textureTransparencyLookupTable[lookupIndex];
        if (transparencyIndex !== undefined && transparencyIndex < this.model.textureWeights.length)
            return this.model.textureWeights[transparencyIndex];
        return 1.0;
    }

    private getVertexColorAlpha(): number {
        const color = this.getCurrentVertexColor();
        let finalTransparency = color[3];
        if (!(this.batch.flags & 0x40))
            finalTransparency *= this.getTextureWeight(0);
        // TODO skyboxes need another alpha value mixed in
        return finalTransparency;
    }

    public setModelParams(renderInst: GfxRenderInst) {
        let offset = renderInst.allocateUniformBuffer(
            ModelProgram.ub_MaterialParams,
            4 * 4 + 8 * 4,
        );
        const uniformBuf = renderInst.mapUniformBufferF32(
            ModelProgram.ub_MaterialParams,
        );
        offset += fillVec4(
            uniformBuf,
            offset,
            this.fragmentShaderId,
            this.vertexShaderId,
            0,
            0,
        );
        offset += fillVec4(
            uniformBuf,
            offset,
            this.blendMode,
            this.materialFlags.unfogged ? 1 : 0,
            this.materialFlags.unlit ? 1 : 0,
        );
        const color = this.getCurrentVertexColor();
        offset += fillVec4(
            uniformBuf,
            offset,
            color[0],
            color[1],
            color[2],
            this.getVertexColorAlpha(),
        );
        offset += fillMatrix4x2(
            uniformBuf,
            offset,
            this.getTextureTransform(0),
        );
        offset += fillMatrix4x2(
            uniformBuf,
            offset,
            this.getTextureTransform(1),
        );
        offset += fillVec4(uniformBuf, offset,
            this.getTextureWeight(0),
            this.getTextureWeight(1),
            this.getTextureWeight(2),
            this.getTextureWeight(3),
        );
    }
}

function setM2BlendModeMegaState(renderInst: GfxRenderInst, blendMode: WowM2BlendingMode, doubleSided: boolean = false, depthWrite?: boolean, depthTest = true) {
    const defaultBlendState = {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.One,
        blendDstFactor: GfxBlendFactor.Zero,
    };

    if (depthWrite === undefined) {
        depthWrite = (blendMode === rust.WowM2BlendingMode.Opaque || blendMode === rust.WowM2BlendingMode.AlphaKey);
    }

    const cullMode = doubleSided ? GfxCullMode.None : GfxCullMode.Back;
    const depthCompare = depthTest ? reverseDepthForCompareMode(GfxCompareMode.Less) : GfxCompareMode.Always;

    let settings: Partial<GfxMegaStateDescriptor> = {
        cullMode,
        depthWrite,
        depthCompare,
        attachmentsState: [
            {
                channelWriteMask: GfxChannelWriteMask.RGB,
                rgbBlendState: defaultBlendState,
                alphaBlendState: defaultBlendState,
            },
        ],
    };

    switch (blendMode) {
        case rust.WowM2BlendingMode.Alpha: {
            settings.attachmentsState![0].rgbBlendState = {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            };
            settings.attachmentsState![0].alphaBlendState = {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.One,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            };
            settings.attachmentsState![0].channelWriteMask = GfxChannelWriteMask.AllChannels;
            break;
        }
        case rust.WowM2BlendingMode.NoAlphaAdd: {
            settings.attachmentsState![0].rgbBlendState = {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.One,
                blendDstFactor: GfxBlendFactor.One,
            };
            settings.attachmentsState![0].alphaBlendState = {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.Zero,
                blendDstFactor: GfxBlendFactor.One,
            };
            break;
        }
        case rust.WowM2BlendingMode.Add: {
            settings.attachmentsState![0].rgbBlendState = {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.One,
            };
            settings.attachmentsState![0].alphaBlendState = {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.Zero,
                blendDstFactor: GfxBlendFactor.One,
            };
            settings.attachmentsState![0].channelWriteMask = GfxChannelWriteMask.AllChannels;
            break;
        }
        case rust.WowM2BlendingMode.Mod: {
            settings.attachmentsState![0].rgbBlendState = {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.Dst,
                blendDstFactor: GfxBlendFactor.Zero,
            };
            settings.attachmentsState![0].alphaBlendState = {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.DstAlpha,
                blendDstFactor: GfxBlendFactor.Zero,
            };
            break;
        }
        case rust.WowM2BlendingMode.Mod2x: {
            settings.attachmentsState![0].rgbBlendState = {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.Dst,
                blendDstFactor: GfxBlendFactor.Src,
            };
            settings.attachmentsState![0].alphaBlendState = {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.DstAlpha,
                blendDstFactor: GfxBlendFactor.SrcAlpha,
            };
            break;
        }
        case rust.WowM2BlendingMode.BlendAdd: {
            settings.attachmentsState![0].rgbBlendState = {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.One,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            };
            settings.attachmentsState![0].alphaBlendState = {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.One,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            };
            break;
        }
        case rust.WowM2BlendingMode.Opaque:
        case rust.WowM2BlendingMode.AlphaKey:
            break;
    }

    renderInst.setMegaStateFlags(settings);
}

export class WmoDefinition {
    public modelMatrix: mat4 = mat4.create();
    public placementMatrix: mat4 = mat4.create();
    public invPlacementMatrix: mat4 = mat4.create();
    public invModelMatrix: mat4 = mat4.create();

    public worldAABB: AABB = new AABB();

    public visible = true;
    public groupIdToDoodadIndices: MapArray<number, number> = new MapArray();
    public groupAmbientColors: Map<number, vec4> = new Map();
    public groupIdToLiquidIndices: MapArray<number, number> = new MapArray();
    public liquidAABBs: AABB[] = [];
    public doodadIndexToGroupIds: MapArray<number, number> = new MapArray();
    public doodadIndexToDoodad: Map<number, DoodadData> = new Map();

    private scratchVec3 = vec3.create();

    public static fromAdtDefinition(def: WowAdtWmoDefinition, wmo: WmoData) {
        const scale = def.scale / 1024;
        const position = convertWowVec3(def.position);
        const rotation = convertWowVec3(def.rotation);
        const aabb = convertWowAABB(def.extents);
        const fileId = def.name_id;
        const uniqueId = def.unique_id;
        const doodadSet = def.doodad_set;
        def.free();
        return new WmoDefinition(
            fileId,
            wmo,
            uniqueId,
            doodadSet,
            scale,
            position,
            rotation,
            aabb,
        );
    }

    public static fromGlobalDefinition(def: WowGlobalWmoDefinition, wmo: WmoData) {
        const scale = 1.0;
        const position = convertWowVec3(def.position);
        const rotation = convertWowVec3(def.rotation);
        const aabb = convertWowAABB(def.extents);
        const fileId = def.name_id;
        const uniqueId = def.unique_id;
        const doodadSet = def.doodad_set;
        def.free();
        return new WmoDefinition(
            fileId,
            wmo,
            uniqueId,
            doodadSet,
            scale,
            position,
            rotation,
            aabb,
        );
    }

    // `extents` should be in placement space
    constructor(
        public wmoId: number,
        public wmo: WmoData,
        public uniqueId: number,
        public doodadSet: number,
        scale: number,
        position: ReadonlyVec3,
        rotation: ReadonlyVec3,
        extents: AABB,
    ) {
        computeModelMatrixSRT(this.placementMatrix,
            scale, scale, scale,
            rotation[0] * MathConstants.DEG_TO_RAD,
            rotation[1] * MathConstants.DEG_TO_RAD,
            rotation[2] * MathConstants.DEG_TO_RAD,
            position[0], position[1], position[2]);

        mat4.mul(this.modelMatrix, this.placementMatrix, placementSpaceFromModelSpace);
        mat4.mul(this.modelMatrix, adtSpaceFromPlacementSpace, this.modelMatrix);

        mat4.invert(this.invModelMatrix, this.modelMatrix);
        mat4.invert(this.invPlacementMatrix, this.placementMatrix);
        mat4.mul(this.invPlacementMatrix, this.invPlacementMatrix, placementSpaceFromAdtSpace);

        mat4.mul(this.invPlacementMatrix, modelSpaceFromPlacementSpace, this.invPlacementMatrix);

        this.worldAABB.transform(extents, adtSpaceFromPlacementSpace);

        for (let i = 0; i < wmo.groupDescriptors.length; i++) {
            const group = wmo.groupDescriptors[i];
            const liquidIndices = wmo.groupLiquids.get(group.group_id);
            for (let i of liquidIndices) {
                this.groupIdToLiquidIndices.append(group.group_id, i);
            }
            this.groupAmbientColors.set(
                group.group_id,
                wmo.wmo.get_group_ambient_color(group.group_id, doodadSet),
            );
        }

        for (let liquid of wmo.liquids) {
            const aabb = new AABB();
            aabb.transform(liquid.worldSpaceAABB, this.modelMatrix);
            this.liquidAABBs.push(aabb);
        }

        // filter out doodads not present in the current doodadSet, and keep track
        // of which doodads belong in which group
        const doodadSetRefs = wmo.wmo.get_doodad_set_refs(this.doodadSet);
        for (let group of wmo.groupDescriptors) {
            for (let ref of wmo.wmo.get_doodad_refs(group.group_id)) {
                if (doodadSetRefs.includes(ref)) {
                    this.groupIdToDoodadIndices.append(group.group_id, ref);
                    this.doodadIndexToGroupIds.append(ref, group.group_id);
                }
            }
        }

        const doodads = wmo.wmo.get_doodad_defs();
        if (doodads) {
            for (const ref of doodadSetRefs) {
                const wmoDoodad = doodads[ref];
                if (wmoDoodad.name_index === -1) {
                    console.warn("skipping WMO doodad w/ name_index === -1");
                    continue;
                }
                const doodad = DoodadData.fromWmoDoodad(
                    wmoDoodad,
                    wmo.modelIds,
                    this.modelMatrix,
                );
                const modelData = wmo.models.get(doodad.modelId)!;
                doodad.setBoundingBoxFromModel(modelData);
                const p = this.scratchVec3;
                doodad.worldAABB.centerPoint(p);
                vec3.transformMat4(p, p, this.invModelMatrix);

                // for some reason, the same doodad can exist in multiple groups. if
                // that's the case, select the closest group (by AABB centerpoint) for
                // lighting purposes
                const groupIds = this.doodadIndexToGroupIds.get(ref)!;
                let group: WowWmoGroupDescriptor;
                if (groupIds.length > 1) {
                    let closestGroupId;
                    let closestDist = Infinity;
                    for (let i = 0; i < groupIds.length; i++) {
                        const groupId = groupIds[i];
                        const groupAABB = this.wmo.groupDefAABBs.get(groupId)!;
                        const groupDist = groupAABB.distanceVec3(p);
                        if (groupDist < closestDist) {
                            closestDist = groupDist;
                            closestGroupId = groupId;
                        }
                    }
                    group = wmo.getGroup(closestGroupId!)!;
                } else {
                    group = wmo.getGroup(groupIds[0])!;
                }

                let bspAmbientColor = wmo.wmo.get_vertex_color_for_modelspace_point(group.group_id, p as Float32Array);

                if (group.interior && !group.exterior_lit) {
                    const groupAmbientColor = this.groupAmbientColors.get(
                        group.group_id,
                    )!;
                    if (bspAmbientColor) {
                        vec4.scaleAndAdd(
                            doodad.ambientColor,
                            groupAmbientColor,
                            bspAmbientColor,
                            2.0,
                        );
                        const maxComponent = Math.max(
                            doodad.ambientColor[0],
                            doodad.ambientColor[1],
                            doodad.ambientColor[2],
                        );
                        // scale the color down to a range of 0-96
                        const limit = 96 / 255;
                        if (maxComponent > limit) {
                            vec4.scale(
                                doodad.ambientColor,
                                doodad.ambientColor,
                                limit / maxComponent,
                            );
                        }
                    } else {
                        vec4.copy(doodad.ambientColor, groupAmbientColor);
                    }
                    doodad.applyInteriorLighting = true;
                    doodad.applyExteriorLighting = false;
                } else {
                    doodad.applyInteriorLighting = false;
                    doodad.applyExteriorLighting = true;
                }

                this.doodadIndexToDoodad.set(ref, doodad);
            }
        }
    }
}

export class AdtLodData {
    public modelIds: number[] = [];
    public models = new Map<number, ModelData>();
    public wmoDefs: WmoDefinition[] = [];
    public wmos = new Map<number, WmoData>();
    public doodads: DoodadData[] = [];

    private loadDoodads(cache: WowCache, data: WowAdt, lodLevel: number): Promise<unknown> {
        return Promise.all(
            data.get_doodads(lodLevel).map(async (adtDoodad) => {
                const doodad = DoodadData.fromAdtDoodad(adtDoodad);
                const modelData = await cache.loadModel(doodad.modelId);
                doodad.setBoundingBoxFromModel(modelData);
                doodad.applyExteriorLighting = true;
                this.doodads.push(doodad);
            }),
        );
    }

    private loadModels(cache: WowCache, data: WowAdt, lodLevel: number): Promise<unknown> {
        return Promise.all(
            Array.from(data.get_model_file_ids(lodLevel)).map(
                async (modelId) => {
                    this.models.set(modelId, await cache.loadModel(modelId));
                    this.modelIds.push(modelId);
                },
            ),
        );
    }

    private loadWMOs(cache: WowCache, data: WowAdt, lodLevel: number): Promise<unknown> {
        return Promise.all(
            data.get_wmo_defs(lodLevel).map(async (wmoDef) => {
                const wmo = await cache.loadWmo(wmoDef.name_id);
                this.wmos.set(wmoDef.name_id, wmo);
                this.wmoDefs.push(
                    cache.getWmoDefinition(wmoDef, wmo, lodLevel),
                );
            }),
        );
    }

    public async load(cache: WowCache, data: WowAdt, lodLevel: number): Promise<unknown> {
        return Promise.all([
            this.loadDoodads(cache, data, lodLevel),
            this.loadModels(cache, data, lodLevel),
            this.loadWMOs(cache, data, lodLevel),
        ]);
    }
}

export class LiquidInstance {
    public visible: boolean = true;

    constructor(
        public vertices: Float32Array,
        public indices: Uint16Array,
        public indexCount: number,
        public liquidType: number,
        public worldSpaceAABB: AABB,
    ) {
    }

    static fromAdtLiquid(liquid: WowAdtLiquidLayer): LiquidInstance {
        const vertices = liquid.take_vertices();
        const indices = liquid.take_indices();
        const indexCount = indices.length;
        const liquidType = liquid.get_liquid_type();
        const worldSpaceAABB = convertWowAABB(liquid.extents);
        return new LiquidInstance(
            vertices,
            indices,
            indexCount,
            liquidType,
            worldSpaceAABB,
        );
    }

    static fromWmoLiquid(liquid: WowWmoLiquidResult): LiquidInstance {
        const vertices = liquid.take_vertices();
        const indices = liquid.take_indices();
        const indexCount = indices.length;
        const liquidType = liquid.liquid_type;
        const worldSpaceAABB = convertWowAABB(liquid.extents);
        return new LiquidInstance(
            vertices,
            indices,
            indexCount,
            liquidType,
            worldSpaceAABB,
        );
    }

    public takeVertices(device: GfxDevice): GfxVertexBufferDescriptor {
        return {
            buffer: makeStaticDataBuffer(
                device,
                GfxBufferUsage.Vertex,
                this.vertices!.buffer,
            ),
            byteOffset: 0,
        };
    }

    public takeIndices(device: GfxDevice): GfxIndexBufferDescriptor {
        return {
            buffer: makeStaticDataBuffer(
                device,
                GfxBufferUsage.Index,
                this.indices!.buffer,
            ),
            byteOffset: 0,
        };
    }
}

export class AdtData {
    public blps: Map<number, BlpData> = new Map();
    public models: Map<number, ModelData> = new Map();
    public wmos: Map<number, WmoData> = new Map();
    public worldSpaceAABB: AABB = new AABB();
    public hasBigAlpha: boolean;
    public hasHeightTexturing: boolean;
    public lodLevel: number;
    public lodData: AdtLodData[] = [];
    public visible = true;
    public chunkData: ChunkData[] = [];
    public liquids: LiquidInstance[] = [];
    public liquidTypes: Map<number, LiquidType> = new Map();
    public insideWmoCandidates: WmoDefinition[] = [];
    public visibleWmoCandidates: WmoDefinition[] = [];
    private vertexBuffer: Float32Array;
    private indexBuffer: Uint16Array;
    private inner: WowAdt | null = null;

    constructor(public fileId: number, adt: WowAdt, public lightdbMapId: number) {
        this.inner = adt;
    }

    public setLodLevel(lodLevel: number) {
        assert(lodLevel === 0 || lodLevel === 1, "lodLevel must be 0 or 1");
        if (this.lodLevel === lodLevel)
            return;
        this.lodLevel = lodLevel;
    }

    private async loadTextures(cache: WowCache): Promise<unknown> {
        const textureIds = Array.from(this.inner!.get_texture_file_ids());
        return Promise.all(
            textureIds.map(async (fileId) => {
                try {
                    this.blps.set(
                        fileId,
                        new BlpData(fileId, await cache.loadBlp(fileId)),
                    );
                } catch (e) {
                    console.error(`failed to load BLP ${e}`);
                }
            }),
        );
    }

    private async loadLODs(cache: WowCache): Promise<unknown> {
        return Promise.all(
            this.lodData.map(async (lodData, i) => {
                return lodData.load(cache, this.inner!, i);
            }),
        );
    }

    public async load(cache: WowCache) {
        this.lodData.push(new AdtLodData()); // LOD Level 0
        this.lodData.push(new AdtLodData()); // LOD Level 1

        await Promise.all([this.loadTextures(cache), this.loadLODs(cache)]);
        this.setLodLevel(0);

        for (const lodData of this.lodData) {
            for (const [k, v] of lodData.wmos)
                this.wmos.set(k, v);
            for (const [k, v] of lodData.models)
                this.models.set(k, v);
        }

        const renderResult = this.inner!.get_render_result(
            this.hasBigAlpha,
            this.hasHeightTexturing,
        );

        this.worldSpaceAABB.copy(convertWowAABB(renderResult.extents));
        this.vertexBuffer = renderResult.take_vertex_buffer();
        this.indexBuffer = renderResult.take_index_buffer();
        let i = 0;
        const worldSpaceChunkWidth = 100 / 3;
        for (let chunk of renderResult.chunks) {
            const x = 15 - Math.floor(i / 16);
            const y = 15 - (i % 16);
            const chunkWorldSpaceAABB = new AABB();
            chunkWorldSpaceAABB.min[0] = this.worldSpaceAABB.min[0] + x * worldSpaceChunkWidth;
            chunkWorldSpaceAABB.min[1] = this.worldSpaceAABB.min[1] + y * worldSpaceChunkWidth;
            chunkWorldSpaceAABB.min[2] = this.worldSpaceAABB.min[2];

            chunkWorldSpaceAABB.max[0] = this.worldSpaceAABB.min[0] + (x + 1) * worldSpaceChunkWidth;
            chunkWorldSpaceAABB.max[1] = this.worldSpaceAABB.min[1] + (y + 1) * worldSpaceChunkWidth;
            chunkWorldSpaceAABB.max[2] = this.worldSpaceAABB.max[2];
            const textures = [];
            for (let blpId of chunk.texture_layers) {
                textures.push(this.blps.get(blpId)!);
            }

            this.chunkData.push(new ChunkData(chunk, textures, chunkWorldSpaceAABB));
            const liquidLayers = this.inner!.take_chunk_liquid_data(i);
            if (liquidLayers !== undefined) {
                for (let layer of liquidLayers) {
                    const instanceData = LiquidInstance.fromAdtLiquid(layer);
                    if (instanceData.liquidType === 100) {
                        console.warn(`basic procedural water detected!!!!`);
                    }
                    if (!this.liquidTypes.has(instanceData.liquidType)) {
                        this.liquidTypes.set(
                            instanceData.liquidType,
                            await cache.loadLiquidType(instanceData.liquidType),
                        );
                    }
                    this.liquids.push(instanceData);
                }
            }
            i += 1;
        }
        renderResult.free();

        this.inner!.free();
        this.inner = null;
    }

    public lodDoodads(): DoodadData[] {
        return this.lodData[this.lodLevel].doodads;
    }

    public lodWmoDefs(): WmoDefinition[] {
        return this.lodData[this.lodLevel].wmoDefs;
    }

    public getBufsAndChunks(device: GfxDevice): [GfxVertexBufferDescriptor, GfxIndexBufferDescriptor] {
        const vertexBuffer = {
            buffer: makeStaticDataBuffer(
                device,
                GfxBufferUsage.Vertex,
                this.vertexBuffer.buffer,
            ),
            byteOffset: 0,
        };
        const indexBuffer = {
            buffer: makeStaticDataBuffer(
                device,
                GfxBufferUsage.Index,
                this.indexBuffer.buffer,
            ),
            byteOffset: 0,
        };
        return [vertexBuffer, indexBuffer];
    }

    public setupWmoCandidates(worldCamera: vec3, worldFrustum: Frustum) {
        this.insideWmoCandidates = [];
        this.visibleWmoCandidates = [];
        for (let def of this.lodWmoDefs()) {
            if (def.worldAABB.containsPoint(worldCamera)) {
                this.insideWmoCandidates.push(def);
            } else if (worldFrustum.contains(def.worldAABB)) {
                this.visibleWmoCandidates.push(def);
            }
        }
    }
}

export class ChunkData {
    public alphaTexture: Uint8Array | undefined;
    public shadowTexture: Uint8Array | undefined;
    public indexCount: number;
    public indexOffset: number;
    public visible = true;

    constructor(
        chunk: WowAdtChunkDescriptor,
        public textures: BlpData[],
        public worldSpaceAABB: AABB,
    ) {
        this.alphaTexture = chunk.alpha_texture;
        this.shadowTexture = chunk.shadow_texture;
        this.indexCount = chunk.index_count;
        this.indexOffset = chunk.index_offset;
        chunk.free();
    }
}

export class DoodadData {
    public visible = true;
    public worldAABB = new AABB();
    public ambientColor = vec4.create();
    public applyInteriorLighting = false;
    public applyExteriorLighting = false;
    public isSkybox = false;
    public skyboxBlend = 0;

    constructor(public modelId: number, public modelMatrix: mat4, public color: vec4 | null, public uniqueId: number | undefined = undefined) {
    }

    // Make a fake doodad for skyboxes
    public static skyboxDoodad(): DoodadData {
        let modelMatrix = mat4.identity(mat4.create());
        let doodad = new DoodadData(666, modelMatrix, null);
        doodad.isSkybox = true;
        return doodad;
    }

    public static fromAdtDoodad(doodad: WowDoodad): DoodadData {
        const doodadPos = doodad.position;
        let position: vec3 = [doodadPos.x, doodadPos.y, doodadPos.z];
        doodadPos.free();
        const doodadRot = doodad.rotation;
        let rotation: vec3 = [doodadRot.x, doodadRot.y, doodadRot.z];
        doodadRot.free();
        let scale = doodad.scale / 1024;
        const doodadMat = mat4.create();
        setMatrixTranslation(doodadMat, position);
        mat4.scale(doodadMat, doodadMat, [scale, scale, scale]);
        mat4.rotateY(
            doodadMat,
            doodadMat,
            MathConstants.DEG_TO_RAD * rotation[1],
        );
        mat4.rotateX(
            doodadMat,
            doodadMat,
            MathConstants.DEG_TO_RAD * rotation[0],
        );
        mat4.rotateZ(
            doodadMat,
            doodadMat,
            MathConstants.DEG_TO_RAD * rotation[2],
        );
        mat4.mul(doodadMat, doodadMat, placementSpaceFromModelSpace);
        mat4.mul(doodadMat, adtSpaceFromPlacementSpace, doodadMat);
        const fileId = doodad.name_id;
        const uniqueId = doodad.unique_id;
        doodad.free();
        return new DoodadData(fileId, doodadMat, null, uniqueId);
    }

    static fromWmoDoodad(
        doodad: WowDoodadDef,
        modelIds: Uint32Array,
        wmoDefModelMatrix: mat4,
    ): DoodadData {
        const doodadPos = doodad.position;
        const position = vec3.fromValues(doodadPos.x, doodadPos.y, doodadPos.z);
        doodadPos.free();
        const doodadRot = doodad.orientation;
        const rotation = quat.fromValues(doodadRot.x, doodadRot.y, doodadRot.z, doodadRot.w);
        doodadRot.free();
        const scale = doodad.scale;
        const modelId = modelIds[doodad.name_index];
        if (modelId === undefined) {
            throw new Error(`WMO doodad with invalid name_index ${doodad.name_index} (only ${modelIds.length} models)`);
        }
        const doodadMat = mat4.create();
        setMatrixTranslation(doodadMat, position);
        const rotMat = mat4.fromQuat(mat4.create(), rotation);
        mat4.mul(doodadMat, doodadMat, rotMat);
        scaleMatrix(doodadMat, doodadMat, scale);
        mat4.mul(doodadMat, wmoDefModelMatrix, doodadMat);

        const doodadColor = doodad.color;
        let color = vec4.fromValues(
            doodadColor.r,
            doodadColor.g,
            doodadColor.b,
            doodadColor.a,
        );
        vec4.scale(color, color, 1 / 255);
        doodadColor.free();

        doodad.free();
        return new DoodadData(modelId, doodadMat, color);
    }

    public setBoundingBoxFromModel(model: ModelData) {
        this.worldAABB.transform(model.modelAABB, this.modelMatrix);
    }
}

let _SKYBOX_DOODAD: DoodadData | undefined = undefined;
export function getSkyboxDoodad() {
    if (_SKYBOX_DOODAD === undefined) {
        _SKYBOX_DOODAD = DoodadData.skyboxDoodad();
    }
    return _SKYBOX_DOODAD;
}

async function fetchAdt(
    cache: WowCache,
    fileIDs: WowMapFileDataIDsLike,
    lightdbMapId: number,
): Promise<AdtData> {
    const [rootFile, obj0File, obj1File, texFile] = await Promise.all([
        cache.fetchDataByFileID(fileIDs.root_adt),
        cache.fetchDataByFileID(fileIDs.obj0_adt),
        fileIDs.obj1_adt !== 0
            ? cache.fetchDataByFileID(fileIDs.obj1_adt)
            : Promise.resolve(null!),
        cache.fetchDataByFileID(fileIDs.tex0_adt),
    ]);

    const wowAdt = rust.WowAdt.new(rootFile);
    wowAdt.append_obj_adt(obj0File);
    if (obj1File !== null) wowAdt.append_lod_obj_adt(obj1File);
    wowAdt.append_tex_adt(texFile);

    return new AdtData(fileIDs.root_adt, wowAdt, lightdbMapId);
}

export type AdtCoord = [number, number];

export class LazyWorldData {
    public adts: AdtData[] = [];
    public skyboxes: SkyboxData[] = [];
    private loadedAdtCoords: AdtCoord[] = [];
    public globalWmo: WmoData | null = null;
    public globalWmoDef: WmoDefinition | null = null;
    public hasBigAlpha: boolean;
    public hasHeightTexturing: boolean;
    public adtFileIds: WowMapFileDataIDs[] = [];
    public initialAdtRadius = 1; // how many ADTs to load around the start point before showing the scene
    public adtRadius = 2; // how many ADTs to stream around the user as they fly around
    public loading = false;

    constructor(
        public fileId: number,
        public startAdtCoords: AdtCoord,
        public cache: WowCache,
        public lightdbMapId: number,
    ) {}

    public async load() {
        const wdt = await this.cache.fetchFileByID(
            this.fileId,
            rust.WowWdt.new,
        );
        this.adtFileIds = wdt.get_all_map_data();
        const [centerX, centerY] = this.startAdtCoords;

        const promises = [];
        for (
            let x = centerX - this.initialAdtRadius;
            x <= centerX + this.initialAdtRadius;
            x++
        ) {
            for (
                let y = centerY - this.initialAdtRadius;
                y <= centerY + this.initialAdtRadius;
                y++
            ) {
                promises.push(
                    this.ensureAdtLoaded(x, y).then((adt) => {
                        if (adt !== undefined) this.adts.push(adt);
                    }),
                );
            }
        }
        promises.push(
            loadSkyboxes(this.cache, this.lightdbMapId).then(
                (skyboxes) => (this.skyboxes = skyboxes),
            ),
        );
        await Promise.all(promises);

        this.hasBigAlpha = wdt.adt_has_big_alpha();
        this.hasHeightTexturing = wdt.adt_has_height_texturing();
        wdt.free();
    }

    public onEnterAdt(
        [centerX, centerY]: AdtCoord,
        callback: (coord: AdtCoord, adt: AdtData | undefined) => void,
    ): AdtCoord[] {
        if (this.loading) {
            return [];
        }
        let adtCoords: AdtCoord[] = [];
        console.log(`loading area around ${centerX}, ${centerY}`);
        for (
            let x = centerX - this.adtRadius;
            x <= centerX + this.adtRadius;
            x++
        ) {
            for (
                let y = centerY - this.adtRadius;
                y <= centerY + this.adtRadius;
                y++
            ) {
                if (!this.hasLoadedAdt([x, y])) {
                    adtCoords.push([x, y]);
                }
            }
        }
        setTimeout(async () => {
            this.loading = true;
            for (let [x, y] of adtCoords) {
                let maybeAdt: AdtData | undefined;
                try {
                    maybeAdt = await this.ensureAdtLoaded(x, y);
                    if (maybeAdt) {
                        this.adts.push(maybeAdt);
                    }
                } catch (e) {
                    console.log("failed to load ADT: ", e);
                }
                callback([x, y], maybeAdt);
            }
            this.loading = false;
        }, 0);
        return adtCoords;
    }

    public hasLoadedAdt(coord: AdtCoord): boolean {
        for (let [x, y] of this.loadedAdtCoords) {
            if (x === coord[0] && y === coord[1]) {
                return true;
            }
        }
        return false;
    }

    public async ensureAdtLoaded(
        x: number,
        y: number,
    ): Promise<AdtData | undefined> {
        if (this.hasLoadedAdt([x, y])) {
            return undefined;
        }
        let fileIDs: WowMapFileDataIDsLike | undefined;
        // hardcode GM Island's ADT on Kalimdor
        if (this.fileId === 782779 && x === 1 && y === 1) {
            fileIDs = {
                root_adt: 782825,
                obj0_adt: 782826,
                obj1_adt: 782827,
                tex0_adt: 782828,
            };
        } else {
            fileIDs = this.adtFileIds[y * 64 + x];
        }
        if (fileIDs === undefined) {
            return undefined;
        }
        console.log(`loading coords ${x}, ${y}`);
        if (fileIDs.root_adt === 0) {
            console.error(`null ADTs in a non-global-WMO WDT`);
            return undefined;
        }

        const adt = await fetchAdt(this.cache, fileIDs, this.lightdbMapId);
        adt.hasBigAlpha = this.hasBigAlpha;
        adt.hasHeightTexturing = this.hasHeightTexturing;
        await adt.load(this.cache);
        this.loadedAdtCoords.push([x, y]);
        return adt;
    }

    public getAdtCoords(fileId: number): AdtCoord | undefined {
        for (let i = 0; i < this.adtFileIds.length; i++) {
            if (this.adtFileIds[i].root_adt === fileId) {
                const x = i % 64;
                const y = Math.floor(i / 64);
                return [x, y];
            }
        }
        return undefined;
    }
}

interface WowMapFileDataIDsLike {
    root_adt: number;
    obj0_adt: number;
    obj1_adt: number;
    tex0_adt: number;
}

export class WorldData {
    public adts: AdtData[] = [];
    public skyboxes: SkyboxData[] = [];
    public globalWmo: WmoData | null = null;
    public globalWmoDef: WmoDefinition | null = null;

    constructor(
        public fileId: number,
        public cache: WowCache,
        public lightdbMapId: number,
    ) {}

    public async load(cache: WowCache) {
        const wdt = await cache.fetchFileByID(this.fileId, rust.WowWdt.new);
        const hasBigAlpha = wdt.adt_has_big_alpha();
        const hasHeightTexturing = wdt.adt_has_height_texturing();
        if (wdt.wdt_uses_global_map_obj()) {
            const def = wdt.global_wmo!;
            this.globalWmo = await cache.loadWmo(def.name_id);
            this.globalWmoDef = WmoDefinition.fromGlobalDefinition(
                def,
                this.globalWmo,
            );
        } else {
            const adtFileIDs = wdt.get_loaded_map_data();
            for (let fileIDs of adtFileIDs) {
                if (fileIDs.root_adt === 0) {
                    continue;
                }

                const adt = await fetchAdt(cache, fileIDs, this.lightdbMapId);
                adt.hasBigAlpha = hasBigAlpha;
                adt.hasHeightTexturing = hasHeightTexturing;
                await adt.load(cache);
                this.adts.push(adt);
            }
        }
        this.skyboxes = await loadSkyboxes(this.cache, this.lightdbMapId);
        wdt.free();
    }
}

async function loadSkyboxes(
    cache: WowCache,
    lightdbMapId: number,
): Promise<SkyboxData[]> {
    const promises = [];
    for (const metadata of cache.db.getAllSkyboxes(lightdbMapId)) {
        const skybox = new SkyboxData(metadata.name, metadata.flags);
        promises.push(skybox.load(cache).then(() => skybox));
        metadata.free();
    }
    return Promise.all(promises);
}
