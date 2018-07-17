
import * as Viewer from "../viewer";
import { RenderState, RenderFlags } from "../render";
import { BIN, Batch, Material, SceneGraphNode, SceneGraphPart } from "./bin";

import * as GX_Texture from '../gx/gx_texture';
import * as GX_Material from '../gx/gx_material';
import { SceneParams, MaterialParams, PacketParams, GXShapeHelper, GXRenderHelper, fillSceneParamsFromRenderState, loadedDataCoalescer, loadTextureFromMipChain, translateWrapMode } from '../gx/gx_render';
import { assert } from "../util";
import { mat4 } from "gl-matrix";
import BufferCoalescer, { CoalescedBuffers } from "../BufferCoalescer";
import { AABB, IntersectionState } from "../Camera";

class Command_Material {
    private renderFlags: RenderFlags;
    private program: GX_Material.GX_Program;
    private materialParams = new MaterialParams();

    constructor(gl: WebGL2RenderingContext, public scene: BinScene, public material: Material) {
        this.program = new GX_Material.GX_Program(this.material.gxMaterial);
        this.renderFlags = GX_Material.translateRenderFlags(this.material.gxMaterial);

        // We don't animate, so we only need to compute this once.
        this.fillMaterialParams(this.materialParams);
    }

    private fillMaterialParams(materialParams: MaterialParams): void {
        // All we care about is textures...
        for (let i = 0; i < this.material.samplerIndexes.length; i++) {
            const samplerIndex = this.material.samplerIndexes[i];
            if (samplerIndex >= 0) {
                const m = this.materialParams.m_TextureMapping[i];
                m.glTexture = this.scene.glTextures[samplerIndex];
            }
        }
    }

    public exec(state: RenderState) {
        const gl = state.gl;

        state.useProgram(this.program);
        state.useFlags(this.renderFlags);

        this.scene.renderHelper.bindMaterialParams(state, this.materialParams);
        this.scene.renderHelper.bindMaterialTextures(state, this.materialParams, this.program);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.program.destroy(gl);
    }
}

const bboxScratch = new AABB();
class Command_Batch {
    private shapeHelper: GXShapeHelper;
    private packetParams = new PacketParams();

    constructor(gl: WebGL2RenderingContext, private scene: BinScene, private sceneGraphNode: SceneGraphNode, private batch: Batch, private coalescedBuffers: CoalescedBuffers) {
        this.shapeHelper = new GXShapeHelper(gl, coalescedBuffers, batch.loadedVertexLayout, batch.loadedVertexData);
    }

    private computeModelView(dst: mat4, state: RenderState): void {
        mat4.copy(dst, state.updateModelView(false, this.sceneGraphNode.modelMatrix));
    }

    public exec(state: RenderState): void {
        const gl = state.gl;

        if (this.sceneGraphNode.bbox) {
            bboxScratch.transform(this.sceneGraphNode.bbox, this.sceneGraphNode.modelMatrix);
            if (state.camera.frustum.intersect(bboxScratch) === IntersectionState.FULLY_OUTSIDE) {
               return;
            }
        }

        this.computeModelView(this.packetParams.u_PosMtx[0], state);

        this.scene.renderHelper.bindPacketParams(state, this.packetParams);

        this.shapeHelper.drawSimple(gl);
        state.drawCallCount++;
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.shapeHelper.destroy(gl);
    }
}

type RenderCommand = Command_Batch | Command_Material;

export class BinScene implements Viewer.MainScene {
    public name: string;
    public textures: Viewer.Texture[] = [];

    private commands: RenderCommand[];
    private bufferCoalescer: BufferCoalescer;
    private batches: Batch[];

    public glTextures: WebGLTexture[] = [];
    public visible: boolean = true;

    public renderHelper: GXRenderHelper;
    private sceneParams = new SceneParams();

    constructor(gl: WebGL2RenderingContext, private bin: BIN) {
        this.translateModel(gl, bin);
        this.renderHelper = new GXRenderHelper(gl);
    }

    public setVisible(visible: boolean) {
        this.visible = visible;
    }

    public render(state: RenderState): void {
        if (!this.visible)
            return;

        state.setClipPlanes(10, 500000);

        this.renderHelper.bindUniformBuffers(state);

        fillSceneParamsFromRenderState(this.sceneParams, state);
        this.renderHelper.bindSceneParams(state, this.sceneParams);

        this.commands.forEach((command) => {
            command.exec(state);
        });
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.glTextures.forEach((textureId) => gl.deleteTexture(textureId));
        this.renderHelper.destroy(gl);
        this.bufferCoalescer.destroy(gl);
    }

    private translatePart(gl: WebGL2RenderingContext, node: SceneGraphNode, part: SceneGraphPart): void {
        const materialCommand = new Command_Material(gl, this, part.material);
        this.commands.push(materialCommand);
        const batch = part.batch;
        const batchIndex = this.batches.indexOf(batch);
        assert(batchIndex >= 0);
        const batchCommand = new Command_Batch(gl, this, node, batch, this.bufferCoalescer.coalescedBuffers[batchIndex]);
        this.commands.push(batchCommand);
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

    private translateModel(gl: WebGL2RenderingContext, bin: BIN): void {
        for (let i = 0; i < bin.samplers.length; i++) {
            const sampler = bin.samplers[i];
            const texture: GX_Texture.Texture = { ...sampler.texture, name: `unknown ${i}` };
            const mipChain = GX_Texture.calcMipChain(texture, 1);
            const { glTexture, viewerTexture } = loadTextureFromMipChain(gl, mipChain);

            // GL texture is bound by loadTextureFromMipChain.
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, translateWrapMode(gl, sampler.wrapS));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, translateWrapMode(gl, sampler.wrapT));

            this.glTextures.push(glTexture);
            this.textures.push(viewerTexture);
        }

        // First, collect all the batches we're rendering.
        this.batches = [];
        this.collectBatches(this.batches, bin.rootNode);

        // Coalesce buffers.
        this.bufferCoalescer = loadedDataCoalescer(gl, this.batches.map((batch) => batch.loadedVertexData));

        this.commands = [];
        this.translateSceneGraph(gl, bin.rootNode);
    }
}
