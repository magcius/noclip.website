
import ArrayBufferSlice from 'ArrayBufferSlice';
import Progressable from 'Progressable';
import { assert, fetch, readString, generateFormID } from 'util';

import * as Viewer from '../viewer';
import * as Yaz0 from '../yaz0';

import * as GX from '../gx/gx_enum';

import { BMD, BMT, BTK, BTI_Texture, BTI } from './j3d';
import * as RARC from './rarc';
import { Scene } from './render';
import { RenderState } from '../render';

// XXX(jstpierre): Figure out WTF is up with Twilight Princess materials.
function hackMaterials1(bmd: BMD): void {
    for (const material of bmd.mat3.materialEntries) {
        for (const stage of material.gxMaterial.tevStages)
            if (stage.colorScale === GX.TevScale.SCALE_4)
                stage.colorScale = GX.TevScale.SCALE_1;
    }
}

function hackMaterials2(scene: Scene): void {
    for (const materialCommand of scene.materialCommands) {
        // Kill any indtex materials...
        for (const texIndex of materialCommand.material.textureIndexes)
            if (texIndex >= 0 && scene.btiTextures[scene.textureRemapTable[texIndex]].name === 'fbtex_dummy')
                materialCommand.visible = false;
    }
}

function createScene(gl: WebGL2RenderingContext, bmdFile: RARC.RARCFile, btkFile: RARC.RARCFile, bmtFile: RARC.RARCFile, extraTextures: BTI_Texture[]) {
    const bmd = BMD.parse(bmdFile.buffer);
    hackMaterials1(bmd);
    const btk = btkFile ? BTK.parse(btkFile.buffer) : null;
    const bmt = bmtFile ? BMT.parse(bmtFile.buffer) : null;
    const scene = new Scene(gl, bmd, btk, bmt, extraTextures);
    hackMaterials2(scene);
    return scene;
}

function createScenesFromRARC(gl: WebGL2RenderingContext, rarcName: string, rarc: RARC.RARC, extraTextures: BTI_Texture[]): Scene[] {
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

    constructor(public stageRarc: RARC.RARC, public roomRarcs: RARC.RARC[], public skyboxScenes: Scene[], public roomScenes: Scene[]) {
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
        elem.style.overflow = 'hidden';

        elem.onmouseover = () => {
            elem.style.width = 'auto';
            elem.style.height = 'auto';
        };
        elem.onmouseout = () => {
            elem.style.width = '0';
            elem.style.height = '0';
        };
        elem.onmouseout(null);

        const selectAll = document.createElement('button');
        selectAll.textContent = 'All';
        selectAll.onclick = () => {
            for (const checkbox of checkboxes) {
                checkbox.checked = true;
                checkbox.onchange(null);
            }
        };
        selectAll.style.display = 'block';
        selectAll.style.width = '100%';
        elem.appendChild(selectAll);

        const selectNone = document.createElement('button');
        selectNone.textContent = 'None';
        selectNone.onclick = () => {
            for (const checkbox of checkboxes) {
                checkbox.checked = false;
                checkbox.onchange(null);
            }
        };
        selectNone.style.display = 'block';
        selectNone.style.width = '100%';
        elem.appendChild(selectNone);

        const checkboxes: HTMLInputElement[] = [];
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
            checkboxes.push(checkbox);

            const label = document.createElement('label');
            label.textContent = scene.name;
            label.htmlFor = checkbox.id;
            label.style.webkitUserSelect = 'none';
            label.style.userSelect = 'none';

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

            return new TwilightPrincessScene(stageRarc, roomRarcs, skyboxScenes, roomScenes);
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
