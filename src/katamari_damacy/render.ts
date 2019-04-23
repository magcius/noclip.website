
import { GfxDevice, GfxBuffer, GfxInputState, GfxInputLayout, GfxFormat, GfxVertexAttributeFrequency, GfxVertexAttributeDescriptor, GfxBufferUsage, GfxBufferFrequencyHint, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxTextureDimension, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxCullMode, GfxCompareMode } from "../gfx/platform/GfxPlatform";
import { BINModel, BINTexture, ModelSector, BINModelPart, GSPixelStorageFormat, psmToString, GSConfiguration, GSTextureFunction, GSAlphaCompareMode, GSDepthCompareMode, GSAlphaFailMode } from "./bin";
import { DeviceProgram, DeviceProgramReflection } from "../Program";
import * as Viewer from "../viewer";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { GfxRenderInst, GfxRenderInstBuilder, GfxRenderInstViewRenderer } from "../gfx/render/GfxRenderer";
import { GfxRenderBuffer } from "../gfx/render/GfxRenderBuffer";
import { Camera, computeViewMatrix } from "../Camera";
import { mat4 } from "gl-matrix";
import { fillMatrix4x3, fillMatrix4x4, fillColor } from "../gfx/helpers/UniformBufferHelpers";
import { BasicRendererHelper } from "../oot3d/render";
import { TextureHolder, LoadedTexture, TextureMapping } from "../TextureHolder";
import { nArray, assert } from "../util";
import * as UI from "../ui";

class KatamariDamacyProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    private static reflectionDeclarations = `
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_ModelParams {
    Mat4x3 u_BoneMatrix[1];
    Mat4x3 u_NormalMatrix[1];
    vec4 u_Color;
};

uniform sampler2D u_Texture[1];

varying vec3 v_Normal;
varying vec2 v_TexCoord;
`;
    public static programReflection: DeviceProgramReflection = DeviceProgram.parseReflectionDefinitions(KatamariDamacyProgram.reflectionDeclarations);

    public vert = `
${KatamariDamacyProgram.reflectionDeclarations}
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec2 a_TexCoord;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_Normal = normalize(Mul(_Mat4x4(u_NormalMatrix[0]), vec4(a_Normal, 0.0)).xyz);
    v_TexCoord = a_TexCoord;
}
`;

    constructor(gsConfiguration: GSConfiguration) {
        super();
        this.frag = this.generateFrag(gsConfiguration);
    }

    private generateAlphaCompareOp(atst: GSAlphaCompareMode, lhs: string, rhs: string): string {
        switch (atst) {
        case GSAlphaCompareMode.ALWAYS: return `true`;
        case GSAlphaCompareMode.NEVER: return `false`;
        case GSAlphaCompareMode.LESS: return `${lhs} < ${rhs}`;
        case GSAlphaCompareMode.LEQUAL: return `${lhs} <= ${rhs}`;
        case GSAlphaCompareMode.EQUAL: return `${lhs} == ${rhs}`;
        case GSAlphaCompareMode.GEQUAL: return `${lhs} >= ${rhs}`;
        case GSAlphaCompareMode.GREATER: return `${lhs} > ${rhs}`;
        case GSAlphaCompareMode.NOTEQUAL: return `${lhs} != ${rhs}`;
        }
    }

    private generateAlphaTest(ate: boolean, atst: GSAlphaCompareMode, aref: number, afail: GSAlphaFailMode): string {
        // TODO(jstpierre): What to do about afail?

        const floatRef = aref / 0xFF;
        const cmp = this.generateAlphaCompareOp(atst, `t_Color.a`, floatRef.toFixed(5));

        if (ate && afail === 0x00) {
            return `
    if (!(${cmp}))
        discard;
`;
        } else {
            return '';
        }
    }

    private generateFrag(gsConfiguration: GSConfiguration): string {
        const tfx: GSTextureFunction = (gsConfiguration.tex0_1_data1 >>> 3) & 0x03;
        assert(tfx === GSTextureFunction.MODULATE);

        // Contains depth & alpha test settings.
        const ate = !!((gsConfiguration.test_1_data0 >>> 0) & 0x01);
        const atst = (gsConfiguration.test_1_data0 >>> 1) & 0x07;
        const aref = (gsConfiguration.test_1_data0 >>> 4) & 0xFF;
        const afail = (gsConfiguration.test_1_data0 >>> 12) & 0x03;
        const date = !!((gsConfiguration.test_1_data0 >>> 14) & 0x01);
        const datm = !!((gsConfiguration.test_1_data0 >>> 15) & 0x01);

        return `
${KatamariDamacyProgram.reflectionDeclarations}
void main() {
    vec4 t_Color = vec4(1.0);

    t_Color = texture(u_Texture[0], v_TexCoord);
    t_Color.rgba *= u_Color.rgba;

    // Basic fake directional.
    vec3 t_LightDirection = normalize(vec3(0.8, -1, 0.5));
    float t_LightIntensity = max(dot(-v_Normal, t_LightDirection), 0.0);
    t_Color.rgb *= mix(0.7, 1.0, t_LightIntensity);

${this.generateAlphaTest(ate, atst, aref, afail)}

    gl_FragColor = t_Color;
}
`;
    }
}

export class BINModelData {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;

    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, public binModel: BINModel) {
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.binModel.vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, this.binModel.indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: KatamariDamacyProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0*4, format: GfxFormat.F32_RGB, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: KatamariDamacyProgram.a_Normal,   bufferIndex: 0, bufferByteOffset: 3*4, format: GfxFormat.F32_RGB, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: KatamariDamacyProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 6*4, format: GfxFormat.F32_RG,  frequency: GfxVertexAttributeFrequency.PER_VERTEX },
        ];
        const indexBufferFormat = GfxFormat.U16_R;

        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, indexBufferFormat });

        const VERTEX_STRIDE = 3+3+2;
        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, byteStride: VERTEX_STRIDE*4 },
        ], { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0x02 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

enum CLAMP1_WM {
    REPEAT, CLAMP, REGION_CLAMP, REGION_REPEAT,
}

function translateWrapMode(wm: CLAMP1_WM): GfxWrapMode {
    switch (wm) {
    case CLAMP1_WM.REPEAT: return GfxWrapMode.REPEAT;
    case CLAMP1_WM.CLAMP: return GfxWrapMode.CLAMP;
    // TODO(jstpierre): Support REGION_* clamp modes.
    case CLAMP1_WM.REGION_REPEAT: return GfxWrapMode.REPEAT;
    default: throw "whoops";
    }
}

function translateDepthCompareMode(cmp: GSDepthCompareMode): GfxCompareMode {
    switch (cmp) {
    case GSDepthCompareMode.NEVER: return GfxCompareMode.NEVER;
    case GSDepthCompareMode.ALWAYS: return GfxCompareMode.ALWAYS;
    // We use a LESS-style depth buffer.
    case GSDepthCompareMode.GEQUAL: return GfxCompareMode.LEQUAL;
    case GSDepthCompareMode.GREATER: return GfxCompareMode.LESS;
    }
}

export class BINModelPartInstance {
    public renderInst: GfxRenderInst;
    private gfxSampler: GfxSampler;

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, textureHolder: KatamariDamacyTextureHolder, public binModelPart: BINModelPart) {
        this.renderInst = renderInstBuilder.pushRenderInst();
        this.renderInst.drawIndexes(this.binModelPart.indexCount, this.binModelPart.indexOffset);

        const gsConfiguration = this.binModelPart.gsConfiguration;

        const program = new KatamariDamacyProgram(gsConfiguration);
        this.renderInst.setDeviceProgram(program);

        const zte = !!((gsConfiguration.test_1_data0 >>> 16) & 0x01);
        assert(zte);

        const ztst: GSDepthCompareMode = (gsConfiguration.test_1_data0 >>> 17) & 0x03;
        this.renderInst.setMegaStateFlags({
            depthCompare: translateDepthCompareMode(ztst),
        });

        renderInstBuilder.newUniformBufferInstance(this.renderInst, KatamariDamacyProgram.ub_ModelParams);

        const textureMapping = nArray(1, () => new TextureMapping());
        if (this.binModelPart.textureName !== null)
            textureHolder.fillTextureMapping(textureMapping[0], this.binModelPart.textureName);
        this.renderInst.setSamplerBindingsFromTextureMappings(textureMapping);

        const wms = (gsConfiguration.clamp_1_data0 >>> 0) & 0x03;
        const wmt = (gsConfiguration.clamp_1_data0 >>> 2) & 0x03;

        // TODO(jstpierre): Read this from TEX_1 / CLAMP_1.
        this.gfxSampler = device.createSampler({
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            wrapS: translateWrapMode(wms),
            wrapT: translateWrapMode(wmt),
            minLOD: 1, maxLOD: 1,
        });
    }

    public prepareToRender(modelParamsBuffer: GfxRenderBuffer, modelViewMatrix: mat4, modelMatrix: mat4, visible: boolean): void {
        this.renderInst.visible = visible;

        if (visible) {
            let offs = this.renderInst.getUniformBufferOffset(KatamariDamacyProgram.ub_ModelParams);
            const mapped = modelParamsBuffer.mapBufferF32(offs, 16);
            offs += fillMatrix4x3(mapped, offs, modelViewMatrix);
            offs += fillMatrix4x3(mapped, offs, modelMatrix);
            offs += fillColor(mapped, offs, this.binModelPart.diffuseColor);
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroySampler(this.gfxSampler);
    }
}

const scratchMat4 = mat4.create();
const posScaleMatrix = mat4.fromScaling(mat4.create(), [5, 5, 5]);
export class BINModelInstance {
    public templateRenderInst: GfxRenderInst;
    public modelMatrix: mat4 = mat4.create();
    public modelParts: BINModelPartInstance[] = [];
    public visible = true;

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, textureHolder: KatamariDamacyTextureHolder, public binModelData: BINModelData, public layer = -1) {
        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        this.templateRenderInst.inputState = this.binModelData.inputState;

        this.templateRenderInst.setMegaStateFlags({
            cullMode: GfxCullMode.BACK,
        });

        mat4.rotateX(this.modelMatrix, this.modelMatrix, Math.PI);

        for (let i = 0; i < this.binModelData.binModel.modelParts.length; i++)
            this.modelParts.push(new BINModelPartInstance(device, renderInstBuilder, textureHolder, this.binModelData.binModel.modelParts[i]));

        renderInstBuilder.popTemplateRenderInst();
    }

    public prepareToRender(modelParamsBuffer: GfxRenderBuffer, viewRenderer: Viewer.ViewerRenderInput) {
        computeViewMatrix(scratchMat4, viewRenderer.camera);
        mat4.mul(scratchMat4, scratchMat4, posScaleMatrix);
        mat4.mul(scratchMat4, scratchMat4, this.modelMatrix);

        for (let i = 0; i < this.modelParts.length; i++)
            this.modelParts[i].prepareToRender(modelParamsBuffer, scratchMat4, this.modelMatrix, this.visible);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.modelParts.length; i++)
            this.modelParts[i].destroy(device);
    }
}

function fillSceneParamsData(d: Float32Array, camera: Camera, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

function textureToCanvas(texture: BINTexture): Viewer.Texture {
    const canvas = document.createElement("canvas");
    const width = texture.width;
    const height = texture.height;
    const name = texture.name;
    canvas.width = width;
    canvas.height = height;
    canvas.title = name;

    const context = canvas.getContext("2d");
    const imgData = context.createImageData(canvas.width, canvas.height);
    imgData.data.set(texture.pixels);
    context.putImageData(imgData, 0, 0);
    const surfaces = [canvas];

    const extraInfo = new Map<string, string>();
    const psm: GSPixelStorageFormat = (texture.tex0_data0 >>> 20) & 0x3F;
    extraInfo.set('Format', psmToString(psm));

    return { name: name, surfaces, extraInfo };
}

class KatamariDamacyTextureHolder extends TextureHolder<BINTexture> {
    public addBINTexture(device: GfxDevice, bin: ModelSector) {
        this.addTextures(device, bin.textures);
    }

    public loadTexture(device: GfxDevice, texture: BINTexture): LoadedTexture {
        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA,
            width: texture.width, height: texture.height, depth: 1, numLevels: 1,
        });
        device.setResourceName(gfxTexture, texture.name);
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [texture.pixels]);
        device.submitPass(hostAccessPass);

        const viewerTexture: Viewer.Texture = textureToCanvas(texture);
        return { gfxTexture, viewerTexture };
    }
}

export class KatamariDamacyRenderer extends BasicRendererHelper implements Viewer.SceneGfx {
    private sceneParamsBuffer: GfxRenderBuffer;
    private modelParamsBuffer: GfxRenderBuffer;
    private templateRenderInst: GfxRenderInst;
    public renderInstBuilder: GfxRenderInstBuilder;
    public modelData: BINModelData[] = [];
    public modelInstances: BINModelInstance[] = [];
    public textureHolder = new KatamariDamacyTextureHolder();

    constructor(device: GfxDevice) {
        super();
        this.sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
        this.modelParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_ModelParams`);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0 }, // Scene
            { numUniformBuffers: 1, numSamplers: 1 }, // Shape
        ];
        const uniformBuffers = [ this.sceneParamsBuffer, this.modelParamsBuffer ];

        this.renderInstBuilder = new GfxRenderInstBuilder(device, KatamariDamacyProgram.programReflection, bindingLayouts, uniformBuffers);

        this.templateRenderInst = this.renderInstBuilder.pushTemplateRenderInst();
        this.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, KatamariDamacyProgram.ub_SceneParams);
    }

    public finish(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        this.renderInstBuilder.popTemplateRenderInst();
        this.renderInstBuilder.finish(device, viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(20, 600000);
        let offs = this.templateRenderInst.getUniformBufferOffset(KatamariDamacyProgram.ub_SceneParams);
        const sceneParamsMapped = this.sceneParamsBuffer.mapBufferF32(offs, 16);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, offs);

        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(this.modelParamsBuffer, viewerInput);

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.modelParamsBuffer.prepareToRender(hostAccessPass);
    }

    public createPanels(): UI.Panel[] {
        return [];
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.textureHolder.destroy(device);
        this.sceneParamsBuffer.destroy(device);
        this.modelParamsBuffer.destroy(device);

        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}
