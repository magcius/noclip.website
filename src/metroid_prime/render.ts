
import { mat4 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { nArray } from '../util';
import { SceneParams, MaterialParams, PacketParams, GXShapeHelper, GXRenderHelper, fillSceneParamsFromRenderState, GXTextureHolder } from '../gx/gx_render';

import { MREA, Material, Surface, UVAnimationType, MaterialSet } from './mrea';
import * as GX_Material from '../gx/gx_material';
import * as Viewer from '../viewer';
import { RenderState, RenderFlags } from '../render';
import BufferCoalescer, { CoalescedBuffers } from '../BufferCoalescer';
import { AABB, IntersectionState } from '../Geometry';
import { TXTR } from './txtr';
import { CMDL } from './cmdl';
import { TextureMapping, bindGLTextureMappings } from '../TextureHolder';

const fixPrimeUsingTheWrongConventionYesIKnowItsFromMayaButMayaIsStillWrong = mat4.fromValues(
    1, 0,  0, 0,
    0, 0, -1, 0,
    0, 1,  0, 0,
    0, 0,  0, 1,
);

// Cheap way to scale up.
const posScale = 10;
const posMtx = mat4.create();
mat4.multiplyScalar(posMtx, fixPrimeUsingTheWrongConventionYesIKnowItsFromMayaButMayaIsStillWrong, posScale);
posMtx[15] = 1;

export class RetroTextureHolder extends GXTextureHolder<TXTR> {
    public addMaterialSetTextures(gl: WebGL2RenderingContext, materialSet: MaterialSet): void {
        this.addTextures(gl, materialSet.textures);
    }
}

const textureMappingScratch: TextureMapping[] = nArray(8, () => new TextureMapping());

export class MREARenderer implements Viewer.Scene {
    private bufferCoalescer: BufferCoalescer;
    private materialCommands: Command_Material[] = [];
    private opaqueCommands: Command_Surface[] = [];
    private transparentCommands: Command_Surface[] = [];
    private renderHelper: GXRenderHelper;
    private sceneParams: SceneParams = new SceneParams();
    private packetParams: PacketParams = new PacketParams();
    private bboxScratch: AABB = new AABB();
    public visible: boolean = true;

    constructor(gl: WebGL2RenderingContext, public textureHolder: RetroTextureHolder, public name: string, public mrea: MREA) {
        this.renderHelper = new GXRenderHelper(gl);
        this.translateModel(gl);
    }

    private translateModel(gl: WebGL2RenderingContext): void {
        const materialSet = this.mrea.materialSet;

        this.textureHolder.addMaterialSetTextures(gl, materialSet);

        // Pull out the first material of each group, which should be identical except for textures.
        const groupMaterials: Material[] = [];
        for (let i = 0; i < materialSet.materials.length; i++) {
            const material = materialSet.materials[i];
            if (!groupMaterials[material.groupIndex])
                groupMaterials[material.groupIndex] = material;
        }

        this.materialCommands = groupMaterials.map((material) => {
            return new Command_Material(material);
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

        this.bufferCoalescer = new BufferCoalescer(gl, vertexDatas, indexDatas);

        let bufferIndex = 0;
        this.mrea.worldModels.forEach((worldModel, modelIndex) => {
            worldModel.geometry.surfaces.forEach((surface) => {
                const material = materialSet.materials[surface.materialIndex];
                const coalescedBuffers = this.bufferCoalescer.coalescedBuffers[bufferIndex++];

                if (material.isOccluder)
                    return;

                const surfaceCommand = new Command_Surface(gl, surface, coalescedBuffers, modelIndex);
                if (material.isTransparent)
                    this.transparentCommands.push(surfaceCommand);
                else
                    this.opaqueCommands.push(surfaceCommand);
            });
        });

        // Sort commands by material index.
        this.opaqueCommands.sort((a, b) => {
            return a.surface.materialIndex - b.surface.materialIndex;
        });
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public render(state: RenderState): void {
        if (!this.visible)
            return;

        state.setClipPlanes(2, 7500);

        this.renderHelper.bindUniformBuffers(state);

        fillSceneParamsFromRenderState(this.sceneParams, state);
        this.renderHelper.bindSceneParams(state, this.sceneParams);

        this.computeModelView(this.packetParams.u_PosMtx[0], state);
        this.renderHelper.bindPacketParams(state, this.packetParams);

        // Frustum cull.
        const bbox = this.bboxScratch;
        const modelVisibility: boolean[] = [];
        this.mrea.worldModels.forEach((worldModel, i) => {
            bbox.transform(worldModel.bbox, posMtx);
            modelVisibility[i] = state.camera.frustum.intersect(bbox) !== IntersectionState.FULLY_OUTSIDE;
        });

        this.execSurfaceCommandList(state, this.opaqueCommands, modelVisibility);
        this.execSurfaceCommandList(state, this.transparentCommands, modelVisibility);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.materialCommands.forEach((cmd) => cmd.destroy(gl));
        this.opaqueCommands.forEach((cmd) => cmd.destroy(gl));
        this.transparentCommands.forEach((cmd) => cmd.destroy(gl));
        this.bufferCoalescer.destroy(gl);
    }

    private execSurfaceCommandList(state: RenderState, cmdList: Command_Surface[], modelVisibility: boolean[]): void {
        let currentMaterialIndex = -1;
        let currentGroupIndex = -1;

        for (let i = 0; i < cmdList.length; i++) {
            const surfaceCmd = cmdList[i];
            if (!modelVisibility[surfaceCmd.modelIndex])
                continue;

            const materialIndex = surfaceCmd.surface.materialIndex;
            const material = this.mrea.materialSet.materials[materialIndex];

            if (currentMaterialIndex !== materialIndex) {
                const groupIndex = material.groupIndex;
                const materialCommand = this.materialCommands[groupIndex];

                if (groupIndex !== currentGroupIndex) {
                    materialCommand.exec(state, null, false, this.renderHelper);
                    currentGroupIndex = groupIndex;
                }

                this.bindTextures(state, material, materialCommand.program);
                currentMaterialIndex = materialIndex;
            }

            surfaceCmd.exec(state);
        }
    }

    private fillTextureMapping(textureMapping: TextureMapping[], material: Material): void {
        for (let i = 0; i < material.textureIndexes.length; i++) {
            const textureIndex = material.textureIndexes[i];
            if (textureIndex === -1)
                continue;

            const materialSet = this.mrea.materialSet;
            const txtr = materialSet.textures[materialSet.textureRemapTable[textureIndex]];
            this.textureHolder.fillTextureMapping(textureMapping[i], txtr.name);
        }
    }

    private bindTextures(state: RenderState, material: Material, program: GX_Material.GX_Program): void {
        this.fillTextureMapping(textureMappingScratch, material);
        bindGLTextureMappings(state, textureMappingScratch);
    }

    private computeModelView(dst: mat4, state: RenderState): void {
        mat4.copy(dst, state.updateModelView(false, posMtx));
    }
}

// TODO(jstpierre): Dedupe.
export class CMDLRenderer implements Viewer.Scene {
    private bufferCoalescer: BufferCoalescer;
    private materialCommands: Command_Material[] = [];
    private surfaceCommands: Command_Surface[] = [];
    private renderHelper: GXRenderHelper;
    private sceneParams: SceneParams = new SceneParams();
    private packetParams: PacketParams = new PacketParams();
    private bboxScratch: AABB = new AABB();
    private modelMatrix = mat4.create();
    public visible: boolean = true;
    public isSkybox: boolean = false;

    constructor(gl: WebGL2RenderingContext, public textureHolder: RetroTextureHolder, public name: string, public cmdl: CMDL) {
        this.renderHelper = new GXRenderHelper(gl);
        this.translateModel(gl);
    }

    private translateModel(gl: WebGL2RenderingContext): void {
        const materialSet = this.cmdl.materialSets[0];

        this.textureHolder.addMaterialSetTextures(gl, materialSet);

        // Pull out the first material of each group, which should be identical except for textures.
        const groupMaterials: Material[] = [];
        for (let i = 0; i < materialSet.materials.length; i++) {
            const material = materialSet.materials[i];
            if (!groupMaterials[material.groupIndex])
                groupMaterials[material.groupIndex] = material;
        }

        this.materialCommands = groupMaterials.map((material) => {
            return new Command_Material(material);
        });

        const vertexDatas: ArrayBufferSlice[] = [];
        const indexDatas: ArrayBufferSlice[] = [];

        // Coalesce surface data.
        this.cmdl.geometry.surfaces.forEach((surface) => {
            vertexDatas.push(new ArrayBufferSlice(surface.loadedVertexData.packedVertexData));
            indexDatas.push(new ArrayBufferSlice(surface.loadedVertexData.indexData));
        });

        this.bufferCoalescer = new BufferCoalescer(gl, vertexDatas, indexDatas);

        let i = 0;
        this.cmdl.geometry.surfaces.forEach((surface) => {
            this.surfaceCommands.push(new Command_Surface(gl, surface, this.bufferCoalescer.coalescedBuffers[i]));
            ++i;
        });
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public render(state: RenderState): void {
        if (!this.visible)
            return;

        this.renderHelper.bindUniformBuffers(state);

        fillSceneParamsFromRenderState(this.sceneParams, state);
        this.renderHelper.bindSceneParams(state, this.sceneParams);

        this.computeModelView(this.packetParams.u_PosMtx[0], state);
        this.renderHelper.bindPacketParams(state, this.packetParams);

        let currentMaterialIndex = -1;
        let currentGroupIndex = -1;

        let surfaceCmdIndex = 0;
        const bbox = this.bboxScratch;

        const numSurfaces = this.cmdl.geometry.surfaces.length;
        const materialSet = this.cmdl.materialSets[0];

        // Frustum cull.
        if (!this.isSkybox) {
            bbox.transform(this.cmdl.bbox, posMtx);
            if (state.camera.frustum.intersect(bbox) === IntersectionState.FULLY_OUTSIDE)
                return;
        }

        for (let i = 0; i < numSurfaces; i++) {
            const surfaceCmd = this.surfaceCommands[surfaceCmdIndex++];
            const materialIndex = surfaceCmd.surface.materialIndex;
            const material = materialSet.materials[materialIndex];

            // Don't render occluder meshes.
            if (material.isOccluder)
                continue;

            if (currentMaterialIndex !== materialIndex) {
                const groupIndex = materialSet.materials[materialIndex].groupIndex;
                const materialCommand = this.materialCommands[groupIndex];

                if (groupIndex !== currentGroupIndex) {
                    materialCommand.exec(state, this.modelMatrix, this.isSkybox, this.renderHelper);
                    currentGroupIndex = groupIndex;
                }

                this.bindTextures(state, material, materialCommand.program);
                currentMaterialIndex = materialIndex;
            }

            surfaceCmd.exec(state);
        }
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.materialCommands.forEach((cmd) => cmd.destroy(gl));
        this.surfaceCommands.forEach((cmd) => cmd.destroy(gl));
        this.bufferCoalescer.destroy(gl);
    }

    private fillTextureMapping(textureMapping: TextureMapping[], material: Material): void {
        for (let i = 0; i < material.textureIndexes.length; i++) {
            const textureIndex = material.textureIndexes[i];
            if (textureIndex === -1)
                continue;

            const materialSet = this.cmdl.materialSets[0];
            const txtr = materialSet.textures[materialSet.textureRemapTable[textureIndex]];
            this.textureHolder.fillTextureMapping(textureMapping[i], txtr.name);
        }
    }

    private bindTextures(state: RenderState, material: Material, program: GX_Material.GX_Program): void {
        this.fillTextureMapping(textureMappingScratch, material);
        bindGLTextureMappings(state, textureMappingScratch);
    }

    private computeModelView(dst: mat4, state: RenderState): void {
        mat4.copy(dst, state.updateModelView(this.isSkybox, posMtx));
    }
}

class Command_Surface {
    private shapeHelper: GXShapeHelper;

    constructor(gl: WebGL2RenderingContext, public surface: Surface, coalescedBuffers: CoalescedBuffers, public modelIndex: number = 0) {
        this.shapeHelper = new GXShapeHelper(gl, coalescedBuffers, surface.loadedVertexLayout, surface.loadedVertexData);
    }

    public exec(state: RenderState) {
        this.shapeHelper.draw(state);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.shapeHelper.destroy(gl);
    }
}

class Command_Material {
    private renderFlags: RenderFlags;
    public program: GX_Material.GX_Program;
    public materialParams = new MaterialParams();

    constructor(public material: Material) {
        this.program = new GX_Material.GX_Program(this.material.gxMaterial);
        this.renderFlags = GX_Material.translateRenderFlags(this.material.gxMaterial);
    }

    public exec(state: RenderState, modelMatrix: mat4 | null, isSkybox: boolean, renderHelper: GXRenderHelper) {
        state.useProgram(this.program);
        state.useFlags(this.renderFlags);
        this.fillMaterialParamsData(state, modelMatrix, isSkybox, this.materialParams);
        renderHelper.bindMaterialParams(state, this.materialParams);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.program.destroy(gl);
    }

    private fillMaterialParamsData(state: RenderState, modelMatrix: mat4 | null, isSkybox: boolean, materialParams: MaterialParams): void {
        materialParams.u_Color[0].set(1, 1, 1, 1);
        if (isSkybox)
            materialParams.u_Color[2].set(1, 1, 1, 1);
        else
            materialParams.u_Color[2].set(0, 0, 0, 1);

        for (let i = 0; i < 4; i++)
            materialParams.u_Color[4 + i].copy(this.material.colorRegisters[i]);
        for (let i = 0; i < 4; i++)
            materialParams.u_Color[8 + i].copy(this.material.colorConstants[i]);

        const animTime = ((state.time / 1000) % 900);
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
