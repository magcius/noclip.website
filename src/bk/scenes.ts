
import * as Viewer from '../viewer';
import { GfxDevice, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import Progressable from '../Progressable';
import { fetchData } from '../fetch';
import * as Geo from './geo';
import * as BYML from '../byml';
import { FakeTextureHolder, TextureHolder } from '../TextureHolder';
import { textureToCanvas, N64Renderer, N64Data } from './render';
import { BasicRendererHelper } from '../oot3d/render';

const pathBase = `bk`;

class BKRenderer extends BasicRendererHelper implements Viewer.SceneGfx {
    private sceneRenderers: N64Renderer[] = [];
    public n64Datas: N64Data[] = [];

    constructor(public textureHolder: TextureHolder<any>) {
        super();
    }

    public addSceneRenderer(device: GfxDevice, sceneRenderer: N64Renderer): void {
        this.sceneRenderers.push(sceneRenderer);
        sceneRenderer.addToViewRenderer(device, this.viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.sceneRenderers.length; i++)
            this.sceneRenderers[i].prepareToRender(hostAccessPass, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        for (let i = 0; i < this.sceneRenderers.length; i++)
            this.sceneRenderers[i].destroy(device);
        for (let i = 0; i < this.n64Datas.length; i++)
            this.n64Datas[i].destroy(device);
        this.textureHolder.destroy(device);
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        return fetchData(`${pathBase}/${this.id}_arc.crg1`, abortSignal).then((data) => {
            const obj: any = BYML.parse(data, BYML.FileType.CRG1);

            const viewerTextures: Viewer.Texture[] = [];
            const fakeTextureHolder = new FakeTextureHolder(viewerTextures);
            const sceneRenderer = new BKRenderer(fakeTextureHolder);

            if (obj.GeoOpaque !== null) {
                const opaGeo = Geo.parse(obj.GeoOpaque, true);
                for (let i = 0; i < opaGeo.rspOutput.textures.length; i++)
                    viewerTextures.push(textureToCanvas(opaGeo.rspOutput.textures[i]));

                const opaData = new N64Data(device, opaGeo.rspOutput);
                sceneRenderer.n64Datas.push(opaData);
                sceneRenderer.addSceneRenderer(device, new N64Renderer(device, opaData));
            }

            if (obj.GeoAlpha !== null) {
                const xluGeo = Geo.parse(obj.GeoAlpha, false);
                for (let i = 0; i < xluGeo.rspOutput.textures.length; i++)
                    viewerTextures.push(textureToCanvas(xluGeo.rspOutput.textures[i]));

                const xluData = new N64Data(device, xluGeo.rspOutput);
                sceneRenderer.n64Datas.push(xluData);
                sceneRenderer.addSceneRenderer(device, new N64Renderer(device, xluData));
            }

            return sceneRenderer;
        });
    }
}

// Names taken from Banjo's Backpack.
const id = `bk`;
const name = "Banjo-Kazooie";
const sceneDescs = [
    "Spiral Mountain",
    new SceneDesc(`01`, "Spiral Mountain"),
    new SceneDesc(`8C`, "Banjo's House"),

    "Grunty's Lair",
    new SceneDesc(`69`, "Floor 1 / Entrance to Mumbo's Mountain"),
    new SceneDesc(`6A`, "Floor 2"),
    new SceneDesc(`6C`, "Dingpot Teleport Room"),
    new SceneDesc(`6B`, "Floor 3"),
    new SceneDesc(`6D`, "Entrance to Treasure Trove Cove"),
    new SceneDesc(`70`, "Entrance to Clanker's Cavern"),
    new SceneDesc(`71`, "Floor 4"),
    new SceneDesc(`72`, "Entrance to Bubblegloomp Swamp"),
    new SceneDesc(`6E`, "Floor 5 / Entrance to Gobi's Valley"),
    new SceneDesc(`6F`, "Floor 6 / Entrance to Freezeezy Peak"),
    new SceneDesc(`75`, "Entrance to Mad Monster Mansion"),
    new SceneDesc(`74`, "Gobi's Valley Puzzle Room"),
    new SceneDesc(`79`, "Floor 7 / Entrance to Click Clock Wood"),
    new SceneDesc(`76`, "Water Switch Area"),
    new SceneDesc(`78`, "Mad Monster Mansion & Rusty Bucket Bay Puzzle Room"),
    new SceneDesc(`77`, "Entrance to Rusty Bucket Bay"),
    new SceneDesc(`93`, "Floor 8"),
    new SceneDesc(`7A`, "Coffin Room"),
    new SceneDesc(`80`, "Entrance to Grunty's Furnace Fun"),
    new SceneDesc(`8E`, "Grunty's Furnace Fun"),
    new SceneDesc(`90`, "Boss"),

    "Mumbo's Mountain",
    new SceneDesc(`02`, "Mumbo's Mountain"),
    new SceneDesc(`0C`, "Ticker's Tower"),
    new SceneDesc(`0E`, "Mumbo's Skull"),

    "Treasure Trove Cove",
    new SceneDesc(`07`, "Treasure Trove Cove"),
    new SceneDesc(`05`, "Blubber's Ship"),
    new SceneDesc(`06`, "Nipper's Shell"),
    new SceneDesc(`0A`, "Sandcastle"),
    new SceneDesc(`8F`, "Sharkfood Island"),

    "Clanker's Cavern",
    new SceneDesc(`0B`, "Clanker's Cavern"),
    new SceneDesc(`22`, "Inside Clanker"),
    new SceneDesc(`21`, "Inside Clanker - Witch Switch"),
    new SceneDesc(`23`, "Inside Clanker - Gold Feathers"),

    "Bubblegloop Swamp",
    new SceneDesc(`0D`, "Bubblegloop Swamp"),
    new SceneDesc(`10`, "Mr. Vile"),
    new SceneDesc(`11`, "TipTup Chior"),
    new SceneDesc(`47`, "Mumbo's Skull"),

    "Freezeezy Peak",
    new SceneDesc(`27`, "Freezeezy Peak"),
    new SceneDesc(`41`, "Boggy's Igloo"),
    new SceneDesc(`48`, "Mumbo's Skull"),
    new SceneDesc(`53`, "Christmas Tree"),
    new SceneDesc(`7F`, "Wozza's Cave"),

    "Gobi's Valley",
    new SceneDesc(`12`, "Gobi's Valley"),
    new SceneDesc(`13`, "Puzzle Room"),
    new SceneDesc(`14`, "King Sandybutt's Tomb"),
    new SceneDesc(`15`, "Water Room"),
    new SceneDesc(`16`, "Rupee"),
    new SceneDesc(`1A`, "Jinxy"),
    new SceneDesc(`92`, "Secret Blue Egg"),

    "Mad Monster Mansion",
    new SceneDesc(`1B`, "Mad Monster Mansion"),
    new SceneDesc(`8D`, "Septic Tank"),
    new SceneDesc(`1C`, "Church"),
    new SceneDesc(`1D`, "Cellar"),
    new SceneDesc(`24`, "Tumblar's Shed"),
    new SceneDesc(`25`, "Well"),
    new SceneDesc(`26`, "Dining Room"),
    new SceneDesc(`28`, "Egg Room"),
    new SceneDesc(`29`, "Note Room"),
    new SceneDesc(`2A`, "Feather Room"),
    new SceneDesc(`2B`, "Secret Church Room"),
    new SceneDesc(`2C`, "Bathroom"),
    new SceneDesc(`2D`, "Bedroom"),
    new SceneDesc(`2E`, "Gold Feather Room"),
    new SceneDesc(`2F`, "Drainpipe"),
    new SceneDesc(`30`, "Mumbo's Hut"),

    "Rusty Bucket Bay",
    new SceneDesc(`31`, "Rusty Bucket Bay"),
    new SceneDesc(`8B`, "Anchor Room"),
    new SceneDesc(`34`, "Machine Room"),
    new SceneDesc(`35`, "Big Fish Warehouse"),
    new SceneDesc(`36`, "Boat Room"),
    new SceneDesc(`37`, "First Blue Container"),
    new SceneDesc(`38`, "Third Blue Container"),
    new SceneDesc(`39`, "Sea-Grublin's Cabin"),
    new SceneDesc(`3A`, "Kaboom's Room"),
    new SceneDesc(`3B`, "Mini Kaboom's Room"),
    new SceneDesc(`3C`, "Kitchen"),
    new SceneDesc(`3D`, "Navigation Room"),
    new SceneDesc(`3E`, "Second Blue Container"),
    new SceneDesc(`3F`, "Captain's Room"),

    "Click Clock Wood",
    new SceneDesc(`40`, "Click Clock Wood"),
    new SceneDesc(`43`, "Spring"),
    new SceneDesc(`44`, "Summer"),
    new SceneDesc(`45`, "Fall"),
    new SceneDesc(`46`, "Winter"),
    new SceneDesc(`4A`, "Mumbo - Spring"),
    new SceneDesc(`4B`, "Mumbo - Summer"),
    new SceneDesc(`4C`, "Mumbo - Fall"),
    new SceneDesc(`4D`, "Mumbo - Winter"),
    new SceneDesc(`5A`, "Beehive - Summer"),
    new SceneDesc(`5B`, "Beehive - Spring"),
    new SceneDesc(`5C`, "Beehive - Fall"),
    new SceneDesc(`5E`, "Nabnuts House - Spring"),
    new SceneDesc(`5F`, "Nabnuts House - Summer"),
    new SceneDesc(`60`, "Nabnuts House - Fall"),
    new SceneDesc(`61`, "Nabnuts House - Winter"),
    new SceneDesc(`62`, "Nabnut's Attic - Winter"),
    new SceneDesc(`63`, "Nabnut's Attic - Fall"),
    new SceneDesc(`64`, "Nabnut's Attic 2 - Winter"),
    new SceneDesc(`65`, "Whipcrack Room - Spring"),
    new SceneDesc(`66`, "Whipcrack Room - Summer"),
    new SceneDesc(`67`, "Whipcrack Room - Fall"),
    new SceneDesc(`68`, "Whipcrack Room - Winter"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
