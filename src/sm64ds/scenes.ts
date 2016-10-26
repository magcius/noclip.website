
import { SceneDesc } from 'render';

const sceneDescs:SceneDesc[] = [
    'battan_king_map_all.bmd',
    'bombhei_map_all.bmd',
    'castle_1f_all.bmd',
    'castle_2f_all.bmd',
    'castle_b1_all.bmd',
    'cave_all.bmd',
    'clock_tower_all.bmd',
    'desert_land_all.bmd',
    'desert_py_all.bmd',
    'ex_l_map_all.bmd',
    'ex_luigi_all.bmd',
    'ex_m_map_all.bmd',
    'ex_mario_all.bmd',
    'ex_w_map_all.bmd',
    'ex_wario_all.bmd',
    'fire_land_all.bmd',
    'fire_mt_all.bmd',
    'habatake_all.bmd',
    'high_mt_all.bmd',
    'high_slider_all.bmd',
    'horisoko_all.bmd',
    'kaizoku_irie_all.bmd',
    'kaizoku_ship_all.bmd',
    'koopa1_boss_all.bmd',
    'koopa1_map_all.bmd',
    'koopa2_boss_all.bmd',
    'koopa2_map_all.bmd',
    'koopa3_boss_all.bmd',
    'koopa3_map_all.bmd',
    'main_castle_all.bmd',
    'main_garden_all.bmd',
    'metal_switch_all.bmd',
    'playroom_all.bmd',
    'rainbow_cruise_all.bmd',
    'rainbow_mario_all.bmd',
    'snow_kama_all.bmd',
    'snow_land_all.bmd',
    'snow_mt_all.bmd',
    'snow_slider_all.bmd',
    'suisou_all.bmd',
    'teresa_house_all.bmd',
    'test_map_all.bmd',
    'test_map_b_all.bmd',
    'tibi_deka_d_all.bmd',
    'tibi_deka_in_all.bmd',
    'tibi_deka_t_all.bmd',
    'water_city_all.bmd',
    'water_land_all.bmd',
].map((filename:string):SceneDesc => {
    const path = 'data/sm64ds/' + filename;
    return new SceneDesc(filename, path);
});

export function loadSceneDescs():SceneDesc[] {
    return sceneDescs;
}
