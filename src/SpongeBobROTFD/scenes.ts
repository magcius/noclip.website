import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import * as Viewer from '../viewer';
import { FileType, loadArchive } from "./archive";
import { ROTFDRenderer } from './render';
import { DataStream } from './util';
import { readBitmap } from "./bitmap";
import { readMesh } from './mesh';
import { readMaterial } from './material';
import { readMaterialAnim } from "./materialanim";
import { readNode } from './node';
import { readSurface } from './surface';

/*
TODO:
 * lighting (LIGHT/OMNI)
 * extranous meshes (SKIN, LOD)
 * animated meshes (SKIN + ANIMATION) - ANIMATION files need research
 * fog (HFOG)
 * skybox (WARP)
 * billboards (ROTSHAPE)
 * PARTICLES
 * reflection textures
*/

class RotfdSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public async createScene(gfxDevice: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        
        const archive = await loadArchive(context.dataFetcher, this.id);

        const renderer = new ROTFDRenderer(gfxDevice);

        for (const meshFile of archive.iterFilesOfType(FileType.MESH)) {
            const reader = new DataStream(meshFile.data, 0, false);
            const meshdata = readMesh(reader);
            renderer.addMesh(meshFile.nameHash, meshdata);
        }

        for (const surfFile of archive.iterFilesOfType(FileType.SURFACE)) {
            const reader = new DataStream(surfFile.data, 0, false);
            const surfData = readSurface(reader);
            renderer.addSurface(surfFile.nameHash, surfData);
        }

        for (const bitmapFile of archive.iterFilesOfType(FileType.BITMAP)) {
            const reader = new DataStream(bitmapFile.data, 0, false);
            const bitmapData = readBitmap(reader);
            renderer.addBitmap(bitmapFile.nameHash, bitmapData);
        }

        for (const materialFile of archive.iterFilesOfType(FileType.MATERIAL)) {
            const reader = new DataStream(materialFile.data, 0, false);
            const materialData = readMaterial(reader);
            renderer.addMaterial(materialFile.nameHash, materialData);
        }

        for (const materialAnimFile of archive.iterFilesOfType(FileType.MATERIALANIM)) {
            const reader = new DataStream(materialAnimFile.data, 0, false);
            const manimData = readMaterialAnim(reader);
            renderer.addMaterialAnim(materialAnimFile.nameHash, manimData);
        }

        for (const nodeFile of archive.iterFilesOfType(FileType.NODE)) {
            const reader = new DataStream(nodeFile.data, 0, false);
            const nodeData = readNode(reader);
            if (nodeData.resource_id !== 0) {
                const resourceFile = archive.getFile(nodeData.resource_id);
                if (resourceFile === undefined) {
                    console.log("ERROR!");
                    continue;
                }
                if (resourceFile.typeHash === FileType.MESH || resourceFile.typeHash === FileType.SURFACE) {
                    renderer.addMeshNode(nodeData);
                }
            }
        }

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
    new RotfdSceneDesc('JF/LVL_JFCJ', 'Giant White Jellyfish'), // jellyfish follow area
    new RotfdSceneDesc('JF/LVL_JFCL', 'Jellyfish Cliffs'), // Clown?
    new RotfdSceneDesc('JF/LVL_JFCO', 'Snail Corral'), // Entrance/bait shop
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