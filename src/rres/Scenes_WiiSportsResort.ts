
import * as Viewer from "../viewer";
import Progressable, { ProgressMeter } from "../Progressable";
import { GfxDevice, GfxHostAccessPass } from "../gfx/platform/GfxPlatform";
import { fetchData, NamedArrayBufferSlice } from "../fetch";
import * as U8 from "./u8";
import * as Yaz0 from "../compression/Yaz0";
import * as BRRES from "./brres";
import { assertExists } from "../util";
import { BasicGXRendererHelper } from "../gx/gx_render_2";
import { MDL0ModelInstance, MDL0Model, RRESTextureHolder } from "./render";
import AnimationController from "../AnimationController";
import ArrayBufferSlice from "../ArrayBufferSlice";

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

    public mountArchive(archive: U8.U8Archive): void {
        this.mounts.push(archive);
    }

    private findFileData(path: string): ArrayBufferSlice | null {
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

class WS2_RRESRenderer extends BasicGXRendererHelper {
    public animationController = new AnimationController();
    public modelInstances: MDL0ModelInstance[] = [];
    public models: MDL0Model[] = [];
    public textureHolder = new RRESTextureHolder();
    public lightSetting = new BRRES.LightSetting();
    public scn0Animator: BRRES.SCN0Animator;

    constructor(device: GfxDevice, private resourceSystem: ResourceSystem) {
        super(device);

        const WS2_Scene = this.resourceSystem.mountRRES(device, this.textureHolder, 'G3D/WS2_Scene.brres');
        this.scn0Animator = new BRRES.SCN0Animator(this.animationController, WS2_Scene.scn0[0]);
    }

    public mountRRES(device: GfxDevice, rresName: string): BRRES.RRES {
        return this.resourceSystem.mountRRES(device, this.textureHolder, rresName);
    }

    public spawnModel(device: GfxDevice, rres: BRRES.RRES, modelName: string): MDL0ModelInstance {
        // TODO(jstpierre): Cache model data?
        const mdl0 = assertExists(rres.mdl0.find((mdl0) => mdl0.name === modelName));
        const mdl0Data = new MDL0Model(device, this.getCache(), mdl0);
        this.models.push(mdl0Data);
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
        for (let i = 0; i < this.models.length; i++)
            this.models[i].destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}

const dataPath = `WiiSportsResort`;

class IslandSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id) {}

    public async createScene2(device: GfxDevice, abortSignal: AbortSignal, progressMeter: ProgressMeter): Promise<Viewer.SceneGfx> {
        // Fetch the SCN0.
        const d = new DataFetcher(abortSignal, progressMeter);

        const resourceSystem = new ResourceSystem();
        await fetchAndMount(resourceSystem, d, [
            `${dataPath}/Common/Static/common.carc`,
            `${dataPath}/Stage/Static/StageArc.carc`,
        ]);

        const renderer = new WS2_RRESRenderer(device, resourceSystem);
        renderer.mountRRES(device, 'Island/G3D/WS2_common_seatex.brres');
        const island = renderer.mountRRES(device, 'Island/G3D/WS2_common_island.brres');
        renderer.spawnModel(device, island, 'WS2_common_island');
        renderer.spawnModel(device, island, 'WS2_common_vr');
        const sea = renderer.spawnModel(device, island, 'WS2_common_sea');
        sea.bindRRESAnimations(renderer.animationController, island, 'WS2_common_sea_nami');
        sea.bindRRESAnimations(renderer.animationController, island, 'WS2_common_sea_B');
        return renderer;
    }
}

const id = 'WiiSportsResort';
const name = "Wii Sports Resort";

const sceneDescs = [
    new IslandSceneDesc("WuhuIsland", "Wuhu Island"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
