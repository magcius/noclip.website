
import { SceneDesc } from 'render';
import { SceneGroup } from '../viewer';

const name = "Super Mario 64 DS";
const sceneDescs: SceneDesc[] = [
    { name: "Princess Peach's Castle - Gardens", filename: 'main_castle_all.bmd' },
    { name: "Princess Peach's Castle - 1st Floor", filename: 'castle_1f_all.bmd' },
    { name: "Princess Peach's Castle - 2nd Floor", filename: 'castle_2f_all.bmd' },
    { name: "Princess Peach's Castle - Basement", filename: 'castle_b1_all.bmd' },
    { name: "Princess Peach's Castle - Courtyard", filename: 'main_garden_all.bmd' },
    { name: "Bob-omb Battlefield", filename: 'bombhei_map_all.bmd' },
    { name: "Whomp's Fortress", filename: 'battan_king_map_all.bmd' },
    { name: "Jolly Roger Bay", filename: 'kaizoku_irie_all.bmd' },
    { name: "Jolly Roger Bay - Inside the Ship", filename: 'kaizoku_ship_all.bmd' },
    { name: "Cool, Cool Mountain", filename: 'snow_mt_all.bmd' },
    { name: "Cool, Cool Mountain - Inside the Slide", filename: 'snow_slider_all.bmd' },
    { name: "Big Boo's Haunt", filename: 'teresa_house_all.bmd' },
    { name: "Hazy Maze Cave", filename: 'cave_all.bmd' },
    { name: "Lethal Lava Land", filename: 'fire_land_all.bmd' },
    { name: "Lethal Lava Land - Inside the Volcano", filename: 'fire_mt_all.bmd' },
    { name: "Shifting Sand Land", filename: 'desert_land_all.bmd' },
    { name: "Shifting Sand Land - Inside the Pyramid", filename: 'desert_py_all.bmd' },
    { name: "Dire, Dire Docks", filename: 'water_land_all.bmd' },
    { name: "Snowman's Land", filename: 'snow_land_all.bmd' },
    { name: "Snowman's Land - Inside the Igloo", filename: 'snow_kama_all.bmd' },
    { name: "Wet-Dry World", filename: 'water_city_all.bmd' },
    { name: "Tall Tall Mountain", filename: 'high_mt_all.bmd' },
    { name: "Tall Tall Mountain - Inside the Slide", filename: 'high_slider_all.bmd' },
    { name: "Tiny-Huge Island - Tiny", filename: 'tibi_deka_t_all.bmd' },
    { name: "Tiny-Huge Island - Huge", filename: 'tibi_deka_d_all.bmd' },
    { name: "Tiny-Huge Island - Inside Wiggler's Cavern", filename: 'tibi_deka_in_all.bmd' },
    { name: "Tick Tock Clock", filename: 'clock_tower_all.bmd' },
    { name: "Rainbow Ride", filename: 'rainbow_cruise_all.bmd' },
    { name: "Bowser in the Dark World", filename: 'koopa1_map_all.bmd' },
    { name: "Bowser in the Dark World - Battle", filename: 'koopa1_boss_all.bmd' },
    { name: "Bowser in the Fire Sea", filename: 'koopa2_map_all.bmd' },
    { name: "Bowser in the Fire Sea - Battle", filename: 'koopa2_boss_all.bmd' },
    { name: "Bowser in the Sky", filename: 'koopa3_map_all.bmd' },
    { name: "Bowser in the Sky - Battle", filename: 'koopa3_boss_all.bmd' },
    { name: "The Secret Aquarium", filename: 'suisou_all.bmd' },
    { name: "Wing Mario over the Rainbow", filename: 'rainbow_mario_all.bmd' },
    { name: "Tower of the Vanish Cap", filename: 'habatake_all.bmd' },
    { name: "Vanish Cap Under the Moat", filename: 'horisoko_all.bmd' },
    { name: "Cavern of the Metal Cap", filename: 'metal_switch_all.bmd' },
    { name: "", filename: 'ex_l_map_all.bmd' },
    { name: "", filename: 'ex_luigi_all.bmd' },
    { name: "", filename: 'ex_m_map_all.bmd' },
    { name: "", filename: 'ex_mario_all.bmd' },
    { name: "", filename: 'ex_w_map_all.bmd' },
    { name: "", filename: 'ex_wario_all.bmd' },
    { name: "Princess Peach's Castle - Playroom", filename: 'playroom_all.bmd' },
    { name: "Test Map A", filename: 'test_map_all.bmd' },
    { name: "Test Map B", filename: 'test_map_b_all.bmd' },
].map((entry): SceneDesc => {
    const path = `data/sm64ds/${entry.filename}`;
    const sceneName = entry.name || entry.filename;
    return new SceneDesc(sceneName, path);
});

export const sceneGroup: SceneGroup = { name, sceneDescs };
