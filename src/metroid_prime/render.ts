import { mat4, ReadonlyMat4, vec3 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { assert, assertExists, nArray } from '../util';
import { ColorKind, DrawParams, GXMaterialHelperGfx, GXRenderHelperGfx, GXShapeHelperGfx, GXTextureHolder, MaterialParams } from '../gx/gx_render';

import { AreaLight, Material, MaterialSet, MREA, Surface, UVAnimationType } from './mrea';
import * as Viewer from '../viewer';
import { AABB, squaredDistanceFromPointToAABB } from '../Geometry';
import { TXTR } from './txtr';
import { CMDL } from './cmdl';
import { TextureMapping } from '../TextureHolder';
import { GfxDevice, GfxFormat, GfxMipFilterMode, GfxSampler, GfxTexFilterMode, GfxWrapMode } from '../gfx/platform/GfxPlatform';
import { GfxBufferCoalescerCombo, GfxCoalescedBuffersCombo } from '../gfx/helpers/BufferHelpers';
import { GfxRendererLayer, GfxRenderInst, GfxRenderInstManager, makeSortKey, setSortKeyBias, setSortKeyDepthKey } from '../gfx/render/GfxRenderInstManager';
import { computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { LoadedVertexData, LoadedVertexDraw, LoadedVertexLayout } from '../gx/gx_displaylist';
import { GX_Program, GXMaterialHacks, lightSetWorldDirectionNormalMatrix, lightSetWorldPositionViewMatrix } from '../gx/gx_material';
import { AreaAttributes, Entity, LightParameters, MP1EntityType, WorldLightingOptions } from './script';
import { Color, colorCopy, colorMult, colorNewCopy, OpaqueBlack, TransparentBlack, White } from '../Color';
import { computeNormalMatrix, getMatrixTranslation, setMatrixTranslation, texEnvMtx, transformVec3Mat4w0, transformVec3Mat4w1 } from '../MathHelpers';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { areaCollisionLineCheck } from './collision';
import { ResourceSystem } from './resource';
import { CSKR } from './cskr';
import { CINF } from './cinf';
import { AnimSysContext, IMetaAnim } from './animation/meta_nodes';
import { AnimTreeNode } from './animation/tree_nodes';
import { HierarchyPoseBuilder, PoseAsTransforms } from './animation/pose_builder';
import { CharAnimTime } from './animation/char_anim_time';
import * as GX from '../gx/gx_enum';
import { align } from '../gfx/platform/GfxPlatformUtil';

const noclipSpaceFromPrimeSpace = mat4.fromValues(
    1, 0,  0, 0,
    0, 0, -1, 0,
    0, 1,  0, 0,
    0, 0,  0, 1,
);

export class RetroTextureHolder extends GXTextureHolder<TXTR> {
    public addMaterialSetTextures(device: GfxDevice, materialSet: MaterialSet): void {
        this.addTextures(device, materialSet.textures);
    }
}

export const enum RetroPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

const scratchVec3 = vec3.create();

class ActorLights {
    public ambient: Color = colorNewCopy(TransparentBlack);
    public lights: AreaLight[] = [];

    constructor(actorBounds: AABB, lightParams: LightParameters, mrea: MREA) {
        // DisableWorld indicates the actor doesn't use any area lights (including ambient ones)
        if (lightParams.options === WorldLightingOptions.NoWorldLighting) {
            colorCopy(this.ambient, OpaqueBlack);
        } else if (mrea.lightLayers.length === 0) {
            colorCopy(this.ambient, White);
        } else {
            const layerIdx = lightParams.layerIdx;
            const layer = mrea.lightLayers[layerIdx];
            colorMult(this.ambient, layer.ambientColor, lightParams.ambient);

            interface ActorLight {
                sqDist: number;
                light: AreaLight;
            }

            const actorLights: ActorLight[] = [];

            for (let i = 0; i < layer.lights.length; i++) {
                const light = layer.lights[i];
                const sqDist = squaredDistanceFromPointToAABB(light.gxLight.Position, actorBounds);

                if (sqDist < (light.radius * light.radius)) {
                    // Shadow cast logic
                    if (light.castShadows && lightParams.options != WorldLightingOptions.NoShadowCast) {
                        actorBounds.centerPoint(scratchVec3);

                        let lightIsVisible = true;
                        if (lightIsVisible && mrea.collision !== null)
                            lightIsVisible = !areaCollisionLineCheck(light.gxLight.Position, scratchVec3, mrea.collision);

                        if (lightIsVisible)
                            actorLights.push({ sqDist, light });
                    } else {
                        actorLights.push({ sqDist, light });
                    }
                }
            }
            actorLights.sort((a, b) => a.sqDist - b.sqDist);

            // maxAreaLights check removed because currently the light selection logic does not match the game, causing highly influential lights to not render
            for (let i = 0; i < actorLights.length /*&& i < lightParams.maxAreaLights*/ && i < 8; i++)
                this.lights.push(actorLights[i].light);
        }
    }
}

const viewMatrixScratch = mat4.create();
const modelMatrixScratch = mat4.create();
const modelViewMatrixScratch = mat4.create();
const uvAnimationModelMatrixScratch = mat4.create();
const bboxScratch = new AABB();

class SurfaceData {
    public shapeHelper: GXShapeHelperGfx;

    constructor(device: GfxDevice, cache: GfxRenderCache, public surface: Surface, coalescedBuffers: GfxCoalescedBuffersCombo, public bbox: AABB) {
        this.shapeHelper = new GXShapeHelperGfx(device, cache, coalescedBuffers.vertexBuffers, coalescedBuffers.indexBuffer, surface.loadedVertexLayout, surface.loadedVertexData);
    }

    public destroy(device: GfxDevice) {
        this.shapeHelper.destroy(device);
    }
}

class SurfaceInstance {
    private materialTextureKey: number;
    private visible = true;
    public drawParams = new DrawParams();

    constructor(public surfaceData: SurfaceData, public materialInstance: MaterialInstance, public materialGroupInstance: MaterialGroupInstance, public modelMatrix: mat4) {
        this.materialTextureKey = materialInstance.textureKey;
    }

    public prepareToRender(device: GfxDevice, renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean, actorLights: ActorLights | null, envelopeMats: mat4[]|null, rootModelMatrix: mat4|null): void {
        if (!this.visible || !this.materialInstance.visible)
            return;

        mat4.mul(modelMatrixScratch, noclipSpaceFromPrimeSpace, this.modelMatrix);

        if (!isSkybox) {
            bboxScratch.transform(this.surfaceData.bbox, modelMatrixScratch);
            if (!viewerInput.camera.frustum.contains(bboxScratch))
                return;
        }

        const viewMatrix = viewMatrixScratch;

        if (isSkybox)
            computeViewMatrixSkybox(viewMatrix, viewerInput.camera);
        else
            computeViewMatrix(viewMatrix, viewerInput.camera);

        mat4.mul(modelViewMatrixScratch, viewMatrix, modelMatrixScratch);

        let uvAnimationModelMatrix = this.modelMatrix;
        if (rootModelMatrix !== null) {
            mat4.mul(uvAnimationModelMatrixScratch, rootModelMatrix, this.modelMatrix);
            uvAnimationModelMatrix = uvAnimationModelMatrixScratch;
        }

        const template = renderHelper.renderInstManager.pushTemplateRenderInst();
        if (envelopeMats === null)
            this.materialGroupInstance.setOnRenderInst(device, renderHelper.renderInstManager.gfxRenderCache, template);
        template.sortKey = setSortKeyDepthKey(template.sortKey, this.materialTextureKey);
        template.setSamplerBindingsFromTextureMappings(this.materialInstance.textureMappings);

        const loadedVertexData = assertExists(this.surfaceData.shapeHelper.loadedVertexData);
        for (let p = 0; p < loadedVertexData.draws.length; p++) {
            const packet = loadedVertexData.draws[p];

            if (envelopeMats !== null) {
                assert(this.drawParams.u_PosMtx.length >= packet.posMatrixTable.length);
                for (let j = 0; j < packet.posMatrixTable.length; j++) {
                    const posNrmMatrixIdx = packet.posMatrixTable[j];

                    // Leave existing matrix.
                    if (posNrmMatrixIdx === 0xFFFF)
                        continue;

                    mat4.mul(this.drawParams.u_PosMtx[j], modelViewMatrixScratch, envelopeMats[posNrmMatrixIdx]);
                }
            } else {
                for (let j = 0; j < this.drawParams.u_PosMtx.length; j++)
                    mat4.copy(this.drawParams.u_PosMtx[j], modelViewMatrixScratch);
            }

            const renderInst = renderHelper.renderInstManager.newRenderInst();
            this.materialGroupInstance.prepareToRender(renderHelper.renderInstManager, viewerInput, uvAnimationModelMatrix, isSkybox, actorLights, OpaqueBlack);
            this.materialGroupInstance.setOnRenderInst(device, renderHelper.renderInstManager.gfxRenderCache, renderInst);
            this.surfaceData.shapeHelper.setOnRenderInst(renderInst, packet);
            this.materialGroupInstance.materialHelper.allocateDrawParamsDataOnInst(renderInst, this.drawParams);

            renderHelper.renderInstManager.submitRenderInst(renderInst);
        }

        renderHelper.renderInstManager.popTemplateRenderInst();
    }
}

const scratchMatrix = mat4.create();
const materialParams = new MaterialParams();

class MaterialGroupInstance {
    public materialHelper: GXMaterialHelperGfx;
    public gfxSampler: GfxSampler;
    public materialParamsBlockOffs: number = 0;

    constructor(cache: GfxRenderCache, public material: Material, materialHacks?: GXMaterialHacks) {
        this.materialHelper = new GXMaterialHelperGfx(this.material.gxMaterial, materialHacks);

        this.gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
    }

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, renderInst: GfxRenderInst): void {
        // Set up the program.
        this.materialHelper.setOnRenderInst(device, cache, renderInst);

        renderInst.setUniformBufferOffset(GX_Program.ub_MaterialParams, this.materialParamsBlockOffs, this.materialHelper.materialParamsBufferSize);

        const layer = this.material.isDepthSorted ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        renderInst.sortKey = makeSortKey(layer, this.materialHelper.programKey);
        if (this.material.isDepthSorted)
            renderInst.sortKey = setSortKeyBias(renderInst.sortKey, this.material.sortBias);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: ReadonlyMat4, isSkybox: boolean, actorLights: ActorLights | null, worldAmbientColor: Color): void {
        this.materialParamsBlockOffs = this.materialHelper.allocateMaterialParamsBlock(renderInstManager);

        colorCopy(materialParams.u_Color[ColorKind.MAT0], White);

        if (isSkybox) {
            colorCopy(materialParams.u_Color[ColorKind.AMB0], White);
        } else {
            if (actorLights !== null)
                colorCopy(materialParams.u_Color[ColorKind.AMB0], actorLights.ambient);
            else if (this.material.isWhiteAmb)
                colorCopy(materialParams.u_Color[ColorKind.AMB0], White);
            else
                colorCopy(materialParams.u_Color[ColorKind.AMB0], worldAmbientColor);

            const viewMatrix = scratchMatrix;
            mat4.mul(viewMatrix, viewerInput.camera.viewMatrix, noclipSpaceFromPrimeSpace);

            for (let i = 0; i < 8; i++) {
                if (actorLights !== null && i < actorLights.lights.length) {
                    const light = actorLights.lights[i].gxLight;
                    materialParams.u_Lights[i].copy(light);
                    lightSetWorldPositionViewMatrix(materialParams.u_Lights[i], viewMatrix, light.Position[0], light.Position[1], light.Position[2]);
                    lightSetWorldDirectionNormalMatrix(materialParams.u_Lights[i], viewMatrix, light.Direction[0], light.Direction[1], light.Direction[2]);
                } else {
                    materialParams.u_Lights[i].reset();
                }
            }
        }

        for (let i = 0; i < 4; i++)
            colorCopy(materialParams.u_Color[ColorKind.CPREV + i], this.material.colorRegisters[i]);
        for (let i = 0; i < 4; i++)
            colorCopy(materialParams.u_Color[ColorKind.K0 + i], this.material.colorConstants[i]);

        const animTime = ((viewerInput.time / 1000) % 900);
        for (let i = 0; i < 8; i++) {
            const texMtx = materialParams.u_TexMtx[i];
            const postMtx = materialParams.u_PostTexMtx[i];
            mat4.identity(texMtx);
            mat4.identity(postMtx);

            const uvAnimation = this.material.uvAnimations[i];
            if (!uvAnimation)
                continue;

            if (uvAnimation.type === UVAnimationType.ENV_MAPPING_NO_TRANS) {
                mat4.mul(texMtx, viewerInput.camera.viewMatrix, noclipSpaceFromPrimeSpace);
                mat4.mul(texMtx, texMtx, modelMatrix);
                computeNormalMatrix(texMtx, texMtx);
                texEnvMtx(postMtx, 0.5, -0.5, 0.5, 0.5);
            } else if (uvAnimation.type === UVAnimationType.ENV_MAPPING) {
                mat4.mul(texMtx, viewerInput.camera.viewMatrix, noclipSpaceFromPrimeSpace);
                mat4.mul(texMtx, texMtx, modelMatrix);
                computeNormalMatrix(texMtx, texMtx);
                getMatrixTranslation(scratchVec3, modelMatrix);
                transformVec3Mat4w1(scratchVec3, viewerInput.camera.worldMatrix, scratchVec3);
                setMatrixTranslation(texMtx, scratchVec3);
                texEnvMtx(postMtx, 0.5, -0.5, 0.5, 0.5);
            } else if (uvAnimation.type === UVAnimationType.UV_SCROLL) {
                const transS = animTime * uvAnimation.scaleS + uvAnimation.offsetS;
                const transT = animTime * uvAnimation.scaleT + uvAnimation.offsetT;
                texMtx[12] = transS;
                texMtx[13] = transT;
            } else if (uvAnimation.type === UVAnimationType.ROTATION) {
                const theta = animTime * uvAnimation.scale + uvAnimation.offset;
                const cosR = Math.cos(theta);
                const sinR = Math.sin(theta);
                texMtx[0] = cosR;
                texMtx[4] = -sinR;
                texMtx[12] = (1.0 - (cosR - sinR)) * 0.5;

                texMtx[1] = sinR;
                texMtx[5] = cosR;
                texMtx[13] = (1.0 - (sinR + cosR)) * 0.5;
            } else if (uvAnimation.type === UVAnimationType.FLIPBOOK_U) {
                const n = uvAnimation.step * uvAnimation.scale * (uvAnimation.offset + animTime);
                const trans = Math.floor(uvAnimation.numFrames * (n % 1.0)) * uvAnimation.step;
                texMtx[12] = trans;
            } else if (uvAnimation.type === UVAnimationType.FLIPBOOK_V) {
                const n = uvAnimation.step * uvAnimation.scale * (uvAnimation.offset + animTime);
                const trans = Math.floor(uvAnimation.numFrames * (n % 1.0)) * uvAnimation.step;
                texMtx[13] = trans;
            } else if (uvAnimation.type === UVAnimationType.ENV_MAPPING_MODEL) {
                mat4.copy(texMtx, modelMatrix);
                texMtx[12] = 0;
                texMtx[13] = 0;
                texMtx[14] = 0;
                texEnvMtx(postMtx, 0.5, -0.5, modelMatrix[12] * 0.5, modelMatrix[13] * 0.5);
            } else if (uvAnimation.type === UVAnimationType.ENV_MAPPING_CYLINDER) {
                mat4.mul(scratchMatrix, viewerInput.camera.worldMatrix, noclipSpaceFromPrimeSpace);
                mat4.mul(texMtx, scratchMatrix, modelMatrix);
                computeNormalMatrix(texMtx, texMtx);
                const xy = ((scratchMatrix[12] + scratchMatrix[14]) * 0.025 * uvAnimation.phi) % 1.0;
                const z = (scratchMatrix[13] * 0.05 * uvAnimation.phi) % 1.0;
                const a = uvAnimation.theta * 0.5;
                texEnvMtx(postMtx, a, -a, xy, z);
            } else if (uvAnimation.type === UVAnimationType.SRT) {
                const theta = uvAnimation.rotationStatic + (animTime * uvAnimation.rotationScroll);
                const sinR = Math.sin(theta);
                const cosR = Math.cos(theta);
                texMtx[0] = uvAnimation.scaleS * cosR;
                texMtx[1] = uvAnimation.scaleT * -sinR;
                texMtx[4] = uvAnimation.scaleS * sinR;
                texMtx[5] = uvAnimation.scaleT * cosR;
                // Bug in the original game: Seems like a copy/paste error caused transTStatic to be used for both
                // translations here...
                texMtx[12] = uvAnimation.scaleS * (uvAnimation.transTStatic + (uvAnimation.transSScroll * animTime)) + (0.5 - (0.5 * (cosR - sinR)));
                texMtx[13] = uvAnimation.scaleT * (uvAnimation.transTStatic + (uvAnimation.transTScroll * animTime)) + (0.5 - (0.5 * (sinR + cosR)));
                // TODO: Handle uvAnimation.transformType
            }
        }

        this.materialHelper.fillMaterialParamsData(renderInstManager, this.materialParamsBlockOffs, materialParams);
    }
}

class MaterialInstance {
    public textureKey: number;
    public textureMappings = nArray(8, () => new TextureMapping());
    public visible = true;

    constructor(private materialGroup: MaterialGroupInstance, public material: Material, materialSet: MaterialSet, textureHolder: RetroTextureHolder) {
        this.textureKey = 0;
        for (let i = 0; i < material.textureIndexes.length; i++) {
            const textureIndex = material.textureIndexes[i];

            if (textureIndex === -1)
                continue;

            const txtr = materialSet.textures[materialSet.textureRemapTable[textureIndex]];

            textureHolder.fillTextureMapping(this.textureMappings[i], txtr.name);
            this.textureMappings[i].gfxSampler = materialGroup.gfxSampler;

            const globalTexIndex = textureHolder.findTextureEntryIndex(txtr.name);
            this.textureKey = (this.textureKey | globalTexIndex << (30 - (i * 10))) >>> 0;
        }
    }
}

interface MergedSurface extends Surface {
    origSurfaces: Surface[];
}

function mergeSurfaces(surfaces: Surface[]): MergedSurface {
    // Assume that all surfaces have the same vertex layout and material...
    let totalIndexCount = 0;
    let totalVertexCount = 0;
    let packedVertexDataSize = 0;
    const draws: LoadedVertexDraw[] = [];
    for (let i = 0; i < surfaces.length; i++) {
        const surface = surfaces[i];
        assert(surface.loadedVertexLayout.vertexBufferStrides[0] === surfaces[0].loadedVertexLayout.vertexBufferStrides[0]);
        totalIndexCount += surface.loadedVertexData.totalIndexCount;
        totalVertexCount += surface.loadedVertexData.totalVertexCount;
        packedVertexDataSize += surface.loadedVertexData.vertexBuffers[0].byteLength;
    }

    const packedVertexData = new Uint8Array(packedVertexDataSize);
    const indexData = new Uint32Array(totalIndexCount);
    let indexDataOffs = 0;
    let packedVertexDataOffs = 0;
    let vertexOffset = 0;
    for (let i = 0; i < surfaces.length; i++) {
        const surface = surfaces[i];
        assert(surface.loadedVertexData.indexData.byteLength === surface.loadedVertexData.totalIndexCount * 0x02);
        const surfaceIndexBuffer = new Uint16Array(surface.loadedVertexData.indexData);
        for (let j = 0; j < surfaceIndexBuffer.length; j++)
            indexData[indexDataOffs++] = vertexOffset + surfaceIndexBuffer[j];
        vertexOffset += surface.loadedVertexData.totalVertexCount;
        assert(vertexOffset <= 0xFFFFFFFF);

        packedVertexData.set(new Uint8Array(surface.loadedVertexData.vertexBuffers[0]), packedVertexDataOffs);
        packedVertexDataOffs += surface.loadedVertexData.vertexBuffers[0].byteLength;
    }

    // Merge into one giant draw. We know it doesn't use a posNrmMatrixTable or texMatrixTable.
    const srcDraw = surfaces[0].loadedVertexData.draws[0];
    const indexOffset = 0;
    const indexCount = totalIndexCount;
    const posMatrixTable = srcDraw.posMatrixTable;
    const texMatrixTable = srcDraw.texMatrixTable;
    draws.push({ indexOffset, indexCount, posMatrixTable, texMatrixTable });

    const newLoadedVertexData: LoadedVertexData = {
        indexData: indexData.buffer,
        vertexBuffers: [packedVertexData.buffer],
        totalIndexCount,
        totalVertexCount,
        vertexId: 0,
        draws,
        drawCalls: null,
        dlView: null,
    };

    const loadedVertexLayout: LoadedVertexLayout = { ...surfaces[0].loadedVertexLayout };
    loadedVertexLayout.indexFormat = GfxFormat.U32_R;

    return {
        materialIndex: surfaces[0].materialIndex,
        worldModelIndex: -1,
        loadedVertexLayout: loadedVertexLayout,
        loadedVertexData: newLoadedVertexData,
        skinIndexData: null,
        origSurfaces: surfaces,
    };
}

export class ModelCache {
    public cmdlData = new Map<string, CMDLData>();

    public destroy(device: GfxDevice): void {
        for (const [, v] of this.cmdlData.entries())
            v.destroy(device);
    }

    public getCMDLData(device: GfxDevice, textureHolder: RetroTextureHolder, cache: GfxRenderCache, model: CMDL): CMDLData {
        if (!this.cmdlData.has(model.assetID))
            this.cmdlData.set(model.assetID, CMDLData.create(device, textureHolder, cache, model));
        return this.cmdlData.get(model.assetID)!;
    }
}

export class MREARenderer {
    private bufferCoalescer: GfxBufferCoalescerCombo;
    private materialGroupInstances: MaterialGroupInstance[] = [];
    private materialInstances: MaterialInstance[] = [];
    private surfaceData: SurfaceData[] = [];
    private surfaceInstances: SurfaceInstance[] = [];
    private cmdlData: CMDLData[] = [];
    private actors: Actor[] = [];
    public overrideSky: CMDLRenderer | null = null;
    public modelMatrix = mat4.create();
    public needSky: boolean = false;
    public visible: boolean = true;

    constructor(private device: GfxDevice, private modelCache: ModelCache, private cache: GfxRenderCache, public textureHolder: RetroTextureHolder, public name: string, public mrea: MREA, private resourceSystem: ResourceSystem) {
        this.translateModel();
        this.translateActors();
    }

    private translateModel(): void {
        const materialSet = this.mrea.materialSet;

        this.textureHolder.addMaterialSetTextures(this.device, materialSet);

        // First, create our group commands. These will store UBO buffer data which is shared between
        // all groups using that material.
        for (let i = 0; i < materialSet.materials.length; i++) {
            const material = materialSet.materials[i];
            if (this.materialGroupInstances[material.groupIndex] === undefined)
                this.materialGroupInstances[material.groupIndex] = new MaterialGroupInstance(this.cache, material);
        }

        // Now create the material commands.
        this.materialInstances = materialSet.materials.map((material) => {
            const materialGroupCommand = this.materialGroupInstances[material.groupIndex];
            return new MaterialInstance(materialGroupCommand, material, materialSet, this.textureHolder);
        });

        // Gather all surfaces.
        const surfaces: Surface[] = [];
        for (let i = 0; i < this.mrea.worldModels.length; i++) {
            for (let j = 0; j < this.mrea.worldModels[i].geometry.surfaces.length; j++) {
                const materialCommand = this.materialInstances[this.mrea.worldModels[i].geometry.surfaces[j].materialIndex];
                if (materialCommand.material.isOccluder)
                    continue;
                surfaces.push(this.mrea.worldModels[i].geometry.surfaces[j]);
            }
        }

        // Sort by material.
        surfaces.sort((a, b) => a.materialIndex - b.materialIndex);

        // Merge surfaces with the same material.
        const vertexDatas: ArrayBufferSlice[][] = [];
        const indexDatas: ArrayBufferSlice[] = [];

        const mergedSurfaces: Surface[] = [];
        for (let i = 0; i < surfaces.length;) {
            let firstSurfaceIndex = i;

            const materialIndex = surfaces[firstSurfaceIndex].materialIndex;
            const materialCommand = this.materialInstances[materialIndex];

            // Transparent objects should not be merged.
            const canMerge = !materialCommand.material.isDepthSorted;
            i++;
            while (i < surfaces.length && surfaces[i].materialIndex === materialIndex && canMerge)
                i++;

            mergedSurfaces.push(mergeSurfaces(surfaces.slice(firstSurfaceIndex, i)));
        }

        for (let i = 0; i < mergedSurfaces.length; i++) {
            vertexDatas.push([new ArrayBufferSlice(mergedSurfaces[i].loadedVertexData.vertexBuffers[0])]);
            indexDatas.push(new ArrayBufferSlice(mergedSurfaces[i].loadedVertexData.indexData));
        }

        this.bufferCoalescer = new GfxBufferCoalescerCombo(this.device, vertexDatas, indexDatas);
        for (let i = 0; i < mergedSurfaces.length; i++) {
            const surface = mergedSurfaces[i];

            let bbox: AABB;
            if (surface.worldModelIndex >= 0) {
                // Unmerged, simple case.
                bbox = this.mrea.worldModels[surface.worldModelIndex].bbox;
            } else {
                const mergedSurface = surface as MergedSurface;
                bbox = new AABB();
                for (let j = 0; j < mergedSurface.origSurfaces.length; j++)
                    bbox.union(bbox, this.mrea.worldModels[mergedSurface.origSurfaces[j].worldModelIndex].bbox);
            }

            const surfaceData = new SurfaceData(this.device, this.cache, surface, this.bufferCoalescer.coalescedBuffers[i], bbox);
            this.surfaceData.push(surfaceData);
            const materialCommand = this.materialInstances[mergedSurfaces[i].materialIndex];
            const materialGroupCommand = this.materialGroupInstances[materialCommand.material.groupIndex];
            const instance = new SurfaceInstance(surfaceData, materialCommand, materialGroupCommand, mat4.create());
            this.surfaceInstances.push(instance);
        }
    }

    private translateActors(): void {
        for (let i = 0; i < this.mrea.scriptLayers.length; i++) {
            const scriptLayer = this.mrea.scriptLayers[i];

            for (let j = 0; j < scriptLayer.entities.length; j++) {
                const ent = scriptLayer.entities[j];
                let { cmdl, animationData } = ent.getRenderModel(this.resourceSystem);

                // Don't animate doors for now
                if (ent.type === MP1EntityType.Door)
                    animationData = null;

                if (cmdl !== null) {
                    const aabb = new AABB();
                    aabb.transform(cmdl.bbox, ent.modelMatrix);

                    const actorLights = new ActorLights(aabb, ent.lightParams, this.mrea);
                    const cmdlData = this.modelCache.getCMDLData(this.device, this.textureHolder, this.cache, cmdl);
                    const cmdlRenderer = new CMDLRenderer(this.cache, this.textureHolder, actorLights, ent.name, ent.modelMatrix, cmdlData, animationData);
                    const actor = new Actor(ent, cmdlRenderer);
                    this.actors.push(actor);
                }

                if (ent.type === MP1EntityType.AreaAttributes || ent.type === 'REAA') {
                    const areaAttributes = ent as AreaAttributes;

                    // Only process AreaAttributes properties if this is the first one in the area with a sky configured, to avoid mixing and matching different entities
                    if (!this.needSky && areaAttributes.needSky) {
                        this.needSky = true;

                        if (areaAttributes.overrideSky !== null) {
                            const modelMatrix = mat4.create();

                            const skyData = this.modelCache.getCMDLData(this.device, this.textureHolder, this.cache, areaAttributes.overrideSky);
                            this.overrideSky = new CMDLRenderer(this.cache, this.textureHolder, null, `Sky_AreaAttributes_Layer${i}`, modelMatrix, skyData, null);
                            this.overrideSky.isSkybox = true;
                        }
                    }
                }
            }
        }
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public setSuitModel(suitModel: number): void {
        for (let i = 0; i < this.actors.length; ++i) {
            const ent = this.actors[i].entity;
            if (ent.type === MP1EntityType.PlayerActor || ent.type === 'PLAC') {
                let { cmdl, animationData } = ent.getRenderModel(this.resourceSystem, suitModel);

                if (cmdl !== null) {
                    const aabb = new AABB();
                    aabb.transform(cmdl.bbox, ent.modelMatrix);

                    const actorLights = new ActorLights(aabb, ent.lightParams, this.mrea);
                    const cmdlData = this.modelCache.getCMDLData(this.device, this.textureHolder, this.cache, cmdl);
                    const cmdlRenderer = new CMDLRenderer(this.cache, this.textureHolder, actorLights, ent.name, ent.modelMatrix, cmdlData, animationData);
                    this.actors[i].cmdlRenderer.destroy(this.device);
                    this.actors[i] = new Actor(ent, cmdlRenderer);
                }
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput, worldAmbientColor: Color, showAllActors: boolean): void {
        if (!this.visible)
            return;

        const templateRenderInst = renderHelper.renderInstManager.pushTemplateRenderInst();
        templateRenderInst.filterKey = RetroPass.MAIN;

        // Render the MREA's native surfaces.
        for (let i = 0; i < this.materialGroupInstances.length; i++)
            this.materialGroupInstances[i].prepareToRender(renderHelper.renderInstManager, viewerInput, this.modelMatrix, false, null, worldAmbientColor);
        for (let i = 0; i < this.surfaceInstances.length; i++)
            this.surfaceInstances[i].prepareToRender(device, renderHelper, viewerInput, false, null, null, null);

        for (let i = 0; i < this.actors.length; i++)
            this.actors[i].prepareToRender(device, renderHelper, viewerInput, showAllActors);

        renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
        for (let i = 0; i < this.cmdlData.length; i++)
            this.cmdlData[i].destroy(device);
        for (let i = 0; i < this.surfaceData.length; i++)
            this.surfaceData[i].destroy(device);
        for (let i = 0; i < this.actors.length; i++)
            this.actors[i].cmdlRenderer.destroy(device);
    }
}

export class CMDLData {
    private bufferCoalescer: GfxBufferCoalescerCombo;
    public surfaceData: SurfaceData[] = [];
    public hasSkinIndexData: boolean = false;
    private readonly shadowVertexData: Uint8Array | null = null;

    private constructor(device: GfxDevice, cache: GfxRenderCache, public cmdl: CMDL) {
        const vertexDatas: ArrayBufferSlice[][] = [];
        const indexDatas: ArrayBufferSlice[] = [];

        // Coalesce surface data.
        const surfaces = this.cmdl.geometry.surfaces;
        let totalVertexDataLength = 0;
        for (let i = 0; i < surfaces.length; i++) {
            const surface = surfaces[i];
            vertexDatas.push([new ArrayBufferSlice(surface.loadedVertexData.vertexBuffers[0])]);
            indexDatas.push(new ArrayBufferSlice(surface.loadedVertexData.indexData));
            totalVertexDataLength += surface.loadedVertexData.vertexBuffers[0].byteLength;
            if (surface.skinIndexData)
                this.hasSkinIndexData = true;
        }

        if (this.hasSkinIndexData) {
            // Build a shadow copy of the coalesced vertex buffer to update positions and normals on CPU.
            // Simplified version of BufferHelpers.coalesceBuffer()
            const wordCount = align(totalVertexDataLength, 4) / 4;
            this.shadowVertexData = new Uint8Array(wordCount * 4);
            let byteOffset: number = 0;
            for (let i = 0; i < surfaces.length; i++) {
                const vertexBuffer = surfaces[i].loadedVertexData.vertexBuffers[0];
                this.shadowVertexData.set(new Uint8Array(vertexBuffer), byteOffset);
                byteOffset += vertexBuffer.byteLength;
            }
        }

        this.bufferCoalescer = new GfxBufferCoalescerCombo(device, vertexDatas, indexDatas);

        for (let i = 0; i < surfaces.length; i++) {
            const coalescedBuffers = this.bufferCoalescer.coalescedBuffers[i];
            this.surfaceData[i] = new SurfaceData(device, cache, surfaces[i], coalescedBuffers, this.cmdl.bbox);
        }
    }

    public static create(device: GfxDevice, textureHolder: RetroTextureHolder, cache: GfxRenderCache, cmdl: CMDL): CMDLData {
        const materialSet = cmdl.materialSets[0];
        textureHolder.addMaterialSetTextures(device, materialSet);

        return new CMDLData(device, cache, cmdl);
    }

    public duplicate(device: GfxDevice, cache: GfxRenderCache): CMDLData {
        return new CMDLData(device, cache, this.cmdl);
    }

    public cpuSkinVerts(device: GfxDevice, envelopeMats: mat4[]) {
        assert(this.hasSkinIndexData);

        const surfaces = this.cmdl.geometry.surfaces;
        for (let i = 0; i < surfaces.length; i++) {
            const surface = surfaces[i];
            const skinIndices = surface.skinIndexData!;
            const vertexLayout = surface.loadedVertexLayout;
            const stride = vertexLayout.vertexBufferStrides[0] / 4;
            const posOffset = vertexLayout.vertexAttributeOffsets[GX.Attr.POS] / 4;
            const nrmOffset = vertexLayout.vertexAttributeOffsets[GX.Attr.NRM] / 4;
            const vertexBuffer = this.bufferCoalescer.coalescedBuffers[i].vertexBuffers[0];
            const srcVertexData = new Float32Array(surface.loadedVertexData.vertexBuffers[0]);
            const dstVertexData = new Float32Array(this.shadowVertexData!.buffer, vertexBuffer.byteOffset, vertexBuffer.byteCount / 4);

            const transform = (vidx: number, attrOffset: number, transformFunc: typeof transformVec3Mat4w1) => {
                const voff = vidx * stride + attrOffset;
                scratchVec3[0] = srcVertexData[voff];
                scratchVec3[1] = srcVertexData[voff + 1];
                scratchVec3[2] = srcVertexData[voff + 2];
                transformFunc(scratchVec3, envelopeMats[skinIndices[vidx]], scratchVec3);
                dstVertexData[voff] = scratchVec3[0];
                dstVertexData[voff + 1] = scratchVec3[1];
                dstVertexData[voff + 2] = scratchVec3[2];
            };

            for (let v = 0; v < skinIndices.length; v++) {
                transform(v, posOffset, transformVec3Mat4w1);
                transform(v, nrmOffset, transformVec3Mat4w0);
            }
        }

        device.uploadBufferData(this.bufferCoalescer.vertexBuffer!, 0, this.shadowVertexData!);
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
        for (let i = 0; i < this.surfaceData.length; i++)
            this.surfaceData[i].destroy(device);
    }
}

export interface AnimationData {
    cskr: CSKR;
    cinf: CINF;
    metaAnim: IMetaAnim;
    animSysContext: AnimSysContext;
}

// TODO(jstpierre): Dedupe.
export class CMDLRenderer {
    private materialGroupInstances: MaterialGroupInstance[] = [];
    private materialInstances: MaterialInstance[] = [];
    private surfaceInstances: SurfaceInstance[] = [];
    public visible: boolean = true;
    public isSkybox: boolean = false;
    public modelMatrix: mat4 = mat4.create();
    private animTreeNode: AnimTreeNode|null = null;
    private readonly poseBuilder: HierarchyPoseBuilder|null = null;
    private pose: PoseAsTransforms|null = null;
    private readonly envelopeMats: mat4[]|null = null;

    constructor(cache: GfxRenderCache, public textureHolder: RetroTextureHolder, public actorLights: ActorLights | null, public name: string, modelMatrix: mat4 | null, public cmdlData: CMDLData, public animationData: AnimationData | null) {
        if (animationData) {
            this.poseBuilder = new HierarchyPoseBuilder(animationData.cinf);
            this.envelopeMats = nArray(animationData.cskr.skinRules.length, () => mat4.create());
            if (this.cmdlData.hasSkinIndexData)
                this.cmdlData = this.cmdlData.duplicate(cache.device, cache);
        }

        const materialSet = this.cmdlData.cmdl.materialSets[0];

        // First, create our group commands. These will store UBO buffer data which is shared between
        // all groups using that material.
        for (let i = 0; i < materialSet.materials.length; i++) {
            const material = materialSet.materials[i];
            if (this.materialGroupInstances[material.groupIndex] === undefined)
                this.materialGroupInstances[material.groupIndex] = new MaterialGroupInstance(cache, material);
        }

        // Now create the material commands.
        this.materialInstances = materialSet.materials.map((material) => {
            const materialGroupCommand = this.materialGroupInstances[material.groupIndex];
            return new MaterialInstance(materialGroupCommand, material, materialSet, this.textureHolder);
        });

        for (let i = 0; i < this.cmdlData.surfaceData.length; i++) {
            const surfaceData = this.cmdlData.surfaceData[i];
            const materialCommand = this.materialInstances[surfaceData.surface.materialIndex];
            const materialGroupCommand = this.materialGroupInstances[materialCommand.material.groupIndex];

            // Don't render occluders.
            if (materialCommand.material.isOccluder)
                continue;

            this.surfaceInstances.push(new SurfaceInstance(surfaceData, materialCommand, materialGroupCommand, this.modelMatrix));
        }

        if (modelMatrix !== null)
            mat4.copy(this.modelMatrix, modelMatrix);
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public prepareToRender(device: GfxDevice, renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        let rootModelMatrix: mat4|null = null;
        if (this.animationData && this.poseBuilder) {
            if (!this.animTreeNode) {
                this.animTreeNode = this.animationData.metaAnim.GetAnimationTree(this.animationData.animSysContext);
                this.pose = new PoseAsTransforms();
            }

            this.animTreeNode.AdvanceView(new CharAnimTime(viewerInput.deltaTime / 1000));
            const simp = this.animTreeNode.Simplified();
            if (simp)
                this.animTreeNode = simp as AnimTreeNode;

            this.poseBuilder.BuildFromAnimRoot(this.animTreeNode, this.pose!);

            const skinRules = this.animationData.cskr.skinRules;
            for (let i = 0; i < skinRules.length; ++i) {
                const skinRule = skinRules[i];
                const envMat = this.envelopeMats![i];
                envMat.fill(0);
                for (const weight of skinRule.weights) {
                    const mat = this.pose!.get(weight.boneId) as mat4;
                    mat4.multiplyScalarAndAdd(envMat, envMat, mat, weight.weight);
                }
            }

            if (this.cmdlData.hasSkinIndexData) {
                // If skin indices were extracted (skinned MP1 model) update
                // vertex buffer with transformed vertex positions and normals.
                this.cmdlData.cpuSkinVerts(device, this.envelopeMats!);
            } else {
                // MP2 position-dependent animations are transformed using the rigged
                // root transform (child of entity root).
                rootModelMatrix = this.pose!.get(0) as mat4;
            }
        }

        const templateRenderInst = renderHelper.renderInstManager.pushTemplateRenderInst();
        templateRenderInst.filterKey = this.isSkybox ? RetroPass.SKYBOX : RetroPass.MAIN;

        for (let i = 0; i < this.materialGroupInstances.length; i++)
            if (this.materialGroupInstances[i] !== undefined)
                this.materialGroupInstances[i].prepareToRender(renderHelper.renderInstManager, viewerInput, this.modelMatrix, this.isSkybox, this.actorLights, OpaqueBlack);
        for (let i = 0; i < this.surfaceInstances.length; i++)
            this.surfaceInstances[i].prepareToRender(device, renderHelper, viewerInput, this.isSkybox, this.actorLights, this.cmdlData.hasSkinIndexData ? null : this.envelopeMats, rootModelMatrix);

        renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice) {
        if (this.animationData && this.cmdlData.hasSkinIndexData) {
            // This instance is not part of the CMDL cache.
            this.cmdlData.destroy(device);
        }
    }
}

class Actor {
    constructor(public entity: Entity, public cmdlRenderer: CMDLRenderer) {
    }

    public prepareToRender(device: GfxDevice, renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput, showAllActors: boolean): void {
        if (!showAllActors && !this.entity.active)
            return;

        if (this.entity.autoSpin)
            mat4.rotateZ(this.cmdlRenderer.modelMatrix, this.entity.modelMatrix, 8 * (viewerInput.time / 1000));

        this.cmdlRenderer.prepareToRender(device, renderHelper, viewerInput);
    }
}
