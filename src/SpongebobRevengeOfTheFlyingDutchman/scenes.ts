import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import * as Viewer from '../viewer';
import { loadArchive } from "./archive";
import { ROTFDRenderer } from './render';

/*
TODO:
 * animated meshes (SKIN + ANIMATION) - ANIMATION files need research
 * PARTICLES - needs research
 * additional material flags (needs research)
 */

const dataBasePath = "SpongebobRevengeOfTheFlyingDutchman";

class RotfdSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public async createScene(gfxDevice: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const archive = await loadArchive(context.dataFetcher, `${dataBasePath}/${this.id}`);
        const renderer = new ROTFDRenderer(gfxDevice);
        renderer.addArchive(archive);

        return renderer;
    }
}

const sceneDescs = [
    'Main Menu',
    new RotfdSceneDesc('BB/MAINMENU', 'Main Menu'),
    'Bikini Bottom',
    new RotfdSceneDesc('BB/LVL_BBEX', 'Bikini Bottom'),
    new RotfdSceneDesc('BB/LVL_BBKM', 'Karate Minigame'),
    new RotfdSceneDesc('BB/LVL_BBKK', 'Krusty Krab'),
    new RotfdSceneDesc('BB/LVL_BBSH', 'Spongebob\'s House'),
    new RotfdSceneDesc('BB/LVL_BBTP', 'Tile Puzzle'),
    'Downtown Bikini Bottom',
    new RotfdSceneDesc('DN/LVL_DNBD', 'Business District'),
    new RotfdSceneDesc('DN/LVL_DNCS', 'Construction Site'),
    new RotfdSceneDesc('DN/LVL_DNHR', 'High Rise'),
    new RotfdSceneDesc('DN/LVL_DNTP', 'Tile Puzzle'),
    'Sandy\'s Tree Dome',
    new RotfdSceneDesc('TD/LVL_TDGL', 'Ground Level'),
    new RotfdSceneDesc('TD/LVL_TDTP', 'Tile Puzzle'),
    new RotfdSceneDesc('TD/LVL_TDUR', 'Upper Level'),
    'Chum World',
    new RotfdSceneDesc('CA/LVL_CABT', 'Big Top'),
    new RotfdSceneDesc('CA/LVL_CAGC', 'Chum Putt'),
    new RotfdSceneDesc('CA/LVL_CAMG', 'Carnival Games'),
    new RotfdSceneDesc('CA/LVL_CATP', 'Tile Puzzle'),
    'Jellyfish Fields',
    new RotfdSceneDesc('JF/LVL_JFCJ', 'Giant White Jellyfish'),
    new RotfdSceneDesc('JF/LVL_JFCL', 'Jellyfish Cliffs'),
    new RotfdSceneDesc('JF/LVL_JFCO', 'Snail Corral'),
    new RotfdSceneDesc('JF/LVL_JFTP', 'Tile Puzzle'),
    'Goo Lagoon',
    new RotfdSceneDesc('GL/LVL_GLBE', 'Beach'),
    new RotfdSceneDesc('GL/LVL_GLLH', 'Lighthouse'),
    new RotfdSceneDesc('GL/LVL_GLPA', 'Pier (Destroyed)'),
    new RotfdSceneDesc('GL/LVL_GLPB', 'Pier (Regular)'),
    new RotfdSceneDesc('GL/LVL_GLTP', 'Tile Puzzle'),
    'The Flying Dutchman\'s Graveyard',
    new RotfdSceneDesc('DG/LVL_DGBA', 'Boss Arena'),
    new RotfdSceneDesc('DG/LVL_DGSG', 'Graveyard of Ships'),
    new RotfdSceneDesc('DG/LVL_DGDS', 'The Flying Dutchman\'s Ship'),
    new RotfdSceneDesc('DG/LVL_DGTP', 'Tile Puzzle'),
];

const id = 'rotfd';
const name = "SpongeBob SquarePants: Revenge of the Flying Dutchman";
export const sceneGroup: Viewer.SceneGroup = {
    id, name, sceneDescs,
};
