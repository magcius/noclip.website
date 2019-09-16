
import { DeviceProgram } from "../Program";
import * as Viewer from '../viewer';
import { GfxDevice, GfxRenderPass, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxMegaStateDescriptor, GfxCullMode, GfxFrontFaceMode } from "../gfx/platform/GfxPlatform";
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { TrilesetData, TrileData } from "./trile";
import { fillMatrix4x4, fillMatrix4x3 } from "../gfx/helpers/UniformBufferHelpers";
import { mat4, vec3, quat } from "gl-matrix";
import { computeViewMatrix } from "../Camera";
import { nArray, assert, assertExists } from "../util";
import { TextureMapping } from "../TextureHolder";
import { MathConstants } from "../MathHelpers";
import { ArtObjectData } from "./artobject";

class FezProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_ShapeParams = 1;

    public vert = `
layout(row_major, std140) uniform ub_SceneParams {
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
}
`;

    public frag = `
in vec2 v_TexCoord;

uniform sampler2D u_Texture[1]; 
void main() {
    gl_FragColor = texture(u_Texture[0], v_TexCoord.xy);
}
`;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1, },
];

const modelViewScratch = mat4.create();

function parseVec3(e: Element): vec3 {
    assert(e.tagName === 'Vector3');
    const x = Number(e.getAttribute('x'));
    const y = Number(e.getAttribute('y'));
    const z = Number(e.getAttribute('z'));
    return vec3.fromValues(x, y, z);
}

function parseQuaternion(e: Element): quat {
    assert(e.tagName === 'Quaternion');
    const x = Number(e.getAttribute('x'));
    const y = Number(e.getAttribute('y'));
    const z = Number(e.getAttribute('z'));
    const w = Number(e.getAttribute('w'));
    return quat.fromValues(x, y, z, w);
}

const gc_orientations = [180, 270, 0, 90];

export class FezRenderer implements Viewer.SceneGfx {
    private program: FezProgram;
    private renderTarget = new BasicRenderTarget();
    private renderHelper: GfxRenderHelper;
    private modelMatrix: mat4 = mat4.create();
    public trileRenderers: FezObjectRenderer[] = [];
    public artObjectRenderers: FezObjectRenderer[] = [];

    constructor(device: GfxDevice, levelDocument: Document, public trilesetData: TrilesetData, public artObjectDatas: ArtObjectData[]) {
        this.renderHelper = new GfxRenderHelper(device);
        this.program = new FezProgram();

        mat4.fromScaling(this.modelMatrix, [50, 50, 50]);

        const xmlTrileInstance = levelDocument.getElementsByTagName('TrileInstance');
        for(var i = 0; i < xmlTrileInstance.length; i++) {
            const trileId = Number(xmlTrileInstance[i].getAttribute('trileId'));

            // No clue WTF this means. Seen in globe.xml.
            if (trileId < 0)
                continue;

            const position = parseVec3(xmlTrileInstance[i].querySelector('Position Vector3')!);
            const orientation = Number(xmlTrileInstance[i].getAttribute('orientation'));
            const rotateY = gc_orientations[orientation] * MathConstants.DEG_TO_RAD;

            const trileData = this.trilesetData.trilesetArray.find((trileData) => trileData.key === trileId)!;
            const trileRenderer = new FezObjectRenderer(trileData);

            mat4.translate(trileRenderer.modelMatrix, trileRenderer.modelMatrix, position);
            mat4.rotateY(trileRenderer.modelMatrix, trileRenderer.modelMatrix, rotateY);
            mat4.mul(trileRenderer.modelMatrix, this.modelMatrix, trileRenderer.modelMatrix);
            this.trileRenderers.push(trileRenderer);
        }

        const artObjectInstances = levelDocument.getElementsByTagName('ArtObjectInstance');
        for (let i = 0; i < artObjectInstances.length; i++) {
            const artObjectName = artObjectInstances[i].getAttribute('name')!.toLowerCase();
            const artObjectData = assertExists(this.artObjectDatas.find((artObject) => artObject.name === artObjectName));

            const position = parseVec3(artObjectInstances[i].querySelector('Position Vector3')!);
            // All art objects seem to have this offset applied to them for some reason?
            position[0] -= 0.5;
            position[1] -= 0.5;
            position[2] -= 0.5;

            const rotation = parseQuaternion(artObjectInstances[i].querySelector('Rotation Quaternion')!);

            const rotationMatrix = mat4.create();
            mat4.fromQuat(rotationMatrix, rotation);
            const aoRenderer = new FezObjectRenderer(artObjectData);

            mat4.translate(aoRenderer.modelMatrix, aoRenderer.modelMatrix, position);
            mat4.mul(aoRenderer.modelMatrix, aoRenderer.modelMatrix, rotationMatrix);
            mat4.mul(aoRenderer.modelMatrix, this.modelMatrix, aoRenderer.modelMatrix);
            this.artObjectRenderers.push(aoRenderer);
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
            this.trileRenderers[i].prepareToRender(viewerInput, renderInstManager);

        for (let i = 0; i < this.artObjectRenderers.length; i++)
            this.artObjectRenderers[i].prepareToRender(viewerInput, renderInstManager);

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

        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
    }
}

type FezObjectData = TrileData | ArtObjectData;

export class FezObjectRenderer {
    public modelMatrix = mat4.create();
    private textureMapping = nArray(1, () => new TextureMapping());
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};

    constructor(private data: FezObjectData) {
        this.textureMapping[0].gfxTexture = this.data.texture;
        this.textureMapping[0].gfxSampler = this.data.sampler;

        this.megaStateFlags.frontFace = GfxFrontFaceMode.CW;
        this.megaStateFlags.cullMode = GfxCullMode.BACK;
    }

    public prepareToRender(viewerInput: Viewer.ViewerRenderInput, renderInstManager: GfxRenderInstManager) {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.data.inputLayout, this.data.inputState);
        template.setSamplerBindingsFromTextureMappings(this.textureMapping);
        template.setMegaStateFlags(this.megaStateFlags);

        let offs = template.allocateUniformBuffer(FezProgram.ub_ShapeParams, 12);
        const d = template.mapUniformBufferF32(FezProgram.ub_ShapeParams);
        computeViewMatrix(modelViewScratch, viewerInput.camera);
        mat4.mul(modelViewScratch, modelViewScratch, this.modelMatrix);
        offs += fillMatrix4x3(d, offs, modelViewScratch);

        const renderInst = renderInstManager.pushRenderInst();
        renderInstManager.popTemplateRenderInst();
        renderInst.drawIndexes(this.data.indexCount);
    }
}
