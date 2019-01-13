
import * as Viewer from '../viewer';

import { createModelInstance, BasicRenderer } from './scenes';

import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { readString, assert, assertExists } from '../util';
import { fetchData } from '../fetch';
import { mat4, quat } from 'gl-matrix';
import * as RARC from './rarc';
import { J3DTextureHolder, BMDModelInstance } from './render';
import { BCK } from './j3d';
import { GfxDevice } from '../gfx/platform/GfxPlatform';

const id = "mkdd";
const name = "Mario Kart: Double Dash!!";

interface Obj {
    id: number;
    routeId: number;
    modelMatrix: mat4;
}

interface BOL {
    objects: Obj[];
}

function parseBOL(buffer: ArrayBufferSlice): BOL {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04) == '0015');
    const objectTableCount = view.getUint16(0x1E);
    const objectTableOffs = view.getUint32(0x54);

    const objects: Obj[] = [];
    let objectTableIdx = objectTableOffs;
    for (let i = 0; i < objectTableCount; i++) {
        const translationX = view.getFloat32(objectTableIdx + 0x00);
        const translationY = view.getFloat32(objectTableIdx + 0x04);
        const translationZ = view.getFloat32(objectTableIdx + 0x08);
        const scaleX = view.getFloat32(objectTableIdx + 0x0C);
        const scaleY = view.getFloat32(objectTableIdx + 0x10);
        const scaleZ = view.getFloat32(objectTableIdx + 0x14);
        const rotFaceX = view.getInt32(objectTableIdx + 0x18);
        const rotFaceZ = view.getInt32(objectTableIdx + 0x1C);
        const rotFaceN = view.getInt32(objectTableIdx + 0x20);
        const id = view.getUint16(objectTableIdx + 0x24);
        const routeId = view.getInt16(objectTableIdx + 0x26);

        const modelMatrix = mat4.create();
        const q = quat.create();
        const rotationY = Math.atan2(rotFaceZ, rotFaceX);
        quat.fromEuler(q, 0, -(rotationY * 180 / Math.PI) + 90, 0);
        mat4.fromRotationTranslationScale(modelMatrix, q, [translationX, translationY, translationZ], [scaleX, scaleY, scaleZ]);
        objects.push({ id, routeId, modelMatrix });
        objectTableIdx += 0x40;
    }

    return { objects };
}

class MKDDSceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(public name: string, public path: string) {
        this.id = this.path;
    }

    private spawnBMD(device: GfxDevice, renderer: BasicRenderer, rarc: RARC.RARC, basename: string, modelMatrix: mat4 = null): BMDModelInstance {
        const bmdFile = rarc.findFile(`${basename}.bmd`);
        assertExists(bmdFile);
        const btkFile = rarc.findFile(`${basename}.btk`);
        const brkFile = rarc.findFile(`${basename}.brk`);
        const bmtFile = rarc.findFile(`${basename}.bmt`);
        const scene = createModelInstance(device, renderer.renderHelper, renderer.textureHolder, bmdFile, btkFile, brkFile, null, bmtFile);
        scene.name = basename;
        if (modelMatrix !== null)
            mat4.copy(scene.modelMatrix, modelMatrix);
        return scene;
    }

    public createSceneGfx(device: GfxDevice): Progressable<Viewer.SceneGfx> {
        const path = `data/j3d/mkdd/Course/${this.path}`;
        return fetchData(path).then((buffer: ArrayBufferSlice) => {
            const rarc = RARC.parse(buffer);
            // Find course name.
            const bolFile = rarc.files.find((f) => f.name.endsWith('_course.bol'));
            const courseName = bolFile.name.replace('_course.bol', '');

            const renderer = new BasicRenderer(device, new J3DTextureHolder());

            if (rarc.findFile(`${courseName}_sky.bmd`))
                renderer.addModelInstance(this.spawnBMD(device, renderer, rarc, `${courseName}_sky`));

            renderer.addModelInstance(this.spawnBMD(device, renderer, rarc, `${courseName}_course`));

            const spawnObject = (obj: Obj, basename: string, animName: string = null) => {
                const scene = this.spawnBMD(device, renderer, rarc, basename, obj.modelMatrix);
                renderer.addModelInstance(scene);
                let bckFile;
                if (animName !== null) {
                    bckFile = rarc.findFile(animName);
                    assertExists(bckFile);
                } else {
                    bckFile = rarc.findFile(`${basename}_wait.bck`);
                }
                if (bckFile !== null) {
                    const bck = BCK.parse(bckFile.buffer);
                    scene.bindANK1(bck.ank1);
                }
            };

            const bol = parseBOL(bolFile.buffer);
            console.log(courseName, rarc, bol);
            for (const obj of bol.objects) {
                switch (obj.id) {
                case 0x0001:
                case 0x0009:
                    // Item box.
                    break;
                case 0x0D49:
                    // Sea.
                    spawnObject(obj, `objects/sea1_spc`);
                    spawnObject(obj, `objects/sea2_tex`);
                    spawnObject(obj, `objects/sea3_dark`);
                    spawnObject(obj, `objects/sea4_nami`);
                    spawnObject(obj, `objects/sea5_sand`);
                    break;
                case 0x0D4A:
                    spawnObject(obj, `objects/poihana1`); break;
                case 0x0D4D:
                    spawnObject(obj, `objects/peachtree1`); break;
                case 0x0D4E:
                    spawnObject(obj, `objects/peachfountain`); break;
                case 0x0D4F:
                    spawnObject(obj, `objects/marel_a`); break;
                case 0x0E75:
                    spawnObject(obj, `objects/mariotree1`); break;
                case 0x0E77:
                    spawnObject(obj, `objects/marioflower1`, `objects/marioflower1.bck`); break;
                case 0x0E78:
                    // Chain chomp. Looks awful, don't spawn.
                    // spawnObject(obj, `objects/wanwan1`); break;
                    break;
                case 0x0E7E:
                    spawnObject(obj, 'objects/skyship1'); break;
                case 0x0E7F:
                    spawnObject(obj, `objects/kuribo1`); break;
                case 0x119A:
                    // Butterflies.
                    break;
                default:
                    console.warn(`Unknown object ID ${obj.id.toString(16)}`);
                    continue;
                }
            }

            renderer.finish(device);
            return renderer;
        });
    }
}

// Courses named and organized by Starschulz
const sceneDescs = [
    "Luigi Circuit",
    new MKDDSceneDesc(`Luigi Circuit`, 'Luigi.arc'),
    new MKDDSceneDesc(`Peach Beach`, 'Peach.arc'),
    new MKDDSceneDesc(`Baby Park`, 'BabyLuigi.arc'),
    new MKDDSceneDesc(`Dry Dry Desert`, 'Desert.arc'),
    "Flower Cup",
    new MKDDSceneDesc(`Mushroom Bridge`, 'Nokonoko.arc'),
    new MKDDSceneDesc(`Mario Circuit`, 'Mario.arc'),
    new MKDDSceneDesc(`Daisy Cruiser`, 'Daisy.arc'),
    new MKDDSceneDesc(`Waluigi Stadium`, 'Waluigi.arc'),
    "Star Cup",
    new MKDDSceneDesc(`Sherbet Land`, 'Snow.arc'),
    new MKDDSceneDesc(`Mushroom City`, 'Patapata.arc'),
    new MKDDSceneDesc(`Yoshi Circuit`, 'Yoshi.arc'),
    new MKDDSceneDesc(`DK Mountain`, 'Donkey.arc'),
    "Special Cup",
    new MKDDSceneDesc(`Wario Colosseum`, 'Wario.arc'),
    new MKDDSceneDesc(`Dino Dino Jungle`, 'Diddy.arc'),
    new MKDDSceneDesc(`Bowser's Castle`, 'Koopa.arc'),
    new MKDDSceneDesc(`Rainbow Road`, 'Rainbow.arc'),
    "Battle Courses",
    new MKDDSceneDesc(`Cookie Land`, 'Mini7.arc'),
    new MKDDSceneDesc(`Block City`, 'Mini3.arc'),
    new MKDDSceneDesc(`Luigi's Mansion`, 'Mini1.arc'),
    new MKDDSceneDesc(`Nintendo GameCube`, 'Mini2.arc'),
    new MKDDSceneDesc(`Pipe Plaza`, 'Mini8.arc'),
    new MKDDSceneDesc(`Tilt-a-Kart`, 'Mini5.arc'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
