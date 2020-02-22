import * as Viewer from '../viewer';
import * as RDP from '../Common/N64/RDP';
import * as F3DEX from '../BanjoKazooie/f3dex';
import * as F3DEX2 from './f3dex2';

import { RenderData, F3DEX_Program, AdjustableAnimationController } from '../BanjoKazooie/render';
import { GFXNode, AnimationData, ObjectDef, MaterialFlags } from './room';
import { Animator, AObjOP, ModelField, getPathPoint, Material, ColorField } from './animation';
import { vec4, mat4, vec3 } from 'gl-matrix';
import { DeviceProgram } from '../Program';
import { GfxMegaStateDescriptor, GfxProgram, GfxCullMode, GfxDevice, GfxBindingLayoutDescriptor } from '../gfx/platform/GfxPlatform';
import { nArray, assertExists } from '../util';
import { TextureMapping } from '../TextureHolder';
import { translateCullMode } from '../gx/gx_material';
import { GfxRenderInstManager, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderer';
import { computeViewMatrixSkybox, computeViewMatrix } from '../Camera';
import { fillVec4, fillMatrix4x2, fillMatrix4x3, fillMatrix4x4, fillVec4v } from '../gfx/helpers/UniformBufferHelpers';
import { clamp, computeModelMatrixSRT } from '../MathHelpers';
import { J3DCalcBBoardMtx, J3DCalcYBBoardMtx } from '../Common/JSYSTEM/J3D/J3DGraphBase';

export const enum SnapPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

const viewMatrixScratch = mat4.create();
const modelViewScratch = mat4.create();
const texMatrixScratch = mat4.create();
const colorScratch = vec4.create();
class DrawCallInstance {
    public visible = true;

    private textureEntry: RDP.Texture[] = [];
    private vertexColorsEnabled = true;
    private texturesEnabled = true;
    private monochromeVertexColorsEnabled = false;
    private alphaVisualizerEnabled = false;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private program!: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private textureMappings = nArray(2, () => new TextureMapping());
    private material: Material | null = null;

    constructor(geometryData: RenderData, private drawCall: F3DEX2.DrawCall, private drawMatrices: mat4[], private billboard: number, materials: Material[] = []) {
        for (let i = 0; i < this.textureMappings.length; i++) {
            if (i < this.drawCall.textureIndices.length) {
                const idx = this.drawCall.textureIndices[i];
                this.textureEntry[i] = geometryData.sharedOutput.textureCache.textures[idx];
                this.textureMappings[i].gfxTexture = geometryData.textures[idx];
                this.textureMappings[i].gfxSampler = geometryData.samplers[idx];
            }
        }

        if (drawCall.materialIndex >= 0)
            this.material = assertExists(materials[drawCall.materialIndex]);

        this.megaStateFlags = F3DEX.translateBlendMode(this.drawCall.SP_GeometryMode, this.drawCall.DP_OtherModeL);
        this.createProgram();
    }

    private createProgram(): void {
        const combParams = vec4.create();
        RDP.fillCombineParams(combParams, 0, this.drawCall.DP_Combine);
        const tiles: RDP.TileState[] = [];
        for (let i = 0; i < this.textureEntry.length; i++)
            tiles.push(this.textureEntry[i].tile);
        const program = new F3DEX_Program(this.drawCall.DP_OtherModeH, this.drawCall.DP_OtherModeL, combParams, 8/255, tiles);
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

        program.defines.set('EXTRA_COMBINE', '1');

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
            const sShift = entry.tile.shifts <= 10 ? 1 / (1 << entry.tile.shifts) : (1 << (16 - entry.tile.shifts));
            const tShift = entry.tile.shiftt <= 10 ? 1 / (1 << entry.tile.shiftt) : (1 << (16 - entry.tile.shiftt));
            m[0] = sShift / entry.width;
            m[5] = tShift / entry.height;
            if (this.material && this.material.data.flags & MaterialFlags.Scale) {
                m[0] *= this.material.xScale();
                m[5] *= this.material.yScale();
            }

            // shift by 10.2 UL coords, rescaled by texture size
            m[12] = -entry.tile.uls / 4 / entry.width;
            m[13] = -entry.tile.ult / 4 / entry.height;

            const tileFlag = textureEntryIndex === 0 ? MaterialFlags.Tile0 : MaterialFlags.Tile1;
            if (this.material && this.material.data.flags & tileFlag) {
                m[12] = -this.material.getXShift(textureEntryIndex) / entry.width;
                m[13] = -this.material.getYShift(textureEntryIndex) / entry.height;
            }
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

        // TODO: figure out layers
        if (!(this.drawCall.DP_OtherModeL & (1 << F3DEX.OtherModeL_Layout.Z_UPD)))
            renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);

        this.material?.fillTextureMappings(this.textureMappings);
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
            if (this.billboard & 8)
                J3DCalcBBoardMtx(modelViewScratch, modelViewScratch);
            else if (this.billboard & 2)
                J3DCalcYBBoardMtx(modelViewScratch, modelViewScratch);
            offs += fillMatrix4x3(mappedF32, offs, modelViewScratch);
        }

        this.computeTextureMatrix(texMatrixScratch, 0);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);

        this.computeTextureMatrix(texMatrixScratch, 1);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 3 * 4);
        const comb = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);

        vec4.copy(colorScratch, this.drawCall.DP_PrimColor);
        this.material?.getColor(colorScratch, ColorField.Prim);
        offs += fillVec4v(comb, offs, colorScratch);

        vec4.copy(colorScratch, this.drawCall.DP_EnvColor);
        this.material?.getColor(colorScratch, ColorField.Env);
        offs += fillVec4v(comb, offs, colorScratch);

        let primLOD = this.drawCall.DP_PrimLOD;
        if (this.material && this.material.data.flags & (MaterialFlags.PrimLOD | MaterialFlags.Special))
            primLOD = this.material.getPrimLOD();
        offs += fillVec4(comb, offs, primLOD);
    }
}

export function buildTransform(dst: mat4, pos: vec3, euler: vec3, scale: vec3): void {
    computeModelMatrixSRT(dst,
        scale[0], scale[1], scale[2],
        euler[0], euler[1], euler[2],
        pos[0], pos[1], pos[2]
    );
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];

const lookatScratch = vec3.create();
const vec3up = vec3.fromValues(0, 1, 0);
const vec3Zero = vec3.create();
export class NodeRenderer {
    private visible = true;
    public modelMatrix = mat4.create();
    public transform = mat4.create();

    public children: NodeRenderer[] = [];
    public drawCalls: DrawCallInstance[] = [];

    public translation = vec3.create();
    public euler = vec3.create();
    public scale = vec3.fromValues(1, 1, 1);

    public animator = new Animator();
    public materials: Material[] = [];

    constructor(renderData: RenderData, private node: GFXNode, public parent: mat4, public isSkybox = false) {
        const drawMatrices = [this.modelMatrix, parent];

        for (let i = 0; i < node.materials.length; i++)
            this.materials.push(new Material(node.materials[i], renderData.textures));

        if (node.model !== undefined && node.model.rspOutput !== null)
            for (let i = 0; i < node.model.rspOutput.drawCalls.length; i++)
                this.drawCalls.push(new DrawCallInstance(renderData, node.model.rspOutput.drawCalls[i], drawMatrices, this.node.billboard, this.materials));

        vec3.copy(this.translation, node.translation);
        vec3.copy(this.euler, node.euler);
        vec3.copy(this.scale, node.scale);
    }

    public animate(time: number): void {
        this.animator.update(time);

        const interps = this.animator.interpolators;

        for (let i = 0; i < interps.length; i++) {
            if (interps[i].op === AObjOP.NOP)
                continue;
            const value = interps[i].compute(time);
            switch (i) {
                case ModelField.Pitch: this.euler[0] = value; break;
                case ModelField.Yaw: this.euler[1] = value; break;
                case ModelField.Roll: this.euler[2] = value; break;
                case ModelField.Path: getPathPoint(this.translation, assertExists(interps[i].path), clamp(value, 0, 1)); break;
                case ModelField.X: this.translation[0] = value; break;
                case ModelField.Y: this.translation[1] = value; break;
                case ModelField.Z: this.translation[2] = value; break;
                case ModelField.ScaleX: this.scale[0] = value; break;
                case ModelField.ScaleY: this.scale[1] = value; break;
                case ModelField.ScaleZ: this.scale[2] = value; break;
            }
        }

        for (let i = 0; i < this.materials.length; i++)
            this.materials[i].update(time);

        buildTransform(this.transform, this.translation, this.euler, this.scale);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        mat4.mul(this.modelMatrix, this.parent, this.transform);
        // hide flag just skips this node's draw calls, doesn't affect matrix or children
        if (!(this.animator.stateFlags & 1))
            for (let i = 0; i < this.drawCalls.length; i++)
                this.drawCalls[i].prepareToRender(device, renderInstManager, viewerInput, this.isSkybox);

        for (let i = 0; i < this.children.length; i++)
            this.children[i].prepareToRender(device, renderInstManager, viewerInput);
    }
}

export class ModelRenderer {
    private visible = true;

    public modelMatrix = mat4.create();
    public renderers: NodeRenderer[] = [];
    public animationController = new AdjustableAnimationController(30);

    constructor(private renderData: RenderData, public nodes: GFXNode[], public animations: AnimationData[], public isSkybox = false) {
        for (let i = 0; i < nodes.length; i++) {
            const p = nodes[i].parent;
            if (p === -1)
                this.renderers.push(new NodeRenderer(renderData, nodes[i], this.modelMatrix, isSkybox));
            else {
                this.renderers.push(new NodeRenderer(renderData, nodes[i], this.renderers[p].modelMatrix, isSkybox));
                this.renderers[p].children.push(this.renderers[i]);
            }
        }
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        for (let i = 0; i < this.renderers.length; i++)
            for (let j = 0; j < this.renderers[i].drawCalls.length; j++)
                this.renderers[i].drawCalls[j].setBackfaceCullingEnabled(v);
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.renderers.length; i++)
            for (let j = 0; j < this.renderers[i].drawCalls.length; j++)
                this.renderers[i].drawCalls[j].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.renderers.length; i++)
            for (let j = 0; j < this.renderers[i].drawCalls.length; j++)
                this.renderers[i].drawCalls[j].setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.renderers.length; i++)
            for (let j = 0; j < this.renderers[i].drawCalls.length; j++)
                this.renderers[i].drawCalls[j].setMonochromeVertexColorsEnabled(v);
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        for (let i = 0; i < this.renderers.length; i++)
            for (let j = 0; j < this.renderers[i].drawCalls.length; j++)
                this.renderers[i].drawCalls[j].setAlphaVisualizerEnabled(v);
    }

    public setAnimation(index: number): void {
        this.animationController.adjust(this.animations[index].fps);
        const newAnim = this.animations[index];
        for (let i = 0; i < this.renderers.length; i++) {
            this.renderers[i].animator.setTrack(newAnim.tracks[i]);
            if (newAnim.materialTracks.length == 0 || newAnim.materialTracks[i].length === 0)
                for (let j = 0; j < this.renderers[i].materials.length; j++)
                    this.renderers[i].materials[j].setTrack(null);
            else
                for (let j = 0; j < this.renderers[i].materials.length; j++)
                    this.renderers[i].materials[j].setTrack(newAnim.materialTracks[i][j]);
        }
    }

    private animate(): void {
        const time = this.animationController.getTimeInFrames();
        for (let i = 0; i < this.renderers.length; i++)
            this.renderers[i].animate(time);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        this.animationController.setTimeFromViewerInput(viewerInput);
        this.animate();

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setInputLayoutAndState(this.renderData.inputLayout, this.renderData.inputState);

        template.filterKey = this.isSkybox ? SnapPass.SKYBOX : SnapPass.MAIN;
        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16 + 2 * 4);
        const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

        mat4.getTranslation(lookatScratch, this.modelMatrix);
        vec3.transformMat4(lookatScratch, lookatScratch, viewerInput.camera.viewMatrix);

        mat4.lookAt(modelViewScratch, vec3Zero, lookatScratch, vec3up);
        offs += fillVec4(mappedF32, offs, modelViewScratch[0], modelViewScratch[4], modelViewScratch[8]);
        offs += fillVec4(mappedF32, offs, modelViewScratch[1], modelViewScratch[5], modelViewScratch[9]);

        this.renderers[0].prepareToRender(device, renderInstManager, viewerInput);

        renderInstManager.popTemplateRenderInst();
    }
}