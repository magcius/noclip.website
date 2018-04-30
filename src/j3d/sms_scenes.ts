
import ArrayBufferSlice from 'ArrayBufferSlice';
import Progressable from 'Progressable';
import { fetch, readString, assert } from 'util';

import { RenderState, ColorTarget } from '../render';
import * as Viewer from '../viewer';
import * as Yaz0 from '../yaz0';

import * as RARC from './rarc';
import { ColorOverride, Scene, TextureOverride } from './render';
import { createScene } from './scenes';
import { EFB_WIDTH, EFB_HEIGHT } from '../gx/gx_material';
import { mat4, quat } from 'gl-matrix';
import { BMD, BCK, LoopMode } from './j3d';

function collectTextures(scenes: Viewer.Scene[]): Viewer.Texture[] {
    const textures: Viewer.Texture[] = [];
    for (const scene of scenes)
        if (scene)
            textures.push.apply(textures, scene.textures);
    return textures;
}

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
        const [r, g, b, a] = unpack(params, 'BBBB');
        return { type: 'AmbColor', klass, name, size, r, g, b, a };
    }
    case 'Light':
    {
        const [x, y, z, r, g, b, a, intensity] = unpack(params, 'fffBBBBf');
        return { type: 'Light', klass, name, size, x, y, z, r, g, b, a, intensity };
    }
    // Models
    case 'BananaTree':
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
        // XXX(jstpierre): MapObjBase AirportPole seemingly has extra junk after it?
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

export class SunshineRenderer implements Viewer.MainScene {
    public textures: Viewer.Texture[] = [];
    private mainColorTarget: ColorTarget = new ColorTarget();

    constructor(public skyScene: Viewer.Scene, public mapScene: Viewer.Scene, public seaScene: Viewer.Scene, public seaIndirectScene: Scene, public extraScenes: Scene[], public rarc: RARC.RARC = null) {
        this.textures = collectTextures([skyScene, mapScene, seaScene, seaIndirectScene].concat(extraScenes));
    }

    public render(state: RenderState): void {
        const gl = state.gl;

        this.mainColorTarget.setParameters(gl, state.onscreenColorTarget.width, state.onscreenColorTarget.height);
        state.useRenderTarget(this.mainColorTarget);
        gl.clearColor(0, 0, 0.125, 1);
        gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);

        if (this.skyScene) {
            this.skyScene.render(state);
            gl.clear(gl.DEPTH_BUFFER_BIT);
        }

        if (this.mapScene)
            this.mapScene.render(state);
        if (this.seaScene)
            this.seaScene.render(state);

        for (const scene of this.extraScenes)
            scene.render(state);

        // Copy to main render target.
        state.useRenderTarget(state.onscreenColorTarget);
        state.blitColorTarget(this.mainColorTarget);

        // XXX(jstpierre): does sea go before or after seaindirect?
        if (this.seaIndirectScene) {
            const indirectScene = this.seaIndirectScene;
            const texProjection = indirectScene.materialCommands[0].material.texMatrices[1].projectionMatrix;
            // The normal texture projection is hardcoded for the Gamecube's projection matrix. Copy in our own.
            texProjection[0] = state.projection[0];
            texProjection[5] = -state.projection[5];
            const textureOverride: TextureOverride = { glTexture: this.mainColorTarget.resolvedColorTexture, width: EFB_WIDTH, height: EFB_HEIGHT };
            indirectScene.setTextureOverride("indirectdummy", textureOverride);
            indirectScene.render(state);
        }
    }

    public destroy(gl: WebGL2RenderingContext): void {
        if (this.skyScene)
            this.skyScene.destroy(gl);
        if (this.mapScene)
            this.mapScene.destroy(gl);
        if (this.seaScene)
            this.seaScene.destroy(gl);
        this.extraScenes.forEach((scene) => scene.destroy(gl));
    }
}

export class SunshineSceneDesc implements Viewer.SceneDesc {
    public static createSunshineSceneForBasename(gl: WebGL2RenderingContext, rarc: RARC.RARC, basename: string, isSkybox: boolean): Scene {
        const bmdFile = rarc.findFile(`${basename}.bmd`);
        if (!bmdFile)
            return null;
        const btkFile = rarc.findFile(`${basename}.btk`);
        const brkFile = rarc.findFile(`${basename}.brk`);
        const bckFile = rarc.findFile(`${basename}.bck`);
        const bmtFile = rarc.findFile(`${basename}.bmt`);
        const scene = createScene(gl, bmdFile, btkFile, brkFile, bckFile, bmtFile);
        scene.name = basename;
        scene.setIsSkybox(isSkybox);
        return scene;
    }

    public id: string;

    constructor(public path: string, public name: string) {
        this.name = name;
        this.path = path;
        this.id = this.name;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        return fetch(this.path).then((result: ArrayBufferSlice) => {
            const rarc = RARC.parse(Yaz0.decompress(result));

            const sceneBin = rarc.findFile('map/scene.bin');
            const sceneBinObj = readSceneBin(sceneBin.buffer);

            const skyScene = SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, 'map/map/sky', true);
            const mapScene = SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, 'map/map/map', false);
            const seaScene = SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, 'map/map/sea', false);
            const seaIndirectScene = SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, 'map/map/seaindirect', false);

            const extraScenes = this.createSceneBinObjects(gl, rarc, sceneBinObj);

            return new SunshineRenderer(skyScene, mapScene, seaScene, seaIndirectScene, extraScenes, rarc);
        });
    }

    private createSceneBinObjects(gl: WebGL2RenderingContext, rarc: RARC.RARC, obj: SceneBinObj): Scene[] {
        function flatten<T>(L: T[][]): T[] {
            const R: T[] = [];
            for (const Ts of L)
                R.push.apply(R, Ts);
            return R;
        }

        switch (obj.type) {
        case 'Group':
            const childTs: Scene[][] = obj.children.map(c => this.createSceneBinObjects(gl, rarc, c));
            const flattened: Scene[] = flatten(childTs).filter(o => !!o);
            return flattened;
        case 'Model':
            return [this.createSceneForSceneBinModel(gl, rarc, obj)];
        default:
            // Don't care.
            return undefined;
        }
    }

    private createSceneForSceneBinModel(gl: WebGL2RenderingContext, rarc: RARC.RARC, obj: SceneBinObjModel): Scene {
        interface ModelLookup {
            k: string; // klass
            m: string; // model
            p?: string; // resulting file prefix
            s?: () => Scene;
        };

        function bmtm(bmd: string, bmt: string) {
            const bmdFile = rarc.findFile(bmd);
            const bmtFile = rarc.findFile(bmt);
            return createScene(gl, bmdFile, null, null, null, bmtFile);
        }

        function bckm(bmdFilename: string, bckFilename: string, loopMode: LoopMode = LoopMode.REPEAT) {
            const bmd = BMD.parse(rarc.findFile(bmdFilename).buffer);
            const bck = BCK.parse(rarc.findFile(bckFilename).buffer);
            bck.ank1.loopMode = loopMode;
            return new Scene(gl, bmd, null, null, bck, null);
        }

        const modelLookup: ModelLookup[] = [
            { k: 'BananaTree', m: 'BananaTree', p: 'mapobj/bananatree' },
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
            { k: 'MapStaticObj', m: 'ReflectSky', s: () => bmtm('map/map/reflectsky.bmd', 'map/map/sky.bmt') },
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
            scene = SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, modelEntry.p, false);
        } else if (modelEntry.s !== undefined) {
            scene = modelEntry.s();
        }

        const q = quat.create();
        quat.fromEuler(q, obj.rotationX, obj.rotationY, obj.rotationZ);
        mat4.fromRotationTranslationScale(scene.modelMatrix, q, [obj.x, obj.y, obj.z], [obj.scaleX, obj.scaleY, obj.scaleZ]);
        return scene;
    }
}

const id = "sms";
const name = "Super Mario Sunshine";

const sceneDescs: Viewer.SceneDesc[] = [
    new SunshineSceneDesc("data/j3d/sms/dolpic0.szs", "Delfino Plaza"),
    new SunshineSceneDesc("data/j3d/sms/airport0.szs", "Delfino Airport"),
    new SunshineSceneDesc("data/j3d/sms/bianco0.szs", "Bianco Hills"),
    new SunshineSceneDesc("data/j3d/sms/ricco0.szs", "Ricco Harbor"),
    new SunshineSceneDesc("data/j3d/sms/mamma0.szs", "Gelato Beach"),
    new SunshineSceneDesc("data/j3d/sms/pinnaBeach0.szs", "Pinna Park Beach"),
    new SunshineSceneDesc("data/j3d/sms/pinnaParco0.szs", "Pinna Park"),
    new SunshineSceneDesc("data/j3d/sms/sirena0.szs", "Sirena Beach"),
    new SunshineSceneDesc("data/j3d/sms/delfino0.szs", "Delfino Hotel"),
    new SunshineSceneDesc("data/j3d/sms/mare0.szs", "Noki Bay"),
    new SunshineSceneDesc("data/j3d/sms/monte3.szs", "Pianta Village"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
