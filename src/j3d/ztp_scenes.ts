
import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';
import { fetchData } from '../fetch';
import * as Viewer from '../viewer';
import * as Yaz0 from '../compression/Yaz0';
import * as UI from '../ui';

import { BMD, BMT, BTK, BTI, TEX1_TextureData, BRK, BCK } from './j3d';
import * as RARC from './rarc';
import { BMDModel, BMDModelInstance, J3DTextureHolder } from './render';
import { EFB_WIDTH, EFB_HEIGHT } from '../gx/gx_material';
import { TextureOverride } from '../TextureHolder';
import { readString, leftPad } from '../util';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { GXRenderHelperGfx } from '../gx/gx_render';
import { GfxRenderInstViewRenderer } from '../gfx/render/GfxRenderer';
import { BasicRenderTarget, ColorTexture, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, noClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';

class ZTPTextureHolder extends J3DTextureHolder {
    protected findTextureEntryIndex(name: string): number {
        let i: number = -1;

        i = this.searchTextureEntryIndex(name);
        if (i >= 0) return i;

        i = this.searchTextureEntryIndex(`ExtraTex/${name.toLowerCase().replace('.tga', '')}`);
        if (i >= 0) return i;

        return -1;
    }

    public addExtraTextures(device: GfxDevice, extraTextures: TEX1_TextureData[]): void {
        this.addTexturesGfx(device, extraTextures.map((texture) => {
            const name = `ExtraTex/${texture.name.toLowerCase()}`;
            return { ...texture, name };
        }));
    }
}

function createScene(device: GfxDevice, renderHelper: GXRenderHelperGfx, textureHolder: J3DTextureHolder, bmdFile: RARC.RARCFile, btkFile: RARC.RARCFile, brkFile: RARC.RARCFile, bckFile: RARC.RARCFile, bmtFile: RARC.RARCFile) {
    const bmd = BMD.parse(bmdFile.buffer);
    const bmt = bmtFile ? BMT.parse(bmtFile.buffer) : null;
    textureHolder.addJ3DTextures(device, bmd, bmt);
    const bmdModel = new BMDModel(device, renderHelper, bmd, bmt);
    const scene = new BMDModelInstance(device, renderHelper, textureHolder, bmdModel);

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

const enum ZTPPass {
    SKYBOX = 1 << 0,
    OPAQUE = 1 << 1,
    INDIRECT = 1 << 2,
    TRANSPARENT = 1 << 3,
}

class TwilightPrincessRenderer implements Viewer.SceneGfx {
    public renderHelper: GXRenderHelperGfx;
    public viewRenderer = new GfxRenderInstViewRenderer();
    public mainRenderTarget = new BasicRenderTarget();
    public opaqueSceneTexture = new ColorTexture();
    public modelInstances: BMDModelInstance[] = [];

    constructor(device: GfxDevice, public textureHolder: J3DTextureHolder, public stageRarc: RARC.RARC) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    public createPanels(): UI.Panel[] {
        const layers = new UI.LayerPanel();
        layers.setLayers(this.modelInstances);
        return [layers];
    }

    public finish(device: GfxDevice): void {
        this.renderHelper.finishBuilder(device, this.viewRenderer);
    }

    private prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(20, 500000);
        this.renderHelper.fillSceneParams(viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender(hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        this.mainRenderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.opaqueSceneTexture.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);

        const skyboxPassRenderer = device.createRenderPass(this.mainRenderTarget.gfxRenderTarget, standardFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, skyboxPassRenderer, ZTPPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);

        const opaquePassRenderer = device.createRenderPass(this.mainRenderTarget.gfxRenderTarget, depthClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, opaquePassRenderer, ZTPPass.OPAQUE);

        let lastPassRenderer: GfxRenderPass;
        if (this.textureHolder.hasTexture('fbtex_dummy')) {
            opaquePassRenderer.endPass(this.opaqueSceneTexture.gfxTexture);
            device.submitPass(opaquePassRenderer);

            const textureOverride: TextureOverride = { gfxTexture: this.opaqueSceneTexture.gfxTexture, width: EFB_WIDTH, height: EFB_HEIGHT, flipY: true };
            this.textureHolder.setTextureOverride("fbtex_dummy", textureOverride);

            const indTexPassRenderer = device.createRenderPass(this.mainRenderTarget.gfxRenderTarget, noClearRenderPassDescriptor);
            this.viewRenderer.executeOnPass(device, indTexPassRenderer, ZTPPass.INDIRECT);
            lastPassRenderer = indTexPassRenderer;
        } else {
            lastPassRenderer = opaquePassRenderer;
        }

        this.viewRenderer.executeOnPass(device, lastPassRenderer, ZTPPass.TRANSPARENT);
        return lastPassRenderer;
    }

    public destroy(device: GfxDevice) {
        this.renderHelper.destroy(device);
        this.viewRenderer.destroy(device);
        this.textureHolder.destroyGfx(device);
        this.mainRenderTarget.destroy(device);
        this.opaqueSceneTexture.destroy(device);
        this.modelInstances.forEach((instance) => instance.destroy(device));
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

    private createRoomScenes(device: GfxDevice, renderer: TwilightPrincessRenderer, rarc: RARC.RARC, rarcBasename: string): void {
        const bmdFiles = rarc.files.filter((f) => f.name.endsWith('.bmd') || f.name.endsWith('.bdl'));
        bmdFiles.forEach((bmdFile) => {
            const basename = bmdFile.name.split('.')[0];
            const btkFile = rarc.files.find((f) => f.name === `${basename}.btk`) || null;
            const brkFile = rarc.files.find((f) => f.name === `${basename}.brk`) || null;
            const bckFile = rarc.files.find((f) => f.name === `${basename}.bck`) || null;
            const bmtFile = rarc.files.find((f) => f.name === `${basename}.bmt`) || null;

            let passMask: ZTPPass = 0;
            if (basename === 'model') {
                passMask = ZTPPass.OPAQUE;
            } else if (basename === 'model1') {
                passMask = ZTPPass.INDIRECT;
            } else if (basename === 'model2') {
                passMask = ZTPPass.TRANSPARENT;
            } else if (basename === 'model3') {
                // Window/doorways.
                passMask = ZTPPass.TRANSPARENT;
            } else if (basename === 'model4' || basename === 'model5') {
                // Light beams? No clue, stick 'em in the transparent pass.
                passMask = ZTPPass.TRANSPARENT;
            }
    
            const scene = createScene(device, renderer.renderHelper, renderer.textureHolder, bmdFile, btkFile, brkFile, bckFile, bmtFile);
            scene.name = `${rarcBasename}/${basename}`;
            scene.passMask = passMask;
            renderer.modelInstances.push(scene);
        });
    }

    public createSceneGfx(device: GfxDevice): Progressable<Viewer.SceneGfx> {
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

            textureHolder.addExtraTextures(device, extraTextures);

            const renderer = new TwilightPrincessRenderer(device, textureHolder, stageRarc);

            [`vrbox_sora`, `vrbox_kasumim`].forEach((basename) => {
                const bmdFile = stageRarc.findFile(`bmdp/${basename}.bmd`);
                if (!bmdFile)
                    return null;
                const btkFile = stageRarc.findFile(`btk/${basename}.btk`);
                const brkFile = stageRarc.findFile(`brk/${basename}.brk`);
                const bckFile = stageRarc.findFile(`bck/${basename}.bck`);
                const scene = createScene(device, renderer.renderHelper, textureHolder, bmdFile, btkFile, brkFile, bckFile, null);
                scene.name = `stage/${basename}`;
                scene.setIsSkybox(true);
                renderer.modelInstances.push(scene);
            });

            // Pull out the dzs, get the scene definition.
            const dzsBuffer = stageRarc.findFile(`dzs/stage.dzs`).buffer;

            // TODO(jstpierre): This room list isn't quite right. How does the original game work?
            const roomList = getRoomListFromDZS(dzsBuffer);
            const roomNames = roomList.map((i) => `R${leftPad(''+i, 2)}_00`);

            return Progressable.all(roomNames.map((roomName) => this.fetchRarc(`${basePath}/${roomName}.arc`))).then((roomRarcs: (RARC.RARC | null)[]) => {
                roomRarcs.forEach((rarc: RARC.RARC | null, i) => {
                    if (rarc === null) return;
                    this.createRoomScenes(device, renderer, rarc, roomNames[i]);
                });

                renderer.finish(device);
                return renderer;
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

// Special thanks to Jawchewa for helping me with naming the maps.
const sceneDescs = [
    "Overworld Maps",
    new TwilightPrincessSceneDesc("Hyrule Field Map 1", "F_SP102"),
    new TwilightPrincessSceneDesc("Hyrule Field Map 2", "F_SP121"),
    new TwilightPrincessSceneDesc("Hyrule Field Map 3", "F_SP122"),
    new TwilightPrincessSceneDesc("Lake Hylia", "F_SP123"),

    new TwilightPrincessSceneDesc("Ordon Ranch", "F_SP00"),
    new TwilightPrincessSceneDesc("Link's House Area", "F_SP103"),
    new TwilightPrincessSceneDesc("Ordon Woods", "F_SP104"),
    new TwilightPrincessSceneDesc("Faron Woods", "F_SP108"),
    new TwilightPrincessSceneDesc("Kakariko Village", "F_SP109"),
    new TwilightPrincessSceneDesc("Death Mountain Trail", "F_SP110"),
    new TwilightPrincessSceneDesc("Kakariko Graveyard", "F_SP111"),
    new TwilightPrincessSceneDesc("Rapid's Ride", "F_SP112"),
    new TwilightPrincessSceneDesc("Zora's Domain", "F_SP113"),
    new TwilightPrincessSceneDesc("Snowpeak Mountain", "F_SP114"),
    new TwilightPrincessSceneDesc("Lanayru's Spring", "F_SP115"),
    new TwilightPrincessSceneDesc("Castle Town", "F_SP116"),
    new TwilightPrincessSceneDesc("Sacred Grove", "F_SP117"),
    new TwilightPrincessSceneDesc("Gerudo Desert Bulblin Base", "F_SP118"),
    new TwilightPrincessSceneDesc("Gerudo Desert", "F_SP124"),
    new TwilightPrincessSceneDesc("Arbiter's Grounds Mirror Chamber", "F_SP125"),
    new TwilightPrincessSceneDesc("Zora's River", "F_SP126"),
    new TwilightPrincessSceneDesc("Fishing Pond", "F_SP127"),
    new TwilightPrincessSceneDesc("Hidden Village", "F_SP128"),
    new TwilightPrincessSceneDesc("Wolf Howling Cutscene Map", "F_SP200"),

    "Dungeons",
    new TwilightPrincessSceneDesc("Forest Temple", "D_MN05"),
    new TwilightPrincessSceneDesc("Forest Temple Boss Arena", "D_MN05A"),
    new TwilightPrincessSceneDesc("Forest Temple Mini-Boss Arena", "D_MN05B"),

    new TwilightPrincessSceneDesc("Goron Mines", "D_MN04"),
    new TwilightPrincessSceneDesc("Goron Mines Boss Arena", "D_MN04A"),
    new TwilightPrincessSceneDesc("Goron Mines Mini-Boss Arena", "D_MN04B"),

    new TwilightPrincessSceneDesc("Lakebed Temple", "D_MN01"),
    new TwilightPrincessSceneDesc("Lakebed Temple Boss Arena", "D_MN01A"),
    new TwilightPrincessSceneDesc("Lakebed Temple Mini-Boss Arena", "D_MN01B"),

    new TwilightPrincessSceneDesc("Arbiter's Grounds", "D_MN10"),
    new TwilightPrincessSceneDesc("Arbiter's Grounds Boss Arena", "D_MN10A"),
    new TwilightPrincessSceneDesc("Arbiter's Grounds Mini-Boss Arena", "D_MN10B"),

    new TwilightPrincessSceneDesc("Snowpeak Ruins", "D_MN11"),
    new TwilightPrincessSceneDesc("Snowpeak Ruins Boss Arena", "D_MN11A"),
    new TwilightPrincessSceneDesc("Snowpeak Ruins Mini-Boss Arena", "D_MN11B"),

    new TwilightPrincessSceneDesc("Temple of Time", "D_MN06"),
    new TwilightPrincessSceneDesc("Temple of Time Boss Arena", "D_MN06A"),
    new TwilightPrincessSceneDesc("Temple of Time Mini-Boss Arena", "D_MN06B"),

    new TwilightPrincessSceneDesc("City in the Sky", "D_MN07"),
    new TwilightPrincessSceneDesc("City in the Sky Boss Arena", "D_MN07A"),
    new TwilightPrincessSceneDesc("City in the Sky Mini-Boss Arena", "D_MN07B"),

    new TwilightPrincessSceneDesc("Palace of Twilight", "D_MN08"),
    new TwilightPrincessSceneDesc("Palace of Twilight Boss Arena 1", "D_MN08A"),
    new TwilightPrincessSceneDesc("Palace of Twilight Mini-Boss Arena 1", "D_MN08B"),
    new TwilightPrincessSceneDesc("Palace of Twilight Mini-Boss Arena 2", "D_MN08C"),
    new TwilightPrincessSceneDesc("Palace of Twilight Boss Rush Arena", "D_MN08D"),

    new TwilightPrincessSceneDesc("Hyrule Castle", "D_MN09"),
    new TwilightPrincessSceneDesc("Hyrule Castle Boss Arena", "D_MN09A"),
    new TwilightPrincessSceneDesc("Final Boss Arena (On Horseback)", "D_MN09B"),
    new TwilightPrincessSceneDesc("Final Boss Arena", "D_MN09C"),

    "Mini-Dungeons and Grottos",
    new TwilightPrincessSceneDesc("Ice Cavern", "D_SB00"),
    new TwilightPrincessSceneDesc("Cave Of Ordeals", "D_SB01"),
    new TwilightPrincessSceneDesc("Kakariko Lantern Cavern", "D_SB02"),
    new TwilightPrincessSceneDesc("Lake Hylia Lantern Cavern", "D_SB03"),
    new TwilightPrincessSceneDesc("Goron Mines Lantern Cavern", "D_SB04"),
    new TwilightPrincessSceneDesc("Faron Woods Lantern Cavern", "D_SB10"),
    new TwilightPrincessSceneDesc("Faron Woods Cave 1", "D_SB05"),
    new TwilightPrincessSceneDesc("Faron Woods Cave 2", "D_SB06"),
    new TwilightPrincessSceneDesc("Snow Cave 1", "D_SB07"),
    new TwilightPrincessSceneDesc("Snow Cave 2", "D_SB08"),
    new TwilightPrincessSceneDesc("Water Cave", "D_SB09"),

    "Houses / Indoors",
    new TwilightPrincessSceneDesc("Ordon Village Houses", "R_SP01"),
    new TwilightPrincessSceneDesc("Hyrule Castle Wolf Escape", "R_SP107"),
    new TwilightPrincessSceneDesc("Unknown (R_SP108)", "R_SP108"),
    new TwilightPrincessSceneDesc("Kakariko Village Houses", "R_SP109"),
    new TwilightPrincessSceneDesc("Goron Mines Entrance", "R_SP110"),
    new TwilightPrincessSceneDesc("Telma's Bar + Castle Town Sewers", "R_SP116"),
    new TwilightPrincessSceneDesc("Fishing Hole Interior", "R_SP127"),
    new TwilightPrincessSceneDesc("Unknown (R_SP128)", "R_SP128"),
    new TwilightPrincessSceneDesc("Castle Town Houses", "R_SP160"),
    new TwilightPrincessSceneDesc("Star Tent", "R_SP161"),
    new TwilightPrincessSceneDesc("Kakariko Sanctuary", "R_SP209"),
    new TwilightPrincessSceneDesc("Unknown (R_SP300): Gold Water?", "R_SP300"),
    new TwilightPrincessSceneDesc("Cutscene: Hyrule Castle Throne Room", "R_SP301"),    
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
