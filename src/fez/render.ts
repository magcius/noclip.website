import { DeviceProgram } from "../Program";
import * as Viewer from '../viewer';
import { GfxDevice, GfxRenderPass, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxSampler } from "../gfx/platform/GfxPlatform";
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { TrilesetData, TrileData } from "./trile";
import { fillMatrix4x4, fillMatrix4x3 } from "../gfx/helpers/UniformBufferHelpers";
import { mat4, vec3, quat } from "gl-matrix";
import { computeViewMatrix } from "../Camera";
import { nArray } from "../util";
import { TextureMapping } from "../TextureHolder";
import { MathConstants } from "../MathHelpers";
import { ArtObjectSetData, ArtObjectData } from "./artobject";

const gc_orientations = [180, 270, 0, 90];

class FezProgram extends DeviceProgram {

    public static ub_SceneParams = 0;
    public static ub_ShapeParams = 1;

    vert = `layout(row_major, std140) uniform ub_SceneParams {
        Mat4x4 u_Projection;
    };
    
    layout(row_major, std140) uniform ub_ShapeParams {
        Mat4x3 u_BoneMatrix[1];
    };

    layout(location = 0) in vec3 a_Position;
    layout(location = 1) in vec2 a_TexCoord;
    
    out vec2 v_TexCoord;
    
    void main() {
        gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
        v_TexCoord = a_TexCoord;
    }`
    frag = `
    in vec2 v_TexCoord;

    uniform sampler2D u_Texture[1]; 
    void main() {
        gl_FragColor = texture(u_Texture[0], v_TexCoord.xy);
    }
    `
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1, },
];

const modelViewScratch = mat4.create();

export class FezRenderer implements Viewer.SceneGfx {
    fez_parser: DOMParser;
    private program: FezProgram;
    private renderTarget = new BasicRenderTarget();
    private renderHelper: GfxRenderHelper;
    public trileset: TrilesetData;
    public aoset: ArtObjectSetData;
    private device: GfxDevice;
    public clearRenderPassDescriptor = standardFullClearRenderPassDescriptor;
    public trileRenderers: TrileRenderer[] = [];
    public AORenderers: ArtObjectRenderer[] = [];

    public visible: boolean = true;

    constructor(device: GfxDevice, file: Document, trileFile: Document, trilesetTex: ImageData, aoXmlFiles: Document[], aoSetTex: ImageData[]) {
        this.fez_parser = new DOMParser();
        this.trileset = new TrilesetData(device,trileFile,trilesetTex);
        this.aoset = new ArtObjectSetData(device, aoXmlFiles, aoSetTex);
        this.renderHelper = new GfxRenderHelper(device);
        this.device = device;
        this.program = new FezProgram();

        let xmlTrileInstance = file.getElementsByTagName('TrileInstance');
        for(var i = 0; i < xmlTrileInstance.length; i++) {
            let trileID = Number(xmlTrileInstance[i].getAttribute('trileId'));
            let trileOrient = Number(xmlTrileInstance[i].getAttribute('orientation'));
            let xmlTrilePos = xmlTrileInstance[i].getElementsByTagName('Vector3');
            let trilePos = vec3.fromValues(Number(xmlTrilePos[0].getAttribute('x')),Number(xmlTrilePos[0].getAttribute('y')),Number(xmlTrilePos[0].getAttribute('z')));

            const trileData = this.trileset.trilesetArray.find((trileData) => trileData.key === trileID)!;
            const trileRenderer = new TrileRenderer(device, trileData);

            mat4.translate(trileRenderer.modelMatrix, trileRenderer.modelMatrix, trilePos);
            mat4.rotateY(trileRenderer.modelMatrix, trileRenderer.modelMatrix, gc_orientations[trileOrient] * MathConstants.DEG_TO_RAD);
            this.trileRenderers.push(trileRenderer);
        }
        let xmlAOInstance = file.getElementsByTagName('ArtObjectInstance');
        for(var i = 0; i < xmlAOInstance.length; i++) {
            let xmlAOPos = xmlAOInstance[i].querySelectorAll('Position Vector3');
            let xmlAORot = xmlAOInstance[i].querySelectorAll('Rotation Quaternion');
            let aoPos = vec3.fromValues(Number(xmlAOPos[0].getAttribute('x')),Number(xmlAOPos[0].getAttribute('y')),Number(xmlAOPos[0].getAttribute('z')));
            let aoRotQuat = quat.fromValues(Number(xmlAORot[0].getAttribute('x')),Number(xmlAORot[0].getAttribute('y')),Number(xmlAORot[0].getAttribute('z')),Number(xmlAORot[0].getAttribute('w')));
            let aoRot = mat4.create();
            mat4.fromQuat(aoRot,aoRotQuat);

            const aoData = this.aoset.aoArray[i];
            const aoRenderer = new ArtObjectRenderer(device, aoData);

            mat4.translate(aoRenderer.modelMatrix, aoRenderer.modelMatrix, aoPos);
            mat4.mul(aoRenderer.modelMatrix, aoRenderer.modelMatrix, aoRot);
            this.AORenderers.push(aoRenderer);
        }
    }
    
    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput, renderInstManager: GfxRenderInstManager) {
        if (!this.visible) {
            return;
        }
        
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        const gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.device, this.program);
        template.setGfxProgram(gfxProgram);
        let sc_offs = template.allocateUniformBuffer(FezProgram.ub_SceneParams, 16);
        const sc_mappedF32 = template.mapUniformBufferF32(FezProgram.ub_SceneParams);
        sc_offs += fillMatrix4x4(sc_mappedF32, sc_offs, viewerInput.camera.projectionMatrix);

        for(var i = 0; i < this.trileRenderers.length; i++) {
            this.trileRenderers[i].prepareToRender(device, hostAccessPass, viewerInput, renderInstManager)
        }

        for(var i = 0; i < this.AORenderers.length; i++) {
            this.AORenderers[i].prepareToRender(device, hostAccessPass, viewerInput, renderInstManager)
        }

        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        const renderInstManager = this.renderHelper.renderInstManager;

        this.prepareToRender(device, hostAccessPass, viewerInput, renderInstManager);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        const passRenderer = this.renderTarget.createRenderPass(device, this.clearRenderPassDescriptor);
        passRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        for(var i = 0; i < this.trileset.trilesetArray.length; i++) {
            this.trileset.trilesetArray[i].destroy(device); 
        }
        for(var i = 0; i < this.trileRenderers.length; i++) {
            device.destroySampler(this.trileRenderers[i].textureMapping[0].gfxSampler!);
        }
        for(var i = 0; i < this.aoset.aoArray.length; i++) {
            this.aoset.aoArray[i].destroy(device);
        }
        for(var i = 0; i < this.AORenderers.length; i++) {
            device.destroySampler(this.AORenderers[i].textureMapping[0].gfxSampler!);
        }
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
    }
}

export class TrileRenderer {
    public modelMatrix = mat4.create();
    public textureMapping = nArray(1, () => new TextureMapping())

    constructor(device: GfxDevice, private trileData: TrileData) {
        this.textureMapping[0].gfxTexture = this.trileData.texture;
        this.textureMapping[0].gfxSampler = this.translateSampler(device);
    }

    private translateSampler(device: GfxDevice): GfxSampler {
        return device.createSampler({
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput, renderInstManager: GfxRenderInstManager) {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.trileData.inputLayout,this.trileData.inputState);
        template.setSamplerBindingsFromTextureMappings(this.textureMapping);

        let sh_offs = template.allocateUniformBuffer(FezProgram.ub_ShapeParams, 12);
        const sh_mappedF32 = template.mapUniformBufferF32(FezProgram.ub_ShapeParams);
        computeViewMatrix(modelViewScratch, viewerInput.camera);
        mat4.mul(modelViewScratch, modelViewScratch, this.modelMatrix);
        sh_offs += fillMatrix4x3(sh_mappedF32, sh_offs, modelViewScratch);

        let renderInst = renderInstManager.pushRenderInst();

        renderInstManager.popTemplateRenderInst();

        renderInst.drawIndexes(this.trileData.indexCount);
    }
}
export class ArtObjectRenderer {
    public modelMatrix = mat4.create();
    public textureMapping = nArray(1, () => new TextureMapping())

    constructor(device: GfxDevice, private aoData: ArtObjectData) {
        this.textureMapping[0].gfxTexture = this.aoData.aoTex;
        this.textureMapping[0].gfxSampler = this.translateSampler(device);
    }

    private translateSampler(device: GfxDevice): GfxSampler {
        return device.createSampler({
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });
    }
    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput, renderInstManager: GfxRenderInstManager) {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.aoData.inputLayout,this.aoData.inputState);
        template.setSamplerBindingsFromTextureMappings(this.textureMapping);

        let sh_offs = template.allocateUniformBuffer(FezProgram.ub_ShapeParams, 12);
        const sh_mappedF32 = template.mapUniformBufferF32(FezProgram.ub_ShapeParams);
        computeViewMatrix(modelViewScratch, viewerInput.camera);
        mat4.mul(modelViewScratch, modelViewScratch, this.modelMatrix);
        sh_offs += fillMatrix4x3(sh_mappedF32, sh_offs, modelViewScratch);

        let renderInst = renderInstManager.pushRenderInst();

        renderInstManager.popTemplateRenderInst();

        renderInst.drawIndexes(this.aoData.indexCount);
    }
}