
import { mat4, mat2d } from 'gl-matrix';

import { BMD, BMT, HierarchyNode, HierarchyType, MaterialEntry, Shape, ShapeDisplayFlags, TEX1_Sampler, TEX1_TextureData, DRW1MatrixKind, TTK1Animator, ANK1Animator, bindANK1Animator, TEX1 } from './j3d';
import { TTK1, bindTTK1Animator, TRK1, bindTRK1Animator, TRK1Animator, ANK1 } from './j3d';

import * as GX_Material from '../gx/gx_material';
import { MaterialParams, SceneParams, GXRenderHelper, PacketParams, GXShapeHelper, loadedDataCoalescer, fillSceneParamsFromRenderState, translateTexFilter, translateWrapMode, GXTextureHolder, ColorKind } from '../gx/gx_render';

import { RenderFlags, RenderState } from '../render';
import { computeViewMatrix, computeModelMatrixBillboard, computeModelMatrixYBillboard, computeViewMatrixSkybox, texEnvMtx } from '../Camera';
import BufferCoalescer, { CoalescedBuffers } from '../BufferCoalescer';
import { TextureMapping } from '../TextureHolder';
import AnimationController from '../AnimationController';
import { nArray } from '../util';
import { AABB, IntersectionState } from '../Geometry';

export class J3DTextureHolder extends GXTextureHolder<TEX1_TextureData> {
    public addJ3DTextures(gl: WebGL2RenderingContext, bmd: BMD, bmt: BMT = null) {
        this.addTextures(gl, bmd.tex1.textureDatas);
        if (bmt)
            this.addTextures(gl, bmt.tex1.textureDatas);
    }
}

function texProjPerspMtx(dst: mat4, fov: number, aspect: number, scaleS: number, scaleT: number, transS: number, transT: number): void {
    const cot = 1 / Math.tan(fov / 2);

    dst[0] = (cot / aspect) * scaleS;
    dst[4] = 0.0;
    dst[8] = -transS;
    dst[12] = 0.0;

    dst[1] = 0.0;
    dst[5] = cot * scaleT;
    dst[9] = -transT;
    dst[13] = 0.0;

    dst[2] = 0.0;
    dst[6] = 0.0;
    dst[10] = -1.0;
    dst[14] = 0.0;

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    dst[3] = 9999.0;
    dst[7] = 9999.0;
    dst[11] = 9999.0;
    dst[15] = 9999.0;
}

class ShapeInstanceState {
    public modelMatrix: mat4 = mat4.create();
    public matrixArray: mat4[] = [];
    public matrixVisibility: boolean[] = [];
    public isSkybox: boolean;
}

// TODO(jstpierre): Rename the Command_* classes. Is it even worth having the Command_* vs. Instance split anymore?

const scratchModelMatrix = mat4.create();
const scratchViewMatrix = mat4.create();
const posMtxVisibility: boolean[] = nArray(10, () => true);
class Command_Shape {
    private packetParams = new PacketParams();
    private shapeHelpers: GXShapeHelper[] = [];

    constructor(gl: WebGL2RenderingContext, private shape: Shape, coalescedBuffers: CoalescedBuffers[]) {
        this.shapeHelpers = shape.packets.map((packet) => {
            return new GXShapeHelper(gl, coalescedBuffers.shift(), this.shape.loadedVertexLayout, packet.loadedVertexData);
        })
    }

    public shouldDraw(state: RenderState, shapeInstanceState: ShapeInstanceState): boolean {
        for (let p = 0; p < this.shape.packets.length; p++) {
            const packet = this.shape.packets[p];
            for (let i = 0; i < packet.matrixTable.length; i++) {
                const matrixIndex = packet.matrixTable[i];

                if (matrixIndex === 0xFFFF)
                    continue;

                if (shapeInstanceState.matrixVisibility[matrixIndex])
                    return true;
            }
        }

        return false;
    }

    public draw(state: RenderState, renderHelper: GXRenderHelper, shapeInstanceState: ShapeInstanceState): void {
        const modelView = this.computeModelView(state, shapeInstanceState);

        let needsUpload = false;

        for (let p = 0; p < this.shape.packets.length; p++) {
            const packet = this.shape.packets[p];

            // Update our matrix table.
            for (let i = 0; i < packet.matrixTable.length; i++) {
                const matrixIndex = packet.matrixTable[i];

                // Leave existing matrix.
                if (matrixIndex === 0xFFFF)
                    continue;

                const posMtx = shapeInstanceState.matrixArray[matrixIndex];
                posMtxVisibility[i] = shapeInstanceState.matrixVisibility[matrixIndex];
                mat4.mul(this.packetParams.u_PosMtx[i], modelView, posMtx);
                needsUpload = true;
            }

            // If all matrices are invisible, we can cull.
            let packetVisible = false;
            for (let i = 0; i < posMtxVisibility.length; i++) {
                if (posMtxVisibility[i]) {
                    packetVisible = true;
                    break;
                }
            }

            if (!packetVisible)
                continue;

            if (needsUpload) {
                renderHelper.bindPacketParams(state, this.packetParams);
                needsUpload = false;
            }

            const shapeHelper = this.shapeHelpers[p];
            shapeHelper.draw(state);
        }

        state.renderStatisticsTracker.drawCallCount++;
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.shapeHelpers.forEach((shapeHelper) => shapeHelper.destroy(gl));
    }

    private computeModelView(state: RenderState, shapeInstanceState: ShapeInstanceState): mat4 {
        switch (this.shape.displayFlags) {
        case ShapeDisplayFlags.USE_PNMTXIDX:
        case ShapeDisplayFlags.NORMAL:
            // We always use PNMTXIDX in the normal case -- and we hardcode missing attributes to 0.
            mat4.copy(scratchModelMatrix, shapeInstanceState.modelMatrix);
            break;

        case ShapeDisplayFlags.BILLBOARD:
            computeModelMatrixBillboard(scratchModelMatrix, state.camera);
            mat4.mul(scratchModelMatrix, shapeInstanceState.modelMatrix, scratchModelMatrix);
            break;
        case ShapeDisplayFlags.Y_BILLBOARD:
            computeModelMatrixYBillboard(scratchModelMatrix, state.camera);
            mat4.mul(scratchModelMatrix, shapeInstanceState.modelMatrix, scratchModelMatrix);
            break;
        default:
            throw new Error("whoops");
        }

        if (shapeInstanceState.isSkybox) {
            computeViewMatrixSkybox(scratchViewMatrix, state.camera);
        } else {
            computeViewMatrix(scratchViewMatrix, state.camera);
        }

        mat4.mul(scratchViewMatrix, scratchViewMatrix, scratchModelMatrix);
        return scratchViewMatrix;
    }
}

export class Command_Material {
    private static matrixScratch = mat4.create();
    private static materialParams = new MaterialParams();

    public name: string;

    private renderFlags: RenderFlags;
    public program: GX_Material.GX_Program;

    constructor(private bmdModel: BMDModel, public material: MaterialEntry, hacks?: GX_Material.GXMaterialHacks) {
        this.name = material.name;
        this.program = new GX_Material.GX_Program(material.gxMaterial, hacks);
        this.program.name = this.name;
        this.renderFlags = GX_Material.translateRenderFlags(this.material.gxMaterial);
    }

    public bindMaterial(state: RenderState, renderHelper: GXRenderHelper, textureHolder: GXTextureHolder, materialInstance: MaterialInstance): void {
        state.useProgram(this.program);
        state.useFlags(this.renderFlags);

        const materialParams = Command_Material.materialParams;
        this.fillMaterialParams(materialParams, state, textureHolder, materialInstance);
        renderHelper.bindMaterialParams(state, materialParams);
        renderHelper.bindMaterialTextures(state, materialParams, this.program);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.program.destroy(gl);
    }

    private fillMaterialParams(materialParams: MaterialParams, state: RenderState, textureHolder: GXTextureHolder, materialInstance: MaterialInstance): void {
        // Bind color parameters.
        // TODO(jstpierre): Replace separate buffers with one large array in gx_render?
        materialInstance.fillMaterialParams(materialParams);

        // Bind textures.
        for (let i = 0; i < this.material.textureIndexes.length; i++) {
            const texIndex = this.material.textureIndexes[i];
            if (texIndex >= 0) {
                this.bmdModel.fillTextureMapping(materialParams.m_TextureMapping[i], textureHolder, texIndex);
            } else {
                materialParams.m_TextureMapping[i].glTexture = null;
            }
        }

        // Bind our texture matrices.
        const scratch = Command_Material.matrixScratch;
        for (let i = 0; i < this.material.texMatrices.length; i++) {
            const texMtx = this.material.texMatrices[i];
            if (texMtx === null)
                continue;

            const dst = materialParams.u_TexMtx[i];
            const flipY = materialParams.m_TextureMapping[i].flipY;
            const flipYScale = flipY ? -1.0 : 1.0;

            // First, compute input matrix.
            switch (texMtx.type) {
            case 0x00:
            case 0x01: // Delfino Plaza
            case 0x0B: // Luigi Circuit
            case 0x08: // Peach Beach.
                // No mapping.
                mat4.identity(dst);
                break;
            case 0x06: // Rainbow Road
            case 0x07: // Rainbow Road
                // Environment mapping. Uses the normal matrix.
                // Normal matrix. Emulated here by the view matrix with the translation lopped off...
                mat4.copy(dst, state.view);
                dst[12] = 0;
                dst[13] = 0;
                dst[14] = 0;
                break;
            case 0x09:
                // Projection. Used for indtexwater, mostly.
                mat4.copy(dst, state.view);
                break;
            default:
                throw "whoops";
            }

            // Now apply effects.
            switch(texMtx.type) {
            case 0x00:
            case 0x01:
            case 0x0B:
                break;
            case 0x06: // Rainbow Road
                // Environment mapping
                texEnvMtx(scratch, -0.5, -0.5 * flipYScale, 0.5, 0.5);
                mat4.mul(dst, scratch, dst);
                mat4.mul(dst, texMtx.effectMatrix, dst);
                break;
            case 0x07: // Rainbow Road
            case 0x08: // Peach Beach
                mat4.mul(dst, texMtx.effectMatrix, dst);
                texProjPerspMtx(scratch, state.fov, state.getAspect(), 0.5, -0.5 * flipYScale, 0.5, 0.5);
                mat4.mul(dst, scratch, dst);
                break;
            case 0x09: // Rainbow Road
                // Perspective.
                // Don't apply effectMatrix to perspective. It appears to be
                // a projection matrix preconfigured for GC.
                // mat4.mul(dst, texMtx.effectMatrix, dst);
                texProjPerspMtx(scratch, state.fov, state.getAspect(), 0.5, -0.5 * flipYScale, 0.5, 0.5);
                mat4.mul(dst, scratch, dst);
                break;
            default:
                throw "whoops";
            }

            // Apply SRT.
            materialInstance.calcTexMatrix(scratch, i);

            // SRT matrices have translation in fourth component, but we want our matrix to have translation
            // in third component. Swap.
            const tx = scratch[12];
            scratch[12] = scratch[8];
            scratch[8] = tx;
            const ty = scratch[13];
            scratch[13] = scratch[9];
            scratch[9] = ty;

            mat4.mul(dst, scratch, dst);
        }

        for (let i = 0; i < this.material.postTexMatrices.length; i++) {
            const postTexMtx = this.material.postTexMatrices[i];
            if (postTexMtx === null)
                continue;

            const finalMatrix = postTexMtx.matrix;
            mat4.copy(materialParams.u_PostTexMtx[i], finalMatrix);
        }

        for (let i = 0; i < this.material.indTexMatrices.length; i++) {
            const indTexMtx = this.material.indTexMatrices[i];
            if (indTexMtx === null)
                continue;

            const a = indTexMtx[0], c = indTexMtx[1], tx = indTexMtx[2];
            const b = indTexMtx[3], d = indTexMtx[4], ty = indTexMtx[5];
            mat2d.set(materialParams.u_IndTexMtx[i], a, b, c, d, tx, ty);
        }
    }
}

const matrixScratch = mat4.create(), matrixScratch2 = mat4.create();

export class MaterialInstance {
    public ttk1Animators: TTK1Animator[] = [];
    public trk1Animators: TRK1Animator[] = [];

    constructor(private modelInstance: BMDModelInstance | null, private material: MaterialEntry) {
    }

    public bindTTK1(animationController: AnimationController, ttk1: TTK1): void {
        for (let i = 0; i < 8; i++) {
            const ttk1Animator = bindTTK1Animator(animationController, ttk1, this.material.name, i);
            if (ttk1Animator)
                this.ttk1Animators[i] = ttk1Animator;
        }
    }

    public bindTRK1(animationController: AnimationController, trk1: TRK1): void {
        for (let i: ColorKind = 0; i < ColorKind.COUNT; i++) {
            const trk1Animator = bindTRK1Animator(animationController, trk1, this.material.name, i);
            if (trk1Animator)
                this.trk1Animators[i] = trk1Animator;
        }
    }

    public fillMaterialParams(materialParams: MaterialParams): void {
        const copyColor = (i: ColorKind, fallbackColor: GX_Material.Color) => {
            const dst = materialParams.u_Color[i];

            if (this.trk1Animators[i] !== undefined) {
                this.trk1Animators[i].calcColor(dst);
                return;
            }

            let color: GX_Material.Color;
            if (this.modelInstance !== null && this.modelInstance.colorOverrides[i] !== undefined) {
                color = this.modelInstance.colorOverrides[i];
            } else {
                color = fallbackColor;
            }

            let alpha: number;
            if (this.modelInstance !== null && this.modelInstance.alphaOverrides[i]) {
                alpha = color.a;
            } else {
                alpha = fallbackColor.a;
            }
    
            dst.copy(color, alpha);
        };

        copyColor(ColorKind.MAT0, this.material.colorMatRegs[0]);
        copyColor(ColorKind.MAT1, this.material.colorMatRegs[1]);
        copyColor(ColorKind.AMB0, this.material.colorAmbRegs[0]);
        copyColor(ColorKind.AMB1, this.material.colorAmbRegs[1]);

        copyColor(ColorKind.K0, this.material.colorConstants[0]);
        copyColor(ColorKind.K1, this.material.colorConstants[1]);
        copyColor(ColorKind.K2, this.material.colorConstants[2]);
        copyColor(ColorKind.K3, this.material.colorConstants[3]);

        copyColor(ColorKind.CPREV, this.material.colorRegisters[0]);
        copyColor(ColorKind.C0, this.material.colorRegisters[1]);
        copyColor(ColorKind.C1, this.material.colorRegisters[2]);
        copyColor(ColorKind.C2, this.material.colorRegisters[3]);
    }

    public calcTexMatrix(dst: mat4, i: number): void {
        if (this.ttk1Animators[i] !== undefined) {
            this.ttk1Animators[i].calcTexMtx(dst);
        } else {
            mat4.copy(dst, this.material.texMatrices[i].matrix);
        }
    }
}

class DrawListItem {
    constructor(
        public materialIndex: number,
        public shapeCommands: Command_Shape[] = [],
    ) {
    }
}

export class BMDModel {
    private realized: boolean = false;

    private glSamplers!: WebGLSampler[];
    private tex1Samplers!: TEX1_Sampler[];

    private bufferCoalescer: BufferCoalescer;

    public materialCommands: Command_Material[] = [];
    public shapeCommands: Command_Shape[] = [];
    public opaqueDrawList: DrawListItem[] = [];
    public transparentDrawList: DrawListItem[] = [];
    public hasBillboard: boolean;

    constructor(
        gl: WebGL2RenderingContext,
        public bmd: BMD,
        public bmt: BMT | null = null,
        public materialHacks?: GX_Material.GXMaterialHacks
    ) {
        const mat3 = (bmt !== null && bmt.mat3 !== null) ? bmt.mat3 : bmd.mat3;
        const tex1 = (bmt !== null && bmt.tex1 !== null) ? bmt.tex1 : bmd.tex1;

        this.tex1Samplers = tex1.samplers;
        this.glSamplers = this.tex1Samplers.map((sampler) => BMDModel.translateSampler(gl, sampler));

        // Load material data.
        this.materialCommands = mat3.materialEntries.map((material) => {
            return new Command_Material(this, material, this.materialHacks);
        });

        // Load shape data.
        const loadedVertexDatas = [];
        for (const shape of bmd.shp1.shapes)
            for (const packet of shape.packets)
                loadedVertexDatas.push(packet.loadedVertexData);
        this.bufferCoalescer = loadedDataCoalescer(gl, loadedVertexDatas);
        this.shapeCommands = bmd.shp1.shapes.map((shape, i) => {
            return new Command_Shape(gl, shape, this.bufferCoalescer.coalescedBuffers);
        });

        // Look for billboards.
        for (const shape of bmd.shp1.shapes) {
            if (shape.displayFlags === ShapeDisplayFlags.BILLBOARD || shape.displayFlags === ShapeDisplayFlags.Y_BILLBOARD)
                this.hasBillboard = true;
        }

        // Load scene graph.
        this.translateSceneGraph(bmd.inf1.sceneGraph, null);
        this.realized = true;
    }

    public destroy(gl: WebGL2RenderingContext): void {
        if (!this.realized)
            return;

        this.bufferCoalescer.destroy(gl);
        this.materialCommands.forEach((command) => command.destroy(gl));
        this.shapeCommands.forEach((command) => command.destroy(gl));
        this.glSamplers.forEach((sampler) => gl.deleteSampler(sampler));
        this.realized = false;
    }

    public fillTextureMapping(m: TextureMapping, textureHolder: GXTextureHolder, texIndex: number): void {
        const tex1Sampler = this.tex1Samplers[texIndex];
        textureHolder.fillTextureMapping(m, tex1Sampler.name);
        m.glSampler = this.glSamplers[tex1Sampler.index];
        m.lodBias = tex1Sampler.lodBias;
    }

    private static translateSampler(gl: WebGL2RenderingContext, sampler: TEX1_Sampler): WebGLSampler {
        const glSampler = gl.createSampler();
        gl.samplerParameteri(glSampler, gl.TEXTURE_MIN_FILTER, translateTexFilter(gl, sampler.minFilter));
        gl.samplerParameteri(glSampler, gl.TEXTURE_MAG_FILTER, translateTexFilter(gl, sampler.magFilter));
        gl.samplerParameteri(glSampler, gl.TEXTURE_WRAP_S, translateWrapMode(gl, sampler.wrapS));
        gl.samplerParameteri(glSampler, gl.TEXTURE_WRAP_T, translateWrapMode(gl, sampler.wrapT));
        gl.samplerParameterf(glSampler, gl.TEXTURE_MIN_LOD, sampler.minLOD);
        gl.samplerParameterf(glSampler, gl.TEXTURE_MAX_LOD, sampler.maxLOD);
        return glSampler;
    }

    private translateSceneGraph(node: HierarchyNode, drawListItem: DrawListItem | null): void {
        switch (node.type) {
        case HierarchyType.Shape:
            drawListItem!.shapeCommands.push(this.shapeCommands[node.shapeIdx]);
            break;
        case HierarchyType.Material:
            const materialCommand = this.materialCommands[node.materialIdx];
            drawListItem = new DrawListItem(node.materialIdx);
            if (materialCommand.material.translucent)
                this.transparentDrawList.push(drawListItem);
            else
                this.opaqueDrawList.push(drawListItem);
            break;
        }

        for (const child of node.children)
            this.translateSceneGraph(child, drawListItem);
    }
}

const enum MatrixCalcFlags {
    // No special transformation.
    NORMAL = 0,
    // View translation modified.
    VIEW_TRANSLATION_CHANGED = 1 << 0,
    // View rotation modified.
    VIEW_ROTATION_CHANGED = 1 << 1,
}

export class BMDModelInstance {
    public name: string = '';
    public visible: boolean = true;
    public isSkybox: boolean = false;
    public fps: number = 30;

    public modelMatrix: mat4;

    public colorOverrides: GX_Material.Color[] = [];
    public alphaOverrides: boolean[] = [];
    public renderHelper: GXRenderHelper;
    private sceneParams = new SceneParams();

    // Animations.
    private animationController: AnimationController = new AnimationController();
    public ank1Animator: ANK1Animator | null = null;

    public currentMaterialCommand: Command_Material;

    // Temporary state when calculating bone matrices.
    private jointMatrices: mat4[];
    private jointVisibility: boolean[];
    private bboxScratch: AABB = new AABB();

    private materialInstances: MaterialInstance[] = [];
    private shapeInstanceState: ShapeInstanceState = new ShapeInstanceState();

    constructor(
        gl: WebGL2RenderingContext,
        private textureHolder: J3DTextureHolder,
        private bmdModel: BMDModel,
    ) {
        this.renderHelper = new GXRenderHelper(gl);
        this.modelMatrix = mat4.create();

        this.materialInstances = this.bmdModel.materialCommands.map((materialCommand) => {
            return new MaterialInstance(this, materialCommand.material);
        });

        const numJoints = this.bmdModel.bmd.jnt1.joints.length;
        this.jointMatrices = nArray(numJoints, () => mat4.create());
        this.jointVisibility = nArray(numJoints, () => true);

        const numMatrices = this.bmdModel.bmd.drw1.matrixDefinitions.length;
        this.shapeInstanceState.matrixArray = nArray(numMatrices, () => mat4.create());
        this.shapeInstanceState.matrixVisibility = nArray(numMatrices, () => true);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.bmdModel.destroy(gl);
        this.renderHelper.destroy(gl);
    }

    public setColorOverride(i: ColorKind, color: GX_Material.Color, useAlpha: boolean = false): void {
        this.colorOverrides[i] = color;
        this.alphaOverrides[i] = useAlpha;
    }

    public setIsSkybox(v: boolean): void {
        this.isSkybox = v;
    }

    public setFPS(v: number): void {
        this.fps = v;
    }

    public setVisible(v: boolean): void {
        this.visible = v;
    }

    /**
     * Binds {@param ttk1} (texture animations) to this model renderer.
     * TTK1 objects can be parsed from {@link BTK} files. See {@link BTK.parse}.
     */
    public bindTTK1(ttk1: TTK1): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindTTK1(this.animationController, ttk1);
    }

    /**
     * Binds {@param trk1} (color register animations) to this model renderer.
     * TRK1 objects can be parsed from {@link BRK} files. See {@link BRK.parse}.
     */
    public bindTRK1(trk1: TRK1): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindTRK1(this.animationController, trk1);
    }

    /**
     * Binds {@param ank1} (joint animations) to this model renderer.
     * ANK1 objects can be parsed from {@link BCK} files. See {@link BCK.parse}.
     */
    public bindANK1(ank1: ANK1): void {
        this.ank1Animator = bindANK1Animator(this.animationController, ank1);
    }

    public getTimeInFrames(milliseconds: number) {
        return (milliseconds / 1000) * this.fps;
    }

    public bindState(state: RenderState): boolean {
        if (!this.visible)
            return false;

        // XXX(jstpierre): Is this the right place to do this? Need an explicit update call...
        this.animationController.updateTime(state.time);

        // Skyboxes implicitly center themselves around the view matrix (their view translation is removed).
        // While we could represent this, a skybox is always visible in theory so it's probably not worth it
        // to cull. If we ever have a fancy skybox model, then it might be worth it to represent it in world-space.
        //
        // Billboards have their view matrix modified to face the camera, so their world space position doesn't
        // quite match what they kind of do.
        //
        // For now, we simply don't cull both of these special cases, hoping they'll be simple enough to just always
        // render. In theory, we could cull billboards using the bounding sphere.
        const matrixCalcFlags: MatrixCalcFlags = (
            (this.isSkybox ? MatrixCalcFlags.VIEW_TRANSLATION_CHANGED : 0) |
            (this.bmdModel.hasBillboard ? MatrixCalcFlags.VIEW_TRANSLATION_CHANGED : 0)
        );

        // First, update joint matrices from hierarchy.
        //
        // then the root bone is taken from the model matrix. Otherwise, we apply it
        // to the shape for use there.
        if (matrixCalcFlags === MatrixCalcFlags.NORMAL) {
            mat4.copy(matrixScratch, this.modelMatrix);
            mat4.identity(this.shapeInstanceState.modelMatrix);
        } else {
            mat4.identity(matrixScratch);
            mat4.copy(this.shapeInstanceState.modelMatrix, this.modelMatrix);
        }

        this.shapeInstanceState.isSkybox = this.isSkybox;
        this.updateMatrixArray(state, matrixScratch, matrixCalcFlags);

        // If entire model is culled away, then we don't need to render anything.
        if (!this.shapeInstanceState.matrixVisibility.some((visible) => visible))
            return false;

        this.renderHelper.bindUniformBuffers(state);

        fillSceneParamsFromRenderState(this.sceneParams, state);
        this.renderHelper.bindSceneParams(state, this.sceneParams);

        return true;
    }

    private renderDrawList(state: RenderState, drawList: DrawListItem[]): void {
        for (let i = 0; i < drawList.length; i++) {
            const drawListItem = drawList[i];
            const shouldDraw = drawListItem.shapeCommands.some((shapeCommand) => {
                return shapeCommand.shouldDraw(state, this.shapeInstanceState);
            });

            if (!shouldDraw)
                continue;

            const materialIndex = drawListItem.materialIndex;
            const materialInstance = this.materialInstances[materialIndex];
            const materialCommand = this.bmdModel.materialCommands[materialIndex];
            materialCommand.bindMaterial(state, this.renderHelper, this.textureHolder, materialInstance);

            for (let j = 0; j < drawListItem.shapeCommands.length; j++) {
                const shapeCommand = drawListItem.shapeCommands[j];
                shapeCommand.draw(state, this.renderHelper, this.shapeInstanceState);
            }
        }
    }

    public renderOpaque(state: RenderState): void {
        this.renderDrawList(state, this.bmdModel.opaqueDrawList);
    }

    public renderTransparent(state: RenderState): void {
        this.renderDrawList(state, this.bmdModel.transparentDrawList);
    }

    public render(state: RenderState): void {
        if (!this.bindState(state))
            return;

        this.renderOpaque(state);
        this.renderTransparent(state);
    }

    private updateJointMatrixHierarchy(state: RenderState, node: HierarchyNode, parentJointMatrix: mat4, matrixCalcFlags: MatrixCalcFlags): void {
        // TODO(jstpierre): Don't pointer chase when traversing hierarchy every frame...
        const jnt1 = this.bmdModel.bmd.jnt1;
        const bbox = this.bboxScratch;

        switch (node.type) {
        case HierarchyType.Joint:
            const jointIndex = node.jointIdx;

            let jointMatrix: mat4;
            if (this.ank1Animator !== null && this.ank1Animator.calcJointMatrix(matrixScratch2, jointIndex)) {
                jointMatrix = matrixScratch2;
            } else {
                jointMatrix = jnt1.joints[jointIndex].matrix;
            }

            const dstJointMatrix = this.jointMatrices[jointIndex];
            mat4.mul(dstJointMatrix, parentJointMatrix, jointMatrix);

            if (matrixCalcFlags === MatrixCalcFlags.NORMAL) {
                // Frustum cull.
                // Note to future self: joint bboxes do *not* contain their child joints (see: trees in Super Mario Sunshine).
                // You *cannot* use PARTIAL_INTERSECTION to optimize frustum culling.
                bbox.transform(jnt1.joints[jointIndex].bbox, dstJointMatrix);
                const intersectionState = state.camera.frustum.intersect(bbox);
                this.jointVisibility[jointIndex] = intersectionState !== IntersectionState.FULLY_OUTSIDE;
            } else {
                this.jointVisibility[jointIndex] = true;
            }

            for (let i = 0; i < node.children.length; i++)
                this.updateJointMatrixHierarchy(state, node.children[i], dstJointMatrix, matrixCalcFlags);
            break;
        default:
            // Pass through.
            for (let i = 0; i < node.children.length; i++)
                this.updateJointMatrixHierarchy(state, node.children[i], parentJointMatrix, matrixCalcFlags);
            break;
        }
    }

    private updateMatrixArray(state: RenderState, modelMatrix: mat4, matrixCalcFlags: MatrixCalcFlags): void {
        const inf1 = this.bmdModel.bmd.inf1;
        const drw1 = this.bmdModel.bmd.drw1;
        const evp1 = this.bmdModel.bmd.evp1;

        this.updateJointMatrixHierarchy(state, inf1.sceneGraph, modelMatrix, matrixCalcFlags);

        // Now update our matrix definition array.
        for (let i = 0; i < drw1.matrixDefinitions.length; i++) {
            const matrixDefinition = drw1.matrixDefinitions[i];
            const dst = this.shapeInstanceState.matrixArray[i];
            if (matrixDefinition.kind === DRW1MatrixKind.Joint) {
                const matrixVisible = this.jointVisibility[matrixDefinition.jointIndex];
                this.shapeInstanceState.matrixVisibility[i] = matrixVisible;
                mat4.copy(dst, this.jointMatrices[matrixDefinition.jointIndex]);
            } else if (matrixDefinition.kind === DRW1MatrixKind.Envelope) {
                dst.fill(0);
                const envelope = evp1.envelopes[matrixDefinition.envelopeIndex];

                let matrixVisible = false;
                for (let i = 0; i < envelope.weightedBones.length; i++) {
                    const weightedBone = envelope.weightedBones[i];
                    if (this.jointVisibility[weightedBone.index]) {
                        matrixVisible = true;
                        break;
                    }
                }

                this.shapeInstanceState.matrixVisibility[i] = matrixVisible;

                for (let i = 0; i < envelope.weightedBones.length; i++) {
                    const weightedBone = envelope.weightedBones[i];
                    const inverseBindPose = evp1.inverseBinds[weightedBone.index];
                    mat4.mul(matrixScratch, this.jointMatrices[weightedBone.index], inverseBindPose);
                    mat4.multiplyScalarAndAdd(dst, dst, matrixScratch, weightedBone.weight);
                }
            }
        }
    }
}
