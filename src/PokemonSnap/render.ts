import * as Viewer from '../viewer';
import * as RDP from '../Common/N64/RDP';
import * as F3DEX from '../BanjoKazooie/f3dex';
import * as F3DEX2 from './f3dex2';

import { RenderData, F3DEX_Program } from '../BanjoKazooie/render';
import { GFXNode } from './room';
import { vec4, mat4, vec3 } from 'gl-matrix';
import { DeviceProgram } from '../Program';
import { GfxMegaStateDescriptor, GfxProgram, GfxCullMode, GfxDevice, GfxBindingLayoutDescriptor } from '../gfx/platform/GfxPlatform';
import { nArray } from '../util';
import { TextureMapping } from '../TextureHolder';
import { translateCullMode } from '../gx/gx_material';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer';
import { computeViewMatrixSkybox, computeViewMatrix } from '../Camera';
import { fillVec4, fillMatrix4x2, fillMatrix4x3, fillMatrix4x4, fillVec4v } from '../gfx/helpers/UniformBufferHelpers';

export const enum SnapPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

const viewMatrixScratch = mat4.create();
const modelViewScratch = mat4.create();
const texMatrixScratch = mat4.create();
class DrawCallInstance {
    private textureEntry: RDP.Texture[] = [];
    private vertexColorsEnabled = true;
    private texturesEnabled = true;
    private monochromeVertexColorsEnabled = false;
    private alphaVisualizerEnabled = false;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private program!: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private textureMappings = nArray(2, () => new TextureMapping());
    public visible = true;

    constructor(geometryData: RenderData, private drawCall: F3DEX2.DrawCall, private drawMatrices: mat4[]) {
        for (let i = 0; i < this.textureMappings.length; i++) {
            if (i < this.drawCall.textureIndices.length) {
                const idx = this.drawCall.textureIndices[i];
                this.textureEntry[i] = geometryData.sharedOutput.textureCache.textures[idx];
                this.textureMappings[i].gfxTexture = geometryData.textures[idx];
                this.textureMappings[i].gfxSampler = geometryData.samplers[idx];
            }
        }

        this.megaStateFlags = F3DEX.translateBlendMode(this.drawCall.SP_GeometryMode, this.drawCall.DP_OtherModeL);
        this.createProgram();
    }

    private createProgram(): void {
        const combParams = vec4.create();
        RDP.fillCombineParams(combParams, 0, this.drawCall.DP_Combine);
        const tiles: RDP.TileState[] = [];
        for (let i = 0; i < this.textureEntry.length; i++)
            tiles.push(this.textureEntry[i].tile);
        const program = new F3DEX_Program(this.drawCall.DP_OtherModeH, this.drawCall.DP_OtherModeL, combParams, tiles);
        program.defines.set('BONE_MATRIX_COUNT', this.drawMatrices.length.toString());

        if (this.texturesEnabled && this.drawCall.textureIndices.length)
            program.defines.set('USE_TEXTURE', '1');

        const shade = (this.drawCall.SP_GeometryMode & F3DEX2.RSP_Geometry.G_SHADE) !== 0;
        if (this.vertexColorsEnabled && shade)
            program.defines.set('USE_VERTEX_COLOR', '1');

        if (this.drawCall.SP_GeometryMode & F3DEX2.RSP_Geometry.G_LIGHTING)
            program.defines.set('LIGHTING', '1');

        if (this.drawCall.SP_GeometryMode & F3DEX2.RSP_Geometry.G_TEXTURE_GEN)
            program.defines.set('TEXTURE_GEN', '1');

        if (this.drawCall.SP_GeometryMode & F3DEX2.RSP_Geometry.G_TEXTURE_GEN_LINEAR)
            program.defines.set('TEXTURE_GEN_LINEAR', '1');

        if (this.monochromeVertexColorsEnabled)
            program.defines.set('USE_MONOCHROME_VERTEX_COLOR', '1');

        if (this.alphaVisualizerEnabled)
            program.defines.set('USE_ALPHA_VISUALIZER', '1');

        this.program = program;
        this.gfxProgram = null;
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        const cullMode = v ? translateCullMode(this.drawCall.SP_GeometryMode) : GfxCullMode.NONE;
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

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        this.monochromeVertexColorsEnabled = v;
        this.createProgram();
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        this.alphaVisualizerEnabled = v;
        this.createProgram();
    }

    private computeTextureMatrix(m: mat4, textureEntryIndex: number): void {
        if (this.textureEntry[textureEntryIndex] !== undefined) {
            const entry = this.textureEntry[textureEntryIndex];
            m[0] = 1/entry.width;
            m[5] = 1/entry.height;

            // shift by 10.2 UL coords, rescaled by texture size
            m[12] = -entry.tile.uls/4/entry.width;
            m[13] = -entry.tile.ult/4/entry.height;
        } else {
            mat4.identity(m);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean): void {
        if (!this.visible)
            return;

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);

        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.drawIndexes(this.drawCall.indexCount, this.drawCall.firstIndex);

        let offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12 * this.drawMatrices.length + 8 * 2);
        const mappedF32 = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);

        if (isSkybox)
            computeViewMatrixSkybox(viewMatrixScratch, viewerInput.camera);
        else
            computeViewMatrix(viewMatrixScratch, viewerInput.camera);

        for (let i = 0; i < this.drawMatrices.length; i++) {
            mat4.mul(modelViewScratch, viewMatrixScratch, this.drawMatrices[i]);
            offs += fillMatrix4x3(mappedF32, offs, modelViewScratch);
        }

        this.computeTextureMatrix(texMatrixScratch, 0);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);

        this.computeTextureMatrix(texMatrixScratch, 1);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 8);
        const comb = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);
        // TODO: set these properly, this mostly just reproduces vertex*texture
        offs += fillVec4v(comb, offs, this.drawCall.DP_PrimColor);   // primitive color
        offs += fillVec4v(comb, offs, this.drawCall.DP_EnvColor);   // environment color
    }
}

export function buildTransform(dst: mat4, pos: vec3, euler: vec3, scale: vec3): void {
    mat4.fromTranslation(dst, pos);
    mat4.rotateZ(dst, dst, euler[2]);
    mat4.rotateY(dst, dst, euler[1]);
    mat4.rotateX(dst, dst, euler[0]);
    mat4.scale(dst, dst, scale);
}


const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];

const lookatScratch = vec3.create();
const vec3up = vec3.fromValues(0, 1, 0);
const vec3Zero = vec3.create();
export class ModelRenderer {
    private visible = true;
    public modelMatrix = mat4.create();
    public transform = mat4.create();

    public children: ModelRenderer[] = [];
    public drawCalls: DrawCallInstance[] = [];

    constructor(private renderData: RenderData, graph: GFXNode, parent: mat4 | null = null, public isSkybox = false) {
        const drawMatrices = [this.modelMatrix];
        if (parent !== null)
            drawMatrices.push(parent);

        if (graph.model !== undefined && graph.model.rspOutput !== null)
            for (let i = 0; i < graph.model.rspOutput.drawCalls.length; i++)
                this.drawCalls.push(new DrawCallInstance(renderData, graph.model.rspOutput.drawCalls[i], drawMatrices));
        for (let i = 0; i < graph.children.length; i++)
            this.children.push(new ModelRenderer(renderData, graph.children[i], this.modelMatrix));

        buildTransform(this.transform, graph.translation, graph.euler, graph.scale)
        mat4.copy(this.modelMatrix, this.transform);
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCalls.length; i++)
            this.drawCalls[i].setBackfaceCullingEnabled(v);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].setBackfaceCullingEnabled(v);
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCalls.length; i++)
            this.drawCalls[i].setVertexColorsEnabled(v);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCalls.length; i++)
            this.drawCalls[i].setTexturesEnabled(v);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCalls.length; i++)
            this.drawCalls[i].setMonochromeVertexColorsEnabled(v);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].setMonochromeVertexColorsEnabled(v);
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCalls.length; i++)
            this.drawCalls[i].setAlphaVisualizerEnabled(v);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].setAlphaVisualizerEnabled(v);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, parentMatrix?: mat4): void {
        if (!this.visible)
            return;

        if (parentMatrix === undefined) {
            const template = renderInstManager.pushTemplateRenderInst();
            template.setBindingLayouts(bindingLayouts);
            template.setInputLayoutAndState(this.renderData.inputLayout, this.renderData.inputState);

            template.filterKey = this.isSkybox ? SnapPass.SKYBOX : SnapPass.MAIN;
            let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16 + 2*4);
            const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
            offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

            mat4.getTranslation(lookatScratch, this.modelMatrix);
            vec3.transformMat4(lookatScratch, lookatScratch, viewerInput.camera.viewMatrix);

            mat4.lookAt(modelViewScratch, vec3Zero, lookatScratch, vec3up);
            offs += fillVec4(mappedF32, offs, modelViewScratch[0], modelViewScratch[4], modelViewScratch[8]);
            offs += fillVec4(mappedF32, offs, modelViewScratch[1], modelViewScratch[5], modelViewScratch[9]);
        } else
            mat4.mul(this.modelMatrix, parentMatrix, this.transform);

        for (let i = 0; i < this.drawCalls.length; i++)
            this.drawCalls[i].prepareToRender(device, renderInstManager, viewerInput, this.isSkybox);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].prepareToRender(device, renderInstManager, viewerInput, this.modelMatrix);

        if (parentMatrix === undefined)
            renderInstManager.popTemplateRenderInst();
    }
}