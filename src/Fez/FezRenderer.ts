
import { DeviceProgram } from "../Program";
import * as Viewer from '../viewer';
import { GfxDevice, GfxRenderPass, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxMegaStateDescriptor, GfxCullMode, GfxFrontFaceMode, GfxBlendMode, GfxBlendFactor, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from "../gfx/platform/GfxPlatform";
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { fillMatrix4x4, fillMatrix4x3, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { mat4, vec3, quat, vec2 } from "gl-matrix";
import { computeViewMatrix } from "../Camera";
import { nArray, assert, assertExists } from "../util";
import { TextureMapping } from "../TextureHolder";
import { MathConstants } from "../MathHelpers";
import { TrilesetData, TrileData } from "./TrileData";
import { ArtObjectData } from "./ArtObjectData";
import { BackgroundPlaneData, BackgroundPlaneStaticData } from "./BackgroundPlaneData";
import { parseVector3, parseQuaternion } from "./DocumentHelpers";
import { AABB } from "../Geometry";

class FezProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_ShapeParams = 1;

    public both = `
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_ShapeParams {
    Mat4x3 u_BoneMatrix[1];
    vec4 u_TexScaleBiasPre;
    vec4 u_TexScaleBiasPost;
};
`;

    public vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec2 a_TexCoord;

out vec2 v_TexCoord;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_TexCoord = a_TexCoord.xy * u_TexScaleBiasPre.xy + u_TexScaleBiasPre.zw;
}
`;

    public frag = `
in vec2 v_TexCoord;

uniform sampler2D u_Texture[1]; 
void main() {
    vec2 t_TexCoord = mod(v_TexCoord, vec2(1.0, 1.0));
    t_TexCoord = t_TexCoord.xy * u_TexScaleBiasPost.xy + u_TexScaleBiasPost.zw;
    gl_FragColor = texture(u_Texture[0], t_TexCoord.xy);
}
`;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1, },
];

const modelViewScratch = mat4.create();

const gc_orientations = [180, 270, 0, 90];

export class FezRenderer implements Viewer.SceneGfx {
    private program: FezProgram;
    private renderTarget = new BasicRenderTarget();
    private renderHelper: GfxRenderHelper;
    private modelMatrix: mat4 = mat4.create();
    private backgroundPlaneStaticData: BackgroundPlaneStaticData;
    public trileRenderers: FezObjectRenderer[] = [];
    public artObjectRenderers: FezObjectRenderer[] = [];
    public backgroundPlaneRenderers: BackgroundPlaneRenderer[] = [];

    constructor(device: GfxDevice, levelDocument: Document, public trilesetData: TrilesetData, public artObjectDatas: ArtObjectData[], public backgroundPlaneDatas: BackgroundPlaneData[]) {
        this.renderHelper = new GfxRenderHelper(device);
        this.program = new FezProgram();

        mat4.fromScaling(this.modelMatrix, [50, 50, 50]);

        const trileInstances = levelDocument.querySelectorAll('TrileInstance');
        for(var i = 0; i < trileInstances.length; i++) {
            const trileId = Number(trileInstances[i].getAttribute('trileId'));

            // No clue WTF this means. Seen in globe.xml.
            if (trileId < 0)
                continue;

            const position = parseVector3(trileInstances[i].querySelector('Position Vector3')!);
            const orientation = Number(trileInstances[i].getAttribute('orientation'));
            const rotateY = gc_orientations[orientation] * MathConstants.DEG_TO_RAD;

            const trileData = this.trilesetData.triles.find((trileData) => trileData.key === trileId)!;

            const trileRenderer = new FezObjectRenderer(trileData);
            mat4.translate(trileRenderer.modelMatrix, trileRenderer.modelMatrix, position);
            mat4.rotateY(trileRenderer.modelMatrix, trileRenderer.modelMatrix, rotateY);
            mat4.mul(trileRenderer.modelMatrix, this.modelMatrix, trileRenderer.modelMatrix);
            this.trileRenderers.push(trileRenderer);
        }

        const artObjectInstances = levelDocument.querySelectorAll('ArtObjects Entry ArtObjectInstance');
        for (let i = 0; i < artObjectInstances.length; i++) {
            const artObjectName = artObjectInstances[i].getAttribute('name')!.toLowerCase();
            const artObjectData = assertExists(this.artObjectDatas.find((artObject) => artObject.name === artObjectName));

            const position = parseVector3(artObjectInstances[i].querySelector('Position Vector3')!);
            // All art objects seem to have this offset applied to them for some reason?
            position[0] -= 0.5;
            position[1] -= 0.5;
            position[2] -= 0.5;

            const rotation = parseQuaternion(artObjectInstances[i].querySelector('Rotation Quaternion')!);
            const rotationMatrix = mat4.create();
            mat4.fromQuat(rotationMatrix, rotation);

            const scale = parseVector3(artObjectInstances[i].querySelector('Scale Vector3')!);

            const renderer = new FezObjectRenderer(artObjectData);
            mat4.translate(renderer.modelMatrix, renderer.modelMatrix, position);
            mat4.mul(renderer.modelMatrix, renderer.modelMatrix, rotationMatrix);
            mat4.mul(renderer.modelMatrix, this.modelMatrix, renderer.modelMatrix);
            mat4.scale(renderer.modelMatrix, renderer.modelMatrix, scale);
            this.artObjectRenderers.push(renderer);
        }

        this.backgroundPlaneStaticData = new BackgroundPlaneStaticData(device);

        const backgroundPlanes = levelDocument.querySelectorAll('BackgroundPlanes Entry BackgroundPlane');
        for (let i = 0; i < backgroundPlanes.length; i++) {
            const backgroundPlaneName = backgroundPlanes[i].getAttribute('textureName')!.toLowerCase();
            const backgroundPlaneData = assertExists(this.backgroundPlaneDatas.find((bp) => bp.name === backgroundPlaneName));
            const renderer = new BackgroundPlaneRenderer(device, backgroundPlanes[i], backgroundPlaneData, this.backgroundPlaneStaticData);
            mat4.mul(renderer.modelMatrix, this.modelMatrix, renderer.modelMatrix);
            this.backgroundPlaneRenderers.push(renderer);
        }
    }
    
    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput, renderInstManager: GfxRenderInstManager) {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        const gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);
        template.setGfxProgram(gfxProgram);

        let offs = template.allocateUniformBuffer(FezProgram.ub_SceneParams, 16);
        const d = template.mapUniformBufferF32(FezProgram.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.trileRenderers.length; i++)
            this.trileRenderers[i].prepareToRender(renderInstManager, viewerInput);
        for (let i = 0; i < this.artObjectRenderers.length; i++)
            this.artObjectRenderers[i].prepareToRender(renderInstManager, viewerInput);
        for (let i = 0; i < this.backgroundPlaneRenderers.length; i++)
            this.backgroundPlaneRenderers[i].prepareToRender(renderInstManager, viewerInput);

        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        const renderInstManager = this.renderHelper.renderInstManager;

        this.prepareToRender(device, hostAccessPass, viewerInput, renderInstManager);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        const passRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        passRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.trilesetData.destroy(device);
        for (let i = 0; i < this.artObjectDatas.length; i++)
            this.artObjectDatas[i].destroy(device);
        for (let i = 0; i < this.backgroundPlaneDatas.length; i++)
            this.backgroundPlaneDatas[i].destroy(device);
        for (let i = 0; i < this.backgroundPlaneRenderers.length; i++)
            this.backgroundPlaneRenderers[i].destroy(device);
        this.backgroundPlaneStaticData.destroy(device);

        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
    }
}

type FezObjectData = TrileData | ArtObjectData;

const texMatrixScratch = mat4.create();
const bboxScratch = new AABB();
export class FezObjectRenderer {
    public modelMatrix = mat4.create();
    public textureMatrix = mat4.create();
    private textureMapping = nArray(1, () => new TextureMapping());
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};

    constructor(private data: FezObjectData) {
        this.textureMapping[0].gfxTexture = this.data.texture;
        this.textureMapping[0].gfxSampler = this.data.sampler;

        this.megaStateFlags.frontFace = GfxFrontFaceMode.CW;
        this.megaStateFlags.cullMode = GfxCullMode.BACK;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        bboxScratch.transform(this.data.bbox, this.modelMatrix);
        if (!viewerInput.camera.frustum.contains(bboxScratch))
            return;

        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setInputLayoutAndState(this.data.inputLayout, this.data.inputState);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(FezProgram.ub_ShapeParams, 12+4+4);
        const d = renderInst.mapUniformBufferF32(FezProgram.ub_ShapeParams);
        computeViewMatrix(modelViewScratch, viewerInput.camera);
        mat4.mul(modelViewScratch, modelViewScratch, this.modelMatrix);
        offs += fillMatrix4x3(d, offs, modelViewScratch);
        offs += fillVec4(d, offs, 1, 1, 0, 0);
        offs += fillVec4(d, offs, 1, 1, 0, 0);

        renderInst.drawIndexes(this.data.indexCount);
    }
}

function parseBoolean(str: string): boolean {
    if (str === 'True')
        return true;
    else if (str === 'False')
        return false;
    else
        throw "whoops";
}

const scratchVec3 = vec3.create();
export class BackgroundPlaneRenderer {
    public modelMatrix = mat4.create();
    private textureMapping = nArray(1, () => new TextureMapping());
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private rawScale = vec2.create();
    private xTextureRepeat = false;
    private yTextureRepeat = false;
    private clampTexture = false;
    private sampler: GfxSampler;

    constructor(device: GfxDevice, private planeEl: Element, private planeData: BackgroundPlaneData, private staticData: BackgroundPlaneStaticData) {
        const position = parseVector3(planeEl.querySelector('Position Vector3')!);
        position[0] -= 0.5;
        position[1] -= 0.5;
        position[2] -= 0.5;

        const rotation = parseQuaternion(planeEl.querySelector('Rotation Quaternion')!);
        const rotationMatrix = mat4.create();
        mat4.fromQuat(rotationMatrix, rotation);

        // Offset just a bit to prevent Z fighting.
        vec3.set(scratchVec3, 0, 0, 1);
        vec3.transformMat4(scratchVec3, scratchVec3, rotationMatrix);
        vec3.scaleAndAdd(position, position, scratchVec3, 0.005);

        const scale = parseVector3(planeEl.querySelector('Scale Vector3')!);
        vec2.set(this.rawScale, scale[0], scale[1]);

        mat4.translate(this.modelMatrix, this.modelMatrix, position);
        const scaleX = this.planeData.dimensions[0] / 16;
        const scaleY = this.planeData.dimensions[1] / 16;
        mat4.mul(this.modelMatrix, this.modelMatrix, rotationMatrix);
        mat4.scale(this.modelMatrix, this.modelMatrix, scale);
        mat4.scale(this.modelMatrix, this.modelMatrix, [scaleX, scaleY, 1]);

        this.megaStateFlags.frontFace = GfxFrontFaceMode.CW;

        const doubleSided = parseBoolean(planeEl.getAttribute('doubleSided')!);
        if (doubleSided)
            this.megaStateFlags.cullMode = GfxCullMode.NONE;
        else
            this.megaStateFlags.cullMode = GfxCullMode.BACK;

        this.xTextureRepeat = parseBoolean(planeEl.getAttribute('xTextureRepeat')!);
        this.yTextureRepeat = parseBoolean(planeEl.getAttribute('yTextureRepeat')!);
        this.clampTexture = parseBoolean(planeEl.getAttribute('clampTexture')!);

        this.megaStateFlags.blendMode = GfxBlendMode.ADD;
        this.megaStateFlags.blendSrcFactor = GfxBlendFactor.SRC_ALPHA;
        this.megaStateFlags.blendDstFactor = GfxBlendFactor.ONE_MINUS_SRC_ALPHA;

        this.sampler = device.createSampler({
            wrapS: this.xTextureRepeat ? GfxWrapMode.REPEAT : GfxWrapMode.CLAMP,
            wrapT: this.yTextureRepeat ? GfxWrapMode.REPEAT : GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });

        this.textureMapping[0].gfxTexture = this.planeData.texture;
        this.textureMapping[0].gfxSampler = this.sampler;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        const renderInst = renderInstManager.pushTemplateRenderInst();
        renderInst.setInputLayoutAndState(this.staticData.inputLayout, this.staticData.inputState);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(FezProgram.ub_ShapeParams, 12+8);
        const d = renderInst.mapUniformBufferF32(FezProgram.ub_ShapeParams);
        computeViewMatrix(modelViewScratch, viewerInput.camera);
        mat4.mul(modelViewScratch, modelViewScratch, this.modelMatrix);
        offs += fillMatrix4x3(d, offs, modelViewScratch);
        const timeInSeconds = viewerInput.time / 1000;
        this.planeData.calcTexMatrix(texMatrixScratch, timeInSeconds);

        offs += fillVec4(d, offs, this.rawScale[0], this.rawScale[1], 0, 0);
        offs += fillVec4(d, offs, texMatrixScratch[0], texMatrixScratch[5], texMatrixScratch[12], texMatrixScratch[13]);

        renderInst.drawIndexes(this.staticData.indexCount);
    }

    public destroy(device: GfxDevice): void {
        device.destroySampler(this.sampler);
    }
}
