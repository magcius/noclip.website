
import { mat4 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { nArray } from '../util';
import { MaterialParams, PacketParams, GXTextureHolder, GXShapeHelperGfx, GXRenderHelperGfx, GXMaterialHelperGfx, ColorKind } from '../gx/gx_render';

import { MREA, Material, Surface, UVAnimationType, MaterialSet } from './mrea';
import * as Viewer from '../viewer';
import { AABB } from '../Geometry';
import { TXTR } from './txtr';
import { CMDL } from './cmdl';
import { TextureMapping } from '../TextureHolder';
import { GfxDevice, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import { GfxCoalescedBuffers, GfxBufferCoalescer } from '../gfx/helpers/BufferHelpers';
import { GfxRenderInst, GfxRenderInstViewRenderer, makeSortKey, GfxRendererLayer, setSortKeyDepth } from '../gfx/render/GfxRenderer';
import { computeViewSpaceDepthFromWorldSpaceAABB, computeViewMatrixSkybox, computeViewMatrix } from '../Camera';

const fixPrimeUsingTheWrongConventionYesIKnowItsFromMayaButMayaIsStillWrong = mat4.fromValues(
    1, 0,  0, 0,
    0, 0, -1, 0,
    0, 1,  0, 0,
    0, 0,  0, 1,
);

// Cheap way to scale up.
const posScale = 10;
const posMtx = mat4.create();
mat4.mul(posMtx, fixPrimeUsingTheWrongConventionYesIKnowItsFromMayaButMayaIsStillWrong, mat4.fromScaling(mat4.create(), [posScale, posScale, posScale]));

export class RetroTextureHolder extends GXTextureHolder<TXTR> {
    public addMaterialSetTextures(device: GfxDevice, materialSet: MaterialSet): void {
        this.addTextures(device, materialSet.textures);
    }
}

export const enum RetroPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

const matrixScratch = mat4.create();
class Command_Surface {
    private shapeHelper: GXShapeHelperGfx;
    private renderInst: GfxRenderInst;
    public packetParams = new PacketParams();
    public isTranslucent = false;

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, public surface: Surface, materialCommand: Command_Material, coalescedBuffers: GfxCoalescedBuffers, public modelIndex: number = 0) {
        this.shapeHelper = new GXShapeHelperGfx(device, renderHelper, coalescedBuffers, surface.loadedVertexLayout, surface.loadedVertexData);

        this.renderInst = this.shapeHelper.pushRenderInst(renderHelper.renderInstBuilder, materialCommand.templateRenderInst);
        this.isTranslucent = materialCommand.material.isTransparent;
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean, depth: number): boolean {
        this.renderInst.visible = Number.isFinite(depth);

        if (this.renderInst.visible) {
            const modelMatrix = posMtx;
            const viewMatrix = matrixScratch;

            if (isSkybox)
                computeViewMatrixSkybox(viewMatrix, viewerInput.camera);
            else
                computeViewMatrix(viewMatrix, viewerInput.camera);

            mat4.mul(this.packetParams.u_PosMtx[0], viewMatrix, modelMatrix);
            this.shapeHelper.fillPacketParams(this.packetParams, this.renderInst, renderHelper);
            this.renderInst.sortKey = setSortKeyDepth(this.renderInst.sortKey, depth);
        }

        return this.renderInst.visible;
    }

    public destroy(device: GfxDevice) {
        this.shapeHelper.destroy(device);
    }
}

class Command_MaterialGroup {
    private materialParams = new MaterialParams();
    public materialHelper: GXMaterialHelperGfx;
    public hasPreparedToRender: boolean = false;

    constructor(device: GfxDevice, public renderHelper: GXRenderHelperGfx, public material: Material) {
        this.materialHelper = new GXMaterialHelperGfx(device, renderHelper, this.material.gxMaterial);
        const layer = this.material.isTransparent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.materialHelper.templateRenderInst.sortKey = makeSortKey(layer, this.materialHelper.programKey);
    }

    public destroy(device: GfxDevice) {
        this.materialHelper.destroy(device);
    }

    public prepareToRender(viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4 | null, isSkybox: boolean): void {
        if (this.hasPreparedToRender)
            return;

        this.fillMaterialParamsData(this.materialParams, viewerInput, modelMatrix, isSkybox);
        this.materialHelper.fillMaterialParams(this.materialParams, this.renderHelper);
        this.hasPreparedToRender = true;
    }

    private fillMaterialParamsData(materialParams: MaterialParams, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4 | null, isSkybox: boolean): void {
        materialParams.u_Color[ColorKind.MAT0].set(1, 1, 1, 1);
        if (isSkybox)
            materialParams.u_Color[ColorKind.AMB0].set(1, 1, 1, 1);
        else
            materialParams.u_Color[ColorKind.AMB0].set(0, 0, 0, 1);

        for (let i = 0; i < 4; i++)
            materialParams.u_Color[ColorKind.CPREV + i].copy(this.material.colorRegisters[i]);
        for (let i = 0; i < 4; i++)
            materialParams.u_Color[ColorKind.K0 + i].copy(this.material.colorConstants[i]);

        const animTime = ((viewerInput.time / 1000) % 900);
        for (let i = 0; i < this.material.uvAnimations.length; i++) {
            const uvAnimation = this.material.uvAnimations[i];
            if (!uvAnimation)
                continue;

            const texMtx = materialParams.u_TexMtx[i];
            const postMtx = materialParams.u_PostTexMtx[i];
            switch (uvAnimation.type) {
            case UVAnimationType.UV_SCROLL: {
                const transS = animTime * uvAnimation.scaleS + uvAnimation.offsetS;
                const transT = animTime * uvAnimation.scaleT + uvAnimation.offsetT;
                texMtx[12] = transS;
                texMtx[13] = transT;
                break;
            }
            case UVAnimationType.ROTATION: {
                const theta = animTime * uvAnimation.scale + uvAnimation.offset;
                const cosR = Math.cos(theta);
                const sinR = Math.sin(theta);
                texMtx[0] =  cosR;
                texMtx[4] =  sinR;
                texMtx[12] = (1.0 - (cosR - sinR)) * 0.5;

                texMtx[1] = -sinR;
                texMtx[5] =  cosR;
                texMtx[13] = (1.0 - (sinR + cosR)) * 0.5;
                break;
            }
            case UVAnimationType.FLIPBOOK_U: {
                const n = uvAnimation.step * uvAnimation.scale * (uvAnimation.offset + animTime);
                const trans = Math.floor(uvAnimation.numFrames * (n % 1.0)) * uvAnimation.step;
                texMtx[12] = trans;
                break;
            }
            case UVAnimationType.FLIPBOOK_V: {
                const n = uvAnimation.step * uvAnimation.scale * (uvAnimation.offset + animTime);
                const trans = Math.floor(uvAnimation.numFrames * (n % 1.0)) * uvAnimation.step;
                texMtx[13] = trans;
                break;
            }
            /*
            case UVAnimationType.INV_MAT_SKY:
                mat4.invert(texMtx, state.view);
                if (modelMatrix !== null)
                    mat4.mul(texMtx, texMtx, modelMatrix);
                texMtx[12] = 0;
                texMtx[13] = 0;
                texMtx[14] = 0;
                texEnvMtx(postMtx, 0.5, -0.5, 0.5, 0.5);
                break;
            case UVAnimationType.INV_MAT:
                mat4.invert(texMtx, state.view);
                if (modelMatrix !== null)
                    mat4.mul(texMtx, texMtx, modelMatrix);
                texEnvMtx(postMtx, 0.5, -0.5, 0.5, 0.5);
                break;
            case UVAnimationType.MODEL_MAT:
                if (modelMatrix !== null)
                    mat4.copy(texMtx, modelMatrix);
                else
                    mat4.identity(texMtx);
                texMtx[12] = 0;
                texMtx[13] = 0;
                texMtx[14] = 0;
                texEnvMtx(postMtx, 0.5, -0.5, modelMatrix[12] * 0.5, modelMatrix[13] * 0.5);
                break;
            case UVAnimationType.CYLINDER: {
                mat4.copy(texMtx, state.view);
                if (modelMatrix !== null)
                    mat4.mul(texMtx, texMtx, modelMatrix);
                texMtx[12] = 0;
                texMtx[13] = 0;
                texMtx[14] = 0;
                const xy = ((state.view[12] + state.view[13]) * 0.025 * uvAnimation.phi) % 1.0;
                const z = (state.view[14] * 0.05 * uvAnimation.phi) % 1.0;
                const a = uvAnimation.theta * 0.5;
                texEnvMtx(postMtx, a, -a, xy, z);
                break;
            }
            */
            }
        }
    }
}

const textureMappings = nArray(8, () => new TextureMapping());
class Command_Material {
    public templateRenderInst: GfxRenderInst;

    constructor(materialGroup: Command_MaterialGroup, renderHelper: GXRenderHelperGfx, public material: Material, materialSet: MaterialSet, textureHolder: RetroTextureHolder) {
        this.templateRenderInst = renderHelper.renderInstBuilder.newRenderInst(materialGroup.materialHelper.templateRenderInst);

        for (let i = 0; i < material.textureIndexes.length; i++) {
            const textureIndex = material.textureIndexes[i];
            if (textureIndex === -1)
                continue;

            const txtr = materialSet.textures[materialSet.textureRemapTable[textureIndex]];
            textureHolder.fillTextureMapping(textureMappings[i], txtr.name);
        }

        this.templateRenderInst.setSamplerBindingsFromTextureMappings(textureMappings);
    }
}

export class MREARenderer {
    private bufferCoalescer: GfxBufferCoalescer;
    private materialGroupCommands: Command_MaterialGroup[] = [];
    private materialCommands: Command_Material[] = [];
    private surfaceCommands: Command_Surface[] = [];
    private renderHelper: GXRenderHelperGfx;
    private modelViewSpaceDepth: number[] = [];
    private bboxScratch: AABB = new AABB();
    public visible: boolean = true;

    constructor(device: GfxDevice, public textureHolder: RetroTextureHolder, public name: string, public mrea: MREA) {
        this.renderHelper = new GXRenderHelperGfx(device);
        this.translateModel(device);
    }

    private translateModel(device: GfxDevice): void {
        const materialSet = this.mrea.materialSet;

        this.textureHolder.addMaterialSetTextures(device, materialSet);

        // First, create our group commands. These will store UBO buffer data which is shared between
        // all groups using that material.
        for (let i = 0; i < materialSet.materials.length; i++) {
            const material = materialSet.materials[i];
            if (this.materialGroupCommands[material.groupIndex] === undefined)
                this.materialGroupCommands[material.groupIndex] = new Command_MaterialGroup(device, this.renderHelper, material);
        }

        // Now create the material commands.
        this.materialCommands = materialSet.materials.map((material) => {
            const materialGroupCommand = this.materialGroupCommands[material.groupIndex];
            return new Command_Material(materialGroupCommand, this.renderHelper, material, materialSet, this.textureHolder);
        });

        const vertexDatas: ArrayBufferSlice[] = [];
        const indexDatas: ArrayBufferSlice[] = [];

        // Coalesce surface data.
        this.mrea.worldModels.forEach((worldModel) => {
            worldModel.geometry.surfaces.forEach((surface) => {
                vertexDatas.push(new ArrayBufferSlice(surface.loadedVertexData.packedVertexData));
                indexDatas.push(new ArrayBufferSlice(surface.loadedVertexData.indexData));
            });
        });

        this.bufferCoalescer = new GfxBufferCoalescer(device, vertexDatas, indexDatas);

        let bufferIndex = 0;
        this.mrea.worldModels.forEach((worldModel, modelIndex) => {
            worldModel.geometry.surfaces.forEach((surface) => {
                const materialCommand = this.materialCommands[surface.materialIndex];
                const coalescedBuffers = this.bufferCoalescer.coalescedBuffers[bufferIndex++];

                // Don't render occluders.
                if (materialCommand.material.isOccluder)
                    return;

                this.surfaceCommands.push(new Command_Surface(device, this.renderHelper, surface, materialCommand, coalescedBuffers, modelIndex));
            });
        });
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        this.renderHelper.finishBuilder(device, viewRenderer);
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(2, 75000);
        this.renderHelper.fillSceneParams(viewerInput);

        // Frustum cull.
        const camera = viewerInput.camera;
        const bbox = this.bboxScratch;
        for (let i = 0; i < this.mrea.worldModels.length; i++) {
            let visible = this.visible;
            if (visible) {
                const worldModel = this.mrea.worldModels[i];
                bbox.transform(worldModel.bbox, posMtx);
                if (camera.frustum.contains(bbox))
                    this.modelViewSpaceDepth[i] = computeViewSpaceDepthFromWorldSpaceAABB(camera, bbox);
                else
                    visible = false;
            }
            if (!visible)
                this.modelViewSpaceDepth[i] = Infinity;
        }

        // First, prep our material groups to be updated.
        for (let i = 0; i < this.materialGroupCommands.length; i++)
            this.materialGroupCommands[i].hasPreparedToRender = false;

        // Update our surfaces.
        for (let i = 0; i < this.surfaceCommands.length; i++) {
            const surfaceCommand = this.surfaceCommands[i];
            const surfaceVisible = surfaceCommand.prepareToRender(this.renderHelper, viewerInput, false, this.modelViewSpaceDepth[surfaceCommand.modelIndex]);

            if (surfaceVisible) {
                const materialGroupCommand = this.materialGroupCommands[this.materialCommands[surfaceCommand.surface.materialIndex].material.groupIndex];
                materialGroupCommand.prepareToRender(viewerInput, null, false);
            }
        }

        // If nothing is visible, then don't even bother updating our UBOs.
        if (!this.visible)
            return;

        this.renderHelper.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        this.materialGroupCommands.forEach((cmd) => cmd.destroy(device));
        this.surfaceCommands.forEach((cmd) => cmd.destroy(device));
        this.renderHelper.destroy(device);
        this.bufferCoalescer.destroy(device);
    }
}

// TODO(jstpierre): Dedupe.
export class CMDLRenderer {
    private bufferCoalescer: GfxBufferCoalescer;
    private materialGroupCommands: Command_MaterialGroup[] = [];
    private materialCommands: Command_Material[] = [];
    private surfaceCommands: Command_Surface[] = [];
    private renderHelper: GXRenderHelperGfx;
    private bboxScratch: AABB = new AABB();
    public visible: boolean = true;
    public isSkybox: boolean = false;

    constructor(device: GfxDevice, public textureHolder: RetroTextureHolder, public name: string, public cmdl: CMDL) {
        this.renderHelper = new GXRenderHelperGfx(device);
        this.translateModel(device);
    }

    private translateModel(device: GfxDevice): void {
        const materialSet = this.cmdl.materialSets[0];

        this.textureHolder.addMaterialSetTextures(device, materialSet);

        // First, create our group commands. These will store UBO buffer data which is shared between
        // all groups using that material.
        for (let i = 0; i < materialSet.materials.length; i++) {
            const material = materialSet.materials[i];
            if (this.materialGroupCommands[material.groupIndex] === undefined)
                this.materialGroupCommands[material.groupIndex] = new Command_MaterialGroup(device, this.renderHelper, material);
        }

        // Now create the material commands.
        this.materialCommands = materialSet.materials.map((material) => {
            const materialGroupCommand = this.materialGroupCommands[material.groupIndex];
            return new Command_Material(materialGroupCommand, this.renderHelper, material, materialSet, this.textureHolder);
        });

        const vertexDatas: ArrayBufferSlice[] = [];
        const indexDatas: ArrayBufferSlice[] = [];

        // Coalesce surface data.
        this.cmdl.geometry.surfaces.forEach((surface) => {
            vertexDatas.push(new ArrayBufferSlice(surface.loadedVertexData.packedVertexData));
            indexDatas.push(new ArrayBufferSlice(surface.loadedVertexData.indexData));
        });

        this.bufferCoalescer = new GfxBufferCoalescer(device, vertexDatas, indexDatas);

        let bufferIndex = 0;
        this.cmdl.geometry.surfaces.forEach((surface) => {
            const materialCommand = this.materialCommands[surface.materialIndex];
            const coalescedBuffers = this.bufferCoalescer.coalescedBuffers[bufferIndex++];

            // Don't render occluders.
            if (materialCommand.material.isOccluder)
                return;

            this.surfaceCommands.push(new Command_Surface(device, this.renderHelper, surface, materialCommand, coalescedBuffers));
        });
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        this.renderHelper.finishBuilder(device, viewRenderer);
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(2, 75000);
        this.renderHelper.fillSceneParams(viewerInput);

        this.renderHelper.templateRenderInst.passMask = this.isSkybox ? RetroPass.SKYBOX : RetroPass.MAIN;

        // Frustum cull.
        const camera = viewerInput.camera;
        const bbox = this.bboxScratch;
        let modelViewSpaceDepth: number = 0;

        let visible = this.visible;
        if (visible && !this.isSkybox) {
            bbox.transform(this.cmdl.bbox, posMtx);
            if (camera.frustum.contains(bbox))
                modelViewSpaceDepth = computeViewSpaceDepthFromWorldSpaceAABB(camera, bbox);
        }
        if (!visible)
            modelViewSpaceDepth = Infinity;

        // First, prep our material groups to be updated.
        for (let i = 0; i < this.materialGroupCommands.length; i++)
            this.materialGroupCommands[i].hasPreparedToRender = false;

        // Update our surfaces.
        for (let i = 0; i < this.surfaceCommands.length; i++) {
            const surfaceCommand = this.surfaceCommands[i];
            const surfaceVisible = surfaceCommand.prepareToRender(this.renderHelper, viewerInput, this.isSkybox, modelViewSpaceDepth);

            if (surfaceVisible) {
                const materialGroupCommand = this.materialGroupCommands[this.materialCommands[surfaceCommand.surface.materialIndex].material.groupIndex];
                materialGroupCommand.prepareToRender(viewerInput, null, false);
            }
        }

        // If nothing is visible, then don't even bother updating our UBOs.
        if (!this.visible)
            return;

        this.renderHelper.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        this.materialGroupCommands.forEach((cmd) => cmd.destroy(device));
        this.surfaceCommands.forEach((cmd) => cmd.destroy(device));
        this.renderHelper.destroy(device);
        this.bufferCoalescer.destroy(device);
    }
}
