
import ArrayBufferSlice from 'ArrayBufferSlice';
import Progressable from 'Progressable';
import { assert, fetch, readString, generateFormID } from 'util';

import * as Viewer from '../viewer';
import * as Yaz0 from '../yaz0';

import { BMD, BMT, BTK, BTI_Texture, BTI } from './j3d';
import * as RARC from './rarc';
import { Scene } from './render';
import { RenderState } from '../render';

function createScene(gl: WebGL2RenderingContext, bmdFile: RARC.RARCFile, btkFile: RARC.RARCFile, bmtFile: RARC.RARCFile, extraTextures: BTI_Texture[]) {
    const bmd = BMD.parse(bmdFile.buffer);
    const btk = btkFile ? BTK.parse(btkFile.buffer) : null;
    const bmt = bmtFile ? BMT.parse(bmtFile.buffer) : null;
    return new Scene(gl, bmd, btk, bmt, extraTextures);
}

function createScenesFromBuffer(gl: WebGL2RenderingContext, rarcName: string, buffer: ArrayBufferSlice, extraTextures: BTI_Texture[]): Scene[] {
    buffer = Yaz0.decompress(buffer);
    const rarc = RARC.parse(buffer);
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

class TwilightPrincessScene implements Viewer.MainScene {
    public textures: Viewer.Texture[] = [];

    constructor(public skyboxScenes: Scene[], public roomScenes: Scene[]) {
        this.skyboxScenes = skyboxScenes;
        this.roomScenes = roomScenes;

        for (const scene of [...this.skyboxScenes, ...this.roomScenes])
            this.textures = this.textures.concat(scene.textures);
    }

    public createUI(): HTMLElement {
        const elem = document.createElement('div');
        elem.style.backgroundColor = 'white';
        elem.style.border = '1px solid #999';
        elem.style.font = '100% sans-serif';
        elem.style.boxSizing = 'border-box';
        elem.style.padding = '1em';

        elem.onmouseover = () => {
            elem.style.width = 'auto';
            elem.style.height = 'auto';
        };
        elem.onmouseout = () => {
            elem.style.width = '0';
            elem.style.height = '0';
        };
        elem.onmouseout(null);

        this.roomScenes.forEach((scene) => {
            const line = document.createElement('div');
            line.style.textAlign = 'right';
            line.style.overflow = 'hidden';

            const checkbox = document.createElement('input');
            checkbox.id = generateFormID();

            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.onchange = () => {
                scene.visible = checkbox.checked;
            };

            const label = document.createElement('label');
            label.textContent = scene.name;
            label.htmlFor = checkbox.id;

            line.appendChild(label);
            line.appendChild(checkbox);

            elem.appendChild(line);
        });

        return elem;
    }

    public render(state: RenderState) {
        const gl = state.gl;
        this.skyboxScenes.forEach((scene) => {
            scene.render(state);
        });
        gl.clear(gl.DEPTH_BUFFER_BIT);
        this.roomScenes.forEach((scene) => {
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
            const roomScenes_: Scene[][] = roomBuffers.map((buffer: ArrayBufferSlice, i: number) => {
                const rarcBasename = this.roomPaths[i].split('.')[0];
                console.log(rarcBasename);
                return createScenesFromBuffer(gl, rarcBasename, buffer, extraTextures);
            });
            const roomScenes: Scene[] = [];
            roomScenes_.forEach((scenes: Scene[]) => roomScenes.push.apply(roomScenes, scenes));

            return new TwilightPrincessScene(skyboxScenes, roomScenes);
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
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
