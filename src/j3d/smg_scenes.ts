
import ArrayBufferSlice from 'ArrayBufferSlice';
import Progressable from 'Progressable';
import { assert, fetch } from 'util';

import { Program, RenderState, RenderTarget } from '../render';
import * as Viewer from '../viewer';

import { BMD, BMT, BTK } from './j3d';
import { Scene } from './render';
import { createScenesFromBuffer } from './scenes';

function collectTextures(scenes: Viewer.Scene[]): Viewer.Texture[] {
    const textures: Viewer.Texture[] = [];
    for (const scene of scenes)
        textures.push.apply(textures, scene.textures);
    return textures;
}

class SMGRenderer implements Viewer.MainScene {
    public textures: Viewer.Texture[] = [];

    private bloomRenderTarget: RenderTarget;

    constructor(
        gl: WebGL2RenderingContext,
        private mainScene: Scene,
        private skyboxScene: Scene,
        private bloomScene: Scene,
    ) {
        this.textures = collectTextures([mainScene, skyboxScene, bloomScene]);

        this.bloomRenderTarget = new RenderTarget();
    }

    public render(state: RenderState): void {
        const gl = state.gl;

        this.skyboxScene.bindState(state);
        this.skyboxScene.renderOpaque(state);

        gl.clear(gl.DEPTH_BUFFER_BIT);

        this.mainScene.bindState(state);
        this.mainScene.renderOpaque(state);
        this.mainScene.renderTransparent(state);

        /*
        if (this.bloomScene) {
            const gl = state.gl;
            this.bloomRenderTarget.setParameters(gl, state.currentRenderTarget.width, state.currentRenderTarget.height);
            state.useRenderTarget(this.bloomRenderTarget);
            this.bloomScene.render(state);

            // Do our bloom pass.
            // state.useProgram(this.bloomProgram);
            state.useRenderTarget(null);
        }
        */
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.mainScene.destroy(gl);
        this.skyboxScene.destroy(gl);
        this.bloomScene.destroy(gl);
        this.bloomRenderTarget.destroy(gl);
    }
}

class SMGSceneDesc implements Viewer.SceneDesc {
    public id: string;

    constructor(public name: string, private mainScenePath: string, private skyboxScenePath: string = null, private bloomScenePath: string = null) {
        this.id = mainScenePath;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        return Progressable.all([
            this.fetchScene(gl, this.mainScenePath, false),
            this.fetchScene(gl, this.skyboxScenePath, true),
            this.fetchScene(gl, this.bloomScenePath, false),
        ]).then((scenes: Scene[]) => {
            const [mainScene, skyboxScene, bloomScene] = scenes;
            return new SMGRenderer(gl, mainScene, skyboxScene, bloomScene);
        });
    }

    private fetchScene(gl: WebGL2RenderingContext, path: string, isSkybox: boolean): Progressable<Scene> {
        return fetch(path).then((buffer: ArrayBufferSlice) => this.createSceneFromBuffer(gl, buffer, isSkybox));
    }

    private createSceneFromBuffer(gl: WebGL2RenderingContext, buffer: ArrayBufferSlice, isSkybox: boolean): Scene {
        const scenes: Scene[] = createScenesFromBuffer(gl, buffer);
        assert(scenes.length === 1);
        const scene: Scene = scenes[0];
        scene.setFPS(60);
        scene.setUseMaterialTexMtx(true);
        scene.setIsSkybox(isSkybox);
        return scene;
    }
}

const id = "smg";
const name = "Super Mario Galaxy";

const sceneDescs: Viewer.SceneDesc[] = [
    new SMGSceneDesc("Peach's Castle Garden", "data/j3d/PeachCastleGardenPlanet.arc", "data/j3d/GalaxySky.arc", "data/j3d/PeachCastleGardenPlanetBloom.arc"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
