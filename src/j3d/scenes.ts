
import ArrayBufferSlice from '../ArrayBufferSlice';
import { RenderState } from '../render';
import { readString } from '../util';

import * as UI from '../ui';
import * as Viewer from '../viewer';

import { BMD, BMT, BTK, BRK, BCK } from './j3d';
import * as Yaz0 from '../compression/Yaz0';
import * as RARC from './rarc';
import { BMDModelInstance, J3DTextureHolder, BMDModel } from './render';

export class MultiScene implements Viewer.MainScene {
    public scenes: BMDModelInstance[];

    constructor(public textureHolder: J3DTextureHolder, scenes: BMDModelInstance[]) {
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

    protected setScenes(scenes: BMDModelInstance[]): void {
        this.scenes = scenes;
    }
}

export function createScene(gl: WebGL2RenderingContext, textureHolder: J3DTextureHolder, bmdFile: RARC.RARCFile, btkFile: RARC.RARCFile | null, brkFile: RARC.RARCFile | null, bckFile: RARC.RARCFile | null, bmtFile: RARC.RARCFile | null) {
    const bmd = BMD.parse(bmdFile.buffer);
    const bmt = bmtFile ? BMT.parse(bmtFile.buffer) : null;
    textureHolder.addJ3DTextures(gl, bmd, bmt);
    const bmdModel = new BMDModel(gl, bmd, bmt);
    const scene = new BMDModelInstance(gl, textureHolder, bmdModel);

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

function boolSort(a: boolean, b: boolean): number {
    if (a && !b)
        return -1;
    else if (b && !a)
        return 1;
    else
        return 0;
}

export function createScenesFromBuffer(gl: WebGL2RenderingContext, textureHolder: J3DTextureHolder, buffer: ArrayBufferSlice): Promise<BMDModelInstance[]> {
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
            const bmdModel = new BMDModel(gl, bmd);
            const scene = new BMDModelInstance(gl, textureHolder, bmdModel);
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
