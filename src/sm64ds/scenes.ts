
import { SceneDesc } from 'render';
import { SceneGroup } from '../viewer';

const id = "sm64ds";
const name = "Super Mario 64 DS";
const sceneDescs: SceneDesc[] = [
    {'id': 1, 'name': "Princess Peach's Castle - Gardens"},
    {'id': 2, 'name': "Princess Peach's Castle - 1st Floor"},
    {'id': 5, 'name': "Princess Peach's Castle - 2nd Floor"},
    {'id': 4, 'name': "Princess Peach's Castle - Basement"},
    {'id': 3, 'name': "Princess Peach's Castle - Courtyard"},
    {'id': 6, 'name': 'Bob-omb Battlefield'},
    {'id': 7, 'name': "Whomp's Fortress"},
    {'id': 8, 'name': 'Jolly Roger Bay'},
    {'id': 9, 'name': 'Jolly Roger Bay - Inside the Ship'},
    {'id': 10, 'name': 'Cool, Cool Mountain'},
    {'id': 11, 'name': 'Cool, Cool Mountain - Inside the Slide'},
    {'id': 12, 'name': "Big Boo's Haunt"},
    {'id': 13, 'name': 'Hazy Maze Cave'},
    {'id': 14, 'name': 'Lethal Lava Land'},
    {'id': 15, 'name': 'Lethal Lava Land - Inside the Volcano'},
    {'id': 16, 'name': 'Shifting Sand Land'},
    {'id': 17, 'name': 'Shifting Sand Land - Inside the Pyramid'},
    {'id': 18, 'name': 'Dire, Dire Docks'},
    {'id': 19, 'name': "Snowman's Land"},
    {'id': 20, 'name': "Snowman's Land - Inside the Igloo"},
    {'id': 21, 'name': 'Wet-Dry World'},
    {'id': 22, 'name': 'Tall Tall Mountain'},
    {'id': 23, 'name': 'Tall Tall Mountain - Inside the Slide'},
    {'id': 25, 'name': 'Tiny-Huge Island - Tiny'},
    {'id': 24, 'name': 'Tiny-Huge Island - Huge'},
    {'id': 26, 'name': "Tiny-Huge Island - Inside Wiggler's Cavern"},
    {'id': 27, 'name': 'Tick Tock Clock'},
    {'id': 28, 'name': 'Rainbow Ride'},
    {'id': 35, 'name': 'Bowser in the Dark World'},
    {'id': 36, 'name': 'Bowser in the Dark World - Battle'},
    {'id': 37, 'name': 'Bowser in the Fire Sea'},
    {'id': 38, 'name': 'Bowser in the Fire Sea - Battle'},
    {'id': 39, 'name': 'Bowser in the Sky'},
    {'id': 40, 'name': 'Bowser in the Sky - Battle'},
    {'id': 29, 'name': 'The Princess\'s Secret Slide'},
    {'id': 30, 'name': 'The Secret Aquarium'},
    {'id': 34, 'name': 'Wing Mario over the Rainbow'},
    {'id': 31, 'name': 'Tower of the Wing Cap'},
    {'id': 32, 'name': 'Vanish Cap Under the Moat'},
    {'id': 33, 'name': 'Cavern of the Metal Cap'},
    {'id': 46, 'name': 'ex_l_map_all.bmd'},
    {'id': 47, 'name': 'ex_luigi_all.bmd'},
    {'id': 44, 'name': 'ex_m_map_all.bmd'},
    {'id': 45, 'name': 'ex_mario_all.bmd'},
    {'id': 48, 'name': 'ex_w_map_all.bmd'},
    {'id': 49, 'name': 'ex_wario_all.bmd'},
    {'id': 50, 'name': 'Princess Peach\'s Castle - Playroom'},
    {'id': 0, 'name': 'Test Map A'},
    {'id': 41, 'name': 'Test Map B'},
    {'id': 42, 'name': 'VS Map A'},
    {'id': 43, 'name': 'VS Map B'},
    {'id': 51, 'name': 'VS Map C'},
].map((entry): SceneDesc => {
    return new SceneDesc(entry.name, entry.id);
});

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
