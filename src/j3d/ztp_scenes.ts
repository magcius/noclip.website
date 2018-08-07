
import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';
import { fetch } from '../util';

import * as Viewer from '../viewer';
import * as Yaz0 from '../compression/Yaz0';
import * as UI from '../ui';

import { BMD, BMT, BTK, BTI, TEX1_TextureData, BRK, BCK } from './j3d';
import * as RARC from './rarc';
import { Scene, SceneLoader, J3DTextureHolder } from './render';
import { RenderState, ColorTarget, depthClearFlags } from '../render';
import { EFB_WIDTH, EFB_HEIGHT } from '../gx/gx_material';
import { TextureOverride } from '../TextureHolder';

class ZTPTextureHolder extends J3DTextureHolder {
    protected tryTextureNameVariants(name: string): string[] {
        const extraTextureName = `ExtraTex/${name.toLowerCase().replace('.tga', '')}`;
        return [name, extraTextureName];
    }

    public addExtraTextures(gl: WebGL2RenderingContext, extraTextures: TEX1_TextureData[]): void {
        this.addTextures(gl, extraTextures.map((texture) => {
            const name = `ExtraTex/${texture.name.toLowerCase()}`;
            return { ...texture, name };
        }));
    }
}

function createScene(gl: WebGL2RenderingContext, textureHolder: J3DTextureHolder, bmdFile: RARC.RARCFile, btkFile: RARC.RARCFile, brkFile: RARC.RARCFile, bckFile: RARC.RARCFile, bmtFile: RARC.RARCFile) {
    const bmd = BMD.parse(bmdFile.buffer);
    const bmt = bmtFile ? BMT.parse(bmtFile.buffer) : null;
    textureHolder.addJ3DTextures(gl, bmd, bmt);
    const sceneLoader = new SceneLoader(textureHolder, bmd, bmt);
    const scene = sceneLoader.createScene(gl);

    if (btkFile !== null) {
        const btk = BTK.parse(btkFile.buffer);
        scene.bindTTK1(btk.ttk1);
    }

    if (brkFile !== null) {
        const brk = BRK.parse(brkFile.buffer);
        scene.bindTRK1(brk.trk1);
    }

    if (bckFile !== null) {
        const bck = BCK.parse(bckFile.buffer);
        scene.bindANK1(bck.ank1);
    }

    return scene;
}

function createScenesFromRARC(gl: WebGL2RenderingContext, textureHolder: J3DTextureHolder, rarcName: string, rarc: RARC.RARC): Scene[] {
    const bmdFiles = rarc.files.filter((f) => f.name.endsWith('.bmd') || f.name.endsWith('.bdl'));
    const scenes = bmdFiles.map((bmdFile) => {
        const basename = bmdFile.name.split('.')[0];
        const btkFile = rarc.files.find((f) => f.name === `${basename}.btk`);
        const brkFile = rarc.files.find((f) => f.name === `${basename}.brk`);
        const bckFile = rarc.files.find((f) => f.name === `${basename}.bck`);
        const bmtFile = rarc.files.find((f) => f.name === `${basename}.bmt`);
        const scene = createScene(gl, textureHolder, bmdFile, btkFile, brkFile, bckFile, bmtFile);
        scene.name = `${rarcName}/${basename}`;
        return scene;
    });

    return scenes.filter((s) => !!s);
}

class TwilightPrincessRenderer implements Viewer.MainScene {
    public textures: Viewer.Texture[] = [];

    private mainColorTarget: ColorTarget = new ColorTarget();
    private opaqueScenes: Scene[] = [];
    private indTexScenes: Scene[] = [];
    private transparentScenes: Scene[] = [];
    private windowScenes: Scene[] = [];

    constructor(private textureHolder: J3DTextureHolder, public stageRarc: RARC.RARC, public roomRarcs: RARC.RARC[], public skyboxScenes: Scene[], public roomScenes: Scene[]) {
        this.textures = textureHolder.viewerTextures;

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
        this.mainColorTarget.setParameters(gl, state.onscreenColorTarget.width, state.onscreenColorTarget.height);
        state.useRenderTarget(this.mainColorTarget);
        state.setClipPlanes(20, 500000);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.skyboxScenes.forEach((scene) => {
            scene.render(state);
        });
        state.useFlags(depthClearFlags);
        gl.clear(gl.DEPTH_BUFFER_BIT);

        this.opaqueScenes.forEach((scene) => {
            scene.render(state);
        });

        // Copy to main render target.
        state.useRenderTarget(state.onscreenColorTarget);
        state.blitColorTarget(this.mainColorTarget);

        // IndTex.
        if (this.indTexScenes.length) {
            const textureOverride: TextureOverride = { glTexture: this.mainColorTarget.resolvedColorTexture, width: EFB_WIDTH, height: EFB_HEIGHT, flipY: true };
            this.textureHolder.setTextureOverride("fbtex_dummy", textureOverride);
        }

        this.indTexScenes.forEach((indirectScene) => {
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
        this.textureHolder.destroy(gl);
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

        const textureHolder = new ZTPTextureHolder();

        return Progressable.all(paths.map(path => this.fetchRarc(path))).then((rarcs: RARC.RARC[]): Viewer.MainScene => {
            const stageRarc = rarcs.shift();
            const texcFolder = stageRarc.findDir(`texc`);
            const extraTextureFiles = texcFolder !== null ? texcFolder.files : [];
            const extraTextures = extraTextureFiles.map((file) => {
                const name = file.name.split('.')[0];
                return BTI.parse(file.buffer, name).texture;
            });

            textureHolder.addExtraTextures(gl, extraTextures);

            const skyboxScenes: Scene[] = [`vrbox_sora`, `vrbox_kasumim`].map((basename) => {
                const bmdFile = stageRarc.findFile(`bmdp/${basename}.bmd`);
                if (!bmdFile)
                    return null;
                const btkFile = stageRarc.findFile(`btk/${basename}.btk`);
                const brkFile = stageRarc.findFile(`brk/${basename}.brk`);
                const bckFile = stageRarc.findFile(`bck/${basename}.bck`);
                const scene = createScene(gl, textureHolder, bmdFile, btkFile, brkFile, bckFile, null);
                scene.setIsSkybox(true);
                return scene;
            }).filter((s) => !!s);

            const roomRarcs: RARC.RARC[] = rarcs;
            const roomScenes_: Scene[][] = roomRarcs.map((rarc: RARC.RARC, i: number) => {
                const rarcBasename = this.roomPaths[i].split('.')[0];
                return createScenesFromRARC(gl, textureHolder, rarcBasename, rarc);
            });
            const roomScenes: Scene[] = [];
            roomScenes_.forEach((scenes: Scene[]) => roomScenes.push.apply(roomScenes, scenes));

            return new TwilightPrincessRenderer(textureHolder, stageRarc, roomRarcs, skyboxScenes, roomScenes);
        });
    }

    private fetchRarc(path: string): Progressable<RARC.RARC> {
        return fetch(path).then((buffer: ArrayBufferSlice) => {
            return Yaz0.decompress(buffer);
        }).then((buffer: ArrayBufferSlice) => {
            return RARC.parse(buffer);
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
