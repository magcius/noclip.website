import { mat4, vec3, vec4 } from 'gl-matrix';
import { computeModelMatrixSRT, MathConstants } from '../MathHelpers.js';
import { computeViewSpaceDepthFromWorldSpaceAABB } from '../Camera.js';
import { Curve, FMAT, FMAT_RenderInfo, FMAT_RenderInfoType, FSKL_Bone, parseFMAT_ShaderParam_Float, parseFMAT_ShaderParam_Texsrt } from '../fres_nx/bfres.js';
import { ChannelSource, CompareMode, FilterMode, TextureAddressMode } from '../fres_nx/nngfx_enum.js';
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2 } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxCompareMode, GfxCullMode, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxWrapMode } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRenderInst, GfxRenderInstManager, setSortKeyDepth, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderInstManager.js';
import { TextureMapping } from '../TextureHolder.js';
import { assert, nArray } from '../util.js';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { OrigamiModelData, OrigamiShapeData, OrigamiMeshData } from './render_data.js';
import { ViewerRenderInput } from "../viewer.js";
import { OrigamiTextureHolder } from './texture.js';
import { AABB } from '../Geometry.js';
import { getPointCubic } from '../Spline.js';
import { OrigamiProgram, OrigamiWaterProgram } from './shader.js';

// Adapated code from MK8D/Odyessy for lots of the rendering and NX translation, and TMSFE for some of the animations. Switch Toolbox was a big help too

function translateAddressMode(addrMode: TextureAddressMode): GfxWrapMode {
    switch (addrMode) {
        case TextureAddressMode.Repeat:
            return GfxWrapMode.Repeat;
        case TextureAddressMode.ClampToEdge:
        case TextureAddressMode.ClampToBorder:
            return GfxWrapMode.Clamp;
        case TextureAddressMode.Mirror:
            return GfxWrapMode.Mirror;
        case TextureAddressMode.MirrorClampToEdge:
            return GfxWrapMode.Mirror;
        default:
            throw `Unknown texture address mode ${addrMode}`;
    }
}

function translateMipFilterMode(filterMode: FilterMode): GfxMipFilterMode {
    switch (filterMode) {
        case FilterMode.Linear:
            return GfxMipFilterMode.Linear;
        case 0:
        case FilterMode.Point:
            return GfxMipFilterMode.Nearest;
        default:
            throw `Unknown mip filter mode ${filterMode}`;
    }
}

function translateTexFilterMode(filterMode: FilterMode): GfxTexFilterMode {
    switch (filterMode) {
        case FilterMode.Linear:
            return GfxTexFilterMode.Bilinear;
        case FilterMode.Point:
            return GfxTexFilterMode.Point;
        default:
            throw `Unknown tex filter mode ${filterMode}`;
    }
}

function translateRenderInfoSingleString(renderInfo: FMAT_RenderInfo): string {
    assert(renderInfo.type === FMAT_RenderInfoType.String);
    if (renderInfo.values.length === 0) {
        // sometimes blend can be empty???
        return "opaque";
    }
    return renderInfo.values[0] as string;
}

function translateCullMode(material: FMAT): GfxCullMode {
    const cullValue = material.renderInfo.get("culling");
    if (!cullValue) {
        return GfxCullMode.None;
    }
    const cullMode = translateRenderInfoSingleString(cullValue);
    switch (cullMode) {
        case "front":
            return GfxCullMode.Front;
        case "back":
            return GfxCullMode.Back;
        case "none":
            return GfxCullMode.None;
        default:
            throw `Unknown cull mode ${cullMode}`;
    }
}

function translateBlendMode(blendMode: string): GfxBlendMode {
    switch (blendMode) {
        case "blend":
        case "trans":
        case "transadd":
            return GfxBlendMode.Add;
        default:
            throw `Unknown blend mode ${blendMode}`;
    }
}

function translateCompareMode(compareMode: CompareMode): GfxCompareMode {
    switch (compareMode) {
        case CompareMode.Never:
            return GfxCompareMode.Never;
        case CompareMode.Less:
            return GfxCompareMode.Less;
        case CompareMode.Equal:
            return GfxCompareMode.Equal;
        case CompareMode.LessOrEqual:
            return GfxCompareMode.LessEqual;
        case CompareMode.Greater:
            return GfxCompareMode.Greater;
        case CompareMode.NotEqual:
            return GfxCompareMode.NotEqual;
        case CompareMode.GreaterOrEqual:
            return GfxCompareMode.GreaterEqual;
        case CompareMode.Always:
            return GfxCompareMode.Always;
        default:
            throw `Unknown compare mode ${compareMode}`;
    }
}

const FRAME_TIME = 0.03; // game only runs at 30 FPS... needs a S2E...

/**
 * Renderer for an FMDL for _Paper Mario: The Origami King_
 */
export class OrigamiModelRenderer {
    public name: string;
    public visible: boolean;
    public shapeRenderers: ShapeRenderer[] = [];
    private materialInstances: OrigamiMaterialInstance[] = [];
    private instanceMatrices: mat4[] = [];
    private instanceBBoxes: AABB[] = [];
    private isLevelModel: boolean = false;
    private scratchMat = mat4.create();
    private lastComputedSKAFrame: number = -1;
    private lastComputedBoneMatrices: mat4[][] = [];
    private sceneBindings: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 0 }];

    constructor(cache: GfxRenderCache, private textureHolder: OrigamiTextureHolder, private modelData: OrigamiModelData) {
        this.name = this.modelData.name;
        this.visible = true;
        this.isLevelModel = this.name.startsWith("Btl_") || (this.name.startsWith("W") && this.name.substring(4, 5) === "_");

        for (const shapeData of this.modelData.shapeData) {
            const material = this.modelData.materials[shapeData.shape.materialIndex];
            if (material) {
                let matInstance;
                const mi = this.materialInstances.find(mi => mi.fmat.name === material.name);
                // don't create duplicate material instances for shapes that share the same material
                if (mi) {
                    matInstance = mi;
                } else {
                    matInstance = new OrigamiMaterialInstance(cache, this.textureHolder, material);
                    this.materialInstances.push(matInstance);
                }
                const bone = this.modelData.bones[shapeData.shape.boneIndex];
                const boneMatrix = this.computeShiftMatrix(this.modelData.bones, shapeData.shape.boneIndex);
                this.shapeRenderers.push(new ShapeRenderer(cache, shapeData, matInstance, this.materialInstances.indexOf(matInstance), boneMatrix, bone, this.modelData.skeletonAnimation !== undefined));
            }
        }

        this.lastComputedBoneMatrices = Array(this.shapeRenderers.length).fill([]);
    }

    public setVisible(v: boolean): void {
        this.visible = v;
    }

    public addInstanceMatrix(matrix: mat4) {
        this.instanceMatrices.push(matrix);
        this.instanceBBoxes = Array(this.instanceMatrices.length).fill(undefined);
        for (let i = 0; i < this.instanceMatrices.length; i++) {
            this.instanceBBoxes[i] = this.modelData.bbox.clone();
            this.instanceBBoxes[i].transform(this.instanceBBoxes[i], this.instanceMatrices[i]);
        }
        if (this.isLevelModel) {
            for (const shapeRenderer of this.shapeRenderers) {
                shapeRenderer.instanceBBoxes = Array(this.instanceMatrices.length).fill(undefined);
            }
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        let ranAnimations = false;
        let filledTemplate = false;
        this.lastComputedBoneMatrices = this.lastComputedBoneMatrices.fill([]);

        for (let i = 0; i < this.instanceMatrices.length; i++) {
            if (!viewerInput.camera.frustum.contains(this.instanceBBoxes[i])) {
                continue;
            }

            // only fill template if at least one instance is visible
            if (!filledTemplate) {
                const template = renderInstManager.pushTemplate();
                template.setBindingLayouts(this.sceneBindings);
                let offs = template.allocateUniformBuffer(OrigamiProgram.ub_SceneParams, 28);
                const d = template.mapUniformBufferF32(OrigamiProgram.ub_SceneParams);
                offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);
                offs += fillMatrix4x3(d, offs, viewerInput.camera.viewMatrix);

                filledTemplate = true;
            }

            for (let si = 0; si < this.shapeRenderers.length; si++) {
                const shapeRenderer = this.shapeRenderers[si];
                if (!shapeRenderer.shapeData.visible) {
                    continue;
                }

                // only compute bone matrices for this shape once per frame
                if (this.lastComputedBoneMatrices[si].length === 0) {
                    let bm;
                    if (shapeRenderer.shapeData.vertexSkinWeightCount === 0) {
                        if (this.modelData.skeletonAnimation) {
                            bm = [this.computeShiftMatrix(this.modelData.bones, shapeRenderer.shapeData.shape.boneIndex)];
                        } else {
                            bm = [shapeRenderer.staticBoneMatrix];
                        }
                    } else {
                        bm = this.modelData.smoothRigidMatrices;
                    }
                    this.lastComputedBoneMatrices[si] = bm;
                }

                // for now, only levels' base models are given per-shape culling. It's too costly to do with mobj/sobjs/npcs etc
                let shapeBBox: AABB | undefined;
                if (this.isLevelModel) {
                    shapeBBox = this.getShapeBoundingBox(i, shapeRenderer.staticBoneMatrix, this.instanceMatrices[i], shapeRenderer);
                }

                if (!this.isLevelModel || (this.isLevelModel && shapeBBox && viewerInput.camera.frustum.contains(shapeBBox))) {
                    shapeRenderer.fillTemplate(renderInstManager.pushTemplate(), this.materialInstances[shapeRenderer.materialInstanceIndex]);

                    // only run animations once per frame
                    if (!ranAnimations) {
                        if (this.modelData.skeletonAnimation) {
                            this.runSKA(viewerInput);
                        }
                        if (this.modelData.boneVisibilityAnimation) {
                            this.runBVS(viewerInput);
                        }
                        if (this.modelData.texturePatternAnimation) {
                            this.runTPA(viewerInput);
                        }
                        if (this.modelData.shaderParamAnimation) {
                            this.runSPA(viewerInput);
                        }
                        ranAnimations = true;
                    }

                    shapeRenderer.prepareToRender(renderInstManager, this.instanceMatrices[i], this.lastComputedBoneMatrices[si], this.instanceBBoxes[i], viewerInput);

                    renderInstManager.popTemplate();
                }
            }
        }

        if (filledTemplate) {
            renderInstManager.popTemplate();
        }
    }

    private getShapeBoundingBox(instanceIndex: number, boneMatrix: mat4, instanceMatrix: mat4, shapeRenderer: ShapeRenderer): AABB {
        if (shapeRenderer.instanceBBoxes[instanceIndex]) {
            return shapeRenderer.instanceBBoxes[instanceIndex];
        } else {
            const mat = this.scratchMat;
            mat4.multiply(mat, instanceMatrix, boneMatrix);
            shapeRenderer.instanceBBoxes[instanceIndex] = new AABB();
            shapeRenderer.instanceBBoxes[instanceIndex].transform(shapeRenderer.shapeData.meshData.mesh.bbox, mat);
            return shapeRenderer.instanceBBoxes[instanceIndex];
        }
    }

    private computeShiftMatrix(bones: FSKL_Bone[], boneIndex: number): mat4 {
        // need to eventually refactor so that common calculations aren't done each frame...
        const bone = bones[boneIndex];
        const srt = mat4.create();
        computeModelMatrixSRT(srt,
            bone.scale[0], bone.scale[1], bone.scale[2],
            bone.rotation[0], bone.rotation[1], bone.rotation[2],
            bone.translation[0], bone.translation[1], bone.translation[2],
        );
        if (bone.parentIndex === -1) {
            return srt;
        } else {
            const shift = mat4.create();
            mat4.multiply(shift, this.computeShiftMatrix(bones, bone.parentIndex), srt);
            return shift;
        }
    }

    private runSKA(viewerInput: ViewerRenderInput) {
        this.modelData.currentSKAFrame += viewerInput.deltaTime * FRAME_TIME;
        this.modelData.currentSKAFrame %= this.modelData.skeletonAnimation!.frameCount;
        // only compute bones and matrices when the frame actually changes (which is less often than render framerate)
        if (this.lastComputedSKAFrame !== Math.trunc(this.modelData.currentSKAFrame)) {
            this.modelData.bones = this.getBonesAt(this.modelData.currentSKAFrame);
            this.modelData.computeSmoothRigidMatrices();
            this.lastComputedSKAFrame = Math.trunc(this.modelData.currentSKAFrame);
        }
    }

    private runBVS(viewerInput: ViewerRenderInput) {
        this.modelData.currentBVSFrame += viewerInput.deltaTime * FRAME_TIME;
        this.modelData.currentBVSFrame %= this.modelData.boneVisibilityAnimation!.frameCount;
        const frameVisibility = this.modelData.boneVisibilityFrames.get(Math.trunc(this.modelData.currentBVSFrame));
        // only update visibilities when the current frame has values
        if (frameVisibility) {
            for (const shapeRenderer of this.shapeRenderers) {
                const sd = shapeRenderer.shapeData;
                const visibility = frameVisibility.get(sd.shape.boneIndex);
                if (visibility !== undefined) {
                    sd.visible = visibility;
                }
            }
        }
    }

    private runTPA(viewerInput: ViewerRenderInput) {
        this.modelData.currentTPAFrame += viewerInput.deltaTime * FRAME_TIME;
        this.modelData.currentTPAFrame %= this.modelData.texturePatternAnimation!.frameCount;
        const textureName = this.modelData.texturePatternSetFirstFrame ? this.modelData.texturePatternFrames.get(Math.trunc(this.modelData.currentTPAFrame)) : this.modelData.texturePatternFrames.get(0);
        // only update when the current frame has values
        if (textureName) {
            this.modelData.texturePatternSetFirstFrame = true;
            const ta = this.modelData.texturePatternAnimation!;
            const material = this.modelData.materials.find(m => m?.name === ta.materialAnimations[0].name);
            if (material) {
                const mi = this.materialInstances.find(mi => mi.fmat.name === ta.materialAnimations[0].name);
                if (mi) {
                    let textureMappingIndex = -1;
                    let i = 0;
                    for (const samplerName of material.shaderAssign.samplerAssign.values()) {
                        if (samplerName === this.modelData.texturePatternSampler) {
                            textureMappingIndex = i;
                            break;
                        }
                        i++;
                    }
                    const samplerMapping = mi.textureMapping[textureMappingIndex];
                    this.textureHolder.fillTextureMapping(samplerMapping, textureName);
                } else {
                    console.warn("Could not find material", ta.materialAnimations[0].name, "for", this.name);
                }
            } else {
                console.warn("Target material for texture pattern animation", ta.name, "in", this.name, "has invalid index or null material at index");
            }
        }
    }

    // crude implementation of shadar param animations for now, only supports a single texsrt value
    private runSPA(viewerInput: ViewerRenderInput) {
        this.modelData.currentSPAFrame += viewerInput.deltaTime * FRAME_TIME;
        this.modelData.currentSPAFrame %= this.modelData.shaderParamAnimation!.frameCount;
        const currentFrameInt = Math.trunc(this.modelData.currentSPAFrame);
        // only check frames on integer increases instead of every draw frame (might be a better way to check instead of epsilon)
        if (Math.abs(currentFrameInt - this.modelData.currentSPAFrame) < 0.1) {
            const ma = this.modelData.shaderParamAnimation!.materialAnimations[0];
            let frameValues = this.modelData.shaderParamFrames.get(currentFrameInt);
            if (!frameValues) {
                // interpolate
                const fci = ma.shaderParamAnimations[0].firstCurveIndex;
                const frames = ma.curves[fci].frames;
                const prevFrameIndex = frames.findIndex(f => f < currentFrameInt);
                const nextFrameIndex = prevFrameIndex === frames.length ? 0 : prevFrameIndex + 1;
                const interPerc = (currentFrameInt - frames[prevFrameIndex]) / Math.abs(frames[nextFrameIndex] - frames[prevFrameIndex]);
                frameValues = [0, 0, 0, 0, 0];
                for (let i = 0; i < frameValues.length; i++) {
                    const prevValue = ma.curves[fci].keys[prevFrameIndex][i];
                    const nextValue = ma.curves[fci].keys[nextFrameIndex][i];
                    frameValues[i] = prevValue + (interPerc * Math.abs(nextValue - prevValue));
                }
            }
            const materialInstance = this.materialInstances.find(mi => mi.fmat.name === ma.name)!;
            switch (this.modelData.shaderParamName) {
                case "texsrt0":
                    materialInstance.texCoordSRT0.translationT = -frameValues[1];
                    materialInstance.texCoordSRT0.compute();
                    break;
                default:
                    console.warn("Unimplemented shader param name", this.modelData.shaderParamName, "for", this.name);
                    break;
            }
        }
    }

    private getBonesAt(frame: number): FSKL_Bone[] {
        const bones: FSKL_Bone[] = Array(this.modelData.skeleton.bones.length);
        for (let boneIndex = 0; boneIndex < this.modelData.skeleton.bones.length; boneIndex++) {
            const bone = this.modelData.skeleton.bones[boneIndex];
            const animationIndex = this.modelData.skeletonAnimationBoneIndices[boneIndex];
            if (animationIndex === -1) {
                bones[boneIndex] = bone;
                continue;
            }
            const srt: number[] = [];
            const animation = this.modelData.skeletonAnimation!.boneAnimations[animationIndex];
            let curveIndex = 0;
            let flags = animation.flags >> 6;
            for (let i = 0; i < 10; i++) {
                if (flags & 1) {
                    srt.push(this.getKeyframe(animation.curves[curveIndex++], frame));
                } else {
                    srt.push(animation.initialValues[i]);
                }
                flags >>= 1;
            }
            bone.scale = vec3.fromValues(srt[0], srt[1], srt[2]);
            bone.rotation = vec4.fromValues(srt[3], srt[4], srt[5], 1.0);
            bone.translation = vec3.fromValues(srt[7], srt[8], srt[9]);
            bones[boneIndex] = bone;
        }
        return bones;
    }

    private getKeyframe(curve: Curve, currentFrame: number): number {
        for (let i = 0; i < curve.frames.length; i++) {
            if (currentFrame === curve.frames[i]) {
                return curve.keys[i][0];
            } else if (currentFrame < curve.frames[i]) {
                const previousFrame = curve.frames[i - 1];
                const keys = curve.keys[i - 1];
                if (keys) {
                    return getPointCubic(vec4.fromValues(keys[3], keys[2], keys[1], keys[0]), (currentFrame - previousFrame) / (curve.frames[i] - previousFrame));
                } else {
                    // some animations can have undefined keys at the end for whatever reason, but it's rare
                    return 0;
                }
            }
        }
        return 0;
    }
}

class TexSRT {
    public mode = 1;
    public scaleS = 1.0;
    public scaleT = 1.0;
    public rotation = 0.0;
    public translationS = 0.0;
    public translationT = 0.0;
    private matrix: mat4 = mat4.create();

    /**
     * Call this *once* to pre-compute the matrix (rather than calculating the same one each frame)
     */
    public compute(): void {
        const theta = this.rotation * MathConstants.DEG_TO_RAD;
        const sinR = Math.sin(theta);
        const cosR = Math.cos(theta);
        // hardcoded to Maya calcs for now, can't find any other SRT modes in the files
        this.matrix[0] = this.scaleS * cosR;
        this.matrix[4] = this.scaleS * sinR;
        this.matrix[12] = this.scaleS * ((-0.5 * cosR) - (0.5 * sinR - 0.5) - this.translationS);
        this.matrix[1] = this.scaleT * -sinR;
        this.matrix[5] = this.scaleT * cosR;
        this.matrix[13] = this.scaleT * ((-0.5 * cosR) + (0.5 * sinR - 0.5) + this.translationT) + 1.0;
    }

    public fillMatrix(d: Float32Array, offs: number): number {
        return fillMatrix4x2(d, offs, this.matrix);
    }
}

/**
 * Render-ready instance of an FMAT for _Paper Mario: The Origami King_
 */
export class OrigamiMaterialInstance {
    public gfxSamplers: GfxSampler[] = [];
    public textureMapping: TextureMapping[] = [];
    public samplerChannels: Map<string, ChannelSource[]> = new Map();
    public isTranslucent: boolean;
    public sortKey: number;
    public megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public texCoordSRT0 = new TexSRT();
    public texCoordSRT1 = new TexSRT();
    // private texCoordSRT2 = new TexSRT();
    private alphaRef = 1.0;

    constructor(cache: GfxRenderCache, textureHolder: OrigamiTextureHolder, public fmat: FMAT) {
        for (let i = 0; i < fmat.samplerInfo.length; i++) {
            const samplerInfo = fmat.samplerInfo[i];
            const gfxSampler = cache.createSampler({
                wrapS: translateAddressMode(samplerInfo.addrModeU),
                wrapT: translateAddressMode(samplerInfo.addrModeV),
                mipFilter: translateMipFilterMode((samplerInfo.filterMode >>> FilterMode.MipShift) & 3),
                minFilter: translateTexFilterMode((samplerInfo.filterMode >>> FilterMode.MinShift) & 3),
                magFilter: translateTexFilterMode((samplerInfo.filterMode >>> FilterMode.MagShift) & 3),
                maxLOD: samplerInfo.maxLOD,
                minLOD: samplerInfo.minLOD,
                compareMode: translateCompareMode(samplerInfo.compareMode),
                maxAnisotropy: samplerInfo.maxAnisotropy
            });
            this.gfxSamplers.push(gfxSampler);
        }

        assert(fmat.samplerInfo.length === fmat.textureName.length);
        this.textureMapping = nArray(fmat.shaderAssign.samplerAssign.size, () => new TextureMapping());
        let i = 0;
        for (const samplerName of fmat.shaderAssign.samplerAssign.values()) {
            const samplerIndex = fmat.samplerInfo.findIndex((samplerInfo) => samplerInfo.name === samplerName);
            if (samplerIndex < 0) {
                assert(false);
            }
            const shaderMapping = this.textureMapping[i++];
            textureHolder.fillTextureMapping(shaderMapping, fmat.textureName[samplerIndex]);
            shaderMapping.gfxSampler = this.gfxSamplers[samplerIndex];

            const cs = textureHolder.channelSources.get(fmat.textureName[samplerIndex])!;
            this.samplerChannels.set(samplerName, cs);
        }

        const blend = fmat.renderInfo.get("blend");
        const blendString = blend ? translateRenderInfoSingleString(blend) : "opaque";
        const blendMode = blendString !== "opaque" ? translateBlendMode(blendString) : null;
        const additiveBlend = blendString === "transadd";
        this.isTranslucent =
            fmat.name.toLowerCase() === "mt_pera" ||
            fmat.name.toLowerCase() === "mt_mask" ||
            blendMode !== null ||
            fmat.shaderAssign.shaderOption.get("paste_type") === "0";
        this.sortKey = makeSortKey(this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE, 0);

        this.megaStateFlags = {
            cullMode: translateCullMode(fmat),
            depthWrite: !this.isTranslucent,
        };
        if (this.isTranslucent) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: additiveBlend ? GfxBlendFactor.One : GfxBlendFactor.OneMinusSrcAlpha,
            });
        }

        const srt0 = fmat.shaderParam.find((p) => p.name === "texsrt0");
        const srt1 = fmat.shaderParam.find((p) => p.name === "texsrt1");
        // const srt2 = material.shaderParam.find((p) => p.name === "texsrt2");
        const alphaRef = fmat.shaderParam.find((p) => p.name === "alpha_ref");

        if (srt0) {
            parseFMAT_ShaderParam_Texsrt(this.texCoordSRT0, srt0);
            this.texCoordSRT0.compute();
        }
        if (srt1) {
            parseFMAT_ShaderParam_Texsrt(this.texCoordSRT1, srt1);
            this.texCoordSRT1.compute();
        }
        // if (srt2) {
        //     parseFMAT_ShaderParam_Texsrt(this.texCoordSRT2, srt2);
        //     this.texCoordSRT2.compute();
        // }
        if (alphaRef) this.alphaRef = parseFMAT_ShaderParam_Float(alphaRef);
    }

    public fillTemplate(template: GfxRenderInst): void {
        template.setBindingLayouts([{ numUniformBuffers: 3, numSamplers: this.gfxSamplers.length }]);
        template.sortKey = this.sortKey;
        template.setSamplerBindingsFromTextureMappings(this.textureMapping);
        template.setMegaStateFlags(this.megaStateFlags);

        let offs = template.allocateUniformBuffer(OrigamiProgram.ub_MaterialParams, 17);
        const d = template.mapUniformBufferF32(OrigamiProgram.ub_MaterialParams);
        offs += this.texCoordSRT0.fillMatrix(d, offs);
        offs += this.texCoordSRT1.fillMatrix(d, offs);
        // offs += this.texCoordSRT2.fillMatrix(d, offs);
        d[offs++] = this.alphaRef;
    }
}

class ShapeRenderer {
    public instanceBBoxes: (AABB | undefined)[] = [];
    private gfxProgram: GfxProgram;

    constructor(cache: GfxRenderCache, public shapeData: OrigamiShapeData, material: OrigamiMaterialInstance, public materialInstanceIndex: number, public staticBoneMatrix: mat4, bone: FSKL_Bone, isAnimated: boolean = false) {
        let program;
        if (bone.userData.has("SpecialMask") && bone.userData.get("SpecialMask")![0] === "PaperWaterSurface") {
            program = new OrigamiWaterProgram(material.fmat.name, isAnimated ? shapeData.vertexSkinWeightCount : -1, shapeData.vertexData.rawAttributes);
        } else {
            program = new OrigamiProgram(
                material, shapeData.boneMatrixLength,
                isAnimated ? shapeData.vertexSkinWeightCount : -1,
                shapeData.vertexData.rawAttributes
            );
        }
        this.gfxProgram = cache.createProgram(program);
    }

    public fillTemplate(template: GfxRenderInst, material: OrigamiMaterialInstance) {
        template.setGfxProgram(this.gfxProgram);
        material.fillTemplate(template);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, instanceMatrix: mat4, boneMatrices: mat4[], bbox: AABB, viewerInput: ViewerRenderInput) {
        const renderInst = renderInstManager.newRenderInst();

        let offs = renderInst.allocateUniformBuffer(OrigamiProgram.ub_ShapeParams, 12 + (12 * boneMatrices.length));
        const d = renderInst.mapUniformBufferF32(OrigamiProgram.ub_ShapeParams);
        offs += fillMatrix4x3(d, offs, instanceMatrix);
        for (const bm of boneMatrices) {
            offs += fillMatrix4x3(d, offs, bm);
        }

        renderInst.setDrawCount(this.shapeData.meshData.mesh.count);
        renderInst.setVertexInput(this.shapeData.meshData.inputLayout, this.shapeData.meshData.vertexBufferDescriptors, this.shapeData.meshData.indexBufferDescriptor);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera.viewMatrix, bbox));
        renderInstManager.submitRenderInst(renderInst);
    }
}
