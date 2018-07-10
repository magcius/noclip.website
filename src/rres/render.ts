
import { RenderState, RenderFlags } from "../render";
import * as BRRES from './brres';

import * as GX_Material from '../gx/gx_material';
import { mat4, mat2d } from "gl-matrix";
import BufferCoalescer, { CoalescedBuffers } from "../BufferCoalescer";
import { MaterialParams, translateTexFilter, translateWrapMode, GXShapeHelper, GXRenderHelper, PacketParams, SceneParams, loadedDataCoalescer, fillSceneParamsFromRenderState, TextureHolder } from "../gx/gx_render";
import { texProjPerspMtx, texEnvMtx, AABB, IntersectionState } from "../Camera";
import { ColorOverride } from "../j3d/render";

export class RRESTextureHolder extends TextureHolder<BRRES.TEX0> {
    public addRRESTextures(gl: WebGL2RenderingContext, rres: BRRES.RRES): void {
        this.addTextures(gl, rres.tex0);
    }
}

export class ModelRenderer {
    private materialCommands: Command_Material[] = [];
    private shapeCommands: Command_Shape[] = [];
    private renderHelper: GXRenderHelper;
    private sceneParams: SceneParams = new SceneParams();
    private packetParams: PacketParams = new PacketParams();
    private bufferCoalescer: BufferCoalescer;
    private chr0NodeAnimator: BRRES.CHR0NodesAnimator;

    private matrixVisibility: IntersectionState[] = [];
    private matrixArray: mat4[] = [];
    private matrixScratch: mat4 = mat4.create();
    private bboxScratch: AABB = new AABB();

    public colorOverrides: GX_Material.Color[] = [];

    public modelMatrix: mat4 = mat4.create();
    public visible: boolean = true;
    public name: string;
    public isSkybox: boolean = false;

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

    public bindCHR0(animationController: BRRES.AnimationController, chr0: BRRES.CHR0): void {
        this.chr0NodeAnimator = BRRES.bindCHR0NodesAnimator(animationController, chr0, this.mdl0.nodes);
    }

    public bindSRT0(animationController: BRRES.AnimationController, srt0: BRRES.SRT0): void {
        for (let i = 0; i < this.materialCommands.length; i++) {
            const cmd = this.materialCommands[i];
            cmd.bindSRT0(animationController, srt0);
        }
    }

    public setColorOverride(i: ColorOverride, color: GX_Material.Color): void {
        this.colorOverrides[i] = color;
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public render(state: RenderState): void {
        if (!this.visible)
            return;

        // Frustum cull.
        if (this.mdl0.bbox !== null) {
            const bbox = this.bboxScratch;
            bbox.transform(this.mdl0.bbox, this.modelMatrix);
            if (state.camera.frustum.intersect(bbox) === IntersectionState.FULLY_OUTSIDE)
                return;
        }

        // First, update our matrix state.
        this.execNodeTreeOpList(state, this.mdl0.sceneGraph.nodeTreeOps);

        this.renderHelper.bindUniformBuffers(state);

        fillSceneParamsFromRenderState(this.sceneParams, state);
        this.renderHelper.bindSceneParams(state, this.sceneParams);

        // TODO(jstpierre): Split into two draws.
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

            const node = this.mdl0.nodes[op.nodeId];
            if (this.matrixVisibility[node.mtxId] === IntersectionState.FULLY_OUTSIDE)
                continue;

            const matCommand = this.materialCommands[op.matId];
            if (!matCommand.visible)
                continue;

            const usesEnvelope = (node.mtxId < 0);
            if (usesEnvelope)
                throw "whoops";

            const shpCommand = this.shapeCommands[op.shpId];

            const nodeModelMtx = this.matrixArray[node.mtxId];
            const modelView = state.updateModelView(this.isSkybox, nodeModelMtx);

            if (op.matId != lastMatId) {
                matCommand.exec(state, this.renderHelper);
                lastMatId = op.matId;
            }

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

    private execNodeTreeOpList(state: RenderState, opList: BRRES.NodeTreeOp[]): void {
        mat4.copy(this.matrixArray[0], this.modelMatrix);
        this.matrixVisibility[0] = IntersectionState.PARTIAL_INTERSECT;

        for (let i = 0; i < opList.length; i++) {
            const op = opList[i];

            if (op.op === BRRES.ByteCodeOp.NODEDESC) {
                const node = this.mdl0.nodes[op.nodeId];
                const parentMtxId = op.parentMtxId;
                const dstMtxId = node.mtxId;

                let modelMatrix;
                if (this.chr0NodeAnimator && this.chr0NodeAnimator.calcModelMtx(this.matrixScratch, op.nodeId)) {
                    modelMatrix = this.matrixScratch;
                } else {
                    modelMatrix = node.modelMatrix;
                }
                mat4.mul(this.matrixArray[dstMtxId], this.matrixArray[parentMtxId], modelMatrix);

                const bboxScratch = this.bboxScratch;
                bboxScratch.transform(node.bbox, this.matrixArray[dstMtxId]);
                this.matrixVisibility[dstMtxId] = state.camera.frustum.intersect(bboxScratch);
            } else if (op.op === BRRES.ByteCodeOp.MTXDUP) {
                const srcMtxId = op.fromMtxId;
                const dstMtxId = op.toMtxId;
                mat4.copy(this.matrixArray[dstMtxId], this.matrixArray[srcMtxId]);
                this.matrixVisibility[dstMtxId] = this.matrixVisibility[srcMtxId];
            }
        }
    }

    private translateModel(gl: WebGL2RenderingContext): void {
        this.growMatrixArray(this.mdl0.sceneGraph.nodeTreeOps);

        for (const material of this.mdl0.materials)
            this.materialCommands.push(new Command_Material(gl, this, this.textureHolder, material, this.materialHacks));

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
        public model: ModelRenderer,
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

        if (texSrt.mapMode !== BRRES.MapMode.TEXCOORD) {
            // Effect mtx.
            mat4.mul(dst, this.material.texSrts[texIdx].effectMtx, dst);
        }

        if (texSrt.mapMode === BRRES.MapMode.PROJECTION) {
            texProjPerspMtx(dst, state.fov, state.getAspect(), 0.5, -0.5 * flipYScale, 0.5, 0.5);

            // XXX(jstpierre): ZSS hack. Reference camera 31 is set up by the game to be an overhead
            // camera for clouds. Kill it until we can emulate the camera system in this game...
            if (texSrt.refCamera === 31) {
                dst[0] = 0;
                dst[5] = 0;
            }
        } else if (texSrt.mapMode === BRRES.MapMode.ENV_CAMERA) {
            texEnvMtx(dst, 0.5, -0.5 * flipYScale, 0.5, 0.5);
        } else {
            mat4.identity(dst);
        }

        // Calculate SRT.
        if (this.srtAnimators[texMtxIdx]) {
            this.srtAnimators[texMtxIdx].calcTexMtx(matrixScratch);
        } else {
            mat4.copy(matrixScratch, texSrt.srtMtx);
        }

        // SRT puts translation in fourth column, env/proj in third, so swap SRT so that it matches.
        if (texSrt.mapMode !== BRRES.MapMode.TEXCOORD) {
            const tx = matrixScratch[12];
            matrixScratch[12] = matrixScratch[8]; matrixScratch[8] = tx;
            const ty = matrixScratch[13];
            matrixScratch[13] = matrixScratch[9]; matrixScratch[9] = ty;
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

        const copyColor = (i: ColorOverride, dst: GX_Material.Color, fallbackColor: GX_Material.Color) => {
            let color: GX_Material.Color;
            if (this.model.colorOverrides[i]) {
                color = this.model.colorOverrides[i];
            } else {
                color = fallbackColor;
            }

            dst.copy(color);
        };

        copyColor(ColorOverride.MAT0, materialParams.u_ColorMatReg[0], this.material.colorMatRegs[0]);
        copyColor(ColorOverride.MAT1, materialParams.u_ColorMatReg[1], this.material.colorMatRegs[1]);
        copyColor(ColorOverride.AMB0, materialParams.u_ColorAmbReg[0], this.material.colorAmbRegs[0]);
        copyColor(ColorOverride.AMB1, materialParams.u_ColorAmbReg[1], this.material.colorAmbRegs[1]);

        copyColor(ColorOverride.K0, materialParams.u_KonstColor[0], this.material.gxMaterial.colorConstants[0]);
        copyColor(ColorOverride.K1, materialParams.u_KonstColor[1], this.material.gxMaterial.colorConstants[1]);
        copyColor(ColorOverride.K2, materialParams.u_KonstColor[2], this.material.gxMaterial.colorConstants[2]);
        copyColor(ColorOverride.K3, materialParams.u_KonstColor[3], this.material.gxMaterial.colorConstants[3]);

        copyColor(ColorOverride.CPREV, materialParams.u_Color[0], this.material.gxMaterial.colorRegisters[0]);
        copyColor(ColorOverride.C0, materialParams.u_Color[1], this.material.gxMaterial.colorRegisters[1]);
        copyColor(ColorOverride.C1, materialParams.u_Color[2], this.material.gxMaterial.colorRegisters[2]);
        copyColor(ColorOverride.C2, materialParams.u_Color[3], this.material.gxMaterial.colorRegisters[3]);

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

