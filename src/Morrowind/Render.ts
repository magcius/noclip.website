
import { mat4 } from "gl-matrix";
import * as DDS from "../DarkSouls/dds.js";
import { NamedArrayBufferSlice } from "../DataFetcher.js";
import { DeviceProgram } from "../Program.js";
import { SceneContext } from "../SceneBase.js";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { GfxBindingLayoutDescriptor, GfxBuffer, GfxBufferUsage, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxProgram, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInst, GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { assert, assertExists } from "../util.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { BSA } from "./BSA.js";
import { CELL, ESM, LAND } from "./ESM.js";
import { fillMatrix4x3, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { computeModelMatrixT } from "../MathHelpers.js";

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
    private textureCache = new Map<string, GfxTexture>();

    constructor(public device: GfxDevice, private pluginData: PluginData) {
        this.renderCache = new GfxRenderCache(this.device);
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

    public destroy(device: GfxDevice): void {
        for (const texture of this.textureCache.values())
            device.destroyTexture(texture);
        if (this.terrainTexture !== null)
            this.terrainTexture.destroy(device);
        this.renderCache.destroy();
    }
}

export class RenderGlobals {
    public modelCache: ModelCache;
    public terrainIndexBuffer: GfxBuffer;

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
        const depth = ltex.size;

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
        for (const tex of ltex.values())
            insertDDS(tex.index, tex.filename);

        device.uploadTextureData(this.texture, 0, levelDatas);
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.texture);
    }
}

class CellTerrain {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;
    public indexCount = 0;

    constructor(globals: RenderGlobals, land: LAND) {
        assert(land.heightGradientData !== null);

        const size = 8192;
        const vertexCount = land.sideLen * land.sideLen;
        const vertexSizeInFloats = 3 + 3 + 3; // position, normal, color
        const vertexData = new Float32Array(vertexCount * vertexSizeInFloats);

        let rowStart = land.heightOffset;
        for (let y = 0; y < land.sideLen; y++) {
            let height = rowStart;
            for (let x = 0; x < land.sideLen; x++) {
                const idx = y * land.sideLen + x;
                height += land.heightGradientData[idx];
                if (x === 0)
                    rowStart = height;

                const px = (x / (land.sideLen - 1) - 0.5) * size;
                const py = (y / (land.sideLen - 1) - 0.5) * size;
                const pz = height * 8;
                vertexData[idx*9 + 0] = px;
                vertexData[idx*9 + 1] = py;
                vertexData[idx*9 + 2] = pz;

                let nx = 0, ny = 0, nz = 1;
                if (land.heightNormalData !== null) {
                    nx = (land.heightNormalData[idx*3 + 0] / 0x7F) - 1.0;
                    ny = (land.heightNormalData[idx*3 + 1] / 0x7F) - 1.0;
                    nz = (land.heightNormalData[idx*3 + 2] / 0x7F) - 1.0;
                }
                vertexData[idx*9 + 3] = nx;
                vertexData[idx*9 + 4] = ny;
                vertexData[idx*9 + 5] = nz;

                let cr = 1, cg = 1, cb = 1;
                if (land.heightColorData !== null) {
                    cr = (land.heightColorData[idx*3 + 0]) / 255;
                    cg = (land.heightColorData[idx*3 + 1]) / 255;
                    cb = (land.heightColorData[idx*3 + 2]) / 255;
                }
                vertexData[idx*9 + 6] = cr;
                vertexData[idx*9 + 7] = cg;
                vertexData[idx*9 + 8] = cb;
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

        /*
        if (land.heightTexIdxData !== null) {
            for (const ltexID of land.heightTexIdxData) {
                const filename = ltexID === 0 ? `textures\\_land_default.dds` : globals.pluginData.esm.ltex.get(ltexID - 1)!.filename;
                const texture = globals.modelCache.getTexture(filename);
                this.texture.push(texture);
                assert(texture.width === 256 && texture.height === 256);
            }
        }
        */
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

class CellData {
    public terrain: CellTerrain | null = null;

    constructor(globals: RenderGlobals, public cell: CELL) {
        if (cell.land !== null && cell.land.heightGradientData !== null)
            this.terrain = new CellTerrain(globals, cell.land);
    }

    public destroy(device: GfxDevice): void {
        if (this.terrain !== null)
            this.terrain.destroy(device);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 0 },
];

class TerrainProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Color = 2;

    public override both = `
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
};

layout(std140) uniform ub_ObjectParams {
    Mat4x3 u_WorldFromLocal;
};
`;
    public override vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec3 a_Color;

out vec3 v_Color;

void main() {
    vec3 t_PositionWorld = Mul(u_WorldFromLocal, vec4(a_Position, 1.0));
    gl_Position = Mul(u_ClipFromWorld, vec4(t_PositionWorld, 1.0));
    v_Color = a_Color;
}
`;

    public override frag = `
in vec3 v_Color;

void main() {
    gl_FragColor = vec4(v_Color, 1.0);
}
`;
}

const scratchMatrix = mat4.create();
class WorldManager {
    public cell: CellData[] = [];
    private terrainProgram: GfxProgram;
    private terrainInputLayout: GfxInputLayout;

    constructor(globals: RenderGlobals) {
        for (let i = 0; i < globals.pluginData.esm.cell.length; i++) {
            const cell = globals.pluginData.esm.cell[i];
            if (cell.interior)
                continue; // skip

            this.cell.push(new CellData(globals, cell));
        }

        const renderCache = globals.modelCache.renderCache;
        this.terrainProgram = renderCache.createProgram(new TerrainProgram());

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: TerrainProgram.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0*4 },
            { location: TerrainProgram.a_Normal, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 3*4 },
            { location: TerrainProgram.a_Color, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 6*4 },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 9*4, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        this.terrainInputLayout = renderCache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });
    }

    public prepareToRender(globals: RenderGlobals, renderInstManager: GfxRenderInstManager): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setGfxProgram(this.terrainProgram);

        for (let i = 0; i < this.cell.length; i++) {
            const cell = this.cell[i];
            if (cell.terrain === null)
                continue;

            const x = cell.cell.gridX, y = cell.cell.gridY;
            computeModelMatrixT(scratchMatrix, x * 8192, y * 8192, 0);

            const renderInst = renderInstManager.newRenderInst();

            let offs = renderInst.allocateUniformBuffer(TerrainProgram.ub_ObjectParams, 16);
            const d = renderInst.mapUniformBufferF32(TerrainProgram.ub_ObjectParams);
            offs += fillMatrix4x3(d, offs, scratchMatrix);

            renderInst.setVertexInput(this.terrainInputLayout, cell.terrain.vertexBufferDescriptors, cell.terrain.indexBufferDescriptor);
            renderInst.setDrawCount(cell.terrain.indexCount);

            renderInstManager.submitRenderInst(renderInst);
        }
        renderInstManager.popTemplateRenderInst();
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

    constructor(context: SceneContext, private renderGlobals: RenderGlobals) {
        this.renderHelper = new GfxRenderHelper(context.device, context, this.renderGlobals.modelCache.renderCache);
        this.worldManager = new WorldManager(this.renderGlobals);
    }

    private prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(TerrainProgram.ub_SceneParams, 16);
        const mapped = template.mapUniformBufferF32(TerrainProgram.ub_SceneParams);

        mat4.mul(scratchMatrix, viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix);
        offs += fillMatrix4x4(mapped, offs, scratchMatrix);

        this.renderHelper.renderInstManager.setCurrentRenderInstList(this.renderInstListMain);

        this.worldManager.prepareToRender(this.renderGlobals, this.renderHelper.renderInstManager);

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
