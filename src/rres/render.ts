
import { RenderState, RenderFlags } from "../render";
import * as BRRES from './brres';

import * as GX_Material from '../gx/gx_material';
import { mat4, mat2d } from "gl-matrix";
import BufferCoalescer, { CoalescedBuffers } from "../BufferCoalescer";
import { MaterialParams, translateTexFilter, translateWrapMode, GXShapeHelper, GXRenderHelper, PacketParams, SceneParams, loadedDataCoalescer, fillSceneParamsFromRenderState, GXTextureHolder, ColorKind } from "../gx/gx_render";
import { texProjPerspMtx, texEnvMtx } from "../Camera";
import AnimationController from "../AnimationController";
import { TextureMapping } from "../TextureHolder";
import { IntersectionState, AABB } from "../Geometry";

export class RRESTextureHolder extends GXTextureHolder<BRRES.TEX0> {
    public addRRESTextures(gl: WebGL2RenderingContext, rres: BRRES.RRES): void {
        this.addTextures(gl, rres.tex0);
    }
}

export class MDL0Model {
    public materialCommands: Command_Material[] = [];
    public shapeCommands: Command_Shape[] = [];
    private bufferCoalescer: BufferCoalescer;
    private realized: boolean;

    constructor(
        gl: WebGL2RenderingContext,
        public mdl0: BRRES.MDL0,
        private materialHacks: GX_Material.GXMaterialHacks | null = null,
    ) {
        for (const material of this.mdl0.materials)
            this.materialCommands.push(new Command_Material(gl, material, this.materialHacks));

        this.bufferCoalescer = loadedDataCoalescer(gl, this.mdl0.shapes.map((shape) => shape.loadedVertexData));

        for (let i = 0; i < this.mdl0.shapes.length; i++) {
            const shape = this.mdl0.shapes[i];
            this.shapeCommands.push(new Command_Shape(gl, this.bufferCoalescer.coalescedBuffers[i], shape));
        }

        this.realized = true;
    }

    public destroy(gl: WebGL2RenderingContext): void {
        if (!this.realized)
            return;

        this.materialCommands.forEach((cmd) => cmd.destroy(gl));
        this.shapeCommands.forEach((cmd) => cmd.destroy(gl));
        this.bufferCoalescer.destroy(gl);
        this.realized = false;
    }
}

export class MDL0ModelInstance {
    private materialInstances: MaterialInstance[];
    private renderHelper: GXRenderHelper;
    private sceneParams: SceneParams = new SceneParams();
    private packetParams: PacketParams = new PacketParams();
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
        public textureHolder: GXTextureHolder,
        public mdl0Model: MDL0Model,
        public namePrefix: string = '',
    ) {
        this.renderHelper = new GXRenderHelper(gl);
        this.name = `${namePrefix}/${mdl0Model.mdl0.name}`;

        this.materialInstances = this.mdl0Model.materialCommands.map((materialCommand) => {
            return new MaterialInstance(this, textureHolder, materialCommand.material);
        })
        this.growMatrixArray(this.mdl0Model.mdl0.sceneGraph.nodeTreeOps);
    }

    public bindCHR0(animationController: AnimationController, chr0: BRRES.CHR0): void {
        this.chr0NodeAnimator = BRRES.bindCHR0Animator(animationController, chr0, this.mdl0Model.mdl0.nodes);
    }

    public bindSRT0(animationController: AnimationController, srt0: BRRES.SRT0): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindSRT0(animationController, srt0);
    }

    public bindPAT0(animationController: AnimationController, pat0: BRRES.PAT0): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindPAT0(animationController, pat0);
    }

    public bindCLR0(animationController: AnimationController, clr0: BRRES.CLR0): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindCLR0(animationController, clr0);
    }

    public bindRRESAnimations(animationController: AnimationController, rres: BRRES.RRES): void {
        for (let i = 0; i < rres.chr0.length; i++)
            this.bindCHR0(animationController, rres.chr0[i]);
        for (let i = 0; i < rres.srt0.length; i++)
            this.bindSRT0(animationController, rres.srt0[i]);
        for (let i = 0; i < rres.pat0.length; i++)
            this.bindPAT0(animationController, rres.pat0[i]);
        for (let i = 0; i < rres.clr0.length; i++)
            this.bindCLR0(animationController, rres.clr0[i]);
    }

    public setColorOverride(i: ColorKind, color: GX_Material.Color): void {
        this.colorOverrides[i] = color;
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public render(state: RenderState): void {
        if (!this.visible)
            return;

        // Frustum cull.
        const mdl0 = this.mdl0Model.mdl0;
        if (mdl0.bbox !== null) {
            const bbox = this.bboxScratch;
            bbox.transform(mdl0.bbox, this.modelMatrix);
            if (state.camera.frustum.intersect(bbox) === IntersectionState.FULLY_OUTSIDE)
                return;
        }

        // First, update our matrix state.
        this.execNodeTreeOpList(state, mdl0.sceneGraph.nodeTreeOps);

        this.renderHelper.bindUniformBuffers(state);

        fillSceneParamsFromRenderState(this.sceneParams, state);
        this.renderHelper.bindSceneParams(state, this.sceneParams);

        // TODO(jstpierre): Split into two draws.
        this.execDrawOpList(state, mdl0.sceneGraph.drawOpaOps);
        this.execDrawOpList(state, mdl0.sceneGraph.drawXluOps);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.mdl0Model.destroy(gl);
        this.renderHelper.destroy(gl);
    }

    private execDrawOpList(state: RenderState, opList: BRRES.DrawOp[]): void {
        const mdl0 = this.mdl0Model.mdl0;

        let lastMatId = -1;
        for (let i = 0; i < opList.length; i++) {
            const op = opList[i];

            const node = mdl0.nodes[op.nodeId];
            if (this.matrixVisibility[node.mtxId] === IntersectionState.FULLY_OUTSIDE)
                continue;

            const matCommand = this.mdl0Model.materialCommands[op.matId];

            const usesEnvelope = (node.mtxId < 0);
            if (usesEnvelope)
                throw "whoops";

            const shpCommand = this.mdl0Model.shapeCommands[op.shpId];

            const nodeModelMtx = this.matrixArray[node.mtxId];
            const modelView = state.updateModelView(this.isSkybox, nodeModelMtx);

            if (op.matId != lastMatId) {
                matCommand.bindMaterial(state, this.renderHelper, this.materialInstances[op.matId]);
                lastMatId = op.matId;
            }

            mat4.copy(this.packetParams.u_PosMtx[0], modelView);
            this.renderHelper.bindPacketParams(state, this.packetParams);
            shpCommand.draw(state);
        }
    }

    private growMatrixArray(opList: BRRES.NodeTreeOp[]): void {
        const mdl0 = this.mdl0Model.mdl0;
        for (let i = 0; i < opList.length; i++) {
            const op = opList[i];

            let dstMtxId;
            if (op.op === BRRES.ByteCodeOp.NODEDESC) {
                const node = mdl0.nodes[op.nodeId];
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
        const mdl0 = this.mdl0Model.mdl0;

        mat4.copy(this.matrixArray[0], this.modelMatrix);
        this.matrixVisibility[0] = IntersectionState.PARTIAL_INTERSECT;

        for (let i = 0; i < opList.length; i++) {
            const op = opList[i];

            if (op.op === BRRES.ByteCodeOp.NODEDESC) {
                const node = mdl0.nodes[op.nodeId];
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
}

class Command_Shape {
    private shapeHelper: GXShapeHelper;

    constructor(gl: WebGL2RenderingContext, coalescedBuffers: CoalescedBuffers, public shape: BRRES.MDL0_ShapeEntry) {
        this.shapeHelper = new GXShapeHelper(gl, coalescedBuffers, shape.loadedVertexLayout, shape.loadedVertexData);
    }

    public draw(state: RenderState): void {
        this.shapeHelper.draw(state);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.shapeHelper.destroy(gl);
    }
}

export class MaterialInstance {
    private srt0Animators: BRRES.SRT0TexMtxAnimator[] = [];
    private pat0Animators: BRRES.PAT0TexAnimator[] = [];
    private clr0Animators: BRRES.CLR0ColorAnimator[] = [];

    constructor(
        private modelInstance: MDL0ModelInstance,
        private textureHolder: GXTextureHolder,
        private material: BRRES.MDL0_MaterialEntry,
    ) {
    }

    public bindSRT0(animationController: AnimationController, srt0: BRRES.SRT0): void {
        for (let i: BRRES.TexMtxIndex = 0; i < BRRES.TexMtxIndex.COUNT; i++) {
            const srtAnimator = BRRES.bindSRT0Animator(animationController, srt0, this.material.name, i);
            if (srtAnimator)
                this.srt0Animators[i] = srtAnimator;
        }
    }

    public bindPAT0(animationController: AnimationController, pat0: BRRES.PAT0): void {
        for (let i = 0; i < 8; i++) {
            const patAnimator = BRRES.bindPAT0Animator(animationController, pat0, this.material.name, i);
            if (patAnimator)
                this.pat0Animators[i] = patAnimator;
        }
    }

    public bindCLR0(animationController: AnimationController, clr0: BRRES.CLR0): void {
        for (let i = 0; i < BRRES.AnimatableColor.COUNT; i++) {
            const clrAnimator = BRRES.bindCLR0Animator(animationController, clr0, this.material.name, i);
            if (clrAnimator)
                this.clr0Animators[i] = clrAnimator;
        }
    }

    public calcIndTexMatrix(dst: mat2d, indIdx: number): void {
        const texMtxIdx: BRRES.TexMtxIndex = BRRES.TexMtxIndex.IND0 + indIdx;
        if (this.srt0Animators[texMtxIdx]) {
            this.srt0Animators[texMtxIdx].calcIndTexMtx(dst);
        } else {
            mat2d.copy(dst, this.material.indTexMatrices[indIdx]);
        }
    }

    public calcTexMatrix(dst: mat4, texIdx: number): void {
        const texMtxIdx: BRRES.TexMtxIndex = BRRES.TexMtxIndex.TEX0 + texIdx;
        if (this.srt0Animators[texMtxIdx]) {
            this.srt0Animators[texMtxIdx].calcTexMtx(matrixScratch);
        } else {
            mat4.copy(dst, this.material.texSrts[texMtxIdx].srtMtx);
        }
    }

    public calcMaterialParams(materialParams: MaterialParams): void {
        const calcColor = (i: ColorKind, fallbackColor: GX_Material.Color, a: BRRES.AnimatableColor) => {
            const dst = materialParams.u_Color[i];
            let color: GX_Material.Color;
            if (this.modelInstance && this.modelInstance.colorOverrides[i]) {
                color = this.modelInstance.colorOverrides[i];
            } else {
                color = fallbackColor;
            }

            if (this.clr0Animators[a]) {
                this.clr0Animators[a].calcColor(dst, color);
            } else {
                dst.copy(color);
            }
        };

        calcColor(ColorKind.MAT0, this.material.colorMatRegs[0], BRRES.AnimatableColor.MAT0);
        calcColor(ColorKind.MAT1, this.material.colorMatRegs[1], BRRES.AnimatableColor.MAT1);
        calcColor(ColorKind.AMB0, this.material.colorAmbRegs[0], BRRES.AnimatableColor.AMB0);
        calcColor(ColorKind.AMB1, this.material.colorAmbRegs[1], BRRES.AnimatableColor.AMB1);

        calcColor(ColorKind.K0, this.material.colorConstants[0], BRRES.AnimatableColor.K0);
        calcColor(ColorKind.K1, this.material.colorConstants[1], BRRES.AnimatableColor.K1);
        calcColor(ColorKind.K2, this.material.colorConstants[2], BRRES.AnimatableColor.K2);
        calcColor(ColorKind.K3, this.material.colorConstants[3], BRRES.AnimatableColor.K3);

        calcColor(ColorKind.CPREV, this.material.colorRegisters[0], -1);
        calcColor(ColorKind.C0, this.material.colorRegisters[1], BRRES.AnimatableColor.C0);
        calcColor(ColorKind.C1, this.material.colorRegisters[2], BRRES.AnimatableColor.C1);
        calcColor(ColorKind.C2, this.material.colorRegisters[3], BRRES.AnimatableColor.C2);
    }

    public calcTextureMapping(dst: TextureMapping, name: string): void {
        this.textureHolder.fillTextureMapping(dst, name);
    }
}

const matrixScratch = mat4.create();
export class Command_Material {
    private renderFlags: RenderFlags;
    private program: GX_Material.GX_Program;
    private materialParams = new MaterialParams();
    private glSamplers: WebGLSampler[] = [];

    constructor(
        gl: WebGL2RenderingContext,
        public material: BRRES.MDL0_MaterialEntry,
        public materialHacks?: GX_Material.GXMaterialHacks,
    ) {
        this.program = new GX_Material.GX_Program(this.material.gxMaterial, this.materialHacks);
        this.program.name = this.material.name;
        this.renderFlags = GX_Material.translateRenderFlags(this.material.gxMaterial);

        this.translateSamplers(gl);
    }

    private translateSamplers(gl: WebGL2RenderingContext): void {
        for (let i = 0; i < 8; i++) {
            const sampler = this.material.samplers[i];
            if (!sampler)
                continue;

            const glSampler = gl.createSampler();
            gl.samplerParameteri(glSampler, gl.TEXTURE_MIN_FILTER, translateTexFilter(gl, sampler.minFilter));
            gl.samplerParameteri(glSampler, gl.TEXTURE_MAG_FILTER, translateTexFilter(gl, sampler.magFilter));
            gl.samplerParameteri(glSampler, gl.TEXTURE_WRAP_S, translateWrapMode(gl, sampler.wrapS));
            gl.samplerParameteri(glSampler, gl.TEXTURE_WRAP_T, translateWrapMode(gl, sampler.wrapT));

            this.glSamplers[i] = glSampler;
        }
    }

    private calcPostTexMatrix(dst: mat4, texIdx: number, state: RenderState, flipY: boolean, materialInstance: MaterialInstance): void {
        const texSrt = this.material.texSrts[texIdx];
        const flipYScale = flipY ? -1.0 : 1.0;

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

        // Apply effect matrix.
        mat4.mul(dst, texSrt.effectMtx, dst);

        // Calculate SRT.
        materialInstance.calcTexMatrix(matrixScratch, texIdx);

        // SRT matrices have translation in fourth component, but we want our matrix to have translation
        // in third component. Swap.
        const tx = matrixScratch[12];
        matrixScratch[12] = matrixScratch[8];
        matrixScratch[8] = tx;
        const ty = matrixScratch[13];
        matrixScratch[13] = matrixScratch[9];
        matrixScratch[9] = ty;

        mat4.mul(dst, matrixScratch, dst);
    }

    private calcIndTexMatrix(dst: mat2d, indIdx: number, materialInstance: MaterialInstance): void {
        materialInstance.calcIndTexMatrix(dst, indIdx);
    }

    private calcMaterialParams(materialParams: MaterialParams, state: RenderState, materialInstance: MaterialInstance): void {
        for (let i = 0; i < 8; i++) {
            const sampler = this.material.samplers[i];
            if (!sampler)
                continue;

            const m = materialParams.m_TextureMapping[i];
            materialInstance.calcTextureMapping(m, sampler.name);
            // Fill in sampler state.
            m.glSampler = this.glSamplers[i];
            m.lodBias = sampler.lodBias;
        }

        materialInstance.calcMaterialParams(materialParams);

        for (let i = 0; i < 8; i++)
            this.calcPostTexMatrix(materialParams.u_PostTexMtx[i], i, state, materialParams.m_TextureMapping[i].flipY, materialInstance);
        for (let i = 0; i < 3; i++)
            this.calcIndTexMatrix(materialParams.u_IndTexMtx[i], i, materialInstance);
    }

    public bindMaterial(state: RenderState, renderHelper: GXRenderHelper, materialInstance: MaterialInstance): void {
        state.useProgram(this.program);
        state.useFlags(this.renderFlags);

        this.calcMaterialParams(this.materialParams, state, materialInstance);

        renderHelper.bindMaterialParams(state, this.materialParams);
        renderHelper.bindMaterialTextures(state, this.materialParams, this.program);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.program.destroy(gl);
        this.glSamplers.forEach((sampler) => gl.deleteSampler(sampler));
    }
}

