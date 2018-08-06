
import ArrayBufferSlice from '../ArrayBufferSlice';
import { RenderState } from '../render';
import { readString } from '../util';

import * as UI from '../ui';
import * as Viewer from '../viewer';

import { BMD, BMT, BTK, BRK, BCK } from './j3d';
import * as Yaz0 from '../compression/Yaz0';
import * as RARC from './rarc';
import { Scene, SceneLoader, J3DTextureHolder } from './render';

export class MultiScene implements Viewer.MainScene {
    public scenes: Scene[];
    public textures: Viewer.Texture[];

    constructor(public textureHolder: J3DTextureHolder, scenes: Scene[]) {
        this.setScenes(scenes);
    }

    public createPanels(): UI.Panel[] {
        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.scenes);
        return [layersPanel];
    }

    public render(state: RenderState): void {
        state.setClipPlanes(20, 500000);
        this.scenes.forEach((scene) => {
            scene.render(state);
        });
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.textureHolder.destroy(gl);
        this.scenes.forEach((scene) => scene.destroy(gl));
    }

    protected setScenes(scenes: Scene[]): void {
        this.scenes = scenes;
        this.textures = this.textureHolder.viewerTextures;
    }
}

export function createScene(gl: WebGL2RenderingContext, textureHolder: J3DTextureHolder, bmdFile: RARC.RARCFile, btkFile: RARC.RARCFile, brkFile: RARC.RARCFile, bckFile: RARC.RARCFile, bmtFile: RARC.RARCFile) {
    const bmd = BMD.parse(bmdFile.buffer);
    const bmt = bmtFile ? BMT.parse(bmtFile.buffer) : null;
    textureHolder.addJ3DTextures(gl, bmd, bmt);
    const sceneLoader: SceneLoader = new SceneLoader(textureHolder, bmd, bmt);
    const scene = sceneLoader.createScene(gl);
    scene.setBTK(btkFile ? BTK.parse(btkFile.buffer) : null);
    scene.setBRK(brkFile ? BRK.parse(brkFile.buffer) : null);
    scene.setBCK(bckFile ? BCK.parse(bckFile.buffer) : null);
    return scene;
}

function boolSort(a: boolean, b: boolean): number {
    if (a && !b)
        return -1;
    else if (b && !a)
        return 1;
    else
        return 0;
}

export function createScenesFromBuffer(gl: WebGL2RenderingContext, textureHolder: J3DTextureHolder, buffer: ArrayBufferSlice): Promise<Scene[]> {
    return Promise.resolve(buffer).then((buffer: ArrayBufferSlice) => {
        if (readString(buffer, 0, 4) === 'Yaz0')
            return Yaz0.decompress(buffer);
        else
            return buffer;
    }).then((buffer: ArrayBufferSlice) => {
        if (readString(buffer, 0, 4) === 'RARC') {
            const rarc = RARC.parse(buffer);
            const bmdFiles = rarc.files.filter((f) => f.name.endsWith('.bmd') || f.name.endsWith('.bdl'));
            let scenes = bmdFiles.map((bmdFile) => {
                // Find the corresponding btk.
                const basename = bmdFile.name.split('.')[0];
                const btkFile = rarc.files.find((f) => f.name === `${basename}.btk`);
                const brkFile = rarc.files.find((f) => f.name === `${basename}.brk`);
                const bckFile = rarc.files.find((f) => f.name === `${basename}.bck`);
                const bmtFile = rarc.files.find((f) => f.name === `${basename}.bmt`);
                let scene;
                try {
                    scene = createScene(gl, textureHolder, bmdFile, btkFile, brkFile, bckFile, bmtFile);
                } catch(e) {
                    console.warn(`File ${basename} failed to parse:`, e);
                    return null;
                }
                scene.name = basename;
                if (basename.includes('_sky'))
                    scene.setIsSkybox(true);
                return scene;
            });

            scenes = scenes.filter((scene) => !!scene);

            // Sort skyboxen before non-skyboxen.
            scenes = scenes.sort((a, b) => {
                return boolSort(a.isSkybox, b.isSkybox);
            });

            return scenes;
        }

        if (['J3D2bmd3', 'J3D2bdl4'].includes(readString(buffer, 0, 8))) {
            const bmd = BMD.parse(buffer);
            textureHolder.addJ3DTextures(gl, bmd);
            const sceneLoader = new SceneLoader(textureHolder, bmd);
            const scene = sceneLoader.createScene(gl);
            return [scene];
        }

        return null;
    });
}

export function createMultiSceneFromBuffer(gl: WebGL2RenderingContext, buffer: ArrayBufferSlice): Promise<MultiScene> {
    const textureHolder = new J3DTextureHolder();
    return createScenesFromBuffer(gl, textureHolder, buffer).then((scenes) => {
        return new MultiScene(textureHolder, scenes);
    });
}
