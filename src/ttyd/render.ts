
import * as GX_Material from '../gx/gx_material';
import { GXTextureHolder, MaterialParams, GXRenderHelper, SceneParams, fillSceneParamsFromRenderState, GXShapeHelper, PacketParams, loadedDataCoalescer, translateTexFilter, translateWrapMode } from '../gx/gx_render';

import * as TPL from './tpl';
import { TTYDWorld, Material, SceneGraphNode, Batch, SceneGraphPart, Sampler } from './world';

import * as Viewer from '../viewer';
import { RenderState, RenderFlags } from '../render';
import BufferCoalescer, { CoalescedBuffers } from '../BufferCoalescer';
import { mat4 } from 'gl-matrix';
import { assert } from '../util';

export class TPLTextureHolder extends GXTextureHolder<TPL.TPLTexture> {
    public addTPLTextures(gl: WebGL2RenderingContext, tpl: TPL.TPL): void {
        this.addTextures(gl, tpl.textures);
    }
}

class Command_Material {
    private renderFlags: RenderFlags;
    private program: GX_Material.GX_Program;
    private materialParams = new MaterialParams();
    private glSamplers: WebGLSampler[] = [];

    constructor(gl: WebGL2RenderingContext, public material: Material) {
        this.program = new GX_Material.GX_Program(this.material.gxMaterial);
        this.renderFlags = GX_Material.translateRenderFlags(this.material.gxMaterial);

        this.glSamplers = this.material.samplers.map((sampler) => {
            return Command_Material.translateSampler(gl, sampler);
        });
    }

    private static translateSampler(gl: WebGL2RenderingContext, sampler: Sampler): WebGLSampler {
        const glSampler = gl.createSampler();
        gl.samplerParameteri(glSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.samplerParameteri(glSampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.samplerParameteri(glSampler, gl.TEXTURE_WRAP_S, translateWrapMode(gl, sampler.wrapS));
        gl.samplerParameteri(glSampler, gl.TEXTURE_WRAP_T, translateWrapMode(gl, sampler.wrapT));
        return glSampler;
    }

    public fillMaterialParams(gl: WebGL2RenderingContext, materialParams: MaterialParams, textureHolder: TPLTextureHolder): void {
        for (let i = 0; i < this.material.samplers.length; i++) {
            const sampler = this.material.samplers[i];

            const texMapping = this.materialParams.m_TextureMapping[i];
            textureHolder.fillTextureMapping(texMapping, sampler.textureName);
            texMapping.glSampler = this.glSamplers[i];
        }
    }

    public bindMaterial(state: RenderState, renderHelper: GXRenderHelper, textureHolder: TPLTextureHolder) {
        const gl = state.gl;

        state.useProgram(this.program);
        state.useFlags(this.renderFlags);
        this.fillMaterialParams(gl, this.materialParams, textureHolder);
        renderHelper.bindMaterialParams(state, this.materialParams);
        renderHelper.bindMaterialTextures(state, this.materialParams, this.program);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.program.destroy(gl);
        this.glSamplers.forEach((sampler) => gl.deleteSampler(sampler));
    }
}

class Command_Batch {
    private shapeHelper: GXShapeHelper;
    private packetParams = new PacketParams();

    constructor(gl: WebGL2RenderingContext, private sceneGraphNode: SceneGraphNode, private batch: Batch, private coalescedBuffers: CoalescedBuffers) {
        this.shapeHelper = new GXShapeHelper(gl, coalescedBuffers, batch.loadedVertexLayout, batch.loadedVertexData);
    }

    private computeModelView(dst: mat4, state: RenderState): void {
        mat4.copy(dst, state.updateModelView(false, this.sceneGraphNode.modelMatrix));
    }

    public draw(state: RenderState, renderHelper: GXRenderHelper): void {
        this.computeModelView(this.packetParams.u_PosMtx[0], state);
        renderHelper.bindPacketParams(state, this.packetParams);
        this.shapeHelper.draw(state);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.shapeHelper.destroy(gl);
    }
}

export class WorldRenderer implements Viewer.MainScene {
    public name: string;

    private bufferCoalescer: BufferCoalescer;
    private batches: Batch[];

    private batchCommands: Command_Batch[] = [];
    private materialCommands: Command_Material[] = [];

    public visible: boolean = true;

    public renderHelper: GXRenderHelper;
    private sceneParams = new SceneParams();

    constructor(gl: WebGL2RenderingContext, private d: TTYDWorld, public textureHolder: TPLTextureHolder) {
        this.translateModel(gl, d);
        this.renderHelper = new GXRenderHelper(gl);
    }

    public setVisible(visible: boolean) {
        this.visible = visible;
    }

    public render(state: RenderState): void {
        if (!this.visible)
            return;

        state.setClipPlanes(10, 5000);

        this.renderHelper.bindUniformBuffers(state);

        fillSceneParamsFromRenderState(this.sceneParams, state);
        this.renderHelper.bindSceneParams(state, this.sceneParams);

        const renderPart = (part: SceneGraphPart) => {
            const materialIndex = part.material.index;
            this.materialCommands[materialIndex].bindMaterial(state, this.renderHelper, this.textureHolder);
            const batchIndex = this.batches.indexOf(part.batch);
            this.batchCommands[batchIndex].draw(state, this.renderHelper);
        };

        const renderNode = (node: SceneGraphNode) => {
            if (node.visible === false)
                return;
            for (let i = 0; i < node.parts.length; i++)
                renderPart(node.parts[i]);
            for (let i = 0; i < node.children.length; i++)
                renderNode(node.children[i]);
        };

        renderNode(this.d.rootNode);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.renderHelper.destroy(gl);
        this.bufferCoalescer.destroy(gl);
        this.materialCommands.forEach((cmd) => cmd.destroy(gl));
        this.batchCommands.forEach((cmd) => cmd.destroy(gl));
    }

    private translatePart(gl: WebGL2RenderingContext, node: SceneGraphNode, part: SceneGraphPart): void {
        const batch = part.batch;
        const batchIndex = this.batches.indexOf(batch);
        assert(batchIndex >= 0);
        const batchCommand = new Command_Batch(gl, node, batch, this.bufferCoalescer.coalescedBuffers[batchIndex]);
        this.batchCommands.push(batchCommand);
    }

    private translateSceneGraph(gl: WebGL2RenderingContext, node: SceneGraphNode): void {
        for (const part of node.parts)
            this.translatePart(gl, node, part);
        for (const child of node.children)
            this.translateSceneGraph(gl, child);
    }

    private collectBatches(batches: Batch[], node: SceneGraphNode): void {
        for (const part of node.parts)
            batches.push(part.batch);
        for (const child of node.children)
            this.collectBatches(batches, child);
    }

    private translateModel(gl: WebGL2RenderingContext, d: TTYDWorld): void {
        this.materialCommands = d.materials.map((material) => new Command_Material(gl, material));

        this.batches = [];
        this.collectBatches(this.batches, d.rootNode);

        // Coalesce buffers.
        this.bufferCoalescer = loadedDataCoalescer(gl, this.batches.map((batch) => batch.loadedVertexData));

        this.translateSceneGraph(gl, d.rootNode);
    }
}
