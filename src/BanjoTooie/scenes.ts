
import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as Geo from '../BanjoKazooie/geo';
import * as BYML from '../byml';

import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { FakeTextureHolder, TextureHolder } from '../TextureHolder';
import { textureToCanvas, BKPass, RenderData, GeometryData, BKLayer } from '../BanjoKazooie/render';
import { GeometryRenderer } from './render';
import { opaqueBlackFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, BasicRenderTarget } from '../gfx/helpers/RenderTargetHelpers';
import { SceneContext } from '../SceneBase';
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { executeOnPass, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderer';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { CameraController } from '../Camera';
import { hexzero, assertExists } from '../util';
import { DataFetcher, AbortedCallback, DataFetcherFlags } from '../DataFetcher';
import { MathConstants, computeModelMatrixSRT } from '../MathHelpers';
import { mat4, vec3 } from 'gl-matrix';

const pathBase = `BanjoTooie`;

class BTRenderer implements Viewer.SceneGfx {
    public geoRenderers: GeometryRenderer[] = [];
    public geoDatas: RenderData[] = [];

    public renderTarget = new BasicRenderTarget();
    public renderHelper: GfxRenderHelper;

    constructor(device: GfxDevice, public textureHolder: TextureHolder<any>, public modelCache: ModelCache) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(30 / 60);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();

        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableCullingCheckbox = new UI.Checkbox('Enable Culling', true);
        enableCullingCheckbox.onchanged = () => {
            for (let i = 0; i < this.geoRenderers.length; i++)
                this.geoRenderers[i].setBackfaceCullingEnabled(enableCullingCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableCullingCheckbox.elem);
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.geoRenderers.length; i++)
                this.geoRenderers[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.geoRenderers.length; i++)
                this.geoRenderers[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);
        const enableMonochromeVertexColors = new UI.Checkbox('Grayscale Vertex Colors', false);
        enableMonochromeVertexColors.onchanged = () => {
            for (let i = 0; i < this.geoRenderers.length; i++)
                this.geoRenderers[i].setMonochromeVertexColorsEnabled(enableMonochromeVertexColors.checked);
        };
        renderHacksPanel.contents.appendChild(enableMonochromeVertexColors.elem);
        const enableAlphaVisualizer = new UI.Checkbox('Visualize Vertex Alpha', false);
        enableAlphaVisualizer.onchanged = () => {
            for (let i = 0; i < this.geoRenderers.length; i++)
                this.geoRenderers[i].setAlphaVisualizerEnabled(enableAlphaVisualizer.checked);
        };
        renderHacksPanel.contents.appendChild(enableAlphaVisualizer.elem);

        return [renderHacksPanel];
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();
        for (let i = 0; i < this.geoRenderers.length; i++)
            this.geoRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        const renderInstManager = this.renderHelper.renderInstManager;

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, opaqueBlackFullClearRenderPassDescriptor);
        executeOnPass(renderInstManager, device, skyboxPassRenderer, BKPass.SKYBOX);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);
        executeOnPass(renderInstManager, device, mainPassRenderer, BKPass.MAIN);

        renderInstManager.resetRenderInsts();

        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);
        for (let i = 0; i < this.geoDatas.length; i++)
            this.geoDatas[i].destroy(device);
        this.textureHolder.destroy(device);
    }
}

interface CRG1File {
    FileID: number;
    Data: ArrayBufferSlice;
}

interface CRG1Archive {
    Files: CRG1File[];
}

function findFileByID(archive: CRG1Archive, fileID: number): CRG1File | null {
    if (fileID === -1)
        return null;
    const file = archive.Files.find((file) => file.FileID === fileID);
    if (file === undefined)
        return null;
    return file;
}

const cameraLengths = [0, 4, 4, 12, 12, 12, 8, 8, 4, 4, 2, 4, 4, 4, 4, 4, 4, 4, 4, 4];

function parseCamera(view: DataView, offs: number): number {
    if (view.getUint8(offs) === 0x14)
        offs += 5;
    const next = view.getUint8(offs);
    if (next === 0) {
        offs++;
        return offs;
    }
    while (true) {
        const size = cameraLengths[view.getUint8(offs++)];
        if (size === 0 && view.getUint8(offs) === 0) {
            offs++;
            break;
        }
        offs += size;
    }
    return offs;
}

interface ActorArchive {
    Name: string;
    Definition: ArrayBufferSlice;
    Files: CRG1File[];
    IsFlipbook: boolean;
}

interface StaticArchive {
    Models: ArrayBufferSlice;
    Flipbooks: ArrayBufferSlice;
    Files: CRG1File[];
}

class ModelCache {
    public archivePromiseCache = new Map<number, Promise<ActorArchive | StaticArchive | null>>();
    public archiveCache = new Map<number, ActorArchive | StaticArchive | null>();
    public archiveDataHolder = new Map<number, GeometryData>();
    public cache = new GfxRenderCache();

    public static staticGeometryFlag = 0x10000;
    public static staticFlipbookMask = 0x20000;

    constructor(public device: GfxDevice, private pathBase: string, private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<void> {
        const v: Promise<any>[] = [... this.archivePromiseCache.values()];
        return Promise.all(v) as Promise<any>;
    }

    private async requestActorArchiveInternal(id: number, abortedCallback: AbortedCallback): Promise<ActorArchive | null> {
        const archiveName = id >= 0 ? `actor/${hexzero(id, 3).toUpperCase()}_arc.crg1` : 'static_arc.crg1';
        const buffer = await this.dataFetcher.fetchData(`${this.pathBase}/${archiveName}`, DataFetcherFlags.ALLOW_404, abortedCallback);

        if (buffer.byteLength === 0) {
            console.warn(`Could not fetch archive ${archiveName}`);
            return null;
        }

        const arc = BYML.parse(buffer, BYML.FileType.CRG1) as ActorArchive;
        this.archiveCache.set(id, arc);
        return arc;
    }

    public async requestActorArchive(id: number): Promise<ActorArchive | StaticArchive | null> {
        if (this.archivePromiseCache.has(id))
            return this.archivePromiseCache.get(id)!;

        const p = this.requestActorArchiveInternal(id, () => {
            this.archivePromiseCache.delete(id);
        });
        this.archivePromiseCache.set(id, p);
        return p;
    }

    public hasArchive(id: number): boolean {
        return this.archiveCache.has(id) && this.archiveCache.get(id) !== null;
    }

    public getArchive(id: number): ActorArchive {
        return assertExists(this.archiveCache.get(id)) as ActorArchive;
    }

    public getActorData(id: number): GeometryData | null {
        if (this.archiveDataHolder.has(id))
            return this.archiveDataHolder.get(id)!;

        const arc = this.getArchive(id);
        if (arc.Files.length === 0 || arc.IsFlipbook)
            return null;

        const geo = Geo.parseBT(arc.Files[0].Data, Geo.RenderZMode.OPA, arc.Files[1]?.Data);
        const data = new GeometryData(this.device, this.cache, geo);
        this.archiveDataHolder.set(id, data);
        return data;

    }

    public getStaticData(id: number, isGeometry: boolean): GeometryData | null {
        if (!isGeometry)
            return null;
        const flag = isGeometry ? ModelCache.staticGeometryFlag : ModelCache.staticFlipbookMask;
        if (this.archiveDataHolder.has(id | flag))
            return this.archiveDataHolder.get(id | flag)!;

        const arc = assertExists(this.archiveCache.get(-1)) as StaticArchive;
        const modelID = arc.Models.createDataView().getUint16(2*id);
        if (!modelID)
            return null;

        const geo = Geo.parseBT(findFileByID(arc, modelID)!.Data, Geo.RenderZMode.OPA);
        const data = new GeometryData(this.device, this.cache, geo);
        this.archiveDataHolder.set(id | flag, data);
        return data;
    }

    public destroy(device: GfxDevice): void {
        this.cache.destroy(device);
        for (const data of this.archiveDataHolder.values())
            data.renderData.destroy(device);
    }
}

async function addObjects(view: DataView, offs: number, renderer: BTRenderer): Promise<number> {
    let actorCount = -1;
    let actorStart = -1;
    let staticCount = -1;

    let block = view.getUint8(offs);
    if (block === 0x0A) {
        actorCount = view.getUint32(offs + 1);
        offs += 5;
        actorStart = offs;
        for (let i = 0; i < actorCount; i++) {
            const category = (view.getUint8(offs + 0x07) >>> 1) & 0x3F;
            const id = view.getUint16(offs + 0x08);
            if (category === 6)
                renderer.modelCache.requestActorArchive(id);
            offs += 0x14;
        }
    }
    block = view.getUint8(offs);
    if (block === 0x08) {
        staticCount = view.getUint32(offs + 1);
        offs += 5;
        renderer.modelCache.requestActorArchive(-1);
    }

    await renderer.modelCache.waitForLoad();

    for (let i = 0; i < actorCount; i++) {
        const actorOffs = actorStart + i*0x14;
        const pos = vec3.fromValues(
            view.getInt16(actorOffs + 0x00),
            view.getInt16(actorOffs + 0x02),
            view.getInt16(actorOffs + 0x04),
        );
        const category = (view.getUint8(actorOffs + 0x07) >>> 1) & 0x3F;
        const id = view.getUint16(actorOffs + 0x08);
        const yaw = view.getUint16(actorOffs + 0x0C) >>> 7;

        if (category !== 6 || !renderer.modelCache.hasArchive(id))
            continue;
        const data = renderer.modelCache.getActorData(id);
        if (data === null)
            continue;

        const actor = new GeometryRenderer(renderer.modelCache.device, data);
        mat4.fromTranslation(actor.modelMatrix, pos);
        mat4.rotateY(actor.modelMatrix, actor.modelMatrix, yaw * MathConstants.DEG_TO_RAD);
        actor.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT + BKLayer.Opaque);
        renderer.geoRenderers.push(actor);
    }

    for (let i = 0; i < staticCount; i++) {
        const id = view.getUint16(offs + 0x00) >>> 4;
        const pos = vec3.fromValues(
            view.getInt16(offs + 0x04),
            view.getInt16(offs + 0x06),
            view.getInt16(offs + 0x08),
        );
        const yaw = view.getUint8(offs + 0x02) * 2;
        const roll = view.getUint8(offs + 0x03) * 2;
        const scale = view.getUint8(offs + 0x0A) / 100.0;
        const isGeometry =  !!(view.getUint8(offs + 0x0B) & 2);
        offs += 0x0C;

        const data = renderer.modelCache.getStaticData(id, isGeometry);
        if (data === null)
            continue;

        const obj = new GeometryRenderer(renderer.modelCache.device, data);
        computeModelMatrixSRT(obj.modelMatrix,
            scale, scale, scale,
            0, yaw * MathConstants.DEG_TO_RAD, roll * MathConstants.DEG_TO_RAD,
            pos[0], pos[1], pos[2]
        );
        obj.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT + BKLayer.Opaque);
        renderer.geoRenderers.push(obj);
    }

    if (view.getUint8(offs) === 1)
        offs++;
    return offs;
}

async function parseSetup(setupFile: ArrayBufferSlice, renderer: BTRenderer): Promise<void> {
    const view = setupFile.createDataView();
    let offs = 0;
    while (true) {
        switch(view.getUint8(offs++)) {
            case 2:
            case 5:
                continue;
            case 1:
                console.warn("section 1 before objects");
                return;
            case 4:
                console.warn("section 4 before objects");
                return;
            case 6:
                offs = parseCamera(view, offs); break;
            case 7:
                offs = await addObjects(view, offs, renderer);
                return;
            default:
                return;
        }
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    private addGeo(device: GfxDevice, cache: GfxRenderCache, viewerTextures: Viewer.Texture[], sceneRenderer: BTRenderer, geo: Geo.Geometry<Geo.BTGeoNode>): GeometryRenderer {
        for (let i = 0; i < geo.sharedOutput.textureCache.textures.length; i++)
            viewerTextures.push(textureToCanvas(geo.sharedOutput.textureCache.textures[i]));

        const geoData = new GeometryData(device, cache, geo);
        sceneRenderer.geoDatas.push(geoData.renderData);
        const geoRenderer = new GeometryRenderer(device, geoData);
        sceneRenderer.geoRenderers.push(geoRenderer);
        return geoRenderer;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const modelCache = await context.dataShare.ensureObject<ModelCache>(pathBase, async () => {
            return new ModelCache(device, pathBase, context.dataFetcher);
        });

        const obj: any = BYML.parse(await context.dataFetcher.fetchData(`${pathBase}/${this.id}_arc.crg1`)!, BYML.FileType.CRG1);

        const viewerTextures: Viewer.Texture[] = [];
        const fakeTextureHolder = new FakeTextureHolder(viewerTextures);
        const sceneRenderer = new BTRenderer(device, fakeTextureHolder, modelCache);
        const cache = sceneRenderer.renderHelper.getCache();
        const opaFile = findFileByID(obj, obj.OpaGeoFileID);
        if (opaFile !== null) {
            const textures = obj.Files[obj.OpaGeoTextures];
            const geo = Geo.parseBT(opaFile.Data, Geo.RenderZMode.OPA, textures?.Data);
            const opa = this.addGeo(device, cache, viewerTextures, sceneRenderer, geo);
            opa.sortKeyBase = makeSortKey(GfxRendererLayer.BACKGROUND);
        }

        const xluFile = findFileByID(obj, obj.XluGeoFileID);
        if (xluFile !== null) {
            const textures = obj.Files[obj.XluGeoTextures];
            const geo = Geo.parseBT(xluFile.Data, Geo.RenderZMode.XLU, textures?.Data);
            const xlu = this.addGeo(device, cache, viewerTextures, sceneRenderer, geo);
            xlu.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT + BKLayer.LevelXLU);
        }

        const opaSkybox = findFileByID(obj, obj.OpaSkyboxFileID);
        if (opaSkybox !== null) {
            const textures = obj.Files[obj.OpaSkyboxTextures];
            const geo = Geo.parseBT(opaSkybox.Data, Geo.RenderZMode.OPA, textures?.Data);
            const renderer = this.addGeo(device, cache, viewerTextures, sceneRenderer, geo);
            renderer.isSkybox = true;
        }

        const xluSkybox = findFileByID(obj, obj.XluSkyboxFileID);
        if (xluSkybox !== null) {
            const textures = obj.Files[obj.XluSkyboxTextures];
            const geo = Geo.parseBT(xluSkybox.Data, Geo.RenderZMode.XLU, textures?.Data);
            const renderer = this.addGeo(device, cache, viewerTextures, sceneRenderer, geo);
            renderer.isSkybox = true;
        }

        await parseSetup(findFileByID(obj, obj.SetupFileID)!.Data, sceneRenderer);

        return sceneRenderer;
    }
}

const id = `bt`;
const name = "Banjo-Tooie";
const sceneDescs = [
    "Spiral Mountain",
    // some of these differ in skybox
    // new SceneDesc('A1', "Spiral Mountain"),
    // new SceneDesc('A2', "Spiral Mountain"),
    // new SceneDesc('A3', "Spiral Mountain"),
    // new SceneDesc('A4', "Spiral Mountain"),
    // new SceneDesc('A5', "Spiral Mountain"),
    // new SceneDesc('A6', "Spiral Mountain"),
    // new SceneDesc('A7', "Spiral Mountain"),
    // new SceneDesc('A8', "Banjo's House"),
    // new SceneDesc('A9', "Banjo's House"),
    // new SceneDesc('AA', "Banjo's House"),
    // new SceneDesc('AB', "Banjo's House"),
    // new SceneDesc('18B', "Spiral Mountain"),
    new SceneDesc('AF', "Spiral Mountain"),
    new SceneDesc('AE', "Behind the Waterfall"),
    new SceneDesc('AD', "Gruntilda's Lair (Entrance)"),
    new SceneDesc('AC', "Banjo's House"),
    new SceneDesc('173', "Banjo's House (Destroyed)"),
    "Isle O' Hags",
    new SceneDesc('141', "Inside the Digger Tunnel"),
    new SceneDesc('142', "Jinjo Village"),
    new SceneDesc('143', "Bottles' House"),
    new SceneDesc('144', "King Jingaling's Throne Room"),
    new SceneDesc('19B', "Zombified Throne Room"),
    new SceneDesc('145', "Green Jinjo Family House"),
    new SceneDesc('146', "Black Jinjo Family House"),
    new SceneDesc('147', "Yellow Jinjo Family House"),
    new SceneDesc('148', "Blue Jinjo Family House"),
    new SceneDesc('14A', "Brown Jinjo Family House"),
    new SceneDesc('14B', "Orange Jinjo Family House"),
    new SceneDesc('14C', "Purple Jinjo Family House"),
    new SceneDesc('14D', "Red Jinjo Family House"),
    new SceneDesc('14E', "White Jinjo Family House"),
    new SceneDesc('14F', "Wooded Hollow"),
    new SceneDesc('150', "Heggy's Egg Shed"),
    new SceneDesc('151', "Jiggywiggy's Temple"),
    new SceneDesc('152', "Plateau"),
    new SceneDesc('153', "Honey B's Hive"),
    new SceneDesc('154', "Pine Grove"),
    new SceneDesc('155', "Cliff Top"),
    new SceneDesc('15A', "Wasteland"),
    new SceneDesc('15B', "Inside Another Digger Tunnel"),
    new SceneDesc('15C', "Quagmire"),

    new SceneDesc('156', "Mumbo's Skull"),
    new SceneDesc('157', "Wumba's Wigwam"),
    new SceneDesc('149', "Shouldn't Be Here Jinjo Family House"),
    "Mayahem Temple",
    new SceneDesc('B8', "Mayahem Temple"),
    new SceneDesc('B9', "Prison Compound"),
    new SceneDesc('BA', "Columns Vault"),
    new SceneDesc('BC', "Code Chamber"),
    new SceneDesc('C4', "Jade Snake Grove"),
    new SceneDesc('C5', "Treasure Chamber"),
    new SceneDesc('179', "Targitzan's Temple (Lobby)"),
    new SceneDesc('178', "Inside Targitzan's Temple"),
    new SceneDesc('177', "Targitzan's Slighty Sacred Chamber"),
    new SceneDesc('17A', "Targitzan's Really Sacred Chamber"),
    new SceneDesc('166', "Targitzan's Temple Shootout"),
    new SceneDesc('BB', "Mayan Kickball Stadium (Lobby)"),
    new SceneDesc('C6', "Mayan Kickball (Quarterfinal)"),
    // new SceneDesc('C8', "Mayan Kickball (Semifinal)"),
    // new SceneDesc('C9', "Mayan Kickball (Final)"),
    // new SceneDesc('17F', "Mayan Kickball Challenge"),
    new SceneDesc('B6', "Wumba's Wigwam"),
    new SceneDesc('B7', "Mumbo's Skull"),
    "Glitter Gulch Mine",
    new SceneDesc('C7', "Glitter Gulch Mine"),
    new SceneDesc('CA', "Fuel Depot"),
    new SceneDesc('CB', "Crushing Shed"),
    new SceneDesc('CC', "Flooded Caves"),
    new SceneDesc('CD', "Water Storage"),
    new SceneDesc('CE', "Waterfall Cavern"),
    new SceneDesc('CF', "Power Hut Basement"),
    new SceneDesc('D0', "Chuffy's Cab"),
    new SceneDesc('D1', "Inside Chuffy's Boiler"),
    new SceneDesc('121', "Inside Chuffy's Wagon"),
    new SceneDesc('D2', "Gloomy Caverns"),
    new SceneDesc('D3', "Generator Cavern"),
    new SceneDesc('D4', "Power Hut"),
    new SceneDesc('D8', "Prospector's Hut"),
    new SceneDesc('DA', "Toxic Gas Cave"),
    new SceneDesc('DB', "Canary Cave"),
    new SceneDesc('DC', "Ordnance Storage"),
    new SceneDesc('126', "Water Supply Pipe (Glitter Gulch Mine)"),

    new SceneDesc('163', "Ordnance Storage Entrance"),
    new SceneDesc('165', "Ordnance Storage Shootout"),

    new SceneDesc('D5', "Wumba's Wigwam"),
    new SceneDesc('D9', "Mumbo's Skull"),
    new SceneDesc('D7', "Train Station (Glitter Gulch Mine)"),
    "Witchyworld",
    new SceneDesc('D6', "Witchyworld"),
    new SceneDesc('DD', "Dodgem Dome Lobby"),
    new SceneDesc('186', "Dodgem Challenge"),
    // new SceneDesc('DE', "Dodgem Challenge (1 vs. 1)"),
    // new SceneDesc('DF', "Dodgem Challenge (2 vs. 1)"),
    // new SceneDesc('E0', "Dodgem Challenge (3 vs. 1)"),

    new SceneDesc('E1', "Crazy Castle Stockade"),
    new SceneDesc('E2', "Crazy Castle Lobby"),
    new SceneDesc('E3', "Crazy Castle Pump Room"),
    new SceneDesc('E4', "Balloon Burst Game"),
    // new SceneDesc('17B', "Balloon Burst Challenge"),
    new SceneDesc('E5', "Hoop Hurry Game"),
    // new SceneDesc('17C', "Hoop Hurry Challenge"),
    new SceneDesc('E6', "Star Spinner"),
    new SceneDesc('E7', "The Inferno"),
    new SceneDesc('EA', "Cave of Horrors"),
    new SceneDesc('EB', "The Haunted Cavern"),
    new SceneDesc('F9', "Big Top Interior"),
    new SceneDesc('124', "Witchyworld: 'Saucer of Peril' Ride"),
    new SceneDesc('13B', "Crazy Castle Stockade: 'Saucer of Peril' Ride"),
    new SceneDesc('13C', "Star Spinner: 'Saucer of Peril' Ride"),

    new SceneDesc('E9', "Wumba's Wigwam"),
    new SceneDesc('EC', "Train Station (Witchyworld)"),
    "Jolly Roger's Lagoon",
    new SceneDesc('ED', "Jolly's"),
    new SceneDesc('EE', "Pawno's Emporium"),
    new SceneDesc('F1', "Inside the UFO"),
    new SceneDesc('F4', "Ancient Swimming Baths"),
    new SceneDesc('F6', "Electric Eels' Lair"),
    new SceneDesc('F7', "Seaweed Sanctum"),
    new SceneDesc('F8', "Inside the Big Fish"),
    new SceneDesc('FA', "Temple of the Fishes"),
    new SceneDesc('FC', "Davy Jones' Locker"),
    new SceneDesc('FF', "Blubber's Waveracer Hire"),
    new SceneDesc('1A7', "Jolly Roger's Lagoon"),
    // new SceneDesc('1A6', "Smugglers' Cavern"), // full names are JRL:
    // new SceneDesc('1A8', "Atlantis"),
    // new SceneDesc('1A9', "Sea Bottom"),
    new SceneDesc('181', "Sea Bottom Cavern"),
    // new SceneDesc('182', "Mini - Sub Shootout"),

    new SceneDesc('EF', "Mumbo's Skull"),
    new SceneDesc('120', "Humba's Wigwam"),
    "Grunty Industries",
    new SceneDesc('100', "Grunty Industries"),
    new SceneDesc('101', "Floor 1"),
    new SceneDesc('103', "Floor 1: Workers' Quarters"),
    new SceneDesc('104', "Floor 1: Trash Compactor"),
    new SceneDesc('105', "Elevator Shaft"),
    new SceneDesc('106', "Floor 2"),
    new SceneDesc('107', "Floor 2: Electromagnet Chamber"),
    new SceneDesc('108', "Floor 3"),
    new SceneDesc('109', "Floor 3: Boiler Plant"),
    new SceneDesc('10A', "Floor 3: Packing Room"),
    // new SceneDesc('17D', "Packing Room Challenge"),
    new SceneDesc('10B', "Floor 4"),
    new SceneDesc('10C', "Floor 4: Cable Room"),
    new SceneDesc('10D', "Floor 4: Quality Control"),
    new SceneDesc('187', "Floor 4: Sewer Entrance"),
    new SceneDesc('162', "Floor 4: Clinkers Cavern"),
    new SceneDesc('164', "Clinkers Cavern Shootout"),
    new SceneDesc('10E', "Floor 5"),
    new SceneDesc('10F', "Basement: Air Conditioning Plant"),
    new SceneDesc('110', "Basement: Repair Depot"),
    new SceneDesc('111', "Basement: Waste Disposal Plant"),
    new SceneDesc('125', "Water Supply Pipe (Grunty Industries)"),

    new SceneDesc('11F', "Humba's Wigwam"),
    new SceneDesc('102', "Train Station (Grunty Industries)"),
    "Terrydactyland",
    new SceneDesc('112', "Terrydactyland"),
    new SceneDesc('113', "Terry's Nest"),
    new SceneDesc('115', "Oogle Boogles' Cave"),
    new SceneDesc('116', "Inside the Mountain"),
    new SceneDesc('117', "River Passage"),
    new SceneDesc('118', "Styracosaurus Family Cave"),
    new SceneDesc('119', "Unga Bungas' Cave"),
    new SceneDesc('11A', "Stomping Plains"),
    new SceneDesc('11B', "Bonfire Cavern"),
    new SceneDesc('123', "Inside Chompa's Belly"),
    // new SceneDesc('183', "Chompa's Belly Challenge"),

    new SceneDesc('11E', "Wumba's Wigwam"),
    new SceneDesc('122', "Wumba's Wigwam"),
    new SceneDesc('114', "Train Station (Terrydactyland)"),
    "Hailfire Peaks",
    new SceneDesc('127', "Hailfire Peaks (Lava Side)"),
    new SceneDesc('128', "Hailfire Peaks (Icy Side)"),
    new SceneDesc('12B', "Lava Crater"),
    new SceneDesc('12C', "Ice Crater"),
    new SceneDesc('12D', "Colosseum Kickball Stadium (Lobby)"),
    new SceneDesc('12E', "Colosseum Kickball (Quarterfinal)"),
    // new SceneDesc('12F', "Colosseum Kickball (Semifinal)"),
    // new SceneDesc('130', "Colosseum Kickball (Final)"),
    // new SceneDesc('180', "Colosseum Kickball Challenge"),

    new SceneDesc('131', "Boggy's Igloo"),
    new SceneDesc('132', "Icicle Grotto"),
    new SceneDesc('133', "Inside the Volcano"),

    new SceneDesc('134', "Mumbo's Skull"),
    new SceneDesc('135', "Wumba's Wigwam"),
    new SceneDesc('129', "Lava Train Station (Hailfire Peaks)"),
    new SceneDesc('12A', "Ice Train Station (Hailfire Peaks)"),
    "Cloud Cuckoo Land",
    new SceneDesc('136', "Cloud Cuckooland"),
    new SceneDesc('137', "Inside the Trash Can"),
    // new SceneDesc('185', "Trash Can Challenge"),
    new SceneDesc('138', "Inside the Cheese Wedge"),
    new SceneDesc('139', "Zubbas' Nest"),
    new SceneDesc('13A', "Central Cavern"),
    new SceneDesc('13D', "Inside the Pot O' Gold"),

    new SceneDesc('13E', "Mumbo's Skull"),
    // new SceneDesc('13F', "Mumbo's Skull"),
    new SceneDesc('140', "Wumba's Wigwam"),

    "Cauldron Keep",
    new SceneDesc('15D', "Cauldron Keep"),
    new SceneDesc('15E', "The Gatehouse"),
    new SceneDesc('15F', "Tower Of Tragedy Quiz"),
    new SceneDesc('160', "Gun Chamber"),
    new SceneDesc('18A', "Inside the Digger"),

    // not sure where these go
    // new SceneDesc('171', "Mumbo's Skull"),
    // new SceneDesc('172', "Mumbo's Skull"),
    // new SceneDesc('176', "Mumbo's Skull"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
