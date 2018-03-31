
import { BMD, BTK, BMT } from './j3d';
import { Scene } from './render';
import * as Viewer from '../viewer';

import { fetch, assert } from '../util';
import Progressable from 'Progressable';
import ArrayBufferSlice from 'ArrayBufferSlice';
import { RenderState, RenderPass, Program, RenderTarget } from '../render';
import { createSceneFromBuffer, MultiScene } from './scenes';

function collectTextures(scenes: Viewer.Scene[]): Viewer.Texture[] {
    const textures: Viewer.Texture[] = [];
    for (const scene of scenes)
        textures.push.apply(textures, scene.textures);
    return textures;
}

class SMGRenderer implements Viewer.MainScene {
    public cameraController = Viewer.FPSCameraController;
    public textures: Viewer.Texture[] = [];

    private bloomRenderTarget: RenderTarget;

    constructor(
        gl: WebGL2RenderingContext,
        private mainScene: Viewer.Scene,
        private skyboxScene: Viewer.Scene,
        private bloomScene: Viewer.Scene
    ) {
        this.textures = collectTextures([mainScene, skyboxScene, bloomScene]);

        this.bloomRenderTarget = new RenderTarget();
    }

    public render(state: RenderState): void {
        const gl = state.gl;

        // Render all of the skybox in OPAQUE mode.
        state.currentPass = RenderPass.OPAQUE;
        this.skyboxScene.render(state);

        gl.clear(gl.DEPTH_BUFFER_BIT);

        // Render the main scene in OPAQUE / TRANSPARENT mode.
        state.currentPass = RenderPass.OPAQUE;
        this.mainScene.render(state);
        state.currentPass = RenderPass.TRANSPARENT;
        this.mainScene.render(state);

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
        const multiScene: MultiScene = createSceneFromBuffer(gl, buffer);
        assert(multiScene.scenes.length === 1);
        const scene: Scene = (<Scene> multiScene.scenes[0]);
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
