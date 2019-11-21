
import ArrayBufferSlice from "../ArrayBufferSlice";
import { decompressArbitraryFile } from "../Scenes_FileDrops";
import { readString, getTextDecoder } from "../util";
import { SceneContext } from "../SceneBase";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { GfxDevice, GfxRenderPass, GfxHostAccessPass } from "../gfx/platform/GfxPlatform";

import * as RARC from '../j3d/rarc';
import { BMD, BCK, BRK, BTK, BTP } from "../Common/JSYSTEM/J3D/J3DLoader";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { mat4 } from "gl-matrix";
import { J3DModelInstance, J3DModelData } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { standardFullClearRenderPassDescriptor, BasicRenderTarget } from "../gfx/helpers/RenderTargetHelpers";
import { gxBindingLayouts, ub_SceneParams, u_SceneParamsBufferSize, fillSceneParamsDataOnTemplate } from "../gx/gx_render";
import { OrbitCameraController } from "../Camera";
import { getDataURLForPath } from "../DataFetcher";

interface CommonArchive {
    findFileData(path: string): ArrayBufferSlice | null;
}

function basedir(S: string): string {
    return S.split('/').slice(0, -1).join('/');
}

function getDataURL(basedir: string, path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
    } else if (path.startsWith('noclip://')) {
        return getDataURLForPath(path.slice(9));
    } else {
        return `${basedir}/${path}`;
    }
}

interface GraphBase {
    modelMatrix: mat4;
    prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void;
    destroy(device: GfxDevice): void;
}

class J3DGraphNode extends J3DModelInstance implements GraphBase {
    public bindBCK(buffer: ArrayBufferSlice | null) { const x = buffer !== null ? BCK.parse(buffer) : null; this.bindANK1(x !== null ? x : null); return x; }
    public bindBTK(buffer: ArrayBufferSlice | null) { const x = buffer !== null ? BTK.parse(buffer) : null; this.bindTTK1(x !== null ? x : null); return x; }
    public bindBRK(buffer: ArrayBufferSlice | null) { const x = buffer !== null ? BRK.parse(buffer) : null; this.bindTRK1(x !== null ? x : null); return x; }
    public bindBTP(buffer: ArrayBufferSlice | null) { const x = buffer !== null ? BTP.parse(buffer) : null; this.bindTPT1(x !== null ? x : null); return x; }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(gxBindingLayouts);
        template.allocateUniformBuffer(ub_SceneParams, u_SceneParamsBufferSize);
        fillSceneParamsDataOnTemplate(template, viewerInput);
        super.prepareToRender(device, renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();
    }
}

class ScriptRenderer implements SceneGfx {
    public renderTarget = new BasicRenderTarget();
    public renderHelper: GfxRenderHelper;
    public clearRenderPassDescriptor = standardFullClearRenderPassDescriptor;

    public graphNodes: GraphBase[] = [];

    public cameraController = new OrbitCameraController();
    public intervals: number[] = [];
    public uiContainer: HTMLElement;

    constructor(public context: SceneContext, public basedir: string, public args: string) {
        this.uiContainer = context.uiContainer;
        this.renderHelper = new GfxRenderHelper(context.device);
    }

    public createCameraController() {
        return this.cameraController;
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();
        for (let i = 0; i < this.graphNodes.length; i++)
            this.graphNodes[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.prepareToRender(device, hostAccessPass);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
    
        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, this.clearRenderPassDescriptor);
        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);
        for (let i = 0; i < this.graphNodes.length; i++)
            this.graphNodes[i].destroy(device);
        for (let i = 0; i < this.intervals.length; i++)
            clearInterval(this.intervals[i]);
    }

    // Script API.
    public static PUBLIC_API = [
        'args',
        'uiContainer',
        'fetchData',
        'fetchArchive',
        'spawnBMD',
        'cameraController',
        'setInterval',
    ];

    public fetchData = async (url: string): Promise<ArrayBufferSlice> => {
        const dataFetcher = this.context.dataFetcher;
        const buffer = await dataFetcher.fetchURL(getDataURL(this.basedir, url));
        return decompressArbitraryFile(buffer);
    };

    public parseArchive = (buffer: ArrayBufferSlice): CommonArchive => {
        const magic = readString(buffer, 0x00, 0x04);

        if (magic === 'RARC')
            return RARC.parse(buffer);

        throw "whoops";
    };

    public fetchArchive = async (url: string): Promise<CommonArchive> => {
        const buffer = await this.fetchData(url);
        return this.parseArchive(buffer);
    };

    public spawnBMD = (data: ArrayBufferSlice): J3DGraphNode => {
        const bmdData = BMD.parse(data);
        const bmdModel = new J3DModelData(this.context.device, this.renderHelper.getCache(), bmdData);
        const bmdModelInstance = new J3DGraphNode(bmdModel);
        this.graphNodes.push(bmdModelInstance);
        return bmdModelInstance;
    };

    // Replace setInterval with one that will clean up upon scene destruction.
    public setInterval = (callback: Function, ms: number): void => {
        const id = setInterval(callback, ms);
        this.intervals.push(id);
    };
}

const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

function runScript(ctx: ScriptRenderer, source: string): Promise<void> {
    const header = ScriptRenderer.PUBLIC_API.map((n) => {
        return `var ${n} = ctx.${n};`;
    }).join('\n') + '\n\n// Script Begin\n\n';

    const func = new AsyncFunction('ctx', header + source);
    return func(ctx);
}

export async function createScene(context: SceneContext, param: string): Promise<SceneGfx> {
    const dataFetcher = context.dataFetcher;

    let scriptURL = param, args = '';
    const excl = param.indexOf('!');
    if (excl >= 0) {
        scriptURL = param.slice(0, excl);
        args = param.slice(excl + 1);
    }

    const renderer = new ScriptRenderer(context, basedir(scriptURL), args);
    const decoder = getTextDecoder('utf8')!;
    const data = await dataFetcher.fetchURL(scriptURL);
    const source = decoder.decode(data.arrayBuffer);
    runScript(renderer, source);
    return renderer;
}
