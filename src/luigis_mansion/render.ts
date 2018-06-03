
import * as Viewer from "../viewer";
import { RenderState, RenderFlags } from "../render";
import { BIN, Sampler, Batch, Material, SceneGraphNode, SceneGraphPart } from "./bin";

import * as GX from '../gx/gx_enum';
import * as GX_Texture from '../gx/gx_texture';
import * as GX_Material from '../gx/gx_material';
import { getNumComponents, GX_VtxAttrFmt } from "../gx/gx_displaylist";
import { align, assert } from "../util";
import { mat3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import BufferCoalescer, { CoalescedBuffers } from "../BufferCoalescer";

function translateCompType(gl: WebGL2RenderingContext, compType: GX.CompType): { type: GLenum, normalized: boolean } {
    switch (compType) {
    case GX.CompType.F32:
        return { type: gl.FLOAT, normalized: false };
    case GX.CompType.S8:
        return { type: gl.BYTE, normalized: false };
    case GX.CompType.S16:
        return { type: gl.SHORT, normalized: false };
    case GX.CompType.U16:
        return { type: gl.UNSIGNED_SHORT, normalized: false };
    case GX.CompType.U8:
        return { type: gl.UNSIGNED_BYTE, normalized: false };
    case GX.CompType.RGBA8: // XXX: Is this right?
        return { type: gl.UNSIGNED_BYTE, normalized: true };
    default:
        throw new Error(`Unknown CompType ${compType}`);
    }
}

const materialParamsData = new Float32Array(4*2 + 4*2 + 4*8 + 4*3*10 + 4*3*20 + 4*2*3 + 4*8);
class Command_Material {
    static attrScaleData = new Float32Array(GX_Material.scaledVtxAttributes.map(() => 1));
    static matrixScratch = mat3.create();
    static colorScratch = new Float32Array(4 * 8);

    private renderFlags: RenderFlags;
    private program: GX_Material.GX_Program;
    private materialParamsBuffer: WebGLBuffer;

    constructor(gl: WebGL2RenderingContext, public scene: BinScene, public material: Material) {
        this.program = new GX_Material.GX_Program(this.material.gxMaterial);
        this.renderFlags = GX_Material.translateRenderFlags(this.material.gxMaterial);
        this.materialParamsBuffer = gl.createBuffer();
    }

    public exec(state: RenderState) {
        const gl = state.gl;

        state.useProgram(this.program);
        state.useFlags(this.renderFlags);

        // Bind new textures.
        for (let i = 0; i < this.material.samplerIndexes.length; i++) {
            const samplerIndex = this.material.samplerIndexes[i];
            if (samplerIndex < 0)
                continue;

            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, this.scene.glTextures[samplerIndex]);
        }

        // Buffers.
        let offs = 0;

        // color mat regs not used.
        offs += 4*2;
        // amb mat regs not used.
        offs += 4*2;
        // tev color registers are not used.
        offs += 4*4;
        // tev color constants are not used.
        offs += 4*4;

        const matrixScratch = Command_Material.matrixScratch;
        for (let i = 0; i < 10; i++) {
            const finalMatrix = matrixScratch;
            materialParamsData[offs + i*12 +  0] = finalMatrix[0];
            materialParamsData[offs + i*12 +  1] = finalMatrix[3];
            materialParamsData[offs + i*12 +  2] = finalMatrix[6];
            materialParamsData[offs + i*12 +  3] = 0;
            materialParamsData[offs + i*12 +  4] = finalMatrix[1];
            materialParamsData[offs + i*12 +  5] = finalMatrix[4];
            materialParamsData[offs + i*12 +  6] = finalMatrix[7];
            materialParamsData[offs + i*12 +  7] = 0;
            materialParamsData[offs + i*12 +  8] = finalMatrix[2];
            materialParamsData[offs + i*12 +  9] = finalMatrix[5];
            materialParamsData[offs + i*12 + 10] = finalMatrix[8];
            materialParamsData[offs + i*12 + 11] = 0;
        }
        offs += 4*3*10;

        for (let i = 0; i < 20; i++) {
            const finalMatrix = matrixScratch;
            materialParamsData[offs + i*12 +  0] = finalMatrix[0];
            materialParamsData[offs + i*12 +  1] = finalMatrix[3];
            materialParamsData[offs + i*12 +  2] = finalMatrix[6];
            materialParamsData[offs + i*12 +  3] = 0;
            materialParamsData[offs + i*12 +  4] = finalMatrix[1];
            materialParamsData[offs + i*12 +  5] = finalMatrix[4];
            materialParamsData[offs + i*12 +  6] = finalMatrix[7];
            materialParamsData[offs + i*12 +  7] = 0;
            materialParamsData[offs + i*12 +  8] = finalMatrix[2];
            materialParamsData[offs + i*12 +  9] = finalMatrix[5];
            materialParamsData[offs + i*12 + 10] = finalMatrix[8];
            materialParamsData[offs + i*12 + 11] = 0;
        }
        offs += 4*3*20;

        // IndTexMtx. Indirect texturing isn't used.
        offs += 4*3*2;

        // Texture parameters. SizeX/SizeY are only used for indtex, and LodBias is always 0.
        // We can leave this blank.
        offs += 4*8;

        gl.bindBufferBase(gl.UNIFORM_BUFFER, GX_Material.GX_Program.ub_SceneParams, this.scene.sceneParamsBuffer);

        gl.bindBuffer(gl.UNIFORM_BUFFER, this.materialParamsBuffer);
        gl.bufferData(gl.UNIFORM_BUFFER, materialParamsData, gl.DYNAMIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, GX_Material.GX_Program.ub_MaterialParams, this.materialParamsBuffer);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.program.destroy(gl);
        gl.deleteBuffer(this.materialParamsBuffer);
    }
}

const packetParamsData = new Float32Array(11 * 16);
class Command_Batch {
    private vao: WebGLVertexArrayObject;
    private packetParamsBuffer: WebGLBuffer;

    constructor(gl: WebGL2RenderingContext, private sceneGraphNode: SceneGraphNode, private batch: Batch, private coalescedBuffers: CoalescedBuffers) {
        this.translateBatch(gl, batch);
        this.packetParamsBuffer = gl.createBuffer();
    }

    public exec(renderState: RenderState): void {
        const gl = renderState.gl;

        // MV matrix.
        let offs = 0;
        packetParamsData.set(renderState.updateModelView(false, this.sceneGraphNode.modelMatrix), offs);
        offs += 4*4;

        // Position matrix.
        packetParamsData[offs + 0] = 1;
        packetParamsData[offs + 5] = 1;
        packetParamsData[offs + 10] = 1;
        packetParamsData[offs + 15] = 1;
        offs += 4*4;

        gl.bindBuffer(gl.UNIFORM_BUFFER, this.packetParamsBuffer);
        gl.bufferData(gl.UNIFORM_BUFFER, packetParamsData, gl.DYNAMIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, GX_Material.GX_Program.ub_PacketParams, this.packetParamsBuffer);

        gl.bindVertexArray(this.vao);
        gl.drawElements(gl.TRIANGLES, this.batch.loadedVtxData.totalTriangleCount * 3, gl.UNSIGNED_SHORT, this.coalescedBuffers.indexBuffer.offset);
        if (gl.getError() !== gl.NO_ERROR)
            throw new Error("WTF");
        gl.bindVertexArray(null);

        renderState.drawCallCount++;
    }

    public destroy(gl: WebGL2RenderingContext): void {
        gl.deleteVertexArray(this.vao);
    }

    private translateBatch(gl: WebGL2RenderingContext, batch: Batch) {
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.coalescedBuffers.vertexBuffer.buffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.coalescedBuffers.indexBuffer.buffer);

        const bufferSize = gl.getBufferParameter(gl.ELEMENT_ARRAY_BUFFER, gl.BUFFER_SIZE);
        assert(bufferSize >= batch.loadedVtxData.indexData.byteLength);

        for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib < batch.vat.length; vtxAttrib++) {
            if (batch.vattrLayout.dstAttrOffsets[vtxAttrib] === undefined)
                continue;

            const attrFmt: GX_VtxAttrFmt = batch.vat[vtxAttrib];
            const { type, normalized } = translateCompType(gl, attrFmt.compType);
            const attribLocation = GX_Material.getVertexAttribLocation(vtxAttrib);
            gl.enableVertexAttribArray(attribLocation);
            gl.vertexAttribPointer(
                attribLocation,
                getNumComponents(vtxAttrib, attrFmt.compCnt),
                type, normalized,
                batch.vattrLayout.dstVertexSize,
                this.coalescedBuffers.vertexBuffer.offset + batch.vattrLayout.dstAttrOffsets[vtxAttrib],
            );
        }
        gl.bindVertexArray(null);
    }
}

type RenderCommand = Command_Batch | Command_Material;

const sceneParamsData = new Float32Array(4*4 + GX_Material.scaledVtxAttributes.length + 4);
const attrScaleData = new Float32Array(GX_Material.scaledVtxAttributes.map(() => 1));

export class BinScene implements Viewer.MainScene {
    public name: string;
    public textures: Viewer.Texture[];

    private commands: RenderCommand[];
    private bufferCoalescer: BufferCoalescer;
    private batches: Batch[];

    public glTextures: WebGLTexture[];
    public sceneParamsBuffer: WebGLBuffer;
    public visible: boolean = true;

    constructor(gl: WebGL2RenderingContext, private bin: BIN) {
        this.translateModel(gl, bin);
        this.sceneParamsBuffer = gl.createBuffer();
    }

    public setVisible(visible: boolean) {
        this.visible = visible;
    }

    public render(renderState: RenderState): void {
        if (!this.visible)
            return;

        const gl = renderState.gl;

        renderState.setClipPlanes(10, 500000);

        // Update our SceneParams UBO.
        let offs = 0;
        sceneParamsData.set(renderState.projection, offs);
        offs += 4*4;
        sceneParamsData.set(attrScaleData, offs);
        offs += GX_Material.scaledVtxAttributes.length;
        sceneParamsData[offs++] = GX_Material.getTextureLODBias(renderState);

        gl.bindBuffer(gl.UNIFORM_BUFFER, this.sceneParamsBuffer);
        gl.bufferData(gl.UNIFORM_BUFFER, sceneParamsData, gl.DYNAMIC_DRAW);

        this.commands.forEach((command) => {
            command.exec(renderState);
        });
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.glTextures.forEach((textureId) => gl.deleteTexture(textureId));
        gl.deleteBuffer(this.sceneParamsBuffer);
        this.bufferCoalescer.destroy(gl);
    }

    private translateWrapMode(gl: WebGL2RenderingContext, wrapMode: GX.WrapMode) {
        switch (wrapMode) {
        case GX.WrapMode.CLAMP:
            return gl.CLAMP_TO_EDGE;
        case GX.WrapMode.MIRROR:
            return gl.MIRRORED_REPEAT;
        case GX.WrapMode.REPEAT:
            return gl.REPEAT;
        }
    }

    private translateSamplerToViewer(sampler: Sampler): Viewer.Texture {
        const canvas = document.createElement('canvas');
        const texture = { ...sampler.texture, name: '' };
        canvas.width = texture.width;
        canvas.height = texture.height;
        GX_Texture.decodeTexture(texture).then((rgbaTexture) => {
            const ctx = canvas.getContext('2d');
            const imgData = new ImageData(texture.width, texture.height);
            imgData.data.set(new Uint8Array(rgbaTexture.pixels.buffer));
            ctx.putImageData(imgData, 0, 0);
        });
        const surfaces = [canvas];
        return { name: 'unknown', surfaces };
    }

    private translateSampler(gl: WebGL2RenderingContext, sampler: Sampler): WebGLTexture {
        // Translate texture data.
        const texture: GX_Texture.Texture = { ...sampler.texture, name: '' };

        const texId = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texId);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.translateWrapMode(gl, sampler.wrapS));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.translateWrapMode(gl, sampler.wrapT));

        GX_Texture.decodeTexture(texture).then((rgbaTexture) => {
            gl.bindTexture(gl.TEXTURE_2D, texId);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, texture.width, texture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgbaTexture.pixels);
        });

        return texId;
    }

    private translatePart(gl: WebGL2RenderingContext, node: SceneGraphNode, part: SceneGraphPart): void {
        const materialCommand = new Command_Material(gl, this, part.material);
        this.commands.push(materialCommand);
        const batch = part.batch;
        const batchIndex = this.batches.indexOf(batch);
        assert(batchIndex >= 0);
        const batchCommand = new Command_Batch(gl, node, batch, this.bufferCoalescer.coalescedBuffers[batchIndex]);
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
        this.textures = bin.samplers.map((sampler) => this.translateSamplerToViewer(sampler));
        this.glTextures = bin.samplers.map((sampler) => this.translateSampler(gl, sampler));

        // First, collect all the batches we're rendering.
        this.batches = [];
        this.collectBatches(this.batches, bin.rootNode);

        // Coalesce buffers.
        this.bufferCoalescer = new BufferCoalescer(gl,
            this.batches.map((batch) => new ArrayBufferSlice(batch.loadedVtxData.packedVertexData.buffer)),
            this.batches.map((batch) => new ArrayBufferSlice(batch.loadedVtxData.indexData.buffer)),
        );

        this.commands = [];
        this.translateSceneGraph(gl, bin.rootNode);
    }
}
