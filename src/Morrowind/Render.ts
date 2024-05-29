
import { mat4, vec3 } from "gl-matrix";
import { Camera } from "../Camera.js";
import * as DDS from "../DarkSouls/dds.js";
import { NamedArrayBufferSlice } from "../DataFetcher.js";
import { AABB, Frustum } from "../Geometry.js";
import { getMatrixTranslation, transformVec3Mat4w1 } from "../MathHelpers.js";
import { DeviceProgram } from "../Program.js";
import { SceneContext } from "../SceneBase.js";
import { TextureMapping } from "../TextureHolder.js";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { fillMatrix4x3, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBindingLayoutDescriptor, GfxBuffer, GfxBufferUsage, GfxClipSpaceNearZ, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMipFilterMode, GfxProgram, GfxSamplerFormatKind, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { arrayRemove, assert, assertExists, nArray } from "../util.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { BSA } from "./BSA.js";
import { CELL, ESM, FRMR, LAND } from "./ESM.js";
import { NIF, NIFData } from "./NIFBase.js";

const noclipSpaceFromMorrowindSpace = mat4.fromValues(
    -1, 0, 0, 0,
    0,  0, 1, 0,
    0,  1, 0, 0,
    0,  0, 0, 1,
);

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
    public view = new View();

    constructor(public device: GfxDevice, public pluginData: PluginData) {
        this.modelCache = new ModelCache(device, pluginData);
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

        this.aabb.minX = this.aabb.minY = -4096;
        this.aabb.maxX = this.aabb.maxY = 4096;

        let rowStart = land.heightOffset;
        for (let y = 0; y < land.sideLen; y++) {
            let height = rowStart;
            for (let x = 0; x < land.sideLen; x++) {
                const idx = y * land.sideLen + x;
                height += land.heightGradientData[idx];
                if (x === 0)
                    rowStart = height;

                vertexData[idx*7 + 0] = height;

                this.aabb.minZ = Math.min(this.aabb.minZ, height);
                this.aabb.maxZ = Math.max(this.aabb.maxZ, height);

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
            { buffer: this.vertexBuffer, byteOffset: 0 },
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
                const i1 = y1*land.sideLen + x0;
                const i2 = y0*land.sideLen + x1;
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
        this.indexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0 };
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

class StaticModel {
    public visible = true;
    public instances: Static[] = [];

    constructor(public nifData: NIFData) {
    }

    public prepareToRender(globals: Globals, renderInstManager: GfxRenderInstManager): void {
        if (!this.visible)
            return;

        // Gather all visible instances.
        const template = renderInstManager.getTemplateRenderInst();

        const maxInstances = this.nifData.getMaxInstances();

        let offs = 0;
        let numInstances = 0;

        const fillInstance = (instance: Static) => {
            if (numInstances === 0)
                offs = template.allocateUniformBuffer(1, maxInstances * 16);

            const d = template.mapUniformBufferF32(1);
            offs += fillMatrix4x3(d, offs, instance.modelMatrix);
            if (++numInstances == maxInstances)
                submitDraws();
        };

        const submitDraws = () => {
            if (numInstances === 0)
                return;
            template.setInstanceCount(numInstances);
            this.nifData.prepareToRender(globals, renderInstManager);
            numInstances = 0;
        };

        for (let i = 0; i < this.instances.length; i++) {
            const instance = this.instances[i];
            if (!instance.checkFrustum(globals))
                continue;
            fillInstance(instance);
        }
        submitDraws();
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
            if (stat !== undefined)
                this.static.push(new Static(worldManager, globals, frmr, stat));
        }
    }

    private isInDistanceRange(globals: Globals): boolean {
        const cellX = this.cell.gridX * 8192 + 4096;
        const cellY = this.cell.gridY * 8192 + 4096;

        const camX = globals.view.cameraPos[0];
        const camY = globals.view.cameraPos[1];

        const dx = cellX - camX;
        const dy = cellY - camY;
        const sqd = dx*dx + dy*dy;
        return sqd <= (8192*6)**2;
    }
    
    public update(globals: Globals): void {
        this.setRegistered(this.isInDistanceRange(globals));
    }

    private setRegistered(v: boolean): void {
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
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, }, // TODO(jstpierre): Integer texture for the map lookup?
    ] },
];

const bindingLayoutsStatic: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 8 },
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

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
};

layout(std140) uniform ub_ObjectParams {
    Mat4x3 u_WorldFromLocal;
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
    vec3 t_PositionWorld = Mul(u_WorldFromLocal, vec4(x, y, z, 1.0));

    gl_Position = Mul(u_ClipFromWorld, vec4(t_PositionWorld, 1.0));
    v_Color = a_Color;

    vec3 t_SunDirection = normalize(vec3(.2, .5, 1));
    // https://github.com/OpenMW/openmw/blob/master/files/openmw.cfg
    vec3 t_SunAmbient = vec3(137, 140, 160) / 255.0;
    vec3 t_SunDiffuse = vec3(255, 252, 238) / 255.0;
    v_Color *= dot(a_Normal, t_SunDirection) * t_SunDiffuse + t_SunAmbient;
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

    // XXX(jstpierre): This doesn't blend across chunk boundaries, need a dynamic terrain system
    if (t_Frac.x > 0.5 && t_TexCoordI.x < 15)
        t_Terrain = mix(t_Terrain, SampleTerrain(t_TexCoord, ivec2(1, 0)), t_Frac.x - 0.5);
    else if (t_TexCoordI.x > 0)
        t_Terrain = mix(t_Terrain, SampleTerrain(t_TexCoord, ivec2(-1, 0)), 0.5 - t_Frac.x);

    if (t_Frac.y > 0.5 && t_TexCoordI.y < 15)
        t_Terrain = mix(t_Terrain, SampleTerrain(t_TexCoord, ivec2(0, 1)), t_Frac.y - 0.5);
    else if (t_TexCoordI.y > 0)
        t_Terrain = mix(t_Terrain, SampleTerrain(t_TexCoord, ivec2(0, -1)), 0.5 - t_Frac.y);

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

        this.textureMapping[1].gfxSampler = this.textureMapping[0].gfxSampler; // doesn't matter, only use texelFetch
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
        const template = renderInstManager.pushTemplateRenderInst();
        template.setGfxProgram(this.terrainProgram);

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

            let offs = renderInst.allocateUniformBuffer(TerrainProgram.ub_ObjectParams, 16);
            const d = renderInst.mapUniformBufferF32(TerrainProgram.ub_ObjectParams);
            offs += fillMatrix4x3(d, offs, scratchMatrix);

            renderInst.setVertexInput(this.terrainInputLayout, cell.terrain.vertexBufferDescriptors, cell.terrain.indexBufferDescriptor);

            this.textureMapping[1].gfxTexture = cell.terrain.terrainMapTex;
            renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

            renderInst.setDrawCount(cell.terrain.indexCount);

            renderInstManager.submitRenderInst(renderInst);
        }
        renderInstManager.popTemplateRenderInst();
    }

    private prepareToRenderStatic(globals: Globals, renderInstManager: GfxRenderInstManager): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayoutsStatic);

        for (const staticModel of this.staticModelCache.values())
            staticModel.prepareToRender(globals, renderInstManager);

        renderInstManager.popTemplateRenderInst();
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

export class MorrowindRenderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private worldManager: WorldManager;
    private renderInstListMain = new GfxRenderInstList();

    constructor(context: SceneContext, private globals: Globals) {
        this.renderHelper = new GfxRenderHelper(context.device, context, this.globals.modelCache.renderCache);
        this.worldManager = new WorldManager(this.globals);
    }

    private prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const globals = this.globals;
        globals.view.setupFromCamera(viewerInput.camera);

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayoutsTerrain);

        let offs = template.allocateUniformBuffer(TerrainProgram.ub_SceneParams, 16);
        const mapped = template.mapUniformBufferF32(TerrainProgram.ub_SceneParams);

        offs += fillMatrix4x4(mapped, offs, globals.view.clipFromWorldMatrix);

        this.renderHelper.renderInstManager.setCurrentRenderInstList(this.renderInstListMain);

        this.worldManager.prepareToRender(this.globals, this.renderHelper.renderInstManager);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.worldManager.destroy(device);
    }
}
