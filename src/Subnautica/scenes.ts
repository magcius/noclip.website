import * as Viewer from '../viewer';
import { DeviceProgram } from '../Program';
import { SceneContext } from '../SceneBase';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxDevice, GfxBuffer, GfxInputState, GfxProgram, GfxBindingLayoutDescriptor } from '../gfx/platform/GfxPlatform';
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { mat4, vec3 } from 'gl-matrix';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { UnityAssetManager, MeshMetadata, UnityMesh, UnityChannel } from '../Common/Unity/AssetManager';
import { AABB } from '../Geometry';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';

class ChunkProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_ShapeParams = 1;

    public override both = `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x4 u_ModelView;
};

layout(std140) uniform ub_ShapeParams {
    Mat4x4 u_ChunkModel;
};

varying vec2 v_LightIntensity;

#ifdef VERT
layout(location = ${UnityChannel.Vertex}) attribute vec3 a_Position;
layout(location = ${UnityChannel.Normal}) attribute vec3 a_Normal;

void mainVS() {
    gl_Position = Mul(u_Projection, Mul(u_ModelView, Mul(u_ChunkModel, vec4(a_Position, 1.0))));
    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    vec3 normal = normalize(a_Normal);
    float t_LightIntensityF = dot(-normal, t_LightDirection);
    float t_LightIntensityB = dot( normal, t_LightDirection);
    v_LightIntensity = vec2(t_LightIntensityF, t_LightIntensityB);
}
#endif

#ifdef FRAG
void mainPS() {
    vec4 color = vec4(.4, .4, .4, 1.0);
    float t_LightIntensity = gl_FrontFacing ? v_LightIntensity.x : v_LightIntensity.y;
    float t_LightTint = 0.5 * t_LightIntensity;
    gl_FragColor = sqrt(color + vec4(t_LightTint, t_LightTint, t_LightTint, 0.0));
}
#endif
`;
}

// big blocky scaley
const CHUNK_SCALE = 32;

class MeshRenderer {
    public normsBuf: GfxBuffer;
    public vertsBuf: GfxBuffer;
    public trisBuf: GfxBuffer;
    public numVertices: number;

    constructor(device: GfxDevice, public mesh: UnityMesh, public modelMatrix: mat4) {
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const bbox = new AABB();
        bbox.transform(this.mesh.bbox, this.modelMatrix);
        if (!viewerInput.camera.frustum.contains(bbox)) {
            return;
        }

        const template = renderInstManager.pushTemplateRenderInst();

        let offs = template.allocateUniformBuffer(ChunkProgram.ub_ShapeParams, 16);
        const mapped = template.mapUniformBufferF32(ChunkProgram.ub_ShapeParams);
        offs += fillMatrix4x4(mapped, offs, this.modelMatrix);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.mesh.inputLayout, this.mesh.inputState);
        renderInst.drawIndexes(this.mesh.numIndices);
        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice) {
        this.mesh.destroy(device);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 0 }, // ub_SceneParams
];

class SubnauticaRenderer implements Viewer.SceneGfx {
    public inputState: GfxInputState;
    public scaleFactor = 20;
    private meshRenderers: MeshRenderer[];
    private renderHelper: GfxRenderHelper;
    public program: GfxProgram;

    constructor(public device: GfxDevice) {
        this.meshRenderers = [];
        this.renderHelper = new GfxRenderHelper(device);
        this.program = this.renderHelper.renderCache.createProgram(new ChunkProgram());
    }

    addMesh(mesh: UnityMesh, offset: vec3) {
        let model = mat4.create();
        let scaling = vec3.fromValues(this.scaleFactor, this.scaleFactor, this.scaleFactor);
        mat4.fromScaling(model, scaling);
        mat4.translate(model, model, offset);
        this.meshRenderers.push(new MeshRenderer(this.device, mesh, model));
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setGfxProgram(this.program);

        let offs = template.allocateUniformBuffer(ChunkProgram.ub_SceneParams, 32);
        const mapped = template.mapUniformBufferF32(ChunkProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.viewMatrix);

        for (let i = 0; i < this.meshRenderers.length; i++)
            this.meshRenderers[i].prepareToRender(this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice) {
        this.meshRenderers.forEach((r) => r.destroy(device));
        this.renderHelper.destroy();
    }
}

function parseOffset(chunkId: string): vec3 {
    let bits = chunkId.split('-');
    return vec3.fromValues(
        parseInt(bits[1]) * CHUNK_SCALE,
        parseInt(bits[2]) * CHUNK_SCALE,
        parseInt(bits[3]) * CHUNK_SCALE,
    );
}

class SubnauticaSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const renderer = new SubnauticaRenderer(device);
        const chunks: MeshMetadata[] = await context.dataFetcher.fetchData('subnautica/chunks.json')
            .then(data => {
                let decoder = new TextDecoder();
                return JSON.parse(decoder.decode(data.arrayBuffer as ArrayBuffer)).chunks;
            });
        let assets = new UnityAssetManager('subnautica/resources.assets', context, device);
        await assets.loadAssetInfo();

        chunks.forEach(chunk => {
            let offset = parseOffset(chunk.name);
            assets.loadMesh(chunk).then(mesh => {
                renderer.addMesh(mesh, offset);
            });
        });

        return renderer;
    }

}

const id = 'Subnautica';
const name = 'Subnautica';

const sceneDescs = [
    new SubnauticaSceneDesc("Scanner Map", "Scanner Map"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, hidden: true };