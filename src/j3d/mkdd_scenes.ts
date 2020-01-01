
import * as UI from '../ui';
import * as Viewer from '../viewer';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { readString, assert, assertExists } from '../util';
import { mat4, quat } from 'gl-matrix';
import * as RARC from '../Common/JSYSTEM/JKRArchive';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass, GfxFrontFaceMode } from '../gfx/platform/GfxPlatform';
import { J3DModelInstanceSimple, J3DModelData } from '../Common/JSYSTEM/J3D/J3DGraphBase';
import { BCK, BMD, BTK, BRK, BTP } from '../Common/JSYSTEM/J3D/J3DLoader';
import { SceneContext } from '../SceneBase';
import { computeModelMatrixS } from '../MathHelpers';

const id = "mkdd";
const name = "Mario Kart: Double Dash!!";

class MKDDRenderer implements Viewer.SceneGfx {
    private renderTarget = new BasicRenderTarget();
    public renderHelper: GXRenderHelperGfx;
    public modelInstances: J3DModelInstanceSimple[] = [];
    public rarc: RARC.JKRArchive[] = [];

    constructor(device: GfxDevice) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    private setMirrored(mirror: boolean): void {
        const negScaleMatrix = mat4.create();
        computeModelMatrixS(negScaleMatrix, -1, 1, 1);
        for (let i = 0; i < this.modelInstances.length; i++) {
            mat4.mul(this.modelInstances[i].modelMatrix, negScaleMatrix, this.modelInstances[i].modelMatrix);
            for (let j = 0; j < this.modelInstances[i].materialInstances.length; j++)
                this.modelInstances[i].materialInstances[j].materialHelper.megaStateFlags.frontFace = mirror ? GfxFrontFaceMode.CCW : GfxFrontFaceMode.CW;
        }
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const mirrorCheckbox = new UI.Checkbox('Mirror Courses');
        mirrorCheckbox.onchanged = () => {
            this.setMirrored(mirrorCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(mirrorCheckbox.elem);
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        const layersPanel = new UI.LayerPanel(this.modelInstances);

        return [layersPanel, renderHacksPanel];
    }

    public addModelInstance(scene: J3DModelInstanceSimple): void {
        this.modelInstances.push(scene);
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor);
        this.renderHelper.renderInstManager.drawOnPassRenderer(device, passRenderer);
        this.renderHelper.renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}

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

    private spawnBMD(device: GfxDevice, renderer: MKDDRenderer, rarc: RARC.JKRArchive, basename: string, modelMatrix: mat4 | null = null): J3DModelInstanceSimple {
        const bmdFileData = assertExists(rarc.findFileData(`${basename}.bmd`));
        const bmdModel = new J3DModelData(device, renderer.renderHelper.renderInstManager.gfxRenderCache, BMD.parse(bmdFileData));

        const modelInstance = new J3DModelInstanceSimple(bmdModel);

        const btkFileData = rarc.findFileData(`${basename}.btk`);
        if (btkFileData !== null)
            modelInstance.bindTTK1(BTK.parse(btkFileData));

        const brkFileData = rarc.findFileData(`${basename}.brk`);
        if (brkFileData !== null)
            modelInstance.bindTRK1(BRK.parse(brkFileData));

        const btpFileData = rarc.findFileData(`${basename}.btp`);
        if (btpFileData !== null)
            modelInstance.bindTPT1(BTP.parse(btpFileData));

        modelInstance.name = basename;
        if (modelMatrix !== null)
            mat4.copy(modelInstance.modelMatrix, modelMatrix);

        return modelInstance;
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const path = `j3d/mkdd/Course/${this.path}`;
        return dataFetcher.fetchData(path).then((buffer) => {
            const rarc = RARC.parse(buffer);
            // Find course name.
            const bolFile = assertExists(rarc.files.find((f) => f.name.endsWith('_course.bol')));
            const courseName = bolFile.name.replace('_course.bol', '');

            const renderer = new MKDDRenderer(device);

            if (rarc.findFile(`${courseName}_sky.bmd`))
                renderer.addModelInstance(this.spawnBMD(device, renderer, rarc, `${courseName}_sky`));

            renderer.addModelInstance(this.spawnBMD(device, renderer, rarc, `${courseName}_course`));

            const spawnObject = (obj: Obj, basename: string, animName: string | null = null) => {
                const scene = this.spawnBMD(device, renderer, rarc, basename, obj.modelMatrix);
                renderer.addModelInstance(scene);
                let bckFile;
                if (animName !== null) {
                    bckFile = assertExists(rarc.findFile(animName));
                } else {
                    bckFile = rarc.findFile(`${basename}_wait.bck`);
                }
                if (bckFile !== null) {
                    const bck = BCK.parse(bckFile.buffer);
                    scene.bindANK1(bck);
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

            return renderer;
        });
    }
}

// Courses named and organized by Starschulz
const sceneDescs = [
    "Mushroom Cup",
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
