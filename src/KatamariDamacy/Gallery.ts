
import { mat4 } from 'gl-matrix';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { CameraController, OrbitCameraController } from '../Camera';
import { colorFromHSL, colorNewCopy, White, colorToCSS } from '../Color';
import { gsMemoryMapNew } from '../Common/PS2/GS';
import { BasicRenderTarget, ColorTexture, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { reverseDepthForDepthOffset } from '../gfx/helpers/ReversedDepthHelpers';
import { fillColor, fillVec4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxBindingLayoutDescriptor, GfxDevice, GfxHostAccessPass, GfxProgram, GfxRenderPass } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxRendererLayer, GfxRenderInstManager, makeSortKeyOpaque } from '../gfx/render/GfxRenderer';
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { DeviceProgram } from '../Program';
import { SceneContext } from '../SceneBase';
import { TextureMapping } from '../TextureHolder';
import { assertExists, nArray } from '../util';
import { SceneGfx, ViewerRenderInput } from "../viewer";
import * as BIN from "./bin";
import { ObjectRenderer } from './objects';
import { BINModelSectorData, KatamariDamacyProgram } from './render';
import { fillSceneParamsData } from './scenes';

const pathBase = `katamari_damacy`;
const katamariWorldSpaceToNoclipSpace = mat4.create();
mat4.rotateX(katamariWorldSpaceToNoclipSpace, katamariWorldSpaceToNoclipSpace, Math.PI);
const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 2, numSamplers: 1 }];

class GalleryCircleProgram extends DeviceProgram {
    public static ub_Params = 0;

    public both: string = `
layout(row_major, std140) uniform ub_Params {
    vec4 u_ColorInner;
    vec4 u_ColorOuter;
    vec4 u_ScaleOffset;
};
`;

    public vert: string = `
out vec2 v_TexCoord;

void main() {
    vec2 p;
    p.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    p.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = p * vec2(2) - vec2(1);
    gl_Position.zw = vec2(${reverseDepthForDepthOffset(1)}, 1);
    v_TexCoord = p * u_ScaleOffset.xy + u_ScaleOffset.zw;
}
`;

    public frag: string = `
in vec2 v_TexCoord;

void main() {
    vec4 t_Color = (length(v_TexCoord) <= 1.0) ? u_ColorInner : u_ColorOuter;
    gl_FragColor = t_Color;
}
`;
}

const backgroundBillboardBindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];

class GalleryCircleRenderer {
    private program = new GalleryCircleProgram();
    private gfxProgram: GfxProgram;
    private textureMappings = nArray(1, () => new TextureMapping());
    public colors = nArray(2, () => colorNewCopy(White));

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        this.gfxProgram = cache.createProgram(device, this.program);
    }

    public randomColor(): void {
        const hue = Math.random();
        colorFromHSL(this.colors[0], hue, 0.7, 0.6);
        colorFromHSL(this.colors[1], hue, 0.4, 0.5);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, renderInput: ViewerRenderInput): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.drawPrimitives(3);
        renderInst.sortKey = makeSortKeyOpaque(GfxRendererLayer.BACKGROUND, this.gfxProgram.ResourceUniqueId);
        renderInst.setInputLayoutAndState(null, null);
        renderInst.setBindingLayouts(backgroundBillboardBindingLayouts);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);

        let offs = renderInst.allocateUniformBuffer(GalleryCircleProgram.ub_Params, 12);
        const d = renderInst.mapUniformBufferF32(GalleryCircleProgram.ub_Params);

        const aspect = renderInput.backbufferWidth / renderInput.backbufferHeight;
        const r = 1.0 / 0.85;

        offs += fillColor(d, offs, this.colors[0]);
        offs += fillColor(d, offs, this.colors[1]);
        offs += fillVec4(d, offs, aspect * 2.0 * r, -r * 2.0, -r * aspect, r);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.gfxProgram);
    }
}

interface GalleryObject {
    Name: string;
    InternalName: string;
    Filename: string;
}

export class GallerySceneRenderer implements SceneGfx {
    private sceneTexture = new ColorTexture();
    public renderTarget = new BasicRenderTarget();
    public renderHelper: GfxRenderHelper;
    public modelSectorData: BINModelSectorData[] = [];
    public objectRenderers: ObjectRenderer[] = [];
    public framebufferTextureMapping = new TextureMapping();

    private circle: GalleryCircleRenderer;
    private label: HTMLElement;
    private rareBadge: HTMLElement;

    constructor(private context: SceneContext, private galleryObjects: GalleryObject[], private transformBuffer: ArrayBufferSlice, private objectBuffer: ArrayBufferSlice, private collectionBuffer: ArrayBufferSlice) {
        const device = context.device;
        this.renderHelper = new GfxRenderHelper(device);

        const cache = this.renderHelper.getCache();
        this.circle = new GalleryCircleRenderer(device, cache);

        const labelContainer = document.createElement('div');
        labelContainer.style.pointerEvents = 'none';
        labelContainer.style.display = 'flex';
        labelContainer.style.flexDirection = 'column';
        labelContainer.style.position = 'absolute';
        labelContainer.style.bottom = '10%';
        labelContainer.style.left = '0%';
        labelContainer.style.right = '0%';
        labelContainer.style.alignItems = 'center';

        this.label = document.createElement('div');
        this.label.style.background = `rgba(0, 0, 0, 0.2)`;
        this.label.style.padding = '1em';
        this.label.style.borderRadius = '999em';
        this.label.style.font = '16pt sans-serif';
        this.label.style.color = 'white';
        this.label.style.textShadow = `0px 0px 12px rgba(0, 0, 0, 0.4)`;
        this.label.style.userSelect = 'none';
        labelContainer.appendChild(this.label);

        const instr = document.createElement('div');
        instr.style.background = `rgba(0, 0, 0, 0.2)`;
        instr.style.marginTop = '1em';
        instr.style.padding = '0.6em';
        instr.style.borderRadius = '1em';
        instr.style.font = '12pt sans-serif';
        instr.style.color = 'white';
        instr.style.textShadow = `0px 0px 12px rgba(0, 0, 0, 0.4)`;
        instr.style.userSelect = 'none';
        instr.textContent = 'Press Space for another Object';
        labelContainer.appendChild(instr);

        this.context.uiContainer.appendChild(labelContainer);

        this.rareBadge = document.createElement('div');
        this.rareBadge.style.background = 'red';
        this.rareBadge.style.borderRadius = '1em';
        this.rareBadge.style.position = 'absolute';
        this.rareBadge.style.padding = '0.4em 0.6em';
        this.rareBadge.style.top = '10%';
        this.rareBadge.style.right = '25%';
        this.rareBadge.style.font = 'bold italic 28pt sans-serif';
        this.rareBadge.style.color = 'white';
        this.rareBadge.style.boxShadow = '0px 0px 12px rgba(0, 0, 0, 0.6)';
        this.rareBadge.style.textShadow = `0px 0px 12px rgba(0, 0, 0, 0.4)`;
        this.rareBadge.style.visibility = 'hidden';
        this.rareBadge.textContent = 'RARE!';

        this.context.uiContainer.appendChild(this.rareBadge);
    }

    public async setObjectID(objectId: number) {
        const device = this.context.device, cache = this.renderHelper.getCache(), dataFetcher = this.context.dataFetcher;

        const galleryObject = this.galleryObjects[objectId];
        const objectBuffer = await dataFetcher.fetchData(`${pathBase}/${galleryObject.Filename}`);

        // Standalone gallery object.
        const gsMemoryMap = nArray(2, () => gsMemoryMapNew());

        const objectModel = assertExists(BIN.parseObjectModel(gsMemoryMap, objectBuffer, 0, this.transformBuffer, objectId));
        const sectorData = new BINModelSectorData(device, cache, objectModel!.sector);
        this.modelSectorData.push(sectorData);

        // Make fake object spawn
        const objectSpawn: BIN.MissionSetupObjectSpawn = {
            objectId, modelMatrix: mat4.create(),
            dispOffAreaNo: -1, dispOnAreaNo: -1, linkAction: 0, moveType: 0, modelIndex: 0, tableIndex: -1,
        };

        const objectRenderer = new ObjectRenderer(device, cache, objectModel, sectorData, objectSpawn);
        this.objectRenderers[0] = objectRenderer;

        this.circle.randomColor();
        this.label.textContent = galleryObject.Name;

        const objectDef = BIN.parseObjectDefinition(this.objectBuffer, this.collectionBuffer, objectId);
        this.rareBadge.style.visibility = objectDef.isRare ? '' : 'hidden';

        // XXX(jstpierre): Hax!
        if (window.main.viewer.cameraController instanceof OrbitCameraController) {
            const radius = objectModel.bbox.boundingSphereRadius();
            window.main.viewer.cameraController.z = -radius * 4.5;
        }
    }

    public setObjectRandom(): void {
        const objectId: number = (Math.random() * this.galleryObjects.length) | 0;
        this.setObjectID(objectId);
    }

    public createCameraController(): CameraController {
        const orbit = new OrbitCameraController();
        orbit.shouldOrbit = true;
        orbit.orbitSpeed = -0.4;
        return orbit;
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        const offs = template.allocateUniformBuffer(KatamariDamacyProgram.ub_SceneParams, 16 + 20);
        const sceneParamsMapped = template.mapUniformBufferF32(KatamariDamacyProgram.ub_SceneParams);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, 0, offs);

        this.circle.prepareToRender(this.renderHelper.renderInstManager, viewerInput);

        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(this.renderHelper.renderInstManager, viewerInput, katamariWorldSpaceToNoclipSpace, 0, null, null);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const renderInstManager = this.renderHelper.renderInstManager;

        if (this.context.inputManager.isKeyDownEventTriggered('Space'))
            this.setObjectRandom();

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.sceneTexture.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor, this.sceneTexture.gfxTexture);

        this.framebufferTextureMapping.gfxTexture = this.sceneTexture!.gfxTexture;
        renderInstManager.simpleRenderInstList!.resolveLateSamplerBinding('framebuffer', this.framebufferTextureMapping);
        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();

        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.sceneTexture.destroy(device);
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);
        this.circle.destroy(device);

        for (let i = 0; i < this.modelSectorData.length; i++)
            this.modelSectorData[i].destroy(device);
    }
}
