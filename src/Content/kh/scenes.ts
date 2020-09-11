import * as BIN from './bin'
import * as Viewer from '../../viewer';

import { GfxDevice } from '../../gfx/platform/GfxPlatform';
import { FakeTextureHolder } from '../../TextureHolder';
import { KingdomHeartsRenderer, textureToCanvas } from './render';
import { SceneContext } from '../../SceneBase';

export class KingdomHeartsSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const pathBin = `kh/${this.id}.bin`;
        const pathImg = `kh/${this.id}.img`;
        return Promise.all([dataFetcher.fetchData(pathBin), dataFetcher.fetchData(pathImg)]).then(([binBuffer, imgBuffer]) => {
            const bin = BIN.parse(binBuffer, imgBuffer);

            const viewerTextures: Viewer.Texture[] = [];
            for (let i = 0; i < bin.mapTextureBlocks.length; i++) {
                for (let j = 0; j < bin.mapTextureBlocks[i].textures.length; j++) {
                    viewerTextures.push(textureToCanvas(bin.mapTextureBlocks[i].textures[j]));
                }
            }
            for (let i = 0; i < bin.sky0TextureBlocks.length; i++) {
                for (let j = 0; j < bin.sky0TextureBlocks[i].textures.length; j++) {
                    const texture = textureToCanvas(bin.sky0TextureBlocks[i].textures[j]);
                    texture.name = `sky_0_${i}`;
                    viewerTextures.push(texture);
                }
            }
            for (let i = 0; i < bin.sky1TextureBlocks.length; i++) {
                for (let j = 0; j < bin.sky1TextureBlocks[i].textures.length; j++) {
                    const texture = textureToCanvas(bin.sky1TextureBlocks[i].textures[j]);
                    texture.name = `sky_1_${i}`;
                    viewerTextures.push(texture);
                }
            }
            viewerTextures.sort(function(a, b) {
                return a.name < b.name ? -1 : 1;
            });
            const fakeTextureHolder = new FakeTextureHolder(viewerTextures);

            const renderer = new KingdomHeartsRenderer(device, fakeTextureHolder, bin);
            return renderer;
        });
    }
}

const id = "kh";
const name = "Kingdom Hearts";
const sceneDescs = [
    "100 Acre Wood",
    new KingdomHeartsSceneDesc("po00_01", "Pooh's House"),
    new KingdomHeartsSceneDesc("po00_02", "Rabbit's House"),
    new KingdomHeartsSceneDesc("po00_03", "Hunny Tree"),
    new KingdomHeartsSceneDesc("po00_04", "Wood: Hill"),
    new KingdomHeartsSceneDesc("po00_05", "Wood: Meadow"),
    new KingdomHeartsSceneDesc("po00_06", "Bouncing Spot"),
    new KingdomHeartsSceneDesc("po00_07", "Muddy Path"),
    new KingdomHeartsSceneDesc("po00_08", "Wood: Hill (Night)"),
    new KingdomHeartsSceneDesc("po00_09", "100 Acre Wood"),

    "Agrabah",
    new KingdomHeartsSceneDesc("al00_01", "Desert"),
    new KingdomHeartsSceneDesc("al00_02", "Agrabah"),
    new KingdomHeartsSceneDesc("al00_03", "Agrabah: Storage"),
    new KingdomHeartsSceneDesc("al00_04", "Cave: Hall"),
    new KingdomHeartsSceneDesc("al00_05", "Treasure Room"),
    new KingdomHeartsSceneDesc("al00_06", "Chambers"),
    new KingdomHeartsSceneDesc("al00_07", "Cave: Core"),
    new KingdomHeartsSceneDesc("al00_08", "Aladdin's House"),
    new KingdomHeartsSceneDesc("al00_09", "Cave (Escape)"),

    "Atlantica",
    new KingdomHeartsSceneDesc("lm00_01", "Undersea Valley"),
    new KingdomHeartsSceneDesc("lm00_02", "Undersea Gorge"),
    new KingdomHeartsSceneDesc("lm00_03", "Sunken Ship"),
    new KingdomHeartsSceneDesc("lm00_04", "Ursula's Lair"),
    new KingdomHeartsSceneDesc("lm00_05", "Ariel's Grotto"),
    new KingdomHeartsSceneDesc("lm00_06", "Triton's Palace"),
    new KingdomHeartsSceneDesc("lm00_07", "Triton's Throne"),
    new KingdomHeartsSceneDesc("lm00_08", "Ursula (Boss)"),
    new KingdomHeartsSceneDesc("lm00_09", "Undersea Valley (Beta)"),

    "Deep Jungle",
    new KingdomHeartsSceneDesc("tz00_01", "Tree House"),
    new KingdomHeartsSceneDesc("tz00_02", "Camp"),
    new KingdomHeartsSceneDesc("tz00_03", "Jungle: Vines"),
    new KingdomHeartsSceneDesc("tz00_04", "Hippo's Lagoon"),
    new KingdomHeartsSceneDesc("tz00_05", "Climbing Trees"),
    new KingdomHeartsSceneDesc("tz00_06", "Waterfall Cavern"),
    new KingdomHeartsSceneDesc("tz00_07", "Jungle: Cliff"),
    new KingdomHeartsSceneDesc("tz00_08", "Jungle Slider"),

    "Destiny Islands",
    new KingdomHeartsSceneDesc("di00_01", "Seashore"),
    new KingdomHeartsSceneDesc("di00_02", "Cove"),
    new KingdomHeartsSceneDesc("di00_03", "Seashore (Sunset)"),
    new KingdomHeartsSceneDesc("di00_04", "Seashore (Night)"),
    new KingdomHeartsSceneDesc("di00_05", "Secret Place (Night)"),
    new KingdomHeartsSceneDesc("di00_06", "Sora's Room"),
    new KingdomHeartsSceneDesc("di00_07", "Secret Place"),
    new KingdomHeartsSceneDesc("di00_08", "Secret Place (Past)"),

    "Dive to the Heart",
    new KingdomHeartsSceneDesc("dh00_01", "Awakening"),
    new KingdomHeartsSceneDesc("dh00_02", "Awakening (Boss)"),
    new KingdomHeartsSceneDesc("dh00_03", "Seashore"),

    "Disney Castle",
    new KingdomHeartsSceneDesc("dc00_01", "Audience Chamber"),
    new KingdomHeartsSceneDesc("dc00_02", "Courtyard"),
    new KingdomHeartsSceneDesc("dc00_03", "Gummi Hangar"),
    new KingdomHeartsSceneDesc("dc00_04", "Epilogue"),

    "End of the World",
    new KingdomHeartsSceneDesc("ew00_01", "Gate to the Dark"),
    new KingdomHeartsSceneDesc("ew00_02", "Giant Crevasse"),
    new KingdomHeartsSceneDesc("ew00_03", "World Terminus"),
    new KingdomHeartsSceneDesc("ew00_04", "Traverse Town (World Terminus)"),
    new KingdomHeartsSceneDesc("ew00_05", "Wonderland (World Terminus)"),
    new KingdomHeartsSceneDesc("ew00_06", "Olympus Coliseum (World Terminus)"),
    new KingdomHeartsSceneDesc("ew00_07", "Deep Jungle (World Terminus)"),
    new KingdomHeartsSceneDesc("ew00_08", "Agrabah (World Terminus)"),
    new KingdomHeartsSceneDesc("ew00_09", "Atlantica (World Terminus)"),
    new KingdomHeartsSceneDesc("ew00_10", "Halloween Town (World Terminus)"),
    new KingdomHeartsSceneDesc("ew00_11", "Neverland (World Terminus)"),
    new KingdomHeartsSceneDesc("ew00_12", "100 Acre Wood (World Terminus)"),
    new KingdomHeartsSceneDesc("ew00_13", "Laboratory (World Terminus)"),
    new KingdomHeartsSceneDesc("ew00_14", "Volcanic Crater"),
    new KingdomHeartsSceneDesc("ew00_15", "Homecoming (Boss)"),
    new KingdomHeartsSceneDesc("ew00_16", "Crumbling Island"),
    new KingdomHeartsSceneDesc("ew00_17", "Door to Darkness"),
    new KingdomHeartsSceneDesc("ew00_18", "The Void (Final Boss)"),
    new KingdomHeartsSceneDesc("ew00_19", "Homecoming"),

    "Halloween Town",
    new KingdomHeartsSceneDesc("nm00_01", "Guillotine Square"),
    new KingdomHeartsSceneDesc("nm00_02", "Moonlight Hill"),
    new KingdomHeartsSceneDesc("nm00_03", "Oogie's Manor"),
    new KingdomHeartsSceneDesc("nm00_04", "Torture Chamber"),
    new KingdomHeartsSceneDesc("nm00_05", "Manor Ruins"),
    new KingdomHeartsSceneDesc("nm00_06", "Evil Playroom"),
    new KingdomHeartsSceneDesc("nm00_07", "Research Lab"),

    "Hollow Bastion",
    new KingdomHeartsSceneDesc("pc00_01", "Rising Falls"),
    new KingdomHeartsSceneDesc("pc00_02", "Castle Gates"),
    new KingdomHeartsSceneDesc("pc00_03", "Great Crest"),
    new KingdomHeartsSceneDesc("pc00_04", "High Tower"),
    new KingdomHeartsSceneDesc("pc00_05", "Entrance Hall"),
    new KingdomHeartsSceneDesc("pc00_06", "Library"),
    new KingdomHeartsSceneDesc("pc00_07", "Lift Stop"),
    new KingdomHeartsSceneDesc("pc00_08", "Base Level"),
    new KingdomHeartsSceneDesc("pc00_09", "Waterway"),
    new KingdomHeartsSceneDesc("pc00_10", "Castle Chapel"),
    new KingdomHeartsSceneDesc("pc00_11", "Grand Hall"),
    new KingdomHeartsSceneDesc("pc00_12", "Castle Chapel (Cutscene)"),

    "Monstro",
    new KingdomHeartsSceneDesc("pi00_01", "Mouth"),
    new KingdomHeartsSceneDesc("pi00_02", "Mouth (Revisit)"),
    new KingdomHeartsSceneDesc("pi00_03", "Stomach/Throat/Bowels"),
    new KingdomHeartsSceneDesc("pi00_04", "Chambers"),

    "Neverland",
    new KingdomHeartsSceneDesc("pp00_01", "Ship: Hold"),
    new KingdomHeartsSceneDesc("pp00_02", "Pirate Ship"),
    new KingdomHeartsSceneDesc("pp00_03", "Clock Tower"),
    new KingdomHeartsSceneDesc("pp00_04", "Clock Tower (Beta)"),

    "Olympus Coliseum",
    new KingdomHeartsSceneDesc("he00_01", "Coliseum Gates"),
    new KingdomHeartsSceneDesc("he00_02", "Coliseum: Arena"),
    new KingdomHeartsSceneDesc("he00_03", "Coliseum Gates (Night)"),
    new KingdomHeartsSceneDesc("he00_04", "Coliseum: Arena (Night)"),
    new KingdomHeartsSceneDesc("he00_05", "Coliseum: Arena (Boss)"),

    "Traverse Town",
    new KingdomHeartsSceneDesc("tw00_01", "1st District"),
    new KingdomHeartsSceneDesc("tw00_02", "2nd District"),
    new KingdomHeartsSceneDesc("tw00_03", "3rd District"),
    new KingdomHeartsSceneDesc("tw00_04", "Hotel and Alleyway"),
    new KingdomHeartsSceneDesc("tw00_05", "Mystical House"),
    new KingdomHeartsSceneDesc("tw00_06", "Item Shop"),
    new KingdomHeartsSceneDesc("tw00_07", "Accessory Shop"),
    new KingdomHeartsSceneDesc("tw00_08", "Geppetto's House"),
    new KingdomHeartsSceneDesc("tw00_09", "Dalmatian's Den"),
    new KingdomHeartsSceneDesc("tw00_10", "Gizmo Shop"),
    new KingdomHeartsSceneDesc("tw00_11", "Magician's Study"),
    new KingdomHeartsSceneDesc("tw00_12", "Secret Waterway"),
    new KingdomHeartsSceneDesc("tw00_14", "3rd District (Small House)"),

    "Wonderland",
    new KingdomHeartsSceneDesc("aw00_01", "Rabbit Hole"),
    new KingdomHeartsSceneDesc("aw00_02", "Bizarre Room"),
    new KingdomHeartsSceneDesc("aw00_03", "Queen's Castle"),
    new KingdomHeartsSceneDesc("aw00_04", "Lotus Forest"),
    new KingdomHeartsSceneDesc("aw00_05", "Bizarre Room (Right Wall)"),
    new KingdomHeartsSceneDesc("aw00_06", "Bizarre Room (Left Wall)"),
    new KingdomHeartsSceneDesc("aw00_07", "Bizarre Room (Ceiling)"),
    new KingdomHeartsSceneDesc("aw00_08", "Tea Party Garden"),
]

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };