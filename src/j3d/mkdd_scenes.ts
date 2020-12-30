
import * as UI from '../ui';
import * as Viewer from '../viewer';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { readString, assert, assertExists, bisectRight } from '../util';
import { mat3, mat4, quat, vec3 } from 'gl-matrix';
import * as RARC from '../Common/JSYSTEM/JKRArchive';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass, GfxFrontFaceMode } from '../gfx/platform/GfxPlatform';
import { J3DModelData } from '../Common/JSYSTEM/J3D/J3DGraphBase';
import { J3DModelInstanceSimple } from '../Common/JSYSTEM/J3D/J3DGraphSimple';
import { BCK, BMD, BTK, BRK, BTP, BCA } from '../Common/JSYSTEM/J3D/J3DLoader';
import { SceneContext } from '../SceneBase';
import { computeModelMatrixS, Vec3Zero } from '../MathHelpers';
import { CameraController } from '../Camera';

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

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(200/60);
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
    settings: number[];
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
        const forwardX = view.getInt16(objectTableIdx + 0x18) / 10000;
        const forwardY = view.getInt16(objectTableIdx + 0x1A) / 10000;
        const forwardZ = view.getInt16(objectTableIdx + 0x1C) / 10000;
        const upX = view.getInt16(objectTableIdx + 0x1E) / 10000;
        const upY = view.getInt16(objectTableIdx + 0x20) / 10000;
        const upZ = view.getInt16(objectTableIdx + 0x22) / 10000;
        const id = view.getUint16(objectTableIdx + 0x24);
        const routeId = view.getInt16(objectTableIdx + 0x26);
        const settings = [];

        for (let i = 0; i < 8; i++) {
            settings.push(view.getUint16(objectTableIdx + 0x30 + i * 2));
        }

        // Create rotation
        const forward: vec3 = [forwardX, forwardY, forwardZ];
        const up: vec3 = [upX, upY, upZ];

        vec3.normalize(forward, forward);
        vec3.normalize(up, up);

        const right = vec3.create();
        vec3.cross(right, up, forward);

        const rotationMatrix = mat4.create();

        // NOTE: column by column
        mat4.set(rotationMatrix,
            right[0], right[1], right[2], 0,
            up[0], up[1], up[2], 0,
            forward[0], forward[1], forward[2], 0,
            0, 0, 0, 1);

        // Calculate model matrix
        const translationMatrix = mat4.create();
        mat4.fromTranslation(translationMatrix, [translationX, translationY, translationZ]);

        const scaleMatrix = mat4.create();
        mat4.fromScaling(scaleMatrix, [scaleX, scaleY, scaleZ]);
        
        const modelMatrix = mat4.create();
        mat4.multiply(modelMatrix, rotationMatrix, scaleMatrix);
        mat4.multiply(modelMatrix, translationMatrix, modelMatrix);

        objects.push({ id, routeId, modelMatrix, settings });
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
            const courseName = this.path.replace('.arc', '').toLowerCase();
            
            const renderer = new MKDDRenderer(device);

            const bolFileName = `${courseName}_course.bol`;

            const courseFileName = `${courseName}_course`;
            const courseBTKFilNames = [ `${courseFileName}.btk`, `${courseFileName}_02.btk`, `${courseFileName}__03.btk` ];
            const courseBTPFileName = `${courseFileName}.btp`;
            const courseBRKFileName = `${courseName}.brk`;
            
            const skyFileName = `${courseName}_sky`;
            const skyBTKFileName = `${skyFileName}.btk`;
            const skyBRKFileName = `${skyFileName}.brk`;

            const bolFile = assertExists(rarc.files.find((f) => f.name === bolFileName));

            // Find all course files
            const courseModelInstance = this.spawnBMD(device, renderer, rarc, courseFileName);
            renderer.addModelInstance(courseModelInstance);

            for (const BTKFileName of courseBTKFilNames) {
                const btkFileData = rarc.findFileData(BTKFileName);

                if (btkFileData !== null) {
                    courseModelInstance.bindTTK1(BTK.parse(btkFileData));
                }
            }
    
            const btpFileData = rarc.findFileData(courseBTPFileName);

            if (btpFileData !== null) {
                courseModelInstance.bindTPT1(BTP.parse(btpFileData));
            }

            const brkFileData = rarc.findFileData(courseBRKFileName);

            if (brkFileData !== null) {
                courseModelInstance.bindTRK1(BRK.parse(brkFileData));
            }

            // Find all skybox files
            if (rarc.findFile(`${skyFileName}.bmd`)) {
                const skyModelInstance = this.spawnBMD(device, renderer, rarc, skyFileName);
                renderer.addModelInstance(skyModelInstance);

                const btkFileData = rarc.findFileData(skyBTKFileName);

                if (btkFileData !== null) {
                    skyModelInstance.bindTTK1(BTK.parse(btkFileData));
                }

                const brkFileData = rarc.findFileData(skyBRKFileName);
    
                if (brkFileData !== null) {
                    skyModelInstance.bindTRK1(BRK.parse(brkFileData));
                }
            }

            const spawnObject = (obj: Obj, basename: string, animNames: string[] = []) => {
                const scene = this.spawnBMD(device, renderer, rarc, basename, obj.modelMatrix);
                renderer.addModelInstance(scene);

                // Each object has code which decides what files to load
                // For now just simply load common files

                for (const anim of animNames) {
                    const fileData = assertExists(rarc.findFileData(anim));

                    if (anim.endsWith(".bck")) {
                        const bck = BCK.parse(fileData);
                        scene.bindANK1(bck);
                    }
                    else if (anim.endsWith(".bca")) {
                        const bca = BCA.parse(fileData);
                        scene.bindANF1(bca);
                    }
                    else if (anim.endsWith(".btk")) {
                        const btk = BTK.parse(fileData);
                        scene.bindTTK1(btk);
                    }
                    else if (anim.endsWith(".btp")) {
                        const btp = BTP.parse(fileData);
                        scene.bindTPT1(btp);
                    }
                    else if (anim.endsWith(".brk")) {
                        const brk = BRK.parse(fileData);
                        scene.bindTRK1(brk);
                    }
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
                case 0x0CE8:
                    spawnObject(obj, 'objects/yoshihelib');
                    break;
                case 0x0D49:
                    // Sea.
                    spawnObject(obj, 'objects/sea1_spc');
                    spawnObject(obj, 'objects/sea2_tex');
                    spawnObject(obj, 'objects/sea3_dark');
                    spawnObject(obj, 'objects/sea4_nami');
                    spawnObject(obj, 'objects/sea5_sand');
                    break;
                case 0x0D4A:
                    spawnObject(obj, 'objects/poihana1');
                    break;
                case 0x0D4D:
                    spawnObject(obj, 'objects/peachtree1');
                    break;
                case 0x0D4E:
                    spawnObject(obj, 'objects/peachfountain');
                    break;
                case 0x0D4F:
                    spawnObject(obj, 'objects/marel_a');
                    break;
                case 0x0E75:
                    spawnObject(obj, 'objects/mariotree1');
                    break;
                case 0x0E77:
                    spawnObject(obj, 'objects/marioflower1', ['objects/marioflower1.bck']);
                    break;
                case 0x0E78:
                    // Chain chomp. Looks awful, don't spawn.
                    // spawnObject(obj, 'objects/wanwan1'); break;
                    break;
                case 0x0E7E:
                    spawnObject(obj, 'objects/skyship1');
                    break;
                case 0x0E7F:
                    spawnObject(obj, 'objects/kuribo1');
                    break;
                case 0x0E80:
                    spawnObject(obj, 'objects/pakkun');
                    break;
                case 0x0FA4:
                    spawnObject(obj, 'objects/signal1', ['objects/signal1.brk']);
                    break;
                case 0x1195:
                    //spawnObject(obj, 'objects/cannon1');
                    break;
                case 0x119A:
                    // Butterflies.
                    break;
                case 0x125D:
                    spawnObject(obj, 'objects/dossun1');
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
