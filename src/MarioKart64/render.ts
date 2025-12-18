import * as Viewer from '../viewer.js';
import * as RDP from '../Common/N64/RDP.js';

import { DeviceProgram } from "../Program.js";
import { RSP_Geometry, translateCullMode } from "../BanjoKazooie/f3dex.js";
import { GfxDevice, GfxFormat, GfxTexture, GfxSampler, GfxBuffer, GfxBufferUsage, GfxInputLayout, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxMegaStateDescriptor, GfxProgram, GfxBufferFrequencyHint, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from "../gfx/platform/GfxPlatform.js";
import { nArray } from '../util.js';
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2, fillVec4, fillColor, fillVec3v } from '../gfx/helpers/UniformBufferHelpers.js';
import { mat4, vec3, ReadonlyMat4 } from 'gl-matrix';
import { computeViewMatrix } from '../Camera.js';
import { TextureMapping } from '../TextureHolder.js';
import { GfxRenderInstManager, GfxRendererLayer, makeSortKeyOpaque, makeSortKey } from '../gfx/render/GfxRenderInstManager.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { Vec3Zero, Vec3UnitY, calcBillboardMatrix, CalcBillboardFlags, Mat4Identity, getMatrixAxisY, transformVec3Mat4w0 } from '../MathHelpers.js';
import { calcTextureMatrixFromRSPState } from '../Common/N64/RSP.js';
import { F3DEX_Program } from '../BanjoKazooie/render.js';
import { MkDrawCall, MkRSPOutput, MkRSPState, Light1 } from './f3dex.js';
import { reverseDepthForDepthOffset } from '../gfx/helpers/ReversedDepthHelpers.js';
import { Color, colorNewCopy, White } from '../Color.js';
import { makeVertexBufferData } from '../Glover/render.js';
import { IS_WIREFRAME } from './courses.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';
import { createBufferFromData } from '../gfx/helpers/BufferHelpers.js';
import { gfxDeviceNeedsFlipY } from '../gfx/helpers/GfxDeviceHelpers.js';

const viewMtxScratch = mat4.create();
const modelViewScratch = mat4.create();
const texMtxScratch = mat4.create();

export enum Mk64RenderLayer {
    Opa = 0,

    Xlu = 1,
    ItemBoxes = 2,
    Water = 3,
    Smoke = 3,
}

class Mk64SkyProgram extends DeviceProgram {
    public static ub_Params = 0;

    public override both: string = `
${GfxShaderLibrary.saturate}

layout(std140) uniform ub_Params {
    vec4 u_SkyColorTop;
    vec4 u_SkyColorBottom;
};
`;

    public override vert = GfxShaderLibrary.makeFullscreenVS(`-1`, `1`);

    public override frag: string = `

in vec2 v_TexCoord;

void main() {
    float y = v_TexCoord.y;
    float t_HalfScreenHeight = 0.5;

    if (y >= t_HalfScreenHeight) {
        float t = saturate((y - t_HalfScreenHeight) / t_HalfScreenHeight);
        gl_FragColor = vec4(mix(u_SkyColorBottom.rgb, u_SkyColorTop.rgb, t), 1.0);
    } else {
        gl_FragColor = u_SkyColorBottom;
    }
}
`;
}

const skyBindingLayouts: GfxBindingLayoutDescriptor[] = [{numUniformBuffers: 1, numSamplers: 0}];

export class Mk64SkyRenderer {
    private program = new Mk64SkyProgram();
    private gfxProgram: GfxProgram;

    constructor(renderCache: GfxRenderCache, public ColorTop: Color, public ColorBottom: Color) {
        this.gfxProgram = renderCache.createProgram(this.program);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setDrawCount(3);
        renderInst.sortKey = makeSortKeyOpaque(GfxRendererLayer.BACKGROUND, this.gfxProgram.ResourceUniqueId);
        renderInst.setVertexInput(null, null, null);
        renderInst.setBindingLayouts(skyBindingLayouts);
        renderInst.setGfxProgram(this.gfxProgram);

        const d = renderInst.allocateUniformBufferF32(Mk64SkyProgram.ub_Params, 8);
        let offs = 0;

        offs += fillColor(d, offs, this.ColorTop);
        offs += fillColor(d, offs, this.ColorBottom);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
    }
}

export class RenderData {
    public textures: GfxTexture[] = [];
    public samplers: GfxSampler[] = [];

    public vertexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public vertexBufferData: Float32Array;

    constructor(private renderCache: GfxRenderCache, drawCall: MkDrawCall, textureCache: RDP.TextureCache) {
        const textures = textureCache.textures;
        const device = renderCache.device;

        for (let i = 0; i < drawCall.textureIndices.length; i++) {
            const tex = textures[(drawCall.textureIndices[i] & 0xFFFFFF)];

            this.textures.push(RDP.translateToGfxTexture(device, tex));
            this.samplers.push(RDP.translateSampler(device, this.renderCache, tex));
        }

        this.vertexBufferData = makeVertexBufferData(drawCall.vertices);
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, this.vertexBufferData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: F3DEX_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 * 0x04, },
            { location: F3DEX_Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 4 * 0x04, },
            { location: F3DEX_Program.a_Color, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6 * 0x04, },
        ];

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 10 * 0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];

        this.inputLayout = this.renderCache.createInputLayout({
            indexBufferFormat: null,
            vertexBufferDescriptors,
            vertexAttributeDescriptors,
        });

        this.vertexBufferDescriptors = [
            { buffer: this.vertexBuffer, },
        ];
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textures.length; i++)
            device.destroyTexture(this.textures[i]);
        device.destroyBuffer(this.vertexBuffer);
    }
}

class DrawCallInstance {
    public renderData: RenderData;
    public textureEntry: RDP.Texture[] = [];
    public textureMappings = nArray(2, () => new TextureMapping());

    public primColor: Color = colorNewCopy(White);
    public envColor: Color = colorNewCopy(White);

    private fogEnabled = true;
    private vertexColorsEnabled = true;
    private texturesEnabled = true;
    private alphaVisualizerEnabled = false;

    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    public program!: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;

    private usesLighting = false;
    private usesFog = false;

    constructor(renderCache: GfxRenderCache, public drawCall: MkDrawCall, textureCache: RDP.TextureCache) {
        this.renderData = new RenderData(renderCache, drawCall, textureCache);

        for (let i = 0; i < this.textureMappings.length; i++) {
            if (i < drawCall.textureIndices.length) {
                let idx = drawCall.textureIndices[i] & 0xFFFFFF;

                if (((drawCall.textureIndices[i] >> 24) & 0xF) === 0xF) {
                    this.textureMappings[i].lateBinding = "framebuffer";
                }

                this.textureEntry[i] = textureCache.textures[idx];
                this.textureMappings[i].gfxTexture = this.renderData.textures[i];
                this.textureMappings[i].gfxSampler = this.renderData.samplers[i];
            }
        }

        this.usesLighting = (this.drawCall.SP_GeometryMode & RSP_Geometry.G_LIGHTING) !== 0;
        this.usesFog = (this.drawCall.SP_GeometryMode & RSP_Geometry.G_FOG) !== 0;

        this.megaStateFlags = RDP.translateRenderMode(drawCall.DP_OtherModeL);
        this.setBackfaceCullingEnabled(true);
        this.createProgram();
    }

    private createProgram(): void {

        const program = new F3DEX_Program(this.drawCall.DP_OtherModeH, this.drawCall.DP_OtherModeL, this.drawCall.DP_Combine, 0.5, [], this.usesLighting ? 1 : 0);
        program.defines.set('BONE_MATRIX_COUNT', '1');
        program.defines.set('EXTRA_COMBINE', '1');

        if (this.texturesEnabled && this.drawCall.textureIndices.length)
            program.defines.set('USE_TEXTURE', '1');

        if (this.vertexColorsEnabled && (this.drawCall.SP_GeometryMode & RSP_Geometry.G_SHADE) !== 0 && !this.usesLighting)
            program.defines.set('USE_VERTEX_COLOR', '1');

        if (this.fogEnabled && this.usesFog)
            program.defines.set('USE_FOG', '1');

        if (this.usesLighting) {
            program.defines.set('LIGHTING', '1');
            program.defines.set('PARAMETERIZED_LIGHTING', '1');
        }

        if (this.drawCall.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN)
            program.defines.set('TEXTURE_GEN', '1');

        if (this.alphaVisualizerEnabled)
            program.defines.set('USE_ALPHA_VISUALIZER', '1');

        this.program = program;
        this.gfxProgram = null;
    }

    //TODO: Instancing
    public prepareToRender(renderInstManager: GfxRenderInstManager, drawMatrix: ReadonlyMat4, isBillboard: boolean, isOrthographic: boolean): void {
        const device = renderInstManager.gfxRenderCache.device;

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setVertexInput(this.renderData.inputLayout, this.renderData.vertexBufferDescriptors, null);
        renderInst.setGfxProgram(this.gfxProgram);

        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.setDrawCount(this.drawCall.vertexCount);

        const drawUboSize = 12 * 2 + 8 * 2 + (this.usesLighting ? 4 * 3 : 0);

        let offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, drawUboSize);
        const mappedF32 = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);

        if (isOrthographic)
            mat4.copy(modelViewScratch, drawMatrix);
        else
            mat4.mul(modelViewScratch, viewMtxScratch, drawMatrix);

        if (isBillboard) {
            getMatrixAxisY(scratchVec3a, drawMatrix);
            vec3.normalize(scratchVec3a, scratchVec3a);
            calcBillboardMatrix(modelViewScratch, modelViewScratch, CalcBillboardFlags.UseRollLocal | CalcBillboardFlags.PriorityY | CalcBillboardFlags.UseZSphere, scratchVec3a);
        }

        offs += fillMatrix4x3(mappedF32, offs, modelViewScratch);

        this.computeTextureMatrix(texMtxScratch, 0);
        if (this.textureMappings[0].lateBinding && gfxDeviceNeedsFlipY(device)) {
            texMtxScratch[5] *= -1;
            texMtxScratch[13] += 1;
        }
        offs += fillMatrix4x2(mappedF32, offs, texMtxScratch);

        this.computeTextureMatrix(texMtxScratch, 1);
        offs += fillMatrix4x2(mappedF32, offs, texMtxScratch);

        if (this.usesLighting) {
            const light = this.drawCall.light;
            transformVec3Mat4w0(scratchVec3a, viewMtxScratch, light.direction);

            vec3.sub(scratchVec3b, light.diffuseColor, light.ambientColor);
            offs += fillVec3v(mappedF32, offs, scratchVec3b);
            offs += fillVec3v(mappedF32, offs, scratchVec3a);
            offs += fillVec3v(mappedF32, offs, light.ambientColor);
        }

        if (this.usesFog) {
            offs += fillVec4(mappedF32, offs, this.drawCall.fogNear, this.drawCall.fogFar);
            offs += fillColor(mappedF32, offs, this.drawCall.fogColor);
        }

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 4 * 3);
        const comb = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);
        offs += fillColor(comb, offs, this.primColor);
        offs += fillColor(comb, offs, this.envColor);
        offs += fillVec4(comb, offs, 0, 0, 0, IS_WIREFRAME ? 1 : 0);

        renderInstManager.submitRenderInst(renderInst);
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        const cullMode = v ? translateCullMode(this.drawCall.SP_GeometryMode) : GfxCullMode.None;
        this.megaStateFlags.cullMode = cullMode;
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.vertexColorsEnabled = v;
        this.createProgram();
    }

    public setTexturesEnabled(v: boolean): void {
        this.texturesEnabled = v;
        this.createProgram();
    }

    public setFogEnabled(v: boolean): void {
        this.fogEnabled = v;
        this.createProgram();
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        this.alphaVisualizerEnabled = v;
        this.createProgram();
    }

    private computeTextureMatrix(m: mat4, textureEntryIndex: number): void {
        if (this.textureEntry[textureEntryIndex] !== undefined) {
            const entry = this.textureEntry[textureEntryIndex];
            calcTextureMatrixFromRSPState(m, this.drawCall.SP_TextureState.s, this.drawCall.SP_TextureState.t, entry.width, entry.height, entry.tile.shifts, entry.tile.shiftt);

            let sOffset = - entry.tile.uls / 4;
            let tOffset = - entry.tile.ult / 4;

            m[12] += sOffset / entry.width;
            m[13] += tOffset / entry.height;
        } else {
            mat4.identity(m);
        }
    }

    public setTileSize(uls: number, ult: number, tile: number = 0) {
        if (this.textureEntry[tile] !== undefined) {
            const entry = this.textureEntry[tile];
            entry.tile.uls = uls;
            entry.tile.ult = ult;
        }
    }

    public setRenderMode(renderMode: Partial<GfxMegaStateDescriptor>): void {
        const cullMode = this.megaStateFlags.cullMode;

        this.megaStateFlags = renderMode;
        this.megaStateFlags.cullMode = cullMode;
    }

    public destroy(device: GfxDevice): void {
        if (this.renderData !== null) {
            this.renderData.destroy(device);
        }
    }
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const lookatScratch = vec3.create();
export class BasicRspRenderer {
    public drawCallInstances: DrawCallInstance[] = [];
    public computeLookAt = false;
    public visible = true;

    public isOrthographic = false;

    constructor(renderCache: GfxRenderCache, public rspOutput: MkRSPOutput | null, public isBillboard: boolean = false, public renderLayer: Mk64RenderLayer = 0) {
        if (rspOutput !== null) {
            for (const drawCall of rspOutput.drawCalls) {

                if (drawCall.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN) {
                    this.computeLookAt = true;
                }

                this.drawCallInstances.push(new DrawCallInstance(renderCache, drawCall, rspOutput.textureCache));
            }
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMtx: ReadonlyMat4 = Mat4Identity): void {
        if (!this.visible)
            return;

        const template = renderInstManager.pushTemplate();
        const layer = this.renderLayer >= Mk64RenderLayer.Xlu ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;

        template.sortKey = makeSortKey(layer + this.renderLayer);
        computeViewMatrix(viewMtxScratch, viewerInput.camera);

        if (this.computeLookAt) {
            //(M-1): UGHHHHHH! This should be per-draw.... only used for chain chomp

            mat4.getTranslation(lookatScratch, modelMtx);
            vec3.transformMat4(lookatScratch, lookatScratch, viewMtxScratch);
            mat4.lookAt(modelViewScratch, Vec3Zero, lookatScratch, Vec3UnitY);

            let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16 + 8);
            const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
            offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);
            offs += fillVec4(mappedF32, offs, modelViewScratch[0], modelViewScratch[4], modelViewScratch[8]);
            offs += fillVec4(mappedF32, offs, modelViewScratch[1], modelViewScratch[5], modelViewScratch[9]);
        }

        for (const drawcall of this.drawCallInstances) {
            drawcall.prepareToRender(renderInstManager, modelMtx, this.isBillboard, this.isOrthographic);
        }

        renderInstManager.popTemplate();
    }

    public setTileSize(uls: number, ult: number, tile: number = 0) {
        for (let i = 0; i < this.drawCallInstances.length; i++) {
            this.drawCallInstances[i].setTileSize(uls, ult, tile);
        }
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setTexturesEnabled(v);
    }

    public setFogEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setFogEnabled(v);
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setAlphaVisualizerEnabled(v);
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setBackfaceCullingEnabled(v);
    }

    public setRenderMode(renderMode: Partial<GfxMegaStateDescriptor>): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setRenderMode(renderMode);
    }

    public setLight(light: Light1): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].drawCall.light = light;
    }

    public setPrimColor8(r: number, g: number = r, b: number = r, a: number = 0xFF): void {
        for (const drawCallInst of this.drawCallInstances) {
            drawCallInst.primColor.r = r / 0xFF;
            drawCallInst.primColor.g = g / 0xFF;
            drawCallInst.primColor.b = b / 0xFF;
            drawCallInst.primColor.a = a / 0xFF;
        }
    }

    public setEnvColor8(r: number, g: number = r, b: number = r, a: number = 0xFF): void {
        for (const drawCallInst of this.drawCallInstances) {
            drawCallInst.envColor.r = r / 0xFF;
            drawCallInst.envColor.g = g / 0xFF;
            drawCallInst.envColor.b = b / 0xFF;
            drawCallInst.envColor.a = a / 0xFF;
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].destroy(device);
    }
}