
import { BMD, BTK } from './j3d';

import * as RARC from './rarc';
import * as Yaz0 from '../yaz0';
import * as GX_Material from 'gx/gx_material';
import * as Viewer from '../viewer';
import { MultiScene, RARCSceneDesc } from './scenes';
import { Scene, ColorOverride } from './render';

import Progressable from 'Progressable';
import { fetch, readString } from '../util';
import { mat4 } from 'gl-matrix';
import ArrayBufferSlice from 'ArrayBufferSlice';

class CameraPos {
    constructor(public x: number, public y: number, public z: number, public lx: number, public ly: number, public lz: number) {}
    public set(m: mat4) {
        mat4.lookAt(m, [this.x, this.y, this.z], [this.lx, this.ly, this.lz], [0, 1, 0]);
    }
}

class WindWakerScene extends MultiScene {
    public roomIdx: number;
    public stageRarc: RARC.RARC;
    public roomRarc: RARC.RARC;

    public model: Scene;
    public model1: Scene;
    public model3: Scene;

    public vr_sky: Scene;
    public vr_uso_umi: Scene;
    public vr_kasumi_mae: Scene;
    public vr_back_cloud: Scene;

    private timeOfDaySelect: HTMLSelectElement;

    static getColorsFromDZS(buffer: ArrayBufferSlice, roomIdx: number, timeOfDay: number) {
        const view = buffer.createDataView();
        const chunkCount = view.getUint32(0x00);

        const chunkOffsets = new Map<string, number>();
        let chunkTableIdx = 0x04;
        for (let i = 0; i < chunkCount; i++) {
            const type = readString(buffer, chunkTableIdx + 0x00, 0x04);
            const offs = view.getUint32(chunkTableIdx + 0x08);
            chunkOffsets.set(type, offs);
            chunkTableIdx += 0x0C;
        }

        const coloIdx = view.getUint8(chunkOffsets.get('EnvR') + (roomIdx * 0x08));
        const coloOffs = chunkOffsets.get('Colo') + (coloIdx * 0x0C);
        const whichPale = timeOfDay;
        const paleIdx = view.getUint8(coloOffs + whichPale);
        const paleOffs = chunkOffsets.get('Pale') + (paleIdx * 0x2C);
        const virtIdx = view.getUint8(paleOffs + 0x21);
        const virtOffs = chunkOffsets.get('Virt') + (virtIdx * 0x24);

        const ambR = view.getUint8(paleOffs + 0x06) / 0xFF;
        const ambG = view.getUint8(paleOffs + 0x07) / 0xFF;
        const ambB = view.getUint8(paleOffs + 0x08) / 0xFF;
        const amb = new GX_Material.Color(ambR, ambG, ambB, 1);

        const lightR = view.getUint8(paleOffs + 0x09) / 0xFF;
        const lightG = view.getUint8(paleOffs + 0x0A) / 0xFF;
        const lightB = view.getUint8(paleOffs + 0x0B) / 0xFF;
        const light = new GX_Material.Color(lightR, lightG, lightB, 1);

        const waveR = view.getUint8(paleOffs + 0x0C) / 0xFF;
        const waveG = view.getUint8(paleOffs + 0x0D) / 0xFF;
        const waveB = view.getUint8(paleOffs + 0x0E) / 0xFF;
        const wave = new GX_Material.Color(waveR, waveG, waveB, 1);

        const oceanR = view.getUint8(paleOffs + 0x0F) / 0xFF;
        const oceanG = view.getUint8(paleOffs + 0x10) / 0xFF;
        const oceanB = view.getUint8(paleOffs + 0x11) / 0xFF;
        const ocean = new GX_Material.Color(oceanR, oceanG, oceanB, 1);

        const splashR = view.getUint8(paleOffs + 0x12) / 0xFF;
        const splashG = view.getUint8(paleOffs + 0x13) / 0xFF;
        const splashB = view.getUint8(paleOffs + 0x14) / 0xFF;
        const splash = new GX_Material.Color(splashR, splashG, splashB, 1);

        const splash2R = view.getUint8(paleOffs + 0x15) / 0xFF;
        const splash2G = view.getUint8(paleOffs + 0x16) / 0xFF;
        const splash2B = view.getUint8(paleOffs + 0x17) / 0xFF;
        const splash2 = new GX_Material.Color(splash2R, splash2G, splash2B, 1);

        const doorsR = view.getUint8(paleOffs + 0x18) / 0xFF;
        const doorsG = view.getUint8(paleOffs + 0x19) / 0xFF;
        const doorsB = view.getUint8(paleOffs + 0x1A) / 0xFF;
        const doors = new GX_Material.Color(doorsR, doorsG, doorsB, 1);

        const vr_back_cloudR = view.getUint8(virtOffs + 0x10) / 0xFF;
        const vr_back_cloudG = view.getUint8(virtOffs + 0x11) / 0xFF;
        const vr_back_cloudB = view.getUint8(virtOffs + 0x12) / 0xFF;
        const vr_back_cloudA = view.getUint8(virtOffs + 0x13) / 0xFF;
        const vr_back_cloud = new GX_Material.Color(vr_back_cloudR, vr_back_cloudG, vr_back_cloudB, vr_back_cloudA);

        const vr_skyR = view.getUint8(virtOffs + 0x18) / 0xFF;
        const vr_skyG = view.getUint8(virtOffs + 0x19) / 0xFF;
        const vr_skyB = view.getUint8(virtOffs + 0x1A) / 0xFF;
        const vr_sky = new GX_Material.Color(vr_skyR, vr_skyG, vr_skyB, 1);

        const vr_uso_umiR = view.getUint8(virtOffs + 0x1B) / 0xFF;
        const vr_uso_umiG = view.getUint8(virtOffs + 0x1C) / 0xFF;
        const vr_uso_umiB = view.getUint8(virtOffs + 0x1D) / 0xFF;
        const vr_uso_umi = new GX_Material.Color(vr_uso_umiR, vr_uso_umiG, vr_uso_umiB, 1);

        const vr_kasumi_maeG = view.getUint8(virtOffs + 0x1F) / 0xFF;
        const vr_kasumi_maeR = view.getUint8(virtOffs + 0x1E) / 0xFF;
        const vr_kasumi_maeB = view.getUint8(virtOffs + 0x20) / 0xFF;
        const vr_kasumi_mae = new GX_Material.Color(vr_kasumi_maeR, vr_kasumi_maeG, vr_kasumi_maeB, 1);

        return { amb, light, wave, ocean, splash, splash2, doors, vr_back_cloud, vr_sky, vr_uso_umi, vr_kasumi_mae };
    }

    private createScene(gl: WebGL2RenderingContext, rarc: RARC.RARC, name: string, isSkybox: boolean): Scene {
        const bdlFile = rarc.findFile(`bdl/${name}.bdl`);
        if (!bdlFile)
            return null;
        const btkFile = rarc.findFile(`btk/${name}.btk`);
        const bdl = BMD.parse(bdlFile.buffer);
        const btk = btkFile ? BTK.parse(btkFile.buffer) : null;
        const scene = new Scene(gl, bdl, btk, null);
        scene.setIsSkybox(isSkybox);
        scene.setUseMaterialTexMtx(false);
        return scene;
    }

    constructor(gl: WebGL2RenderingContext, roomIdx: number, stageRarc: RARC.RARC, roomRarc: RARC.RARC, public cameraPos: CameraPos) {
        super([]);

        this.roomIdx = roomIdx;
        this.stageRarc = stageRarc;
        this.roomRarc = roomRarc;

        const scenes = [];

        // Skybox.
        this.vr_sky = this.createScene(gl, stageRarc, `vr_sky`, true);
        scenes.push(this.vr_sky);
        this.vr_kasumi_mae = this.createScene(gl, stageRarc, `vr_kasumi_mae`, true);
        scenes.push(this.vr_kasumi_mae);
        this.vr_uso_umi = this.createScene(gl, stageRarc, `vr_uso_umi`, true);
        scenes.push(this.vr_uso_umi);
        this.vr_back_cloud = this.createScene(gl, stageRarc, `vr_back_cloud`, true);
        scenes.push(this.vr_back_cloud);

        this.model = this.createScene(gl, roomRarc, `model`, false);
        scenes.push(this.model);

        // Ocean.
        this.model1 = this.createScene(gl, roomRarc, `model1`, false);
        if (this.model1)
            scenes.push(this.model1);

        // Windows / doors.
        this.model3 = this.createScene(gl, roomRarc, `model3`, false);
        if (this.model3)
            scenes.push(this.model3);

        // Noon.
        this.setTimeOfDay(0x02);

        super(scenes);
    }

    public setTimeOfDay(timeOfDay: number) {
        const dzsFile = this.stageRarc.findFile(`dzs/stage.dzs`);
        const colors = WindWakerScene.getColorsFromDZS(dzsFile.buffer, this.roomIdx, timeOfDay);

        this.model.setColorOverride(ColorOverride.K0, colors.light);
        this.model.setColorOverride(ColorOverride.C0, colors.amb);

        if (this.model1) {
            this.model1.setColorOverride(ColorOverride.K0, colors.ocean);
            this.model1.setColorOverride(ColorOverride.C0, colors.wave);
            this.model1.setColorOverride(ColorOverride.C1, colors.splash);
            this.model1.setColorOverride(ColorOverride.K1, colors.splash2);
        }
        if (this.model3)
            this.model3.setColorOverride(ColorOverride.C0, colors.doors);

        this.vr_sky.setColorOverride(ColorOverride.K0, colors.vr_sky);
        this.vr_uso_umi.setColorOverride(ColorOverride.K0, colors.vr_uso_umi);
        this.vr_kasumi_mae.setColorOverride(ColorOverride.C0, colors.vr_kasumi_mae);
        this.vr_back_cloud.setColorOverride(ColorOverride.K0, colors.vr_back_cloud);
        this.vr_back_cloud.setAlphaOverride(ColorOverride.K0, colors.vr_back_cloud.a);
    }

    private _onTimeOfDayChange(e: UIEvent) {
        this.setTimeOfDay(this.timeOfDaySelect.selectedIndex);
    }

    public createUI(): HTMLElement {
        const elem = document.createElement('div');

        this.timeOfDaySelect = document.createElement('select');
        this.timeOfDaySelect.onchange = this._onTimeOfDayChange.bind(this);

        [ 'Dusk', 'Morning', 'Day', 'Afternoon', 'Evening', 'Night' ].forEach((label) => {
            const option = document.createElement('option');
            option.textContent = label;
            this.timeOfDaySelect.appendChild(option);
        });

        this.timeOfDaySelect.selectedIndex = 0x02;
        elem.appendChild(this.timeOfDaySelect);

        return elem;
    }

    public resetCamera(m: mat4) {
        this.cameraPos.set(m);
    }
}

class WindWakerSceneDesc extends RARCSceneDesc {
    public constructor(path, name, public cameraPos: CameraPos) {
        super(path, name);
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        const roomIdx = parseInt(this.path.match(/Room(\d+)/)[1], 10);

        return Progressable.all<ArrayBufferSlice>([
            fetch(`data/j3d/ww/sea/Stage.arc`),
            fetch(this.path),
        ]).then(([stage, room]) => {
            const stageRarc = RARC.parse(Yaz0.decompress(stage));
            const roomRarc = RARC.parse(room);
            return new WindWakerScene(gl, roomIdx, stageRarc, roomRarc, this.cameraPos);
        });
    }
}

const sceneDescs: Viewer.SceneDesc[] = [
    new WindWakerSceneDesc("data/j3d/ww/sea/Room11.arc", "Windfall Island",     new CameraPos(-148, 1760, 7560, -1000, 1000, -5000)),
    new WindWakerSceneDesc("data/j3d/ww/sea/Room13.arc", "Dragon Roost Island", new CameraPos(-8000, 1760, 280, 0, 500, -1000)),
    new WindWakerSceneDesc("data/j3d/ww/sea/Room41.arc", "Forest Haven",        new CameraPos(20000, 1760, -5500, 16000, 1000, 0)),
    new WindWakerSceneDesc("data/j3d/ww/sea/Room44.arc", "Outset Island",       new CameraPos(6000, 6000, 6000, 0, 0, 20000)),
];

const id = "zww";
const name = "The Legend of Zelda: The Wind Waker";

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
