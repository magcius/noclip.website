import * as MAP from './map';
import * as Viewer from '../../viewer';

import { FakeTextureHolder } from '../../TextureHolder';
import { GfxDevice } from '../../gfx/platform/GfxPlatform';
import { SceneContext } from '../../SceneBase';
import { textureToCanvas, textureAnimationToCanvas, KingdomHeartsIIRenderer } from './render';

export class KingdomHeartsIISceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const mapData = await dataFetcher.fetchData(`kh2fm/${this.id}.map`);
        const map = MAP.parseMap(mapData);

        const viewerTextures: Viewer.Texture[] = [];
        for (const textureBlock of map.mapGroup.textureBlocks) {
            for (const texture of textureBlock.textures) {
                viewerTextures.push(textureToCanvas(texture, "map"));
                if (texture.textureAnim) {
                    viewerTextures.push(textureAnimationToCanvas(texture.textureAnim, texture, "map"));
                }
            }
        }
        for (const textureBlock of map.sky0Group.textureBlocks) {
            for (const texture of textureBlock.textures) {
                viewerTextures.push(textureToCanvas(texture, "sky0"));
                if (texture.textureAnim) {
                    viewerTextures.push(textureAnimationToCanvas(texture.textureAnim, texture, "sky0"));
                }
            }
        }
        for (const textureBlock of map.sky1Group.textureBlocks) {
            for (const texture of textureBlock.textures) {
                viewerTextures.push(textureToCanvas(texture, "sky1"));
                if (texture.textureAnim) {
                    viewerTextures.push(textureAnimationToCanvas(texture.textureAnim, texture, "sky1"));
                }
            }
        }
        viewerTextures.sort(function(a, b) {
            return a.name < b.name ? -1 : 1;
        });
        const fakeTextureHolder = new FakeTextureHolder(viewerTextures);

        const renderer = new KingdomHeartsIIRenderer(device, fakeTextureHolder, map);
        return renderer;
    }
}

const id = "kh2fm";
const name = "Kingdom Hearts II Final Mix";
const sceneDescs = [
    "100 Acre Wood",
    new KingdomHeartsIISceneDesc("po00", "The Hundred Acre Wood"),
    new KingdomHeartsIISceneDesc("po01", "Starry Hill"),
    new KingdomHeartsIISceneDesc("po02", "Pooh Bear's House"),
    new KingdomHeartsIISceneDesc("po03", "Rabbit's House"),
    new KingdomHeartsIISceneDesc("po04", "Piglet's House"),
    new KingdomHeartsIISceneDesc("po05", "Kanga's House"),
    new KingdomHeartsIISceneDesc("po06", "A Blustery Rescue"),
    new KingdomHeartsIISceneDesc("po07", "Hunny Slider"),
    new KingdomHeartsIISceneDesc("po08", "Balloon Bounce"),
    new KingdomHeartsIISceneDesc("po09", "The Spooky Cave"),

    "Agrabah",
    new KingdomHeartsIISceneDesc("al00", "Agrabah"),
    new KingdomHeartsIISceneDesc("al01", "Bazaar"),
    new KingdomHeartsIISceneDesc("al02", "The Peddler's Shop"),
    new KingdomHeartsIISceneDesc("al03", "Palace Gates"),
    new KingdomHeartsIISceneDesc("al04", "Palace Dungeon"),
    new KingdomHeartsIISceneDesc("al05", "Agrabah (Boss)"),
    new KingdomHeartsIISceneDesc("al06", "Palace Walls"),
    new KingdomHeartsIISceneDesc("al07", "The Cave of Wonders: Entrance"),
    new KingdomHeartsIISceneDesc("al09", "The Cave of Wonders: Stone Guardians"),
    new KingdomHeartsIISceneDesc("al10", "The Cave of Wonders: Treasure Room"),
    new KingdomHeartsIISceneDesc("al11", "Ruined Chamber"),
    new KingdomHeartsIISceneDesc("al12", "The Cave of Wonders: Valley of Stone"),
    new KingdomHeartsIISceneDesc("al13", "The Cave of Wonders: Chasm of Challenges"),
    new KingdomHeartsIISceneDesc("al14", "Sandswept Ruins"),
    new KingdomHeartsIISceneDesc("al15", "The Peddler's Shop (Gold)"),

    "Atlantica",
    new KingdomHeartsIISceneDesc("lm00", "Triton's Throne"),
    new KingdomHeartsIISceneDesc("lm01", "Ariel's Grotto"),
    new KingdomHeartsIISceneDesc("lm02", "Undersea Courtyard"),
    new KingdomHeartsIISceneDesc("lm03", "Undersea Courtyard (Night)"),
    new KingdomHeartsIISceneDesc("lm04", "The Palace: Performance Hall"),
    new KingdomHeartsIISceneDesc("lm05", "Sunken Ship"),
    new KingdomHeartsIISceneDesc("lm06", "The Shore"),
    new KingdomHeartsIISceneDesc("lm07", "The Shore (Night)"),
    new KingdomHeartsIISceneDesc("lm08", "The Shore (Sunset)"),
    new KingdomHeartsIISceneDesc("lm09", "Wrath of the Sea"),
    new KingdomHeartsIISceneDesc("lm10", "Wedding Ship"),

    "Beast's Castle",
    new KingdomHeartsIISceneDesc("bb00", "Entrance Hall"),
    new KingdomHeartsIISceneDesc("bb01", "Parlor"),
    new KingdomHeartsIISceneDesc("bb02", "Belle's Room"),
    new KingdomHeartsIISceneDesc("bb03", "The Beast's Room"),
    new KingdomHeartsIISceneDesc("bb04", "Ballroom"),
    new KingdomHeartsIISceneDesc("bb05", "Ballroom (Boss)"),
    new KingdomHeartsIISceneDesc("bb06", "Courtyard"),
    new KingdomHeartsIISceneDesc("bb07", "The East Wing"),
    new KingdomHeartsIISceneDesc("bb08", "The West Hall"),
    new KingdomHeartsIISceneDesc("bb09", "The West Wing"),
    new KingdomHeartsIISceneDesc("bb10", "Dungeon"),
    new KingdomHeartsIISceneDesc("bb11", "Undercroft"),
    new KingdomHeartsIISceneDesc("bb12", "Secret Passage"),
    new KingdomHeartsIISceneDesc("bb13", "Bridge"),
    new KingdomHeartsIISceneDesc("bb14", "Ballroom (Cutscene)"),
    new KingdomHeartsIISceneDesc("bb15", "Bridge (Boss)"),

    "Destiny Islands",
    new KingdomHeartsIISceneDesc("di00", "Secret Place"),
    new KingdomHeartsIISceneDesc("di01", "Main Island: Ocean's Road"),
    new KingdomHeartsIISceneDesc("di02", "Main Island: Shore"),

    "Disney Castle",
    new KingdomHeartsIISceneDesc("dc00", "Audience Chamber"),
    new KingdomHeartsIISceneDesc("dc01", "Library"),
    new KingdomHeartsIISceneDesc("dc02", "Colonnade"),
    new KingdomHeartsIISceneDesc("dc03", "Courtyard"),
    new KingdomHeartsIISceneDesc("dc04", "The Hall of the Cornerstone"),
    new KingdomHeartsIISceneDesc("dc05", "The Hall of the Cornerstone (Light)"),
    new KingdomHeartsIISceneDesc("dc06", "Gummi Hangar"),
    new KingdomHeartsIISceneDesc("dc07", "The Wilderness"),

    "Dive to the Heart",
    new KingdomHeartsIISceneDesc("tt32", "Station of Serenity"),
    new KingdomHeartsIISceneDesc("tt33", "Station of Calling"),
    new KingdomHeartsIISceneDesc("tt34", "Station of Awakening"),

    "End of Sea",
    new KingdomHeartsIISceneDesc("es00", "The Dark Margin"),
    new KingdomHeartsIISceneDesc("es01", "loop demo"),

    "Halloween Town",
    new KingdomHeartsIISceneDesc("nm00", "Halloween Town Square"),
    new KingdomHeartsIISceneDesc("nm01", "Dr. Finkelstein's Lab"),
    new KingdomHeartsIISceneDesc("nm02", "Graveyard"),
    new KingdomHeartsIISceneDesc("nm03", "Curly Hill"),
    new KingdomHeartsIISceneDesc("nm04", "Hinterlands"),
    new KingdomHeartsIISceneDesc("nm05", "Yuletide Hill"),
    new KingdomHeartsIISceneDesc("nm06", "Candy Cane Lane"),
    new KingdomHeartsIISceneDesc("nm07", "Christmas Tree Plaza"),
    new KingdomHeartsIISceneDesc("nm08", "Santa's House"),
    new KingdomHeartsIISceneDesc("nm09", "Toy Factory: Shipping and Receiving"),
    new KingdomHeartsIISceneDesc("nm10", "Toy Factory: The Wrapping Room"),

    "Hollow Bastion",
    new KingdomHeartsIISceneDesc("hb00", "Villain's Vale"),
    new KingdomHeartsIISceneDesc("hb01", "The Dark Depths"),
    new KingdomHeartsIISceneDesc("hb02", "The Great Maw"),
    new KingdomHeartsIISceneDesc("hb03", "Crystal Fissure"),
    new KingdomHeartsIISceneDesc("hb04", "Castle Gate"),
    new KingdomHeartsIISceneDesc("hb05", "Ansem's Study"),
    new KingdomHeartsIISceneDesc("hb06", "Postern"),
    new KingdomHeartsIISceneDesc("hb07", "Restoration Site"),
    new KingdomHeartsIISceneDesc("hb08", "Bailey"),
    new KingdomHeartsIISceneDesc("hb09", "Borough"),
    new KingdomHeartsIISceneDesc("hb10", "Marketplace"),
    new KingdomHeartsIISceneDesc("hb11", "Corridors"),
    new KingdomHeartsIISceneDesc("hb12", "Hearless Manufactory"),
    new KingdomHeartsIISceneDesc("hb13", "Merlin's House"),
    new KingdomHeartsIISceneDesc("hb14", "Castle Oblivion"),
    new KingdomHeartsIISceneDesc("hb15", "Ansem's Study (Past)"),
    new KingdomHeartsIISceneDesc("hb16", "Ravine Trail"),
    new KingdomHeartsIISceneDesc("hb17", "The Great Maw"),
    new KingdomHeartsIISceneDesc("hb18", "Restoration Site"),
    new KingdomHeartsIISceneDesc("hb19", "Bailey (Damaged)"),
    new KingdomHeartsIISceneDesc("hb20", "Corridors (Cutscene)"),
    new KingdomHeartsIISceneDesc("hb21", "Cavern of Remembrance: Depths"),
    new KingdomHeartsIISceneDesc("hb22", "Cavern of Remembrance: Mining Area"),
    new KingdomHeartsIISceneDesc("hb23", "Cavern of Remembrance: Engine Chamber"),
    new KingdomHeartsIISceneDesc("hb24", "Cavern of Remembrance: Mineshaft"),
    new KingdomHeartsIISceneDesc("hb25", "Transport to Remembrance"),
    new KingdomHeartsIISceneDesc("hb26", "Garden of Assemblage"),
    new KingdomHeartsIISceneDesc("hb27", "Underground Facility"),
    new KingdomHeartsIISceneDesc("hb32", "The Old Mansion"),
    new KingdomHeartsIISceneDesc("hb33", "Station of Remembrance"),
    new KingdomHeartsIISceneDesc("hb34", "Destiny Island"),
    new KingdomHeartsIISceneDesc("hb38", "Station of Oblivion"),

    "The Land of Dragons",
    new KingdomHeartsIISceneDesc("mu00", "Bamboo Grove"),
    new KingdomHeartsIISceneDesc("mu01", "Encampment"),
    new KingdomHeartsIISceneDesc("mu02", "Checkpoint"),
    new KingdomHeartsIISceneDesc("mu03", "Mountain Trail"),
    new KingdomHeartsIISceneDesc("mu04", "Village"),
    new KingdomHeartsIISceneDesc("mu05", "Village Cave"),
    new KingdomHeartsIISceneDesc("mu06", "Ridge"),
    new KingdomHeartsIISceneDesc("mu07", "Summit"),
    new KingdomHeartsIISceneDesc("mu08", "Imperial Square"),
    new KingdomHeartsIISceneDesc("mu09", "Palace Gate"),
    new KingdomHeartsIISceneDesc("mu10", "Antechamber"),
    new KingdomHeartsIISceneDesc("mu11", "Throne Room"),
    new KingdomHeartsIISceneDesc("mu12", "Village (Burned)"),

    "Mysterious Tower",
    new KingdomHeartsIISceneDesc("tt25", "The Tower"),
    new KingdomHeartsIISceneDesc("tt26", "Tower: Entryway"),
    new KingdomHeartsIISceneDesc("tt27", "Tower: Sorcerer's Loft"),
    new KingdomHeartsIISceneDesc("tt28", "Tower: Wardrobe"),
    new KingdomHeartsIISceneDesc("tt29", "Tower: Star Chamber"),
    new KingdomHeartsIISceneDesc("tt30", "Tower: Moon Chamber"),
    new KingdomHeartsIISceneDesc("tt31", "Tower: Wayward Stairs"),
    new KingdomHeartsIISceneDesc("tt38", "Tower: Wayward Stairs"),
    new KingdomHeartsIISceneDesc("tt39", "Tower: Wayward Stairs"),

    "Olympus Coliseum",
    new KingdomHeartsIISceneDesc("he00", "The Coliseum"),
    new KingdomHeartsIISceneDesc("he01", "Coliseum Gates"),
    new KingdomHeartsIISceneDesc("he02", "Coliseum Gates (Ruins)"),
    new KingdomHeartsIISceneDesc("he03", "Underworld Entrance"),
    new KingdomHeartsIISceneDesc("he04", "Coliseum Foyer"),
    new KingdomHeartsIISceneDesc("he05", "Valley of the Dead"),
    new KingdomHeartsIISceneDesc("he06", "Hades' Chamber"),
    new KingdomHeartsIISceneDesc("he07", "Cave of the Dead: Entrance"),
    new KingdomHeartsIISceneDesc("he08", "Well of Captivity"),
    new KingdomHeartsIISceneDesc("he09", "The Underdrome"),
    new KingdomHeartsIISceneDesc("he10", "Cave of the Dead: Inner Chamber"),
    new KingdomHeartsIISceneDesc("he11", "Underworld Caverns: Entrance"),
    new KingdomHeartsIISceneDesc("he12", "The Lock"),
    new KingdomHeartsIISceneDesc("he13", "The Underdrome"),
    new KingdomHeartsIISceneDesc("he14", "Coliseum Gates (Ruins, Night)"),
    new KingdomHeartsIISceneDesc("he15", "Cave of the Dead: Passage"),
    new KingdomHeartsIISceneDesc("he16", "Underworld Caverns: The Lost Road"),
    new KingdomHeartsIISceneDesc("he17", "Underworld Caverns: Atrium"),
    new KingdomHeartsIISceneDesc("he18", "Coliseum Gates (Ruins)"),
    new KingdomHeartsIISceneDesc("he19", "The Underdrome"),

    "Port Royal",
    new KingdomHeartsIISceneDesc("ca00", "Rampart"),
    new KingdomHeartsIISceneDesc("ca01", "Harbor"),
    new KingdomHeartsIISceneDesc("ca02", "Town"),
    new KingdomHeartsIISceneDesc("ca03", "The Interceptor"),
    new KingdomHeartsIISceneDesc("ca04", "The Interceptor: Ship's Hold"),
    new KingdomHeartsIISceneDesc("ca05", "The Black Pearl"),
    new KingdomHeartsIISceneDesc("ca06", "The Black Pearl: Captain's Stateroom"),
    new KingdomHeartsIISceneDesc("ca07", "The Interceptor"),
    new KingdomHeartsIISceneDesc("ca08", "Isla de Muerta: Rock Face"),
    new KingdomHeartsIISceneDesc("ca09", "Isla de Muerta: Cave Mouth"),
    new KingdomHeartsIISceneDesc("ca10", "Isla de Muerta: Treasure Heap"),
    new KingdomHeartsIISceneDesc("ca11", "Ship Graveyard: The Interceptor's Hold"),
    new KingdomHeartsIISceneDesc("ca12", "Isla de Muerta: Powder Store"),
    new KingdomHeartsIISceneDesc("ca13", "Isla de Muerta: Moonlight Nook"),
    new KingdomHeartsIISceneDesc("ca14", "Ship Graveyard: Seadrift Keep"),
    new KingdomHeartsIISceneDesc("ca15", "Ship Graveyard: Seadrift Row"),
    new KingdomHeartsIISceneDesc("ca16", "Isla de Muerta: Rock Face"),
    new KingdomHeartsIISceneDesc("ca17", "Isla de Muerta: Treasure Heap (Cutscene)"),
    new KingdomHeartsIISceneDesc("ca18", "The Black Pearl"),
    new KingdomHeartsIISceneDesc("ca19", "The Black Pearl"),
    new KingdomHeartsIISceneDesc("ca20", "The Black Pearl"),
    new KingdomHeartsIISceneDesc("ca21", "The Interceptor"),
    new KingdomHeartsIISceneDesc("ca22", "The Interceptor"),
    new KingdomHeartsIISceneDesc("ca23", "The Black Pearl: Captain's Stateroom (Cutscene)"),
    new KingdomHeartsIISceneDesc("ca24", "Harbor"),
    new KingdomHeartsIISceneDesc("ca25", "Isla de Muerta: Rock Face"),

    "Pride Lands",
    new KingdomHeartsIISceneDesc("lk00", "Pride Rock"),
    new KingdomHeartsIISceneDesc("lk01", "Stone Hollow"),
    new KingdomHeartsIISceneDesc("lk02", "The King's Den"),
    new KingdomHeartsIISceneDesc("lk03", "Wildebeest Valley"),
    new KingdomHeartsIISceneDesc("lk04", "The Savannah"),
    new KingdomHeartsIISceneDesc("lk05", "Elephant Graveyard"),
    new KingdomHeartsIISceneDesc("lk06", "Gorge"),
    new KingdomHeartsIISceneDesc("lk07", "Wastelands"),
    new KingdomHeartsIISceneDesc("lk08", "Jungle"),
    new KingdomHeartsIISceneDesc("lk09", "Oasis"),
    new KingdomHeartsIISceneDesc("lk10", "Pride Rock (Ending)"),
    new KingdomHeartsIISceneDesc("lk11", "Oasis (Night)"),
    new KingdomHeartsIISceneDesc("lk12", "Overlook"),
    new KingdomHeartsIISceneDesc("lk13", "Peak"),
    new KingdomHeartsIISceneDesc("lk14", "Scar's Darkness"),
    new KingdomHeartsIISceneDesc("lk15", "The Savannah (Boss)"),
    new KingdomHeartsIISceneDesc("lk16", "Wildebeest Valley (Past)"),

    "Space Paranoids",
    new KingdomHeartsIISceneDesc("tr00", "Pit Cell"),
    new KingdomHeartsIISceneDesc("tr01", "Canyon"),
    new KingdomHeartsIISceneDesc("tr02", "Game Grid"),
    new KingdomHeartsIISceneDesc("tr03", "Dataspace"),
    new KingdomHeartsIISceneDesc("tr04", "I/O Tower: Hallway"),
    new KingdomHeartsIISceneDesc("tr05", "I/O Tower: Communications Room"),
    new KingdomHeartsIISceneDesc("tr06", "Simulation Hangar"),
    new KingdomHeartsIISceneDesc("tr07", "Solar Sailer Simulation"),
    new KingdomHeartsIISceneDesc("tr08", "Central Computer Mesa"),
    new KingdomHeartsIISceneDesc("tr09", "Central Computer Core"),
    new KingdomHeartsIISceneDesc("tr10", "Simulation Hangar"),
    new KingdomHeartsIISceneDesc("tr11", "Central Computer Mesa"),

    "Timeless River",
    new KingdomHeartsIISceneDesc("wi00", "Cornerstone Hill"),
    new KingdomHeartsIISceneDesc("wi01", "Pier"),
    new KingdomHeartsIISceneDesc("wi02", "Waterway"),
    new KingdomHeartsIISceneDesc("wi03", "Wharf"),
    new KingdomHeartsIISceneDesc("wi04", "Lilliput"),
    new KingdomHeartsIISceneDesc("wi05", "Building Site"),
    new KingdomHeartsIISceneDesc("wi06", "Scene of the Fire"),
    new KingdomHeartsIISceneDesc("wi07", "Mickey's House"),
    new KingdomHeartsIISceneDesc("wi08", "Villain's Vale"),

    "Twilight Town",
    new KingdomHeartsIISceneDesc("tt00", "The Empty Realm"),
    new KingdomHeartsIISceneDesc("tt01", "Roxas' Room"),
    new KingdomHeartsIISceneDesc("tt02", "The Usual Spot"),
    new KingdomHeartsIISceneDesc("tt03", "Back Alley"),
    new KingdomHeartsIISceneDesc("tt04", "Sandlot"),
    new KingdomHeartsIISceneDesc("tt05", "Sandlot (Struggle)"),
    new KingdomHeartsIISceneDesc("tt06", "Market Street: Station Heights"),
    new KingdomHeartsIISceneDesc("tt07", "Market Street: Tram Common"),
    new KingdomHeartsIISceneDesc("tt08", "Station Plaza"),
    new KingdomHeartsIISceneDesc("tt09", "Central Station"),
    new KingdomHeartsIISceneDesc("tt10", "Sunset Terrace"),
    new KingdomHeartsIISceneDesc("tt11", "Sunset Station"),
    new KingdomHeartsIISceneDesc("tt12", "Sunset Hill"),
    new KingdomHeartsIISceneDesc("tt13", "The Woods"),
    new KingdomHeartsIISceneDesc("tt14", "The Old Mansion"),
    new KingdomHeartsIISceneDesc("tt15", "Mansion: Foyer"),
    new KingdomHeartsIISceneDesc("tt16", "Mansion: Dining Room"),
    new KingdomHeartsIISceneDesc("tt17", "Mansion: Library"),
    new KingdomHeartsIISceneDesc("tt18", "Mansion: The White Room"),
    new KingdomHeartsIISceneDesc("tt19", "Mansion: Basement Hall"),
    new KingdomHeartsIISceneDesc("tt20", "Mansion: Basement Hall"),
    new KingdomHeartsIISceneDesc("tt21", "Mansion: Computer Room"),
    new KingdomHeartsIISceneDesc("tt22", "Mansion: Basement Corridor"),
    new KingdomHeartsIISceneDesc("tt23", "Mansion: Pod Room"),
    new KingdomHeartsIISceneDesc("tt24", "Train (Twilight Town)"),
    new KingdomHeartsIISceneDesc("tt35", "Train (Space)"),
    new KingdomHeartsIISceneDesc("tt36", "Tunnelway"),
    new KingdomHeartsIISceneDesc("tt37", "Underground Concourse"),
    new KingdomHeartsIISceneDesc("tt40", "Betwixt and Between"),
    new KingdomHeartsIISceneDesc("tt41", "The Old Mansion"),

    "The World That Never Was",
    new KingdomHeartsIISceneDesc("eh00", "Where Nothing Gathers"),
    new KingdomHeartsIISceneDesc("eh01", "Alley to Between"),
    new KingdomHeartsIISceneDesc("eh02", "Fragment Crossing"),
    new KingdomHeartsIISceneDesc("eh03", "Memory's Skyscraper"),
    new KingdomHeartsIISceneDesc("eh04", "The Brink of Despair"),
    new KingdomHeartsIISceneDesc("eh05", "Soundless Prison"),
    new KingdomHeartsIISceneDesc("eh06", "Nothing's Call"),
    new KingdomHeartsIISceneDesc("eh07", "Crooked Ascension"),
    new KingdomHeartsIISceneDesc("eh08", "Crooked Ascension"),
    new KingdomHeartsIISceneDesc("eh09", "Twilight's View"),
    new KingdomHeartsIISceneDesc("eh10", "Hall of Empty Melodies"),
    new KingdomHeartsIISceneDesc("eh11", "Hall of Empty Melodies"),
    new KingdomHeartsIISceneDesc("eh12", "Naught's Skyway"),
    new KingdomHeartsIISceneDesc("eh13", "Proof of Existence"),
    new KingdomHeartsIISceneDesc("eh14", "Havoc's Divide"),
    new KingdomHeartsIISceneDesc("eh15", "Addled Impasse"),
    new KingdomHeartsIISceneDesc("eh16", "Naught's Approach"),
    new KingdomHeartsIISceneDesc("eh17", "Ruin and Creation's Passage"),
    new KingdomHeartsIISceneDesc("eh18", "The Altar of Naught"),
    new KingdomHeartsIISceneDesc("eh19", "Memory's Contortion"),
    new KingdomHeartsIISceneDesc("eh20", "The World of Nothing (Final Boss)"),
    new KingdomHeartsIISceneDesc("eh21", "Station of Awakening"),
    new KingdomHeartsIISceneDesc("eh22", "The World of Nothing (Dragon)"),
    new KingdomHeartsIISceneDesc("eh23", "The World of Nothing (Armor II)"),
    new KingdomHeartsIISceneDesc("eh24", "The World of Nothing (Armor)"),
    new KingdomHeartsIISceneDesc("eh25", "The World of Nothing (Energy Core)"),
    new KingdomHeartsIISceneDesc("eh26", "The World of Nothing (Cannons)"),
    new KingdomHeartsIISceneDesc("eh27", "The World of Nothing (City)"),
    new KingdomHeartsIISceneDesc("eh28", "The World of Nothing (City II)"),
    new KingdomHeartsIISceneDesc("eh29", "The Altar of Naught (Pre-Boss)"),

    "Gummi Missions",
    new KingdomHeartsIISceneDesc("gm00", "Asteroid Sweep"),
    new KingdomHeartsIISceneDesc("gm01", "Stardust Sweep"),
    new KingdomHeartsIISceneDesc("gm02", "Broken Highway"),
    new KingdomHeartsIISceneDesc("gm03", "Ancient Highway"),
    new KingdomHeartsIISceneDesc("gm04", "Phantom Storm"),
    new KingdomHeartsIISceneDesc("gm05", "Sunlight Storm"),
    new KingdomHeartsIISceneDesc("gm06", "Splash Island"),
    new KingdomHeartsIISceneDesc("gm07", "Floating Island"),
    new KingdomHeartsIISceneDesc("gm08", "Assault of the Dreadnought"),

    "World Map",
    new KingdomHeartsIISceneDesc("wm00", "World Map"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
