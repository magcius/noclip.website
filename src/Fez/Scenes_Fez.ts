
import * as Viewer from '../viewer';
import { DataFetcher } from '../DataFetcher';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { FezRenderer } from './FezRenderer';
import { TrilesetData } from './TrileData';
import { ArtObjectData } from './ArtObjectData';
import { BackgroundPlaneData } from './BackgroundPlaneData';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { SkyData, fetchSkyData } from './Sky';
import { FezContentTypeReaderManager, Fez_ArtObject, Fez_TrileSet, Fez_AnimatedTexture, Fez_Level } from './XNB_Fez';
import { parse, XNA_Texture2D } from './XNB';

const pathBase = 'Fez';

export class ModelCache {
    public promiseCache = new Map<string, Promise<void>>();
    public trilesetDatas: TrilesetData[] = [];
    public artObjectDatas: ArtObjectData[] = [];
    public backgroundPlaneDatas: BackgroundPlaneData[] = [];
    public skyDatas: SkyData[] = [];
    public gfxRenderCache = new GfxRenderCache();
    private fezTypeReaderManager = new FezContentTypeReaderManager();

    constructor(private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<void> {
        return Promise.all(this.promiseCache.values()) as unknown as Promise<void>;
    }

    public async fetchXNB<T>(path: string): Promise<T> {
        const data = await this.dataFetcher.fetchData(`${pathBase}/${path}`);
        return parse<T>(this.fezTypeReaderManager, data);
    }

    private async fetchTrilesetInternal(device: GfxDevice, path: string): Promise<void> {
        const data = await this.fetchXNB<Fez_TrileSet>(`xnb/trile sets/${path}.xnb`);
        this.trilesetDatas.push(new TrilesetData(device, this.gfxRenderCache, path, data));
    }

    private async fetchArtObjectInternal(device: GfxDevice, path: string): Promise<void> {
        const xnb = await this.fetchXNB<Fez_ArtObject>(`xnb/art objects/${path}.xnb`);
        this.artObjectDatas.push(new ArtObjectData(device, this.gfxRenderCache, path, xnb));
    }

    private async fetchBackgroundPlaneInternal(device: GfxDevice, path: string, isAnimated: boolean): Promise<void> {
        if (isAnimated) {
            const data = await this.fetchXNB<Fez_AnimatedTexture>(`xnb/background planes/${path}.xnb`);
            this.backgroundPlaneDatas.push(new BackgroundPlaneData(device, path, data.texture, data));
        } else {
            const data = await this.fetchXNB<XNA_Texture2D>(`xnb/background planes/${path}.xnb`);
            this.backgroundPlaneDatas.push(new BackgroundPlaneData(device, path, data, null));
        }
    }

    private async fetchSkyDataInternal(device: GfxDevice, path: string): Promise<void> {
        this.skyDatas.push(await fetchSkyData(this, device, this.gfxRenderCache, path));
    }

    public fetchTrileset(device: GfxDevice, path: string): void {
        const key = `trile sets/${path}`;
        if (!this.promiseCache.has(key))
            this.promiseCache.set(key, this.fetchTrilesetInternal(device, path));
    }

    public fetchArtObject(device: GfxDevice, path: string): void {
        const key = `art objects/${path}`;
        if (!this.promiseCache.has(key))
            this.promiseCache.set(key, this.fetchArtObjectInternal(device, path));
    }

    public fetchBackgroundPlane(device: GfxDevice, path: string, isAnimated: boolean): void {
        const key = `background planes/${path}`;
        if (!this.promiseCache.has(key))
            this.promiseCache.set(key, this.fetchBackgroundPlaneInternal(device, path, isAnimated));
    }

    public fetchSky(device: GfxDevice, path: string): void {
        const key = `skies/${path}`;
        if (!this.promiseCache.has(key))
            this.promiseCache.set(key, this.fetchSkyDataInternal(device, path));
    }

    public destroy(device: GfxDevice): void {
        this.gfxRenderCache.destroy(device);
        for (let i = 0; i < this.trilesetDatas.length; i++)
            this.trilesetDatas[i].destroy(device);
        for (let i = 0; i < this.artObjectDatas.length; i++)
            this.artObjectDatas[i].destroy(device);
        for (let i = 0; i < this.backgroundPlaneDatas.length; i++)
            this.backgroundPlaneDatas[i].destroy(device);
        for (let i = 0; i < this.skyDatas.length; i++)
            this.skyDatas[i].destroy(device);
    }
}

function parseBoolean(str: string): boolean {
    if (str === 'True')
        return true;
    else if (str === 'False')
        return false;
    else
        throw "whoops";
}

class FezSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const cache = await context.dataShare.ensureObject<ModelCache>(`${pathBase}/ModelCache`, async () => {
            return new ModelCache(context.dataFetcher);
        });

        const level = await cache.fetchXNB<Fez_Level>(`xnb/levels/${this.id}.xnb`);

        cache.fetchTrileset(device, level.trileSetName);
        cache.fetchSky(device, level.skyName);

        for (const artObject of level.artObjects.values())
            cache.fetchArtObject(device, artObject.name);

        for (const backgroundPlane of level.backgroundPlanes.values())
            cache.fetchBackgroundPlane(device, backgroundPlane.textureName, backgroundPlane.animated);

        await cache.waitForLoad();

        return new FezRenderer(device, cache, level);
    }
}

const id = 'Fez';
const name = 'Fez';
const sceneDescs = [
    new FezSceneDesc('abandoned_a', 'abandoned_a'),
    new FezSceneDesc('abandoned_b', 'abandoned_b'),
    new FezSceneDesc('abandoned_c', 'abandoned_c'),
    new FezSceneDesc('ancient_walls', 'ancient_walls'),
    new FezSceneDesc('arch', 'arch'),
    new FezSceneDesc('bell_tower', 'bell_tower'),
    new FezSceneDesc('big_owl', 'big_owl'),
    new FezSceneDesc('big_tower', 'big_tower'),
    new FezSceneDesc('boileroom', 'boileroom'),
    new FezSceneDesc('cabin_interior_a', 'cabin_interior_a'),
    new FezSceneDesc('cabin_interior_b', 'cabin_interior_b'),
    new FezSceneDesc('clock', 'clock'),
    new FezSceneDesc('cmy', 'cmy'),
    new FezSceneDesc('cmy_b', 'cmy_b'),
    new FezSceneDesc('cmy_fork', 'cmy_fork'),
    new FezSceneDesc('code_machine', 'code_machine'),
    new FezSceneDesc('crypt', 'crypt'),
    new FezSceneDesc('drum', 'drum'),
    new FezSceneDesc('elders', 'elders'),
    new FezSceneDesc('extractor_a', 'extractor_a'),
    new FezSceneDesc('five_towers', 'five_towers'),
    new FezSceneDesc('five_towers_cave', 'five_towers_cave'),
    new FezSceneDesc('fox', 'fox'),
    new FezSceneDesc('fractal', 'fractal'),
    new FezSceneDesc('geezer_house', 'geezer_house'),
    new FezSceneDesc('geezer_house_2d', 'geezer_house_2d'),
    new FezSceneDesc('globe', 'globe'),
    new FezSceneDesc('globe_int', 'globe_int'),
    new FezSceneDesc('gomez_house', 'gomez_house'),
    new FezSceneDesc('gomez_house_2d', 'gomez_house_2d'),
    new FezSceneDesc('gomez_house_end_32', 'gomez_house_end_32'),
    new FezSceneDesc('gomez_house_end_64', 'gomez_house_end_64'),
    new FezSceneDesc('grave_cabin', 'grave_cabin'),
    new FezSceneDesc('grave_ghost', 'grave_ghost'),
    new FezSceneDesc('grave_lesser_gate', 'grave_lesser_gate'),
    new FezSceneDesc('grave_treasure_a', 'grave_treasure_a'),
    new FezSceneDesc('graveyard_a', 'graveyard_a'),
    new FezSceneDesc('graveyard_gate', 'graveyard_gate'),
    new FezSceneDesc('hex_rebuild', 'hex_rebuild'),
    new FezSceneDesc('indust_abandoned_a', 'indust_abandoned_a'),
    new FezSceneDesc('industrial_city', 'industrial_city'),
    new FezSceneDesc('industrial_hub', 'industrial_hub'),
    new FezSceneDesc('industrial_superspin', 'industrial_superspin'),
    new FezSceneDesc('kitchen', 'kitchen'),
    new FezSceneDesc('kitchen_2d', 'kitchen_2d'),
    new FezSceneDesc('lava', 'lava'),
    new FezSceneDesc('lava_fork', 'lava_fork'),
    new FezSceneDesc('lava_skull', 'lava_skull'),
    new FezSceneDesc('library_interior', 'library_interior'),
    new FezSceneDesc('lighthouse', 'lighthouse'),
    new FezSceneDesc('lighthouse_house_a', 'lighthouse_house_a'),
    new FezSceneDesc('lighthouse_spin', 'lighthouse_spin'),
    new FezSceneDesc('mausoleum', 'mausoleum'),
    new FezSceneDesc('memory_core', 'memory_core'),
    new FezSceneDesc('mine_a', 'mine_a'),
    new FezSceneDesc('mine_bomb_pillar', 'mine_bomb_pillar'),
    new FezSceneDesc('mine_wrap', 'mine_wrap'),
    new FezSceneDesc('nature_hub', 'nature_hub'),
    new FezSceneDesc('nuzu_abandoned_a', 'nuzu_abandoned_a'),
    new FezSceneDesc('nuzu_abandoned_b', 'nuzu_abandoned_b'),
    new FezSceneDesc('nuzu_boilerroom', 'nuzu_boilerroom'),
    new FezSceneDesc('nuzu_dorm', 'nuzu_dorm'),
    new FezSceneDesc('nuzu_school', 'nuzu_school'),
    new FezSceneDesc('observatory', 'observatory'),
    new FezSceneDesc('octoheahedron', 'octoheahedron'),
    new FezSceneDesc('oldschool', 'oldschool'),
    new FezSceneDesc('oldschool_ruins', 'oldschool_ruins'),
    new FezSceneDesc('orrery', 'orrery'),
    new FezSceneDesc('orrery_b', 'orrery_b'),
    new FezSceneDesc('owl', 'owl'),
    new FezSceneDesc('parlor', 'parlor'),
    new FezSceneDesc('parlor_2d', 'parlor_2d'),
    new FezSceneDesc('pivot_one', 'pivot_one'),
    new FezSceneDesc('pivot_two', 'pivot_two'),
    new FezSceneDesc('pivot_three', 'pivot_three'),
    new FezSceneDesc('pivot_three_cave', 'pivot_three_cave'),
    new FezSceneDesc('pivot_watertower', 'pivot_watertower'),
    new FezSceneDesc('purple_lodge', 'purple_lodge'),
    new FezSceneDesc('purple_lodge_ruin', 'purple_lodge_ruin'),
    new FezSceneDesc('pyramid', 'pyramid'),
    new FezSceneDesc('quantum', 'quantum'),
    new FezSceneDesc('rails', 'rails'),
    new FezSceneDesc('ritual', 'ritual'),
    new FezSceneDesc('school', 'school'),
    new FezSceneDesc('school_2d', 'school_2d'),
    new FezSceneDesc('sewer_fork', 'sewer_fork'),
    new FezSceneDesc('sewer_geyser', 'sewer_geyser'),
    new FezSceneDesc('sewer_hub', 'sewer_hub'),
    new FezSceneDesc('sewer_lesser_gate_b', 'sewer_lesser_gate_b'),
    new FezSceneDesc('sewer_pillars', 'sewer_pillars'),
    new FezSceneDesc('sewer_pivot', 'sewer_pivot'),
    new FezSceneDesc('sewer_qr', 'sewer_qr'),
    new FezSceneDesc('sewer_start', 'sewer_start'),
    new FezSceneDesc('sewer_to_lava', 'sewer_to_lava'),
    new FezSceneDesc('sewer_treasure_one', 'sewer_treasure_one'),
    new FezSceneDesc('sewer_treasure_two', 'sewer_treasure_two'),
    new FezSceneDesc('showers', 'showers'),
    new FezSceneDesc('skull', 'skull'),
    new FezSceneDesc('skull_b', 'skull_b'),
    new FezSceneDesc('spinning_plates', 'spinning_plates'),
    new FezSceneDesc('stargate', 'stargate'),
    new FezSceneDesc('stargate_ruins', 'stargate_ruins'),
    new FezSceneDesc('superspin_cave', 'superspin_cave'),
    new FezSceneDesc('telescope', 'telescope'),
    new FezSceneDesc('temple_of_love', 'temple_of_love'),
    new FezSceneDesc('throne', 'throne'),
    new FezSceneDesc('tree', 'tree'),
    new FezSceneDesc('tree_crumble', 'tree_crumble'),
    new FezSceneDesc('tree_of_death', 'tree_of_death'),
    new FezSceneDesc('tree_roots', 'tree_roots'),
    new FezSceneDesc('tree_sky', 'tree_sky'),
    new FezSceneDesc('triple_pivot_cave', 'triple_pivot_cave'),
    new FezSceneDesc('two_walls', 'two_walls'),
    new FezSceneDesc('villageville_2d', 'villageville_2d'),
    new FezSceneDesc('villageville_3d', 'villageville_3d'),
    new FezSceneDesc('villageville_3d_end_32', 'villageville_3d_end_32'),
    new FezSceneDesc('villageville_3d_end_64', 'villageville_3d_end_64'),
    new FezSceneDesc('visitor', 'visitor'),
    new FezSceneDesc('wall_hole', 'wall_hole'),
    new FezSceneDesc('wall_interior_a', 'wall_interior_a'),
    new FezSceneDesc('wall_interior_b', 'wall_interior_b'),
    new FezSceneDesc('wall_interior_hole', 'wall_interior_hole'),
    new FezSceneDesc('wall_kitchen', 'wall_kitchen'),
    new FezSceneDesc('wall_school', 'wall_school'),
    new FezSceneDesc('wall_village', 'wall_village'),
    new FezSceneDesc('water_pyramid', 'water_pyramid'),
    new FezSceneDesc('water_tower', 'water_tower'),
    new FezSceneDesc('water_wheel', 'water_wheel'),
    new FezSceneDesc('water_wheel_b', 'water_wheel_b'),
    new FezSceneDesc('waterfall', 'waterfall'),
    new FezSceneDesc('waterfall_alt', 'waterfall_alt'),
    new FezSceneDesc('watertower_secret', 'watertower_secret'),
    new FezSceneDesc('weightswitch_temple', 'weightswitch_temple'),
    new FezSceneDesc('well_2', 'well_2'),
    new FezSceneDesc('windmill_cave', 'windmill_cave'),
    new FezSceneDesc('windmill_int', 'windmill_int'),
    new FezSceneDesc('zu_4_side', 'zu_4_side'),
    new FezSceneDesc('zu_bridge', 'zu_bridge'),
    new FezSceneDesc('zu_city', 'zu_city'),
    new FezSceneDesc('zu_city_ruins', 'zu_city_ruins'),
    new FezSceneDesc('zu_code_loop', 'zu_code_loop'),
    new FezSceneDesc('zu_fork', 'zu_fork'),
    new FezSceneDesc('zu_heads', 'zu_heads'),
    new FezSceneDesc('zu_house_empty', 'zu_house_empty'),
    new FezSceneDesc('zu_house_empty_b', 'zu_house_empty_b'),
    new FezSceneDesc('zu_house_qr', 'zu_house_qr'),
    new FezSceneDesc('zu_house_ruin_gate', 'zu_house_ruin_gate'),
    new FezSceneDesc('zu_house_ruin_visitors', 'zu_house_ruin_visitors'),
    new FezSceneDesc('zu_house_scaffolding', 'zu_house_scaffolding'),
    new FezSceneDesc('zu_library', 'zu_library'),
    new FezSceneDesc('zu_switch', 'zu_switch'),
    new FezSceneDesc('zu_switch_b', 'zu_switch_b'),
    new FezSceneDesc('zu_tetris', 'zu_tetris'),
    new FezSceneDesc('zu_throne_ruins', 'zu_throne_ruins'),
    new FezSceneDesc('zu_unfold', 'zu_unfold'),
    new FezSceneDesc('zu_zuish', 'zu_zuish'),
]

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
