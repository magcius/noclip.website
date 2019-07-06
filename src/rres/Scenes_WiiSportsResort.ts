
import * as Viewer from "../viewer";
import Progressable, { ProgressMeter } from "../Progressable";
import { GfxDevice, GfxHostAccessPass } from "../gfx/platform/GfxPlatform";
import { fetchData, NamedArrayBufferSlice } from "../fetch";
import * as U8 from "./u8";
import * as Yaz0 from "../compression/Yaz0";
import * as BRRES from "./brres";
import { assertExists, readString, assert } from "../util";
import { BasicGXRendererHelper } from "../gx/gx_render_2";
import { MDL0ModelInstance, MDL0Model, RRESTextureHolder } from "./render";
import AnimationController from "../AnimationController";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { vec3, vec4, mat4 } from "gl-matrix";
import { prepareFrameDebugOverlayCanvas2D, drawWorldSpacePoint } from "../DebugJunk";
import { Magenta, Color, colorNewFromRGBA8, colorNew } from "../Color";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { computeModelMatrixSRT } from "../MathHelpers";

class DataFetcher {
    private fileProgressables: Progressable<any>[] = [];

    constructor(private abortSignal: AbortSignal, private progressMeter: ProgressMeter) {
    }

    private calcProgress(): number {
        let n = 0;
        for (let i = 0; i < this.fileProgressables.length; i++)
            n += this.fileProgressables[i].progress;
        return n / this.fileProgressables.length;
    }

    private setProgress(): void {
        this.progressMeter.setProgress(this.calcProgress());
    }

    public fetchData(path: string): PromiseLike<NamedArrayBufferSlice> {
        const p = fetchData(path, this.abortSignal);
        this.fileProgressables.push(p);
        p.onProgress = () => {
            this.setProgress();
        };
        this.setProgress();
        return p.promise;
    }
}

class ResourceSystem {
    private mounts: U8.U8Archive[] = [];
    private brresCache = new Map<string, BRRES.RRES>();
    private mdl0Cache = new Map<string, MDL0Model>();

    public destroy(device: GfxDevice): void {
        for (const v of this.mdl0Cache.values())
            v.destroy(device);
    }

    public mountArchive(archive: U8.U8Archive): void {
        this.mounts.push(archive);
    }

    public findFileData(path: string): ArrayBufferSlice | null {
        for (let i = 0; i < this.mounts.length; i++) {
            const file = this.mounts[i].findFileData(path);
            if (file !== null)
                return file;
        }
        return null;
    }

    public mountRRES(device: GfxDevice, textureHolder: RRESTextureHolder, path: string): BRRES.RRES {
        if (!this.brresCache.has(path)) {
            const b = BRRES.parse(assertExists(this.findFileData(path)));
            textureHolder.addRRESTextures(device, b);
            this.brresCache.set(path, b);
        }
        return this.brresCache.get(path);
    }

    public mountMDL0(device: GfxDevice, cache: GfxRenderCache, rres: BRRES.RRES, modelName: string): MDL0Model {
        if (!this.mdl0Cache.has(modelName))
            this.mdl0Cache.set(modelName, new MDL0Model(device, cache, assertExists(rres.mdl0.find((m) => m.name === modelName))));
        return this.mdl0Cache.get(modelName);
    }
}

async function fetchCarc(dataFetcher: DataFetcher, path: string): Promise<U8.U8Archive> {
    const d = await dataFetcher.fetchData(path);
    const g = await Yaz0.decompress(d);
    return U8.parse(g);
}

function fetchAndMount(resourceSystem: ResourceSystem, dataFetcher: DataFetcher, paths: string[]): Promise<any> {
    return Promise.all(paths.map((path) => fetchCarc(dataFetcher, path))).then((arcs) => {
        for (let i = 0; i < arcs.length; i++)
            resourceSystem.mountArchive(arcs[i]);
    });
}

interface PMPEntry {
    objectId: number;
    modelMatrix: mat4;
}

function parsePMPF(buffer: ArrayBufferSlice): PMPEntry[] {
    const view = buffer.createDataView();
    assertExists(readString(buffer, 0x00, 0x04) === 'PMPF');

    const tableCount = view.getUint16(0x10);
    const tableStart = view.getUint32(0x40);
    assert(tableStart === 0x80);

    const entries: PMPEntry[] = [];
    let tableIdx = tableStart;
    for (let i = 0; i < tableCount; i++) {
        const objectId = view.getUint32(tableIdx + 0x00);
        assert(view.getUint32(tableIdx + 0x04) === 0);
        const translationX = view.getFloat32(tableIdx + 0x08);
        const translationY = view.getFloat32(tableIdx + 0x0C);
        const translationZ = view.getFloat32(tableIdx + 0x10);
        const scaleX = view.getFloat32(tableIdx + 0x14);
        const scaleY = view.getFloat32(tableIdx + 0x18);
        const scaleZ = view.getFloat32(tableIdx + 0x1C);

        // TODO(jstpierre): Rotation matrix?
        const r00 = view.getFloat32(tableIdx + 0x20);
        const r01 = view.getFloat32(tableIdx + 0x24);
        const r02 = view.getFloat32(tableIdx + 0x28);
        const r10 = view.getFloat32(tableIdx + 0x2C);
        const r11 = view.getFloat32(tableIdx + 0x30);
        const r12 = view.getFloat32(tableIdx + 0x34);
        const r20 = view.getFloat32(tableIdx + 0x38);
        const r21 = view.getFloat32(tableIdx + 0x3C);
        const r22 = view.getFloat32(tableIdx + 0x40);

        const modelMatrix = mat4.fromValues(
            scaleX * r00, scaleX * r10, scaleX * r20, 0,
            scaleY * r01, scaleY * r11, scaleY * r21, 0,
            scaleZ * r02, scaleZ * r12, scaleZ * r22, 0,
            translationX, translationY, translationZ, 1,
        );

        entries.push({ objectId, modelMatrix });
        tableIdx += 0x58;
    }

    return entries;
}

class WS2_Renderer extends BasicGXRendererHelper {
    public animationController = new AnimationController();
    public modelInstances: MDL0ModelInstance[] = [];
    public textureHolder = new RRESTextureHolder();
    public lightSetting = new BRRES.LightSetting();
    public scn0Animator: BRRES.SCN0Animator;

    constructor(device: GfxDevice, private resourceSystem: ResourceSystem) {
        super(device);

        const WS2_Scene = this.resourceSystem.mountRRES(device, this.textureHolder, 'G3D/WS2_Scene.brres');
        this.scn0Animator = new BRRES.SCN0Animator(this.animationController, WS2_Scene.scn0[0]);

        // TODO(jstpierre): Implement EggLightManager
        for (let i = 0; i < this.lightSetting.lightObj.length; i++)
            this.lightSetting.lightObj[i].space = BRRES.LightObjSpace.VIEW_SPACE;
    }

    public mountRRES(device: GfxDevice, rresName: string): BRRES.RRES {
        return this.resourceSystem.mountRRES(device, this.textureHolder, rresName);
    }

    public spawnModel(device: GfxDevice, rres: BRRES.RRES, modelName: string): MDL0ModelInstance {
        // TODO(jstpierre): Cache model data?
        const mdl0Data = this.resourceSystem.mountMDL0(device, this.getCache(), rres, modelName);
        const instance = new MDL0ModelInstance(this.textureHolder, mdl0Data);
        instance.bindRRESAnimations(this.animationController, rres);
        instance.bindLightSetting(this.lightSetting);
        this.modelInstances.push(instance);
        return instance;
    }

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        this.scn0Animator.calcCameraClipPlanes(viewerInput.camera, 0);
        this.scn0Animator.calcLightSetting(this.lightSetting);

        const template = this.renderHelper.pushTemplateRenderInst();
        this.renderHelper.fillSceneParams(viewerInput, template);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, this.renderHelper, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.textureHolder.destroy(device);
        this.resourceSystem.destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}

const dataPath = `WiiSportsResort`;

class IslandSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id) {}

    private spawnObject(device: GfxDevice, renderer: WS2_Renderer, p: PMPEntry): void {
        if (p.objectId === 0x00010000) { // Tree1
            const tree3 = renderer.mountRRES(device, 'Tree/G3D/WS2_common_tree.brres');
            const instance = renderer.spawnModel(device, tree3, 'WS2_common_tree_H');
            mat4.copy(instance.modelMatrix, p.modelMatrix);
        } else if (p.objectId === 0x00010001) { // Tree2
            const tree3 = renderer.mountRRES(device, 'Tree/G3D/WS2_common_tree2.brres');
            const instance = renderer.spawnModel(device, tree3, 'WS2_common_tree2_H');
            mat4.copy(instance.modelMatrix, p.modelMatrix);
        } else if (p.objectId === 0x00010002) { // Tree3
            const tree3 = renderer.mountRRES(device, 'Tree/G3D/WS2_common_tree3.brres');
            const instance = renderer.spawnModel(device, tree3, 'WS2_common_tree3');
            mat4.copy(instance.modelMatrix, p.modelMatrix);
        }
    }

    public async createScene2(device: GfxDevice, abortSignal: AbortSignal, progressMeter: ProgressMeter): Promise<Viewer.SceneGfx> {
        // Fetch the SCN0.
        const d = new DataFetcher(abortSignal, progressMeter);

        const resourceSystem = new ResourceSystem();
        await fetchAndMount(resourceSystem, d, [
            `${dataPath}/Common/Static/common.carc`,
            `${dataPath}/Common/OmkScene/common.carc`,
            `${dataPath}/Stage/Static/StageArc.carc`,
        ]);

        const pmp = parsePMPF(resourceSystem.findFileData('WS2_omk_island_tag.pmp'));
        console.log(pmp);

        const renderer = new WS2_Renderer(device, resourceSystem);
        renderer.mountRRES(device, 'Island/G3D/WS2_common_seatex.brres');
        const island = renderer.mountRRES(device, 'Island/G3D/WS2_common_island.brres');
        renderer.spawnModel(device, island, 'WS2_common_island');
        renderer.spawnModel(device, island, 'WS2_common_vr');
        const sea = renderer.spawnModel(device, island, 'WS2_common_sea');
        sea.bindRRESAnimations(renderer.animationController, island, 'WS2_common_sea_nami');
        sea.bindRRESAnimations(renderer.animationController, island, 'WS2_common_sea_B');

        for (let i = 0; i < pmp.length; i++) {
            this.spawnObject(device, renderer, pmp[i]);
        }

        return renderer;
    }
}

const id = 'WiiSportsResort';
const name = "Wii Sports Resort";

const sceneDescs = [
    new IslandSceneDesc("WuhuIsland", "Wuhu Island"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
