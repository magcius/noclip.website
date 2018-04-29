
import ArrayBufferSlice from 'ArrayBufferSlice';
import Progressable from 'Progressable';
import { fetch } from 'util';

import { RenderState, ColorTarget } from '../render';
import * as Viewer from '../viewer';
import * as Yaz0 from '../yaz0';

import * as RARC from './rarc';
import { ColorOverride, Scene, TextureOverride } from './render';
import { createScene } from './scenes';
import { EFB_WIDTH, EFB_HEIGHT } from '../gx/gx_material';

function collectTextures(scenes: Viewer.Scene[]): Viewer.Texture[] {
    const textures: Viewer.Texture[] = [];
    for (const scene of scenes)
        if (scene)
            textures.push.apply(textures, scene.textures);
    return textures;
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
        const bmdFile = rarc.findFile(`map/map/${basename}.bmd`);
        if (!bmdFile)
            return null;
        const btkFile = rarc.findFile(`map/map/${basename}.btk`);
        const brkFile = rarc.findFile(`map/map/${basename}.brk`);
        const bmtFile = rarc.findFile(`map/map/${basename}.bmt`);
        const scene = createScene(gl, bmdFile, btkFile, brkFile, bmtFile);
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

            // For those curious, the "actual" way the engine loads files is done through
            // the scene description in scene.bin, with the "map/map" paths hardcoded in
            // the binary, and for a lot of objects, too. My heuristics below are a cheap
            // approximation of the actual scene data...

            const skyScene = SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, 'sky', true);
            const mapScene = SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, 'map', false);
            const seaScene = SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, 'sea', false);
            const seaIndirectScene = SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, 'seaindirect', false);

            const extraScenes: Scene[] = [];
            for (const file of rarc.findDir('map/map').files) {
                const [basename, extension] = file.name.split('.');
                if (extension !== 'bmd')
                    continue;
                if (['sky', 'map', 'sea', 'seaindirect'].includes(basename))
                    continue;
                const scene = SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, basename, false);
                extraScenes.push(scene);
            }

            return new SunshineRenderer(skyScene, mapScene, seaScene, seaIndirectScene, extraScenes, rarc);
        });
    }
}

const id = "sms";
const name = "Super Mario Sunshine";

const sceneDescs: Viewer.SceneDesc[] = [
    new SunshineSceneDesc("data/j3d/dolpic0.szs", "Delfino Plaza"),
    new SunshineSceneDesc("data/j3d/mare0.szs", "Noki Bay"),
    new SunshineSceneDesc("data/j3d/sirena0.szs", "Sirena Beach"),
    new SunshineSceneDesc("data/j3d/ricco0.szs", "Ricco Harbor"),
    new SunshineSceneDesc("data/j3d/delfino0.szs", "Delfino Hotel"),
    new SunshineSceneDesc("data/j3d/monte3.szs", "Pianta Village"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
