import { mat4, quat, vec3 } from 'gl-matrix';
import AnimationController from '../AnimationController.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { Camera, computeViewMatrix, computeViewSpaceDepthFromWorldSpacePoint } from '../Camera.js';
import { colorNewFromRGBA } from '../Color.js';
import { drawWorldSpaceLine, getDebugOverlayCanvas2D } from '../DebugJunk.js';
import { CalcBillboardFlags, calcBillboardMatrix } from '../MathHelpers.js';
import { DeviceProgram } from '../Program.js';
import { TextureMapping } from '../TextureHolder.js';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { convertToCanvas } from '../gfx/helpers/TextureConversionHelpers.js';
import { fillColor, fillMatrix4x3, fillMatrix4x4, fillVec4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxProgram, GfxSampler, GfxTexture, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency } from '../gfx/platform/GfxPlatform.js';
import { FormatCompFlags, FormatFlags, FormatTypeFlags, makeFormat } from '../gfx/platform/GfxPlatformFormat.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRenderInst, GfxRenderInstManager, GfxRendererLayer, makeSortKey, setSortKeyDepth, setSortKeyLayer } from '../gfx/render/GfxRenderInstManager.js';
import { assert, assertExists, fallbackUndefined, nArray } from '../util.js';
import * as Viewer from '../viewer.js';
import * as CHR from './chr.js';
import * as IMG from './img.js';
import * as MAP from './map.js';
import * as MDS from './mds.js';
import * as MOT from './mot.js';
import * as SINFO from './sceneInfo.js';
import * as STB from './stb.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';
import { createBufferFromData } from '../gfx/helpers/BufferHelpers.js';
import { DQ8Renderer } from './scenes.js';

export class DQ8Program extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_MDTSubmeshParams = 1;

    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TexCoord = 2;
    public static a_vColor = 3;
    public static a_JointIndices = 4;
    public static a_JointWeights = 5;

    public override both = `
#define SMOOTH_SKINNING() (SKINNING_MATRIX_COUNT > 0)

${GfxShaderLibrary.MatrixLibrary}

precision mediump float;
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};
layout(std140) uniform ub_MDTSubmeshParams {
    Mat3x4 u_ModelView;
    Mat3x4 u_RigidTrans;
#if SMOOTH_SKINNING()
    Mat3x4 u_JointMatrix[SKINNING_MATRIX_COUNT];
#endif
    vec4 u_BGColor;
    vec4 u_BGColor2;
    vec4 u_Misc;
};
uniform sampler2D u_Texture;
varying vec2 v_LightIntensity;

#define u_jointPerVertCount      (u_Misc.x)
#define u_bAlphaTest             (u_Misc.y)
#define u_bIsSkybox              (u_Misc.z)
#define u_bUseVCols              (u_Misc.w)

#ifdef VERT
layout(location = ${DQ8Program.a_Position}) attribute vec3 a_Position;
layout(location = ${DQ8Program.a_Normal}) attribute vec3 a_Normal;
layout(location = ${DQ8Program.a_TexCoord}) attribute vec2 a_TexCoord;
layout(location = ${DQ8Program.a_vColor}) attribute vec4 a_vColor;

#if SMOOTH_SKINNING()
layout(location = ${DQ8Program.a_JointIndices}) attribute vec4 a_JointIndices;
layout(location = ${DQ8Program.a_JointWeights}) attribute vec4 a_JointWeights;
#endif

out vec2 v_TexCoord;
out vec4 v_col;

void mainVS() {
#if SMOOTH_SKINNING()
    mat4x3 t_JointMatrix = mat4x3(0.0);
    t_JointMatrix += UnpackMatrix(u_JointMatrix[int(a_JointIndices.x)]) * a_JointWeights.x;
    t_JointMatrix += UnpackMatrix(u_JointMatrix[int(a_JointIndices.y)]) * a_JointWeights.y;
    t_JointMatrix += UnpackMatrix(u_JointMatrix[int(a_JointIndices.z)]) * a_JointWeights.z;
    t_JointMatrix += UnpackMatrix(u_JointMatrix[int(a_JointIndices.w)]) * a_JointWeights.w;
#else
    mat4x3 t_JointMatrix = UnpackMatrix(u_RigidTrans);
#endif

    vec3 t_PositionLocal = t_JointMatrix * vec4(a_Position, 1.0);

    if (u_bIsSkybox > 0.0)
        t_PositionLocal = UnpackMatrix(u_RigidTrans) * vec4(t_PositionLocal, 1.0); // ???

    if (u_bIsSkybox > 0.0)
        v_col = u_BGColor;
    else
        v_col = a_vColor;

    if (u_bIsSkybox > 0.0 && t_PositionLocal.y < 2000.0 && t_PositionLocal.y > -2000.0)
        v_col = u_BGColor2;

    vec3 t_PositionView = UnpackMatrix(u_ModelView) * vec4(t_PositionLocal, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_PositionView, 1.0);
    v_TexCoord = a_TexCoord;
}
#endif
#ifdef FRAG
in vec2 v_TexCoord;
in vec4 v_col;
void mainPS() {
    vec4 c = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    if (u_bUseVCols > 0.0)
        c *= v_col;
    if (u_bIsSkybox > 0.0)
        gl_FragColor = v_col;
    else
        gl_FragColor = c;
    if(u_bAlphaTest > 0.0 && gl_FragColor.a < 0.6)
        discard;
}
#endif
`;
}

const scratchMatrix = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchQuat = quat.create();
const scratchViewMatrix = mat4.create();
const scratchIDMatrix = mat4.create();
const scratchIDVec3 = vec3.create();

class MDTSubmeshData {
    constructor(public mdtSubmeshes: MDS.MDTSubmesh, public indexBufferOffset: number) {
    }
}

class MDTData {
    private perInstanceBuffer: GfxBuffer | null = null;
    public vertexBufferDescriptors: (GfxVertexBufferDescriptor | null)[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;
    public inputLayout: GfxInputLayout;
    public indexBuffer: GfxBuffer;
    public mdtSubmeshData: MDTSubmeshData[] = [];
    public index: number;
    public program: GfxProgram;
    public smoothSkinning = false;

    constructor(cache: GfxRenderCache, vertexBuffer: GfxBuffer, public mdt: MDS.MDT) {
        const device = cache.device;
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
        const perInstanceBufferData = new Float32Array(32);
        const perInstanceBufferWordOffset = 0;

        const bindVertexAttrib = (location: number, size: number, bufferOffs: number) => {
            const format = makeFormat(FormatTypeFlags.F32, size as FormatCompFlags, FormatFlags.None);
            vertexAttributeDescriptors.push({ location, format, bufferIndex: 1, bufferByteOffset: bufferOffs });
        };

        bindVertexAttrib(DQ8Program.a_Position, 3, 0);
        bindVertexAttrib(DQ8Program.a_Normal, 3, 12);
        bindVertexAttrib(DQ8Program.a_TexCoord, 2, 24);
        bindVertexAttrib(DQ8Program.a_vColor, 4, 32);

        if (this.mdt.jointPerVertCount) {
            bindVertexAttrib(DQ8Program.a_JointIndices, 4, 48);
            bindVertexAttrib(DQ8Program.a_JointWeights, 4, 64);
            this.smoothSkinning = true;
        }

        let perInstanceBinding: GfxVertexBufferDescriptor | null = null;
        if (perInstanceBufferWordOffset !== 0) {
            this.perInstanceBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Uint8Array(perInstanceBufferData.buffer).buffer);
            perInstanceBinding = { buffer: this.perInstanceBuffer };
        }

        const vertexBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [
            { byteStride: 0, frequency: GfxVertexBufferFrequency.Constant, },
            { byteStride: this.mdt.jointPerVertCount ? 80 : 48, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];

        let indexBufferCount = 0;
        for (let i = 0; i < mdt.submeshes.length; i++) {
            const submesh = mdt.submeshes[i];
            indexBufferCount += submesh.indexData.length;
        }

        const indexData = new Uint16Array(indexBufferCount);
        let indexBufferOffs = 0;
        for (let i = 0; i < this.mdt.submeshes.length; i++) {
            const submesh = mdt.submeshes[i];
            this.mdtSubmeshData.push(new MDTSubmeshData(submesh, indexBufferOffs));

            indexData.set(submesh.indexData, indexBufferOffs);
            indexBufferOffs += submesh.indexData.length;
        }

        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexData.buffer);
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        const program = new DQ8Program();
        program.defines.set("SKINNING_MATRIX_COUNT", this.smoothSkinning ? MDS.MDS.maxJointCount.toString() : `0`);
        this.program = cache.createProgram(program);

        this.vertexBufferDescriptors = [perInstanceBinding, { buffer: vertexBuffer }];
        this.indexBufferDescriptor = { buffer: this.indexBuffer };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        if (this.perInstanceBuffer !== null)
            device.destroyBuffer(this.perInstanceBuffer);
    }
}

export class MDTSubmeshInstance {
    public bIsVisible: boolean = true;
    public bNeverVisible: boolean = false;
    public rigidJointId: number;
    private textureMappings = nArray(1, () => new TextureMapping());
    private gfxTextures: (GfxTexture | null)[] = [];
    private gfxSamplers: (GfxSampler | null)[] = [];

    constructor(private mdtData: MDTData, id: number) {
        this.rigidJointId = id;
        const tMap = this.mdtData.mdt.parentMDS.textureDataMap;
        const materials = this.mdtData.mdt.parentMDS.materials;
        for (let i = 0; i < this.mdtData.mdt.submeshes.length; i++) {
            const submeshData = this.mdtData.mdtSubmeshData[i];
            const submesh = submeshData.mdtSubmeshes;
            const smTexName = materials[submesh.materialIdx].texName;
            if (tMap.has(smTexName)) {
                this.gfxTextures.push(tMap.get(smTexName)!.texture);
                this.gfxSamplers.push(tMap.get(smTexName)!.sampler);
            }
            else {
                this.gfxTextures.push(null);
                this.gfxSamplers.push(null);
            }
        }
    }

    public prepareToRender(renderer: DQ8Renderer, renderInstManager: GfxRenderInstManager, boneMatrices: mat4[], viewMatrix: mat4, inverseBindPoseMatrices: mat4[], modelMatrix: mat4 = scratchIDMatrix, bIsSkybox: boolean): void {
        if (!this.bIsVisible)
            return;

        const mdt = this.mdtData.mdt;
        const jPalette = mdt.jointPalette;
        const jointPerVertCount = mdt.jointPerVertCount;

        const materialTemplate = renderInstManager.pushTemplate();
        materialTemplate.setGfxProgram(this.mdtData.program);
        materialTemplate.setVertexInput(this.mdtData.inputLayout, this.mdtData.vertexBufferDescriptors, this.mdtData.indexBufferDescriptor);
        for (let i = 0; i < this.mdtData.mdt.submeshes.length; i++) {
            const submeshData = this.mdtData.mdtSubmeshData[i];
            const submesh = submeshData.mdtSubmeshes;
            const textureMapping = this.textureMappings[0];
            const renderInst = renderInstManager.newRenderInst();
            textureMapping.gfxTexture = this.gfxTextures[i];
            textureMapping.gfxSampler = this.gfxSamplers[i];
            if (bIsSkybox) {
                renderInst.sortKey = makeSortKey(GfxRendererLayer.BACKGROUND);
                renderInst.setMegaStateFlags({ depthWrite: false, polygonOffset: this.mdtData.mdt.parentMDS.materials[submesh.materialIdx].bPolyOffset });
            }
            else if (this.mdtData.mdt.parentMDS.materials[submesh.materialIdx].bIsAlphaTest) {
                renderInst.sortKey = makeSortKey(GfxRendererLayer.ALPHA_TEST);
                renderInst.setMegaStateFlags({ polygonOffset: this.mdtData.mdt.parentMDS.materials[submesh.materialIdx].bPolyOffset });
            }
            else if (this.mdtData.mdt.parentMDS.materials[submesh.materialIdx].bIsAdditive) {
                renderInst.sortKey = setSortKeyLayer(renderInst.sortKey, GfxRendererLayer.TRANSLUCENT);
                const depth = computeViewSpaceDepthFromWorldSpacePoint(viewMatrix, mat4.getTranslation(scratchVec3a, modelMatrix));
                renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
                setAttachmentStateSimple(renderInst.getMegaStateFlags(), {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.SrcAlpha,
                    blendDstFactor: GfxBlendFactor.One,
                });
                renderInst.setMegaStateFlags({ depthWrite: false, polygonOffset: this.mdtData.mdt.parentMDS.materials[submesh.materialIdx].bPolyOffset });
            }
            else if (this.mdtData.mdt.parentMDS.materials[submesh.materialIdx].bIsTransparent) {
                renderInst.sortKey = setSortKeyLayer(renderInst.sortKey, GfxRendererLayer.TRANSLUCENT);
                const depth = computeViewSpaceDepthFromWorldSpacePoint(viewMatrix, mat4.getTranslation(scratchVec3a, modelMatrix));
                renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
                setAttachmentStateSimple(renderInst.getMegaStateFlags(), {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.SrcAlpha,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                });
                renderInst.setMegaStateFlags({ depthWrite: false, polygonOffset: this.mdtData.mdt.parentMDS.materials[submesh.materialIdx].bPolyOffset });
            }
            else if (this.mdtData.mdt.parentMDS.materials[submesh.materialIdx].bIsAlphaBlend) {
                renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
                setAttachmentStateSimple(renderInst.getMegaStateFlags(), {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.SrcAlpha,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                });
                renderInst.setMegaStateFlags({ polygonOffset: this.mdtData.mdt.parentMDS.materials[submesh.materialIdx].bPolyOffset });
            }
            else {
                renderInst.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);
                renderInst.setMegaStateFlags({ depthWrite: true, polygonOffset: this.mdtData.mdt.parentMDS.materials[submesh.materialIdx].bPolyOffset });
            }

            renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
            renderInst.setDrawCount(submesh.indexData.length, submeshData.indexBufferOffset);

            let offs = renderInst.allocateUniformBuffer(DQ8Program.ub_MDTSubmeshParams, 16 * 2 + 12 + 16 * (this.mdtData.smoothSkinning ? MDS.MDS.maxJointCount : 0));
            const d = renderInst.mapUniformBufferF32(DQ8Program.ub_MDTSubmeshParams);
            offs += fillMatrix4x3(d, offs, viewMatrix);

            if (jointPerVertCount && !bIsSkybox) {
                mat4.invert(scratchMatrix, modelMatrix);
                mat4.mul(scratchMatrix, scratchMatrix, boneMatrices[this.rigidJointId]);
                offs += fillMatrix4x3(d, offs, scratchMatrix);
            } else {
                if (!bIsSkybox)
                    offs += fillMatrix4x3(d, offs, boneMatrices[this.rigidJointId]);
                else
                    offs += fillMatrix4x3(d, offs, modelMatrix);
            } 

            if (this.mdtData.smoothSkinning) {
                for (let j = 0; j < MDS.MDS.maxJointCount; j++) {
                    if (j < jPalette.length) {
                        mat4.mul(scratchMatrix, boneMatrices[jPalette[j]], inverseBindPoseMatrices[jPalette[j]]);
                    }
                    else {
                        mat4.identity(scratchMatrix);
                    }
                    offs += fillMatrix4x3(d, offs, scratchMatrix);
                }
            }

            const currentLightSet = renderer.sceneInfo.currentLightSet;
            offs += fillColor(d, offs, currentLightSet ? currentLightSet.bgcolor : colorNewFromRGBA(1, 0, 0, 1));
            offs += fillColor(d, offs, currentLightSet ? currentLightSet.bgcolor2 : colorNewFromRGBA(0, 0, 1, 1));
            offs += fillVec4(d, offs, jointPerVertCount, this.mdtData.mdt.parentMDS.materials[submesh.materialIdx].bIsAlphaTest ? 1 : 0, (bIsSkybox) ? 1 : 0, (renderer.useVertexColors ? 1 : 0));
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
    }
}

export function fillSceneParamsDataOnTemplate(template: GfxRenderInst, camera: Camera): void {
    let offs = template.allocateUniformBuffer(DQ8Program.ub_SceneParams, 16);
    const d = template.mapUniformBufferF32(DQ8Program.ub_SceneParams);
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

export class MDSInstance {
    public animationController = new AnimationController();
    public bIsVisible: boolean = true;
    public bIsSkybox: boolean = false;
    public mdtSubmeshInstances: MDTSubmeshInstance[] = [];
    public debugJoints: boolean = false;
    public IsRigidJointIDVisible = new Map<number, boolean>();
    public jointMatrices: mat4[] = [];
    public motion: MOT.Motion | null = null;
    public texAnims: (IMG.TexAnim | null)[] = nArray(2, () => null);
    public script: STB.STB | null = null;
    public lastTick: number = 0;
    public tickRateMs: number = 1 / 30 * 1000;

    constructor(public cache: GfxRenderCache, public mdsData: MDSData, public modelMatrix = scratchIDMatrix, public eulerRot: vec3 = scratchIDVec3, public img: IMG.IMG | null = null, public mot: MOT.MOT | null = null, public name: string = '', public NPCDayPeriod: SINFO.ENPCDayPeriod | null = null, public DayPeriodFlags: number | null = null, public ProgressFlags: number | null = null) {
        for (let i = 0; i < this.mdsData.mdtData.length; i++) {
            this.mdtSubmeshInstances.push(new MDTSubmeshInstance(this.mdsData.mdtData[i], this.mdsData.mds.rigidTransformJointIds[i]));
            this.IsRigidJointIDVisible.set(this.mdsData.mds.rigidTransformJointIds[i], true);
        }

        this.jointMatrices = nArray(this.mdsData.mds.joints.length, () => mat4.create());
        this.updateJointMatrices();

        //Manual hiding of unrendered meshes
        if (name === "m02g02_01-m") { //Weird unneeded black planes around Alexandria, ugly Z fighting, skip for now
            this.mdtSubmeshInstances[5].bNeverVisible = true;
            this.mdtSubmeshInstances[6].bNeverVisible = true;
            this.mdtSubmeshInstances[9].bNeverVisible = true;
            this.mdtSubmeshInstances[11].bNeverVisible = true;
        }

        if (name === "t02_01-m") {
            this.mdtSubmeshInstances[5].bNeverVisible = true;
            this.mdtSubmeshInstances[7].bNeverVisible = true;
        }
        if (name === "t03f01_01-m") {
            this.mdtSubmeshInstances[0].bNeverVisible = true;
            this.mdtSubmeshInstances[4].bNeverVisible = true;
            this.mdtSubmeshInstances[6].bNeverVisible = true;
            this.mdtSubmeshInstances[7].bNeverVisible = true;
            this.mdtSubmeshInstances[9].bNeverVisible = true;
        }
        if (name === "s09_01-m1") {
            this.mdtSubmeshInstances[14].bNeverVisible = true;
            this.mdtSubmeshInstances[15].bNeverVisible = true;
            this.mdtSubmeshInstances[16].bNeverVisible = true;
        }
        if (name === "m01i07_09-m") //Crystal ball
            this.mdtSubmeshInstances[1].bNeverVisible = true;
        if (name === "s3602-m1" || name === "s3602-m_1") //Rydon's planes
            this.mdtSubmeshInstances[2].bNeverVisible = true;
        if (name === "x01i07_01-m0")
            this.mdtSubmeshInstances[30].bNeverVisible = true;
    }

    private updateJointMatrices(viewerInput: Viewer.ViewerRenderInput | null = null): void {
        for (let i = 0; i < this.mdsData.mds.joints.length; i++) {
            const joint = this.mdsData.mds.joints[i];
            MOT.computeMatricesAndVisibility(this.jointMatrices[joint.id], this.animationController, this.motion, joint, this.IsRigidJointIDVisible);
            const parentTransform = joint.parentId >= 0 ? this.jointMatrices[joint.parentId] : this.modelMatrix;
            mat4.mul(this.jointMatrices[joint.id], parentTransform, this.jointMatrices[joint.id]);
            if (joint.bIsBillboard && viewerInput !== null) {
                mat4.getTranslation(scratchVec3a, this.jointMatrices[joint.id]);
                mat4.getScaling(scratchVec3b, this.jointMatrices[joint.id]);
                mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, scratchMatrix);
                //Only some parent in the hierarchy is flagged as billboard sometimes, compute the rotation accordingly, it'll be passed down to the hierarchy using the transforms.
                calcBillboardMatrix(scratchMatrix, scratchMatrix, CalcBillboardFlags.UseRollLocal | CalcBillboardFlags.PriorityZ | CalcBillboardFlags.UseZPlane);
                mat4.mul(scratchMatrix, viewerInput.camera.worldMatrix, scratchMatrix);
                mat4.getRotation(scratchQuat, scratchMatrix);
                mat4.fromRotationTranslationScale(this.jointMatrices[joint.id], scratchQuat, scratchVec3a, scratchVec3b);
            }

            //Angular rotation if relevant (clouds in the sky for ex)
            if (this.mdsData.mds.rotJointIdToAngVels.get(joint.id)) {
                if (viewerInput !== null) {
                    mat4.rotateY(joint.extraRotMat, joint.extraRotMat, this.mdsData.mds.rotJointIdToAngVels.get(joint.id)! * 0.001 * viewerInput.deltaTime);
                    mat4.mul(this.jointMatrices[joint.id], joint.extraRotMat, this.jointMatrices[joint.id]);
                }
            }
        }
    }

    private updateTextureAnims(): void {
        for (let i = 0; i < this.texAnims.length; i++) {
            if (this.texAnims[i] !== null)
                IMG.animateTexture(this.texAnims[i] as IMG.TexAnim, this.animationController, this.img, this.cache.device, this.mdsData.mds.textureDataMap);
        }
    }

    private computeViewMatrix(dst: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        computeViewMatrix(dst, viewerInput.camera);
    }

    public getMotion(motionName: string): MOT.Motion | null {
        if (this.mot === null)
            return null;
        return fallbackUndefined(this.mot.motionNameToMotion.get(motionName), null);
    }

    public prepareToRender(renderer: DQ8Renderer, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const sceneInfo = renderer.sceneInfo;
        if (!this.bIsVisible || (this.ProgressFlags !== null && this.ProgressFlags !== sceneInfo.currentGameProgress) || (this.NPCDayPeriod !== null && !((this.NPCDayPeriod) & (1 << sceneInfo.currentNPCDayPeriod))) || (this.DayPeriodFlags !== null && !(this.DayPeriodFlags & sceneInfo.currentDayPeriodFlags)))
            return;

        this.animationController.setTimeInMilliseconds(viewerInput.time);
        this.computeViewMatrix(scratchViewMatrix, viewerInput);

        this.updateJointMatrices(viewerInput);
        this.updateTextureAnims();

        if (this.debugJoints) {
            const ctx = getDebugOverlayCanvas2D();
            for (let i = 0; i < this.mdsData.mds.joints.length; i++) {
                const joint = this.mdsData.mds.joints[i];

                // if (joint.bIsBillboard)
                //     drawWorldSpaceBasis(ctx, viewerInput.camera.clipFromWorldMatrix, this.jointMatrices[joint.id],5,5);

                if (joint.parentId < 0)
                    continue;

                vec3.set(scratchVec3a, 0, 0, 0);
                vec3.transformMat4(scratchVec3a, scratchVec3a, this.jointMatrices[joint.parentId]);
                vec3.set(scratchVec3b, 0, 0, 0);
                vec3.transformMat4(scratchVec3b, scratchVec3b, this.jointMatrices[joint.id]);
                drawWorldSpaceLine(ctx, viewerInput.camera.clipFromWorldMatrix, scratchVec3a, scratchVec3b, colorNewFromRGBA(0, 0, 1, 1), 3);

                // ctx.clearRect(50,50,0,0);
                // drawScreenSpaceText(ctx, 50,50,angle.toFixed(2).toString(),Blue);
                // drawWorldSpaceCylinder(ctx, viewerInput.camera.clipFromWorldMatrix, scratchVec3b,10,10,scratchVec3a,10);
                // drawWorldSpacePoint(ctx, viewerInput.camera.clipFromWorldMatrix, scratchVec3b, Yellow,100);
            }
        }

        for (let i = 0; i < this.mdtSubmeshInstances.length; i++) {
            const submesh = this.mdtSubmeshInstances[i];
            if (submesh.bNeverVisible)
                continue;
            const jointVisible = this.IsRigidJointIDVisible.get(submesh.rigidJointId)!;
            if (!jointVisible)
                continue;
            let bIsSkyHalfSphere = this.bIsSkybox;
            if (bIsSkyHalfSphere)
                bIsSkyHalfSphere = this.mdsData.mds.joints[submesh.rigidJointId].name.startsWith("back");
            submesh.prepareToRender(renderer, renderInstManager, this.jointMatrices, scratchViewMatrix, this.mdsData.inverseBindPoseMatrices, this.modelMatrix, bIsSkyHalfSphere);
            if (bIsSkyHalfSphere) {
                mat4.rotateX(scratchMatrix, this.modelMatrix, 1.57);
                mat4.translate(scratchMatrix, scratchMatrix, vec3.fromValues(0, -50, 0)); //Make sure there's no hole
                submesh.prepareToRender(renderer, renderInstManager, this.jointMatrices, scratchViewMatrix, this.mdsData.inverseBindPoseMatrices, scratchMatrix, bIsSkyHalfSphere);
            }
        }
    }

    public setVisible(visible: boolean): void {
        this.bIsVisible = visible;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.mdtSubmeshInstances.length; i++)
            this.mdtSubmeshInstances[i].destroy(device);
        this.mdsData.destroy(device);
    }

    public bindMotion(motion: MOT.Motion | null): void {
        this.motion = motion;
    }

    public bindScript(script: STB.STB | null): void {
        this.script = script;
    }

    public executeScript(sceneInfo: SINFO.SceneInfo): void {
        if (this.script === null || this.script === undefined)
            return;
        this.script.processEntry(sceneInfo, this);
    }

    public bindTexAnim(texAnim: IMG.TexAnim, index: number): void {
        assert(index < this.texAnims.length);
        this.texAnims[index] = texAnim;
    }
}

export class MDSData {
    public mdtData: MDTData[] = [];
    public inverseBindPoseMatrices: mat4[] = [];
    public vertexBuffers: GfxBuffer[] = [];

    constructor(cache: GfxRenderCache, public mds: MDS.MDS) {
        const device = cache.device;
        for (let i = 0; i < this.mds.mdts.length; i++) {
            this.vertexBuffers[i] = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, this.mds.mdts[i].vertexData.buffer);
            this.mdtData[i] = new MDTData(cache, this.vertexBuffers[i], this.mds.mdts[i]);
        }

        const tempJointMatrices = nArray(mds.joints.length, () => mat4.create());
        for (let i = 0; i < mds.joints.length; i++) {
            const joint = mds.joints[i];
            MOT.computeMatricesAndVisibility(tempJointMatrices[i], null, null, joint, null);
            if (joint.parentId >= 0)
                mat4.mul(tempJointMatrices[i], tempJointMatrices[joint.parentId], tempJointMatrices[i]);
        }

        this.inverseBindPoseMatrices = nArray(mds.joints.length, () => mat4.create());
        for (let i = 0; i < mds.joints.length; i++)
            mat4.invert(this.inverseBindPoseMatrices[i], tempJointMatrices[i]);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.mdtData.length; i++) {
            this.mdtData[i].destroy(device);
            device.destroyBuffer(this.vertexBuffers[i]);
        }
    }
}

export class CHRRenderer {
    public bIsVisible: boolean = true;
    public name: string;
    public MDSRenderers: MDSInstance[] = [];
    public motNameToMotionMaps: (Map<string, MOT.Motion> | null)[] = [];
    public lastTick: number = 0;
    public tickRateMs: number = 1 / 30 * 1000;

    constructor(sceneInfo: SINFO.SceneInfo, cache: GfxRenderCache, public chrs: CHR.CHR[], public transforms: mat4[], public eulerRotations: vec3[], public chrNPCDayPeriods: (SINFO.ENPCDayPeriod | null)[], public chrDayPeriodFlags: (number | null)[], public stbs: (STB.STB | null)[] | null = null, public chrProgressFlags: (number | null)[]) {
        this.name = "CHR renderers";
        for (let i = 0; i < chrs.length; i++) {
            const chr = chrs[i];
            this.motNameToMotionMaps.push(chr.mot !== null ? chr.mot.motionNameToMotion : null);
            const model = assertExists(chr.model);
            const mdsData = new MDSData(cache, model);
            const mdsRenderer = new MDSInstance(cache, mdsData, transforms[i], eulerRotations[i], chr.img, chr.mot, model.name, chrNPCDayPeriods[i], chrDayPeriodFlags[i], chrProgressFlags[i]);

            //default blinking anim for characters
            if (chr.img !== null && chr.img.texAnimNameToTexAnim.has("デフォルト目パチ"))
                //slot 0 picked for facial eye anims.
                mdsRenderer.bindTexAnim(mdsRenderer.img!.texAnimNameToTexAnim.get("デフォルト目パチ") as IMG.TexAnim, 0);
            //Some NPCs have no script attached but are still animated. Needs more investigation, for now default to idle.
            let mot = mdsRenderer.getMotion("立ち");
            if (mot !== null)
                mdsRenderer.bindMotion(mot);
            else {
                mot = mdsRenderer.getMotion("馬立ち"); //Medea in Farebury
                if (mot !== null)
                    mdsRenderer.bindMotion(mot);
            }
            //mizusibuki
            mot = mdsRenderer.getMotion("水しぶき（小）");
            if (mot !== null)
                mdsRenderer.bindMotion(mot);

            if (stbs !== null) {
                mdsRenderer.bindScript(stbs[i]);
                mdsRenderer.executeScript(sceneInfo);
            }

            this.MDSRenderers.push(mdsRenderer);
        }
    }

    public setVisible(v: boolean) {
        this.bIsVisible = v;
    }

    public prepareToRender(renderer: DQ8Renderer, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const sceneInfo = renderer.sceneInfo;

        if (!this.bIsVisible)
            return;

        if (viewerInput.time > this.lastTick + this.tickRateMs) {
            this.lastTick = viewerInput.time;
            for (let i = 0; i < this.MDSRenderers.length; i++) {
                const mds = this.MDSRenderers[i];
                if (!mds.bIsVisible || (mds.ProgressFlags !== null && mds.ProgressFlags !== sceneInfo.currentGameProgress) || (mds.NPCDayPeriod !== null && !((mds.NPCDayPeriod) & (1 << renderer.sceneInfo.currentNPCDayPeriod))) || (mds.DayPeriodFlags !== null && !(mds.DayPeriodFlags & renderer.sceneInfo.currentDayPeriodFlags)))
                    continue;
                mds.executeScript(renderer.sceneInfo);
            }
        }

        for (let i = 0; i < this.MDSRenderers.length; i++)
            this.MDSRenderers[i].prepareToRender(renderer, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.MDSRenderers.length; i++)
            this.MDSRenderers[i].destroy(device);
    }
}

export class MAPRenderer {
    public bIsVisible: boolean = true;
    public name: string;
    public MDSRenderers: MDSInstance[] = [];

    constructor(cache: GfxRenderCache, public maps: MAP.MAP[]) {
        this.name = "Map renderer";
        for (let i = 0; i < maps.length; i++) {
            const map = maps[i];
            for (let j = 0; j < map.modelNames.length; j++) {
                const modelName: string = map.modelNames[j];
                if (map.fireEffectIndices.has(j)) {
                    this.MDSRenderers.push(new MDSInstance(cache, new MDSData(cache, map.modelMap.get(modelName) as MDS.MDS), map.modelTransforms[j], scratchIDVec3, map.fireImg, null, modelName, null, map.modelPeriodFlags[j]));
                    //default fire anim for fire effects
                    if (map.fireImg !== null && map.fireImg.texAnimNameToTexAnim.has("taimatu"))
                        //slot 0 picked for fire anims.
                        this.MDSRenderers[j].bindTexAnim(this.MDSRenderers[j].img!.texAnimNameToTexAnim.get("taimatu") as IMG.TexAnim, 0);
                }
                else {
                    this.MDSRenderers.push(new MDSInstance(cache, new MDSData(cache, map.modelMap.get(modelName) as MDS.MDS), map.modelTransforms[j], scratchIDVec3, map.img, null, modelName, null, map.modelPeriodFlags[j]));
                    if (modelName === "sphereSky" || modelName === "sky0") {
                        this.MDSRenderers[this.MDSRenderers.length - 1].bIsSkybox = true;
                    }
                }
            }
        }
    }

    public setVisible(v: boolean) {
        this.bIsVisible = v;
    }

    public prepareToRender(renderer: DQ8Renderer, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.bIsVisible)
            return;

        for (let i = 0; i < this.MDSRenderers.length; i++)
            this.MDSRenderers[i].prepareToRender(renderer, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.MDSRenderers.length; i++)
            this.MDSRenderers[i].destroy(device);
    }
}

export function textureToCanvas(texture: IMG.Texture): Viewer.Texture {
    const canvas = convertToCanvas(ArrayBufferSlice.fromView(texture.pixels), texture.width, texture.height);
    const name = texture.name;
    canvas.title = name;

    const surfaces = [canvas];
    return { name, surfaces };
}

