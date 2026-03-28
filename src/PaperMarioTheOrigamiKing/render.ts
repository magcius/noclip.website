import { mat4, vec3, vec4 } from 'gl-matrix';
import { computeModelMatrixSRT, MathConstants } from '../MathHelpers.js';
import { computeViewSpaceDepthFromWorldSpaceAABB } from '../Camera.js';
import { Curve, FMAT, FMAT_RenderInfo, FMAT_RenderInfoType, FSKL_Bone, parseFMAT_ShaderParam_Float, parseFMAT_ShaderParam_Texsrt } from '../fres_nx/bfres.js';
import { ChannelSource, FilterMode, TextureAddressMode } from '../fres_nx/nngfx_enum.js';
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2, fillVec4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxCullMode, GfxDevice, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxWrapMode } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRenderInst, GfxRenderInstManager, setSortKeyDepth, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderInstManager.js';
import { TextureMapping } from '../TextureHolder.js';
import { assert, nArray } from '../util.js';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { ModelData, ShapeData, MeshData } from './render_data.js';
import { ViewerRenderInput } from "../viewer.js";
import { OrigamiTextureHolder } from './texture.js';
import { AABB } from '../Geometry.js';
import { getPointCubic } from '../Spline.js';
import { OrigamiProgram } from './shader.js';

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

export class OrigamiModelRenderer {
    public name: string;
    public visible: boolean;
    public shapeRenderers: ShapeRenderer[] = [];
    public instanceMatrices: mat4[] = [];
    private scratchMat = mat4.create();
    private sceneBindings: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 0 }];

    constructor(cache: GfxRenderCache, textureHolder: OrigamiTextureHolder, private modelData: ModelData) {
        this.name = this.modelData.model.name;
        this.visible = true;

        // build materials, filter by config and name (mainly shadows/lighting are ignored)
        const materials: (MaterialInstance | null)[] = [];
        for (let matIndex = 0; matIndex < this.modelData.model.fmat.length; matIndex++) {
            const material = this.modelData.model.fmat[matIndex];
            const shaderAssignExec = material.userData.get("__ShaderAssignExec");
            let visible = true;
            if (shaderAssignExec) {
                for (const s of shaderAssignExec as string[]) {
                    if (s.includes("SetAttribute('visibility', 'false')")) {
                        visible = false;
                        break;
                    }
                }
            } else if (material.name.toLowerCase().includes("mt_shadow") || material.name.toLowerCase().endsWith("_sm") || material.samplerInfo.length < 1) {
                // sometimes the casing is inconsistent for materials (whoops!)
                visible = false;
            }
            if (visible && this.modelData.config) {
                if (this.modelData.config.materialWhitelist && !this.modelData.config.materialWhitelist.includes(material.name)) {
                    visible = false;
                }
                if (this.modelData.config.materialBlacklist && this.modelData.config.materialBlacklist.includes(material.name)) {
                    visible = false;
                }
            }
            if (visible) {
                // patch texture names with model name (since some models have different textures under the same internal name)
                for (let i = 0; i < material.textureName.length; i++) {
                    if (!material.textureName[i].startsWith("Cmn_")) {
                        material.textureName[i] = `${this.name}_${material.textureName[i]}`;
                    }
                }
                materials.push(new MaterialInstance(cache, textureHolder, material));
            } else {
                // append null for consistent indices
                materials.push(null);
            }
        }

        // build shape renderers and pre-compute their static SRT
        for (const shapeData of this.modelData.shapeData) {
            const material = materials[shapeData.shape.materialIndex];
            const boneName = this.modelData.bones[shapeData.shape.boneIndex].name;
            if (material && !this.modelData.hiddenBoneList.includes(boneName)) {
                const sr = new ShapeRenderer(cache, shapeData, material, this.modelData.skeletonAnimation !== undefined);
                sr.staticBoneMatrix = this.computeShiftMatrix(this.modelData.bones, shapeData.shape.boneIndex);
                this.shapeRenderers.push(sr);
            }
        }
    }

    public setVisible(v: boolean): void {
        this.visible = v;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const template = renderInstManager.pushTemplate();
        template.setBindingLayouts(this.sceneBindings);
        let offs = template.allocateUniformBuffer(OrigamiProgram.ub_SceneParams, 28);
        const d = template.mapUniformBufferF32(OrigamiProgram.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(d, offs, viewerInput.camera.viewMatrix);

        let ranAnimations = false;
        for (const shapeRenderer of this.shapeRenderers) {
            // patch bboxes on first frame since shift matrix count is unknown in the constructor
            if (shapeRenderer.bboxes.length !== this.instanceMatrices.length) {
                shapeRenderer.bboxes = Array(this.instanceMatrices.length).fill(undefined);
            }

            // compute bone matrices based on skin weight count, helps a lot with many instances
            let rootSkinBoneMatrix: mat4 | undefined;
            let boneMatrices = this.modelData.smoothRigidMatrices;
            if (shapeRenderer.shapeData.vertexSkinWeightCount === 0) {
                if (this.modelData.skeletonAnimation) {
                    boneMatrices = [this.computeShiftMatrix(this.modelData.bones, shapeRenderer.shapeData.shape.boneIndex)];
                } else {
                    boneMatrices = [shapeRenderer.staticBoneMatrix];
                }
            } else {
                rootSkinBoneMatrix = this.computeShiftMatrix(this.modelData.bones, shapeRenderer.shapeData.shape.skinBoneIndices[0]);
            }

            const template = renderInstManager.pushTemplate();
            shapeRenderer.fillTemplate(template);

            for (let i = 0; i < this.instanceMatrices.length; i++) {
                const bbox = this.getBoundingBox(i, boneMatrices, rootSkinBoneMatrix, this.instanceMatrices[i], shapeRenderer);
                if (viewerInput.camera.frustum.contains(bbox)) {
                    if (!ranAnimations && this.modelData.skeletonAnimation) {
                        this.runAnimations(viewerInput);
                        ranAnimations = true;
                    }
                    shapeRenderer.prepareToRender(renderInstManager, this.instanceMatrices[i], boneMatrices, bbox, viewerInput);
                }
            }

            renderInstManager.popTemplate();
        }

        renderInstManager.popTemplate();
    }

    private getBoundingBox(i: number, boneMatrices: mat4[], rootSkinBoneMatrix: mat4 | undefined, instanceMatrix: mat4, shapeRenderer: ShapeRenderer): AABB {
        if (shapeRenderer.bboxes[i] && !this.modelData.skeletonAnimation) {
            return shapeRenderer.bboxes[i]!;
        }

        if (!shapeRenderer.bboxes[i]) {
            shapeRenderer.bboxes[i] = new AABB();
        }
        const mat = this.scratchMat;
        const bbox = shapeRenderer.bboxes[i];
        const base = shapeRenderer.shapeData.meshData[0].mesh.bbox;

        if (shapeRenderer.shapeData.vertexSkinWeightCount === 0) {
            mat4.multiply(mat, instanceMatrix, boneMatrices[0]);
            bbox.transform(base, mat);
            shapeRenderer.bboxes[i] = bbox;
            return shapeRenderer.bboxes[i];
        } else {
            // fast-ish approximate compute
            mat4.multiply(mat, instanceMatrix, rootSkinBoneMatrix!);
            bbox.transform(base, mat);
            return bbox;
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

    private runAnimations(viewerInput: ViewerRenderInput) {
        this.modelData.currentSkeletonAnimationFrame += viewerInput.deltaTime * 0.03; // game only runs at 30 FPS... needs a S2E...
        this.modelData.currentSkeletonAnimationFrame = this.modelData.currentSkeletonAnimationFrame % this.modelData.skeletonAnimation!.frameCount;
        this.modelData.bones = this.getBones(this.modelData.currentSkeletonAnimationFrame);
        this.modelData.computeSmoothRigidMatrices();
    }

    private getBones(frame: number): FSKL_Bone[] {
        const bones: FSKL_Bone[] = Array(this.modelData.model.fskl.bones.length);
        for (let boneIndex = 0; boneIndex < this.modelData.model.fskl.bones.length; boneIndex++) {
            const bone = this.modelData.model.fskl.bones[boneIndex];
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
        console.warn("Could not find keyframe value for", this.name);
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

class MaterialInstance {
    public gfxSamplers: GfxSampler[] = [];
    public textureMapping: TextureMapping[] = [];
    public samplerChannels: Map<string, ChannelSource[]> = new Map();
    public isTranslucent: boolean;
    public sortKey: number;
    public megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private texCoordSRT0 = new TexSRT();
    private texCoordSRT1 = new TexSRT();
    // private texCoordSRT2 = new TexSRT();
    private glossiness = 0.0;
    private alphaRef = 1.0;
    private yFlip = 0.0;
    private whiteBack = 0.0;

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
        this.isTranslucent = blendMode !== null || (fmat.shaderAssign.shaderOption.has("paste_type") && fmat.shaderAssign.shaderOption.get("paste_type") === "0");
        this.sortKey = makeSortKey(this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE, 0);

        this.megaStateFlags = {
            cullMode: translateCullMode(fmat),
            depthWrite: !this.isTranslucent,
        };
        if (this.isTranslucent) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: additiveBlend ? GfxBlendFactor.One : GfxBlendFactor.OneMinusSrcAlpha
            });
        }

        const srt0 = fmat.shaderParam.find((p) => p.name === "texsrt0");
        const srt1 = fmat.shaderParam.find((p) => p.name === "texsrt1");
        // const srt2 = material.shaderParam.find((p) => p.name === "texsrt2");
        const glossiness = fmat.shaderParam.find((p) => p.name === "glossiness");
        const alphaRef = fmat.shaderParam.find((p) => p.name === "alpha_ref");
        const yFlip = fmat.shaderParam.find((p) => p.name === "yflip");
        const whiteBack = fmat.shaderParam.find((p) => p.name === "white_back");

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
        if (glossiness) this.glossiness = parseFMAT_ShaderParam_Float(glossiness);
        if (alphaRef) this.alphaRef = parseFMAT_ShaderParam_Float(alphaRef);
        if (yFlip) this.yFlip = parseFMAT_ShaderParam_Float(yFlip);
        if (whiteBack) this.whiteBack = parseFMAT_ShaderParam_Float(whiteBack);
    }

    public fillTemplate(template: GfxRenderInst): void {
        template.setBindingLayouts([{ numUniformBuffers: 3, numSamplers: this.gfxSamplers.length }]);
        template.sortKey = this.sortKey;
        template.setSamplerBindingsFromTextureMappings(this.textureMapping);
        template.setMegaStateFlags(this.megaStateFlags);

        let offs = template.allocateUniformBuffer(OrigamiProgram.ub_MaterialParams, 20);
        const d = template.mapUniformBufferF32(OrigamiProgram.ub_MaterialParams);
        offs += this.texCoordSRT0.fillMatrix(d, offs);
        offs += this.texCoordSRT1.fillMatrix(d, offs);
        // offs += this.texCoordSRT2.fillMatrix(d, offs);
        offs += fillVec4(d, offs, this.glossiness, this.alphaRef, this.yFlip, this.whiteBack);
    }
}

class ShapeRenderer {
    public bboxes: (AABB | undefined)[] = [];
    public staticBoneMatrix: mat4;
    private gfxProgram: GfxProgram;
    private meshData: MeshData;

    constructor(cache: GfxRenderCache, public shapeData: ShapeData, private material: MaterialInstance, isSkeletonAnimated: boolean = false) {
        this.meshData = shapeData.meshData[0];
        const program = new OrigamiProgram(
            this.material.fmat.name, this.material.fmat.shaderAssign,
            material.samplerChannels, shapeData.boneMatrixLength,
            isSkeletonAnimated ? shapeData.vertexSkinWeightCount : -1,
            shapeData.vertexData.rawAttributes
        );
        this.gfxProgram = cache.createProgram(program);
    }

    public fillTemplate(template: GfxRenderInst) {
        template.setGfxProgram(this.gfxProgram);
        this.material.fillTemplate(template);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, shiftMatrix: mat4, boneMatrices: mat4[], bbox: AABB, viewerInput: ViewerRenderInput) {
        const renderInst = renderInstManager.newRenderInst();

        let offs = renderInst.allocateUniformBuffer(OrigamiProgram.ub_ShapeParams, 12 + (12 * boneMatrices.length));
        const d = renderInst.mapUniformBufferF32(OrigamiProgram.ub_ShapeParams);
        offs += fillMatrix4x3(d, offs, shiftMatrix);
        for (const bm of boneMatrices) {
            offs += fillMatrix4x3(d, offs, bm);
        }

        renderInst.setDrawCount(this.meshData.mesh.count);
        renderInst.setVertexInput(this.meshData.inputLayout, this.meshData.vertexBufferDescriptors, this.meshData.indexBufferDescriptor);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera.viewMatrix, bbox));
        renderInstManager.submitRenderInst(renderInst);
    }
}
