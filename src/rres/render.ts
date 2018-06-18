
import * as Viewer from "../viewer";
import { RenderState, RenderFlags } from "../render";
import * as BRRES from './brres';

import * as GX from '../gx/gx_enum';
import * as GX_Texture from '../gx/gx_texture';
import * as GX_Material from '../gx/gx_material';
import { align, assert, nArray } from "../util";
import { mat3, mat4, mat2d } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import BufferCoalescer, { CoalescedBuffers } from "../BufferCoalescer";
import { loadTextureFromMipChain, MaterialParams, translateTexFilter, translateWrapMode, GXShapeHelper, GXRenderHelper, PacketParams, SceneParams, loadedDataCoalescer, fillSceneParamsFromRenderState, TextureMapping, TextureHolder } from "../gx/gx_render";
import { texProjPerspMtx, texEnvMtx } from "../Camera";

export class RRESTextureHolder extends TextureHolder<BRRES.TEX0> {
    public addRRESTextures(gl: WebGL2RenderingContext, rres: BRRES.RRES): void {
        this.addTextures(gl, rres.textures);
    }
}

export class ModelRenderer {
    public materialCommands: Command_Material[] = [];
    private shapeCommands: Command_Shape[] = [];
    private renderHelper: GXRenderHelper;
    private sceneParams: SceneParams = new SceneParams();
    private packetParams: PacketParams = new PacketParams();
    private matrixArray: mat4[] = nArray(16, () => mat4.create());
    private bufferCoalescer: BufferCoalescer;

    public visible: boolean = true;
    public name: string;

    constructor(gl: WebGL2RenderingContext,
        public textureHolder: RRESTextureHolder,
        public mdl0: BRRES.MDL0,
        public namePrefix: string = '',
        public materialHacks: GX_Material.GXMaterialHacks = null
    ) {
        this.renderHelper = new GXRenderHelper(gl);
        this.translateModel(gl);
        this.name = `${namePrefix}/${mdl0.name}`;
    }

    public bindSRT0(animationController: BRRES.AnimationController, srt0: BRRES.SRT0): void {
        for (let i = 0; i < this.materialCommands.length; i++) {
            const cmd = this.materialCommands[i];
            cmd.bindSRT0(animationController, srt0);
        }
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public render(state: RenderState): void {
        if (!this.visible)
            return;

        // First, update our matrix state.
        this.execNodeTreeOpList(this.mdl0.sceneGraph.nodeTreeOps);

        state.setClipPlanes(10, 500000);
        this.renderHelper.bindUniformBuffers(state);

        fillSceneParamsFromRenderState(this.sceneParams, state);
        this.renderHelper.bindSceneParams(state, this.sceneParams);

        this.execDrawOpList(state, this.mdl0.sceneGraph.drawOpaOps);
        this.execDrawOpList(state, this.mdl0.sceneGraph.drawXluOps);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.renderHelper.destroy(gl);
        this.materialCommands.forEach((cmd) => cmd.destroy(gl));
        this.shapeCommands.forEach((cmd) => cmd.destroy(gl));
    }

    private execDrawOpList(state: RenderState, opList: BRRES.DrawOp[]): void {
        let lastMatId = -1;
        for (let i = 0; i < opList.length; i++) {
            const op = opList[i];

            const matCommand = this.materialCommands[op.matId];
            if (!matCommand.visible)
                continue;

            if (op.matId != lastMatId) {
                matCommand.exec(state, this.renderHelper);
                lastMatId = op.matId;
            }

            const shpCommand = this.shapeCommands[op.shpId];
            const node = this.mdl0.nodes[op.nodeId];

            const usesEnvelope = (node.mtxId < 0);
            if (usesEnvelope)
                throw "whoops";

            const nodeModelMtx = this.matrixArray[node.mtxId];
            const modelView = state.updateModelView(false, nodeModelMtx);

            mat4.copy(this.packetParams.u_PosMtx[0], modelView);
            this.renderHelper.bindPacketParams(state, this.packetParams);

            shpCommand.exec(state);
        }
    }

    private growMatrixArray(opList: BRRES.NodeTreeOp[]): void {
        for (let i = 0; i < opList.length; i++) {
            const op = opList[i];

            let dstMtxId;
            if (op.op === BRRES.ByteCodeOp.NODEDESC) {
                const node = this.mdl0.nodes[op.nodeId];
                dstMtxId = node.mtxId;
            } else if (op.op === BRRES.ByteCodeOp.MTXDUP) {
                dstMtxId = op.toMtxId;
            } else {
                throw "whoops";
            }

            const newSize = dstMtxId + 1;
            while (this.matrixArray.length < newSize)
                this.matrixArray.push(mat4.create());
        }
    }

    private execNodeTreeOpList(opList: BRRES.NodeTreeOp[]): void {
        mat4.identity(this.matrixArray[0]);

        for (let i = 0; i < opList.length; i++) {
            const op = opList[i];

            if (op.op === BRRES.ByteCodeOp.NODEDESC) {
                const node = this.mdl0.nodes[op.nodeId];
                const parentMtxId = op.parentMtxId;
                const dstMtxId = node.mtxId;
                // This is more complicated, but for now...
                mat4.mul(this.matrixArray[dstMtxId], this.matrixArray[parentMtxId], node.modelMatrix);
            } else if (op.op === BRRES.ByteCodeOp.MTXDUP) {
                const srcMtxId = op.fromMtxId;
                const dstMtxId = op.toMtxId;
                mat4.copy(this.matrixArray[dstMtxId], this.matrixArray[srcMtxId]);
            }
        }
    }

    private translateModel(gl: WebGL2RenderingContext): void {
        this.growMatrixArray(this.mdl0.sceneGraph.nodeTreeOps);

        for (const material of this.mdl0.materials)
            this.materialCommands.push(new Command_Material(gl, this.textureHolder, material, this.materialHacks));

        this.bufferCoalescer = loadedDataCoalescer(gl, this.mdl0.shapes.map((shape) => shape.loadedVertexData));

        for (let i = 0; i < this.mdl0.shapes.length; i++) {
            const shape = this.mdl0.shapes[i];
            this.shapeCommands.push(new Command_Shape(gl, this.bufferCoalescer.coalescedBuffers[i], shape));
        }
    }
}

class Command_Shape {
    private shapeHelper: GXShapeHelper;

    constructor(gl: WebGL2RenderingContext, coalescedBuffers: CoalescedBuffers, public shape: BRRES.MDL0_ShapeEntry) {
        this.shapeHelper = new GXShapeHelper(gl, coalescedBuffers, shape.loadedVertexLayout, shape.loadedVertexData);
    }

    public exec(state: RenderState): void {
        const gl = state.gl;
        this.shapeHelper.drawSimple(gl);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.shapeHelper.destroy(gl);
    }
}

const matrixScratch = mat4.create();
class Command_Material {
    private renderFlags: RenderFlags;
    private program: GX_Material.GX_Program;
    private materialParams = new MaterialParams();
    private glSamplers: WebGLSampler[] = [];
    private srtAnimators: BRRES.TexSrtAnimator[] = [];
    public visible: boolean = true;

    constructor(gl: WebGL2RenderingContext,
        public textureHolder: RRESTextureHolder,
        public material: BRRES.MDL0_MaterialEntry,
        public materialHacks: GX_Material.GXMaterialHacks,
    ) {
        this.program = new GX_Material.GX_Program(this.material.gxMaterial, this.materialHacks);
        this.program.name = this.material.name;
        this.renderFlags = GX_Material.translateRenderFlags(this.material.gxMaterial);

        this.translateSamplers(gl);
    }

    public bindSRT0(animationController: BRRES.AnimationController, srt0: BRRES.SRT0): void {
        for (let i: BRRES.TexMtxIndex = 0; i < BRRES.TexMtxIndex.COUNT; i++) {
            const srtAnimator = BRRES.bindTexAnimator(animationController, srt0, this.material.name, i);
            if (srtAnimator)
                this.srtAnimators[i] = srtAnimator;
        }
    }

    private translateSamplers(gl: WebGL2RenderingContext): void {
        for (let i = 0; i < 8; i++) {
            const sampler = this.material.samplers[i];
            if (!sampler)
                continue;

            // Check sampler validity.
            if (!this.textureHolder.hasTexture(sampler.name))
                console.warn("Missing texture:", sampler.name);

            const glSampler = gl.createSampler();
            gl.samplerParameteri(glSampler, gl.TEXTURE_MIN_FILTER, translateTexFilter(gl, sampler.minFilter));
            gl.samplerParameteri(glSampler, gl.TEXTURE_MAG_FILTER, translateTexFilter(gl, sampler.magFilter));
            gl.samplerParameteri(glSampler, gl.TEXTURE_WRAP_S, translateWrapMode(gl, sampler.wrapS));
            gl.samplerParameteri(glSampler, gl.TEXTURE_WRAP_T, translateWrapMode(gl, sampler.wrapT));

            this.glSamplers[i] = glSampler;
        }
    }

    private calcPostTexMtx(dst: mat4, texIdx: number, state: RenderState, flipY: boolean): void {
        const texMtxIdx: BRRES.TexMtxIndex = BRRES.TexMtxIndex.TEX0 + texIdx;
        const texSrt = this.material.texSrts[texIdx];
        const flipYScale = flipY ? -1.0 : 1.0;

        if (texSrt.mapMode === BRRES.MapMode.PROJECTION) {
            texProjPerspMtx(dst, state.fov, state.getAspect(), 0.5, -0.5 * flipYScale, 0.5, 0.5);
        } else if (texSrt.mapMode === BRRES.MapMode.ENV_CAMERA) {
            texEnvMtx(dst, 0.5, -0.5 * flipYScale, 0.5, 0.5);
        } else {
            mat4.identity(dst);
        }

        if (texSrt.mapMode !== BRRES.MapMode.TEXCOORD) {
            // Effect mtx.
            mat4.mul(dst, this.material.texSrts[texIdx].effectMtx, dst);
        }

        // Calculate SRT.
        if (this.srtAnimators[texMtxIdx]) {
            this.srtAnimators[texMtxIdx].calcTexMtx(matrixScratch);

            if (texSrt.mapMode !== BRRES.MapMode.TEXCOORD) {
                const tx = matrixScratch[12];
                matrixScratch[12] = matrixScratch[8]; matrixScratch[8] = tx;
                const ty = matrixScratch[13];
                matrixScratch[13] = matrixScratch[9]; matrixScratch[9] = tx;
            }
        } else {
            mat4.copy(matrixScratch, this.material.texSrts[texIdx].srtMtx);
        }

        mat4.mul(dst, matrixScratch, dst);
    }

    private calcIndMtx(dst: mat2d, indIdx: number): void {
        const texMtxIdx: BRRES.TexMtxIndex = BRRES.TexMtxIndex.IND0 + indIdx;
        if (this.srtAnimators[texMtxIdx]) {
            this.srtAnimators[texMtxIdx].calcIndTexMtx(dst);
        } else {
            mat2d.copy(dst, this.material.indTexMatrices[indIdx]);
        }
    }

    private fillMaterialParams(materialParams: MaterialParams, state: RenderState): void {
        for (let i = 0; i < 8; i++) {
            const sampler = this.material.samplers[i];
            if (!sampler)
                continue;

            const m = materialParams.m_TextureMapping[i];
            this.textureHolder.fillTextureMapping(m, sampler.name);
            // Fill in sampler state.
            m.glSampler = this.glSamplers[i];
            m.lodBias = sampler.lodBias;
        }

        for (let i = 0; i < 2; i++)
            materialParams.u_ColorAmbReg[i].copy(this.material.colorAmbRegs[i]);
        for (let i = 0; i < 2; i++)
            materialParams.u_ColorMatReg[i].copy(this.material.colorMatRegs[i]);
        for (let i = 0; i < 4; i++)
            materialParams.u_Color[i].copy(this.material.gxMaterial.colorRegisters[i]);
        for (let i = 0; i < 4; i++)
            materialParams.u_KonstColor[i].copy(this.material.gxMaterial.colorConstants[i]);
        for (let i = 0; i < 8; i++)
            this.calcPostTexMtx(materialParams.u_PostTexMtx[i], i, state, materialParams.m_TextureMapping[i].flipY);
        for (let i = 0; i < 3; i++)
            this.calcIndMtx(materialParams.u_IndTexMtx[i], i);
    }

    public exec(state: RenderState, renderHelper: GXRenderHelper): void {
        const gl = state.gl;

        state.useProgram(this.program);
        state.useFlags(this.renderFlags);

        this.fillMaterialParams(this.materialParams, state);

        renderHelper.bindMaterialParams(state, this.materialParams);
        renderHelper.bindMaterialTextures(state, this.materialParams, this.program);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.program.destroy(gl);
        this.glSamplers.forEach((sampler) => gl.deleteSampler(sampler));
    }
}

