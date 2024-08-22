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
import type {
    ConvexHull,
    WowAABBox,
    WowAdt,
    WowAdtChunkDescriptor,
    WowAdtLiquidLayer,
    WowAdtWmoDefinition,
    WowBgra,
    WowBlp,
    WowBspTree,
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
    WowWmoBspNode,
    WowWmoGroup,
    WowWmoGroupFlags,
    WowWmoGroupInfo,
    WowWmoHeaderFlags,
    WowWmoLiquidResult,
    WowWmoMaterial,
    WowWmoMaterialBatch,
    WowWmoMaterialFlags,
    WowWmoMaterialPixelShader,
    WowWmoMaterialVertexShader,
    WowWmoPortalData,
    WowWmoPortalRef,
} from "../../rust/pkg/index.js";
import { DataFetcher } from "../DataFetcher.js";
import { AABB, Frustum, Plane } from "../Geometry.js";
import {
    MathConstants,
    randomRange,
    saturate,
    setMatrixTranslation,
    transformVec3Mat4w0,
} from "../MathHelpers.js";
import { getDerivativeBezier, getPointBezier } from "../Spline.js";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers.js";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers.js";
import {
    fillMatrix4x4,
    fillVec3v,
    fillVec4,
    fillVec4v,
} from "../gfx/helpers/UniformBufferHelpers.js";
import {
    GfxBlendFactor,
    GfxBlendMode,
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
    GfxTextureDimension,
    GfxTextureUsage,
    GfxVertexAttributeDescriptor,
    GfxVertexBufferDescriptor,
    GfxVertexBufferFrequency,
} from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import {
    GfxRenderInst,
    GfxRendererLayer,
    makeSortKey,
} from "../gfx/render/GfxRenderInstManager.js";
import { rust } from "../rustlib.js";
import { assert } from "../util.js";
import { ModelProgram, WmoProgram } from "./program.js";
import {
    MapArray,
    View,
    adtSpaceFromPlacementSpace,
    modelSpaceFromPlacementSpace,
    noclipSpaceFromAdtSpace,
    placementSpaceFromAdtSpace,
    placementSpaceFromModelSpace,
} from "./scenes.js";
import { Sheepfile } from "./util.js";
import { drawDebugFrustum, drawDebugPortal } from "./debug.js";
import { Cyan, Green, Red } from "../Color.js";

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
    private promiseCache = new Map<number, Promise<unknown>>();
    private promiseCacheLiquidTypes = new Map<number, Promise<LiquidType>>(); // liquid types aren't fileIDs
    private wmoDefinitionCache = new Map<string, WmoDefinition>(); // keys are WmoDefinitionKey.toString()

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

    public async loadWmoGroup(fileId: number): Promise<WmoGroupData> {
        return this.getOrLoad(fileId, async (fileId: number) => {
            const d = new WmoGroupData(fileId);
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

    public destroy(): void {
        this.sheepfile.destroy();
        this.clear();
    }
}

export enum ProceduralTexture {
    River = 0,
    Ocean = 0,
    Wmo = 0,
}

export enum LiquidCategory {
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

    constructor(
        cache: WowCache,
        public type: number,
        liquid: WowLiquidResult,
    ) {
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

    constructor(
        public filename: string,
        public flags: number,
    ) {
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

class Particle {
    public age = 0;
    public alive = true;
    public color = vec4.create();
    public scale = vec2.create();
    public texCoordHead = vec2.create();
    public texCoordTail = vec2.create();

    static createSpline(emitter: ParticleEmitter, dt: number): Particle {
        let t = saturate(emitter.emissionAreaLength);

        assert(emitter.spline !== undefined);

        let position: vec3;
        if (t > 0) {
            if (t < 1) {
                position = emitter.spline.calculateParametricSpline(
                    vec3.create(),
                    t,
                );
            } else {
                position =
                    emitter.spline.points[emitter.spline.points.length - 1];
            }
        } else {
            position = emitter.spline.points[0];
        }

        let velocity: vec3;
        if (emitter.zSource > 0.001) {
            const dz = position[2] - emitter.zSource;
            velocity = vec3.clone(position);
            velocity[2] = dz;
            vec3.normalize(velocity, velocity);
            vec3.scale(velocity, velocity, emitter.getEmissionSpeed());
        } else if (emitter.verticalRange !== 0.0) {
            // this is insane. treat the spline's derivative at t as a rotation vector, and the
            // emitter's verticalRange parameter as a rotation (in degrees). then, set the velocity
            // to the resulting rotation along just the Z axis. i guess.
            const rotAxis = emitter.spline.calculateParametricSplineDerivative(
                vec3.create(),
                t,
            );
            vec3.normalize(rotAxis, rotAxis);
            const rotRadians = emitter.verticalRange * MathConstants.DEG_TO_RAD;
            const rotQuat = quat.setAxisAngle(
                quat.create(),
                rotAxis,
                randomRange(-1, 1) * rotRadians,
            );
            const rotMat = mat3.fromQuat(mat3.create(), rotQuat);
            velocity = vec3.set(rotAxis, rotMat[6], rotMat[7], rotMat[8]);
            vec3.scale(velocity, velocity, emitter.getEmissionSpeed());
            if (emitter.horizontalRange !== 0.0) {
                const posOffset = randomRange(-1, 1) * emitter.horizontalRange;
                position[0] += posOffset;
                position[1] += posOffset;
                position[2] += posOffset;
            }
        } else {
            velocity = vec3.fromValues(0, 0, emitter.getEmissionSpeed());
        }

        return new Particle(position, velocity, emitter.getLifespan());
    }

    static createSpherical(emitter: ParticleEmitter, dt: number): Particle {
        const emissionArea =
            emitter.emissionAreaWidth - emitter.emissionAreaLength;
        const radius =
            emitter.emissionAreaLength + Math.random() * emissionArea;
        const polar = randomRange(-1, 1) * emitter.verticalRange;
        const azimuth = randomRange(-1, 1) * emitter.horizontalRange;
        const cosPolar = Math.cos(polar);
        const emissionDir = vec3.fromValues(
            cosPolar * Math.cos(azimuth),
            cosPolar * Math.sin(azimuth),
            Math.sin(polar),
        );
        const position = vec3.scale(emissionDir, emissionDir, radius);

        let velocity: vec3;
        if (emitter.zSource < 0.001) {
            const particlesGoUp = (emitter.emitter.flags & 0x100) > 0;
            if (particlesGoUp) {
                velocity = vec3.fromValues(0, 0, 1);
            } else {
                velocity = vec3.fromValues(
                    cosPolar * Math.cos(azimuth),
                    cosPolar * Math.sin(azimuth),
                    Math.sin(polar),
                );
            }
        } else {
            velocity = vec3.fromValues(0, 0, emitter.zSource);
            vec3.sub(velocity, position, velocity);
            if (vec3.len(velocity) > 0.0001) {
                vec3.normalize(velocity, velocity);
            }
        }
        vec3.scale(velocity, velocity, emitter.getEmissionSpeed());

        return new Particle(position, velocity, emitter.getLifespan());
    }

    static createPlanar(emitter: ParticleEmitter, dt: number): Particle {
        const position = vec3.fromValues(
            randomRange(-1, 1) * emitter.emissionAreaLength * 0.5,
            randomRange(-1, 1) * emitter.emissionAreaWidth * 0.5,
            0,
        );
        let velocity: vec3;
        if (emitter.zSource < 0.001) {
            const polar = emitter.verticalRange * randomRange(-1, 1);
            const azimuth = emitter.horizontalRange * randomRange(-1, 1);
            const sinPolar = Math.sin(polar);
            const sinAzimuth = Math.sin(azimuth);
            const cosPolar = Math.cos(polar);
            const cosAzimuth = Math.cos(azimuth);
            velocity = vec3.fromValues(
                cosAzimuth * sinPolar,
                sinAzimuth * sinPolar,
                cosPolar,
            );
            vec3.scale(velocity, velocity, emitter.getEmissionSpeed());
        } else {
            velocity = vec3.fromValues(0, 0, emitter.zSource);
            vec3.sub(velocity, position, velocity);
            if (vec3.len(velocity) > 0.0001) {
                vec3.normalize(velocity, velocity);
                vec3.scale(velocity, velocity, emitter.getEmissionSpeed());
            }
        }

        return new Particle(position, velocity, emitter.getLifespan());
    }

    constructor(
        public position: vec3,
        public velocity: vec3,
        public lifespan: number,
    ) {}
}

const PARTICLE_COORDINATE_FIX: mat4 = mat4.fromValues(
    0.0,
    1.0,
    0.0,
    0.0,
    -1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
);

class BezierSpline {
    public segmentLengths: number[];
    public totalLength: number;

    constructor(public points: vec3[]) {
        this.calculateSplineArcLengths();
    }

    public calculateParametricSpline(out: vec3, t: number): vec3 {
        assert(t >= 0 && t <= 1);
        const [segment, segmentT] = this.findParametricSegment(t);
        this.evaluateSegment(out, segment, segmentT);
        return out;
    }

    public calculateParametricSplineDerivative(out: vec3, t: number): vec3 {
        assert(t >= 0 && t <= 1);
        const [segment, segmentT] = this.findParametricSegment(t);
        this.evaluateDerivative(out, segment, segmentT);
        return out;
    }

    private findParametricSegment(t: number): [number, number] {
        const targetLength = t * this.totalLength;
        let length = 0;
        const numSegments = (this.points.length - 1) / 3;
        for (let segment = 0; segment < numSegments; segment++) {
            const segmentLength = this.segmentLengths[segment];
            if (length + segmentLength < targetLength) {
                length += segmentLength;
            } else {
                const segmentT = (targetLength - length) / segmentLength;
                return [segment, segmentT];
            }
        }
        throw new Error(`failed to find spline segment for parametric t=${t}`);
    }

    private evaluateSegment(out: vec3, segment: number, t: number) {
        const p0 = this.points[segment * 3 + 0];
        const p1 = this.points[segment * 3 + 1];
        const p2 = this.points[segment * 3 + 2];
        const p3 = this.points[segment * 3 + 3];
        out[0] = getPointBezier(p0[0], p1[0], p2[0], p3[0], t);
        out[1] = getPointBezier(p0[1], p1[1], p2[1], p3[1], t);
        out[2] = getPointBezier(p0[2], p1[2], p2[2], p3[2], t);
    }

    private evaluateDerivative(out: vec3, segment: number, t: number) {
        const p0 = this.points[segment * 3 + 0];
        const p1 = this.points[segment * 3 + 1];
        const p2 = this.points[segment * 3 + 2];
        const p3 = this.points[segment * 3 + 3];
        out[0] = getDerivativeBezier(p0[0], p1[0], p2[0], p3[0], t);
        out[1] = getDerivativeBezier(p0[1], p1[1], p2[1], p3[1], t);
        out[2] = getDerivativeBezier(p0[2], p1[2], p2[2], p3[2], t);
    }

    private calculateSplineArcLengths() {
        this.segmentLengths = [];
        this.totalLength = 0;
        const numSegments = (this.points.length - 1) / 3;
        const iterationsPerSegment = 20;
        const dt = 1 / iterationsPerSegment;
        const lastPos = vec3.create();
        const currPos = vec3.create();

        for (let segment = 0; segment < numSegments; segment++) {
            let length = 0;
            if (lastPos[0] === 0 && lastPos[1] === 0 && lastPos[2] === 0) {
                this.evaluateSegment(lastPos, segment, 0);
            }

            let t = dt;
            for (
                let iteration = 0;
                iteration < iterationsPerSegment;
                iteration++
            ) {
                this.evaluateSegment(currPos, segment, t);
                length += vec3.dist(currPos, lastPos);
                vec3.copy(lastPos, currPos);
                t += dt;
            }
            this.segmentLengths.push(length);
            this.totalLength += length;
        }
    }
}

export class ParticleEmitter {
    static MAX_PARTICLES = 2000;
    static TEXELS_PER_PARTICLE = 4; // pos, color, scale, texCoord
    public static MAX_LOD = 4;

    public enabled = 0;
    private emissionSpeed = 0;
    private speedVariation = 0;
    public verticalRange = 0;
    public horizontalRange = 0;
    public gravity = vec3.create();
    private lifespan = 0;
    private emissionRate = 0;
    public emissionAreaLength = 0;
    public emissionAreaWidth = 0;
    public zSource = 0;
    public particles: Particle[] = [];
    private baseSpin = 0;
    private spin = 0;
    public wind: vec3;
    public textures: (BlpData | null)[] = [];
    public texScaleX: number;
    public texScaleY: number;
    public alphaTest: number;
    public fragShaderType: number;
    public blendMode: WowM2BlendingMode;
    public position: vec3;
    public modelMatrix = mat4.create();
    private force = vec3.create();
    private updateBuffer: Float32Array;
    private particlesToEmit = 0.0;
    private dataTexture: GfxTexture | undefined;
    private textureColMask: number;
    private textureColBits: number;
    public particleType: number;
    public spline?: BezierSpline;
    public lod: number = ParticleEmitter.MAX_LOD;
    private msSinceLastUpdate = 0;
    private framesSinceLastUpdate = 0;
    public needsRedraw = true;
    private pixelData: Float32Array;

    constructor(
        public index: number,
        public emitter: WowM2ParticleEmitter,
        private model: ModelData,
        public txac: number,
    ) {
        this.updateBuffer = new Float32Array(16);
        this.wind = convertWowVec3(emitter.wind_vector);
        this.position = convertWowVec3(emitter.position);
        this.particleType = this.calculateParticleType();
        if (emitter.has_multiple_textures()) {
            this.textures.push(model.blps[emitter.texture_id & 0x1f]);
            this.textures.push(model.blps[(emitter.texture_id >> 5) & 0x1f]);
            this.textures.push(model.blps[(emitter.texture_id >> 10) & 0x1f]);
        } else {
            this.textures.push(model.blps[emitter.texture_id]);
            this.textures.push(null);
            this.textures.push(null);
        }
        const wowSplinePoints = this.emitter.take_spline_points();
        if (wowSplinePoints !== undefined) {
            const splinePoints = [];
            for (const point of wowSplinePoints) {
                splinePoints.push(convertWowVec3(point));
            }
            this.spline = new BezierSpline(splinePoints);
        }
        this.textureColBits = Math.ceil(
            Math.log2(emitter.texture_dimensions_cols),
        );
        this.textureColMask = (1 << this.textureColBits) - 1;
        this.texScaleX = 1.0 / emitter.texture_dimension_rows;
        this.texScaleY = 1.0 / emitter.texture_dimensions_cols;
        if (emitter.blending_type === 0) {
            this.alphaTest = -1;
        } else if (emitter.blending_type === 1) {
            this.alphaTest = 0.501960814;
        } else {
            this.alphaTest = 0.0039215689;
        }
        this.fragShaderType = this.calculateShaderType();
        this.blendMode = emitter.get_blend_mode();
        const bytesPerParticle = ParticleEmitter.TEXELS_PER_PARTICLE * 4;
        this.pixelData = new Float32Array(
            ParticleEmitter.MAX_PARTICLES * bytesPerParticle,
        );
    }

    private calculateParticleType(): number {
        if (!this.emitter.check_flag(0x10100000)) {
            return 0;
        } else {
            if (this.emitter.check_flag(0x1c)) {
                return 2;
            } else {
                return 3;
            }
        }
    }

    private calculateShaderType(): WowM2ParticleShaderType {
        // some awful undocumented flag stuff
        let material0x20 = false;
        let material0x01 = true;
        if (this.emitter.check_flag(0x10000000)) {
            material0x01 = false;
            material0x20 = this.emitter.check_flag(0x40000000);
        } else if (this.emitter.check_flag(0x100000)) {
            material0x01 = false;
        } else {
            material0x01 = !this.emitter.check_flag(0x1);
        }

        const multiTex = this.emitter.check_flag(0x10000000);
        if (
            this.particleType === 2 ||
            (this.particleType === 4 && multiTex && this.txac !== 0)
        ) {
            assert(material0x20);
            return rust.WowM2ParticleShaderType.ThreeColorTexThreeAlphaTexUV;
        } else if (
            this.particleType === 2 ||
            (this.particleType === 4 && multiTex)
        ) {
            if (material0x20) {
                return rust.WowM2ParticleShaderType.ThreeColorTexThreeAlphaTex;
            } else {
                return rust.WowM2ParticleShaderType.TwoColorTexThreeAlphaTex;
            }
        } else if (this.particleType === 3) {
            return rust.WowM2ParticleShaderType.Refraction;
        } else {
            return rust.WowM2ParticleShaderType.Mod;
        }
    }

    private updateParams(animationManager: WowM2AnimationManager) {
        animationManager.update_particle_emitter(this.index, this.updateBuffer);
        [
            this.enabled,
            this.emissionSpeed,
            this.speedVariation,
            this.verticalRange,
            this.horizontalRange,
            this.lifespan,
            this.emissionRate,
            this.emissionAreaLength,
            this.emissionAreaWidth,
            this.zSource,
        ] = this.updateBuffer;
        if (this.emitter.use_compressed_gravity()) {
            this.gravity[0] = this.updateBuffer[10];
            this.gravity[1] = this.updateBuffer[11];
            this.gravity[2] = this.updateBuffer[12];
        } else {
            this.gravity[0] = 0;
            this.gravity[1] = 0;
            this.gravity[2] = this.updateBuffer[10];
        }

        mat4.identity(this.modelMatrix);
        mat4.translate(this.modelMatrix, this.modelMatrix, this.position);
        const bone = this.model.boneData[this.emitter.bone];
        mat4.mul(this.modelMatrix, bone.transform, this.modelMatrix);
        mat4.mul(
            this.modelMatrix,
            bone.postBillboardTransform,
            this.modelMatrix,
        );
        mat4.mul(this.modelMatrix, this.modelMatrix, PARTICLE_COORDINATE_FIX);
    }

    public getEmissionRate(): number {
        return (
            this.emissionRate +
            randomRange(-1, 1) * this.emitter.emission_rate_variance
        );
    }

    public getEmissionSpeed(): number {
        return (
            this.emissionSpeed * (1 + randomRange(-1, 1) * this.speedVariation)
        );
    }

    public getLifespan(): number {
        return (
            this.lifespan + randomRange(-1, 1) * this.emitter.lifespan_variance
        );
    }

    public getBaseSpin(): number {
        return (
            this.emitter.base_spin +
            randomRange(-1, 1) * this.emitter.base_spin_variance
        );
    }

    public getSpin(): number {
        return (
            this.emitter.spin + randomRange(-1, 1) * this.emitter.spin_variance
        );
    }

    private createParticle(dt: number) {
        let particle: Particle;
        if (this.emitter.emitter_type === 1) {
            // Plane
            particle = Particle.createPlanar(this, dt);
        } else if (this.emitter.emitter_type === 2) {
            // Sphere
            particle = Particle.createSpherical(this, dt);
        } else if (this.emitter.emitter_type === 3) {
            // Spline
            particle = Particle.createSpline(this, dt);
        } else {
            throw new Error(
                `unknown particle emitter type ${this.emitter.emitter_type}`,
            );
        }

        if (!this.emitter.check_flag(0x10)) {
            vec3.transformMat4(
                particle.position,
                particle.position,
                this.modelMatrix,
            );
            transformVec3Mat4w0(
                particle.velocity,
                this.modelMatrix,
                particle.velocity,
            );
            if (this.emitter.check_flag(0x2000)) {
                particle.position[2] = 0;
            }
        }
        if (this.emitter.check_flag(0x40)) {
            // TODO: add random burst value to velocity
        }
        if (this.emitter.check_flag(0x10000000)) {
            // TODO: randomize particle texture stuff
        }
        this.particles.push(particle);
    }

    public setMegaStateFlags(renderInst: GfxRenderInst) {
        setM2BlendModeMegaState(
            renderInst,
            this.blendMode,
            GfxCullMode.None,
            this.emitter.blending_type <= 1,
            GfxCompareMode.Greater,
            makeSortKey(GfxRendererLayer.TRANSLUCENT + this.index),
        );
    }

    private ensureTexture(device: GfxDevice) {
        if (this.dataTexture === undefined) {
            this.dataTexture = device.createTexture({
                dimension: GfxTextureDimension.n2D,
                pixelFormat: GfxFormat.F32_RGBA,
                width: ParticleEmitter.TEXELS_PER_PARTICLE,
                height: ParticleEmitter.MAX_PARTICLES,
                numLevels: 1,
                depthOrArrayLayers: 1,
                usage: GfxTextureUsage.Sampled,
            });
        }
    }

    private maxLifespan(): number {
        return this.lifespan + this.emitter.lifespan_variance;
    }

    private shouldUpdate(): boolean {
        const lodFactor = 1 << (ParticleEmitter.MAX_LOD - this.lod);
        return this.framesSinceLastUpdate >= lodFactor;
    }

    public update(
        dtMilliseconds: number,
        animationManager: WowM2AnimationManager,
    ) {
        this.msSinceLastUpdate += dtMilliseconds;
        // the particle system's units are seconds
        const dtSeconds = this.msSinceLastUpdate / 1000;
        this.framesSinceLastUpdate += 1;

        if (!this.shouldUpdate()) {
            this.needsRedraw = false;
            return;
        } else {
            this.needsRedraw = true;
        }

        this.msSinceLastUpdate = 0;
        this.framesSinceLastUpdate = 0;
        this.updateParams(animationManager);

        if (this.enabled > 0.0) {
            this.particlesToEmit += this.getEmissionRate() * dtSeconds;
            while (this.particlesToEmit > 1.0) {
                if (this.particles.length < ParticleEmitter.MAX_PARTICLES) {
                    this.createParticle(dtSeconds);
                }
                this.particlesToEmit -= 1.0;
            }
        }

        vec3.copy(this.force, this.wind);
        vec3.sub(this.force, this.force, this.gravity);

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];
            particle.age += dtSeconds;
            if (particle.age > this.lifespan) {
                this.particles.splice(i, 1);
            } else {
                const agePercent = particle.age / this.maxLifespan();
                animationManager.update_particle(
                    this.index,
                    agePercent,
                    this.updateBuffer,
                );
                particle.color[0] = this.updateBuffer[0] / 255.0;
                particle.color[1] = this.updateBuffer[1] / 255.0;
                particle.color[2] = this.updateBuffer[2] / 255.0;
                particle.color[3] = this.updateBuffer[3];
                particle.scale[0] = this.updateBuffer[4];
                particle.scale[1] = this.updateBuffer[5];
                const cellHead = this.updateBuffer[6];
                this.extractTexCoords(particle.texCoordHead, cellHead);
                const cellTail = this.updateBuffer[7];
                this.extractTexCoords(particle.texCoordTail, cellTail);

                vec3.scaleAndAdd(
                    particle.velocity,
                    particle.velocity,
                    this.force,
                    dtSeconds,
                );
                if (this.emitter.drag > 0) {
                    vec3.scale(
                        particle.velocity,
                        particle.velocity,
                        (1.0 - this.emitter.drag) ** dtSeconds,
                    );
                }
                vec3.scaleAndAdd(
                    particle.position,
                    particle.position,
                    particle.velocity,
                    dtSeconds,
                );
            }
        }
    }

    public extractTexCoords(out: vec2, cell: number) {
        const xInt = cell & this.textureColMask;
        const yInt = cell >> this.textureColBits;
        vec2.set(out, xInt * this.texScaleX, yInt * this.texScaleY);
    }

    public updateDataTex(device: GfxDevice): GfxTexture {
        this.ensureTexture(device);
        const scratchVec3 = vec3.create();
        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];
            let offs = ParticleEmitter.TEXELS_PER_PARTICLE * i * 4;
            vec3.copy(scratchVec3, particle.position);
            if (this.emitter.translate_particle_with_bone()) {
                vec3.transformMat4(scratchVec3, scratchVec3, this.modelMatrix);
            }
            offs += fillVec3v(this.pixelData, offs, scratchVec3);
            offs += fillVec4v(this.pixelData, offs, particle.color);
            offs += fillVec4(
                this.pixelData,
                offs,
                particle.scale[0],
                particle.scale[1],
            );
            offs += fillVec4(
                this.pixelData,
                offs,
                particle.texCoordHead[0],
                particle.texCoordHead[1],
            );
        }
        device.uploadTextureData(this.dataTexture!, 0, [this.pixelData]);
        return this.dataTexture!;
    }
}

export class ModelData {
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
                let txac = m2.get_txac_value(i);
                if (txac === undefined) {
                    txac = 0;
                }
                return new ParticleEmitter(i, emitter, this, txac);
            });

        this.animationManager = m2.take_animation_manager();
        this.textureWeights = new Float32Array(
            this.animationManager.get_num_texture_weights(),
        );
        this.numTextureTransformations =
            this.animationManager.get_num_transformations();
        this.textureTranslations = new Float32Array(
            this.numTextureTransformations * 3,
        );
        this.textureRotations = new Float32Array(
            this.numTextureTransformations * 4,
        );
        this.textureScalings = new Float32Array(
            this.numTextureTransformations * 3,
        );
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
            const pivot = mat4.fromTranslation(mat4.create(), [
                bonePivot.x,
                bonePivot.y,
                bonePivot.z,
            ]);
            const antiPivot = mat4.fromTranslation(mat4.create(), [
                -bonePivot.x,
                -bonePivot.y,
                -bonePivot.z,
            ]);
            const bone = new BoneData(
                pivot,
                antiPivot,
                boneFlags[i],
                boneParents[i],
            );
            if (bone.parentBoneId >= 0) {
                bone.isSphericalBillboard ||=
                    this.boneData[bone.parentBoneId].isSphericalBillboard;
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
            mat4.fromRotationTranslationScaleOrigin(
                dst,
                rot,
                trans,
                scale,
                [0.5, 0.5, 0],
            );
        }

        const localBoneTransform = mat4.create();
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
                    mat4.mul(
                        bone.transform,
                        parentBone.transform,
                        bone.antiPivot,
                    );
                    mat4.mul(
                        bone.postBillboardTransform,
                        parentBone.postBillboardTransform,
                        localBoneTransform,
                    );
                } else {
                    mat4.mul(
                        localBoneTransform,
                        localBoneTransform,
                        bone.antiPivot,
                    );
                    mat4.mul(
                        bone.postBillboardTransform,
                        parentBone.postBillboardTransform,
                        localBoneTransform,
                    );
                }
            } else {
                if (bone.isSphericalBillboard) {
                    mat4.copy(bone.transform, bone.antiPivot);
                    mat4.copy(bone.postBillboardTransform, localBoneTransform);
                } else {
                    mat4.mul(
                        localBoneTransform,
                        localBoneTransform,
                        bone.antiPivot,
                    );
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

    public destroy() {
        this.animationManager.free();
        this.boneData.forEach((bone) => bone.destroy());
    }
}

export class BlpData {
    constructor(
        public fileId: number,
        public inner: WowBlp,
        public flags: number = 0,
    ) {}
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

    constructor(batch: WowWmoMaterialBatch, wmo: WmoData) {
        this.indexStart = batch.start_index;
        this.indexCount = batch.index_count;
        if (batch.use_material_id_large > 0) {
            this.materialId = batch.material_id_large;
        } else {
            this.materialId = batch.material_id;
        }
        this.material = wmo.materials[this.materialId];
        for (let blpId of [
            this.material.texture_1,
            this.material.texture_2,
            this.material.texture_3,
        ]) {
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
    }

    public setMegaStateFlags(renderInst: GfxRenderInst) {
        setM2BlendModeMegaState(
            renderInst,
            this.material.blend_mode,
            this.materialFlags.unculled ? GfxCullMode.None : GfxCullMode.Back,
            this.material.blend_mode <= 1,
            undefined,
            makeSortKey(GfxRendererLayer.TRANSLUCENT),
        );
    }
}

export class BoneData {
    public transform = mat4.create();
    public postBillboardTransform = mat4.create();
    public isSphericalBillboard: boolean;

    constructor(
        public pivot: mat4,
        public antiPivot: mat4,
        public flags: WowM2BoneFlags,
        public parentBoneId: number,
    ) {
        this.isSphericalBillboard = flags.spherical_billboard;
    }

    public destroy() {
        this.flags.free();
    }
}

export class WmoGroupData {
    public group: WowWmoGroup;
    public innerBatches: WowWmoMaterialBatch[] = [];
    public flags: WowWmoGroupFlags;
    public name: string | undefined;
    public nameIndex: number;
    public description: string | undefined;
    public descriptionIndex: number;
    public portalStart: number;
    public portalCount: number;
    public doodadRefs: Uint16Array;
    public replacementForHeaderColor: WowBgra | undefined;
    public numUVBufs: number;
    public numVertices: number;
    public numColorBufs: number;
    public visible = true;
    public groupLiquidType: number;
    public liquids: LiquidInstance[] | undefined;
    public liquidMaterials: number[] | undefined;
    public numLiquids = 0;
    public liquidIndex = 0;
    public vertices: Float32Array;
    public normals: Float32Array;
    public indices: Uint16Array;
    public uvs: Uint8Array;
    public colors: Uint8Array;
    public portalRefs: WowWmoPortalRef[];
    public bsp: WowBspTree;

    private static scratchVec4 = vec4.create();

    constructor(public fileId: number) {}

    public getBatches(wmo: WmoData): WmoBatchData[] {
        const batches: WmoBatchData[] = [];
        for (let batch of this.innerBatches) {
            batches.push(new WmoBatchData(batch, wmo));
        }
        return batches;
    }

    public getAmbientColor(wmoData: WmoData, doodadSetId: number): vec4 {
        if (!this.flags.exterior && !this.flags.exterior_lit) {
            if (this.replacementForHeaderColor) {
                return [
                    this.replacementForHeaderColor.r / 255.0,
                    this.replacementForHeaderColor.g / 255.0,
                    this.replacementForHeaderColor.b / 255.0,
                    1.0,
                ];
            } else {
                const color = wmoData.wmo.get_ambient_color(doodadSetId);
                return [color.r / 255.0, color.g / 255.0, color.b / 255.0, 1.0];
            }
        }
        return [0, 0, 0, 0];
    }

    public getVertexBuffers(device: GfxDevice): GfxVertexBufferDescriptor[] {
        return [
            {
                byteOffset: 0,
                buffer: makeStaticDataBuffer(
                    device,
                    GfxBufferUsage.Vertex,
                    this.vertices.buffer,
                ),
            },
            {
                byteOffset: 0,
                buffer: makeStaticDataBuffer(
                    device,
                    GfxBufferUsage.Vertex,
                    this.normals.buffer,
                ),
            },
            {
                byteOffset: 0,
                buffer: makeStaticDataBuffer(
                    device,
                    GfxBufferUsage.Vertex,
                    this.uvs.buffer,
                ),
            },
            {
                byteOffset: 0,
                buffer: makeStaticDataBuffer(
                    device,
                    GfxBufferUsage.Vertex,
                    this.colors.buffer,
                ),
            },
        ];
    }

    public getInputLayout(renderCache: GfxRenderCache): GfxInputLayout {
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 8, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 4, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            {
                location: WmoProgram.a_Position,
                bufferIndex: 0,
                bufferByteOffset: 0,
                format: GfxFormat.F32_RGB,
            },
            {
                location: WmoProgram.a_Normal,
                bufferIndex: 1,
                bufferByteOffset: 0,
                format: GfxFormat.F32_RGB,
            },
        ];
        for (let i = 0; i < this.numUVBufs; i++) {
            vertexAttributeDescriptors.push({
                location: WmoProgram.a_TexCoord0 + i,
                bufferIndex: 2,
                bufferByteOffset: 8 * i * this.numVertices,
                format: GfxFormat.F32_RG,
            });
        }
        for (let i = 0; i < this.numColorBufs; i++) {
            vertexAttributeDescriptors.push({
                location: WmoProgram.a_Color0 + i,
                bufferIndex: 3,
                bufferByteOffset: 4 * i * this.numVertices,
                format: GfxFormat.U8_RGBA,
            });
        }
        const indexBufferFormat: GfxFormat = GfxFormat.U16_R;
        return renderCache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat,
        });
    }

    public bspContainsPoint(modelSpacePoint: vec3): boolean {
        return this.bsp.contains_point_js(
            modelSpacePoint[0],
            modelSpacePoint[1],
            modelSpacePoint[2],
        );
    }

    public getIndexBuffer(device: GfxDevice): GfxIndexBufferDescriptor {
        return {
            byteOffset: 0,
            buffer: makeStaticDataBuffer(
                device,
                GfxBufferUsage.Index,
                this.indices.buffer,
            ),
        };
    }

    public getVertexColorForModelSpacePoint(p: vec3): vec4 | undefined {
        // project a line downwards for an intersection test
        const bspResult = this.bsp.pick_closest_tri_neg_z_js(p[0], p[1], p[2]);
        if (bspResult) {
            const [idx0, idx1, idx2] = [
                bspResult.vert_index_0,
                bspResult.vert_index_1,
                bspResult.vert_index_2,
            ];
            const [x, y, z] = [
                bspResult.bary_x,
                bspResult.bary_y,
                bspResult.bary_z,
            ];
            const r =
                (this.colors[4 * idx0 + 0] * x +
                    this.colors[4 * idx1 + 0] * y +
                    this.colors[4 * idx2 + 0] * z) /
                255.0;
            const g =
                (this.colors[4 * idx0 + 1] * x +
                    this.colors[4 * idx1 + 1] * y +
                    this.colors[4 * idx2 + 1] * z) /
                255.0;
            const b =
                (this.colors[4 * idx0 + 2] * x +
                    this.colors[4 * idx1 + 2] * y +
                    this.colors[4 * idx2 + 2] * z) /
                255.0;
            const a =
                (this.colors[4 * idx0 + 3] * x +
                    this.colors[4 * idx1 + 3] * y +
                    this.colors[4 * idx2 + 3] * z) /
                255.0;
            bspResult.free();
            return vec4.set(WmoGroupData.scratchVec4, r, g, b, a);
        }
        return undefined;
    }

    public async load(cache: WowCache): Promise<undefined> {
        const group = await cache.fetchFileByID(
            this.fileId,
            rust.WowWmoGroup.new,
        );
        this.groupLiquidType = group.header.group_liquid;
        this.replacementForHeaderColor = group.replacement_for_header_color;
        this.nameIndex = group.header.group_name;
        this.descriptionIndex = group.header.descriptive_group_name;
        this.numVertices = group.num_vertices;
        this.numUVBufs = group.num_uv_bufs;
        this.numColorBufs = group.num_color_bufs;
        this.innerBatches = group.batches;
        this.vertices = group.take_vertices();
        this.normals = new Float32Array(group.take_normals().buffer);
        this.colors = group.take_colors();
        this.portalStart = group.header.portal_start;
        this.portalCount = group.header.portal_count;
        this.uvs = group.take_uvs();
        this.bsp = group.take_bsp_tree();
        this.indices = group.take_indices();
        this.flags = rust.WowWmoGroupFlags.new(group.header.flags);
        if (this.flags.antiportal) {
            console.log(this);
        }
        this.doodadRefs = group.take_doodad_refs();
        const liquids = group.take_liquid_data();
        if (liquids) {
            this.liquids = [];
            this.liquidMaterials = [];
            this.numLiquids = liquids.length;
            for (let liquid of liquids) {
                this.liquidMaterials.push(liquid.material_id);
                this.liquids.push(LiquidInstance.fromWmoLiquid(liquid));
            }
        }
        this.group = group;
    }
}

export class WmoData {
    public wmo: WowWmo;
    public flags: WowWmoHeaderFlags;
    public groups: WmoGroupData[] = [];
    public groupInfos: WowWmoGroupInfo[] = [];
    public groupIdToIndex: Map<number, number> = new Map();
    public groupDefAABBs: Map<number, AABB> = new Map();
    public portals: WowWmoPortalData[] = [];
    public portalRefs: WowWmoPortalRef[] = [];
    public blps: Map<number, BlpData> = new Map();
    public materials: WowWmoMaterial[] = [];
    public models: Map<number, ModelData> = new Map();
    public modelIds: Uint32Array;
    public liquidTypes: Map<number, LiquidType> = new Map();
    public liquids: LiquidInstance[] = [];
    public skyboxModel: ModelData | null = null;

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
                const group = await cache.loadWmoGroup(fileId);
                group.portalRefs = this.portalRefs.slice(
                    group.portalStart,
                    group.portalStart + group.portalCount,
                );

                if (group.liquids) {
                    group.liquidIndex = this.liquids.length;

                    const liquids = group.liquids;
                    this.liquids.push(...liquids);
                    group.liquids = undefined;

                    for (let liquid of liquids) {
                        liquid.liquidType = calculateWmoLiquidType(
                            this.flags,
                            group,
                            liquid.liquidType,
                        );
                        this.liquidTypes.set(
                            liquid.liquidType,
                            await cache.loadLiquidType(liquid.liquidType),
                        );
                    }
                }

                group.name = this.wmo.get_group_text(group.nameIndex);
                group.description = this.wmo.get_group_text(
                    group.descriptionIndex,
                );
                this.groupIdToIndex.set(group.fileId, i);
                this.groups[i] = group;

                const groupInfo = this.groupInfos[i];
                this.groupDefAABBs.set(
                    group.fileId,
                    convertWowAABB(groupInfo.bounding_box),
                );
            }),
        );
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

        this.portalRefs = this.wmo.take_portal_refs();
        this.portals = this.wmo.take_portals();

        await Promise.all([
            this.loadTextures(cache),
            this.loadModels(cache),
            this.loadGroups(cache),
        ]);
    }

    public getGroup(groupId: number): WmoGroupData | undefined {
        const index = this.groupIdToIndex.get(groupId);
        if (index !== undefined) {
            return this.groups[index];
        }
        return undefined;
    }

    public portalCull(
        modelCamera: vec3,
        modelFrustum: ConvexHull,
        currentGroupId: number,
        visibleGroups: number[],
        visitedGroups: number[],
    ) {
        if (visitedGroups.includes(currentGroupId)) return;
        if (!visibleGroups.includes(currentGroupId)) {
            visibleGroups.push(currentGroupId);
        }
        const group = this.getGroup(currentGroupId)!;
        for (let portalRef of group.portalRefs) {
            const portal = this.portals[portalRef.portal_index];
            const otherGroup = this.groups[portalRef.group_index];

            if (
                !portal.is_facing_us(
                    modelCamera as Float32Array,
                    portalRef.side,
                )
            ) {
                continue;
            }

            if (
                portal.in_frustum(modelFrustum) ||
                portal.aabb_contains_point(modelCamera as Float32Array)
            ) {
                let portalFrustum = portal.clip_frustum(
                    modelCamera as Float32Array,
                    modelFrustum,
                );
                this.portalCull(
                    modelCamera,
                    portalFrustum,
                    otherGroup.fileId,
                    visibleGroups,
                    visitedGroups.concat([currentGroupId]),
                );
            }
        }
    }
}

function calculateWmoLiquidType(
    wmoFlags: WowWmoHeaderFlags,
    group: WmoGroupData,
    type: number,
): number {
    const FIRST_NONBASIC_LIQUID_TYPE = 21;
    const GREEN_LAVA = 15;
    const MASKED_OCEAN = 1;
    const MASKED_MAGMA = 2;
    const MASKED_SLIME = 3;
    const LIQUID_WMO_MAGMA = 19;
    const LIQUID_WMO_OCEAN = 14;
    const LIQUID_WMO_WATER = 13;
    const LIQUID_WMO_SLIME = 20;
    let liquidToConvert;
    if (wmoFlags.use_liquid_type_dbc_id) {
        if (group.groupLiquidType < FIRST_NONBASIC_LIQUID_TYPE) {
            liquidToConvert = group.groupLiquidType - 1;
        } else {
            return group.groupLiquidType;
        }
    } else {
        if (group.groupLiquidType === GREEN_LAVA) {
            liquidToConvert = type;
        } else if (group.groupLiquidType < FIRST_NONBASIC_LIQUID_TYPE) {
            liquidToConvert = group.groupLiquidType;
        } else {
            return group.groupLiquidType + 1;
        }
    }
    const maskedLiquid = liquidToConvert & 0x3;
    if (maskedLiquid === MASKED_OCEAN) {
        return LIQUID_WMO_OCEAN;
    } else if (maskedLiquid === MASKED_MAGMA) {
        return LIQUID_WMO_MAGMA;
    } else if (maskedLiquid === MASKED_SLIME) {
        return LIQUID_WMO_SLIME;
    } else if (group.flags.water_is_ocean) {
        return LIQUID_WMO_OCEAN;
    } else {
        return LIQUID_WMO_WATER;
    }
}

export class SkinData {
    public submeshes: WowSkinSubmesh[];
    public batches: WowModelBatch[];
    public indexBuffer: Uint16Array;
    public renderPasses: ModelRenderPass[];

    constructor(
        public skin: WowSkin,
        model: ModelData,
    ) {
        this.submeshes = skin.submeshes;
        this.batches = skin.batches;
        this.renderPasses = this.batches.map(
            (batch) => new ModelRenderPass(batch, this.skin, model),
        );
        this.indexBuffer = skin.take_indices();
    }
}

export class ModelRenderPass {
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
    private scratchMat4 = mat4.identity(mat4.create());

    constructor(
        public batch: WowModelBatch,
        public skin: WowSkin,
        public model: ModelData,
    ) {
        this.fragmentShaderId = batch.get_pixel_shader();
        this.vertexShaderId = batch.get_vertex_shader();
        this.submesh = skin.submeshes[batch.skin_submesh_index];
        [this.blendMode, this.materialFlags] =
            model.materials[this.batch.material_index];
        this.layer = this.batch.material_layer;
        this.tex0 = this.getBlp(0)!;
        this.tex1 = this.getBlp(1);
        this.tex2 = this.getBlp(2);
        this.tex3 = this.getBlp(3);
    }

    public setMegaStateFlags(renderInst: GfxRenderInst) {
        setM2BlendModeMegaState(
            renderInst,
            this.blendMode,
            this.materialFlags.two_sided ? GfxCullMode.None : GfxCullMode.Back,
            this.materialFlags.depth_write,
            this.materialFlags.depth_tested
                ? reverseDepthForCompareMode(GfxCompareMode.LessEqual)
                : GfxCompareMode.Always,
            makeSortKey(GfxRendererLayer.TRANSLUCENT + this.layer),
        );
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

    private getTextureTransform(texIndex: number): mat4 {
        const lookupIndex = this.batch.texture_transform_combo_index + texIndex;
        const transformIndex =
            this.model.textureTransformLookupTable[lookupIndex];
        if (transformIndex !== undefined) {
            if (transformIndex < this.model.textureTransforms.length) {
                return this.model.textureTransforms[transformIndex];
            }
        }
        return this.scratchMat4;
    }

    public getTextureWeight(texIndex: number): number {
        const lookupIndex = this.batch.texture_weight_combo_index + texIndex;
        const transparencyIndex =
            this.model.textureTransparencyLookupTable[lookupIndex];
        if (transparencyIndex !== undefined) {
            if (transparencyIndex < this.model.textureWeights.length) {
                return this.model.textureWeights[transparencyIndex];
            }
        }
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
        const numVec4s = 4;
        const numMat4s = 3;
        let offset = renderInst.allocateUniformBuffer(
            ModelProgram.ub_MaterialParams,
            numVec4s * 4 + numMat4s * 16,
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
        offset += fillMatrix4x4(
            uniformBuf,
            offset,
            this.getTextureTransform(0),
        );
        offset += fillMatrix4x4(
            uniformBuf,
            offset,
            this.getTextureTransform(1),
        );
        const textureWeight: vec4 = [
            this.getTextureWeight(0),
            this.getTextureWeight(1),
            this.getTextureWeight(2),
            this.getTextureWeight(3),
        ];
        offset += fillVec4v(uniformBuf, offset, textureWeight);
    }
}

function setM2BlendModeMegaState(
    renderInst: GfxRenderInst,
    blendMode: WowM2BlendingMode,
    cullMode: GfxCullMode,
    depthWrite: boolean,
    depthCompare: GfxCompareMode | undefined,
    sortKeyLayer: number,
) {
    const defaultBlendState = {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.One,
        blendDstFactor: GfxBlendFactor.Zero,
    };
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

    // TODO setSortKeyDepth based on distance to transparent object
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
            settings.attachmentsState![0].channelWriteMask =
                GfxChannelWriteMask.AllChannels;
            renderInst.sortKey = sortKeyLayer;
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
            renderInst.sortKey = sortKeyLayer;
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
            settings.attachmentsState![0].channelWriteMask =
                GfxChannelWriteMask.AllChannels;
            renderInst.sortKey = sortKeyLayer;
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
            renderInst.sortKey = sortKeyLayer;
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
            renderInst.sortKey = sortKeyLayer;
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
            renderInst.sortKey = sortKeyLayer;
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
    public normalMatrix: mat4 = mat4.create();

    public aabb: AABB = new AABB();
    public worldAABB: AABB = new AABB();

    public visible = true;
    public groupIdToDoodadIndices: MapArray<number, number> = new MapArray();
    public groupAmbientColors: Map<number, vec4> = new Map();
    public groupIdToLiquidIndices: MapArray<number, number> = new MapArray();
    public liquidAABBs: AABB[] = [];
    public doodadIndexToGroupIds: MapArray<number, number> = new MapArray();
    public doodadIndexToDoodad: Map<number, DoodadData> = new Map();

    private scratchVec3 = vec3.create();

    static fromAdtDefinition(def: WowAdtWmoDefinition, wmo: WmoData) {
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

    static fromGlobalDefinition(def: WowGlobalWmoDefinition, wmo: WmoData) {
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
        position: vec3,
        rotation: vec3,
        extents: AABB,
    ) {
        setMatrixTranslation(this.placementMatrix, position);
        mat4.scale(this.placementMatrix, this.placementMatrix, [
            scale,
            scale,
            scale,
        ]);
        mat4.rotateZ(
            this.placementMatrix,
            this.placementMatrix,
            MathConstants.DEG_TO_RAD * rotation[2],
        );
        mat4.rotateY(
            this.placementMatrix,
            this.placementMatrix,
            MathConstants.DEG_TO_RAD * rotation[1],
        );
        mat4.rotateX(
            this.placementMatrix,
            this.placementMatrix,
            MathConstants.DEG_TO_RAD * rotation[0],
        );
        mat4.mul(
            this.modelMatrix,
            this.placementMatrix,
            placementSpaceFromModelSpace,
        );
        mat4.mul(
            this.modelMatrix,
            adtSpaceFromPlacementSpace,
            this.modelMatrix,
        );

        mat4.invert(this.invModelMatrix, this.modelMatrix);
        mat4.invert(this.invPlacementMatrix, this.placementMatrix);
        mat4.mul(
            this.invPlacementMatrix,
            this.invPlacementMatrix,
            placementSpaceFromAdtSpace,
        );
        mat4.mul(
            this.invPlacementMatrix,
            modelSpaceFromPlacementSpace,
            this.invPlacementMatrix,
        );

        mat4.mul(
            this.normalMatrix,
            this.modelMatrix,
            placementSpaceFromModelSpace,
        );
        mat4.invert(this.normalMatrix, this.normalMatrix);
        mat4.transpose(this.normalMatrix, this.normalMatrix);

        for (let i = 0; i < wmo.groups.length; i++) {
            const group = wmo.groups[i];

            for (
                let i = group.liquidIndex;
                i < group.liquidIndex + group.numLiquids;
                i++
            ) {
                this.groupIdToLiquidIndices.append(group.fileId, i);
            }
            this.groupAmbientColors.set(
                group.fileId,
                group.getAmbientColor(wmo, doodadSet),
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
        for (let group of wmo.groups) {
            for (let ref of group.doodadRefs) {
                if (doodadSetRefs.includes(ref)) {
                    this.groupIdToDoodadIndices.append(group.fileId, ref);
                    this.doodadIndexToGroupIds.append(ref, group.fileId);
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
                let group: WmoGroupData;
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

                let bspAmbientColor = group.getVertexColorForModelSpacePoint(p);

                if (group.flags.interior && !group.flags.exterior_lit) {
                    const groupAmbientColor = this.groupAmbientColors.get(
                        group.fileId,
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

        this.aabb.transform(extents, this.invPlacementMatrix);
        this.aabb.transform(extents, modelSpaceFromPlacementSpace);
        this.worldAABB.transform(extents, adtSpaceFromPlacementSpace);
        this.visible = true;
    }
}

export class AdtLodData {
    public modelIds: number[] = [];
    public models = new Map<number, ModelData>();
    public wmoDefs: WmoDefinition[] = [];
    public wmos = new Map<number, WmoData>();
    public doodads: DoodadData[] = [];

    private loadDoodads(
        cache: WowCache,
        data: WowAdt,
        lodLevel: number,
    ): Promise<unknown> {
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

    private loadModels(
        cache: WowCache,
        data: WowAdt,
        lodLevel: number,
    ): Promise<unknown> {
        return Promise.all(
            Array.from(data.get_model_file_ids(lodLevel)).map(
                async (modelId) => {
                    this.models.set(modelId, await cache.loadModel(modelId));
                    this.modelIds.push(modelId);
                },
            ),
        );
    }

    private loadWMOs(
        cache: WowCache,
        data: WowAdt,
        lodLevel: number,
    ): Promise<unknown> {
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

    public async load(
        cache: WowCache,
        data: WowAdt,
        lodLevel: number,
    ): Promise<unknown> {
        return Promise.all([
            this.loadDoodads(cache, data, lodLevel),
            this.loadModels(cache, data, lodLevel),
            this.loadWMOs(cache, data, lodLevel),
        ]);
    }
}

export class LiquidInstance {
    private vertices: Float32Array | undefined;
    private indices: Uint16Array | undefined;
    public visible: boolean = true;

    constructor(
        vertices: Float32Array,
        indices: Uint16Array,
        public indexCount: number,
        public liquidType: number,
        public worldSpaceAABB: AABB,
    ) {
        this.vertices = vertices;
        this.indices = indices;
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

    constructor(
        public fileId: number,
        adt: WowAdt,
        public lightdbMapId: number,
    ) {
        this.inner = adt;
    }

    public setLodLevel(lodLevel: number) {
        assert(lodLevel === 0 || lodLevel === 1, "lodLevel must be 0 or 1");
        if (this.lodLevel === lodLevel) return;
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
            for (const [k, v] of lodData.wmos) this.wmos.set(k, v);
            for (const [k, v] of lodData.models) this.models.set(k, v);
        }

        const renderResult = this.inner!.get_render_result(
            this.hasBigAlpha,
            this.hasHeightTexturing,
        );
        this.worldSpaceAABB.transform(
            convertWowAABB(renderResult.extents),
            noclipSpaceFromAdtSpace,
        );
        this.worldSpaceAABB.transform(
            this.worldSpaceAABB,
            adtSpaceFromPlacementSpace,
        );
        this.vertexBuffer = renderResult.take_vertex_buffer();
        this.indexBuffer = renderResult.take_index_buffer();
        let i = 0;
        const worldSpaceChunkWidth = 100 / 3;
        for (let chunk of renderResult.chunks) {
            const x = 15 - Math.floor(i / 16);
            const y = 15 - (i % 16);
            const chunkWorldSpaceAABB = new AABB();
            chunkWorldSpaceAABB.minX =
                this.worldSpaceAABB.minX + x * worldSpaceChunkWidth;
            chunkWorldSpaceAABB.minY =
                this.worldSpaceAABB.minY + y * worldSpaceChunkWidth;
            chunkWorldSpaceAABB.minZ = this.worldSpaceAABB.minZ;

            chunkWorldSpaceAABB.maxX =
                this.worldSpaceAABB.minX + (x + 1) * worldSpaceChunkWidth;
            chunkWorldSpaceAABB.maxY =
                this.worldSpaceAABB.minY + (y + 1) * worldSpaceChunkWidth;
            chunkWorldSpaceAABB.maxZ = this.worldSpaceAABB.maxZ;
            const textures = [];
            for (let blpId of chunk.texture_layers) {
                textures.push(this.blps.get(blpId)!);
            }

            this.chunkData.push(
                new ChunkData(chunk, textures, chunkWorldSpaceAABB),
            );
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

        let adtCenter = vec3.create();
        this.worldSpaceAABB.centerPoint(adtCenter);

        this.inner!.free();
        this.inner = null;
    }

    public lodDoodads(): DoodadData[] {
        return this.lodData[this.lodLevel].doodads;
    }

    public lodWmoDefs(): WmoDefinition[] {
        return this.lodData[this.lodLevel].wmoDefs;
    }

    public getBufsAndChunks(
        device: GfxDevice,
    ): [GfxVertexBufferDescriptor, GfxIndexBufferDescriptor] {
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
    public normalMatrix = mat4.create();
    public ambientColor = vec4.create();
    public applyInteriorLighting = false;
    public applyExteriorLighting = false;
    public isSkybox = false;
    public skyboxBlend = 0;

    constructor(
        public modelId: number,
        public modelMatrix: mat4,
        public color: vec4 | null,
        public uniqueId: number | undefined = undefined,
    ) {
        mat4.mul(
            this.normalMatrix,
            this.modelMatrix,
            placementSpaceFromModelSpace,
        );
        mat4.mul(
            this.normalMatrix,
            adtSpaceFromPlacementSpace,
            this.modelMatrix,
        );
        mat4.invert(this.normalMatrix, this.normalMatrix);
        mat4.transpose(this.normalMatrix, this.normalMatrix);
    }

    // Make a fake doodad for skyboxes
    static skyboxDoodad(): DoodadData {
        let modelMatrix = mat4.identity(mat4.create());
        let doodad = new DoodadData(666, modelMatrix, null);
        doodad.isSkybox = true;
        return doodad;
    }

    static fromAdtDoodad(doodad: WowDoodad): DoodadData {
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
        let position: vec3 = [doodadPos.x, doodadPos.y, doodadPos.z];
        doodadPos.free();
        const doodadRot = doodad.orientation;
        let rotation: quat = [
            doodadRot.x,
            doodadRot.y,
            doodadRot.z,
            doodadRot.w,
        ];
        doodadRot.free();
        let scale = doodad.scale;
        let modelId = modelIds[doodad.name_index];
        if (modelId === undefined) {
            throw new Error(
                `WMO doodad with invalid name_index ${doodad.name_index} (only ${modelIds.length} models)`,
            );
        }
        let doodadMat = mat4.create();
        setMatrixTranslation(doodadMat, position);
        const rotMat = mat4.fromQuat(mat4.create(), rotation as quat);
        mat4.mul(doodadMat, doodadMat, rotMat);
        mat4.scale(doodadMat, doodadMat, [scale, scale, scale]);
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
