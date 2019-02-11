
import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as Yaz0 from '../compression/Yaz0';
import * as RARC from './rarc';

import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';
import { readString, assert } from '../util';
import { fetchData } from '../fetch';

import { J3DTextureHolder, BMDModelInstance, BMDModel } from './render';
import { createModelInstance } from './scenes';
import { EFB_WIDTH, EFB_HEIGHT } from '../gx/gx_material';
import { mat4, quat } from 'gl-matrix';
import { LoopMode, BMD, BMT, BCK, BTK, BRK } from './j3d';
import { TextureOverride } from '../TextureHolder';
import { GXRenderHelperGfx } from '../gx/gx_render';
import { GfxRenderInstViewRenderer } from '../gfx/render/GfxRenderer';
import { BasicRenderTarget, ColorTexture, makeClearRenderPassDescriptor, depthClearRenderPassDescriptor, noClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { colorNew } from '../Color';
import { RENDER_HACKS_ICON } from '../bk/scenes';

const sjisDecoder = new TextDecoder('sjis');

function unpack(buffer: ArrayBufferSlice, sig: string): any[] {
    const view = buffer.createDataView();
    const result: any[] = [];
    let offs = 0;
    let allowExtra = false;
    for (let i = 0; i < sig.length; i++) {
        switch (sig[i]) {
        case 'B':
            result.push(view.getUint8(offs));
            offs += 0x01;
            break;
        case 'I':
            result.push(view.getUint32(offs));
            offs += 0x04;
            break;
        case 'i':
            result.push(view.getInt32(offs));
            offs += 0x04;
            break;
        case 'f':
            result.push(view.getFloat32(offs));
            offs += 0x04;
            break;
        case 's':
            const size = view.getUint16(offs);
            offs += 0x02;
            result.push(readString(buffer, offs, size, false));
            offs += size;
            break;
        case '.':
            allowExtra = true;
            break;
        case ' ':
            break;
        default:
            assert(false);
        }
    }

    if (!allowExtra) {
        assert(buffer.byteLength === offs);
    }

    return [offs, ...result];
}

interface SceneBinObjBase {
    klass: string;
    name: string;
    size: number;
}

interface SceneBinObjUnk extends SceneBinObjBase {
    type: 'Unknown';
}

interface SceneBinObjAmbColor extends SceneBinObjBase {
    type: 'AmbColor';
    klass: 'AmbColor';
    r: number;
    g: number;
    b: number;
    a: number;
}

interface SceneBinObjLight extends SceneBinObjBase {
    type: 'Light';
    klass: 'Light';
    x: number;
    y: number;
    z: number;
    r: number;
    g: number;
    b: number;
    a: number;
    intensity: number;
}

interface SceneBinObjModel extends SceneBinObjBase {
    type: 'Model';
    x: number;
    y: number;
    z: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    manager: string;
    model: string;
}

interface SceneBinObjGroup extends SceneBinObjBase {
    type: 'Group';
    klass: 'GroupObj' | 'Strategy' | 'AmbAry' | 'LightAry' | 'MarScene' | 'IdxGroup';
    children: SceneBinObj[];
}

type SceneBinObj = SceneBinObjGroup | SceneBinObjAmbColor | SceneBinObjLight | SceneBinObjModel | SceneBinObjUnk;

function readSceneBin(buffer: ArrayBufferSlice): SceneBinObj {
    let offs = 0x00;
    const view_ = buffer.createDataView();
    const size = view_.getUint32(offs + 0x00);
    const view = buffer.createDataView(0x00, size);
    offs += 0x04;
    const klassHash = view.getUint16(offs + 0x00);
    const klassSize = view.getUint16(offs + 0x02);
    offs += 0x04;
    const klass = readString(buffer, offs, klassSize, false);
    offs += klassSize;
    const nameHash = view.getUint16(offs + 0x00);
    const nameSize = view.getUint16(offs + 0x02);
    offs += 0x04;
    const name = sjisDecoder.decode(buffer.copyToBuffer(offs, nameSize));
    offs += nameSize;

    function readChildren(numChildren: number): SceneBinObj[] {
        const children = [];
        while (numChildren--) {
            const child = readSceneBin(buffer.slice(offs));
            children.push(child);
            offs += child.size;
        }
        return children;
    }

    const params = buffer.slice(offs, size);

    switch (klass) {
    case 'GroupObj':
    case 'LightAry':
    case 'Strategy':
    case 'AmbAry':
    {
        const [paramsSize, numChildren] = unpack(params, 'I.');
        offs += paramsSize;
        const children = readChildren(numChildren);
        return { type: 'Group', klass, name, size, children };
    }
    case 'IdxGroup':
    case 'MarScene':
    {
        const [paramsSize, flags, numChildren] = unpack(params, 'II.');
        offs += paramsSize;
        const children = readChildren(numChildren);
        return { type: 'Group', klass, name, size, children };
    }
    case 'AmbColor':
    {
        const [paramsSize, r, g, b, a] = unpack(params, 'BBBB');
        return { type: 'AmbColor', klass, name, size, r, g, b, a };
    }
    case 'Light':
    {
        const [paramsSize, x, y, z, r, g, b, a, intensity] = unpack(params, 'fffBBBBf');
        return { type: 'Light', klass, name, size, x, y, z, r, g, b, a, intensity };
    }
    // Models
    case 'BananaTree':
    case 'BiaTurnBridge':
    case 'BiaWatermill':
    case 'Coin':
    case 'CoinRed':
    case 'Fence':
    case 'FenceInner':
    case 'FenceRevolve':
    case 'FenceWaterH':
    case 'FenceWaterV':
    case 'FerrisWheel':
    case 'IceBlock':
    case 'Manhole':
    case 'MapObjBase':
    case 'MapStaticObj':
    case 'Merrygoround':
    case 'MonumentShine':
    case 'Palm':
    case 'PalmNatume':
    case 'PalmOugi':
    case 'PinnaDoor':
    case 'ShellCup':
    case 'WoodBarrel':
    case 'WoodBlock':
    case 'Viking':
    {
        const [paramsSize, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, flags, model] = unpack(params, 'ffffff fffsi s.');
        return { type: 'Model', klass, name, size, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, model };
    }
    // Extra unk junk
    case 'CoinBlue':
    {
        const [paramsSize, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, flags, model] = unpack(params, 'ffffff fffsi s i');
        return { type: 'Model', klass, name, size, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, model };
    }
    case 'NozzleBox':
    {
        const [paramsSize, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, flags, model] = unpack(params, 'ffffff fffsi s ssff');
        return { type: 'Model', klass, name, size, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, model };
    }
    case 'Shine':
    {
        const [paramsSize, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, flags, model] = unpack(params, 'ffffff fffsi s sii');
        return { type: 'Model', klass, name, size, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, model };
    }
    case 'FruitsBoat':
    {
        const [paramsSize, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, flags, model] = unpack(params, 'ffffff fffsi s s');
        return { type: 'Model', klass, name, size, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, model };
    }
    case 'Billboard':
    case 'BrickBlock':
    case 'DolWeathercock':
    case 'WoodBox':
    {
        const [paramsSize, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, flags, model] = unpack(params, 'ffffff fffsI s IffI');
        return { type: 'Model', klass, name, size, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, model };
    }
    case 'MapObjWaterSpray':
    {
        const [paramsSize, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, flags, model] = unpack(params, 'ffffff fffsI s IIIIII');
        return { type: 'Model', klass, name, size, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, model };
    }
    default:
        let warnUnknown = true;

        // Managers are internal.
        if (klass.endsWith('Manager') || klass.endsWith('Mgr'))
            warnUnknown = false;
        // Cube maps...
        if (klass.startsWith('Cube'))
            warnUnknown = false;

        if (warnUnknown)
            console.warn(`Unknown object class ${klassHash} ${klass}, size ${size}`);

        return { type: 'Unknown', klass, name, size };
    }
}

export const enum SMSPass {
    SKYBOX = 1 << 0,
    OPAQUE = 1 << 1,
    INDIRECT = 1 << 2,
    TRANSPARENT = 1 << 3,
}

const sunshineClearDescriptor = makeClearRenderPassDescriptor(true, colorNew(0, 0, 0.125, 1));

export class SunshineRenderer implements Viewer.SceneGfx {
    public renderHelper: GXRenderHelperGfx;
    public viewRenderer = new GfxRenderInstViewRenderer();
    public mainRenderTarget = new BasicRenderTarget();
    public opaqueSceneTexture = new ColorTexture();
    public modelInstances: BMDModelInstance[] = [];

    constructor(device: GfxDevice, public textureHolder: J3DTextureHolder, public rarc: RARC.RARC) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        return [renderHacksPanel];
    }

    public finish(device: GfxDevice): void {
        this.renderHelper.finishBuilder(device, this.viewRenderer);
    }

    protected prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(20, 500000);
        this.renderHelper.fillSceneParams(viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender(hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        this.viewRenderer.prepareToRender(device);

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        this.mainRenderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.opaqueSceneTexture.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);

        const skyboxPassRenderer = this.mainRenderTarget.createRenderPass(device, sunshineClearDescriptor);
        this.viewRenderer.executeOnPass(device, skyboxPassRenderer, SMSPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);

        const opaquePassRenderer = this.mainRenderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, opaquePassRenderer, SMSPass.OPAQUE);

        let lastPassRenderer: GfxRenderPass;
        if (this.viewRenderer.hasAnyVisible(SMSPass.INDIRECT)) {
            opaquePassRenderer.endPass(this.opaqueSceneTexture.gfxTexture);
            device.submitPass(opaquePassRenderer);

            // IndTex.
            const textureOverride: TextureOverride = { gfxTexture: this.opaqueSceneTexture.gfxTexture, width: EFB_WIDTH, height: EFB_HEIGHT, flipY: true };
            this.textureHolder.setTextureOverride("indirectdummy", textureOverride);

            const indTexPassRenderer = this.mainRenderTarget.createRenderPass(device, noClearRenderPassDescriptor);
            this.viewRenderer.executeOnPass(device, indTexPassRenderer, SMSPass.INDIRECT);
            lastPassRenderer = indTexPassRenderer;
        } else {
            lastPassRenderer = opaquePassRenderer;
        }

        // Window & transparent.
        this.viewRenderer.executeOnPass(device, lastPassRenderer, SMSPass.TRANSPARENT);
        return lastPassRenderer;
    }

    public destroy(device: GfxDevice) {
        this.renderHelper.destroy(device);
        this.viewRenderer.destroy(device);
        this.textureHolder.destroy(device);
        this.mainRenderTarget.destroy(device);
        this.opaqueSceneTexture.destroy(device);
        this.modelInstances.forEach((instance) => instance.destroy(device));
    }
}

export class SunshineSceneDesc implements Viewer.SceneDesc {
    public static createSunshineSceneForBasename(device: GfxDevice, renderHelper: GXRenderHelperGfx, textureHolder: J3DTextureHolder, passMask: number, rarc: RARC.RARC, basename: string, isSkybox: boolean): BMDModelInstance {
        const bmdFile = rarc.findFile(`${basename}.bmd`);
        if (!bmdFile)
            return null;
        const btkFile = rarc.findFile(`${basename}.btk`);
        const brkFile = rarc.findFile(`${basename}.brk`);
        const bckFile = rarc.findFile(`${basename}.bck`);
        const bmtFile = rarc.findFile(`${basename}.bmt`);
        const modelInstance = createModelInstance(device, renderHelper, textureHolder, bmdFile, btkFile, brkFile, bckFile, bmtFile);
        modelInstance.name = basename;
        modelInstance.setIsSkybox(isSkybox);
        modelInstance.passMask = passMask;
        return modelInstance;
    }

    constructor(public id: string, public name: string) {
    }

    public createScene(device: GfxDevice): Progressable<Viewer.SceneGfx> {
        const pathBase = `j3d/sms`;
        const path = `${pathBase}/${this.id}.szs`;
        return fetchData(path).then((result: ArrayBufferSlice) => {
            return Yaz0.decompress(result);
        }).then((buffer: ArrayBufferSlice) => {
            const rarc = RARC.parse(buffer);

            const sceneBin = rarc.findFile('map/scene.bin');
            const sceneBinObj = readSceneBin(sceneBin.buffer);
            console.log(sceneBinObj);

            const textureHolder = new J3DTextureHolder();
            const renderer = new SunshineRenderer(device, textureHolder, rarc);

            const skyScene = SunshineSceneDesc.createSunshineSceneForBasename(device, renderer.renderHelper, textureHolder, SMSPass.SKYBOX, rarc, 'map/map/sky', true);
            if (skyScene !== null)
                renderer.modelInstances.push(skyScene);
            const mapScene = SunshineSceneDesc.createSunshineSceneForBasename(device, renderer.renderHelper, textureHolder, SMSPass.OPAQUE, rarc, 'map/map/map', false);
            if (mapScene !== null)
                renderer.modelInstances.push(mapScene);
            const seaScene = SunshineSceneDesc.createSunshineSceneForBasename(device, renderer.renderHelper, textureHolder, SMSPass.OPAQUE, rarc, 'map/map/sea', false);
            if (seaScene !== null)
                renderer.modelInstances.push(seaScene);
            const seaIndirectScene = SunshineSceneDesc.createSunshineSceneForBasename(device, renderer.renderHelper, textureHolder, SMSPass.INDIRECT, rarc, 'map/map/seaindirect', false);
            if (seaIndirectScene !== null)
                renderer.modelInstances.push(seaIndirectScene);

            const extraScenes = this.createSceneBinObjects(device, renderer.renderHelper, textureHolder, rarc, sceneBinObj);
            for (let i = 0; i < extraScenes.length; i++)
                renderer.modelInstances.push(extraScenes[i]);

            renderer.finish(device);
            return renderer;
        });
    }

    private createSceneBinObjects(device: GfxDevice, renderHelper: GXRenderHelperGfx, textureHolder: J3DTextureHolder, rarc: RARC.RARC, obj: SceneBinObj): BMDModelInstance[] {
        function flatten<T>(L: T[][]): T[] {
            const R: T[] = [];
            for (const Ts of L)
                R.push.apply(R, Ts);
            return R;
        }

        switch (obj.type) {
        case 'Group':
            const childTs: BMDModelInstance[][] = obj.children.map(c => this.createSceneBinObjects(device, renderHelper, textureHolder, rarc, c));
            const flattened: BMDModelInstance[] = flatten(childTs).filter(o => !!o);
            return flattened;
        case 'Model':
            return [this.createSceneForSceneBinModel(device, renderHelper, textureHolder, rarc, obj)];
        default:
            // Don't care.
            return undefined;
        }
    }

    private createSceneForSceneBinModel(device: GfxDevice, renderHelper: GXRenderHelperGfx, textureHolder: J3DTextureHolder, rarc: RARC.RARC, obj: SceneBinObjModel): BMDModelInstance {
        interface ModelLookup {
            k: string; // klass
            m: string; // model
            p?: string; // resulting file prefix
            s?: () => BMDModelInstance;
        };

        const modelCache = new Map<RARC.RARCFile, BMDModel>();
        function lookupModel(bmdFile: RARC.RARCFile, bmtFile: RARC.RARCFile | null): BMDModel {
            assert(!!bmdFile);
            if (modelCache.has(bmdFile)) {
                return modelCache.get(bmdFile);
            } else {
                const bmd = BMD.parse(bmdFile.buffer);
                const bmt = bmtFile !== null ? BMT.parse(bmtFile.buffer) : null;
                textureHolder.addJ3DTextures(device, bmd, bmt);
                const bmdModel = new BMDModel(device, renderHelper, bmd, bmt);
                modelCache.set(bmdFile, bmdModel);
                return bmdModel;
            }
        }

        function bmtm(bmd: string, bmt: string): BMDModelInstance {
            const bmdFile = rarc.findFile(bmd);
            const bmtFile = rarc.findFile(bmt);
            const bmdModel = lookupModel(bmdFile, bmtFile);
            const modelInstance = new BMDModelInstance(device, renderHelper, textureHolder, bmdModel);
            modelInstance.passMask = SMSPass.OPAQUE;
            return modelInstance;
        }

        function bckm(bmdFilename: string, bckFilename: string, loopMode: LoopMode = LoopMode.REPEAT): BMDModelInstance {
            const bmdFile = rarc.findFile(bmdFilename);
            const bmdModel = lookupModel(bmdFile, null);
            const modelInstance = new BMDModelInstance(device, renderHelper, textureHolder, bmdModel);
            modelInstance.passMask = SMSPass.OPAQUE;
            const bckFile = rarc.findFile(bckFilename);
            const bck = BCK.parse(bckFile.buffer);
            bck.ank1.loopMode = loopMode;
            modelInstance.bindANK1(bck.ank1);
            return modelInstance;
        }

        function basenameModel(basename: string): BMDModelInstance | null {
            const bmdFile = rarc.findFile(`${basename}.bmd`);
            if (!bmdFile)
                return null;
            const btkFile = rarc.findFile(`${basename}.btk`);
            const brkFile = rarc.findFile(`${basename}.brk`);
            const bckFile = rarc.findFile(`${basename}.bck`);
            const bmtFile = rarc.findFile(`${basename}.bmt`);

            const bmdModel = lookupModel(bmdFile, bmtFile);
            const modelInstance = new BMDModelInstance(device, renderHelper, textureHolder, bmdModel);
            modelInstance.passMask = SMSPass.OPAQUE;

            if (btkFile !== null) {
                const btk = BTK.parse(btkFile.buffer);
                modelInstance.bindTTK1(btk.ttk1);
            }
        
            if (brkFile !== null) {
                const brk = BRK.parse(brkFile.buffer);
                modelInstance.bindTRK1(brk.trk1);
            }
        
            if (bckFile !== null) {
                const bck = BCK.parse(bckFile.buffer);
                modelInstance.bindANK1(bck.ank1);
            }

            modelInstance.name = basename;
            return modelInstance;
        }

        const modelLookup: ModelLookup[] = [
            { k: 'BananaTree', m: 'BananaTree', p: 'mapobj/bananatree' },
            { k: 'BiaTurnBridge', m: 'BiaTurnBridge', s: () => bmtm('mapobj/biaturnbridge.bmd', 'mapobj/bianco.bmt') },
            { k: 'BiaWatermill', m: 'BiaWatermill', s: () => bmtm('mapobj/biawatermill.bmd', 'mapobj/bianco.bmt') },
            { k: 'BrickBlock', m: 'BrickBlock', p: 'mapobj/brickblock' },
            { k: 'Coin', m: 'coin', p: 'mapobj/coin' },
            { k: 'Coin', m: 'invisible_coin', p: 'mapobj/coin' },
            { k: 'Coin', m: 'invisible_coin', p: 'mapobj/coin' },
            { k: 'CoinRed', m: 'coin_red', p: 'mapobj/coin_red' },
            { k: 'CoinBlue', m: 'coin_blue', p: 'mapobj/coin_blue' },
            { k: 'DolWeathercock', m: 'dptWeathercock', p: 'mapobj/dptweathercock' },
            { k: 'Fence', m: 'fence_normal', p: 'mapobj/fence_normal' },
            { k: 'Fence', m: 'fence3x3', p: 'mapobj/fence_half' },
            { k: 'FenceRevolve', m: 'fence_revolve', p: 'mapobj/fence_revolve_outer' },
            { k: 'FenceInner', m: 'fenceInnerGreen', p: 'mapobj/fenceinnergreen' },
            { k: 'FenceWaterH', m: 'FenceWaterH', p: 'mapobj/fencewaterh' },
            { k: 'FenceWaterV', m: 'FenceWaterV', p: 'mapobj/fencewaterv' },
            { k: 'FerrisWheel', m: 'FerrisWheel', p: 'mapobj/ferriswheel' },
            { k: 'IceBlock', m: 'IceBlock', p: 'mapobj/iceblock' },
            { k: 'Manhole', m: 'manhole', p: 'mapobj/manhole' },
            { k: 'MapObjBase', m: 'DokanGate', p: 'mapobj/efdokangate' },
            { k: 'MapObjBase', m: 'ArrowBoardLR', s: () => bmtm('mapobj/arrowboardlr.bmd', 'mapobj/arrowboard.bmt') },
            { k: 'MapObjBase', m: 'ArrowBoardUp', s: () => bmtm('mapobj/arrowboardup.bmd', 'mapobj/arrowboard.bmt') },
            { k: 'MapObjBase', m: 'ArrowBoardDown', s: () => bmtm('mapobj/arrowboarddown.bmd', 'mapobj/arrowboard.bmt') },
            { k: 'MapObjBase', m: 'monte_chair', p: 'mapobj/monte_chair_model' },
            { k: 'MapStaticObj', m: 'ReflectSky', s: () => null },
            // Disable SeaIndirect loading...
            { k: 'MapStaticObj', m: 'SeaIndirect', s: () => null },
            { k: 'Merrygoround', m: 'merry', p: 'mapobj/merry' },
            { k: 'NozzleBox', m: 'NozzleBox', p: 'mapobj/nozzlebox' },
            { k: 'Palm', m: 'palmNormal', p: 'mapobj/palmnormal' },
            { k: 'Palm', m: 'palmLeaf', p: 'mapobj/palmleaf' },
            { k: 'PalmNatume', m: 'palmNatume', p: 'mapobj/palmnatume' },
            { k: 'PalmOugi', m: 'palmOugi', p: 'mapobj/palmougi' },
            { k: 'PinnaDoor', m: 'PinnaDoor', p: 'mapobj/pinnadoor' },
            { k: 'ShellCup', m: 'ShellCup', p: 'mapobj/shellcup' },
            { k: 'Shine', m: 'shine', s: () => bckm('mapobj/shine.bmd', 'mapobj/shine_float.bck') },
            { k: 'Viking', m: 'viking', p: 'mapobj/viking' },
            { k: 'WoodBox', m: 'WoodBox', p: 'mapobj/kibako' },
            { k: 'WoodBarrel', m: 'wood_barrel', s: () => bmtm('mapobj/barrel_normal.bmd', 'mapobj/barrel.bmt') },
        ];

        let modelEntry = modelLookup.find((lt) => obj.klass === lt.k && obj.model === lt.m);
        if (modelEntry === undefined) {
            // Load heuristics -- maybe should be explicit...
            let prefix;
            if (obj.klass === 'MapStaticObj') {
                prefix = `map/map/${obj.model.toLowerCase()}`;
            } else if (obj.klass === 'MapObjBase') {
                prefix = `mapobj/${obj.model.toLowerCase()}`;
            }

            if (prefix) {
                const file = rarc.findFile(`${prefix}.bmd`);
                if (file)
                    modelEntry = { k: obj.klass, m: obj.model, p: prefix };
            }
        }

        if (modelEntry === undefined) {
            console.warn(`No model for ${obj.klass} ${obj.model}`);
            return null;
        }

        let scene = null;
        if (modelEntry.p !== undefined) {
            scene = basenameModel(modelEntry.p);
        } else if (modelEntry.s !== undefined) {
            scene = modelEntry.s();
        }

        if (scene === null)
            return null;

        const q = quat.create();
        quat.fromEuler(q, obj.rotationX, obj.rotationY, obj.rotationZ);
        mat4.fromRotationTranslationScale(scene.modelMatrix, q, [obj.x, obj.y, obj.z], [obj.scaleX, obj.scaleY, obj.scaleZ]);
        return scene;
    }
}

const id = "sms";
const name = "Super Mario Sunshine";

const sceneDescs: Viewer.SceneDesc[] = [
    new SunshineSceneDesc("dolpic0", "Delfino Plaza"),
    new SunshineSceneDesc("airport0", "Delfino Airport"),
    new SunshineSceneDesc("bianco0", "Bianco Hills"),
    new SunshineSceneDesc("ricco0", "Ricco Harbor"),
    new SunshineSceneDesc("mamma0", "Gelato Beach"),
    new SunshineSceneDesc("pinnaBeach0", "Pinna Park Beach"),
    new SunshineSceneDesc("pinnaParco0", "Pinna Park"),
    new SunshineSceneDesc("sirena0", "Sirena Beach"),
    new SunshineSceneDesc("delfino0", "Delfino Hotel"),
    new SunshineSceneDesc("mare0", "Noki Bay"),
    new SunshineSceneDesc("monte3", "Pianta Village"),
];

const sceneIdMap = new Map<string, string>();
for (let i = 0; i < sceneDescs.length; i++)
    sceneIdMap.set(sceneDescs[i].name, sceneDescs[i].id);

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, sceneIdMap };
