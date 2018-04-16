
import ArrayBufferSlice from 'ArrayBufferSlice';
import Progressable from 'Progressable';
import { assert, fetch, readString, generateFormID } from 'util';

import * as Viewer from '../viewer';
import * as Yaz0 from '../yaz0';
import * as UI from '../ui';

import * as GX from '../gx/gx_enum';

import { BMD, BMT, BTK, BTI_Texture, BTI, TEX1_TextureData } from './j3d';
import * as RARC from './rarc';
import { Scene, TextureOverride } from './render';
import { RenderState, RenderTarget } from '../render';
import { EFB_WIDTH, EFB_HEIGHT } from '../gx/gx_material';

function collectTextures(scenes: Viewer.Scene[]): Viewer.Texture[] {
    const textures: Viewer.Texture[] = [];
    for (const scene of scenes)
        if (scene)
            textures.push.apply(textures, scene.textures);
    return textures;
}

function createScene(gl: WebGL2RenderingContext, bmdFile: RARC.RARCFile, btkFile: RARC.RARCFile, bmtFile: RARC.RARCFile, extraTextures: TEX1_TextureData[]) {
    const bmd = BMD.parse(bmdFile.buffer);
    const btk = btkFile ? BTK.parse(btkFile.buffer) : null;
    const bmt = bmtFile ? BMT.parse(bmtFile.buffer) : null;
    const scene = new Scene(gl, bmd, btk, bmt, extraTextures);
    return scene;
}

function createScenesFromRARC(gl: WebGL2RenderingContext, rarcName: string, rarc: RARC.RARC, extraTextures: TEX1_TextureData[]): Scene[] {
    const bmdFiles = rarc.files.filter((f) => f.name.endsWith('.bmd') || f.name.endsWith('.bdl'));
    const scenes = bmdFiles.map((bmdFile) => {
        const basename = bmdFile.name.split('.')[0];
        const btkFile = rarc.files.find((f) => f.name === `${basename}.btk`);
        const bmtFile = rarc.files.find((f) => f.name === `${basename}.bmt`);
        const scene = createScene(gl, bmdFile, btkFile, bmtFile, extraTextures);
        scene.name = `${rarcName}/${basename}`;
        return scene;
    });

    return scenes.filter((s) => !!s);
}

class TwilightPrincessRenderer implements Viewer.MainScene {
    public textures: Viewer.Texture[] = [];

    private mainRenderTarget: RenderTarget = new RenderTarget();
    private opaqueScenes: Scene[] = [];
    private indTexScenes: Scene[] = [];
    private transparentScenes: Scene[] = [];
    private windowScenes: Scene[] = [];

    constructor(public stageRarc: RARC.RARC, public roomRarcs: RARC.RARC[], public skyboxScenes: Scene[], public roomScenes: Scene[]) {
        this.textures = collectTextures([...this.skyboxScenes, ...this.roomScenes]);

        this.roomScenes.forEach((scene) => {
            if (scene.name.endsWith('model')) {
                this.opaqueScenes.push(scene);
            } else if (scene.name.endsWith('model1')) {
                this.indTexScenes.push(scene);
            } else if (scene.name.endsWith('model2')) {
                this.transparentScenes.push(scene);
            } else if (scene.name.endsWith('model3')) {
                this.windowScenes.push(scene);
            } else if (scene.name.endsWith('model4')) {
                this.transparentScenes.push(scene);
             } else {
                throw "whoops";
            }
        });
    }

    public createPanels(): UI.Panel[] {
        const layers = new UI.LayerPanel();
        layers.setLayers(this.roomScenes);
        return [layers];
    }

    public render(state: RenderState) {
        const gl = state.gl;

        // Draw skybox + opaque to main RT.
        this.mainRenderTarget.setParameters(gl, state.currentRenderTarget.width, state.currentRenderTarget.height);
        state.useRenderTarget(this.mainRenderTarget);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.skyboxScenes.forEach((scene) => {
            scene.render(state);
        });
        gl.clear(gl.DEPTH_BUFFER_BIT);

        this.opaqueScenes.forEach((scene) => {
            scene.render(state);
        });

        // Copy to main render target.
        state.useRenderTarget(null);
        state.blitRenderTarget(this.mainRenderTarget);
        state.blitRenderTargetDepth(this.mainRenderTarget);

        // IndTex.
        this.indTexScenes.forEach((indirectScene) => {
            const texProjection = indirectScene.materialCommands[0].material.texMatrices[0].projectionMatrix;
            // The normal texture projection is hardcoded for the Gamecube's projection matrix. Copy in our own.
            texProjection[0] = state.projection[0];
            texProjection[5] = -state.projection[5];
            const textureOverride: TextureOverride = { glTexture: this.mainRenderTarget.resolvedColorTexture, width: EFB_WIDTH, height: EFB_HEIGHT };
            indirectScene.setTextureOverride("fbtex_dummy", textureOverride);
            indirectScene.render(state);
        });

        // Transparent.
        this.transparentScenes.forEach((scene) => {
            scene.render(state);
        });

        // Window & Doorway fades. Separate so that the renderer can override color registers separately.
        // We don't do anything about this yet...
        this.windowScenes.forEach((scene) => {
            scene.render(state);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.skyboxScenes.forEach((scene) => scene.destroy(gl));
        this.roomScenes.forEach((scene) => scene.destroy(gl));
    }
}

class TwilightPrincessSceneDesc implements Viewer.SceneDesc {
    public id: string;

    constructor(public name: string, public folder: string, public roomPaths: string[]) {
        this.id = this.folder;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        const basePath = `data/j3d/ztp/${this.folder}`;
        const paths = [`STG_00.arc`, ...this.roomPaths].map((path) => `${basePath}/${path}`);
        return Progressable.all(paths.map((path) => fetch(path))).then((buffers: ArrayBufferSlice[]): Viewer.MainScene => {
            const stageBuffer = Yaz0.decompress(buffers.shift());
            const stageRarc = RARC.parse(stageBuffer);
            const texcFolder = stageRarc.findDir(`texc`);
            const extraTextureFiles = texcFolder !== null ? texcFolder.files : [];
            const extraTextures = extraTextureFiles.map((file) => {
                const name = file.name.split('.')[0];
                return BTI.parse(file.buffer, name).texture;
            });

            const skyboxScenes: Scene[] = [`vrbox_sora`, `vrbox_kasumim`].map((basename) => {
                const bmdFile = stageRarc.findFile(`bmdp/${basename}.bmd`);
                if (!bmdFile)
                    return null;
                const btkFile = stageRarc.findFile(`btk/${basename}.btk`);
                const scene = createScene(gl, bmdFile, btkFile, null, extraTextures);
                scene.setIsSkybox(true);
                return scene;
            }).filter((s) => !!s);

            const roomBuffers = buffers;
            const roomRarcs: RARC.RARC[] = roomBuffers.map((buffer: ArrayBufferSlice) => {
                buffer = Yaz0.decompress(buffer);
                return RARC.parse(buffer);
            });
            const roomScenes_: Scene[][] = roomRarcs.map((rarc: RARC.RARC, i: number) => {
                const rarcBasename = this.roomPaths[i].split('.')[0];
                return createScenesFromRARC(gl, rarcBasename, rarc, extraTextures);
            });
            const roomScenes: Scene[] = [];
            roomScenes_.forEach((scenes: Scene[]) => roomScenes.push.apply(roomScenes, scenes));

            return new TwilightPrincessRenderer(stageRarc, roomRarcs, skyboxScenes, roomScenes);
        });
    }
}

const id = "ztp";
const name = "The Legend of Zelda: Twilight Princess";

const sceneDescs: Viewer.SceneDesc[] = [
    new TwilightPrincessSceneDesc("Forest Temple", "D_MN05", ["R02_00.arc", "R03_00.arc", "R04_00.arc", "R05_00.arc", "R07_00.arc", "R09_00.arc", "R10_00.arc", "R11_00.arc", "R12_00.arc", "R19_00.arc", "R22_00.arc", "R00_00.arc", "R01_00.arc"]),
    new TwilightPrincessSceneDesc("Goron Mines", "D_MN04", ["R11_00.arc", "R12_00.arc", "R13_00.arc", "R14_00.arc", "R16_00.arc", "R17_00.arc", "R01_00.arc", "R03_00.arc", "R04_00.arc", "R05_00.arc", "R06_00.arc", "R07_00.arc", "R09_00.arc"]),
    new TwilightPrincessSceneDesc("Lakebed Temple", "D_MN01", ["R00_00.arc", "R01_00.arc", "R02_00.arc", "R03_00.arc", "R05_00.arc", "R06_00.arc", "R07_00.arc", "R08_00.arc", "R09_00.arc", "R10_00.arc", "R11_00.arc", "R12_00.arc", "R13_00.arc"]),
    new TwilightPrincessSceneDesc("Arbiter's Grounds", "D_MN10", ["R01_00.arc", "R02_00.arc", "R03_00.arc", "R04_00.arc", "R05_00.arc", "R06_00.arc", "R07_00.arc", "R08_00.arc", "R09_00.arc", "R10_00.arc", "R11_00.arc", "R12_00.arc", "R13_00.arc", "R14_00.arc", "R15_00.arc", "R16_00.arc", "R00_00.arc"]),
    new TwilightPrincessSceneDesc("Snowpeak Ruins", "D_MN11", ["R00_00.arc", "R01_00.arc", "R02_00.arc", "R03_00.arc", "R04_00.arc", "R05_00.arc", "R06_00.arc", "R07_00.arc", "R08_00.arc", "R09_00.arc", "R11_00.arc", "R13_00.arc"]),
    new TwilightPrincessSceneDesc("Temple of Time", "D_MN06", ["R08_00.arc", "R00_00.arc", "R01_00.arc", "R02_00.arc", "R03_00.arc", "R04_00.arc", "R05_00.arc", "R06_00.arc", "R07_00.arc"]),
    new TwilightPrincessSceneDesc("City in the Sky", "D_MN07", ["R00_00.arc", "R01_00.arc", "R02_00.arc", "R03_00.arc", "R04_00.arc", "R05_00.arc", "R06_00.arc", "R07_00.arc", "R08_00.arc", "R10_00.arc", "R11_00.arc", "R12_00.arc", "R13_00.arc", "R14_00.arc", "R15_00.arc", "R16_00.arc"]),
    new TwilightPrincessSceneDesc("Palace of Twilight", "D_MN08", ["R00_00.arc", "R01_00.arc", "R02_00.arc", "R04_00.arc", "R05_00.arc", "R07_00.arc", "R08_00.arc", "R09_00.arc", "R10_00.arc", "R11_00.arc"]),
    new TwilightPrincessSceneDesc("Hyrule Castle", "D_MN09", ["R03_00.arc", "R04_00.arc", "R05_00.arc", "R06_00.arc", "R08_00.arc", "R09_00.arc", "R11_00.arc", "R12_00.arc", "R13_00.arc", "R14_00.arc", "R15_00.arc", "R01_00.arc", "R02_00.arc"]),
    new TwilightPrincessSceneDesc("Hyrule Field", "F_SP102", ["R00_00.arc"]),
    new TwilightPrincessSceneDesc("Fishing Pond", "F_SP127", ["R00_00.arc"]),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
