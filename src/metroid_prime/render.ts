import { mat4, ReadonlyMat4, ReadonlyVec3, vec3 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { assert, assertExists, nArray } from '../util';
import { ColorKind, DrawParams, GXMaterialHelperGfx, GXShapeHelperGfx, GXTextureHolder, MaterialParams } from '../gx/gx_render';

import { AreaLight, AreaLightType, Material, MaterialSet, MREA, Surface, UVAnimationType } from './mrea';
import * as Viewer from '../viewer';
import { AABB, squaredDistanceFromPointToAABB } from '../Geometry';
import { TXTR } from './txtr';
import { CMDL } from './cmdl';
import { TextureMapping } from '../TextureHolder';
import { GfxDevice, GfxFormat, GfxMipFilterMode, GfxSampler, GfxTexFilterMode, GfxWrapMode } from '../gfx/platform/GfxPlatform';
import { GfxBufferCoalescerCombo, GfxCoalescedBuffersCombo } from '../gfx/helpers/BufferHelpers';
import { GfxRendererLayer, GfxRenderInst, makeSortKey, setSortKeyBias, setSortKeyDepthKey } from '../gfx/render/GfxRenderInstManager';
import { computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { LoadedVertexData, LoadedVertexDraw, LoadedVertexLayout } from '../gx/gx_displaylist';
import * as GX_Material from '../gx/gx_material';
import { GX_Program, GXMaterialHacks, lightSetWorldDirectionNormalMatrix, lightSetWorldPositionViewMatrix } from '../gx/gx_material';
import { AreaAttributes, Effect, Entity, LightParameters, MP1EntityType, WorldLightingOptions } from './script';
import { Color, colorAdd, colorCopy, colorMult, colorNewCopy, OpaqueBlack, TransparentBlack, White } from '../Color';
import { computeNormalMatrix, getMatrixTranslation, setMatrixTranslation, texEnvMtx, transformVec3Mat4w0, transformVec3Mat4w1, Vec3One } from '../MathHelpers';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { areaCollisionLineCheck } from './collision';
import { ResourceGame, ResourceSystem } from './resource';
import { CSKR } from './cskr';
import { CINF } from './cinf';
import { AnimSysContext, IMetaAnim } from './animation/meta_nodes';
import { AnimTreeNode } from './animation/tree_nodes';
import { HierarchyPoseBuilder, PoseAsTransforms } from './animation/pose_builder';
import { CharAnimTime } from './animation/char_anim_time';
import * as GX from '../gx/gx_enum';
import { align } from '../gfx/platform/GfxPlatformUtil';
import { BaseGenerator, Light } from './particles/base_generator';
import { ElementGenerator, ModelOrientationType } from './particles/element_generator';
import { ParentedMode, ParticleData, ParticlePOINode } from './animation/base_reader';
import { PART } from './part';
import { SWHC } from './swhc';
import { ELSC } from './elsc';
import { SwooshGenerator } from './particles/swoosh_generator';
import { ElectricGenerator } from './particles/electric_generator';
import { Tweaks } from './tweaks';
import { RetroSceneRenderer } from './scenes';
import { EVNT } from './evnt';

export const noclipSpaceFromPrimeSpace = mat4.fromValues(
    1, 0,  0, 0,
    0, 0, -1, 0,
    0, 1,  0, 0,
    0, 0,  0, 1,
);

export const primeSpaceFromNoclipSpace = mat4.fromValues(
    1,  0, 0, 0,
    0,  0, 1, 0,
    0, -1, 0, 0,
    0,  0, 0, 1,
);

export const enum RetroPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

const scratchVec3 = vec3.create();
const scratchParticleNodes = new Array<ParticlePOINode>(20);

interface LightAndIntensity {
    light: GX_Material.Light;
    intensity: number;
    transform: ReadonlyMat4;
}

class ActorLights {
    public ambient: Color = colorNewCopy(TransparentBlack);
    public lights: AreaLight[] = [];

    public reset() {
        colorCopy(this.ambient, TransparentBlack);
        this.lights = [];
    }

    public populateAreaLights(actorBounds: AABB, lightParams: LightParameters, mrea: MREA) {
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

                if (sqDist < (light.radius ** 2)) {
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

    private static calculateIntensity(light: Light): number {
        const coef = light.custom ? light.gxLight.CosAtten[0] : 1.0;
        return coef * Math.max(light.gxLight.Color.r, light.gxLight.Color.g, light.gxLight.Color.b);
    }

    public addParticleLights(particleEmitters: ParticleEmitter[], showAllActors: boolean) {
        this.lights = [];

        const tempLights: LightAndIntensity[] = [];
        for (let i = 0; i < particleEmitters.length; ++i) {
            const emitter = particleEmitters[i];
            if (!showAllActors && !emitter.active)
                continue;
            if (!emitter.generator.SystemHasLight())
                continue;
            const light = emitter.generator.GetLight();
            tempLights.push({ light: light.gxLight, intensity: ActorLights.calculateIntensity(light), transform: emitter.transform });
        }

        tempLights.sort((a, b) => b.intensity - a.intensity);

        for (let i = 0; i < 8 && i < tempLights.length; ++i) {
            const gxLight = tempLights[i].light;
            transformVec3Mat4w1(gxLight.Position, tempLights[i].transform, gxLight.Position);
            transformVec3Mat4w0(gxLight.Direction, tempLights[i].transform, gxLight.Direction);
            this.lights.push({ type: AreaLightType.Custom, radius: 1.0, castShadows: false, gxLight });
        }
    }
}

const viewMatrixScratch = mat4.create();
const modelMatrixScratch = mat4.create();
const modelViewMatrixScratch = mat4.create();
const bboxScratch = new AABB();

class SurfaceData {
    public shapeHelper: GXShapeHelperGfx;

    constructor(renderer: RetroSceneRenderer, public surface: Surface, coalescedBuffers: GfxCoalescedBuffersCombo, public bbox: AABB) {
        this.shapeHelper = new GXShapeHelperGfx(renderer.device, renderer.renderCache, coalescedBuffers.vertexBuffers, coalescedBuffers.indexBuffer, surface.loadedVertexLayout, surface.loadedVertexData);
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

    public prepareToRender(renderer: RetroSceneRenderer, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean, envelopeMats: mat4[]|null, overrideBbox: AABB|null): void {
        if (!this.visible || !this.materialInstance.visible)
            return;

        mat4.mul(modelMatrixScratch, noclipSpaceFromPrimeSpace, this.modelMatrix);

        if (!isSkybox) {
            if (overrideBbox)
                bboxScratch.transform(overrideBbox, noclipSpaceFromPrimeSpace);
            else
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

        const renderInst = renderer.renderHelper.renderInstManager.newRenderInst();
        this.surfaceData.shapeHelper.setOnRenderInst(renderInst);
        this.materialGroupInstance.setOnRenderInst(renderer.device, renderer.renderCache, renderInst);

        const loadedVertexData = assertExists(this.surfaceData.shapeHelper.loadedVertexData);
        assert(loadedVertexData.draws.length === 1);
        const packet = loadedVertexData.draws[0];

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

        this.materialGroupInstance.materialHelper.allocateDrawParamsDataOnInst(renderInst, this.drawParams);
        renderInst.sortKey = setSortKeyDepthKey(renderInst.sortKey, this.materialTextureKey);

        renderInst.setSamplerBindingsFromTextureMappings(this.materialInstance.textureMappings);
        renderer.renderHelper.renderInstManager.submitRenderInst(renderInst);
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

    public prepareToRender(renderer: RetroSceneRenderer, viewerInput: Viewer.ViewerRenderInput, modelMatrix: ReadonlyMat4, isSkybox: boolean, actorLights: ActorLights | null, worldAmbientColor: Color = renderer.worldAmbientColor): void {
        this.materialParamsBlockOffs = this.materialHelper.allocateMaterialParamsBlock(renderer.renderHelper.renderInstManager);

        colorCopy(materialParams.u_Color[ColorKind.MAT0], White);

        if (isSkybox) {
            colorCopy(materialParams.u_Color[ColorKind.AMB0], White);
        } else {
            if (actorLights !== null) // actorLights.ambient always black for MREA, worldAmbientColor always black for CMDL
                colorAdd(materialParams.u_Color[ColorKind.AMB0], actorLights.ambient, worldAmbientColor);
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

        this.materialHelper.fillMaterialParamsData(renderer.renderHelper.renderInstManager, this.materialParamsBlockOffs, materialParams);
    }
}

class MaterialInstance {
    public textureKey: number;
    public textureMappings = nArray(8, () => new TextureMapping());
    public visible = true;

    constructor(private materialGroup: MaterialGroupInstance, public material: Material, materialSet: MaterialSet, textureHolder: GXTextureHolder<TXTR>) {
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

    public getCMDLData(renderer: RetroSceneRenderer, model: CMDL): CMDLData {
        const key = `${model.assetID}${model.cskr ? '_skinned' : ''}`;
        if (!this.cmdlData.has(key))
            this.cmdlData.set(key, CMDLData.create(renderer, model));
        return this.cmdlData.get(key)!;
    }
}

interface ParticleEmitter {
    generator: BaseGenerator;
    active: boolean;
    transform: ReadonlyMat4;
}

const scratchAreaLights = new ActorLights();

export class MREARenderer {
    private bufferCoalescer: GfxBufferCoalescerCombo;
    private materialGroupInstances: MaterialGroupInstance[] = [];
    private materialInstances: MaterialInstance[] = [];
    private surfaceData: SurfaceData[] = [];
    private surfaceInstances: SurfaceInstance[] = [];
    private cmdlData: CMDLData[] = [];
    private actors: Actor[] = [];
    private particleEmitters: ParticleEmitter[] = [];
    public overrideSky: CMDLRenderer | null = null;
    public modelMatrix = mat4.create();
    public needSky: boolean = false;
    public layerGroup: string = 'Light';
    public visible: boolean = true;

    constructor(private sceneRenderer: RetroSceneRenderer, public name: string, public mrea: MREA, private resourceSystem: ResourceSystem, tweaks: Tweaks | null) {
        this.translateModel();
        this.translateActors(tweaks);
    }

    private translateModel(): void {
        const materialSet = this.mrea.materialSet;

        this.sceneRenderer.addMaterialSetTextures(materialSet);

        // First, create our group commands. These will store UBO buffer data which is shared between
        // all groups using that material.
        for (let i = 0; i < materialSet.materials.length; i++) {
            const material = materialSet.materials[i];
            if (this.materialGroupInstances[material.groupIndex] === undefined)
                this.materialGroupInstances[material.groupIndex] = new MaterialGroupInstance(this.sceneRenderer.renderCache, material);
        }

        // Now create the material commands.
        this.materialInstances = materialSet.materials.map((material) => {
            const materialGroupCommand = this.materialGroupInstances[material.groupIndex];
            return new MaterialInstance(materialGroupCommand, material, materialSet, this.sceneRenderer.textureHolder);
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

        this.bufferCoalescer = new GfxBufferCoalescerCombo(this.sceneRenderer.device, vertexDatas, indexDatas);
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

            const surfaceData = new SurfaceData(this.sceneRenderer, surface, this.bufferCoalescer.coalescedBuffers[i], bbox);
            this.surfaceData.push(surfaceData);
            const materialCommand = this.materialInstances[mergedSurfaces[i].materialIndex];
            const materialGroupCommand = this.materialGroupInstances[materialCommand.material.groupIndex];
            const instance = new SurfaceInstance(surfaceData, materialCommand, materialGroupCommand, mat4.create());
            this.surfaceInstances.push(instance);
        }
    }

    private translateActors(tweaks: Tweaks | null): void {
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
                    aabb.transform(animationData ? animationData.aabb : cmdl.bbox, ent.modelMatrix);

                    const actorLights = new ActorLights();
                    actorLights.populateAreaLights(aabb, ent.lightParams, this.mrea);
                    const cmdlData = this.sceneRenderer.getCMDLData(cmdl);
                    const cmdlRenderer = new CMDLRenderer(this.sceneRenderer, actorLights, ent.name, ent.modelMatrix, ent.modelMatrixNoScale, ent.scale, cmdlData, animationData, aabb);
                    const actor = new Actor(ent, cmdlRenderer);

                    if (tweaks && (ent.type === MP1EntityType.PlayerActor || ent.type === 'PLAC')) {
                        const gunCmdlData = this.sceneRenderer.getCMDLData(tweaks.GetCineGun()!);
                        const gunCmdlRenderer = new CMDLRenderer(this.sceneRenderer, actorLights, `${ent.name}_gun`, ent.modelMatrix, ent.modelMatrixNoScale, ent.scale, gunCmdlData, null, aabb);
                        actor.attachments.push({ boneName: 'GUN_LCTR', cmdlRenderer: gunCmdlRenderer });
                    }

                    this.actors.push(actor);
                }

                if (ent instanceof AreaAttributes) {
                    // Only process AreaAttributes properties if this is the first one in the area with a sky configured, to avoid mixing and matching different entities
                    if (!this.needSky && ent.needSky) {
                        this.needSky = true;

                        if (ent.overrideSky !== null) {
                            const modelMatrix = mat4.create();

                            const skyData = this.sceneRenderer.getCMDLData(ent.overrideSky);
                            this.overrideSky = new CMDLRenderer(this.sceneRenderer, null, `Sky_AreaAttributes_Layer${i}`, modelMatrix, modelMatrix, Vec3One, skyData, null);
                            this.overrideSky.isSkybox = true;
                        }
                    }

                    if (ent.darkWorld)
                        this.layerGroup = 'Dark';
                } else if (ent instanceof Effect) {
                    if (ent.particle) {
                        const generator = new ElementGenerator(ent.particle.description, ModelOrientationType.Normal, false, this.sceneRenderer);
                        mat4.copy(scratchMatrix, ent.modelMatrixNoScale);
                        scratchMatrix[12] = 0;
                        scratchMatrix[13] = 0;
                        scratchMatrix[14] = 0;
                        mat4.getTranslation(scratchVec3, ent.modelMatrixNoScale);
                        generator.SetOrientation(scratchMatrix);
                        generator.SetGlobalTranslation(scratchVec3);
                        generator.SetGlobalScale(ent.scale);
                        generator.SetParticleEmission(true);
                        this.particleEmitters.push({ generator, active: ent.active, transform: ent.modelMatrixNoScale });
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
                    aabb.transform(animationData ? animationData.aabb : cmdl.bbox, ent.modelMatrix);

                    const actorLights = new ActorLights();
                    actorLights.populateAreaLights(aabb, ent.lightParams, this.mrea);
                    const cmdlData = this.sceneRenderer.getCMDLData(cmdl);
                    const cmdlRenderer = new CMDLRenderer(this.sceneRenderer, actorLights, ent.name, ent.modelMatrix, ent.modelMatrixNoScale, ent.scale, cmdlData, animationData, aabb);

                    const actor = this.actors[i];
                    actor.cmdlRenderer.destroy(this.sceneRenderer.device);
                    actor.cmdlRenderer = cmdlRenderer;
                    for (let i = 0; i < actor.attachments.length; ++i) {
                        const attachment = actor.attachments[i];
                        attachment.cmdlRenderer.actorLights = actorLights;
                        attachment.cmdlRenderer.bbox = aabb;
                    }
                }
            }
        }
    }

    public prepareToRender(renderer: RetroSceneRenderer, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        const templateRenderInst = renderer.renderHelper.renderInstManager.pushTemplateRenderInst();
        templateRenderInst.filterKey = RetroPass.MAIN;

        if (renderer.enableParticles) {
            for (let i = 0; i < this.particleEmitters.length; i++) {
                const emitter = this.particleEmitters[i];
                if (!renderer.showAllActors && !emitter.active)
                    continue;
                if (emitter.generator.isInBoundsForUpdate(viewerInput))
                    emitter.generator.Update(renderer.device, viewerInput.deltaTime / 1000.0);
            }
            scratchAreaLights.addParticleLights(this.particleEmitters, renderer.showAllActors);
        } else {
            scratchAreaLights.reset();
        }

        // Render the MREA's native surfaces.
        for (let i = 0; i < this.materialGroupInstances.length; i++)
            this.materialGroupInstances[i].prepareToRender(renderer, viewerInput, this.modelMatrix, false, scratchAreaLights);
        for (let i = 0; i < this.surfaceInstances.length; i++)
            this.surfaceInstances[i].prepareToRender(renderer, viewerInput, false, null, null);

        for (let i = 0; i < this.actors.length; i++)
            this.actors[i].prepareToRender(renderer, viewerInput);

        if (renderer.enableParticles) {
            for (let i = 0; i < this.particleEmitters.length; i++) {
                const emitter = this.particleEmitters[i];
                if (!renderer.showAllActors && !emitter.active)
                    continue;
                emitter.generator.prepareToRender(renderer, viewerInput);
            }
        }

        renderer.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
        for (let i = 0; i < this.cmdlData.length; i++)
            this.cmdlData[i].destroy(device);
        for (let i = 0; i < this.surfaceData.length; i++)
            this.surfaceData[i].destroy(device);
        for (let i = 0; i < this.actors.length; i++)
            this.actors[i].cmdlRenderer.destroy(device);
        for (let i = 0; i < this.particleEmitters.length; i++)
            this.particleEmitters[i].generator.Destroy(device);
    }
}

export class CMDLData {
    private bufferCoalescer: GfxBufferCoalescerCombo;
    public surfaceData: SurfaceData[] = [];
    public hasSkinIndexData: boolean = false;
    private readonly shadowVertexData: Uint8Array | null = null;

    private constructor(renderer: RetroSceneRenderer, public cmdl: CMDL) {
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

        this.bufferCoalescer = new GfxBufferCoalescerCombo(renderer.device, vertexDatas, indexDatas);

        for (let i = 0; i < surfaces.length; i++) {
            const coalescedBuffers = this.bufferCoalescer.coalescedBuffers[i];
            this.surfaceData[i] = new SurfaceData(renderer, surfaces[i], coalescedBuffers, this.cmdl.bbox);
        }
    }

    public static create(renderer: RetroSceneRenderer, cmdl: CMDL): CMDLData {
        const materialSet = cmdl.materialSets[0];
        renderer.addMaterialSetTextures(materialSet);

        return new CMDLData(renderer, cmdl);
    }

    public duplicate(renderer: RetroSceneRenderer): CMDLData {
        return new CMDLData(renderer, this.cmdl);
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
    mp2Evnt: EVNT | null;
    aabb: AABB;
    animSysContext: AnimSysContext;
    charIdx: number;
}

enum ParticleGenType {
    Normal,
    Auxiliary
}

abstract class ParticleGenInfo {
    seconds: number;
    curTime: number = 0.0;
    active: boolean = false;
    finishTime: number = 0.0;
    grabInitialData: boolean = false;
    transform: mat4 = mat4.create();
    offset: vec3 = vec3.create();
    scale: vec3 = vec3.create();

    protected constructor(private particleId: string,
                          frameCount: number,
                          private boneName: string | number,
                          inScale: ReadonlyVec3,
                          private parentMode: ParentedMode,
                          private flags: number,
                          private type: ParticleGenType) {
        this.seconds = frameCount / 60.0;
        vec3.copy(this.scale, inScale);
    }

    public GetIsActive(): boolean {
        return this.active;
    }

    public SetIsActive(active: boolean) {
        this.active = active;
    }

    public GetIsGrabInitialData(): boolean {
        return this.grabInitialData;
    }

    public SetIsGrabInitialData(grabInitialData: boolean) {
        this.grabInitialData = grabInitialData;
    }

    public GetFlags(): number {
        return this.flags;
    }

    public SetFlags(flags: number) {
        this.flags = flags;
    }

    public GetType(): ParticleGenType {
        return this.type;
    }

    public GetBoneName(): string | number {
        return this.boneName;
    }

    public GetParentedMode(): ParentedMode {
        return this.parentMode;
    }

    public GetCurTransform(): ReadonlyMat4 {
        return this.transform;
    }

    public SetCurTransform(xf: ReadonlyMat4) {
        mat4.copy(this.transform, xf);
    }

    public GetCurOffset(): ReadonlyVec3 {
        return this.offset;
    }

    public SetCurOffset(offset: ReadonlyVec3) {
        vec3.copy(this.offset, offset);
    }

    public GetCurScale(): ReadonlyVec3 {
        return this.scale;
    }

    public SetCurScale(scale: ReadonlyVec3) {
        vec3.copy(this.scale, scale);
    }

    public GetCurrentTime(): number {
        return this.curTime;
    }

    public SetCurrentTime(time: number) {
        this.curTime = time;
    }

    public GetInactiveStartTime(): number {
        return this.seconds;
    }

    public MarkFinishTime() {
        this.finishTime = this.curTime;
    }

    public GetFinishTime(): number {
        return this.finishTime;
    }

    public OffsetTime(dt: number) {
        this.curTime += dt;
    }
}

class ParticleGenInfoGeneric extends ParticleGenInfo {
    constructor(particleId: string,
                private system: BaseGenerator,
                frameCount: number,
                boneName: string | number,
                scale: ReadonlyVec3,
                parentMode: ParentedMode,
                flags: number,
                type: ParticleGenType) {
        super(particleId, frameCount, boneName, scale, parentMode, flags, type);
    }

    public SetParticleEmission(active: boolean): void {
        this.system.SetParticleEmission(active);
    }

    public prepareToRender(renderer: RetroSceneRenderer, viewerInput: Viewer.ViewerRenderInput): void {
        this.system.prepareToRender(renderer, viewerInput);
    }

    public Update(device: GfxDevice, dt: number): void {
        this.system.Update(device, dt);
    }

    public SetOrientation(xf: ReadonlyMat4): void {
        this.system.SetOrientation(xf);
    }

    public SetGlobalOrientation(xf: ReadonlyMat4): void {
        this.system.SetGlobalOrientation(xf);
    }

    public SetTranslation(translation: ReadonlyVec3): void {
        this.system.SetTranslation(translation);
    }

    public SetGlobalTranslation(translation: ReadonlyVec3): void {
        this.system.SetGlobalTranslation(translation);
    }

    public SetGlobalScale(scale: ReadonlyVec3): void {
        this.system.SetGlobalScale(scale);
    }

    public IsSystemDeletable(): boolean {
        return this.system.IsSystemDeletable();
    }

    public HasActiveParticles(): boolean {
        return this.system.GetParticleCount() !== 0;
    }

    public DestroyParticles(): void {
        this.system.DestroyParticles();
    }

    public Destroy(device: GfxDevice): void {
        this.system.Destroy(device);
    }
}

class ParticleDatabase {
    // TODO: Support render ordering
    effectsLoop = new Map<string, ParticleGenInfoGeneric>();
    effects = new Map<string, ParticleGenInfoGeneric>();

    constructor(private renderer: RetroSceneRenderer) {
    }

    private UpdateParticleGenDB(dt: number, pose: PoseAsTransforms, cinf: CINF, xf: ReadonlyMat4, scale: ReadonlyVec3, particles: Map<string, ParticleGenInfoGeneric>, deleteIfDone: boolean) {
        for (const [name, info] of particles) {
            if (info.GetIsActive()) {
                if (info.GetType() === ParticleGenType.Normal) {
                    const boneId = this.renderer.game === ResourceGame.MP2 ? info.GetBoneName() as number : cinf.getBoneIdFromName(info.GetBoneName() as string);
                    if (!boneId)
                        continue;
                    if (!pose.containsDataFor(boneId))
                        continue;
                    pose.getOffset(scratchVec3, boneId);
                    switch (info.GetParentedMode()) {
                    case ParentedMode.Initial: {
                        if (info.GetIsGrabInitialData()) {
                            if (info.GetFlags() & 0x10)
                                mat4.identity(scratchMatrix);
                            else
                                pose.getRotation(scratchMatrix, boneId);
                            setMatrixTranslation(scratchMatrix, vec3.mul(scratchVec3, scratchVec3, scale));
                            mat4.mul(scratchMatrix, xf, scratchMatrix);
                            getMatrixTranslation(scratchVec3, scratchMatrix);
                            scratchMatrix[12] = 0;
                            scratchMatrix[13] = 0;
                            scratchMatrix[14] = 0;
                            info.SetCurTransform(scratchMatrix);
                            info.SetCurOffset(scratchVec3);
                            info.SetCurrentTime(0);
                            info.SetIsGrabInitialData(false);
                        }

                        info.SetOrientation(info.GetCurTransform());
                        info.SetTranslation(info.GetCurOffset());

                        if (info.GetFlags() & 0x2000)
                            info.SetGlobalScale(vec3.mul(scratchVec3, info.GetCurScale(), scale));
                        else
                            info.SetGlobalScale(info.GetCurScale());

                        break;
                    }
                    case ParentedMode.ContinuousEmitter:
                    case ParentedMode.ContinuousSystem: {
                        if (info.GetIsGrabInitialData()) {
                            info.SetCurrentTime(0);
                            info.SetIsGrabInitialData(false);
                        }

                        pose.getRotation(scratchMatrix, boneId);
                        setMatrixTranslation(scratchMatrix, vec3.mul(scratchVec3, scratchVec3, scale));
                        mat4.mul(scratchMatrix, xf, scratchMatrix);
                        getMatrixTranslation(scratchVec3, scratchMatrix);
                        if (info.GetFlags() & 0x10)
                            mat4.copy(scratchMatrix, xf);
                        scratchMatrix[12] = 0;
                        scratchMatrix[13] = 0;
                        scratchMatrix[14] = 0;

                        if (info.GetParentedMode() === ParentedMode.ContinuousEmitter) {
                            info.SetTranslation(scratchVec3);
                            info.SetOrientation(scratchMatrix);
                        } else {
                            info.SetGlobalTranslation(scratchVec3);
                            info.SetGlobalOrientation(scratchMatrix);
                        }

                        if (info.GetFlags() & 0x2000)
                            info.SetGlobalScale(vec3.mul(scratchVec3, info.GetCurScale(), scale));
                        else
                            info.SetGlobalScale(info.GetCurScale());

                        break;
                    }
                    default:
                        break;
                    }
                }

                if (false) { // Particles systems never stop in noclip
                    const sec = info.GetInactiveStartTime() === 0 ? 10000000.0 : info.GetInactiveStartTime();
                    if (info.GetCurrentTime() > sec) {
                        info.SetIsActive(false);
                        info.SetParticleEmission(false);
                        info.MarkFinishTime();
                        if (info.GetFlags() & 1)
                            info.DestroyParticles();
                    }
                }
            }

            const device = this.renderer.device;
            info.Update(device, dt);

            if (!info.GetIsActive()) {
                if (!info.HasActiveParticles() && info.GetCurrentTime() - info.GetFinishTime() > 5.0 && deleteIfDone) {
                    //info.DeleteLight();
                    info.Destroy(device);
                    particles.delete(name);
                    continue;
                }
            } else if (info.IsSystemDeletable()) {
                //info.DeleteLight();
                info.Destroy(device);
                particles.delete(name);
                continue;
            }

            info.OffsetTime(dt);
        }
    }

    public Update(dt: number, pose: PoseAsTransforms, cinf: CINF, xf: ReadonlyMat4, scale: ReadonlyVec3) {
        this.UpdateParticleGenDB(dt, pose, cinf, xf, scale, this.effectsLoop, true);
        this.UpdateParticleGenDB(dt, pose, cinf, xf, scale, this.effects, false);
    }

    public prepareToRender(renderer: RetroSceneRenderer, viewerInput: Viewer.ViewerRenderInput): void {
        for (const [name, info] of this.effects)
            info.prepareToRender(renderer, viewerInput);
        for (const [name, info] of this.effectsLoop)
            info.prepareToRender(renderer, viewerInput);
    }

    private GetParticleEffect(name: string): ParticleGenInfoGeneric | null {
        let existing = this.effectsLoop.get(name);
        if (existing)
            return existing;
        existing = this.effects.get(name);
        if (existing)
            return existing;
        return null;
    }

    public AddParticleEffect(name: string, flags: number, particleData: ParticleData, scale: ReadonlyVec3, oneshot: boolean) {
        const existing = this.GetParticleEffect(name);
        if (existing) {
            if (!existing.GetIsActive()) {
                existing.SetParticleEmission(true);
                existing.SetIsActive(true);
                existing.SetIsGrabInitialData(true);
                existing.SetFlags(flags);
            }
            return;
        }

        const scaleVec = vec3.create();
        const particleScale = particleData.GetScale();
        if (flags & 0x2)
            vec3.set(scaleVec, particleScale, particleScale, particleScale);
        else
            vec3.scale(scaleVec, scale, particleScale);

        let particleGenInfo: ParticleGenInfoGeneric | null = null;
        switch (particleData.GetParticleAssetFourCC()) {
        case 'PART': {
            const part = particleData.GetParticleDescription() as PART;
            if (part) {
                const generator = new ElementGenerator(part.description, ModelOrientationType.Normal, false, this.renderer);
                particleGenInfo = new ParticleGenInfoGeneric(particleData.GetParticleAssetId(), generator, particleData.GetDuration(), particleData.GetSegmentName(), scaleVec, particleData.GetParentedMode(), flags, ParticleGenType.Normal);
            }
            break;
        }
        case 'SWHC': {
            const swhc = particleData.GetParticleDescription() as SWHC;
            if (swhc) {
                const generator = new SwooshGenerator(swhc.description, 0);
                particleGenInfo = new ParticleGenInfoGeneric(particleData.GetParticleAssetId(), generator, particleData.GetDuration(), particleData.GetSegmentName(), scaleVec, particleData.GetParentedMode(), flags, ParticleGenType.Normal);
            }
            break;
        }
        case 'ELSC': {
            const elsc = particleData.GetParticleDescription() as ELSC;
            if (elsc) {
                const generator = new ElectricGenerator(elsc.description);
                particleGenInfo = new ParticleGenInfoGeneric(particleData.GetParticleAssetId(), generator, particleData.GetDuration(), particleData.GetSegmentName(), scaleVec, particleData.GetParentedMode(), flags, ParticleGenType.Normal);
            }
            break;
        }
        case 'SPSC': {
            break;
        }
        default:
            throw 'Unexpected particle asset type';
        }

        if (particleGenInfo) {
            particleGenInfo.SetIsActive(true);
            particleGenInfo.SetParticleEmission(true);
            particleGenInfo.SetIsGrabInitialData(true);
            this.InsertParticleGen(oneshot, flags, name, particleGenInfo);
        }
    }

    private InsertParticleGen(oneshot: boolean, flags: number, name: string, particleGenInfo: ParticleGenInfoGeneric) {
        // TODO: Support render ordering
        if (oneshot)
            this.effects.set(name, particleGenInfo);
        else
            this.effectsLoop.set(name, particleGenInfo);
    }

    public Destroy(device: GfxDevice) {
        for (const [name, info] of this.effects)
            info.Destroy(device);
        for (const [name, info] of this.effectsLoop)
            info.Destroy(device);
    }
}

// TODO(jstpierre): Dedupe.
export class CMDLRenderer {
    private materialGroupInstances: MaterialGroupInstance[] = [];
    private materialInstances: MaterialInstance[] = [];
    private surfaceInstances: SurfaceInstance[] = [];
    public visible: boolean = true;
    public isSkybox: boolean = false;
    public modelMatrix: mat4 = mat4.create();
    public modelMatrixNoScale: mat4 = mat4.create();
    public scale: vec3 = vec3.fromValues(1, 1, 1);
    private animTreeNode: AnimTreeNode|null = null;
    private passedParticleCount: number = 0;
    private particleDatabase: ParticleDatabase;
    private readonly poseBuilder: HierarchyPoseBuilder|null = null;
    private pose: PoseAsTransforms|null = null;
    private readonly envelopeMats: mat4[]|null = null;

    constructor(sceneRenderer: RetroSceneRenderer, public actorLights: ActorLights | null, public name: string, modelMatrix: ReadonlyMat4, modelMatrixNoScale: ReadonlyMat4, scale: ReadonlyVec3, public cmdlData: CMDLData, public animationData: AnimationData | null, public bbox: AABB = cmdlData.cmdl.bbox) {
        mat4.copy(this.modelMatrix, modelMatrix);
        mat4.copy(this.modelMatrixNoScale, modelMatrixNoScale);
        vec3.copy(this.scale, scale);

        if (animationData) {
            this.particleDatabase = new ParticleDatabase(sceneRenderer);
            assertExists(this.cmdlData.cmdl.cskr);
            this.poseBuilder = new HierarchyPoseBuilder(animationData.cinf);
            this.envelopeMats = nArray(animationData.cskr.skinRules.length, () => mat4.create());
            if (this.cmdlData.hasSkinIndexData)
                this.cmdlData = this.cmdlData.duplicate(sceneRenderer);
        }

        const materialSet = this.cmdlData.cmdl.materialSets[0];

        // First, create our group commands. These will store UBO buffer data which is shared between
        // all groups using that material.
        for (let i = 0; i < materialSet.materials.length; i++) {
            const material = materialSet.materials[i];
            if (this.materialGroupInstances[material.groupIndex] === undefined)
                this.materialGroupInstances[material.groupIndex] = new MaterialGroupInstance(sceneRenderer.renderCache, material);
        }

        // Now create the material commands.
        this.materialInstances = materialSet.materials.map((material) => {
            const materialGroupCommand = this.materialGroupInstances[material.groupIndex];
            return new MaterialInstance(materialGroupCommand, material, materialSet, sceneRenderer.textureHolder);
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
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public prepareToRender(renderer: RetroSceneRenderer, viewerInput: Viewer.ViewerRenderInput): boolean {
        if (!this.visible)
            return false;

        if (!this.isSkybox) {
            // Skip all update logic if not in frustum
            bboxScratch.transform(this.bbox, noclipSpaceFromPrimeSpace);
            if (!viewerInput.camera.frustum.contains(bboxScratch))
                return false;
        }

        if (this.animationData && this.poseBuilder && renderer.enableAnimations) {
            if (!this.animTreeNode) {
                this.animTreeNode = this.animationData.metaAnim.GetAnimationTree(this.animationData.animSysContext);
                this.pose = new PoseAsTransforms();

                if (this.animationData.mp2Evnt) {
                    // TODO: Decide if it's worth activating particles by start time as the first loop plays.
                    const particleNodes = this.animationData.mp2Evnt.GetParticlePOIStream();
                    for (let i = 0; i < particleNodes.length; ++i) {
                        const node = particleNodes[i];
                        if (node.GetCharacterIndex() === -1 || node.GetCharacterIndex() === this.animationData.charIdx) {
                            this.particleDatabase.AddParticleEffect(node.GetString(), node.GetFlags(), node.GetParticleData(), this.scale, false);
                        }
                    }
                }
            }

            const advanceTime = new CharAnimTime(viewerInput.deltaTime / 1000);

            const oldPassedParticleCount = this.passedParticleCount;
            this.passedParticleCount += this.animTreeNode.GetParticlePOIList(advanceTime, scratchParticleNodes, scratchParticleNodes.length, this.passedParticleCount);
            for (let i = oldPassedParticleCount; i < this.passedParticleCount; ++i) {
                const node = scratchParticleNodes[i];
                if (node.GetCharacterIndex() === -1 || node.GetCharacterIndex() === this.animationData.charIdx) {
                    this.particleDatabase.AddParticleEffect(node.GetString(), node.GetFlags(), node.GetParticleData(), this.scale, false);
                }
            }

            this.animTreeNode.AdvanceView(advanceTime);
            const simp = this.animTreeNode.Simplified();
            if (simp)
                this.animTreeNode = simp as AnimTreeNode;

            this.poseBuilder.BuildFromAnimRoot(this.animTreeNode, this.pose!);

            const skinRules = this.animationData.cskr.skinRules;
            for (let i = 0; i < skinRules.length; ++i) {
                const skinRule = skinRules[i];
                const envMat = this.envelopeMats![i];
                envMat.fill(0);
                for (let i = 0; i < skinRule.weights.length; ++i) {
                    const weight = skinRule.weights[i];
                    const mat = this.pose!.get(weight.boneId)!.restPoseToAccum;
                    mat4.multiplyScalarAndAdd(envMat, envMat, mat, weight.weight);
                }
            }

            if (this.cmdlData.hasSkinIndexData) {
                // If skin indices were extracted (skinned MP1 model) update
                // vertex buffer with transformed vertex positions and normals.
                this.cmdlData.cpuSkinVerts(renderer.device, this.envelopeMats!);
            }

            if (renderer.enableParticles) {
                this.particleDatabase.Update(advanceTime.time, this.pose!, this.animationData.cinf, this.modelMatrixNoScale, this.scale);
            }
        }

        const templateRenderInst = renderer.renderHelper.renderInstManager.pushTemplateRenderInst();
        templateRenderInst.filterKey = this.isSkybox ? RetroPass.SKYBOX : RetroPass.MAIN;

        for (let i = 0; i < this.materialGroupInstances.length; i++)
            if (this.materialGroupInstances[i] !== undefined)
                this.materialGroupInstances[i].prepareToRender(renderer, viewerInput, this.modelMatrix, this.isSkybox, this.actorLights, OpaqueBlack);
        for (let i = 0; i < this.surfaceInstances.length; i++)
            this.surfaceInstances[i].prepareToRender(renderer, viewerInput, this.isSkybox, this.cmdlData.hasSkinIndexData ? null : this.envelopeMats, this.bbox);

        renderer.renderHelper.renderInstManager.popTemplateRenderInst();

        if (this.particleDatabase && renderer.enableParticles) {
            this.particleDatabase.prepareToRender(renderer, viewerInput);
        }

        return true;
    }

    public getAttachmentTransform(xfOut: mat4, xfOutNoScale: mat4, boneName: string) {
        if (this.animationData && this.pose) {
            const boneId = this.animationData.cinf.getBoneIdFromName(boneName);
            if (boneId !== null && this.pose.containsDataFor(boneId)) {
                const poseTransform = this.pose.getOrCreateBoneXf(boneId);
                mat4.mul(xfOut, this.modelMatrix, poseTransform.originToAccum);
                mat4.mul(xfOutNoScale, this.modelMatrixNoScale, poseTransform.originToAccum);
                return;
            }
        }
        mat4.copy(xfOut, this.modelMatrix);
        mat4.copy(xfOutNoScale, this.modelMatrixNoScale);
    }

    public destroy(device: GfxDevice) {
        if (this.animationData && this.cmdlData.hasSkinIndexData) {
            // This instance is not part of the CMDL cache.
            this.cmdlData.destroy(device);
            this.particleDatabase.Destroy(device);
        }
    }
}

interface ActorAttachment {
    boneName: string;
    cmdlRenderer: CMDLRenderer;
}

class Actor {
    private visible = true;

    constructor(public entity: Entity, public cmdlRenderer: CMDLRenderer, public attachments: ActorAttachment[] = []) {
    }

    public prepareToRender(renderer: RetroSceneRenderer, viewerInput: Viewer.ViewerRenderInput): void {
        if (!renderer.showAllActors && !this.entity.active)
            return;

        if (!this.visible)
            return;

        if (this.entity.autoSpin) {
            const z = 8 * (viewerInput.time / 1000);
            mat4.rotateZ(this.cmdlRenderer.modelMatrix, this.entity.modelMatrix, z);
            mat4.rotateZ(this.cmdlRenderer.modelMatrixNoScale, this.entity.modelMatrixNoScale, z);
        }

        if (!this.cmdlRenderer.prepareToRender(renderer, viewerInput))
            return;

        for (let i = 0; i < this.attachments.length; ++i) {
            const attachment = this.attachments[i];
            this.cmdlRenderer.getAttachmentTransform(attachment.cmdlRenderer.modelMatrix, attachment.cmdlRenderer.modelMatrixNoScale, attachment.boneName);
            attachment.cmdlRenderer.prepareToRender(renderer, viewerInput);
        }
    }
}
