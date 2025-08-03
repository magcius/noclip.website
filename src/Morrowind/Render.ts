
import { ReadonlyVec3, mat4, vec3 } from "gl-matrix";
import { Camera } from "../Camera.js";
import { White, colorCopy, colorFromRGBA8, colorLerp, colorNewCopy } from "../Color.js";
import * as DDS from "../DarkSouls/dds.js";
import { NamedArrayBufferSlice } from "../DataFetcher.js";
import { AABB, Frustum } from "../Geometry.js";
import { getMatrixTranslation, invlerp } from "../MathHelpers.js";
import { DeviceProgram } from "../Program.js";
import { SceneContext } from "../SceneBase.js";
import { TextureMapping } from "../TextureHolder.js";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers.js";
import { makeAttachmentClearDescriptor, makeBackbufferDescSimple } from "../gfx/helpers/RenderGraphHelpers.js";
import { fillColor, fillMatrix4x3, fillMatrix4x4, fillVec3v } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBindingLayoutDescriptor, GfxBuffer, GfxBufferUsage, GfxClipSpaceNearZ, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMipFilterMode, GfxProgram, GfxSamplerFormatKind, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInstList, GfxRenderInstManager, gfxRenderInstCompareNone } from "../gfx/render/GfxRenderInstManager.js";
import { arrayRemove, assert, assertExists, nArray } from "../util.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { BSA } from "./BSA.js";
import { CELL, ESM, FRMR, LAND } from "./ESM.js";
import { NIF, NIFData } from "./NIFBase.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";

const noclipSpaceFromMorrowindSpace = mat4.fromValues(
    -1, 0, 0, 0,
    0,  0, 1, 0,
    0,  1, 0, 0,
    0,  0, 0, 1,
);

function isInRangeXY(x: number, y: number, cameraPos: ReadonlyVec3, distSq: number): boolean {
    const camX = cameraPos[0];
    const camY = cameraPos[1];

    const dx = x - camX;
    const dy = y - camY;

    const sqd = dx*dx + dy*dy;
    return sqd <= distSq;
}

class View {
    // aka viewMatrix
    public viewFromWorldMatrix = mat4.create();
    // aka worldMatrix
    public worldFromViewMatrix = mat4.create();
    public clipFromWorldMatrix = mat4.create();
    // aka projectionMatrix
    public clipFromViewMatrix = mat4.create();

    public clipSpaceNearZ: GfxClipSpaceNearZ;

    // The current camera position, in Morrowind world space.
    public cameraPos = vec3.create();

    // Frustum is stored in Morrowind world space.
    public frustum = new Frustum();

    public renderInstListOpa = new GfxRenderInstList();
    public renderInstListXlu = new GfxRenderInstList();
    public renderInstListSky = new GfxRenderInstList(gfxRenderInstCompareNone);

    public nifCullFarOpaSq = (8192*6) ** 2;
    public nifCullFarXluSq = (8192*3) ** 2;

    public finishSetup(): void {
        mat4.invert(this.worldFromViewMatrix, this.viewFromWorldMatrix);
        mat4.mul(this.clipFromWorldMatrix, this.clipFromViewMatrix, this.viewFromWorldMatrix);
        getMatrixTranslation(this.cameraPos, this.worldFromViewMatrix);
        this.frustum.updateClipFrustum(this.clipFromWorldMatrix, this.clipSpaceNearZ);
    }

    public setupFromCamera(camera: Camera): void {
        this.clipSpaceNearZ = camera.clipSpaceNearZ;
        mat4.mul(this.viewFromWorldMatrix, camera.viewMatrix, noclipSpaceFromMorrowindSpace);
        mat4.copy(this.clipFromViewMatrix, camera.projectionMatrix);
        this.finishSetup();
    }

    public reset(): void {
        this.renderInstListOpa.reset();
        this.renderInstListXlu.reset();
        this.renderInstListSky.reset();
    }
}

export class PluginData {
    constructor(public bsa: BSA[], public esm: ESM) {
    }

    public findFileData(path: string): NamedArrayBufferSlice | null {
        for (let i = 0; i < this.bsa.length; i++) {
            const data = this.bsa[i].findFileData(path);
            if (data !== null)
                return data;
        }
        return null;
    }
}

export class ModelCache {
    public renderCache: GfxRenderCache;
    public terrainTexture: TerrainTextureData | null = null;
    public zeroBuffer: GfxBuffer;
    private textureCache = new Map<string, GfxTexture>();
    private nifCache = new Map<string, NIFData>();

    constructor(public device: GfxDevice, private pluginData: PluginData) {
        this.renderCache = new GfxRenderCache(this.device);
        this.zeroBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, new Uint8Array(16).buffer);
    }

    public getTerrainTexture(): GfxTexture {
        if (this.terrainTexture === null)
            this.terrainTexture = new TerrainTextureData(this.device, this.pluginData);

        return this.terrainTexture.texture;
    }

    public getTexture(path: string): GfxTexture {
        if (this.textureCache.has(path))
            return this.textureCache.get(path)!;

        const data = assertExists(this.pluginData.findFileData(path));
        const dds = DDS.parse(data, path, false);
        const texture = DDS.createTexture(this.device, dds);
        this.textureCache.set(path, texture);
        return texture;
    }

    public getNIFData(path: string): NIFData {
        if (this.nifCache.has(path))
            return this.nifCache.get(path)!;

        const data = assertExists(this.pluginData.findFileData(path));
        const nif = new NIF(data);
        const nifData = new NIFData(this, nif);
        this.nifCache.set(path, nifData);
        return nifData;
    }

    public destroy(device: GfxDevice): void {
        for (const texture of this.textureCache.values())
            device.destroyTexture(texture);
        for (const nif of this.nifCache.values())
            nif.destroy(device);
        if (this.terrainTexture !== null)
            this.terrainTexture.destroy(device);
        device.destroyBuffer(this.zeroBuffer);
        this.renderCache.destroy();
    }
}

export class Globals {
    public modelCache: ModelCache;
    public terrainIndexBuffer: GfxBuffer;
    public weatherManager = new WeatherManager();
    public view = new View();
    public timeAdv = 0.005;
    public time = 0;

    constructor(public device: GfxDevice, public pluginData: PluginData) {
        this.modelCache = new ModelCache(device, pluginData);

        const today = new Date();
        this.time = today.getHours();
    }

    public destroy(device: GfxDevice): void {
        this.modelCache.destroy(device);
    }
}

class TerrainTextureData {
    public texture: GfxTexture;

    constructor(device: GfxDevice, pluginData: PluginData) {
        const ltex = pluginData.esm.ltex;
        const depth = ltex.length + 1;

        this.texture = device.createTexture({
            dimension: GfxTextureDimension.n2DArray,
            width: 256, height: 256,
            pixelFormat: GfxFormat.BC1,
            depthOrArrayLayers: depth,
            numLevels: 6,
            usage: GfxTextureUsage.Sampled,
        });
        device.setResourceName(this.texture, "Terrain Texture");

        const levelDatas: Uint8Array[] = [];
        for (let i = 0; i < this.texture.numLevels; i++) {
            const mipSize = this.texture.width >>> i;
            const numBlocks = (mipSize >> 2);
            const byteCount = numBlocks * numBlocks * 8;
            levelDatas.push(new Uint8Array(byteCount * depth));
        }

        const insertDDS = (i: number, filename: string) => {
            const data = pluginData.findFileData(filename);
            if (data === null)
                return; // missing

            const dds = DDS.parse(data, filename, false);
            assert(dds.width === this.texture.width);
            assert(dds.height === this.texture.height);
            assert(dds.format === 'DXT1');
            assert(dds.levels.length === this.texture.numLevels);

            for (let mip = 0; mip < dds.levels.length; mip++) {
                const dst = levelDatas[mip], src = dds.levels[mip].data;
                const dstOffset = src.byteLength * i;
                dst.set(src.createTypedArray(Uint8Array), dstOffset);
            }
        };

        insertDDS(0, `textures\\_land_default.dds`);
        for (const tex of ltex)
            insertDDS(tex.index + 1, tex.filename);

        device.uploadTextureData(this.texture, 0, levelDatas);
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.texture);
    }
}

class CellTerrain {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    public terrainMapTex: GfxTexture;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;
    public indexCount: number;
    public aabb = new AABB();

    constructor(globals: Globals, land: LAND) {
        assert(land.heightGradientData !== null);

        const vertexCount = land.sideLen * land.sideLen;
        const vertexSizeInFloats = 7; // height, normal, color
        const vertexData = new Float32Array(vertexCount * vertexSizeInFloats);

        this.aabb.min[0] = this.aabb.min[1] = -4096;
        this.aabb.max[0] = this.aabb.max[1] = 4096;

        let rowStart = land.heightOffset;
        for (let y = 0; y < land.sideLen; y++) {
            let height = rowStart;
            for (let x = 0; x < land.sideLen; x++) {
                const idx = y * land.sideLen + x;
                height += land.heightGradientData[idx];
                if (x === 0)
                    rowStart = height;

                vertexData[idx*7 + 0] = height;

                this.aabb.min[2] = Math.min(this.aabb.min[2], height);
                this.aabb.max[2] = Math.max(this.aabb.max[2], height);

                let nx = 0, ny = 0, nz = 1;
                if (land.heightNormalData !== null) {
                    nx = (land.heightNormalData[idx*3 + 0] / 0x7F) - 1.0;
                    ny = (land.heightNormalData[idx*3 + 1] / 0x7F) - 1.0;
                    nz = (land.heightNormalData[idx*3 + 2] / 0x7F) - 1.0;
                }
                vertexData[idx*7 + 1] = nx;
                vertexData[idx*7 + 2] = ny;
                vertexData[idx*7 + 3] = nz;

                let cr = 1, cg = 1, cb = 1;
                if (land.heightColorData !== null) {
                    cr = (land.heightColorData[idx*3 + 0]) / 255;
                    cg = (land.heightColorData[idx*3 + 1]) / 255;
                    cb = (land.heightColorData[idx*3 + 2]) / 255;
                }
                vertexData[idx*7 + 4] = cr;
                vertexData[idx*7 + 5] = cg;
                vertexData[idx*7 + 6] = cb;
            }
        }

        const device = globals.modelCache.device;
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, vertexData.buffer);
        this.vertexBufferDescriptors = [
            { buffer: this.vertexBuffer },
        ];

        // two trianges per edge
        const edgeCount = land.sideLen - 1;
        const indexData = new Uint16Array(edgeCount * edgeCount * 6);
        let indexIdx = 0;
        for (let y = 1; y < land.sideLen; y++) {
            for (let x = 1; x < land.sideLen; x++) {
                const x0 = x - 1, x1 = x - 0;
                const y0 = y - 1, y1 = y - 0;

                const i0 = y0*land.sideLen + x0;
                const i1 = y0*land.sideLen + x1;
                const i2 = y1*land.sideLen + x0;
                const i3 = y1*land.sideLen + x1;

                indexData[indexIdx++] = i0;
                indexData[indexIdx++] = i1;
                indexData[indexIdx++] = i2;

                indexData[indexIdx++] = i2;
                indexData[indexIdx++] = i1;
                indexData[indexIdx++] = i3;
            }
        }
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, indexData.buffer);
        this.indexBufferDescriptor = { buffer: this.indexBuffer };
        this.indexCount = indexData.length;

        this.terrainMapTex = device.createTexture(makeTextureDescriptor2D(GfxFormat.F32_R, 16, 16, 1));
        const terrainMapData = new Float32Array(16*16);
        if (land.heightTexIdxData !== null) {
            for (let i = 0; i < land.heightTexIdxData.length; i++) {
                // swizzle
                const idx = (i & 0xC3) | ((i & 0x0C) << 2) | ((i & 0x30) >>> 2);
                terrainMapData[idx] = land.heightTexIdxData[i];
            }
        }
        device.uploadTextureData(this.terrainMapTex, 0, [terrainMapData]);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyTexture(this.terrainMapTex);
    }
}

const bindingLayoutsNifInstanced: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 7 },
];

const bindingLayoutsNifSingle: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 7 },
];

class StaticModel {
    public visible = true;
    public instances: Static[] = [];

    constructor(public nifData: NIFData) {
    }

    public prepareToRender(globals: Globals, renderInstManager: GfxRenderInstManager): void {
        if (!this.visible)
            return;

        // Gather all visible instances.
        const template = renderInstManager.getCurrentTemplate();
        const uniformBuffer = template.getUniformBuffer();
        const maxInstances = this.nifData.getMaxInstances();
        const triShapes = this.nifData.getTriShapes();

        let baseOffs = 0, offs = 0;
        let numInstances = 0;

        const fillInstance = (instance: Static) => {
            if (numInstances === 0)
                baseOffs = offs = uniformBuffer.allocateChunk(maxInstances * 16);

            const d = uniformBuffer.mapBufferF32();
            offs += fillMatrix4x3(d, offs, instance.modelMatrix);
            if (++numInstances === maxInstances)
                submitDrawInstanced();
        };

        const submitDrawInstanced = () => {
            if (numInstances === 0)
                return;
            renderInstManager.setCurrentList(globals.view.renderInstListOpa);
            template.setBindingLayouts(bindingLayoutsNifInstanced);
            template.setUniformBufferOffset(2, baseOffs, maxInstances * 16);
            template.setInstanceCount(numInstances);
            for (let i = 0; i < triShapes.length; i++) {
                const triShape = triShapes[i];
                if (!triShape.isOpa)
                    continue;
                triShape.prepareToRenderInstanced(globals, renderInstManager);
            }
            numInstances = 0;
        };

        const submitDrawXlu = (instance: Static) => {
            const x = instance.frmr.position[0];
            const y = instance.frmr.position[1];
            if (!isInRangeXY(x, y, globals.view.cameraPos, globals.view.nifCullFarXluSq))
                return;

            renderInstManager.setCurrentList(globals.view.renderInstListXlu);
            template.setBindingLayouts(bindingLayoutsNifSingle);
            template.setInstanceCount(1);
            for (let i = 0; i < triShapes.length; i++) {
                const triShape = triShapes[i];
                if (triShape.isOpa)
                    continue;
                triShape.prepareToRenderSingle(globals, renderInstManager, instance.modelMatrix);
            }
        };

        for (let i = 0; i < this.instances.length; i++) {
            const instance = this.instances[i];
            if (!instance.visible || !instance.checkFrustum(globals))
                continue;
            fillInstance(instance);
            submitDrawXlu(instance);
        }
        submitDrawInstanced();
    }
}

class Static {
    public visible = true;
    private staticModel: StaticModel;
    public modelMatrix = mat4.create();

    constructor(worldManager: WorldManager, globals: Globals, public frmr: FRMR, public nifPath: string) {
        this.staticModel = worldManager.getStaticModel(globals, this.nifPath);
        this.frmr.calcModelMatrix(this.modelMatrix);
    }

    public setRegistered(v: boolean): void {
        if (v)
            this.staticModel.instances.push(this);
        else
            arrayRemove(this.staticModel.instances, this);
    }

    public checkFrustum(globals: Globals): boolean {
        return this.staticModel.nifData.checkFrustum(globals.view.frustum, this.modelMatrix);
    }
}

class CellData {
    private name: string;
    public terrain: CellTerrain | null = null;
    public visible = true;
    public registered: boolean = false;
    public static: Static[] = [];

    constructor(worldManager: WorldManager, globals: Globals, public cell: CELL) {
        const land = this.cell.land;
        if (land !== null && land.heightGradientData !== null)
            this.terrain = new CellTerrain(globals, land);

        for (let i = 0; i < this.cell.frmr.length; i++) {
            const frmr = this.cell.frmr[i];
            const objectID = frmr.objectID;
            const stat = globals.pluginData.esm.stat.get(objectID);
            const acti = globals.pluginData.esm.acti.get(objectID);
            if (stat !== undefined)
                this.static.push(new Static(worldManager, globals, frmr, stat));
            else if (acti !== undefined)
                this.static.push(new Static(worldManager, globals, frmr, acti));
        }

        const cellName = this.cell.name ? this.cell.name : this.cell.regionName;
        this.name = `${cellName} ${this.cell.gridX},${this.cell.gridY}`;
    }

    private isInDistanceRange(globals: Globals, distSq: number): boolean {
        const cellX = this.cell.gridX * 8192 + 4096;
        const cellY = this.cell.gridY * 8192 + 4096;
        return isInRangeXY(cellX, cellY, globals.view.cameraPos, distSq);
    }

    public update(globals: Globals): void {
        this.setNifRegistered(this.visible && this.isInDistanceRange(globals, globals.view.nifCullFarOpaSq));
    }

    private setNifRegistered(v: boolean): void {
        if (this.registered === v)
            return;

        this.registered = v;
        for (let i = 0; i < this.static.length; i++) {
            const instance = this.static[i];
            instance.setRegistered(v);
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.terrain !== null)
            this.terrain.destroy(device);
    }
}

const bindingLayoutsTerrain: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 2, samplerEntries: [
        { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.UnfilterableFloat, }, // TODO(jstpierre): Integer texture for the map lookup?
    ] },
];

class TerrainProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Color = 2;

    public override both = `
precision mediump float;
precision mediump sampler2DArray;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
    vec4 u_SunDirection;
    vec4 u_SunDiffuse;
    vec4 u_SunAmbient;
};

layout(std140) uniform ub_ObjectParams {
    Mat3x4 u_WorldFromLocal;
};

layout(location = 0) uniform sampler2DArray u_TextureTerrain;
layout(location = 1) uniform sampler2D u_TextureTerrainMap;
`;
    public override vert = `
layout(location = 0) in float a_Height;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec3 a_Color;

out vec2 v_CellUV;
out vec3 v_Color;

void main() {
    // 0-1 across the cell
    vec2 uv = vec2(float(gl_VertexID % 65), float(gl_VertexID / 65)) / vec2(64.0);
    v_CellUV = uv;

    float x = (uv.x - 0.5) * 8192.0;
    float y = (uv.y - 0.5) * 8192.0;
    float z = a_Height;
    vec3 t_PositionWorld = UnpackMatrix(u_WorldFromLocal) * vec4(x, y, z, 1.0);

    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(t_PositionWorld, 1.0);
    v_Color = a_Color;
    v_Color *= dot(a_Normal, u_SunDirection.xyz) * u_SunDiffuse.xyz + u_SunAmbient.xyz;
}
`;

    public override frag = `
in vec2 v_CellUV;
in vec3 v_Color;

vec4 SampleTerrain(vec2 t_TexCoord, ivec2 t_Offset) {
    float t_TexLayer = texelFetch(SAMPLER_2D(u_TextureTerrainMap), ivec2(t_TexCoord) + t_Offset, 0).r;
    return texture(SAMPLER_2DArray(u_TextureTerrain), vec3(t_TexCoord.xy, t_TexLayer));
}

void main() {
    vec2 t_TexCoord = v_CellUV * 16.0;

    vec2 t_Frac = fract(t_TexCoord);
    ivec2 t_TexCoordI = ivec2(t_TexCoord);
    vec4 t_Terrain = SampleTerrain(t_TexCoord, ivec2(0, 0));

    vec4 t_TerrainPX = SampleTerrain(t_TexCoord, ivec2(1, 0));
    vec4 t_TerrainNX = SampleTerrain(t_TexCoord, ivec2(-1, 0));

    // XXX(jstpierre): This doesn't blend across chunk boundaries, need a dynamic terrain system
    if (t_Frac.x > 0.5 && t_TexCoordI.x < 15)
        t_Terrain = mix(t_Terrain, t_TerrainPX, t_Frac.x - 0.5);
    else if (t_TexCoordI.x > 0)
        t_Terrain = mix(t_Terrain, t_TerrainNX, 0.5 - t_Frac.x);

    vec4 t_TerrainPY = SampleTerrain(t_TexCoord, ivec2(0, 1));
    vec4 t_TerrainNY = SampleTerrain(t_TexCoord, ivec2(0, -1));

    if (t_Frac.y > 0.5 && t_TexCoordI.y < 15)
        t_Terrain = mix(t_Terrain, t_TerrainPY, t_Frac.y - 0.5);
    else if (t_TexCoordI.y > 0)
        t_Terrain = mix(t_Terrain, t_TerrainNY, 0.5 - t_Frac.y);

    bool t_ShowGridLines = false;
    if (t_ShowGridLines) {
        if (t_Frac.x <= 0.01 || t_Frac.y <= 0.01)
            t_Terrain.rgb = vec3(0.0);
    }

    vec4 t_Diffuse = t_Terrain;
    t_Diffuse.rgb *= v_Color;

    // TODO(jstpierre): Lighting, weather

    gl_FragColor = t_Diffuse;
}
`;
}

const scratchMatrix = mat4.create();
class WorldManager {
    public cell: CellData[] = [];
    private terrainProgram: GfxProgram;
    private terrainInputLayout: GfxInputLayout;
    private textureMapping = nArray(2, () => new TextureMapping());
    private staticModelCache = new Map<string, StaticModel>();
    private staticModelCache2: StaticModel[] = [];

    constructor(globals: Globals) {
        for (let i = 0; i < globals.pluginData.esm.cell.length; i++) {
            const cell = globals.pluginData.esm.cell[i];
            if (cell.interior)
                continue; // skip

            this.cell.push(new CellData(this, globals, cell));
        }

        const renderCache = globals.modelCache.renderCache;
        this.terrainProgram = renderCache.createProgram(new TerrainProgram());

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: TerrainProgram.a_Position, bufferIndex: 0, format: GfxFormat.F32_R, bufferByteOffset: 0*4 },
            { location: TerrainProgram.a_Normal, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 1*4 },
            { location: TerrainProgram.a_Color, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 4*4 },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 7*4, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        this.terrainInputLayout = renderCache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });

        this.textureMapping[0].gfxTexture = globals.modelCache.getTerrainTexture();
        this.textureMapping[0].gfxSampler = renderCache.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
        });

        this.textureMapping[1].gfxSampler = renderCache.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
        });
    }

    public getStaticModel(globals: Globals, path: string): StaticModel {
        if (this.staticModelCache.has(path))
            return this.staticModelCache.get(path)!;

        const nifData = globals.modelCache.getNIFData(path);
        const staticModel = new StaticModel(nifData);
        this.staticModelCache.set(path, staticModel);
        this.staticModelCache2.push(staticModel);
        return staticModel;
    }

    private prepareToRenderTerrain(globals: Globals, renderInstManager: GfxRenderInstManager): void {
        const template = renderInstManager.pushTemplate();
        template.setGfxProgram(this.terrainProgram);
        template.setMegaStateFlags({ cullMode: GfxCullMode.Back });

        const scratchAABB = new AABB();
        for (let i = 0; i < this.cell.length; i++) {
            const cell = this.cell[i];
            if (!cell.visible)
                continue;

            if (cell.terrain === null)
                continue;

            const x = cell.cell.gridX, y = cell.cell.gridY;
            mat4.identity(scratchMatrix);
            scratchMatrix[10] = 8;
            scratchMatrix[12] = x * 8192 + 4196;
            scratchMatrix[13] = y * 8192 + 4196;
            scratchAABB.transform(cell.terrain.aabb, scratchMatrix);
            if (!globals.view.frustum.contains(scratchAABB))
                continue;

            const renderInst = renderInstManager.newRenderInst();

            let offs = renderInst.allocateUniformBuffer(TerrainProgram.ub_ObjectParams, 12);
            const d = renderInst.mapUniformBufferF32(TerrainProgram.ub_ObjectParams);
            offs += fillMatrix4x3(d, offs, scratchMatrix);

            renderInst.setVertexInput(this.terrainInputLayout, cell.terrain.vertexBufferDescriptors, cell.terrain.indexBufferDescriptor);

            this.textureMapping[1].gfxTexture = cell.terrain.terrainMapTex;
            renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

            renderInst.setDrawCount(cell.terrain.indexCount);

            renderInstManager.submitRenderInst(renderInst);
        }
        renderInstManager.popTemplate();
    }

    private prepareToRenderStatic(globals: Globals, renderInstManager: GfxRenderInstManager): void {
        for (const staticModel of this.staticModelCache.values())
            staticModel.prepareToRender(globals, renderInstManager);
    }

    public prepareToRender(globals: Globals, renderInstManager: GfxRenderInstManager): void {
        for (let i = 0; i < this.cell.length; i++)
            this.cell[i].update(globals);

        this.prepareToRenderTerrain(globals, renderInstManager);
        this.prepareToRenderStatic(globals, renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.cell.length; i++)
            this.cell[i].destroy(device);
    }
}

class SkyManager {
    private atmosphere: NIFData;
    private clouds: NIFData;
    private night01: NIFData;

    constructor(globals: Globals) {
        this.atmosphere = globals.modelCache.getNIFData(`meshes\\sky_atmosphere.nif`);
        this.clouds = globals.modelCache.getNIFData(`meshes\\sky_clouds_01.nif`);
        this.night01 = globals.modelCache.getNIFData(`meshes\\sky_night_01.nif`);
    }

    public prepareToRender(globals: Globals, renderInstManager: GfxRenderInstManager): void {
        this.atmosphere.getTriShapes().forEach((v) => {
            colorCopy(v.emissiveColor, globals.weatherManager.current.skyColor);
        });

        renderInstManager.setCurrentList(globals.view.renderInstListSky);

        mat4.fromTranslation(scratchMatrix, globals.view.cameraPos);

        const template = renderInstManager.pushTemplate();
        template.setBindingLayouts(bindingLayoutsNifSingle);
        template.setInstanceCount(1);
        this.atmosphere.getTriShapes().forEach((triShape) => {
            triShape.prepareToRenderSingle(globals, renderInstManager, scratchMatrix);
        });
        renderInstManager.popTemplate();
    }
}

class Weather {
    public skyColor = colorNewCopy(White);
    public fogColor = colorNewCopy(White);
    public ambientColor = colorNewCopy(White);
    public sunColor = colorNewCopy(White);

    constructor(public name: string = "") {
    }

    public lerp(a: Weather, b: Weather, t: number): void {
        colorLerp(this.skyColor, a.skyColor, b.skyColor, t);
        colorLerp(this.fogColor, a.fogColor, b.fogColor, t);
        colorLerp(this.ambientColor, a.ambientColor, b.ambientColor, t);
        colorLerp(this.sunColor, a.sunColor, b.sunColor, t);
    }
}

class WeatherManager {
    private weatherSetting: Weather[][] = [];

    // Start times of each
    public hourSunrise = 6;
    public hourDay = 8;
    public hourSunset = 18;
    public hourNight = 20;

    private schedule: [number, number][] = [];

    public current = new Weather();
    public sunDirection = vec3.create();
    public weatherIdx = 0;

    constructor() {
        this.schedule = [
            [this.hourSunrise, 3],
            [(this.hourSunrise + this.hourDay) / 2, 0],
            [this.hourDay, 1],
            [this.hourSunset, 1],
            [(this.hourSunset + this.hourNight) / 2, 2],
            [this.hourNight, 3],
        ];

        this.weatherSetting[0] = nArray(4, () => new Weather('Clear'));
        colorFromRGBA8(this.weatherSetting[0][0].skyColor, 0x758DA4FF);
        colorFromRGBA8(this.weatherSetting[0][1].skyColor, 0x5F87CBFF);
        colorFromRGBA8(this.weatherSetting[0][2].skyColor, 0x385981FF);
        colorFromRGBA8(this.weatherSetting[0][3].skyColor, 0x090A0BFF);
        colorFromRGBA8(this.weatherSetting[0][0].fogColor, 0xFFBD9DFF);
        colorFromRGBA8(this.weatherSetting[0][1].fogColor, 0xCEE3FFFF);
        colorFromRGBA8(this.weatherSetting[0][2].fogColor, 0xFFBD9DFF);
        colorFromRGBA8(this.weatherSetting[0][3].fogColor, 0x090A0BFF);
        colorFromRGBA8(this.weatherSetting[0][0].ambientColor, 0x2F4260FF);
        colorFromRGBA8(this.weatherSetting[0][1].ambientColor, 0x898CA0FF);
        colorFromRGBA8(this.weatherSetting[0][2].ambientColor, 0x444B60FF);
        colorFromRGBA8(this.weatherSetting[0][3].ambientColor, 0x20232AFF);
        colorFromRGBA8(this.weatherSetting[0][0].sunColor, 0xF29F77FF);
        colorFromRGBA8(this.weatherSetting[0][1].sunColor, 0xFFFCEEFF);
        colorFromRGBA8(this.weatherSetting[0][2].sunColor, 0xFF724FFF);
        colorFromRGBA8(this.weatherSetting[0][3].sunColor, 0x3B61B0FF);
        this.weatherSetting[1] = nArray(4, () => new Weather('Cloudy'));
        colorFromRGBA8(this.weatherSetting[1][0].skyColor, 0x7E9EADFF);
        colorFromRGBA8(this.weatherSetting[1][1].skyColor, 0x75A0D7FF);
        colorFromRGBA8(this.weatherSetting[1][2].skyColor, 0x6F729FFF);
        colorFromRGBA8(this.weatherSetting[1][3].skyColor, 0x090A0BFF);
        colorFromRGBA8(this.weatherSetting[1][0].fogColor, 0xFFCF95FF);
        colorFromRGBA8(this.weatherSetting[1][1].fogColor, 0xF5EBE0FF);
        colorFromRGBA8(this.weatherSetting[1][2].fogColor, 0xFF9B6AFF);
        colorFromRGBA8(this.weatherSetting[1][3].fogColor, 0x090A0BFF);
        colorFromRGBA8(this.weatherSetting[1][0].ambientColor, 0x424A57FF);
        colorFromRGBA8(this.weatherSetting[1][1].ambientColor, 0x8991A0FF);
        colorFromRGBA8(this.weatherSetting[1][2].ambientColor, 0x47505CFF);
        colorFromRGBA8(this.weatherSetting[1][3].ambientColor, 0x202736FF);
        colorFromRGBA8(this.weatherSetting[1][0].sunColor, 0xF1B163FF);
        colorFromRGBA8(this.weatherSetting[1][1].sunColor, 0xFFECDDFF);
        colorFromRGBA8(this.weatherSetting[1][2].sunColor, 0xFF5900FF);
        colorFromRGBA8(this.weatherSetting[1][3].sunColor, 0x4D5B7CFF);
        this.weatherSetting[2] = nArray(4, () => new Weather('Foggy'));
        colorFromRGBA8(this.weatherSetting[2][0].skyColor, 0xC5BEB4FF);
        colorFromRGBA8(this.weatherSetting[2][1].skyColor, 0xB8D3E4FF);
        colorFromRGBA8(this.weatherSetting[2][2].skyColor, 0x8E9FB0FF);
        colorFromRGBA8(this.weatherSetting[2][3].skyColor, 0x12171CFF);
        colorFromRGBA8(this.weatherSetting[2][0].fogColor, 0xADA494FF);
        colorFromRGBA8(this.weatherSetting[2][1].fogColor, 0x96BBD1FF);
        colorFromRGBA8(this.weatherSetting[2][2].fogColor, 0x71879DFF);
        colorFromRGBA8(this.weatherSetting[2][3].fogColor, 0x13181DFF);
        colorFromRGBA8(this.weatherSetting[2][0].ambientColor, 0x302B25FF);
        colorFromRGBA8(this.weatherSetting[2][1].ambientColor, 0x5C6D78FF);
        colorFromRGBA8(this.weatherSetting[2][2].ambientColor, 0x1D354CFF);
        colorFromRGBA8(this.weatherSetting[2][3].ambientColor, 0x1C2127FF);
        colorFromRGBA8(this.weatherSetting[2][0].sunColor, 0xB1A289FF);
        colorFromRGBA8(this.weatherSetting[2][1].sunColor, 0x6F8397FF);
        colorFromRGBA8(this.weatherSetting[2][2].sunColor, 0x7D9DBDFF);
        colorFromRGBA8(this.weatherSetting[2][3].sunColor, 0x516477FF);
        this.weatherSetting[3] = nArray(4, () => new Weather('Thunderstorm'));
        colorFromRGBA8(this.weatherSetting[3][0].skyColor, 0x232427FF);
        colorFromRGBA8(this.weatherSetting[3][1].skyColor, 0x616873FF);
        colorFromRGBA8(this.weatherSetting[3][2].skyColor, 0x232427FF);
        colorFromRGBA8(this.weatherSetting[3][3].skyColor, 0x131416FF);
        colorFromRGBA8(this.weatherSetting[3][0].fogColor, 0x464A55FF);
        colorFromRGBA8(this.weatherSetting[3][1].fogColor, 0x616873FF);
        colorFromRGBA8(this.weatherSetting[3][2].fogColor, 0x464A55FF);
        colorFromRGBA8(this.weatherSetting[3][3].fogColor, 0x131416FF);
        colorFromRGBA8(this.weatherSetting[3][0].ambientColor, 0x363636FF);
        colorFromRGBA8(this.weatherSetting[3][1].ambientColor, 0x5A5A5AFF);
        colorFromRGBA8(this.weatherSetting[3][2].ambientColor, 0x363636FF);
        colorFromRGBA8(this.weatherSetting[3][3].ambientColor, 0x313336FF);
        colorFromRGBA8(this.weatherSetting[3][0].sunColor, 0x5B637AFF);
        colorFromRGBA8(this.weatherSetting[3][1].sunColor, 0x8A909BFF);
        colorFromRGBA8(this.weatherSetting[3][2].sunColor, 0x606575FF);
        colorFromRGBA8(this.weatherSetting[3][3].sunColor, 0x374C6EFF);
        this.weatherSetting[4] = nArray(4, () => new Weather('Rain'));
        colorFromRGBA8(this.weatherSetting[4][0].skyColor, 0x474A4BFF);
        colorFromRGBA8(this.weatherSetting[4][1].skyColor, 0x74787AFF);
        colorFromRGBA8(this.weatherSetting[4][2].skyColor, 0x494949FF);
        colorFromRGBA8(this.weatherSetting[4][3].skyColor, 0x18191AFF);
        colorFromRGBA8(this.weatherSetting[4][0].fogColor, 0x474A4BFF);
        colorFromRGBA8(this.weatherSetting[4][1].fogColor, 0x74787AFF);
        colorFromRGBA8(this.weatherSetting[4][2].fogColor, 0x494949FF);
        colorFromRGBA8(this.weatherSetting[4][3].fogColor, 0x18191AFF);
        colorFromRGBA8(this.weatherSetting[4][0].ambientColor, 0x615A58FF);
        colorFromRGBA8(this.weatherSetting[4][1].ambientColor, 0x696E71FF);
        colorFromRGBA8(this.weatherSetting[4][2].ambientColor, 0x586161FF);
        colorFromRGBA8(this.weatherSetting[4][3].ambientColor, 0x323743FF);
        colorFromRGBA8(this.weatherSetting[4][0].sunColor, 0x837A78FF);
        colorFromRGBA8(this.weatherSetting[4][1].sunColor, 0x959DAAFF);
        colorFromRGBA8(this.weatherSetting[4][2].sunColor, 0x787E83FF);
        colorFromRGBA8(this.weatherSetting[4][3].sunColor, 0x323E65FF);
        this.weatherSetting[5] = nArray(4, () => new Weather('Overcast'));
        colorFromRGBA8(this.weatherSetting[5][0].skyColor, 0x5B636AFF);
        colorFromRGBA8(this.weatherSetting[5][1].skyColor, 0x8F9295FF);
        colorFromRGBA8(this.weatherSetting[5][2].skyColor, 0x6C7379FF);
        colorFromRGBA8(this.weatherSetting[5][3].skyColor, 0x131619FF);
        colorFromRGBA8(this.weatherSetting[5][0].fogColor, 0x5B636AFF);
        colorFromRGBA8(this.weatherSetting[5][1].fogColor, 0x8F9295FF);
        colorFromRGBA8(this.weatherSetting[5][2].fogColor, 0x6C7379FF);
        colorFromRGBA8(this.weatherSetting[5][3].fogColor, 0x131619FF);
        colorFromRGBA8(this.weatherSetting[5][0].ambientColor, 0x54585CFF);
        colorFromRGBA8(this.weatherSetting[5][1].ambientColor, 0x5D6069FF);
        colorFromRGBA8(this.weatherSetting[5][2].ambientColor, 0x534D4BFF);
        colorFromRGBA8(this.weatherSetting[5][3].ambientColor, 0x393C42FF);
        colorFromRGBA8(this.weatherSetting[5][0].sunColor, 0x577DA3FF);
        colorFromRGBA8(this.weatherSetting[5][1].sunColor, 0xA3A9B7FF);
        colorFromRGBA8(this.weatherSetting[5][2].sunColor, 0x55679DFF);
        colorFromRGBA8(this.weatherSetting[5][3].sunColor, 0x203664FF);
        this.weatherSetting[6] = nArray(4, () => new Weather('Snow'));
        colorFromRGBA8(this.weatherSetting[6][0].skyColor, 0x6A5B5BFF);
        colorFromRGBA8(this.weatherSetting[6][1].skyColor, 0x999EA6FF);
        colorFromRGBA8(this.weatherSetting[6][2].skyColor, 0x607386FF);
        colorFromRGBA8(this.weatherSetting[6][3].skyColor, 0x1F2327FF);
        colorFromRGBA8(this.weatherSetting[6][0].fogColor, 0x6A5B5BFF);
        colorFromRGBA8(this.weatherSetting[6][1].fogColor, 0x999EA6FF);
        colorFromRGBA8(this.weatherSetting[6][2].fogColor, 0x607386FF);
        colorFromRGBA8(this.weatherSetting[6][3].fogColor, 0x1F2327FF);
        colorFromRGBA8(this.weatherSetting[6][0].ambientColor, 0x5C5454FF);
        colorFromRGBA8(this.weatherSetting[6][1].ambientColor, 0x5D6069FF);
        colorFromRGBA8(this.weatherSetting[6][2].ambientColor, 0x464F57FF);
        colorFromRGBA8(this.weatherSetting[6][3].ambientColor, 0x313A44FF);
        colorFromRGBA8(this.weatherSetting[6][0].sunColor, 0x8D6D6DFF);
        colorFromRGBA8(this.weatherSetting[6][1].sunColor, 0xA3A9B7FF);
        colorFromRGBA8(this.weatherSetting[6][2].sunColor, 0x65798DFF);
        colorFromRGBA8(this.weatherSetting[6][3].sunColor, 0x37424DFF);
        this.weatherSetting[7] = nArray(4, () => new Weather('Blizzard'));
        colorFromRGBA8(this.weatherSetting[7][0].skyColor, 0x5B636AFF);
        colorFromRGBA8(this.weatherSetting[7][1].skyColor, 0x798591FF);
        colorFromRGBA8(this.weatherSetting[7][2].skyColor, 0x6C7379FF);
        colorFromRGBA8(this.weatherSetting[7][3].skyColor, 0x1B1D1FFF);
        colorFromRGBA8(this.weatherSetting[7][0].fogColor, 0x5B636AFF);
        colorFromRGBA8(this.weatherSetting[7][1].fogColor, 0x798591FF);
        colorFromRGBA8(this.weatherSetting[7][2].fogColor, 0x6C7379FF);
        colorFromRGBA8(this.weatherSetting[7][3].fogColor, 0x15181CFF);
        colorFromRGBA8(this.weatherSetting[7][0].ambientColor, 0x54585CFF);
        colorFromRGBA8(this.weatherSetting[7][1].ambientColor, 0x5D6069FF);
        colorFromRGBA8(this.weatherSetting[7][2].ambientColor, 0x534D4BFF);
        colorFromRGBA8(this.weatherSetting[7][3].ambientColor, 0x353E46FF);
        colorFromRGBA8(this.weatherSetting[7][0].sunColor, 0x728092FF);
        colorFromRGBA8(this.weatherSetting[7][1].sunColor, 0xA3A9B7FF);
        colorFromRGBA8(this.weatherSetting[7][2].sunColor, 0x6A7288FF);
        colorFromRGBA8(this.weatherSetting[7][3].sunColor, 0x39424AFF);
    }

    private updateSunDirection(globals: Globals): void {
        let hourFromSunrise = globals.time - this.hourSunrise; // relative to sunrise
        if (hourFromSunrise < 0)
            hourFromSunrise += 24;

        const dayDuration = this.hourNight - this.hourSunrise;
        const nightDuration = 24 - dayDuration;
        const isNight = hourFromSunrise >= dayDuration;

        let orbit: number;
        if (isNight) {
            const t = (hourFromSunrise - dayDuration) / nightDuration;
            orbit = -(1 - t * 2);
        } else {
            const t = hourFromSunrise / dayDuration;
            orbit = 1 - t * 2;
        }

        this.sunDirection[0] = -400.0 * orbit;
        this.sunDirection[1] = 75.0;
        this.sunDirection[2] = -100.0;

        vec3.normalize(this.sunDirection, this.sunDirection);
        vec3.negate(this.sunDirection, this.sunDirection);
    }

    public update(globals: Globals): void {
        this.updateSunDirection(globals);

        const setting = this.weatherSetting[this.weatherIdx];

        for (let i = 0; i < this.schedule.length; i++) {
            const i0 = i, i1 = (i + 1) % this.schedule.length;
            let [h0, si0] = this.schedule[i0];
            let [h1, si1] = this.schedule[i1];

            let hour = globals.time % 24;
            if (h1 < h0) {
                h1 += 24;
                if (hour < h0)
                    hour += 24;
            }

            if (hour >= h0 && hour < h1) {
                const t = invlerp(h0, h1, hour);
                const s0 = setting[si0];
                const s1 = setting[si1];
                this.current.lerp(s0, s1, t);
                break;
            }
        }
    }
}

export class MorrowindRenderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private worldManager: WorldManager;
    private skyManager: SkyManager;

    constructor(context: SceneContext, private globals: Globals) {
        this.renderHelper = new GfxRenderHelper(context.device, context, this.globals.modelCache.renderCache);
        this.worldManager = new WorldManager(this.globals);
        this.skyManager = new SkyManager(this.globals);
    }

    private prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const globals = this.globals;

        globals.time += globals.timeAdv * (viewerInput.deltaTime / 1000 * 30);

        globals.weatherManager.update(globals);
        globals.view.setupFromCamera(viewerInput.camera);

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayoutsTerrain);

        let offs = template.allocateUniformBuffer(TerrainProgram.ub_SceneParams, 28);
        const d = template.mapUniformBufferF32(TerrainProgram.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, globals.view.clipFromWorldMatrix);
        offs += fillVec3v(d, offs, globals.weatherManager.sunDirection);
        offs += fillColor(d, offs, globals.weatherManager.current.sunColor);
        offs += fillColor(d, offs, globals.weatherManager.current.ambientColor);

        const renderInstManager = this.renderHelper.renderInstManager;
        this.skyManager.prepareToRender(globals, renderInstManager);

        this.renderHelper.renderInstManager.setCurrentList(globals.view.renderInstListOpa);
        this.worldManager.prepareToRender(globals, renderInstManager);

        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const renderPassDescriptor = makeAttachmentClearDescriptor(this.globals.weatherManager.current.fogColor);

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, renderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, renderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                this.globals.view.renderInstListSky.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.globals.view.renderInstListOpa.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
                this.globals.view.renderInstListXlu.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.globals.view.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.worldManager.destroy(device);
    }
}
