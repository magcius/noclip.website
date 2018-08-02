
import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';
import { assert, fetch } from '../util';

import { RenderState, ColorTarget, RenderFlags, BlendMode, BlendFactor } from '../render';
import { FullscreenProgram } from '../Program';
import * as Viewer from '../viewer';

import { Scene, J3DTextureHolder, SceneLoader } from './render';
import { EFB_WIDTH, EFB_HEIGHT, GXMaterialHacks } from '../gx/gx_material';
import { TextureOverride } from '../TextureHolder';

import * as RARC from './rarc';
import * as Yaz0 from '../compression/Yaz0';
import * as BCSV from '../luigis_mansion/bcsv';
import { mat4, quat } from 'gl-matrix';
import { BMD, BRK, BTK, BCK } from './j3d';

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
    public nodes: Scene[] = [];
    public nodeTags: string[][] = [];

    public hasTag(tag: string): boolean {
        return this.nodeTags.some((tags) => tags.includes(tag));
    }

    public forTag(tag: string, cb: (node: Scene) => void): void {
        for (let i = 0; i < this.nodes.length; i++) {
            const nodeTags = this.nodeTags[i];
            if (nodeTags.includes(tag))
                cb(this.nodes[i]);
        }
    }

    public addNode(node: Scene | null, tags: string[]): void {
        if (node === null)
            return;
        this.nodes.push(node);
        this.nodeTags.push(tags);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        for (let i = 0; i < this.nodes.length; i++)
            this.nodes[i].destroy(gl);
    }
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
        private sceneGraph: SceneGraph,
    ) {
        this.textures = textureHolder.viewerTextures;
        this.bloomCombineFlags = new RenderFlags();

        this.bloomCombineFlags.blendMode = BlendMode.ADD;
        this.bloomCombineFlags.blendSrc = BlendFactor.ONE;
        this.bloomCombineFlags.blendDst = BlendFactor.ONE;
    }

    public render(state: RenderState): void {
        const gl = state.gl;

        this.mainColorTarget.setParameters(gl, state.onscreenColorTarget.width, state.onscreenColorTarget.height);
        state.useRenderTarget(this.mainColorTarget);
        state.setClipPlanes(50, 5000000);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        this.sceneGraph.forTag(SceneGraphTag.Skybox, (node) => {
            node.bindState(state);
            node.renderOpaque(state);
        });

        gl.clear(gl.DEPTH_BUFFER_BIT);
        state.setClipPlanes(20, 500000);

        this.sceneGraph.forTag(SceneGraphTag.Normal, (node) => {
            node.bindState(state);
            node.renderOpaque(state);
            node.renderTransparent(state);
        });

        // Copy to main render target.
        state.useRenderTarget(state.onscreenColorTarget);
        state.blitColorTarget(this.mainColorTarget);

        if (this.sceneGraph.hasTag(SceneGraphTag.Indirect)) {
            const textureOverride: TextureOverride = { glTexture: this.mainColorTarget.resolvedColorTexture, width: EFB_WIDTH, height: EFB_HEIGHT, flipY: true };
            this.textureHolder.setTextureOverride("IndDummy", textureOverride);
            this.sceneGraph.forTag(SceneGraphTag.Indirect, (node) => {
                node.bindState(state);
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

const pathBase = `data/j3d/smg`;

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

class SMGSceneDesc2 implements Viewer.SceneDesc {
    constructor(public name: string, public galaxyName: string, public id: string = galaxyName) {
    }

    public parsePlacement(bcsv: BCSV.Bcsv): ObjInfo[] {
        return bcsv.records.map((record): ObjInfo => {
            const objId = BCSV.getField<number>(bcsv, record, 'l_id', -1);
            const objName = BCSV.getField<string>(bcsv, record, 'name', 'Unknown');
            const objArg0 = BCSV.getField<number>(bcsv, record, 'Obj_arg0', -1);
            const modelMatrix = mat4.create();
            computeModelMatrixFromRecord(modelMatrix, bcsv, record);
            return { objId, objName, objArg0, modelMatrix };
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

    public spawnArchive(gl: WebGL2RenderingContext, textureHolder: J3DTextureHolder, name: string, modelMatrix: mat4): Progressable<Scene | null> {
        // Should do a remap at some point.
        return fetch(`${pathBase}/ObjectData/${name}.arc`).then((buffer: ArrayBufferSlice) => {
            if (buffer.byteLength === 0) {
                console.warn(`Could not spawn archive ${name}`);
                return null;
            }
            return Yaz0.decompress(buffer);
        }).then((buffer: ArrayBufferSlice) => {
            if (buffer === null)
                return null;
            const rarc = RARC.parse(buffer);
            const lowerName = name.toLowerCase();
            const bmd = rarc.findFileData(`${lowerName}.bdl`) !== null ? BMD.parse(rarc.findFileData(`${lowerName}.bdl`)) : null;
            // Find the first animations we can.
            const bckFile = rarc.files.find((file) => file.name.endsWith('.bck'));
            const bck = bckFile !== undefined ? BCK.parse(bckFile.buffer) : null;
            const brkFile = rarc.files.find((file) => file.name.endsWith('.brk'));
            const brk = brkFile !== undefined ? BRK.parse(brkFile.buffer) : null;
            const btkFile = rarc.files.find((file) => file.name.endsWith('.btk'));
            const btk = btkFile !== undefined ? BTK.parse(btkFile.buffer) : null;
            const sceneLoader = new SceneLoader(textureHolder, bmd, null, materialHacks);
            textureHolder.addJ3DTextures(gl, bmd, null);
            const scene = sceneLoader.createScene(gl);
            scene.name = name;
            scene.setBCK(bck);
            scene.setBRK(brk);
            scene.setBTK(btk);
            mat4.copy(scene.modelMatrix, modelMatrix);
            return scene;
        });
    }

    public spawnObject(gl: WebGL2RenderingContext, textureHolder: J3DTextureHolder, planetTable: BCSV.Bcsv, sceneGraph: SceneGraph, objinfo: ObjInfo, modelMatrix: mat4): void {
        let isSkybox = false;

        const spawnGraph = (arcName: string, tag: SceneGraphTag = SceneGraphTag.Normal) => {
            this.spawnArchive(gl, textureHolder, arcName, modelMatrix).then((scene) => {
                if (scene) {
                    if (isSkybox) {
                        scene.setIsSkybox(true);
                        tag = SceneGraphTag.Skybox;
                    }
                    sceneGraph.addNode(scene, [tag]);
                }
            });
        };

        switch (objinfo.objName) {
        case 'FlagPeachCastleA':
        case 'FlagPeachCastleB':
        case 'FlagPeachCastleC':
            // Archives just contain the textures. Mesh geometry appears to be generated at runtime by the game.
            return;
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
        case 'GalaxySky':
        case 'RockPlanetOrbitSky':
        case 'VROrbit':
            // Skyboxen.
            isSkybox = true;
            // Fall through.
        default: {
            const name = objinfo.objName;
            spawnGraph(name, SceneGraphTag.Normal);
            const planetRecord = planetTable.records.find((record) => BCSV.getField(planetTable, record, 'PlanetName') === name);
            if (planetRecord) {
                const bloomFlag = BCSV.getField(planetTable, planetRecord, 'BloomFlag');
                const waterFlag = BCSV.getField(planetTable, planetRecord, 'WaterFlag');
                const indirectFlag = BCSV.getField(planetTable, planetRecord, 'IndirectFlag');
                if (bloomFlag)
                    spawnGraph(`${name}Bloom`, SceneGraphTag.Bloom);
                if (waterFlag)
                    spawnGraph(`${name}Water`, SceneGraphTag.Water);
                if (indirectFlag)
                    spawnGraph(`${name}Indirect`, SceneGraphTag.Indirect);
            }
        }
        break;
        }
    }

    public spawnZone(gl: WebGL2RenderingContext, textureHolder: J3DTextureHolder, planetTable: BCSV.Bcsv, sceneGraph: SceneGraph, zone: Zone, zones: Zone[], modelMatrixBase: mat4): void {
        // Spawn all layers. We'll hide them later when masking out the others.

        for (const layer of zone.layers) {
            for (const objinfo of layer.objinfo) {
                const modelMatrix = mat4.create();
                mat4.mul(modelMatrix, modelMatrixBase, objinfo.modelMatrix);
                this.spawnObject(gl, textureHolder, planetTable, sceneGraph, objinfo, modelMatrix);
            }

            for (const objinfo of layer.mappartsinfo) {
                const modelMatrix = mat4.create();
                mat4.mul(modelMatrix, modelMatrixBase, objinfo.modelMatrix);
                this.spawnObject(gl, textureHolder, planetTable, sceneGraph, objinfo, modelMatrix);
            }

            for (const zoneinfo of layer.stageobjinfo) {
                const subzone = zones.find((zone) => zone.name === zoneinfo.objName);
                const subzoneModelMatrix = mat4.create();
                mat4.mul(subzoneModelMatrix, modelMatrixBase, zoneinfo.modelMatrix);
                this.spawnZone(gl, textureHolder, planetTable, sceneGraph, subzone, zones, subzoneModelMatrix);
            }
        }
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        const galaxyName = this.galaxyName;
        return Progressable.all([
            fetch(`${pathBase}/ObjectData/PlanetMapDataTable.arc`),
            fetch(`${pathBase}/StageData/${galaxyName}/${galaxyName}Scenario.arc`)
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

            return Progressable.all(zoneNames.map((zoneName) => fetch(`${pathBase}/StageData/${zoneName}.arc`))).then((buffers: ArrayBufferSlice[]) => {
                return Promise.all(buffers.map((buffer) => Yaz0.decompress(buffer)));
            }).then((zoneBuffers: ArrayBufferSlice[]) => {
                const zones = zoneBuffers.map((zoneBuffer, i) => this.parseZone(zoneNames[i], zoneBuffer));
                const sceneGraph = new SceneGraph();
                const textureHolder = new J3DTextureHolder();
                const modelMatrixBase = mat4.create();
                this.spawnZone(gl, textureHolder, planetTable, sceneGraph, zones[0], zones, modelMatrixBase);
                return new SMGRenderer(gl, textureHolder, sceneGraph);
            });
        });
    }
}

const id = "smg";
const name = "Super Mario Galaxy";

const sceneDescs: Viewer.SceneDesc[] = [
    new SMGSceneDesc2("Peach's Castle Garden", "PeachCastleGardenGalaxy"),
    new SMGSceneDesc2("Comet Observatory", "AstroGalaxy"),
    new SMGSceneDesc2("BattleShipGalaxy", "BattleShipGalaxy"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
