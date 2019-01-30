
import * as Viewer from '../viewer';
import * as PRX from './prx';
import * as TEX from './tex';
import * as SCN from './scn';
import { GfxDevice, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import Progressable from '../Progressable';
import { fetchData } from '../fetch';
import { assert } from '../util';
import { SceneRenderer, SCNData, SCNInstance } from './render';
import { BasicRendererHelper } from '../oot3d/render';

const pathBase = `data/thug2`;

class THUG2Renderer extends BasicRendererHelper implements Viewer.SceneGfx {
    private sceneRenderers: SceneRenderer[] = [];

    constructor(device: GfxDevice, public textureHolder: TEX.TEXTextureHolder) {
        super();
    }

    public addSceneRenderer(device: GfxDevice, sceneRenderer: SceneRenderer): void {
        this.sceneRenderers.push(sceneRenderer);
        sceneRenderer.addToViewRenderer(device, this.viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.sceneRenderers.length; i++)
            this.sceneRenderers[i].prepareToRender(hostAccessPass, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        for (let i = 0; i < this.sceneRenderers.length; i++)
            this.sceneRenderers[i].destroy(device);
        this.textureHolder.destroy(device);
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        return fetchData(`${pathBase}/pre/${this.id}.prx`, abortSignal).then((data) => {
            const prx = PRX.parse(data);
            assert(prx.files.length >= 2);

            const texFile = prx.files[1];
            const tex = TEX.parse(texFile.data);
            const textureHolder = new TEX.TEXTextureHolder();
            textureHolder.addTEX(device, tex);

            const sceneRenderer = new SceneRenderer(device);
            const mainScn = SCN.parse(prx.files[0].data);
            const scnData = new SCNData(device, mainScn);
            const scnInstance = new SCNInstance(device, textureHolder, sceneRenderer.renderInstBuilder, scnData);
            sceneRenderer.scnInstances.push(scnInstance);

            const renderer = new THUG2Renderer(device, textureHolder);
            renderer.addSceneRenderer(device, sceneRenderer);
            return renderer;
        });
    }
}

const id = `thug2`;
const name = "Tony Hawk's Pro Skater (THUGPro Ports)";
const sceneDescs = [
    new SceneDesc(`ALCscn`, `ALC`),
    new SceneDesc(`atlantascn`, `atlanta`),
    new SceneDesc(`burnscn`, `burn`),
    new SceneDesc(`CNVscn`, `CNV`),
    new SceneDesc(`FLscn`, `FL`),
    new SceneDesc(`FOUNscn`, `FOUN`),
    new SceneDesc(`HHscn`, `HH`),
    new SceneDesc(`hischscn`, `hisch`),
    new SceneDesc(`HIscn`, `HI`),
    new SceneDesc(`HNscn`, `HN`),
    new SceneDesc(`HOFscn`, `HOF`),
    new SceneDesc(`JNKscn`, `JNK`),
    new SceneDesc(`KONscn`, `KON`),
    new SceneDesc(`kyotoscn`, `kyoto`),
    new SceneDesc(`LONscn`, `LON`),
    new SceneDesc(`NJscn`, `NJ`),
    new SceneDesc(`NYscn`, `NY`),
    new SceneDesc(`OILscn`, `OIL`),
    new SceneDesc(`Practicescn`, `Practice`),
    new SceneDesc(`RIOscn`, `RIO`),
    new SceneDesc(`rosscn`, `ros`),
    new SceneDesc(`RUscn`, `RU`),
    new SceneDesc(`SC2scn`, `SC2`),
    new SceneDesc(`SCHscn`, `SCH`),
    new SceneDesc(`SDscn`, `SD`),
    new SceneDesc(`SF2scn`, `SF2`),
    new SceneDesc(`SHPscn`, `SHP`),
    new SceneDesc(`SIscn`, `SI`),
    new SceneDesc(`SJscn`, `SJ`),
    new SceneDesc(`sk5ed10_shellscn`, `sk5ed10_shell`),
    new SceneDesc(`sk5ed11_shellscn`, `sk5ed11_shell`),
    new SceneDesc(`sk5ed12_shellscn`, `sk5ed12_shell`),
    new SceneDesc(`sk5ed13_shellscn`, `sk5ed13_shell`),
    new SceneDesc(`sk5ed14_shellscn`, `sk5ed14_shell`),
    new SceneDesc(`sk5ed15_shellscn`, `sk5ed15_shell`),
    new SceneDesc(`sk5ed16_shellscn`, `sk5ed16_shell`),
    new SceneDesc(`sk5ed17_shellscn`, `sk5ed17_shell`),
    new SceneDesc(`sk5ed6_shellscn`, `sk5ed6_shell`),
    new SceneDesc(`sk5ed7_shellscn`, `sk5ed7_shell`),
    new SceneDesc(`sk5ed8_shellscn`, `sk5ed8_shell`),
    new SceneDesc(`sk5ed9_shellscn`, `sk5ed9_shell`),
    new SceneDesc(`skateparkscn`, `skatepark`),
    new SceneDesc(`Skateshopscn`, `Skateshop`),
    new SceneDesc(`SUBscn`, `SUB`),
    new SceneDesc(`SZscn`, `SZ`),
    new SceneDesc(`thugpro_sk5edscn`, `thugpro_sk5ed`),
    new SceneDesc(`TOKscn`, `TOK`),
    new SceneDesc(`toystory_bedroomscn`, `toystory_bedroom`),
    new SceneDesc(`TRscn_thugpro`, `TRscn_thugpro`),
    new SceneDesc(`VANSscn`, `VANS`),
    new SceneDesc(`VCscn`, `VC`),
    new SceneDesc(`VNscn`, `VN`),
    new SceneDesc(`warescn`, `ware`),
    new SceneDesc(`z_centerscn`, `z_center`),
    new SceneDesc(`z_dnscn`, `z_dn`),
    new SceneDesc(`Z_ELscn`, `Z_EL`),
    new SceneDesc(`z_funparkscn`, `z_funpark`),
    new SceneDesc(`z_msscn`, `z_ms`),
    new SceneDesc(`z_riodscn`, `z_riod`),
    new SceneDesc(`Z_SMscn`, `Z_SM`),
    new SceneDesc(`ZOOscn`, `ZOO`),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
