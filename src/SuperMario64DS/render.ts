
import { mat2d, mat4, vec2 } from 'gl-matrix';

import * as BMD from './sm64ds_bmd.js';
import * as NITRO_GX from './nitro_gx.js';

import * as Viewer from '../viewer.js';

import { DeviceProgram } from '../Program.js';
import { computeViewMatrix, computeViewMatrixSkybox } from '../Camera.js';
import { TextureMapping } from '../TextureHolder.js';
import { GfxFormat, GfxBufferUsage, GfxBlendMode, GfxBlendFactor, GfxDevice, GfxBuffer, GfxVertexBufferFrequency, GfxTexFilterMode, GfxMipFilterMode, GfxInputLayout, GfxVertexAttributeDescriptor, GfxSampler, makeTextureDescriptor2D, GfxMegaStateDescriptor, GfxTexture, GfxInputLayoutBufferDescriptor, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor } from '../gfx/platform/GfxPlatform.js';
import { fillMatrix4x3, fillVec4, fillMatrix4x2, fillColor } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxRenderInstManager, GfxRenderInst, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderInstManager.js';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers.js';
import { parseTexImageParamWrapModeS, parseTexImageParamWrapModeT } from './nitro_tex.js';
import { assert, nArray } from '../util.js';
import { BCA, bindBCAAnimator, BCAAnimator } from './sm64ds_bca.js';
import AnimationController from '../AnimationController.js';
import { CalcBillboardFlags, calcBillboardMatrix, computeMatrixWithoutScale } from '../MathHelpers.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { White, colorNewCopy } from '../Color.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';

export class NITRO_Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_UV = 1;
    public static a_Color = 2;
    public static a_Normal = 3;
    public static a_PosMtxIdx = 4;

    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;
    public static ub_DrawParams = 2;

    public static both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    // Light configuration
    vec4 u_LightDir[4];
    vec4 u_LightColor[4];
};

// Expected to change with each material.
layout(std140) uniform ub_MaterialParams {
    Mat2x4 u_TexMtx[1];
    vec4 u_Misc[4];
};
#define u_DiffuseColor  (u_Misc[0].xyz)
#define u_AmbientColor  (u_Misc[1].xyz)
#define u_SpecularColor (u_Misc[2].xyz)
#define u_EmissionColor (u_Misc[3].xyz)
#define u_TexCoordMode  (u_Misc[0].w)
#define u_LightMask     (u_Misc[1].w)

layout(std140) uniform ub_DrawParams {
    Mat3x4 u_PosMtx[32];
};

uniform sampler2D u_Texture;
`;

    public override both = NITRO_Program.both;

    public override vert = `
layout(location = ${NITRO_Program.a_Position}) in vec3 a_Position;
layout(location = ${NITRO_Program.a_UV}) in vec2 a_UV;
layout(location = ${NITRO_Program.a_Color}) in vec4 a_Color;
layout(location = ${NITRO_Program.a_Normal}) in vec3 a_Normal;
layout(location = ${NITRO_Program.a_PosMtxIdx}) in float a_PosMtxIdx;
out vec4 v_Color;
out vec2 v_TexCoord;

vec3 CalcLight(in vec3 vtxNormal) {
    vec3 ret = vec3(0.0);

    int lightMask = int(u_LightMask);
    for (int i = 0; i < 4; i++) {
        int lightBit = (1 << i);
        if ((lightMask & lightBit) == 0)
            continue;

        vec3 lightDir = u_LightDir[i].xyz;
        vec3 lightColor = u_LightColor[i].xyz;
        ret += max(dot(vtxNormal, lightDir), 0.0) * u_DiffuseColor * lightColor;
        ret += u_AmbientColor * lightColor;
        // TODO(jstpierre): Specular
    }

    ret += u_EmissionColor;
    return ret;
}

${GfxShaderLibrary.MulNormalMatrix}

void main() {
    mat4x3 t_PosMtx = UnpackMatrix(u_PosMtx[int(a_PosMtxIdx)]);
    vec3 t_PositionView = t_PosMtx * vec4(a_Position, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_PositionView, 1.0);
    v_Color = a_Color;

    if (a_Color.r < 0.0) {
        // Turn on lighting
        vec3 t_NormalView = MulNormalMatrix(t_PosMtx, a_Normal);
        v_Color.rgb = CalcLight(t_NormalView);
    }

    vec2 t_TexSpaceCoord;
    if (u_TexCoordMode == 2.0) { // TexCoordMode.NORMAL
        v_TexCoord = UnpackMatrix(u_TexMtx[0]) * vec4(a_Normal, 1.0);
    } else {
        v_TexCoord = UnpackMatrix(u_TexMtx[0]) * vec4(a_UV, 1.0, 1.0);
    }
}
`;
    public override frag = `
precision mediump float;
in vec4 v_Color;
in vec2 v_TexCoord;

void main() {
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);

#ifdef USE_TEXTURE
    gl_FragColor *= texture(SAMPLER_2D(u_Texture), v_TexCoord);
#endif

#ifdef USE_VERTEX_COLOR
    gl_FragColor *= v_Color;
#endif

    if (gl_FragColor.a == 0.0)
        discard;
}
`;
}

export class VertexData {
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;

    constructor(cache: GfxRenderCache, public nitroVertexData: NITRO_GX.VertexData) {
        const device = cache.device;
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, this.nitroVertexData.packedVertexBuffer.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, this.nitroVertexData.indexBuffer.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: NITRO_Program.a_Position, format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 0*4 },
            { location: NITRO_Program.a_Color, format: GfxFormat.F32_RGBA, bufferIndex: 0, bufferByteOffset: 3*4 },
            { location: NITRO_Program.a_UV, format: GfxFormat.F32_RG, bufferIndex: 0, bufferByteOffset: 7*4 },
            { location: NITRO_Program.a_Normal, format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 9*4 },
            { location: NITRO_Program.a_PosMtxIdx, format: GfxFormat.F32_R, bufferIndex: 0, bufferByteOffset: 12*4 },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: NITRO_GX.VERTEX_BYTES, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];

        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
        this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer, byteOffset: 0, }];
        this.indexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0 };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

function mat4_from_mat2d(dst: mat4, m: mat2d): void {
    const ma = m[0], mb = m[1];
    const mc = m[2], md = m[3];
    const mx = m[4], my = m[5];
    dst[0] = ma;
    dst[1] = mc;
    dst[2] = 0;
    dst[3] = 0;
    dst[4] = mb;
    dst[5] = md;
    dst[6] = 0;
    dst[7] = 0;
    dst[8] = 0;
    dst[9] = 0;
    dst[10] = 1;
    dst[11] = 0;
    dst[12] = mx;
    dst[13] = my;
    dst[14] = 0;
    dst[15] = 1;
}

class BatchData {
    public vertexData: VertexData;

    constructor(cache: GfxRenderCache, public rootJoint: BMD.Joint, public batch: BMD.Batch) {
        this.vertexData = new VertexData(cache, batch.vertexData);
    }

    public destroy(device: GfxDevice): void {
        this.vertexData.destroy(device);
    }
}

class MaterialData {
    private gfxTexture: GfxTexture | null = null;
    private gfxSampler: GfxSampler | null = null;

    public textureMapping = nArray(1, () => new TextureMapping());

    constructor(cache: GfxRenderCache, public material: BMD.Material) {
        const texture = this.material.texture;

        const device = cache.device;
        if (texture !== null) {
            this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
            device.setResourceName(this.gfxTexture, texture.name);

            device.uploadTextureData(this.gfxTexture, 0, [texture.pixels]);

            this.gfxSampler = cache.createSampler({
                minFilter: GfxTexFilterMode.Point,
                magFilter: GfxTexFilterMode.Point,
                mipFilter: GfxMipFilterMode.Nearest,
                wrapS: parseTexImageParamWrapModeS(this.material.texParams),
                wrapT: parseTexImageParamWrapModeT(this.material.texParams),
                minLOD: 0,
                maxLOD: 100,
            });

            this.textureMapping[0].gfxTexture = this.gfxTexture;
            this.textureMapping[0].gfxSampler = this.gfxSampler;
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxTexture !== null)
            device.destroyTexture(this.gfxTexture);
    }
}

export class BMDData {
    public materialData: MaterialData[] = [];
    public batchData: BatchData[] = [];

    constructor(cache: GfxRenderCache, public bmd: BMD.BMD) {
        for (let i = 0; i < this.bmd.materials.length; i++)
            this.materialData.push(new MaterialData(cache, this.bmd.materials[i]));

        for (let i = 0; i < this.bmd.joints.length; i++) {
            const joint = this.bmd.joints[i];
            for (let j = 0; j < joint.batches.length; j++)
                this.batchData.push(new BatchData(cache, joint, joint.batches[j]));
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.materialData.length; i++)
            this.materialData[i].destroy(device);
        for (let i = 0; i < this.batchData.length; i++)
            this.batchData[i].destroy(device);
    }
}

function selectArray(arr: Float32Array, time: number): number {
    return arr[(time | 0) % arr.length];
}

const scratchMat2d = mat2d.create();
const scratchMatrix = mat4.create();
const scratchVec2 = vec2.create();
class MaterialInstance {
    private crg1TextureAnimation: CRG1TextureAnimation | null = null;
    private texCoordMode: BMD.TexCoordMode;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private program: NITRO_Program;
    public lightMask = 0x0F;
    public diffuseColor = colorNewCopy(White);
    public ambientColor = colorNewCopy(White);
    public specularColor = colorNewCopy(White);
    public emissionColor = colorNewCopy(White);

    private texturesEnabled: boolean = true;
    private vertexColorsEnabled: boolean = true;

    constructor(crg1Level: CRG1Level | null, public materialData: MaterialData) {
        const material = this.materialData.material;

        // Find any possible material animations.
        if (crg1Level !== null) {
            const textureAnimation = crg1Level.TextureAnimations.find((c) => c.MaterialName === material.name);
            if (textureAnimation !== undefined)
                this.crg1TextureAnimation = textureAnimation;
        }

        this.megaStateFlags = {
            depthWrite: material.depthWrite,
            cullMode: material.cullMode,
        };
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
        });

        this.createProgram();

        this.texCoordMode = (material.texParams >>> 30);
    }

    private createProgram(): void {
        const program = new NITRO_Program();
        const material = this.materialData.material;
        if (this.texturesEnabled && material.texture !== null)
            program.defines.set('USE_TEXTURE', '1');
        if (this.vertexColorsEnabled)
            program.defines.set('USE_VERTEX_COLOR', '1');
        this.program = program;
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.vertexColorsEnabled = v;
        this.createProgram();
    }

    public setTexturesEnabled(v: boolean): void {
        this.texturesEnabled = v;
        this.createProgram();
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, template: GfxRenderInst, viewerInput: Viewer.ViewerRenderInput, normalMatrix: mat4, extraTexCoordMat: mat2d | null): void {
        const gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);
        template.setGfxProgram(gfxProgram);
        template.setMegaStateFlags(this.megaStateFlags);

        const material = this.materialData.material;

        const layer = material.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        template.sortKey = makeSortKey(layer);

        if (material.texture !== null) {
            if (this.texCoordMode === BMD.TexCoordMode.NORMAL) {
                mat4.copy(scratchMatrix, normalMatrix);

                // Game seems to use this to offset the center of the reflection.
                scratchMatrix[12] += material.texCoordMat[4];
                scratchMatrix[13] += -material.texCoordMat[5];

                // We shouldn't have any texture animations on normal-mapped textures.
                assert(this.crg1TextureAnimation === null);
            } else {
                if (this.crg1TextureAnimation !== null) {
                    const time = viewerInput.time / 30;
                    const scale = selectArray(this.crg1TextureAnimation.Scale, time);
                    const rotation = selectArray(this.crg1TextureAnimation.Rotation, time);
                    const x = selectArray(this.crg1TextureAnimation.X, time);
                    const y = selectArray(this.crg1TextureAnimation.Y, time);
                    mat2d.identity(scratchMat2d);
                    mat2d.scale(scratchMat2d, scratchMat2d, vec2.set(scratchVec2, scale, scale));
                    mat2d.rotate(scratchMat2d, scratchMat2d, rotation / 180 * Math.PI);
                    mat2d.translate(scratchMat2d, scratchMat2d, vec2.set(scratchVec2, -x, y));
                    mat2d.mul(scratchMat2d, scratchMat2d, material.texCoordMat);
                } else {
                    mat2d.copy(scratchMat2d, material.texCoordMat);
                }

                if (extraTexCoordMat !== null)
                    mat2d.mul(scratchMat2d, scratchMat2d, extraTexCoordMat);

                mat4_from_mat2d(scratchMatrix, scratchMat2d);
            }
        }

        let offs = template.allocateUniformBuffer(NITRO_Program.ub_MaterialParams, 8+16);
        const materialParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_MaterialParams);
        offs += fillMatrix4x2(materialParamsMapped, offs, scratchMatrix);
        offs += fillColor(materialParamsMapped, offs, this.diffuseColor, this.texCoordMode);
        offs += fillColor(materialParamsMapped, offs, this.ambientColor, this.lightMask);
        offs += fillColor(materialParamsMapped, offs, this.specularColor);
        offs += fillColor(materialParamsMapped, offs, this.emissionColor);

        template.setSamplerBindingsFromTextureMappings(this.materialData.textureMapping);
    }
}

class ShapeInstance {
    public visible = true;

    constructor(private materialInstance: MaterialInstance, private batchData: BatchData) {
        assert(this.batchData.batch.matrixTable.length <= 32);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, normalMatrix: mat4, extraTexCoordMat: mat2d | null, modelInstance: BMDModelInstance): void {
        if (!this.visible)
            return;

        const vertexData = this.batchData.vertexData;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setVertexInput(vertexData.inputLayout, vertexData.vertexBufferDescriptors, vertexData.indexBufferDescriptor);
        this.materialInstance.prepareToRender(device, renderInstManager, renderInst, viewerInput, normalMatrix, extraTexCoordMat);

        let offs = renderInst.allocateUniformBuffer(NITRO_Program.ub_DrawParams, 12*32);
        const d = renderInst.mapUniformBufferF32(NITRO_Program.ub_DrawParams);
        const rootJoint = this.batchData.rootJoint;
        for (let i = 0; i < this.batchData.batch.matrixTable.length; i++) {
            const matrixId = this.batchData.batch.matrixTable[i];
            modelInstance.computeModelView(scratchMatrix, matrixId, viewerInput, rootJoint.billboard);
            offs += fillMatrix4x3(d, offs, scratchMatrix);
        }

        const drawCall = vertexData.nitroVertexData.drawCall;
        renderInst.setDrawCount(drawCall.numIndices, drawCall.startIndex);
        renderInstManager.submitRenderInst(renderInst);
    }
}

const scratchModelMatrix = mat4.create();
const scratchNormalMatrix = mat4.create();
export class BMDModelInstance {
    public name: string = '';
    public isSkybox: boolean = false;
    public modelMatrix = mat4.create();
    public extraTexCoordMat: mat2d | null = null;
    public visible = true;

    private materialInstances: MaterialInstance[] = [];
    private shapeInstances: ShapeInstance[] = [];
    private jointMatrices: mat4[];
    private bcaAnimator: BCAAnimator | null = null;

    constructor(public bmdData: BMDData, public crg1Level: CRG1Level | null = null) {
        this.jointMatrices = nArray(this.bmdData.bmd.joints.length, () => mat4.create());

        for (let i = 0; i < this.bmdData.batchData.length; i++) {
            const batchData = this.bmdData.batchData[i];
            const materialData = bmdData.materialData[batchData.batch.materialIdx];
            const materialInstance = new MaterialInstance(this.crg1Level, materialData);
            this.materialInstances.push(materialInstance);
            const shapeInstance = new ShapeInstance(materialInstance, batchData);
            this.shapeInstances.push(shapeInstance);
        }
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setTexturesEnabled(v);
    }

    public bindBCA(animationController: AnimationController, bca: BCA): void {
        this.bcaAnimator = bindBCAAnimator(animationController, bca);
    }

    private computeJointMatrices(): void {
        for (let i = 0; i < this.bmdData.bmd.joints.length; i++) {
            const joint = this.bmdData.bmd.joints[i];
            const dst = this.jointMatrices[i];

            let jointMatrix: mat4;
            if (this.bcaAnimator !== null) {
                this.bcaAnimator.calcJointMatrix(scratchModelMatrix, i);
                jointMatrix = scratchModelMatrix;
            } else {
                jointMatrix = joint.modelMatrix;
            }

            if (joint.parentJointIdx >= 0) {
                mat4.mul(dst, this.jointMatrices[joint.parentJointIdx], jointMatrix);
            } else {
                mat4.mul(dst, this.modelMatrix, jointMatrix);
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        this.computeJointMatrices();

        this.computeNormalMatrix(scratchNormalMatrix, viewerInput);
        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].prepareToRender(device, renderInstManager, viewerInput, scratchNormalMatrix, this.extraTexCoordMat, this);
    }

    public computeViewMatrix(dst: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.isSkybox) {
            computeViewMatrixSkybox(dst, viewerInput.camera);
        } else {
            computeViewMatrix(dst, viewerInput.camera);
        }
    }

    public computeModelView(dst: mat4, matrixIdx: number, viewerInput: Viewer.ViewerRenderInput, isBillboard: boolean): void {
        const jointIdx = this.bmdData.bmd.matrixToJointTable[matrixIdx];
        const jointMatrix = this.jointMatrices[jointIdx];

        mat4.copy(scratchModelMatrix, jointMatrix);

        this.computeViewMatrix(dst, viewerInput);
        mat4.mul(dst, dst, scratchModelMatrix);

        if (isBillboard) {
            // Apply billboard model if necessary.
            calcBillboardMatrix(dst, dst, CalcBillboardFlags.UseRollLocal | CalcBillboardFlags.PriorityZ | CalcBillboardFlags.UseZPlane);
        }
    }

    public computeNormalMatrix(dst: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        this.computeViewMatrix(dst, viewerInput);
        computeMatrixWithoutScale(scratchModelMatrix, this.modelMatrix);
        mat4.mul(dst, dst, scratchModelMatrix);
        dst[12] = 0;
        dst[13] = 0;
        dst[14] = 0;
    }
}

export interface CRG1TextureAnimation {
    MaterialName: string;
    Duration: number;
    Scale: Float32Array;
    Rotation: Float32Array;
    X: Float32Array;
    Y: Float32Array;
}

export interface CRG1ObjectBase {
    Area: number;
    Position: { X: number, Y: number, Z: number };
    Rotation: { Y: number };
}

export interface CRG1StandardObject extends CRG1ObjectBase {
    Type: 'Simple' | 'Standard';
    ObjectId: number;
    Setup: number;
    Parameters: number[];
}

export interface CRG1DoorObject extends CRG1ObjectBase {
    Type: 'Door';
    DoorType: number;
    PlaneSize: { X: number, Y: number };
}

export type CRG1Object = CRG1StandardObject | CRG1DoorObject;

export interface CRG1Level {
    MapBmdFile: string;
    Background: number;
    TextureAnimations: CRG1TextureAnimation[];
    Objects: CRG1Object[];
    SetupNames: string[];
}

export interface Sm64DSCRG1 {
    Levels: CRG1Level[];
}
