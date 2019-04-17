
import * as BRRES from './brres';

import * as GX_Material from '../gx/gx_material';
import { mat4, mat2d, vec3 } from "gl-matrix";
import { MaterialParams, GXTextureHolder, ColorKind, translateTexFilterGfx, translateWrapModeGfx, loadedDataCoalescerGfx, GXRenderHelperGfx, GXShapeHelperGfx, GXMaterialHelperGfx, PacketParams } from "../gx/gx_render";
import { texProjPerspMtx, texEnvMtx, computeViewMatrix, computeViewMatrixSkybox, Camera, computeViewSpaceDepthFromWorldSpaceAABB } from "../Camera";
import AnimationController from "../AnimationController";
import { TextureMapping } from "../TextureHolder";
import { IntersectionState, AABB } from "../Geometry";
import { GfxDevice, GfxSampler } from "../gfx/platform/GfxPlatform";
import { ViewerRenderInput } from "../viewer";
import { GfxRenderInst, GfxRenderInstBuilder, GfxRendererLayer, makeSortKey, setSortKeyDepth, setSortKeyBias } from "../gfx/render/GfxRenderer";
import { GfxBufferCoalescer } from '../gfx/helpers/BufferHelpers';
import { assert, nArray } from '../util';
import { prepareFrameDebugOverlayCanvas2D, getDebugOverlayCanvas2D, drawWorldSpaceLine } from '../DebugJunk';

export class RRESTextureHolder extends GXTextureHolder<BRRES.TEX0> {
    public addRRESTextures(device: GfxDevice, rres: BRRES.RRES): void {
        this.addTextures(device, rres.tex0);
    }
}

export class MDL0Model {
    public shapeData: GXShapeHelperGfx[] = [];
    public materialData: MaterialData[] = [];
    private bufferCoalescer: GfxBufferCoalescer;

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, public mdl0: BRRES.MDL0, private materialHacks: GX_Material.GXMaterialHacks | null = null) {
        this.bufferCoalescer = loadedDataCoalescerGfx(device, this.mdl0.shapes.map((shape) => shape.loadedVertexData));
 
        for (let i = 0; i < this.mdl0.shapes.length; i++) {
            const shape = this.mdl0.shapes[i];
            this.shapeData[i] = new GXShapeHelperGfx(device, renderHelper, this.bufferCoalescer.coalescedBuffers[i], shape.loadedVertexLayout, shape.loadedVertexData);
        }

        for (let i = 0; i < this.mdl0.materials.length; i++) {
            const material = this.mdl0.materials[i];
            this.materialData[i] = new MaterialData(device, material, this.materialHacks);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.shapeData.length; i++)
            this.shapeData[i].destroy(device);
        for (let i = 0; i < this.materialData.length; i++)
            this.materialData[i].destroy(device);
        this.bufferCoalescer.destroy(device);
    }
}

const bboxScratch = new AABB();
const packetParams = new PacketParams();
class ShapeInstance {
    public renderInsts: GfxRenderInst[] = [];
    public sortKeyBias = 0;
    private visible = true;

    constructor(public shape: BRRES.MDL0_ShapeEntry, public shapeData: GXShapeHelperGfx, public node: BRRES.MDL0_NodeEntry) {
    }

    public buildRenderInst(renderInstBuilder: GfxRenderInstBuilder, namePrefix: string): void {
        for (let i = 0; i < this.shape.loadedVertexData.packets.length; i++) {
            const packet = this.shape.loadedVertexData.packets[i];
            const renderInst = this.shapeData.buildRenderInstPacket(renderInstBuilder, packet);
            renderInst.name = `${namePrefix}/${this.shape.name}/${i}`;
            renderInstBuilder.pushRenderInst(renderInst);
            this.renderInsts.push(renderInst);
        }
    }

    private computeModelView(dst: mat4, modelMatrix: mat4, camera: Camera, isSkybox: boolean): void {
        if (isSkybox) {
            computeViewMatrixSkybox(dst, camera);
        } else {
            computeViewMatrix(dst, camera);
        }

        mat4.mul(dst, dst, modelMatrix);
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx, depth: number, viewerInput: ViewerRenderInput, matrixArray: mat4[], matrixVisibility: IntersectionState[], isSkybox: boolean): void {
        const visible = this.visible && this.node.visible && depth >= 0;

        packetParams.clear();
        for (let p = 0; p < this.shape.loadedVertexData.packets.length; p++) {
            const packet = this.shape.loadedVertexData.packets[p];
            const renderInst = this.renderInsts[p];

            const camera = viewerInput.camera;
            const modelMatrix = matrixArray[this.node.mtxId];

            let instVisible = false;
            if (visible) {
                if (this.shape.mtxIdx < 0) {
                    for (let j = 0; j < packet.posNrmMatrixTable.length; j++) {
                        const mtxIdx = packet.posNrmMatrixTable[j];

                        // Leave existing matrix.
                        if (mtxIdx === 0xFFFF)
                            continue;

                        this.computeModelView(packetParams.u_PosMtx[j], matrixArray[mtxIdx], camera, isSkybox);

                        if (matrixVisibility[j] !== IntersectionState.FULLY_OUTSIDE)
                            instVisible = true;
                    }
                } else {
                    instVisible = true;
                    this.computeModelView(packetParams.u_PosMtx[0], modelMatrix, camera, isSkybox);
                }
            }

            renderInst.visible = instVisible;
            if (instVisible) {
                renderInst.sortKey = setSortKeyDepth(renderInst.parentRenderInst.sortKey, depth);
                renderInst.sortKey = setSortKeyBias(renderInst.sortKey, this.sortKeyBias);
                this.shapeData.fillPacketParams(packetParams, renderInst, renderHelper);
            }
        }
    }
}

class MaterialInstance {
    private srt0Animators: BRRES.SRT0TexMtxAnimator[] = [];
    private pat0Animators: BRRES.PAT0TexAnimator[] = [];
    private clr0Animators: BRRES.CLR0ColorAnimator[] = [];
    private materialParams = new MaterialParams();
    private materialHelper: GXMaterialHelperGfx;
    public templateRenderInst: GfxRenderInst;

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, private modelInstance: MDL0ModelInstance, public materialData: MaterialData) {
        this.materialHelper = new GXMaterialHelperGfx(device, renderHelper, materialData.material.gxMaterial, materialData.materialHacks);
        this.templateRenderInst = this.materialHelper.templateRenderInst;
        this.templateRenderInst.name = this.materialData.material.name;
        const layer = this.materialData.material.translucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.setSortKeyLayer(layer);
    }

    public setSortKeyLayer(layer: GfxRendererLayer): void {
        if (this.materialData.material.translucent)
            layer |= GfxRendererLayer.TRANSLUCENT;
        this.templateRenderInst.sortKey = makeSortKey(layer);
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.materialHelper.setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        this.materialHelper.setTexturesEnabled(v);
    }

    public bindSRT0(animationController: AnimationController, srt0: BRRES.SRT0): void {
        const material = this.materialData.material;
        for (let i: BRRES.TexMtxIndex = 0; i < BRRES.TexMtxIndex.COUNT; i++) {
            const srtAnimator = BRRES.bindSRT0Animator(animationController, srt0, material.name, i);
            if (srtAnimator)
                this.srt0Animators[i] = srtAnimator;
        }
    }

    public bindPAT0(animationController: AnimationController, pat0: BRRES.PAT0): void {
        const material = this.materialData.material;
        for (let i = 0; i < 8; i++) {
            const patAnimator = BRRES.bindPAT0Animator(animationController, pat0, material.name, i);
            if (patAnimator)
                this.pat0Animators[i] = patAnimator;
        }
    }

    public bindCLR0(animationController: AnimationController, clr0: BRRES.CLR0): void {
        const material = this.materialData.material;
        for (let i = 0; i < BRRES.AnimatableColor.COUNT; i++) {
            const clrAnimator = BRRES.bindCLR0Animator(animationController, clr0, material.name, i);
            if (clrAnimator)
                this.clr0Animators[i] = clrAnimator;
        }
    }

    public calcIndTexMatrix(dst: mat2d, indIdx: number): void {
        const material = this.materialData.material;
        const texMtxIdx: BRRES.TexMtxIndex = BRRES.TexMtxIndex.IND0 + indIdx;
        if (this.srt0Animators[texMtxIdx]) {
            this.srt0Animators[texMtxIdx].calcIndTexMtx(dst);
        } else {
            mat2d.copy(dst, material.indTexMatrices[indIdx]);
        }
    }

    public calcTexMatrix(dst: mat4, texIdx: number): void {
        const material = this.materialData.material;
        const texMtxIdx: BRRES.TexMtxIndex = BRRES.TexMtxIndex.TEX0 + texIdx;
        if (this.srt0Animators[texMtxIdx]) {
            this.srt0Animators[texMtxIdx].calcTexMtx(matrixScratch);
        } else {
            mat4.copy(dst, material.texSrts[texMtxIdx].srtMtx);
        }
    }

    private calcPostTexMatrix(dst: mat4, texIdx: number, viewerInput: ViewerRenderInput, flipY: boolean): void {
        const material = this.materialData.material;
        const texSrt = material.texSrts[texIdx];
        const flipYScale = flipY ? -1.0 : 1.0;

        if (texSrt.mapMode === BRRES.MapMode.PROJECTION) {
            const camera = viewerInput.camera;
            texProjPerspMtx(dst, camera.fovY, camera.aspect, 0.5, -0.5 * flipYScale, 0.5, 0.5);

            // XXX(jstpierre): ZSS hack. Reference camera 31 is set up by the game to be an overhead
            // camera for clouds. Kill it until we can emulate the camera system in this game...
            // XXX(jstpierre): Klonoa uses camera 1 for clouds.
            if (texSrt.refCamera === 31 || texSrt.refCamera === 1) {
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
        this.calcTexMatrix(matrixScratch, texIdx);

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

    public fillMaterialParams(materialParams: MaterialParams, textureHolder: GXTextureHolder, viewerInput: ViewerRenderInput): void {
        const material = this.materialData.material;

        for (let i = 0; i < 8; i++) {
            const m = materialParams.m_TextureMapping[i];
            m.reset();

            const sampler = material.samplers[i];
            if (!sampler)
                continue;

            this.fillTextureMapping(m, textureHolder, i);
            // Fill in sampler state.
            m.gfxSampler = this.materialData.gfxSamplers[i];
            m.lodBias = sampler.lodBias;
        }

        for (let i = 0; i < 8; i++)
            this.calcPostTexMatrix(materialParams.u_PostTexMtx[i], i, viewerInput, materialParams.m_TextureMapping[i].flipY);
        for (let i = 0; i < 3; i++)
            this.calcIndTexMatrix(materialParams.u_IndTexMtx[i], i);

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

        calcColor(ColorKind.MAT0, material.colorMatRegs[0], BRRES.AnimatableColor.MAT0);
        calcColor(ColorKind.MAT1, material.colorMatRegs[1], BRRES.AnimatableColor.MAT1);
        calcColor(ColorKind.AMB0, material.colorAmbRegs[0], BRRES.AnimatableColor.AMB0);
        calcColor(ColorKind.AMB1, material.colorAmbRegs[1], BRRES.AnimatableColor.AMB1);

        calcColor(ColorKind.K0, material.colorConstants[0], BRRES.AnimatableColor.K0);
        calcColor(ColorKind.K1, material.colorConstants[1], BRRES.AnimatableColor.K1);
        calcColor(ColorKind.K2, material.colorConstants[2], BRRES.AnimatableColor.K2);
        calcColor(ColorKind.K3, material.colorConstants[3], BRRES.AnimatableColor.K3);

        calcColor(ColorKind.CPREV, material.colorRegisters[0], -1);
        calcColor(ColorKind.C0, material.colorRegisters[1], BRRES.AnimatableColor.C0);
        calcColor(ColorKind.C1, material.colorRegisters[2], BRRES.AnimatableColor.C1);
        calcColor(ColorKind.C2, material.colorRegisters[3], BRRES.AnimatableColor.C2);
    }

    private fillTextureMapping(dst: TextureMapping, textureHolder: GXTextureHolder, i: number): void {
        const material = this.materialData.material;
        dst.reset();
        if (this.pat0Animators[i]) {
            this.pat0Animators[i].fillTextureMapping(dst, textureHolder);
        } else {
            const name: string = material.samplers[i].name;
            textureHolder.fillTextureMapping(dst, name);
        }
        dst.gfxSampler = this.materialData.gfxSamplers[i];
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx, textureHolder: GXTextureHolder, viewerInput: ViewerRenderInput): void {
        this.fillMaterialParams(this.materialParams, textureHolder, viewerInput);
        this.templateRenderInst.setSamplerBindingsFromTextureMappings(this.materialParams.m_TextureMapping);
        this.materialHelper.fillMaterialParams(this.materialParams, renderHelper);
    }

    public destroy(device: GfxDevice): void {
        this.materialHelper.destroy(device);
    }
}

const matrixScratchArray = nArray(128, () => mat4.create());
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
export class MDL0ModelInstance {
    private shapeInstances: ShapeInstance[] = [];
    private materialInstances: MaterialInstance[] = [];
    private chr0NodeAnimator: BRRES.CHR0NodesAnimator;

    private matrixVisibility: IntersectionState[] = [];
    private matrixArray: mat4[] = [];
    private matrixScratch: mat4 = mat4.create();
    private debugBones = false;

    public colorOverrides: GX_Material.Color[] = [];

    public modelMatrix: mat4 = mat4.create();
    public visible: boolean = true;
    public name: string;
    public isSkybox: boolean = false;
    public passMask: number = 1;
    public templateRenderInst: GfxRenderInst;

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, public textureHolder: GXTextureHolder, public mdl0Model: MDL0Model, public namePrefix: string = '') {
        this.name = `${namePrefix}/${mdl0Model.mdl0.name}`;

        this.matrixArray = nArray(mdl0Model.mdl0.numWorldMtx, () => mat4.create());
        while (matrixScratchArray.length < this.matrixArray.length)
            matrixScratchArray.push(mat4.create());

        this.templateRenderInst = renderHelper.renderInstBuilder.pushTemplateRenderInst();
        this.templateRenderInst.name = this.name;
        for (let i = 0; i < this.mdl0Model.materialData.length; i++)
            this.materialInstances[i] = new MaterialInstance(device, renderHelper, this, this.mdl0Model.materialData[i]);
        this.execDrawOpList(renderHelper, this.mdl0Model.mdl0.sceneGraph.drawOpaOps, false);
        this.execDrawOpList(renderHelper, this.mdl0Model.mdl0.sceneGraph.drawXluOps, true);
        renderHelper.renderInstBuilder.popTemplateRenderInst();
    }

    public setSortKeyLayer(layer: GfxRendererLayer): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setSortKeyLayer(layer);
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setTexturesEnabled(v);
    }

    public bindCHR0(animationController: AnimationController, chr0: BRRES.CHR0): void {
        this.chr0NodeAnimator = BRRES.bindCHR0Animator(animationController, chr0, this.mdl0Model.mdl0.nodes);
    }

    /**
     * Binds {@param srt0} (texture animations) to this model instance.
     *
     * @param animationController An {@link AnimationController} to control the progress of this animation to.
     * By default, this will default to this instance's own {@member animationController}.
     */
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

    /**
     * Binds all animations in {@param rres} that are named {@param name} to this model instance.
     *
     * @param animationController An {@link AnimationController} to control the progress of this animation to.
     * @param rres An {@param RRES} archive with animations to search through.
     * @param name The name of animations to search for. By default, this uses the name of the {@member mdl0Model}
     * used to construct this model instance, as Nintendo appears to use this convention a lot in their games.
     * You can also pass {@constant null} in order to match all animations in the archive.
     */
    public bindRRESAnimations(animationController: AnimationController, rres: BRRES.RRES, name: string | null = this.mdl0Model.mdl0.name): void {
        for (let i = 0; i < rres.chr0.length; i++)
            if (rres.chr0[i].name === name || name === null)
                this.bindCHR0(animationController, rres.chr0[i]);

        for (let i = 0; i < rres.srt0.length; i++)
            if (rres.srt0[i].name === name || name === null)
                this.bindSRT0(animationController, rres.srt0[i]);

        for (let i = 0; i < rres.clr0.length; i++)
            if (rres.clr0[i].name === name || name === null)
                this.bindCLR0(animationController, rres.clr0[i]);

        for (let i = 0; i < rres.pat0.length; i++)
            if (rres.pat0[i].name === name || name === null)
                this.bindPAT0(animationController, rres.pat0[i]);
    }

    public setColorOverride(i: ColorKind, color: GX_Material.Color): void {
        this.colorOverrides[i] = color;
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    private isAnyShapeVisible(): boolean {
        for (let i = 0; i < this.matrixVisibility.length; i++)
            if (this.matrixVisibility[i] !== IntersectionState.FULLY_OUTSIDE)
                return true;
        return false;
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx, viewerInput: ViewerRenderInput): void {
        let modelVisible = this.visible;
        const mdl0 = this.mdl0Model.mdl0;

        if (modelVisible) {
            this.templateRenderInst.name = this.name;
            this.templateRenderInst.passMask = this.passMask;

            if (mdl0.bbox !== null) {
                // Frustum cull.
                bboxScratch.transform(mdl0.bbox, this.modelMatrix);
                if (!viewerInput.camera.frustum.contains(bboxScratch))
                    modelVisible = false;
            }

            if (this.debugBones)
                prepareFrameDebugOverlayCanvas2D();

            this.execNodeTreeOpList(mdl0.sceneGraph.nodeTreeOps, viewerInput, modelVisible);
            this.execNodeMixOpList(mdl0.sceneGraph.nodeMixOps);

            if (!this.isAnyShapeVisible())
                modelVisible = false;
        }

        let depth = -1;
        if (modelVisible) {
            this.templateRenderInst.passMask = this.passMask;

            for (let i = 0; i < this.materialInstances.length; i++)
                this.materialInstances[i].prepareToRender(renderHelper, this.textureHolder, viewerInput);

            const rootJoint = mdl0.nodes[0];
            if (rootJoint.bbox != null) {
                bboxScratch.transform(rootJoint.bbox, this.modelMatrix);
                depth = Math.max(computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, bboxScratch), 0);
            } else {
                depth = 0;
            }
        }

        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].prepareToRender(renderHelper, depth, viewerInput, this.matrixArray, this.matrixVisibility, this.isSkybox);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].destroy(device);
    }

    private execDrawOpList(renderHelper: GXRenderHelperGfx, opList: BRRES.DrawOp[], translucent: boolean): void {
        const mdl0 = this.mdl0Model.mdl0;
        const renderInstBuilder = renderHelper.renderInstBuilder;

        for (let i = 0; i < opList.length; i++) {
            const op = opList[i];

            const node = mdl0.nodes[op.nodeId];
            const usesEnvelope = (node.mtxId < 0);
            if (usesEnvelope)
                throw "whoops";

            const shape = this.mdl0Model.mdl0.shapes[op.shpId];
            const shapeData = this.mdl0Model.shapeData[op.shpId];
            const shapeInstance = new ShapeInstance(shape, shapeData, node);
            if (translucent)
                shapeInstance.sortKeyBias = i;

            const materialInstance = this.materialInstances[op.matId];
            // assert(materialInstance.materialData.material.translucent === translucent);
            renderInstBuilder.pushTemplateRenderInst(materialInstance.templateRenderInst);
            shapeInstance.buildRenderInst(renderInstBuilder, this.mdl0Model.mdl0.name);
            renderInstBuilder.popTemplateRenderInst();

            this.shapeInstances.push(shapeInstance);
        }
    }

    private execNodeTreeOpList(opList: BRRES.NodeTreeOp[], viewerInput: ViewerRenderInput, visible: boolean): void {
        const mdl0 = this.mdl0Model.mdl0;

        mat4.copy(this.matrixArray[0], this.modelMatrix);
        this.matrixVisibility[0] = visible ? (this.isSkybox ? IntersectionState.FULLY_INSIDE : IntersectionState.PARTIAL_INTERSECT) : IntersectionState.FULLY_OUTSIDE;

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

                if (visible) {
                    if (this.isSkybox || node.bbox === null) {
                        this.matrixVisibility[dstMtxId] = IntersectionState.FULLY_INSIDE;
                    } else {
                        bboxScratch.transform(node.bbox, this.matrixArray[dstMtxId]);
                        this.matrixVisibility[dstMtxId] = viewerInput.camera.frustum.intersect(bboxScratch);
                    }
                } else {
                    this.matrixVisibility[dstMtxId] = IntersectionState.FULLY_OUTSIDE;
                }

                if (this.debugBones) {
                    const ctx = getDebugOverlayCanvas2D();

                    vec3.set(scratchVec3a, 0, 0, 0);
                    vec3.transformMat4(scratchVec3a, scratchVec3a, this.matrixArray[parentMtxId]);
                    vec3.set(scratchVec3b, 0, 0, 0);
                    vec3.transformMat4(scratchVec3b, scratchVec3b, this.matrixArray[dstMtxId]);

                    drawWorldSpaceLine(ctx, viewerInput.camera, scratchVec3a, scratchVec3b);
                }
            } else if (op.op === BRRES.ByteCodeOp.MTXDUP) {
                const srcMtxId = op.fromMtxId;
                const dstMtxId = op.toMtxId;
                mat4.copy(this.matrixArray[dstMtxId], this.matrixArray[srcMtxId]);
                this.matrixVisibility[dstMtxId] = this.matrixVisibility[srcMtxId];
            }
        }
    }

    private execNodeMixOpList(opList: BRRES.NodeMixOp[]): void {
        for (let i = 0; i < opList.length; i++) {
            const op = opList[i];

            if (op.op === BRRES.ByteCodeOp.NODEMIX) {
                const dst = this.matrixArray[op.dstMtxId];
                dst.fill(0);

                for (let j = 0; j < op.blendMtxIds.length; j++)
                    mat4.multiplyScalarAndAdd(dst, dst, matrixScratchArray[op.blendMtxIds[j]], op.weights[j]);
            } else if (op.op === BRRES.ByteCodeOp.EVPMTX) {
                const node = this.mdl0Model.mdl0.nodes[op.nodeId];
                mat4.mul(matrixScratchArray[op.mtxId], this.matrixArray[op.mtxId], node.inverseBindPose);
            }
        }
    }
}

const matrixScratch = mat4.create();
class MaterialData {
    public gfxSamplers: GfxSampler[] = [];

    constructor(device: GfxDevice, public material: BRRES.MDL0_MaterialEntry, public materialHacks?: GX_Material.GXMaterialHacks) {
        for (let i = 0; i < 8; i++) {
            const sampler = this.material.samplers[i];
            if (!sampler)
                continue;

            const [minFilter, mipFilter] = translateTexFilterGfx(sampler.minFilter);
            const [magFilter]            = translateTexFilterGfx(sampler.magFilter);

            // In RRES, the minLOD / maxLOD are in the texture, not the sampler.

            const gfxSampler = device.createSampler({
                wrapS: translateWrapModeGfx(sampler.wrapS),
                wrapT: translateWrapModeGfx(sampler.wrapT),
                minFilter, mipFilter, magFilter,
                minLOD: 0,
                maxLOD: 100,
            });

            this.gfxSamplers[i] = gfxSampler;
        }
    }

    public destroy(device: GfxDevice): void {
        this.gfxSamplers.forEach((r) => device.destroySampler(r));
    }
}
