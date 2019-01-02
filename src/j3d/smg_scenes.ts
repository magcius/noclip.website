
import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';
import { assert } from '../util';
import { fetchData } from '../fetch';

import { RenderState, ColorTarget } from '../render';
import { FullscreenProgram } from '../Program';
import * as Viewer from '../viewer';

import { BMDModel, BMDModelInstance, J3DTextureHolder } from './render';
import { EFB_WIDTH, EFB_HEIGHT, GXMaterialHacks } from '../gx/gx_material';
import { TextureOverride } from '../TextureHolder';

import * as RARC from './rarc';
import * as Yaz0 from '../compression/Yaz0';
import * as BCSV from '../luigis_mansion/bcsv';
import * as UI from '../ui';
import { mat4, quat } from 'gl-matrix';
import { BMD, BRK, BTK, BCK } from './j3d';
import { GfxBlendMode, GfxBlendFactor, GfxCompareMode, GfxMegaStateDescriptor } from '../gfx/platform/GfxPlatform';
import AnimationController from '../AnimationController';
import { makeMegaState } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';

const materialHacks: GXMaterialHacks = {
    alphaLightingFudge: (p) => p.matSource,
};

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

const enum SceneGraphTag {
    Skybox = 'Skybox',
    Normal = 'Normal',
    Bloom = 'Bloom',
    Water = 'Water',
    Indirect = 'Indirect',
}

class SceneGraph {
    public nodes: BMDModelInstance[] = [];
    public nodeTags: string[][] = [];
    public onnodeadded: (node: BMDModelInstance, i: number) => void | null = null;

    public hasTag(tag: string): boolean {
        return this.nodeTags.some((tags) => tags.includes(tag));
    }

    public nodeHasTag(i: number, tag: string): boolean {
        return this.nodeTags[i].includes(tag);
    }

    public forTag(tag: string, cb: (node: BMDModelInstance, i: number) => void): void {
        for (let i = 0; i < this.nodes.length; i++) {
            const nodeTags = this.nodeTags[i];
            if (nodeTags.includes(tag))
                cb(this.nodes[i], i);
        }
    }

    public addNode(node: BMDModelInstance | null, tags: string[]): void {
        if (node === null)
            return;
        this.nodes.push(node);
        this.nodeTags.push(tags);
        const i = this.nodes.length - 1;
        if (this.onnodeadded !== null)
            this.onnodeadded(node, i);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        for (let i = 0; i < this.nodes.length; i++)
            this.nodes[i].destroy(gl);
    }
}

const TIME_OF_DAY_ICON = `<svg viewBox="0 0 100 100" height="20" fill="white"><path d="M50,93.4C74,93.4,93.4,74,93.4,50C93.4,26,74,6.6,50,6.6C26,6.6,6.6,26,6.6,50C6.6,74,26,93.4,50,93.4z M37.6,22.8  c-0.6,2.4-0.9,5-0.9,7.6c0,18.2,14.7,32.9,32.9,32.9c2.6,0,5.1-0.3,7.6-0.9c-4.7,10.3-15.1,17.4-27.1,17.4  c-16.5,0-29.9-13.4-29.9-29.9C20.3,37.9,27.4,27.5,37.6,22.8z"/></svg>`;

function getZoneLayerFilterTag(zoneName: string, layerIndex: number): string {
    return `${zoneName}_${getLayerName(layerIndex)}`;
}

class SMGRenderer implements Viewer.MainScene {
    private mainColorTarget: ColorTarget = new ColorTarget();

    // Bloom stuff.
    private bloomColorTarget1: ColorTarget = new ColorTarget();
    private bloomColorTarget2: ColorTarget = new ColorTarget();
    private bloomColorTarget3: ColorTarget = new ColorTarget();
    private bloomPassBlurProgram: BloomPassBlurProgram = new BloomPassBlurProgram();
    private bloomPassBokehProgram: BloomPassBokehProgram = new BloomPassBokehProgram();
    private bloomCombineFlags: GfxMegaStateDescriptor;
    private currentScenarioIndex: number = 0;

    constructor(
        public textureHolder: J3DTextureHolder,
        private sceneGraph: SceneGraph,
        private scenarioData: BCSV.Bcsv,
        private zoneNames: string[],
    ) {
        this.bloomCombineFlags = makeMegaState({
            depthCompare: GfxCompareMode.ALWAYS,
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.ONE,
            blendDstFactor: GfxBlendFactor.ONE,
        });

        this.sceneGraph.onnodeadded = (node: BMDModelInstance, i: number) => {
            this.applyCurrentScenario();
        };
    }

    private setZoneLayersVisible(zoneName: string, layerMask: number): void {
        for (let i = 0; i < 10; i++) {
            const visible = !!(layerMask & (1 << i));
            this.sceneGraph.forTag(getZoneLayerFilterTag(zoneName, i), (node) => {
                node.setVisible(visible);
            });
        }
    }

    private applyCurrentScenario(): void {
        const scenarioRecord = this.scenarioData.records[this.currentScenarioIndex];
        for (const zoneName of this.zoneNames) {
            const layerMask = BCSV.getField<number>(this.scenarioData, scenarioRecord, zoneName, 0);
            this.setZoneLayersVisible(zoneName, layerMask);
        }
    }

    public setCurrentScenario(index: number): void {
        this.currentScenarioIndex = index;
        this.applyCurrentScenario();
    }

    public createPanels(): UI.Panel[] {
        const scenarioPanel = new UI.Panel();
        scenarioPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        scenarioPanel.setTitle(TIME_OF_DAY_ICON, 'Scenario');

        const scenarioNames = this.scenarioData.records.map((record) => {
            return BCSV.getField<string>(this.scenarioData, record, 'ScenarioName');
        });
        const scenarioSelect = new UI.SingleSelect();
        scenarioSelect.setStrings(scenarioNames);
        scenarioSelect.onselectionchange = (index: number) => {
            this.setCurrentScenario(index);
        };
        scenarioSelect.selectItem(0);

        scenarioPanel.contents.appendChild(scenarioSelect.elem);

        return [scenarioPanel];
    }

    public render(state: RenderState): void {
        const gl = state.gl;

        this.mainColorTarget.setParameters(gl, state.onscreenColorTarget.width, state.onscreenColorTarget.height);
        state.useRenderTarget(this.mainColorTarget);
        state.setClipPlanes(50, 5000000);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        this.sceneGraph.forTag(SceneGraphTag.Skybox, (node) => {
            if (!node.bindState(state))
                return;
            node.renderOpaque(state);
        });

        gl.clear(gl.DEPTH_BUFFER_BIT);
        state.setClipPlanes(20, 500000);

        this.sceneGraph.forTag(SceneGraphTag.Normal, (node) => {
            if (!node.bindState(state))
                return;
            node.renderOpaque(state);
        });

        this.sceneGraph.forTag(SceneGraphTag.Normal, (node) => {
            if (!node.bindState(state))
                return;
            node.renderTransparent(state);
        });

        // Copy to main render target.
        state.useRenderTarget(state.onscreenColorTarget);
        state.blitColorTarget(this.mainColorTarget);

        if (this.sceneGraph.hasTag(SceneGraphTag.Indirect)) {
            const textureOverride: TextureOverride = { glTexture: this.mainColorTarget.resolvedColorTexture, width: EFB_WIDTH, height: EFB_HEIGHT, flipY: true };
            this.textureHolder.setTextureOverride("IndDummy", textureOverride);
            this.sceneGraph.forTag(SceneGraphTag.Indirect, (node) => {
                if (!node.bindState(state))
                    return;
                node.renderOpaque(state);
            });
        }

        if (this.sceneGraph.hasTag(SceneGraphTag.Bloom)) {
            const gl = state.gl;

            const bloomColorTargetScene = this.bloomColorTarget1;
            bloomColorTargetScene.setParameters(gl, state.onscreenColorTarget.width, state.onscreenColorTarget.height);
            state.useRenderTarget(bloomColorTargetScene);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            this.sceneGraph.forTag(SceneGraphTag.Bloom, (node) => {
                node.render(state);
            });

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
        this.textureHolder.destroy(gl);
        this.sceneGraph.destroy(gl);
        this.bloomColorTarget1.destroy(gl);
        this.bloomColorTarget2.destroy(gl);
        this.bloomColorTarget3.destroy(gl);
    }
}

function getLayerName(index: number) {
    if (index === -1) {
        return 'common';
    } else {
        assert(index >= 0);
        const char = String.fromCharCode('a'.charCodeAt(0) + index);
        return `layer${char}`;
    }
}

interface ObjInfo {
    objId: number;
    objName: string;
    objArg0: number;
    rotateSpeed: number;
    rotateAccelType: number;
    modelMatrix: mat4;
}

interface ZoneLayer {
    index: number;
    objinfo: ObjInfo[];
    mappartsinfo: ObjInfo[];
    stageobjinfo: ObjInfo[];
}

interface Zone {
    name: string;
    layers: ZoneLayer[];
}

function computeModelMatrixFromRecord(modelMatrix: mat4, bcsv: BCSV.Bcsv, record: BCSV.BcsvRecord): void {
    const pos_x = BCSV.getField<number>(bcsv, record, 'pos_x', 0);
    const pos_y = BCSV.getField<number>(bcsv, record, 'pos_y', 0);
    const pos_z = BCSV.getField<number>(bcsv, record, 'pos_z', 0);
    const dir_x = BCSV.getField<number>(bcsv, record, 'dir_x', 0);
    const dir_y = BCSV.getField<number>(bcsv, record, 'dir_y', 0);
    const dir_z = BCSV.getField<number>(bcsv, record, 'dir_z', 0);
    const scale_x = BCSV.getField<number>(bcsv, record, 'scale_x', 1);
    const scale_y = BCSV.getField<number>(bcsv, record, 'scale_y', 1);
    const scale_z = BCSV.getField<number>(bcsv, record, 'scale_z', 1);
    const q = quat.create();
    quat.fromEuler(q, dir_x, dir_y, dir_z);
    mat4.fromRotationTranslationScale(modelMatrix, q, [pos_x, pos_y, pos_z], [scale_x, scale_y, scale_z]);
}

interface AnimOptions {
    bck?: string;
    btk?: string;
    brk?: string;
}

const pathBase = `data/j3d/smg`;

class YSpinAnimator {
    constructor(public animationController: AnimationController, public objinfo: ObjInfo) {
    }

    public calcModelMtx(dst: mat4, src: mat4): void {
        const time = this.animationController.getTimeInSeconds();
        // RotateSpeed appears to be deg/sec?
        const rotateSpeed = this.objinfo.rotateSpeed / (this.objinfo.rotateAccelType > 0 ? this.objinfo.rotateAccelType : 1);
        const speed = rotateSpeed * Math.PI / 180;
        mat4.rotateY(dst, src, time * speed);
    }
}

class ModelCache {
    public promiseCache = new Map<string, Progressable<BMDModel>>();
    public archiveCache = new Map<string, RARC.RARC>();

    public getModel(gl: WebGL2RenderingContext, textureHolder: J3DTextureHolder, archiveName: string): Progressable<BMDModel> {
        if (this.promiseCache.has(archiveName))
            return this.promiseCache.get(archiveName);

        const p = fetchData(`${pathBase}/ObjectData/${archiveName}.arc`).then((buffer: ArrayBufferSlice) => {
            if (buffer.byteLength === 0) {
                console.warn(`Could not spawn archive ${archiveName}`);
                return null;
            }
            return Yaz0.decompress(buffer);
        }).then((buffer: ArrayBufferSlice) => {
            if (buffer === null)
                return null;
            const rarc = RARC.parse(buffer);
            const lowerName = archiveName.toLowerCase();
            const bmd = rarc.findFileData(`${lowerName}.bdl`) !== null ? BMD.parse(rarc.findFileData(`${lowerName}.bdl`)) : null;
            const bmdModel = new BMDModel(gl, bmd, null, materialHacks);
            textureHolder.addJ3DTextures(gl, bmd);
            this.archiveCache.set(archiveName, rarc);
            return bmdModel;
        });
        
        this.promiseCache.set(archiveName, p);
        return p;
    }
}

class SMGSpawner {
    public textureHolder = new J3DTextureHolder();
    public sceneGraph = new SceneGraph();
    public modelCache = new ModelCache();

    constructor(
        public planetTable: BCSV.Bcsv,
    ) {
    }

    public applyAnimations(modelInstance: BMDModelInstance, rarc: RARC.RARC, animOptions?: AnimOptions): void {
        let bckFile: RARC.RARCFile | null = null;
        let brkFile: RARC.RARCFile | null = null;
        let btkFile: RARC.RARCFile | null = null;

        if (animOptions !== null) {
            if (animOptions !== undefined) {
                bckFile = animOptions.bck ? rarc.findFile(animOptions.bck) : null;
                brkFile = animOptions.brk ? rarc.findFile(animOptions.brk) : null;
                btkFile = animOptions.btk ? rarc.findFile(animOptions.btk) : null;
            } else {
                // Look for "wait" animation first, then fall back to the first animation.
                bckFile = rarc.findFile('wait.bck');
                brkFile = rarc.findFile('wait.brk');
                btkFile = rarc.findFile('wait.btk');
                if (!(bckFile || brkFile || btkFile)) {
                    bckFile = rarc.files.find((file) => file.name.endsWith('.bck')) || null;
                    brkFile = rarc.files.find((file) => file.name.endsWith('.brk')) || null;
                    btkFile = rarc.files.find((file) => file.name.endsWith('.btk')) || null;
                }
            }
        }

        if (btkFile !== null) {
            const btk = BTK.parse(btkFile.buffer);
            modelInstance.bindTTK1(btk.ttk1);
        }

        if (brkFile !== null) {
            const brk = BRK.parse(brkFile.buffer);
            modelInstance.bindTRK1(brk.trk1);
        }

        if (bckFile !== null) {
            const bck = BCK.parse(bckFile.buffer);
            modelInstance.bindANK1(bck.ank1);

            // Apply a random phase to the animation.
            modelInstance.animationController.phaseFrames += Math.random() * bck.ank1.duration;
        }
    }

    public spawnArchive(gl: WebGL2RenderingContext, modelMatrix: mat4, name: string, animOptions?: AnimOptions): Progressable<BMDModelInstance | null> {
        // Should do a remap at some point.
        return this.modelCache.getModel(gl, this.textureHolder, name).then((bmdModel) => {
            if (bmdModel === null)
                return null;

            // Trickery.
            const rarc = this.modelCache.archiveCache.get(name);

            const bmdModelInstance = new BMDModelInstance(gl, this.textureHolder, bmdModel);
            bmdModelInstance.name = name;
            this.applyAnimations(bmdModelInstance, rarc, animOptions);
            mat4.copy(bmdModelInstance.modelMatrix, modelMatrix);
            return bmdModelInstance;
        });
    }

    public spawnObject(gl: WebGL2RenderingContext, zoneLayerFilterTag: string, objinfo: ObjInfo, modelMatrix: mat4): void {
        const spawnGraph = (arcName: string, tag: SceneGraphTag = SceneGraphTag.Normal, animOptions?: AnimOptions) => {
            this.spawnArchive(gl, modelMatrix, arcName, animOptions).then((modelInstance) => {
                if (modelInstance) {
                    if (tag === SceneGraphTag.Skybox)
                        modelInstance.setIsSkybox(true);
                    this.sceneGraph.addNode(modelInstance, [tag, zoneLayerFilterTag]);

                    if (objinfo.rotateSpeed !== 0) {
                        // Set up a rotator animation to spin it around.
                        modelInstance.bindModelMatrixAnimator(new YSpinAnimator(modelInstance.animationController, objinfo));
                    }
                }
            });
        };

        const name = objinfo.objName;
        switch (objinfo.objName) {
        case 'FlagPeachCastleA':
        case 'FlagPeachCastleB':
        case 'FlagPeachCastleC':
            // Archives just contain the textures. Mesh geometry appears to be generated at runtime by the game.
            return;
        case 'PeachCastleTownBeforeAttack':
            spawnGraph('PeachCastleTownBeforeAttack', SceneGraphTag.Normal);
            spawnGraph('PeachCastleTownBeforeAttackBloom', SceneGraphTag.Bloom);
            break;
        case 'FlowerGroup':
        case 'FlowerBlueGroup':
        case 'ShootingStar':
        case 'MeteorCannon':
            // Archives missing. Again, runtime mesh?
            return;
        case 'TimerSwitch':
        case 'SwitchSynchronizerReverse':
        case 'PrologueDirector':
        case 'MovieStarter':
        case 'ScenarioStarter':
        case 'LuigiEvent':
            // Logic objects.
            return;
        case 'AstroCore':
            spawnGraph(name, SceneGraphTag.Normal, { bck: 'revival4.bck', brk: 'revival4.brk', btk: 'astrocore.btk' });
            break;
        case 'AstroDomeEntrance': {
            switch (objinfo.objArg0) {
            case 1: spawnGraph('AstroDomeEntranceObservatory'); break;
            case 2: spawnGraph('AstroDomeEntranceWell'); break;
            case 3: spawnGraph('AstroDomeEntranceKitchen'); break;
            case 4: spawnGraph('AstroDomeEntranceBedroom'); break;
            case 5: spawnGraph('AstroDomeEntranceMachine'); break;
            case 6: spawnGraph('AstroDomeEntranceTower'); break;
            default: assert(false);
            }
            break;
        }
        case 'AstroStarPlate': {
            switch (objinfo.objArg0) {
            case 1: spawnGraph('AstroStarPlateObservatory'); break;
            case 2: spawnGraph('AstroStarPlateWell'); break;
            case 3: spawnGraph('AstroStarPlateKitchen'); break;
            case 4: spawnGraph('AstroStarPlateBedroom'); break;
            case 5: spawnGraph('AstroStarPlateMachine'); break;
            case 6: spawnGraph('AstroStarPlateTower'); break;
            default: assert(false);
            }
            break;
        }
        case 'SignBoard':
            spawnGraph(name, SceneGraphTag.Normal, null);
            break;
        case 'Rosetta':
            spawnGraph(name, SceneGraphTag.Normal, { bck: 'waita.bck' });
            break;
        case 'HalfGalaxySky':
        case 'GalaxySky':
        case 'RockPlanetOrbitSky':
        case 'VROrbit':
            // Skyboxen.
            spawnGraph(name, SceneGraphTag.Skybox);
            break;
        default: {
            const name = objinfo.objName;
            spawnGraph(name, SceneGraphTag.Normal);
            // Spawn planets.
            const planetRecord = this.planetTable.records.find((record) => BCSV.getField(this.planetTable, record, 'PlanetName') === name);
            if (planetRecord) {
                const bloomFlag = BCSV.getField(this.planetTable, planetRecord, 'BloomFlag');
                const waterFlag = BCSV.getField(this.planetTable, planetRecord, 'WaterFlag');
                const indirectFlag = BCSV.getField(this.planetTable, planetRecord, 'IndirectFlag');
                if (bloomFlag)
                    spawnGraph(`${name}Bloom`, SceneGraphTag.Bloom);
                if (waterFlag)
                    spawnGraph(`${name}Water`, SceneGraphTag.Water);
                if (indirectFlag)
                    spawnGraph(`${name}Indirect`, SceneGraphTag.Indirect);
            }
            break;
        }
        }
    }

    public spawnZone(gl: WebGL2RenderingContext, zone: Zone, zones: Zone[], modelMatrixBase: mat4): void {
        // Spawn all layers. We'll hide them later when masking out the others.

        for (const layer of zone.layers) {
            const zoneLayerFilterTag = getZoneLayerFilterTag(zone.name, layer.index);

            for (const objinfo of layer.objinfo) {
                const modelMatrix = mat4.create();
                mat4.mul(modelMatrix, modelMatrixBase, objinfo.modelMatrix);
                this.spawnObject(gl, zoneLayerFilterTag, objinfo, modelMatrix);
            }

            for (const objinfo of layer.mappartsinfo) {
                const modelMatrix = mat4.create();
                mat4.mul(modelMatrix, modelMatrixBase, objinfo.modelMatrix);
                this.spawnObject(gl, zoneLayerFilterTag, objinfo, modelMatrix);
            }

            for (const zoneinfo of layer.stageobjinfo) {
                const subzone = zones.find((zone) => zone.name === zoneinfo.objName);
                const subzoneModelMatrix = mat4.create();
                mat4.mul(subzoneModelMatrix, modelMatrixBase, zoneinfo.modelMatrix);
                this.spawnZone(gl, subzone, zones, subzoneModelMatrix);
            }
        }
    }
}

class SMGSceneDesc implements Viewer.SceneDesc {
    constructor(public name: string, public galaxyName: string, public id: string = galaxyName) {
    }

    public parsePlacement(bcsv: BCSV.Bcsv): ObjInfo[] {
        return bcsv.records.map((record): ObjInfo => {
            const objId = BCSV.getField<number>(bcsv, record, 'l_id', -1);
            const objName = BCSV.getField<string>(bcsv, record, 'name', 'Unknown');
            const objArg0 = BCSV.getField<number>(bcsv, record, 'Obj_arg0', -1);
            const rotateSpeed = BCSV.getField<number>(bcsv, record, 'RotateSpeed', 0);
            const rotateAccelType = BCSV.getField<number>(bcsv, record, 'RotateAccelType', 0);
            const modelMatrix = mat4.create();
            computeModelMatrixFromRecord(modelMatrix, bcsv, record);
            return { objId, objName, objArg0, rotateSpeed, rotateAccelType, modelMatrix };
        });
    }

    public parseZone(name: string, buffer: ArrayBufferSlice): Zone {
        const rarc = RARC.parse(buffer);
        const layers: ZoneLayer[] = [];
        for (let i = -1; i < 10; i++) {
            const layerName = getLayerName(i);
            const placementDir = `jmp/placement/${layerName}`;
            const mappartsDir = `jmp/mapparts/${layerName}`;
            if (!rarc.findDir(placementDir))
                continue;
            const objinfo = this.parsePlacement(BCSV.parse(rarc.findFileData(`${placementDir}/objinfo`)));
            const mappartsinfo = this.parsePlacement(BCSV.parse(rarc.findFileData(`${mappartsDir}/mappartsinfo`)));
            const stageobjinfo = this.parsePlacement(BCSV.parse(rarc.findFileData(`${placementDir}/stageobjinfo`)));
            layers.push({ index: i, objinfo, mappartsinfo, stageobjinfo });
        }
        return { name, layers };
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        const galaxyName = this.galaxyName;
        return Progressable.all([
            fetchData(`${pathBase}/ObjectData/PlanetMapDataTable.arc`),
            fetchData(`${pathBase}/StageData/${galaxyName}/${galaxyName}Scenario.arc`)
        ]).then((buffers: ArrayBufferSlice[]) => {
            return Promise.all(buffers.map((buffer) => Yaz0.decompress(buffer)));
        }).then((buffers: ArrayBufferSlice[]) => {
            const [planetTableBuffer, buffer] = buffers;

            // Load planet table.
            const planetTableRarc = RARC.parse(planetTableBuffer);
            const planetTable = BCSV.parse(planetTableRarc.findFileData('planetmapdatatable.bcsv'));

            // Load all the subzones.
            const scenarioRarc = RARC.parse(buffer);
            const zonelist = BCSV.parse(scenarioRarc.findFileData('zonelist.bcsv'));
            const scenariodata = BCSV.parse(scenarioRarc.findFileData('scenariodata.bcsv'));

            // zonelist contains one field, ZoneName, a string
            assert(zonelist.fields.length === 1);
            assert(zonelist.fields[0].nameHash === BCSV.bcsvHashSMG('ZoneName'));
            const zoneNames = zonelist.records.map(([zoneName]) => zoneName as string);

            // The master zone is the first one.
            const masterZoneName = zoneNames[0];
            assert(masterZoneName === galaxyName);

            return Progressable.all(zoneNames.map((zoneName) => fetchData(`${pathBase}/StageData/${zoneName}.arc`))).then((buffers: ArrayBufferSlice[]) => {
                return Promise.all(buffers.map((buffer) => Yaz0.decompress(buffer)));
            }).then((zoneBuffers: ArrayBufferSlice[]) => {
                const zones = zoneBuffers.map((zoneBuffer, i) => this.parseZone(zoneNames[i], zoneBuffer));
                const spawner = new SMGSpawner(planetTable);
                const modelMatrixBase = mat4.create();
                spawner.spawnZone(gl, zones[0], zones, modelMatrixBase);
                return new SMGRenderer(spawner.textureHolder, spawner.sceneGraph, scenariodata, zoneNames);
            });
        });
    }
}

const id = "smg";
const name = "Super Mario Galaxy";

const sceneDescs: Viewer.SceneDesc[] = [
    new SMGSceneDesc("Peach's Castle Garden", "PeachCastleGardenGalaxy"),
    new SMGSceneDesc("Comet Observatory", "AstroGalaxy"),
    new SMGSceneDesc("Battlerock Galaxy", "BattleShipGalaxy"),
    new SMGSceneDesc("Honeyhive Galaxy", "HoneyBeeKingdomGalaxy"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
