
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
    private mainRenderTarget: RenderTarget;

    constructor(
        gl: WebGL2RenderingContext,
        private mainScene: Scene,
        private skyboxScene: Scene,
        private bloomScene: Scene,
        private indirectScene: Scene,
    ) {
        this.textures = collectTextures([mainScene, skyboxScene, bloomScene]);

        this.mainRenderTarget = new RenderTarget();
        this.bloomRenderTarget = new RenderTarget();
    }

    public render(state: RenderState): void {
        const gl = state.gl;

        this.mainRenderTarget.setParameters(gl, state.currentRenderTarget.width, state.currentRenderTarget.height);
        state.useRenderTarget(this.mainRenderTarget);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        this.skyboxScene.bindState(state);
        this.skyboxScene.renderOpaque(state);

        gl.clear(gl.DEPTH_BUFFER_BIT);

        this.mainScene.bindState(state);
        this.mainScene.renderOpaque(state);
        this.mainScene.renderTransparent(state);

        // Copy to main render target.
        state.useRenderTarget(null);
        state.blitRenderTarget(this.mainRenderTarget, true);

        if (this.indirectScene) {
            this.indirectScene.bindState(state);
            this.indirectScene.renderOpaque(state);
            const texProjection = this.indirectScene.materialCommands[0].material.texMatrices[0].projectionMatrix;
            // The normal texture projection is hardcoded for the Gamecube's projection matrix. Copy in our own.
            texProjection[0] = state.projection[0];
            texProjection[5] = -state.projection[5];
            this.indirectScene.setTextureOverride("IndDummy", this.mainRenderTarget.resolvedColorTexture);
        }

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
        this.indirectScene.destroy(gl);
        this.bloomRenderTarget.destroy(gl);
    }
}

class SMGSceneDesc implements Viewer.SceneDesc {
    public id: string;

    constructor(
        public name: string,
        private mainScenePath: string,
        private skyboxScenePath: string = null,
        private bloomScenePath: string = null,
        private indirectScenePath: string = null,
    ) {
        this.id = mainScenePath;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        return Progressable.all([
            this.fetchScene(gl, this.mainScenePath, false),
            this.fetchScene(gl, this.skyboxScenePath, true),
            this.fetchScene(gl, this.bloomScenePath, false),
            this.fetchScene(gl, this.indirectScenePath, false),
        ]).then((scenes: Scene[]) => {
            const [mainScene, skyboxScene, bloomScene, indirectScene] = scenes;
            return new SMGRenderer(gl, mainScene, skyboxScene, bloomScene, indirectScene);
        });
    }

    private fetchScene(gl: WebGL2RenderingContext, filename: string, isSkybox: boolean): Progressable<Scene> {
        if (filename === null)
            return new Progressable<Scene>(Promise.resolve(null));
        const path: string = `data/j3d/smg/${filename}`;
        return fetch(path).then((buffer: ArrayBufferSlice) => this.createSceneFromBuffer(gl, buffer, isSkybox));
    }

    private createSceneFromBuffer(gl: WebGL2RenderingContext, buffer: ArrayBufferSlice, isSkybox: boolean): Scene {
        const scenes: Scene[] = createScenesFromBuffer(gl, buffer);
        assert(scenes.length === 1);
        const scene: Scene = scenes[0];
        scene.setFPS(60);
        scene.setIsSkybox(isSkybox);
        return scene;
    }
}

const id = "smg";
const name = "Super Mario Galaxy";

const sceneDescs: Viewer.SceneDesc[] = [
    new SMGSceneDesc("Peach's Castle Garden", "PeachCastleGardenPlanet.arc", "GalaxySky.arc", "PeachCastleGardenPlanetBloom.arc", "PeachCastleGardenPlanetIndirect.arc"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
