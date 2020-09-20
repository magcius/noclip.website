
import { SceneGroup, SceneDesc, SceneGfx, ViewerRenderInput } from "../viewer";
import { GfxDevice, GfxRenderPass, GfxHostAccessPass, GfxBindingLayoutDescriptor } from "../gfx/platform/GfxPlatform";
import { SceneContext } from "../SceneBase";
import * as ZipFile from '../ZipFile';
import { Asset_Manager, Asset_Type, Mesh_Asset } from "./Assets";
import { Entity, Entity_Pattern_Point } from "./Entity";
import { drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../DebugJunk";
import { mat4 } from "gl-matrix";
import { DeviceProgram } from "../Program";
import { GfxRenderInstManager, executeOnPass } from "../gfx/render/GfxRenderer";
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";

const id = "TheWitness";
const name = "The Witness";
const pathBase = `TheWitness`;

class Program extends DeviceProgram {
    public static ub_SceneParams = 0;

    public vert = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_ViewProjection;
};
    
layout(location = 0) in vec4 a_Position;

void main() {
    gl_Position = u_ViewProjection * vec4(a_Position.xyz, 1.0);
}
`;

    public frag = `
void main() {
    gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
}
`;
}

class Mesh_Instance {
    private program = new Program();

    constructor(public mesh_asset: Mesh_Asset) {
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setGfxProgram(renderInstManager.gfxRenderCache.createProgram(device, this.program));

        for (let i = 0; i < this.mesh_asset.device_mesh_array.length; i++) {
            const device_mesh = this.mesh_asset.device_mesh_array[i];
            const renderInst = renderInstManager.newRenderInst();
            device_mesh.setOnRenderInst(renderInst);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }
}

const scratchMatrix = mat4.create();
const noclipSpaceFromTheWitnessSpace = mat4.fromValues(
    1, 0,  0, 0,
    0, 0, -1, 0,
    0, 1,  0, 0,
    0, 0,  0, 1,
);

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];

class TheWitnessRenderer implements SceneGfx {
    public renderTarget = new BasicRenderTarget();
    public renderHelper: GfxRenderHelper;

    public mesh_instance_array: Mesh_Instance[] = [];

    constructor(device: GfxDevice, private entities: Entity[]) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        mat4.mul(scratchMatrix, viewerInput.camera.clipFromWorldMatrix, noclipSpaceFromTheWitnessSpace);
        let offs = template.allocateUniformBuffer(Program.ub_SceneParams, 16);
        const d = template.mapUniformBufferF32(Program.ub_SceneParams);
        fillMatrix4x4(d, offs, scratchMatrix);

        for (let i = 0; i < this.mesh_instance_array.length; i++)
            this.mesh_instance_array[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass | null {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor);
        renderInstManager.drawOnPassRenderer(device, mainPassRenderer);

        renderInstManager.resetRenderInsts();

        mat4.mul(scratchMatrix, viewerInput.camera.clipFromWorldMatrix, noclipSpaceFromTheWitnessSpace);
        for (let i = 0; i < this.entities.length; i++) {
            // if (!(this.entities[i] instanceof Entity_Pattern_Point))
            //     continue;
            drawWorldSpacePoint(getDebugOverlayCanvas2D(), scratchMatrix, this.entities[i].position);
        }

        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);
    }
}

class TheWitnessSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const asset_manager = new Asset_Manager(device);
        const zip = ZipFile.parseZipFile(await context.dataFetcher.fetchData(`${pathBase}/data-pc.zip`));
        asset_manager.add_bundle(zip);
        asset_manager.load_asset(Asset_Type.Texture, 'gauge');
        const world = asset_manager.load_asset(Asset_Type.World, 'save');

        const mesh = asset_manager.load_asset(Asset_Type.Mesh, 'end2_eyelidtest_tunnel');

        const r = new TheWitnessRenderer(device, world);
        // r.mesh_instance_array.push(new Mesh_Instance(mesh));
        return r;
    }
}

const sceneDescs = [
    new TheWitnessSceneDesc('main', 'Main'),
]

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
