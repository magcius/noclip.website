
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { BasicRenderTarget, makeClearRenderPassDescriptor, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxCullMode, GfxDevice, GfxHostAccessPass, GfxRenderPass, GfxRenderPassDescriptor } from "../gfx/platform/GfxPlatform";
import { executeOnPass } from "../gfx/render/GfxRenderer";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { SceneContext, SceneDesc, SceneGroup, Destroyable } from "../SceneBase";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { Filesystem, loadFilesystem } from "./Filesystem";
import { UVTR, UVTRRenderer } from "./ParsedFiles/UVTR";
import { CameraController } from "../Camera";
import * as UI from '../ui';
import { UVEN, UVENRenderer } from "./ParsedFiles/UVEN";
import { UVMDRenderer } from "./ParsedFiles/UVMD";
import { mat4 } from "gl-matrix";
import { UVTX, TexScrollAnim, TexSeqAnim } from "./ParsedFiles/UVTX";
import { UVTS } from "./ParsedFiles/UVTS";
import { colorNewFromRGBA } from "../Color";
import { assert } from "../util";

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2 },
];

export const DEBUGGING_TOOLS_STATE = {
    showTextureIndices: false,
    singleUVTXToRender: null//0x270
};

export class RendererStore implements Destroyable {
    public objToRendererMap: Map<any, any> = new Map();

    public getOrCreateRenderer<TObj, TRenderer>(obj: TObj, createLambda: () => TRenderer): TRenderer {
        let cachedRenderer = this.objToRendererMap.get(obj);
        if(cachedRenderer !== undefined) {
            return <TRenderer> cachedRenderer;
        } else {
            let newRenderer = createLambda();
            this.objToRendererMap.set(obj, newRenderer);
            return newRenderer;
        }
    }

    public destroy(device: GfxDevice): void {
        for(let renderer of this.objToRendererMap.values()) {
            if(renderer.destroy) 
                renderer.destroy(device);
        }
    }
}

class BARRenderer implements SceneGfx {
    public renderHelper: GfxRenderHelper;
    private renderTarget = new BasicRenderTarget();

    private uvtrRenderer: UVTRRenderer;
    private uvenRenderer: UVENRenderer | null;
    
    private texScrollAnims: TexScrollAnim[];
    private texSeqAnims: TexSeqAnim[];

    private renderPassDescriptor: GfxRenderPassDescriptor;

    constructor(device: GfxDevice, rendererStore: RendererStore, uvtr: UVTR, uven: UVEN | null) {
        this.renderHelper = new GfxRenderHelper(device);

        this.uvtrRenderer = rendererStore.getOrCreateRenderer(uvtr, ()=>new UVTRRenderer(uvtr, device, rendererStore))

        this.uvenRenderer = null;
        if(uven !== null)
            this.uvenRenderer = rendererStore.getOrCreateRenderer(uven, ()=>new UVENRenderer(uven, device, rendererStore));

        this.texScrollAnims = [];
        this.texSeqAnims = [];
        for(let uvFile of rendererStore.objToRendererMap.keys()) {
            if(uvFile instanceof UVTX) {
                if(uvFile.scrollAnim1 !== null)
                    this.texScrollAnims.push(uvFile.scrollAnim1);
                if(uvFile.scrollAnim2 !== null)
                    this.texScrollAnims.push(uvFile.scrollAnim2);
                if(uvFile.seqAnim !== null) {
                    this.texSeqAnims.push(uvFile.seqAnim);
                }
            }
        }

        // TODO: we use purple as a default just so i know when it's not loading; in the future switch to something else
        this.renderPassDescriptor = makeClearRenderPassDescriptor(true, colorNewFromRGBA(1, 0, 1));
        if (uven !== null) {
            this.renderPassDescriptor = makeClearRenderPassDescriptor(true, colorNewFromRGBA(uven.clearR / 0xFF, uven.clearG / 0xFF, uven.clearB / 0xFF));
        }
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.02);
    }

    // TODO: enable/disable textures and vertex colors
    // TODO: some sort of checkbox to always use the lowest LOD just for funsies?
    // TODO: show collision data (if that's easy to find)
    // TODO: Differences between last lap and other laps?
    // TODO: Option to hide the boxes
    public createPanels(): UI.Panel[] {
        const debuggingToolsPanel = new UI.Panel();

        debuggingToolsPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        debuggingToolsPanel.setTitle(UI.RENDER_HACKS_ICON, 'Debug');

        const showTextureIndicesCheckbox = new UI.Checkbox('Show Texture Indices', DEBUGGING_TOOLS_STATE.showTextureIndices);
        showTextureIndicesCheckbox.onchanged = () => {
            DEBUGGING_TOOLS_STATE.showTextureIndices = showTextureIndicesCheckbox.checked;
        };
        debuggingToolsPanel.contents.appendChild(showTextureIndicesCheckbox.elem);

        return [debuggingToolsPanel];
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        // Update animations
        let deltaTimeSecs = viewerInput.deltaTime / 1000;
        for(let texScrollAnim of this.texScrollAnims) {
            texScrollAnim.update(deltaTimeSecs);
        }
        for(let texSeqAnim of this.texSeqAnims) {
            texSeqAnim.update(deltaTimeSecs);
        }

        // Do a little render setup
        const topTemplate = this.renderHelper.pushTemplateRenderInst();   
        topTemplate.setBindingLayouts(bindingLayouts);
        const renderInstManager = this.renderHelper.renderInstManager;

        // Render
        if(this.uvenRenderer !== null)
            this.uvenRenderer.prepareToRender(device, renderInstManager, viewerInput);

        this.uvtrRenderer.prepareToRender(device, renderInstManager, viewerInput);

        // Final setup
        this.renderHelper.renderInstManager.popTemplateRenderInst();       
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    //TODO-ASK: how does this work? what is a pass? what is the host access pass? what is the return value?
    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, this.renderPassDescriptor);
        executeOnPass(renderInstManager, device, passRenderer, 0);

        //TODO: snow

        renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
    }
}

export const pathBase = `BeetleAdventureRacing`;
class BARSceneDesc implements SceneDesc {
    public id: string;

    // uvtrIndex is there for when we want to load a UVTR that's not part of a scene.
    constructor(public sceneIndex: number | null, public name: string, public uvtrIndex: number | null = null) {
        if (this.sceneIndex !== null) {
            this.id = "sc" + this.sceneIndex.toString();
        } else {
            this.id = "tr" + this.uvtrIndex;
        }       
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const filesystem = await context.dataShare.ensureObject<Filesystem>(`${pathBase}/FilesystemData`, async () => {
            return await loadFilesystem(context.dataFetcher, device);
        });

        let uvtrIndex: number;
        let uvenIndex: number | null = null;

        if(this.sceneIndex !== null) {
            // Scene descriptions are stored in a big array in the data section of the "scene" module's code.
            let sceneModuleCodeChunkBuffer = filesystem.getFile("UVMO", 0x32).chunks[1].buffer;
            // Each description is 0x9c bytes long
            let sceneDescriptionsDataView = sceneModuleCodeChunkBuffer.subarray(0x1840, 0x9c * 0x22).createDataView();

            uvtrIndex = sceneDescriptionsDataView.getInt16(0x9c * this.sceneIndex + 0x0);
            uvenIndex = sceneDescriptionsDataView.getInt16(0x9c * this.sceneIndex + 0x2);
        } else if (this.uvtrIndex !== null) {
            uvtrIndex = this.uvtrIndex;
        } else {
            assert(false);
        }

        // This loads the UVTR and UVEN as well as all files needed by them.
        // (Unless they've already been loaded and are cached)
        const uvtr = filesystem.getOrLoadFile(UVTR, "UVTR", uvtrIndex);
        let uven: UVEN | null = null;
        if (uvenIndex !== null) {
            uven = filesystem.getOrLoadFile(UVEN, "UVEN", uvenIndex)
        }

        // UVTS files reference UVTX files but are themselves referenced by UVTX files
        // so loading their references immediately would cause infinite recursion.
        // Instead we have to do it after.
        // TODO: should I come up with a better solution for this?
        for(let uvts of filesystem.getAllLoadedFilesOfType<UVTS>("UVTS")) {
            uvts.loadUVTXs(filesystem);
        }

        const rendererStore = await context.dataShare.ensureObject<RendererStore>(`${pathBase}/RendererStore`, async () => {
            return await new RendererStore();
        });

        return new BARRenderer(device, rendererStore, uvtr, uven);
    }
}

const id = 'BeetleAdventureRacing';
const name = "Beetle Adventure Racing!";
const sceneDescs = [
    'Tracks',
    new BARSceneDesc(0x5, 'Coventry Cove'),
    new BARSceneDesc(0x7, 'Mount Mayhem'),
    new BARSceneDesc(0x9, 'Inferno Isle'),
    new BARSceneDesc(0x8, 'Sunset Sands'),
    new BARSceneDesc(null, '(chamber under sunset sands)', 0x15),
    new BARSceneDesc(0xA, 'Metro Madness'),
    new BARSceneDesc(0x6, 'Wicked Woods'),
    new BARSceneDesc(0xB, '[Unused] Stunt O\'Rama'),
    //new BARSceneDesc(0xC, 'TRACK 8'),
    //new BARSceneDesc(0xD, 'TRACK 9'),
    //new BARSceneDesc(0xE, 'TRACK 10'),
    'Multiplayer',
    new BARSceneDesc(0x11, 'Airport'),
    new BARSceneDesc(0x12, 'Castle'),
    new BARSceneDesc(0x13, 'Stadium'),
    new BARSceneDesc(0x14, 'Volcano'),
    new BARSceneDesc(0x15, 'Dunes'),
    new BARSceneDesc(0x16, 'Rooftops'),
    new BARSceneDesc(0x17, 'Ice Flows'),
    new BARSceneDesc(0x18, 'Parkade'),
    new BARSceneDesc(0x19, 'Woods'),
    new BARSceneDesc(0x1A, '[Unused]'),
    // 'INTRO',
    // new BARSceneDesc(0x1B, 'INTRO1'),
    // new BARSceneDesc(0x1C, 'INTRO2'),
    // new BARSceneDesc(0x1D, 'INTRO3'),
    // new BARSceneDesc(0x1E, 'INTRO4'),
    // new BARSceneDesc(0x1F, 'INTRO5'),
    // new BARSceneDesc(0x20, 'INTRO6'),
    'Other',
    //new BARSceneDesc(0x0, 'NONE'),
    //new BARSceneDesc(0x1, 'TEST ROAD'),
    new BARSceneDesc(0x2, 'TEST GRID'),
    new BARSceneDesc(0x3, 'CHECKER BOARD'),
    new BARSceneDesc(0x4, 'ROUND TRACK'),
    //new BARSceneDesc(0xF, 'DRAGSTRIP'),
    //new BARSceneDesc(0x10, 'DERBY'),
    new BARSceneDesc(0x21, 'FINISH'),

    //TODO?: There are other UVTRs that aren't part of a scene, are any of them interesting enough to include?

    // 'Not Sure',
    // new BARSceneDesc(0, '0'),
    // new BARSceneDesc(2, 'Parkade duplicate??'),
    // new BARSceneDesc(12, '12'),
    // new BARSceneDesc(13, '13'),
    // new BARSceneDesc(14, '14'),
    // new BARSceneDesc(15, '15'), // bridge test level
    // new BARSceneDesc(16, '16'), // big ring test level
    // new BARSceneDesc(17, '17'), // checkerboard test level
    // new BARSceneDesc(18, '18'),
    // new BARSceneDesc(37, '37'),
    // new BARSceneDesc(1, '1'), // blue tint
    // new BARSceneDesc(3, '3'), // blue tint
    // new BARSceneDesc(8, '8'), // blue tint
    // new BARSceneDesc(9, '9'), // blue tint
    // new BARSceneDesc(10, '10'), // blue tint
    // new BARSceneDesc(11, '11'), // blue tint

];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
