
import ArrayBufferSlice from 'ArrayBufferSlice';
import Progressable from 'Progressable';
import { assert, fetch } from 'util';

import { RenderState, ColorTarget, RenderFlags, BlendMode, BlendFactor } from '../render';
import Program, { FullscreenProgram } from '../Program';
import * as Viewer from '../viewer';

import { BMD, BMT, BTK } from './j3d';
import { Scene, J3DTextureHolder } from './render';
import { createScenesFromBuffer } from './scenes';
import { EFB_WIDTH, EFB_HEIGHT } from '../gx/gx_material';
import { TextureOverride, TextureHolder } from '../gx/gx_render';

// Should I try to do this with GX? lol.
class BloomPassBlurProgram extends FullscreenProgram {
    public frag: string = `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

vec3 TevOverflow(vec3 a) { return fract(a*(255.0/256.0))*(256.0/255.0); }
void main() {
    // Nintendo does this in two separate draws. We combine into one here...
    vec3 c = vec3(0.0);
    // Pass 1.
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00562, -1.0 *  0.00000)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00281, -1.0 * -0.00866)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00281, -1.0 * -0.00866)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00562, -1.0 *  0.00000)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00281, -1.0 *  0.00866)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00281, -1.0 *  0.00866)).rgb * 0.15686);
    // Pass 2.
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00977, -1.0 * -0.00993)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00004, -1.0 * -0.02000)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00972, -1.0 * -0.01006)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00976, -1.0 *  0.00993)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00004, -1.0 *  0.02000)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00972, -1.0 *  0.01006)).rgb * 0.15686);
    gl_FragColor = vec4(c.rgb, 1.0);
}
`;
}

class BloomPassBokehProgram extends FullscreenProgram {
    public frag: string = `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

vec3 TevOverflow(vec3 a) { return fract(a*(255.0/256.0))*(256.0/255.0); }
void main() {
    vec3 f = vec3(0.0);
    vec3 c;

    // TODO(jstpierre): Double-check these passes. It seems weighted towards the top left. IS IT THE BLUR???

    // Pass 1.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.02250, -1.0 *  0.00000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01949, -1.0 * -0.02000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01125, -1.0 * -0.03464)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00000, -1.0 * -0.04000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01125, -1.0 * -0.03464)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01948, -1.0 * -0.02001)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.02250, -1.0 *  0.00000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01949, -1.0 *  0.02000)).rgb) * 0.23529;
    f += TevOverflow(c);
    // Pass 2.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01125, -1.0 *  0.03464)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00000, -1.0 *  0.04000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01125, -1.0 *  0.03464)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01948, -1.0 *  0.02001)).rgb) * 0.23529;
    f += TevOverflow(c);
    // Pass 3.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.03937, -1.0 *  0.00000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.03410, -1.0 * -0.03499)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01970, -1.0 * -0.06061)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00000, -1.0 * -0.07000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01968, -1.0 * -0.06063)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.03409, -1.0 * -0.03502)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.03937, -1.0 *  0.00000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.03410, -1.0 *  0.03499)).rgb) * 0.23529;
    f += TevOverflow(c);
    // Pass 4.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01970, -1.0 *  0.06061)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00000, -1.0 *  0.07000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01968, -1.0 *  0.06063)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.03409, -1.0 *  0.03502)).rgb) * 0.23529;
    f += TevOverflow(c);
    // Pass 5.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.05063, -1.0 *  0.00000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.04385, -1.0 * -0.04499)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.02532, -1.0 * -0.07793)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00000, -1.0 * -0.09000)).rgb) * 0.23529;
    f += TevOverflow(c);
    // Pass 6.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.02532, -1.0 *  0.07793)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00000, -1.0 *  0.09000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.02531, -1.0 *  0.07795)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.04384, -1.0 *  0.04502)).rgb) * 0.23529;
    f += TevOverflow(c);

    f = clamp(f, 0.0, 1.0);

    // Combine pass.
    vec3 g;
    g = (texture(u_Texture, v_TexCoord).rgb * 0.43137);
    g += f * 0.43137;

    gl_FragColor = vec4(g, 1.0);
}
`;
}

class SMGRenderer implements Viewer.MainScene {
    public textures: Viewer.Texture[] = [];

    private mainColorTarget: ColorTarget = new ColorTarget();

    // Bloom stuff.
    private bloomColorTarget1: ColorTarget = new ColorTarget();
    private bloomColorTarget2: ColorTarget = new ColorTarget();
    private bloomColorTarget3: ColorTarget = new ColorTarget();
    private bloomPassBlurProgram: BloomPassBlurProgram = new BloomPassBlurProgram();
    private bloomPassBokehProgram: BloomPassBokehProgram = new BloomPassBokehProgram();
    private bloomCombineFlags: RenderFlags;

    constructor(
        gl: WebGL2RenderingContext,
        private textureHolder: J3DTextureHolder,
        private mainScene: Scene,
        private skyboxScene: Scene,
        private bloomScene: Scene,
        private indirectScene: Scene,
    ) {
        this.textures = textureHolder.viewerTextures;
        // this.textures = collectTextures([mainScene, skyboxScene, bloomScene, indirectScene]);
        this.bloomCombineFlags = new RenderFlags();

        this.bloomCombineFlags.blendMode = BlendMode.ADD;
        this.bloomCombineFlags.blendSrc = BlendFactor.ONE;
        this.bloomCombineFlags.blendDst = BlendFactor.ONE;
    }

    public render(state: RenderState): void {
        const gl = state.gl;

        this.mainColorTarget.setParameters(gl, state.onscreenColorTarget.width, state.onscreenColorTarget.height);
        state.useRenderTarget(this.mainColorTarget);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        this.skyboxScene.bindState(state);
        this.skyboxScene.renderOpaque(state);

        gl.clear(gl.DEPTH_BUFFER_BIT);

        this.mainScene.bindState(state);
        this.mainScene.renderOpaque(state);
        this.mainScene.renderTransparent(state);

        // Copy to main render target.
        state.useRenderTarget(state.onscreenColorTarget);
        state.blitColorTarget(this.mainColorTarget);

        if (this.indirectScene) {
            const textureOverride: TextureOverride = { glTexture: this.mainColorTarget.resolvedColorTexture, width: EFB_WIDTH, height: EFB_HEIGHT, flipY: true };
            this.textureHolder.setTextureOverride("IndDummy", textureOverride);
            this.indirectScene.bindState(state);
            this.indirectScene.renderOpaque(state);
        }

        if (this.bloomScene) {
            const gl = state.gl;

            const bloomColorTargetScene = this.bloomColorTarget1;
            bloomColorTargetScene.setParameters(gl, state.onscreenColorTarget.width, state.onscreenColorTarget.height);
            state.useRenderTarget(bloomColorTargetScene);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            this.bloomScene.render(state);

            // First downsample.
            const bloomColorTargetDownsample = this.bloomColorTarget2;
            const bloomWidth = state.onscreenColorTarget.width >> 2;
            const bloomHeight = state.onscreenColorTarget.height >> 2;
            bloomColorTargetDownsample.setParameters(gl, bloomWidth, bloomHeight);
            state.useRenderTarget(bloomColorTargetDownsample, null);
            state.blitColorTarget(bloomColorTargetScene);

            // First pass is a blur.
            const bloomColorTargetBlur = this.bloomColorTarget3;
            bloomColorTargetDownsample.resolve(gl);
            bloomColorTargetBlur.setParameters(gl, bloomColorTargetDownsample.width, bloomColorTargetDownsample.height);
            state.useRenderTarget(bloomColorTargetBlur, null);
            state.useProgram(this.bloomPassBlurProgram);
            gl.bindTexture(gl.TEXTURE_2D, bloomColorTargetDownsample.resolvedColorTexture);
            state.runFullscreen();

            // TODO(jstpierre): Downsample blur / bokeh as well.

            // Second pass is bokeh-ify.
            // We can ditch the second render target now, so just reuse it.
            const bloomColorTargetBokeh = this.bloomColorTarget2;
            bloomColorTargetBlur.resolve(gl);
            state.useRenderTarget(bloomColorTargetBokeh, null);
            state.useProgram(this.bloomPassBokehProgram);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.bindTexture(gl.TEXTURE_2D, bloomColorTargetBlur.resolvedColorTexture);
            state.runFullscreen();

            // Third pass combines.
            state.useRenderTarget(state.onscreenColorTarget);
            state.blitColorTarget(bloomColorTargetBokeh, this.bloomCombineFlags);
        }
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.mainScene.destroy(gl);
        this.skyboxScene.destroy(gl);
        this.bloomScene.destroy(gl);
        this.indirectScene.destroy(gl);
        this.bloomColorTarget1.destroy(gl);
        this.bloomColorTarget2.destroy(gl);
        this.bloomColorTarget3.destroy(gl);
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
        const textureHolder: J3DTextureHolder = new J3DTextureHolder();

        return Progressable.all([
            this.fetchScene(gl, textureHolder, this.mainScenePath, false),
            this.fetchScene(gl, textureHolder, this.skyboxScenePath, true),
            this.fetchScene(gl, textureHolder, this.bloomScenePath, false),
            this.fetchScene(gl, textureHolder, this.indirectScenePath, false),
        ]).then((scenes: Scene[]) => {
            const [mainScene, skyboxScene, bloomScene, indirectScene] = scenes;
            return new SMGRenderer(gl, textureHolder, mainScene, skyboxScene, bloomScene, indirectScene);
        });
    }

    private fetchScene(gl: WebGL2RenderingContext, textureHolder: J3DTextureHolder, filename: string, isSkybox: boolean): Progressable<Scene> {
        if (filename === null)
            return new Progressable<Scene>(Promise.resolve(null));
        const path: string = `data/j3d/smg/${filename}`;
        return fetch(path).then((buffer: ArrayBufferSlice) => this.createSceneFromBuffer(gl, textureHolder, buffer, isSkybox));
    }

    private createSceneFromBuffer(gl: WebGL2RenderingContext, textureHolder: J3DTextureHolder, buffer: ArrayBufferSlice, isSkybox: boolean): Promise<Scene> {
        return createScenesFromBuffer(gl, textureHolder, buffer).then((scenes) => {
            assert(scenes.length === 1);
            const scene: Scene = scenes[0];
            scene.setFPS(60);
            scene.setIsSkybox(isSkybox);
            return scene;
        });
    }
}

const id = "smg";
const name = "Super Mario Galaxy";

const sceneDescs: Viewer.SceneDesc[] = [
    new SMGSceneDesc("Peach's Castle Garden", "PeachCastleGardenPlanet.arc", "GalaxySky.arc", "PeachCastleGardenPlanetBloom.arc", "PeachCastleGardenPlanetIndirect.arc"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
