
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { BasicRenderTarget, makeClearRenderPassDescriptor, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxCullMode, GfxDevice, GfxHostAccessPass, GfxRenderPass, GfxRenderPassDescriptor } from "../gfx/platform/GfxPlatform";
import { executeOnPass } from "../gfx/render/GfxRenderer";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { Filesystem, loadFilesystem } from "./Filesystem";
import { UVTR, UVTRRenderer } from "./ParsedFiles/UVTR";
import { CameraController } from "../Camera";
import * as UI from '../ui';
import { UVEN } from "./ParsedFiles/UVEN";
import { UVMDRenderer } from "./ParsedFiles/UVMD";
import { mat4 } from "gl-matrix";
import { UVTX, TexScrollAnim, TexSeqAnim } from "./ParsedFiles/UVTX";
import { UVTS } from "./ParsedFiles/UVTS";
import { colorNewFromRGBA } from "../Color";

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2 },
];

export const DEBUGGING_TOOLS_STATE = {
    showTextureIndices: false,
    singleUVTXToRender: null
};

class BARRenderer implements SceneGfx {

    public renderHelper: GfxRenderHelper;
    private renderTarget = new BasicRenderTarget();

    private uvtrRenderer: UVTRRenderer;
    
    private uvenModelRenderers: UVMDRenderer[] | null = null;
    private texScrollAnims: TexScrollAnim[];
    private texSeqAnims: TexSeqAnim[];

    private renderPassDescriptor: GfxRenderPassDescriptor;

    constructor(device: GfxDevice, uvtr: UVTR, uven: UVEN | null) {
        this.renderHelper = new GfxRenderHelper(device);

        // TODO: this is a kind of hacky solution?
        // TODO: this causes a lot of duplicate destruction warnings
        let rendererCache = new Map<any, any>();
        
        this.uvtrRenderer = new UVTRRenderer(uvtr, device, rendererCache);

        // TODO: less sketchy uven setup
        if(uven !== null) {
            this.uvenModelRenderers = uven.uvmds.map(md => new UVMDRenderer(md, device, rendererCache));
        }

        // TODO: this is maybe a hacky solution?
        // TODO: Reset animations
        this.texScrollAnims = [];
        this.texSeqAnims = [];
        for(let uvFile of rendererCache.keys()) {
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

    // TODO-ASK: what is a render inst?
    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        let deltaTimeSecs = viewerInput.deltaTime / 1000;
        for(let texScrollAnim of this.texScrollAnims) {
            texScrollAnim.update(deltaTimeSecs);
        }
        for(let texSeqAnim of this.texSeqAnims) {
            texSeqAnim.update(deltaTimeSecs);
        }

        const topTemplate = this.renderHelper.pushTemplateRenderInst();
        
        topTemplate.setBindingLayouts(bindingLayouts);

        // TODO TODO TODO: use translateRenderMode from RDP file!
        topTemplate.setMegaStateFlags(setAttachmentStateSimple({}, {
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        }));
        topTemplate.setMegaStateFlags({cullMode: GfxCullMode.BACK});

        const renderInstManager = this.renderHelper.renderInstManager;

        //TODO: figure out what's going on with the weird env textures
        if(this.uvenModelRenderers !== null) {
            this.uvenModelRenderers.forEach(r => r.prepareToRender(device, renderInstManager, viewerInput, mat4.create()))
        }

        this.uvtrRenderer.prepareToRender(device, renderInstManager, viewerInput);

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

        // executeOnPass(renderInstManager, device, passRenderer, PW64Pass.SNOW);

        renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
        this.uvtrRenderer.destroy(device);
    }
}

export const pathBase = `BeetleAdventureRacing`;
class BARSceneDesc implements SceneDesc {
    public id: string;
    constructor(public sceneIndex: number, public name: string) {
        this.id = sceneIndex.toString();
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const filesystem = await context.dataShare.ensureObject<Filesystem>(`${pathBase}/FilesystemData`, async () => {
            return await loadFilesystem(context.dataFetcher, device);
        });

        // Get scene descriptions
        let sceneModuleCodeChunkBuffer = filesystem.getFile("UVMO", 0x32).chunks[1].buffer;
        let sceneDescriptionsDataView = sceneModuleCodeChunkBuffer.subarray(0x1840, 0x9c * 0x22).createDataView();

        let uvtrIndex = sceneDescriptionsDataView.getInt16(0x9c * this.sceneIndex + 0x0);
        let uvenIndex = sceneDescriptionsDataView.getInt16(0x9c * this.sceneIndex + 0x2);

        const uvtr = filesystem.getParsedFile(UVTR, "UVTR", uvtrIndex);
        console.log(uvtr);

        // TODO: II env contains pyramid duplicates?
        // (maybe so that they always appear even when contour is unloaded?)
        let uven = null;
        if (uvenIndex !== -1) {
            uven = filesystem.getParsedFile(UVEN, "UVEN", uvenIndex)
        }

        //TODO: better solution?
        for(let uvts of filesystem.getAllLoadedFilesOfType<UVTS>("UVTS")) {
            uvts.loadUVTXs(filesystem);
        }

        return new BARRenderer(device, uvtr, uven);


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
    new BARSceneDesc(0xA, 'Metro Madness'),
    new BARSceneDesc(0x6, 'Wicked Woods'),
    '~~Tracks',
    new BARSceneDesc(0xB, 'Stunt O\'Rama'),
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
    //TODO: [thing under sunset sands]

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
    // new BARSceneDesc(4, '4'), advertise segment
    // new BARSceneDesc(5, '5'), advertise segment
    // new BARSceneDesc(6, '6'), advertise segment
    // new BARSceneDesc(7, '7'), advertise segment
    // new BARSceneDesc(38, '38'), advertise segment
    // new BARSceneDesc(39, '39'), advertise segment */

];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
