
import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';
import { fetchData } from '../fetch';
import * as Viewer from '../viewer';
import * as Yaz0 from '../compression/Yaz0';
import * as UI from '../ui';

import { BMD, BMT, BTK, BTI, TEX1_TextureData, BRK, BCK } from './j3d';
import * as RARC from './rarc';
import { BMDModel, BMDModelInstance, J3DTextureHolder } from './render';
import { RenderState, ColorTarget, depthClearFlags } from '../render';
import { EFB_WIDTH, EFB_HEIGHT } from '../gx/gx_material';
import { TextureOverride } from '../TextureHolder';
import { readString, leftPad } from '../util';

class ZTPTextureHolder extends J3DTextureHolder {
    protected findTextureEntryIndex(name: string): number {
        let i: number = -1;

        i = this.searchTextureEntryIndex(name);
        if (i >= 0) return i;

        i = this.searchTextureEntryIndex(`ExtraTex/${name.toLowerCase().replace('.tga', '')}`);
        if (i >= 0) return i;

        return i;
    }

    public addExtraTextures(gl: WebGL2RenderingContext, extraTextures: TEX1_TextureData[]): void {
        this.addTextures(gl, extraTextures.map((texture) => {
            const name = `ExtraTex/${texture.name.toLowerCase()}`;
            return { ...texture, name };
        }));
    }
}

function createScene(gl: WebGL2RenderingContext, textureHolder: J3DTextureHolder, bmdFile: RARC.RARCFile, btkFile: RARC.RARCFile, brkFile: RARC.RARCFile, bckFile: RARC.RARCFile, bmtFile: RARC.RARCFile) {
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

function createScenesFromRARC(gl: WebGL2RenderingContext, textureHolder: J3DTextureHolder, rarcName: string, rarc: RARC.RARC): BMDModelInstance[] {
    const bmdFiles = rarc.files.filter((f) => f.name.endsWith('.bmd') || f.name.endsWith('.bdl'));
    const scenes = bmdFiles.map((bmdFile) => {
        const basename = bmdFile.name.split('.')[0];
        const btkFile = rarc.files.find((f) => f.name === `${basename}.btk`) || null;
        const brkFile = rarc.files.find((f) => f.name === `${basename}.brk`) || null;
        const bckFile = rarc.files.find((f) => f.name === `${basename}.bck`) || null;
        const bmtFile = rarc.files.find((f) => f.name === `${basename}.bmt`) || null;
        const scene = createScene(gl, textureHolder, bmdFile, btkFile, brkFile, bckFile, bmtFile);
        scene.name = `${rarcName}/${basename}`;
        return scene;
    });

    return scenes.filter((s) => !!s);
}

class TwilightPrincessRenderer implements Viewer.MainScene {
    private mainColorTarget: ColorTarget = new ColorTarget();
    private opaqueScenes: BMDModelInstance[] = [];
    private indTexScenes: BMDModelInstance[] = [];
    private transparentScenes: BMDModelInstance[] = [];
    private windowScenes: BMDModelInstance[] = [];

    constructor(public textureHolder: J3DTextureHolder, public stageRarc: RARC.RARC, public roomRarcs: RARC.RARC[], public skyboxScenes: BMDModelInstance[], public roomScenes: BMDModelInstance[], public roomNames: string[]) {
        this.roomScenes.forEach((scene) => {
            if (scene.name.endsWith('model')) {
                this.opaqueScenes.push(scene);
            } else if (scene.name.endsWith('model1')) {
                this.indTexScenes.push(scene);
            } else if (scene.name.endsWith('model2')) {
                this.transparentScenes.push(scene);
            } else if (scene.name.endsWith('model3')) {
                this.windowScenes.push(scene);
            } else if (scene.name.endsWith('model4') || scene.name.endsWith('model5')) {
                // Not sure what these are, so just throw them in the transparent bucket.
                this.transparentScenes.push(scene);
             } else {
                throw "whoops";
            }
        });
    }

    private setRoomVisible(name: string, v: boolean): void {
        for (let i = 0; i < this.roomScenes.length; i++)
            if (this.roomScenes[i].name.startsWith(name))
                this.roomScenes[i].setVisible(v);
    }

    public createPanels(): UI.Panel[] {
        const rooms = new UI.LayerPanel();
        rooms.setLayers(this.roomNames.map((name) => {
            const room = { name, visible: true, setVisible: (v: boolean): void => {
                room.visible = v;
                this.setRoomVisible(name, v);
            } };
            return room;
        }));
        return [rooms];
    }

    public render(state: RenderState) {
        const gl = state.gl;

        // Draw skybox + opaque to main RT.
        this.mainColorTarget.setParameters(gl, state.onscreenColorTarget.width, state.onscreenColorTarget.height);
        state.useRenderTarget(this.mainColorTarget);
        state.setClipPlanes(20, 500000);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.skyboxScenes.forEach((scene) => {
            scene.render(state);
        });
        state.useFlags(depthClearFlags);
        gl.clear(gl.DEPTH_BUFFER_BIT);

        this.opaqueScenes.forEach((scene) => {
            scene.render(state);
        });

        // Copy to main render target.
        state.useRenderTarget(state.onscreenColorTarget);
        state.blitColorTarget(this.mainColorTarget);

        // IndTex.
        if (this.indTexScenes.length && this.textureHolder.hasTexture('fbtex_dummy')) {
            const textureOverride: TextureOverride = { glTexture: this.mainColorTarget.resolvedColorTexture, width: EFB_WIDTH, height: EFB_HEIGHT, flipY: true };
            this.textureHolder.setTextureOverride("fbtex_dummy", textureOverride);
        }

        this.indTexScenes.forEach((indirectScene) => {
            indirectScene.render(state);
        });

        // Transparent.
        this.transparentScenes.forEach((scene) => {
            scene.render(state);
        });

        // Window & Doorway fades. Separate so that the renderer can override color registers separately.
        // We don't do anything about this yet...
        this.windowScenes.forEach((scene) => {
            scene.render(state);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.textureHolder.destroy(gl);
        this.skyboxScenes.forEach((scene) => scene.destroy(gl));
        this.roomScenes.forEach((scene) => scene.destroy(gl));
    }
}

function getRoomListFromDZS(buffer: ArrayBufferSlice): number[] {
    const view = buffer.createDataView();
    const chunkCount = view.getUint32(0x00);

    const chunkOffsets = new Map<string, { offs: number, count: number }>();
    let chunkTableIdx = 0x04;
    for (let i = 0; i < chunkCount; i++) {
        const type = readString(buffer, chunkTableIdx + 0x00, 0x04);
        const count = view.getUint32(chunkTableIdx + 0x04);
        const offs = view.getUint32(chunkTableIdx + 0x08);
        chunkOffsets.set(type, { offs, count });
        chunkTableIdx += 0x0C;
    }

    const { offs: rtblOffs, count: rtblCount } = chunkOffsets.get('RTBL');
    let roomList = new Set<number>();
    for (let i = 0; i < rtblCount; i++) {
        const rtblEntryOffs = view.getUint32(rtblOffs + i * 0x04);
        const roomTableCount = view.getUint8(rtblEntryOffs + 0x00);
        if (roomTableCount === 0)
            continue;
        const roomTableOffs = view.getUint32(rtblEntryOffs + 0x04);
        roomList.add(view.getUint8(roomTableOffs + 0x00) & 0x3F);
    }
    return [... roomList.values()];
}

class TwilightPrincessSceneDesc implements Viewer.SceneDesc {
    public id: string;

    constructor(public name: string, public folder: string) {
        this.id = this.folder;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        const basePath = `data/j3d/ztp/${this.folder}`;
        const textureHolder = new ZTPTextureHolder();

        return this.fetchRarc(`${basePath}/STG_00.arc`).then((stageRarc: RARC.RARC) => {
            // Load stage shared textures.
            const texcFolder = stageRarc.findDir(`texc`);
            const extraTextureFiles = texcFolder !== null ? texcFolder.files : [];
            const extraTextures = extraTextureFiles.map((file) => {
                const name = file.name.split('.')[0];
                return BTI.parse(file.buffer, name).texture;
            });

            textureHolder.addExtraTextures(gl, extraTextures);

            const skyboxScenes: BMDModelInstance[] = [`vrbox_sora`, `vrbox_kasumim`].map((basename) => {
                const bmdFile = stageRarc.findFile(`bmdp/${basename}.bmd`);
                if (!bmdFile)
                    return null;
                const btkFile = stageRarc.findFile(`btk/${basename}.btk`);
                const brkFile = stageRarc.findFile(`brk/${basename}.brk`);
                const bckFile = stageRarc.findFile(`bck/${basename}.bck`);
                const scene = createScene(gl, textureHolder, bmdFile, btkFile, brkFile, bckFile, null);
                scene.setIsSkybox(true);
                return scene;
            }).filter((s) => !!s);

            // Pull out the dzs, get the scene definition.
            const dzsBuffer = stageRarc.findFile(`dzs/stage.dzs`).buffer;

            // TODO(jstpierre): This room list isn't quite right. How does the original game work?
            const roomList = getRoomListFromDZS(dzsBuffer);
            const roomNames = roomList.map((i) => `R${leftPad(''+i, 2)}_00`);

            return Progressable.all(roomNames.map(name => this.fetchRarc(`${basePath}/${name}.arc`))).then((roomRarcs: (RARC.RARC | null)[]) => {
                const roomScenes_: BMDModelInstance[][] = roomRarcs.map((rarc: RARC.RARC | null, i: number) => {
                    if (rarc === null) return null;
                    return createScenesFromRARC(gl, textureHolder, roomNames[i], rarc);
                });
                const roomScenes: BMDModelInstance[] = [];
                roomScenes_.forEach((scenes: BMDModelInstance[]) => roomScenes.push.apply(roomScenes, scenes));

                return new TwilightPrincessRenderer(textureHolder, stageRarc, roomRarcs, skyboxScenes, roomScenes, roomNames);
            });
        });
    }

    private fetchRarc(path: string): Progressable<RARC.RARC | null> {
        return fetchData(path).then((buffer: ArrayBufferSlice) => {
            if (buffer.byteLength === 0) return null;
            return Yaz0.decompress(buffer).then((buffer: ArrayBufferSlice) => RARC.parse(buffer));
        });
    }
}

const id = "ztp";
const name = "The Legend of Zelda: Twilight Princess";

const sceneDescs: Viewer.SceneDesc[] = [
    new TwilightPrincessSceneDesc("Forest Temple", "D_MN05"),
    new TwilightPrincessSceneDesc("Goron Mines", "D_MN04"),
    new TwilightPrincessSceneDesc("Lakebed Temple", "D_MN01"),
    new TwilightPrincessSceneDesc("Arbiter's Grounds", "D_MN10"),
    new TwilightPrincessSceneDesc("Snowpeak Ruins", "D_MN11"),
    new TwilightPrincessSceneDesc("Temple of Time", "D_MN06"),
    new TwilightPrincessSceneDesc("City in the Sky", "D_MN07"),
    new TwilightPrincessSceneDesc("Palace of Twilight", "D_MN08"),
    new TwilightPrincessSceneDesc("Hyrule Castle", "D_MN09"),
    new TwilightPrincessSceneDesc("Hyrule Field", "F_SP102"),
    new TwilightPrincessSceneDesc("Fishing Pond", "F_SP127"),

    new TwilightPrincessSceneDesc("D_MN01A", "D_MN01A"),
    new TwilightPrincessSceneDesc("D_MN01B", "D_MN01B"),
    new TwilightPrincessSceneDesc("D_MN04A", "D_MN04A"),
    new TwilightPrincessSceneDesc("D_MN04B", "D_MN04B"),
    new TwilightPrincessSceneDesc("D_MN05A", "D_MN05A"),
    new TwilightPrincessSceneDesc("D_MN05B", "D_MN05B"),
    new TwilightPrincessSceneDesc("D_MN06A", "D_MN06A"),
    new TwilightPrincessSceneDesc("D_MN06B", "D_MN06B"),
    new TwilightPrincessSceneDesc("D_MN07A", "D_MN07A"),
    new TwilightPrincessSceneDesc("D_MN07B", "D_MN07B"),
    new TwilightPrincessSceneDesc("D_MN08A", "D_MN08A"),
    new TwilightPrincessSceneDesc("D_MN08B", "D_MN08B"),
    new TwilightPrincessSceneDesc("D_MN08C", "D_MN08C"),
    new TwilightPrincessSceneDesc("D_MN08D", "D_MN08D"),
    new TwilightPrincessSceneDesc("D_MN09A", "D_MN09A"),
    new TwilightPrincessSceneDesc("D_MN09B", "D_MN09B"),
    new TwilightPrincessSceneDesc("D_MN09C", "D_MN09C"),
    new TwilightPrincessSceneDesc("D_MN10A", "D_MN10A"),
    new TwilightPrincessSceneDesc("D_MN10B", "D_MN10B"),
    new TwilightPrincessSceneDesc("D_MN11A", "D_MN11A"),
    new TwilightPrincessSceneDesc("D_MN11B", "D_MN11B"),
    new TwilightPrincessSceneDesc("D_SB00", "D_SB00"),
    new TwilightPrincessSceneDesc("D_SB01", "D_SB01"),
    new TwilightPrincessSceneDesc("D_SB02", "D_SB02"),
    new TwilightPrincessSceneDesc("D_SB03", "D_SB03"),
    new TwilightPrincessSceneDesc("D_SB04", "D_SB04"),
    new TwilightPrincessSceneDesc("D_SB05", "D_SB05"),
    new TwilightPrincessSceneDesc("D_SB06", "D_SB06"),
    new TwilightPrincessSceneDesc("D_SB07", "D_SB07"),
    new TwilightPrincessSceneDesc("D_SB08", "D_SB08"),
    new TwilightPrincessSceneDesc("D_SB09", "D_SB09"),
    new TwilightPrincessSceneDesc("D_SB10", "D_SB10"),
    new TwilightPrincessSceneDesc("F_SP00", "F_SP00"),
    new TwilightPrincessSceneDesc("F_SP103", "F_SP103"),
    new TwilightPrincessSceneDesc("F_SP104", "F_SP104"),
    new TwilightPrincessSceneDesc("F_SP108", "F_SP108"),
    new TwilightPrincessSceneDesc("F_SP109", "F_SP109"),
    new TwilightPrincessSceneDesc("F_SP110", "F_SP110"),
    new TwilightPrincessSceneDesc("F_SP111", "F_SP111"),
    new TwilightPrincessSceneDesc("F_SP112", "F_SP112"),
    new TwilightPrincessSceneDesc("F_SP113", "F_SP113"),
    new TwilightPrincessSceneDesc("F_SP114", "F_SP114"),
    new TwilightPrincessSceneDesc("F_SP115", "F_SP115"),
    new TwilightPrincessSceneDesc("F_SP116", "F_SP116"),
    new TwilightPrincessSceneDesc("F_SP117", "F_SP117"),
    new TwilightPrincessSceneDesc("F_SP118", "F_SP118"),
    new TwilightPrincessSceneDesc("F_SP121", "F_SP121"),
    new TwilightPrincessSceneDesc("F_SP122", "F_SP122"),
    new TwilightPrincessSceneDesc("F_SP123", "F_SP123"),
    new TwilightPrincessSceneDesc("F_SP124", "F_SP124"),
    new TwilightPrincessSceneDesc("F_SP125", "F_SP125"),
    new TwilightPrincessSceneDesc("F_SP126", "F_SP126"),
    new TwilightPrincessSceneDesc("F_SP128", "F_SP128"),
    new TwilightPrincessSceneDesc("F_SP200", "F_SP200"),
    new TwilightPrincessSceneDesc("R_SP01", "R_SP01"),
    new TwilightPrincessSceneDesc("R_SP107", "R_SP107"),
    new TwilightPrincessSceneDesc("R_SP108", "R_SP108"),
    new TwilightPrincessSceneDesc("R_SP109", "R_SP109"),
    new TwilightPrincessSceneDesc("R_SP110", "R_SP110"),
    new TwilightPrincessSceneDesc("R_SP116", "R_SP116"),
    new TwilightPrincessSceneDesc("R_SP127", "R_SP127"),
    new TwilightPrincessSceneDesc("R_SP128", "R_SP128"),
    new TwilightPrincessSceneDesc("R_SP160", "R_SP160"),
    new TwilightPrincessSceneDesc("R_SP161", "R_SP161"),
    new TwilightPrincessSceneDesc("R_SP209", "R_SP209"),
    new TwilightPrincessSceneDesc("R_SP300", "R_SP300"),
    new TwilightPrincessSceneDesc("R_SP301", "R_SP301"),    
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
