
import * as Viewer from '../viewer';
import { DataFetcher, getDataURLForPath } from '../DataFetcher';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { getTextDecoder } from '../util';
import { FezRenderer } from './render';
import { ArtObjectData } from './artobject';
import { TrilesetData } from './trile';

const pathBase = 'Fez';

async function fetchXML(dataFetcher: DataFetcher, path: string): Promise<Document> {
    const buffer = await dataFetcher.fetchData(`${path}`);
    const fileContents = getTextDecoder('utf8')!.decode(buffer.arrayBuffer);
    const parser = new DOMParser();
    return parser.parseFromString(fileContents, `application/xml`);
}

function fetchPNG(path: string): Promise<ImageData> {
    path = getDataURLForPath(path);
    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';
    img.src = path;
    const p = new Promise<ImageData>((resolve) => {
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0);
            resolve(ctx.getImageData(0, 0, img.width, img.height));
        };
    });
    return p;
}

class ModelCache {
    public trilesetPromiseCache = new Map<string, Promise<TrilesetData>>();
    public artObjectPromiseCache = new Map<string, Promise<ArtObjectData>>();

    constructor(private dataFetcher: DataFetcher) {
    }

    private async fetchTrilesetInternal(device: GfxDevice, path: string): Promise<TrilesetData> {
        const [xml, png] = await Promise.all([
            fetchXML(this.dataFetcher, `${pathBase}/trile sets/${path}.xml`),
            fetchPNG(`${pathBase}/trile sets/${path}.png`),
        ]);
        return new TrilesetData(device, xml, png);
    }

    private async fetchArtObjectInternal(device: GfxDevice, path: string): Promise<ArtObjectData> {
        const [xml, png] = await Promise.all([
            fetchXML(this.dataFetcher, `${pathBase}/art objects/${path}.xml`),
            fetchPNG(`${pathBase}/art objects/${path}.png`),
        ]);
        return new ArtObjectData(device, path, xml, png);
    }

    public fetchTrileset(device: GfxDevice, path: string): Promise<TrilesetData> {
        if (!this.trilesetPromiseCache.has(path))
            this.trilesetPromiseCache.set(path, this.fetchTrilesetInternal(device, path));
        return this.trilesetPromiseCache.get(path)!;
    }

    public fetchArtObject(device: GfxDevice, path: string): Promise<ArtObjectData> {
        if (!this.artObjectPromiseCache.has(path))
            this.artObjectPromiseCache.set(path, this.fetchArtObjectInternal(device, path));
        return this.artObjectPromiseCache.get(path)!;
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const cache = new ModelCache(context.dataFetcher);
        const levelDocument = await fetchXML(context.dataFetcher, `${pathBase}/levels/${this.id}.xml`);

        const trilesetID = levelDocument.querySelector('Level')!.getAttribute('trileSetName')!.toLowerCase();
        const trilesetPromise = cache.fetchTrileset(device, trilesetID);

        const artObjectsXml = levelDocument.querySelectorAll('ArtObjects Entry ArtObjectInstance')!;
        const artObjectPromises: Promise<ArtObjectData>[] = [];
        for (let i = 0; i < artObjectsXml.length; i++) {
            const artObjectName = artObjectsXml[i].attributes.getNamedItem('name')!.textContent!.toLowerCase();
            artObjectPromises.push(cache.fetchArtObject(device, artObjectName));
        }

        const [trilesetData, artObjectDatas] = await Promise.all([trilesetPromise, Promise.all(artObjectPromises)]);
        return new FezRenderer(device, levelDocument, trilesetData, artObjectDatas);
    }
}

const id = 'fez';
const name = 'Fez';
const sceneDescs = [
    "test",
    new SceneDesc('abandoned_a', 'abandoned_a'),
    new SceneDesc('abandoned_b', 'abandoned_b'),
    new SceneDesc('abandoned_c', 'abandoned_c'),
    new SceneDesc('ancient_walls', 'ancient_walls'),
    new SceneDesc('arch', 'arch'),
    new SceneDesc('bell_tower', 'bell_tower'),
    new SceneDesc('big_owl', 'big_owl'),
    new SceneDesc('big_tower', 'big_tower'),
    new SceneDesc('boileroom', 'boileroom'),
    new SceneDesc('cabin_interior_a', 'cabin_interior_a'),
    new SceneDesc('cabin_interior_b', 'cabin_interior_b'),
    new SceneDesc('clock', 'clock'),
    new SceneDesc('cmy', 'cmy'),
    new SceneDesc('cmy_b', 'cmy_b'),
    new SceneDesc('cmy_fork', 'cmy_fork'),
    new SceneDesc('code_machine', 'code_machine'),
    new SceneDesc('crypt', 'crypt'),
    new SceneDesc('drum', 'drum'),
    new SceneDesc('elders', 'elders'),
    new SceneDesc('extractor_a', 'extractor_a'),
    new SceneDesc('five_towers', 'five_towers'),
    new SceneDesc('five_towers_cave', 'five_towers_cave'),
    new SceneDesc('fox', 'fox'),
    new SceneDesc('fractal', 'fractal'),
    new SceneDesc('geezer_house', 'geezer_house'),
    new SceneDesc('geezer_house_2d', 'geezer_house_2d'),
    new SceneDesc('globe', 'globe'),
    new SceneDesc('globe_int', 'globe_int'),
    new SceneDesc('gomez_house', 'gomez_house'),
    new SceneDesc('gomez_house_2d', 'gomez_house_2d'),
    new SceneDesc('gomez_house_end_32', 'gomez_house_end_32'),
    new SceneDesc('gomez_house_end_64', 'gomez_house_end_64'),
    new SceneDesc('grave_cabin', 'grave_cabin'),
    new SceneDesc('grave_ghost', 'grave_ghost'),
    new SceneDesc('grave_lesser_gate', 'grave_lesser_gate'),
    new SceneDesc('grave_treasure_a', 'grave_treasure_a'),
    new SceneDesc('graveyard_a', 'graveyard_a'),
    new SceneDesc('graveyard_gate', 'graveyard_gate'),
    new SceneDesc('hex_rebuild', 'hex_rebuild'),
    new SceneDesc('indust_abandoned_a', 'indust_abandoned_a'),
    new SceneDesc('industrial_city', 'industrial_city'),
    new SceneDesc('industrial_hub', 'industrial_hub'),
    new SceneDesc('industrial_superspin', 'industrial_superspin'),
    new SceneDesc('kitchen', 'kitchen'),
    new SceneDesc('kitchen_2d', 'kitchen_2d'),
    new SceneDesc('lava', 'lava'),
    new SceneDesc('lava_fork', 'lava_fork'),
    new SceneDesc('lava_skull', 'lava_skull'),
    new SceneDesc('library_interior', 'library_interior'),
    new SceneDesc('lighthouse', 'lighthouse'),
    new SceneDesc('lighthouse_house_a', 'lighthouse_house_a'),
    new SceneDesc('lighthouse_spin', 'lighthouse_spin'),
    new SceneDesc('mausoleum', 'mausoleum'),
    new SceneDesc('memory_core', 'memory_core'),
    new SceneDesc('mine_a', 'mine_a'),
    new SceneDesc('mine_bomb_pillar', 'mine_bomb_pillar'),
    new SceneDesc('mine_wrap', 'mine_wrap'),
    new SceneDesc('nature_hub', 'nature_hub'),
    new SceneDesc('nuzu_abandoned_a', 'nuzu_abandoned_a'),
    new SceneDesc('nuzu_abandoned_b', 'nuzu_abandoned_b'),
    new SceneDesc('nuzu_boilerroom', 'nuzu_boilerroom'),
    new SceneDesc('nuzu_dorm', 'nuzu_dorm'),
    new SceneDesc('nuzu_school', 'nuzu_school'),
    new SceneDesc('observatory', 'observatory'),
    new SceneDesc('octoheahedron', 'octoheahedron'),
    new SceneDesc('oldschool', 'oldschool'),
    new SceneDesc('oldschool_ruins', 'oldschool_ruins'),
    new SceneDesc('orrery', 'orrery'),
    new SceneDesc('orrery_b', 'orrery_b'),
    new SceneDesc('owl', 'owl'),
    new SceneDesc('parlor', 'parlor'),
    new SceneDesc('parlor_2d', 'parlor_2d'),
    new SceneDesc('pivot_one', 'pivot_one'),
    new SceneDesc('pivot_two', 'pivot_two'),
    new SceneDesc('pivot_three', 'pivot_three'),
    new SceneDesc('pivot_three_cave', 'pivot_three_cave'),
    new SceneDesc('pivot_watertower', 'pivot_watertower'),
    new SceneDesc('purple_lodge', 'purple_lodge'),
    new SceneDesc('purple_lodge_ruin', 'purple_lodge_ruin'),
    new SceneDesc('pyramid', 'pyramid'),
    new SceneDesc('quantum', 'quantum'),
    new SceneDesc('rails', 'rails'),
    new SceneDesc('ritual', 'ritual'),
    new SceneDesc('school', 'school'),
    new SceneDesc('school_2d', 'school_2d'),
    new SceneDesc('sewer_fork', 'sewer_fork'),
    new SceneDesc('sewer_geyser', 'sewer_geyser'),
    new SceneDesc('sewer_hub', 'sewer_hub'),
    new SceneDesc('sewer_lesser_gate_b', 'sewer_lesser_gate_b'),
    new SceneDesc('sewer_pillars', 'sewer_pillars'),
    new SceneDesc('sewer_pivot', 'sewer_pivot'),
    new SceneDesc('sewer_qr', 'sewer_qr'),
    new SceneDesc('sewer_start', 'sewer_start'),
    new SceneDesc('sewer_to_lava', 'sewer_to_lava'),
    new SceneDesc('sewer_treasure_one', 'sewer_treasure_one'),
    new SceneDesc('sewer_treasure_two', 'sewer_treasure_two'),
    new SceneDesc('showers', 'showers'),
    new SceneDesc('skull', 'skull'),
    new SceneDesc('skull_b', 'skull_b'),
    new SceneDesc('spinning_plates', 'spinning_plates'),
    new SceneDesc('stargate', 'stargate'),
    new SceneDesc('stargate_ruins', 'stargate_ruins'),
    new SceneDesc('superspin_cave', 'superspin_cave'),
    new SceneDesc('telescope', 'telescope'),
    new SceneDesc('temple_of_love', 'temple_of_love'),
    new SceneDesc('throne', 'throne'),
    new SceneDesc('tree', 'tree'),
    new SceneDesc('tree_crumble', 'tree_crumble'),
    new SceneDesc('tree_of_death', 'tree_of_death'),
    new SceneDesc('tree_roots', 'tree_roots'),
    new SceneDesc('tree_sky', 'tree_sky'),
    new SceneDesc('triple_pivot_cave', 'triple_pivot_cave'),
    new SceneDesc('two_walls', 'two_walls'),
    new SceneDesc('villageville_2d', 'villageville_2d'),
    new SceneDesc('villageville_3d', 'villageville_3d'),
    new SceneDesc('villageville_3d_end_32', 'villageville_3d_end_32'),
    new SceneDesc('villageville_3d_end_64', 'villageville_3d_end_64'),
    new SceneDesc('visitor', 'visitor'),
    new SceneDesc('wall_hole', 'wall_hole'),
    new SceneDesc('wall_interior_a', 'wall_interior_a'),
    new SceneDesc('wall_interior_b', 'wall_interior_b'),
    new SceneDesc('wall_interior_hole', 'wall_interior_hole'),
    new SceneDesc('wall_kitchen', 'wall_kitchen'),
    new SceneDesc('wall_school', 'wall_school'),
    new SceneDesc('wall_village', 'wall_village'),
    new SceneDesc('water_pyramid', 'water_pyramid'),
    new SceneDesc('water_tower', 'water_tower'),
    new SceneDesc('water_wheel', 'water_wheel'),
    new SceneDesc('water_wheel_b', 'water_wheel_b'),
    new SceneDesc('waterfall', 'waterfall'),
    new SceneDesc('waterfall_alt', 'waterfall_alt'),
    new SceneDesc('watertower_secret', 'watertower_secret'),
    new SceneDesc('weightswitch_temple', 'weightswitch_temple'),
    new SceneDesc('well_2', 'well_2'),
    new SceneDesc('windmill_cave', 'windmill_cave'),
    new SceneDesc('windmill_int', 'windmill_int'),
    new SceneDesc('zu_4_side', 'zu_4_side'),
    new SceneDesc('zu_bridge', 'zu_bridge'),
    new SceneDesc('zu_city', 'zu_city'),
    new SceneDesc('zu_city_ruins', 'zu_city_ruins'),
    new SceneDesc('zu_code_loop', 'zu_code_loop'),
    new SceneDesc('zu_fork', 'zu_fork'),
    new SceneDesc('zu_heads', 'zu_heads'),
    new SceneDesc('zu_house_empty', 'zu_house_empty'),
    new SceneDesc('zu_house_empty_b', 'zu_house_empty_b'),
    new SceneDesc('zu_house_qr', 'zu_house_qr'),
    new SceneDesc('zu_house_ruin_gate', 'zu_house_ruin_gate'),
    new SceneDesc('zu_house_ruin_visitors', 'zu_house_ruin_visitors'),
    new SceneDesc('zu_house_scaffolding', 'zu_house_scaffolding'),
    new SceneDesc('zu_library', 'zu_library'),
    new SceneDesc('zu_switch', 'zu_switch'),
    new SceneDesc('zu_switch_b', 'zu_switch_b'),
    new SceneDesc('zu_tetris', 'zu_tetris'),
    new SceneDesc('zu_throne_ruins', 'zu_throne_ruins'),
    new SceneDesc('zu_unfold', 'zu_unfold'),
    new SceneDesc('zu_zuish', 'zu_zuish'),
]

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
