
// Mario Kart Wii

import * as Viewer from '../viewer';
import * as BRRES from './brres';
import * as U8 from './u8';
import * as Yaz0 from '../compression/Yaz0';

import { fetch, assert } from '../util';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { BasicRRESScene } from './elb_scenes';
import { mat4 } from 'gl-matrix';
import { RRESTextureHolder, ModelRenderer } from './render';
import { RenderState, depthClearFlags } from '../render';

class MarioKartRenderer implements Viewer.MainScene {
    public textures: Viewer.Texture[];
    private textureHolder: RRESTextureHolder = new RRESTextureHolder();
    private animationController: BRRES.AnimationController;

    private skyboxRenderer: ModelRenderer;
    private courseRenderer: ModelRenderer;

    constructor(gl: WebGL2RenderingContext, public courseRRES: BRRES.RRES, public skyboxRRES: BRRES.RRES) {
        this.textures = this.textureHolder.viewerTextures;

        this.animationController = new BRRES.AnimationController();

        this.textureHolder.addRRESTextures(gl, skyboxRRES);
        this.textureHolder.addRRESTextures(gl, courseRRES);

        assert(skyboxRRES.mdl0.length === 1);
        this.skyboxRenderer = new ModelRenderer(gl, this.textureHolder, skyboxRRES.mdl0[0], 'vrbox');
        this.skyboxRenderer.isSkybox = true;

        assert(courseRRES.mdl0.length === 1);
        this.courseRenderer = new ModelRenderer(gl, this.textureHolder, courseRRES.mdl0[0], 'course');

        // Mario Kart Wii courses appear to be very, very big. Scale them down a bit.
        const scaleFactor = 0.1;
        mat4.fromScaling(this.courseRenderer.modelMatrix, [scaleFactor, scaleFactor, scaleFactor]);
        mat4.fromScaling(this.skyboxRenderer.modelMatrix, [scaleFactor, scaleFactor, scaleFactor]);

        // Bind SRT animations
        for (const srt0 of skyboxRRES.srt0)
            this.skyboxRenderer.bindSRT0(this.animationController, srt0);
        for (const srt0 of courseRRES.srt0)
            this.courseRenderer.bindSRT0(this.animationController, srt0);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.textureHolder.destroy(gl);
    }

    public render(state: RenderState): void {
        const gl = state.gl;
        this.animationController.updateTime(state.time);

        this.skyboxRenderer.render(state);

        state.useFlags(depthClearFlags);
        gl.clear(gl.DEPTH_BUFFER_BIT);

        this.courseRenderer.render(state);
    }
}

class MarioKartWiiSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        return fetch(`data/mkwii/${this.id}.szs`).then((buffer: ArrayBufferSlice) => {
            return Yaz0.decompress(buffer);
        }).then((buffer: ArrayBufferSlice) => {
            const arch = U8.parse(buffer);
            const courseRRES = BRRES.parse(arch.findFile('./course_model.brres').buffer);
            const skyboxRRES = BRRES.parse(arch.findFile('./vrcorn_model.brres').buffer);
            const scene = new MarioKartRenderer(gl, courseRRES, skyboxRRES);
            return scene;
        });
    }
}

const id = 'mkwii';
const name = 'Mario Kart Wii';
const sceneDescs: Viewer.SceneDesc[] = [
    new MarioKartWiiSceneDesc('beginner_course', "Luigi Circuit"),
    new MarioKartWiiSceneDesc('farm_course', "Moo Moo Meadows"),
    new MarioKartWiiSceneDesc('kinoko_course', "Mushroom Gorge"),
    new MarioKartWiiSceneDesc('factory_course', "Toad's Factory"),
    new MarioKartWiiSceneDesc('castle_course', "Mario Circuit"),
    new MarioKartWiiSceneDesc('shopping_course', "Coconut Mall"),
    new MarioKartWiiSceneDesc('boardcross_course', "DK Summit"),
    new MarioKartWiiSceneDesc('truck_course', "Wario's Gold Mine"),
    new MarioKartWiiSceneDesc('senior_course', "Daisy Circuit"),
    new MarioKartWiiSceneDesc('water_course', "Koopa Cape"),
    new MarioKartWiiSceneDesc('treehouse_course', "Maple Treeway"),
    new MarioKartWiiSceneDesc('volcano_course', "Grumble Volcano"),
    new MarioKartWiiSceneDesc('desert_course', "Dry Dry Ruins"),
    new MarioKartWiiSceneDesc('ridgehighway_course', "Moonview Highway"),
    new MarioKartWiiSceneDesc('koopa_course', "Bowser's Castle"),
    new MarioKartWiiSceneDesc('rainbow_course', "Rainbow Road"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
