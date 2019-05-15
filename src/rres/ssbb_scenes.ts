
import * as Viewer from '../viewer';
import * as BRRES from './brres';
import * as CX from "../compression/CX";
import * as UI from '../ui';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, align } from "../util";
import { GfxDevice, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import Progressable from '../Progressable';
import { fetchData } from '../fetch';
import { RRESTextureHolder, MDL0Model, MDL0ModelInstance } from './render';
import { BasicRendererHelper } from '../oot3d/render';
import { GXRenderHelperGfx } from '../gx/gx_render';
import AnimationController from '../AnimationController';
import { GXMaterialHacks } from '../gx/gx_material';

interface ARCFileEntry {
    fileType: number;
    index: number;
    data: ArrayBufferSlice;
}

interface ARC {
    name: string;
    files: ARCFileEntry[];
}

function parseARC(buffer: ArrayBufferSlice): ARC {
    const magic = readString(buffer, 0x00, 0x06, false);
    assert(magic === 'ARC\x00\x01\x01');

    const view = buffer.createDataView();
    const numFiles = view.getUint16(0x06);
    const name = readString(buffer, 0x10, 0x30, true);

    const files: ARCFileEntry[] = [];
    let fileTableIdx = 0x40;
    for (let i = 0; i < numFiles; i++) {
        const fileType = view.getUint16(fileTableIdx + 0x00);
        const index = view.getUint16(fileTableIdx + 0x02);
        const size = view.getUint32(fileTableIdx + 0x04);
        const data = buffer.subarray(fileTableIdx + 0x20, size);

        files.push({ fileType, index, data });
        fileTableIdx += 0x20 + size;
        fileTableIdx = align(fileTableIdx, 0x20);
    }

    return { name, files };
}

const materialHacks: GXMaterialHacks = {
    lightingFudge: (p) => `(0.5 * (${p.ambSource} + 0.2) * ${p.matSource})`,
};

class BrawlRenderer extends BasicRendererHelper {
    private modelInstances: MDL0ModelInstance[] = [];
    private models: MDL0Model[] = [];

    public renderHelper: GXRenderHelperGfx;
    private animationController: AnimationController;

    constructor(device: GfxDevice, public stageRRESes: BRRES.RRES[], public textureHolder = new RRESTextureHolder()) {
        super();

        this.renderHelper = new GXRenderHelperGfx(device);

        this.animationController = new AnimationController();

        for (let i = 0; i < stageRRESes.length; i++) {
            const stageRRES = stageRRESes[i];
            textureHolder.addRRESTextures(device, stageRRES);
            if (stageRRES.mdl0.length === 0)
                continue;

            const model = new MDL0Model(device, this.renderHelper, stageRRES.mdl0[0], materialHacks);
            this.models.push(model);
            const modelRenderer = new MDL0ModelInstance(device, this.renderHelper, this.textureHolder, model);
            this.modelInstances.push(modelRenderer);

            modelRenderer.bindRRESAnimations(this.animationController, stageRRES);
        }

        this.renderHelper.finishBuilder(device, this.viewRenderer);
    }

    public createPanels(): UI.Panel[] {
        const panels: UI.Panel[] = [];

        if (this.modelInstances.length > 1) {
            const layersPanel = new UI.LayerPanel();
            layersPanel.setLayers(this.modelInstances);
            panels.push(layersPanel);
        }

        return panels;
    }

    protected prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);
        viewerInput.camera.setClipPlanes(20, 500000);
        this.renderHelper.fillSceneParams(viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);

        this.textureHolder.destroy(device);
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.models.length; i++)
            this.models[i].destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}

class BrawlSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        return fetchData(`ssbb/stage/${this.id}`, abortSignal).then((buffer: ArrayBufferSlice) => {
            const textureHolder = new RRESTextureHolder();

            const arc = parseARC(buffer);
            assert(arc.files.length >= 2);

            // Second archive is a compressed archive full of stage render data.
            const stageARC = parseARC(CX.decompress(arc.files[1].data));

            // Look for the texture archive, and load that.
            const textureFile = stageARC.files.find((arc) => arc.fileType === 0x03);
            if (textureFile !== undefined) {
                const textureRRES = BRRES.parse(textureFile.data);
                textureHolder.addRRESTextures(device, textureRRES);
            }

            // Now look for the models.
            const stageRRESes = stageARC.files.filter((file) => file.fileType === 0x02).map((file) => {
                return BRRES.parse(file.data);
            });
            console.log(stageARC, stageRRESes);

            return new BrawlRenderer(device, stageRRESes, textureHolder);
        });
    }
}

const id = 'ssbb';
const name = "Super Smash Bros. Brawl";
const sceneDescs = [
    "Battle Stages",
    new BrawlSceneDesc('melee/STGDXGREENS.PAC', 'melee/STGDXGREENS'),
    new BrawlSceneDesc('melee/STGRESULT_en.PAC', 'melee/STGRESULT_en'),
    new BrawlSceneDesc('melee/STGDXGARDEN.PAC', 'melee/STGDXGARDEN'),
    new BrawlSceneDesc('melee/STGPICTCHAT_en.PAC', 'melee/STGPICTCHAT_en'),
    new BrawlSceneDesc('melee/STGDXYORSTER.PAC', 'melee/STGDXYORSTER'),
    new BrawlSceneDesc('melee/STGPLANKTON.PAC', 'melee/STGPLANKTON'),
    new BrawlSceneDesc('melee/STGEMBLEM.PAC', 'melee/STGEMBLEM'),
    new BrawlSceneDesc('melee/STGFAMICOM.PAC', 'melee/STGFAMICOM'),
    new BrawlSceneDesc('melee/STGDONKEY.PAC', 'melee/STGDONKEY'),
    new BrawlSceneDesc('melee/STGCONFIGTEST.PAC', 'melee/STGCONFIGTEST'),
    new BrawlSceneDesc('melee/STGONLINETRAINING.PAC', 'melee/STGONLINETRAINING'),
    new BrawlSceneDesc('melee/STGEMBLEM_02.PAC', 'melee/STGEMBLEM_02'),
    new BrawlSceneDesc('melee/STGEMBLEM_01.PAC', 'melee/STGEMBLEM_01'),
    new BrawlSceneDesc('melee/STGEMBLEM_00.PAC', 'melee/STGEMBLEM_00'),
    new BrawlSceneDesc('melee/STGCHARAROLL.PAC', 'melee/STGCHARAROLL'),
    new BrawlSceneDesc('melee/STGNEWPORK_en.PAC', 'melee/STGNEWPORK_en'),
    new BrawlSceneDesc('melee/STGSTADIUM_en.PAC', 'melee/STGSTADIUM_en'),
    new BrawlSceneDesc('melee/STGICE.PAC', 'melee/STGICE'),
    new BrawlSceneDesc('melee/STGHALBERD.PAC', 'melee/STGHALBERD'),
    new BrawlSceneDesc('melee/STGFZERO.PAC', 'melee/STGFZERO'),
    new BrawlSceneDesc('melee/STGEARTH.PAC', 'melee/STGEARTH'),
    new BrawlSceneDesc('melee/STGSTARFOX_BATTLESHIP.PAC', 'melee/STGSTARFOX_BATTLESHIP'),
    new BrawlSceneDesc('melee/STGMETALGEAR_01.PAC', 'melee/STGMETALGEAR_01'),
    new BrawlSceneDesc('melee/STGSTARFOX_CORNERIA.PAC', 'melee/STGSTARFOX_CORNERIA'),
    new BrawlSceneDesc('melee/STGDOLPIC.PAC', 'melee/STGDOLPIC'),
    new BrawlSceneDesc('melee/STGFINAL.PAC', 'melee/STGFINAL'),
    new BrawlSceneDesc('melee/STGTENGAN_3.PAC', 'melee/STGTENGAN_3'),
    new BrawlSceneDesc('melee/STGMETALGEAR_02.PAC', 'melee/STGMETALGEAR_02'),
    new BrawlSceneDesc('melee/STGTENGAN_1.PAC', 'melee/STGTENGAN_1'),
    new BrawlSceneDesc('melee/STGTENGAN_2.PAC', 'melee/STGTENGAN_2'),
    new BrawlSceneDesc('melee/STGMETALGEAR_00.PAC', 'melee/STGMETALGEAR_00'),
    new BrawlSceneDesc('melee/STGJUNGLE.PAC', 'melee/STGJUNGLE'),
    new BrawlSceneDesc('melee/STGBATTLEFIELD.PAC', 'melee/STGBATTLEFIELD'),
    new BrawlSceneDesc('melee/STGORPHEON.PAC', 'melee/STGORPHEON'),
    new BrawlSceneDesc('melee/STGTARGETLV1.PAC', 'melee/STGTARGETLV1'),
    new BrawlSceneDesc('melee/STGOLDIN.PAC', 'melee/STGOLDIN'),
    new BrawlSceneDesc('melee/STGPALUTENA.PAC', 'melee/STGPALUTENA'),
    new BrawlSceneDesc('melee/STGTARGETLv3.PAC', 'melee/STGTARGETLv3'),
    new BrawlSceneDesc('melee/STGSTARFOX_SPACE.PAC', 'melee/STGSTARFOX_SPACE'),
    new BrawlSceneDesc('melee/STGDXPSTADIUM_en.PAC', 'melee/STGDXPSTADIUM_en'),
    new BrawlSceneDesc('melee/STGMANSION.PAC', 'melee/STGMANSION'),
    new BrawlSceneDesc('melee/STGVILLAGE_02_en.PAC', 'melee/STGVILLAGE_02_en'),
    new BrawlSceneDesc('melee/STGVILLAGE_04_en.PAC', 'melee/STGVILLAGE_04_en'),
    new BrawlSceneDesc('melee/STGVILLAGE_00_en.PAC', 'melee/STGVILLAGE_00_en'),
    new BrawlSceneDesc('melee/STGVILLAGE_01_en.PAC', 'melee/STGVILLAGE_01_en'),
    new BrawlSceneDesc('melee/STGVILLAGE_03_en.PAC', 'melee/STGVILLAGE_03_en'),
    new BrawlSceneDesc('melee/STGDXBIGBLUE.PAC', 'melee/STGDXBIGBLUE'),
    new BrawlSceneDesc('melee/STGTARGETLv5.PAC', 'melee/STGTARGETLv5'),
    new BrawlSceneDesc('melee/STGSTARFOX_ASTEROID.PAC', 'melee/STGSTARFOX_ASTEROID'),
    new BrawlSceneDesc('melee/STGPIRATES.PAC', 'melee/STGPIRATES'),
    new BrawlSceneDesc('melee/STGEDIT_0.PAC', 'melee/STGEDIT_0'),
    new BrawlSceneDesc('melee/STGHOMERUN_en.PAC', 'melee/STGHOMERUN_en'),
    new BrawlSceneDesc('melee/STGCRAYON.PAC', 'melee/STGCRAYON'),
    new BrawlSceneDesc('melee/STGHOMERUN.PAC', 'melee/STGHOMERUN'),
    new BrawlSceneDesc('melee/STGMARIOPAST_00.PAC', 'melee/STGMARIOPAST_00'),
    new BrawlSceneDesc('melee/STGDXCORNERIA.PAC', 'melee/STGDXCORNERIA'),
    new BrawlSceneDesc('melee/STGNORFAIR.PAC', 'melee/STGNORFAIR'),
    new BrawlSceneDesc('melee/STGGREENHILL.PAC', 'melee/STGGREENHILL'),
    new BrawlSceneDesc('melee/STGEDIT_1.PAC', 'melee/STGEDIT_1'),
    new BrawlSceneDesc('melee/STGSTARFOX_GDIFF.PAC', 'melee/STGSTARFOX_GDIFF'),
    new BrawlSceneDesc('melee/STGMARIOPAST_01.PAC', 'melee/STGMARIOPAST_01'),
    new BrawlSceneDesc('melee/STGTARGETLV2.PAC', 'melee/STGTARGETLV2'),
    new BrawlSceneDesc('melee/STGMADEIN_en.PAC', 'melee/STGMADEIN_en'),
    new BrawlSceneDesc('melee/STGEDIT_2.PAC', 'melee/STGEDIT_2'),
    new BrawlSceneDesc('melee/STGKART.PAC', 'melee/STGKART'),
    new BrawlSceneDesc('melee/STGGW.PAC', 'melee/STGGW'),
    new BrawlSceneDesc('melee/STGGW_en.PAC', 'melee/STGGW_en'),
    new BrawlSceneDesc('melee/STGTARGETLv4.PAC', 'melee/STGTARGETLv4'),
    new BrawlSceneDesc('melee/STGHEAL.PAC', 'melee/STGHEAL'),
    new BrawlSceneDesc('melee/STGDXZEBES.PAC', 'melee/STGDXZEBES'),
    new BrawlSceneDesc('melee/STGDXONETT.PAC', 'melee/STGDXONETT'),
    new BrawlSceneDesc('melee/STGDXONETT_en.PAC', 'melee/STGDXONETT_en'),
    new BrawlSceneDesc('melee/STGDXSHRINE.PAC', 'melee/STGDXSHRINE'),
    new BrawlSceneDesc('melee/STGDXRCRUISE.PAC', 'melee/STGDXRCRUISE'),
    "Subspace Emissiary",
    new BrawlSceneDesc('adventure/040101.pac', 'adventure/040101.pac'),
    new BrawlSceneDesc('adventure/040201.pac', 'adventure/040201.pac'),
    new BrawlSceneDesc('adventure/040201a.pac', 'adventure/040201a.pac'),
    new BrawlSceneDesc('adventure/050001.pac', 'adventure/050001.pac'),
    new BrawlSceneDesc('adventure/050102.pac', 'adventure/050102.pac'),
    new BrawlSceneDesc('adventure/050102a.pac', 'adventure/050102a.pac'),
    new BrawlSceneDesc('adventure/050103.pac', 'adventure/050103.pac'),
    new BrawlSceneDesc('adventure/060001.pac', 'adventure/060001.pac'),
    new BrawlSceneDesc('adventure/060002.pac', 'adventure/060002.pac'),
    new BrawlSceneDesc('adventure/060002a.pac', 'adventure/060002a.pac'),
    new BrawlSceneDesc('adventure/060003.pac', 'adventure/060003.pac'),
    new BrawlSceneDesc('adventure/060004.pac', 'adventure/060004.pac'),
    new BrawlSceneDesc('adventure/060004a.pac', 'adventure/060004a.pac'),
    new BrawlSceneDesc('adventure/070001.pac', 'adventure/070001.pac'),
    new BrawlSceneDesc('adventure/070001a.pac', 'adventure/070001a.pac'),
    new BrawlSceneDesc('adventure/070002.pac', 'adventure/070002.pac'),
    new BrawlSceneDesc('adventure/080001.pac', 'adventure/080001.pac'),
    new BrawlSceneDesc('adventure/080101.pac', 'adventure/080101.pac'),
    new BrawlSceneDesc('adventure/080102.pac', 'adventure/080102.pac'),
    new BrawlSceneDesc('adventure/080103.pac', 'adventure/080103.pac'),
    new BrawlSceneDesc('adventure/080103a.pac', 'adventure/080103a.pac'),
    new BrawlSceneDesc('adventure/080103b.pac', 'adventure/080103b.pac'),
    new BrawlSceneDesc('adventure/080104.pac', 'adventure/080104.pac'),
    new BrawlSceneDesc('adventure/080104a.pac', 'adventure/080104a.pac'),
    new BrawlSceneDesc('adventure/080104b.pac', 'adventure/080104b.pac'),
    new BrawlSceneDesc('adventure/080105.pac', 'adventure/080105.pac'),
    new BrawlSceneDesc('adventure/080105a.pac', 'adventure/080105a.pac'),
    new BrawlSceneDesc('adventure/080201.pac', 'adventure/080201.pac'),
    new BrawlSceneDesc('adventure/080301.pac', 'adventure/080301.pac'),
    new BrawlSceneDesc('adventure/090001.pac', 'adventure/090001.pac'),
    new BrawlSceneDesc('adventure/090101.pac', 'adventure/090101.pac'),
    new BrawlSceneDesc('adventure/090201.pac', 'adventure/090201.pac'),
    new BrawlSceneDesc('adventure/090202.pac', 'adventure/090202.pac'),
    new BrawlSceneDesc('adventure/090203.pac', 'adventure/090203.pac'),
    new BrawlSceneDesc('adventure/090203a.pac', 'adventure/090203a.pac'),
    new BrawlSceneDesc('adventure/100001.pac', 'adventure/100001.pac'),
    new BrawlSceneDesc('adventure/100001a.pac', 'adventure/100001a.pac'),
    new BrawlSceneDesc('adventure/100002.pac', 'adventure/100002.pac'),
    new BrawlSceneDesc('adventure/100101.pac', 'adventure/100101.pac'),
    new BrawlSceneDesc('adventure/100201.pac', 'adventure/100201.pac'),
    new BrawlSceneDesc('adventure/100202.pac', 'adventure/100202.pac'),
    new BrawlSceneDesc('adventure/100202a.pac', 'adventure/100202a.pac'),
    new BrawlSceneDesc('adventure/100203.pac', 'adventure/100203.pac'),
    new BrawlSceneDesc('adventure/100205.pac', 'adventure/100205.pac'),
    new BrawlSceneDesc('adventure/120001.pac', 'adventure/120001.pac'),
    new BrawlSceneDesc('adventure/120001a.pac', 'adventure/120001a.pac'),
    new BrawlSceneDesc('adventure/120002.pac', 'adventure/120002.pac'),
    new BrawlSceneDesc('adventure/120003.pac', 'adventure/120003.pac'),
    new BrawlSceneDesc('adventure/140001.pac', 'adventure/140001.pac'),
    new BrawlSceneDesc('adventure/140005.pac', 'adventure/140005.pac'),
    new BrawlSceneDesc('adventure/140101.pac', 'adventure/140101.pac'),
    new BrawlSceneDesc('adventure/140102.pac', 'adventure/140102.pac'),
    new BrawlSceneDesc('adventure/140103.pac', 'adventure/140103.pac'),
    new BrawlSceneDesc('adventure/140104.pac', 'adventure/140104.pac'),
    new BrawlSceneDesc('adventure/140105.pac', 'adventure/140105.pac'),
    new BrawlSceneDesc('adventure/140106.pac', 'adventure/140106.pac'),
    new BrawlSceneDesc('adventure/160001.pac', 'adventure/160001.pac'),
    new BrawlSceneDesc('adventure/160002.pac', 'adventure/160002.pac'),
    new BrawlSceneDesc('adventure/160101.pac', 'adventure/160101.pac'),
    new BrawlSceneDesc('adventure/160102.pac', 'adventure/160102.pac'),
    new BrawlSceneDesc('adventure/160201.pac', 'adventure/160201.pac'),
    new BrawlSceneDesc('adventure/160202.pac', 'adventure/160202.pac'),
    new BrawlSceneDesc('adventure/160301.pac', 'adventure/160301.pac'),
    new BrawlSceneDesc('adventure/160301a.pac', 'adventure/160301a.pac'),
    new BrawlSceneDesc('adventure/160301b.pac', 'adventure/160301b.pac'),
    new BrawlSceneDesc('adventure/160301c.pac', 'adventure/160301c.pac'),
    new BrawlSceneDesc('adventure/180001.pac', 'adventure/180001.pac'),
    new BrawlSceneDesc('adventure/180001a.pac', 'adventure/180001a.pac'),
    new BrawlSceneDesc('adventure/180002.pac', 'adventure/180002.pac'),
    new BrawlSceneDesc('adventure/180003.pac', 'adventure/180003.pac'),
    new BrawlSceneDesc('adventure/180101.pac', 'adventure/180101.pac'),
    new BrawlSceneDesc('adventure/200001.pac', 'adventure/200001.pac'),
    new BrawlSceneDesc('adventure/200001a.pac', 'adventure/200001a.pac'),
    new BrawlSceneDesc('adventure/200002.pac', 'adventure/200002.pac'),
    new BrawlSceneDesc('adventure/200003.pac', 'adventure/200003.pac'),
    new BrawlSceneDesc('adventure/200003a.pac', 'adventure/200003a.pac'),
    new BrawlSceneDesc('adventure/220001.pac', 'adventure/220001.pac'),
    new BrawlSceneDesc('adventure/220002.pac', 'adventure/220002.pac'),
    new BrawlSceneDesc('adventure/220002a.pac', 'adventure/220002a.pac'),
    new BrawlSceneDesc('adventure/220003.pac', 'adventure/220003.pac'),
    new BrawlSceneDesc('adventure/220003a.pac', 'adventure/220003a.pac'),
    new BrawlSceneDesc('adventure/220101.pac', 'adventure/220101.pac'),
    new BrawlSceneDesc('adventure/240001.pac', 'adventure/240001.pac'),
    new BrawlSceneDesc('adventure/240001a.pac', 'adventure/240001a.pac'),
    new BrawlSceneDesc('adventure/240002.pac', 'adventure/240002.pac'),
    new BrawlSceneDesc('adventure/240002a.pac', 'adventure/240002a.pac'),
    new BrawlSceneDesc('adventure/240002b.pac', 'adventure/240002b.pac'),
    new BrawlSceneDesc('adventure/240101.pac', 'adventure/240101.pac'),
    new BrawlSceneDesc('adventure/250001.pac', 'adventure/250001.pac'),
    new BrawlSceneDesc('adventure/260001.pac', 'adventure/260001.pac'),
    new BrawlSceneDesc('adventure/260001a.pac', 'adventure/260001a.pac'),
    new BrawlSceneDesc('adventure/260002.pac', 'adventure/260002.pac'),
    new BrawlSceneDesc('adventure/270001.pac', 'adventure/270001.pac'),
    new BrawlSceneDesc('adventure/270002.pac', 'adventure/270002.pac'),
    new BrawlSceneDesc('adventure/270002a.pac', 'adventure/270002a.pac'),
    new BrawlSceneDesc('adventure/270101.pac', 'adventure/270101.pac'),
    new BrawlSceneDesc('adventure/270201.pac', 'adventure/270201.pac'),
    new BrawlSceneDesc('adventure/270202.pac', 'adventure/270202.pac'),
    new BrawlSceneDesc('adventure/270202a.pac', 'adventure/270202a.pac'),
    new BrawlSceneDesc('adventure/270203.pac', 'adventure/270203.pac'),
    new BrawlSceneDesc('adventure/280002.pac', 'adventure/280002.pac'),
    new BrawlSceneDesc('adventure/280002a.pac', 'adventure/280002a.pac'),
    new BrawlSceneDesc('adventure/280003.pac', 'adventure/280003.pac'),
    new BrawlSceneDesc('adventure/280101.pac', 'adventure/280101.pac'),
    new BrawlSceneDesc('adventure/280201.pac', 'adventure/280201.pac'),
    new BrawlSceneDesc('adventure/280202.pac', 'adventure/280202.pac'),
    new BrawlSceneDesc('adventure/280202a.pac', 'adventure/280202a.pac'),
    new BrawlSceneDesc('adventure/280203.pac', 'adventure/280203.pac'),
    new BrawlSceneDesc('adventure/280204.pac', 'adventure/280204.pac'),
    new BrawlSceneDesc('adventure/280301.pac', 'adventure/280301.pac'),
    new BrawlSceneDesc('adventure/290001.pac', 'adventure/290001.pac'),
    new BrawlSceneDesc('adventure/290001a.pac', 'adventure/290001a.pac'),
    new BrawlSceneDesc('adventure/290001b.pac', 'adventure/290001b.pac'),
    new BrawlSceneDesc('adventure/300001.pac', 'adventure/300001.pac'),
    new BrawlSceneDesc('adventure/310001.pac', 'adventure/310001.pac'),
    new BrawlSceneDesc('adventure/310002.pac', 'adventure/310002.pac'),
    new BrawlSceneDesc('adventure/310003.pac', 'adventure/310003.pac'),
    new BrawlSceneDesc('adventure/310003a.pac', 'adventure/310003a.pac'),
    new BrawlSceneDesc('adventure/310003b.pac', 'adventure/310003b.pac'),
    new BrawlSceneDesc('adventure/310101.pac', 'adventure/310101.pac'),
    new BrawlSceneDesc('adventure/320001.pac', 'adventure/320001.pac'),
    new BrawlSceneDesc('adventure/330001.pac', 'adventure/330001.pac'),
    new BrawlSceneDesc('adventure/330002.pac', 'adventure/330002.pac'),
    new BrawlSceneDesc('adventure/330002a.pac', 'adventure/330002a.pac'),
    new BrawlSceneDesc('adventure/330101.pac', 'adventure/330101.pac'),
    new BrawlSceneDesc('adventure/330101a.pac', 'adventure/330101a.pac'),
    new BrawlSceneDesc('adventure/330102.pac', 'adventure/330102.pac'),
    new BrawlSceneDesc('adventure/330103.pac', 'adventure/330103.pac'),
    new BrawlSceneDesc('adventure/330104.pac', 'adventure/330104.pac'),
    new BrawlSceneDesc('adventure/330201.pac', 'adventure/330201.pac'),
    new BrawlSceneDesc('adventure/340001.pac', 'adventure/340001.pac'),
    new BrawlSceneDesc('adventure/340002.pac', 'adventure/340002.pac'),
    new BrawlSceneDesc('adventure/340003.pac', 'adventure/340003.pac'),
    new BrawlSceneDesc('adventure/340004.pac', 'adventure/340004.pac'),
    new BrawlSceneDesc('adventure/340005.pac', 'adventure/340005.pac'),
    new BrawlSceneDesc('adventure/350001.pac', 'adventure/350001.pac'),
    new BrawlSceneDesc('adventure/360001.pac', 'adventure/360001.pac'),
    new BrawlSceneDesc('adventure/360001a.pac', 'adventure/360001a.pac'),
    new BrawlSceneDesc('adventure/360001b.pac', 'adventure/360001b.pac'),
    new BrawlSceneDesc('adventure/360001c.pac', 'adventure/360001c.pac'),
    new BrawlSceneDesc('adventure/360002.pac', 'adventure/360002.pac'),
    new BrawlSceneDesc('adventure/370001.pac', 'adventure/370001.pac'),
    new BrawlSceneDesc('adventure/370001a.pac', 'adventure/370001a.pac'),
    new BrawlSceneDesc('adventure/370002.pac', 'adventure/370002.pac'),
    new BrawlSceneDesc('adventure/370002a.pac', 'adventure/370002a.pac'),
    new BrawlSceneDesc('adventure/370003.pac', 'adventure/370003.pac'),
    new BrawlSceneDesc('adventure/370101.pac', 'adventure/370101.pac'),
    new BrawlSceneDesc('adventure/370201.pac', 'adventure/370201.pac'),
    new BrawlSceneDesc('adventure/370202.pac', 'adventure/370202.pac'),
    new BrawlSceneDesc('adventure/370203.pac', 'adventure/370203.pac'),
    new BrawlSceneDesc('adventure/370301.pac', 'adventure/370301.pac'),
    new BrawlSceneDesc('adventure/390001.pac', 'adventure/390001.pac'),
    new BrawlSceneDesc('adventure/400001.pac', 'adventure/400001.pac'),
    new BrawlSceneDesc('adventure/400002.pac', 'adventure/400002.pac'),
    new BrawlSceneDesc('adventure/400003.pac', 'adventure/400003.pac'),
    new BrawlSceneDesc('adventure/400004.pac', 'adventure/400004.pac'),
    new BrawlSceneDesc('adventure/400005.pac', 'adventure/400005.pac'),
    new BrawlSceneDesc('adventure/400006.pac', 'adventure/400006.pac'),
    new BrawlSceneDesc('adventure/400007.pac', 'adventure/400007.pac'),
    new BrawlSceneDesc('adventure/400008.pac', 'adventure/400008.pac'),
    new BrawlSceneDesc('adventure/400009.pac', 'adventure/400009.pac'),
    new BrawlSceneDesc('adventure/400101.pac', 'adventure/400101.pac'),
    new BrawlSceneDesc('adventure/410001.pac', 'adventure/410001.pac'),
    new BrawlSceneDesc('adventure/410002.pac', 'adventure/410002.pac'),
    new BrawlSceneDesc('adventure/410003.pac', 'adventure/410003.pac'),
    new BrawlSceneDesc('adventure/420001a.pac', 'adventure/420001a.pac'),
    new BrawlSceneDesc('adventure/420001b.pac', 'adventure/420001b.pac'),
    new BrawlSceneDesc('adventure/420001c.pac', 'adventure/420001c.pac'),
    new BrawlSceneDesc('adventure/420001d.pac', 'adventure/420001d.pac'),
    new BrawlSceneDesc('adventure/420002a.pac', 'adventure/420002a.pac'),
    new BrawlSceneDesc('adventure/420002b.pac', 'adventure/420002b.pac'),
    new BrawlSceneDesc('adventure/420002c.pac', 'adventure/420002c.pac'),
    new BrawlSceneDesc('adventure/420002d.pac', 'adventure/420002d.pac'),
    new BrawlSceneDesc('adventure/420002e.pac', 'adventure/420002e.pac'),
    new BrawlSceneDesc('adventure/420003a.pac', 'adventure/420003a.pac'),
    new BrawlSceneDesc('adventure/420005a.pac', 'adventure/420005a.pac'),
    new BrawlSceneDesc('adventure/420005b.pac', 'adventure/420005b.pac'),
    new BrawlSceneDesc('adventure/420005c.pac', 'adventure/420005c.pac'),
    new BrawlSceneDesc('adventure/420007a.pac', 'adventure/420007a.pac'),
    new BrawlSceneDesc('adventure/420007b.pac', 'adventure/420007b.pac'),
    new BrawlSceneDesc('adventure/420007c.pac', 'adventure/420007c.pac'),
    new BrawlSceneDesc('adventure/420009a.pac', 'adventure/420009a.pac'),
    new BrawlSceneDesc('adventure/420009b.pac', 'adventure/420009b.pac'),
    new BrawlSceneDesc('adventure/420009c.pac', 'adventure/420009c.pac'),
    new BrawlSceneDesc('adventure/420011a.pac', 'adventure/420011a.pac'),
    new BrawlSceneDesc('adventure/420013a.pac', 'adventure/420013a.pac'),
    new BrawlSceneDesc('adventure/420013b.pac', 'adventure/420013b.pac'),
    new BrawlSceneDesc('adventure/420015a.pac', 'adventure/420015a.pac'),
    new BrawlSceneDesc('adventure/420017a.pac', 'adventure/420017a.pac'),
    new BrawlSceneDesc('adventure/420017b.pac', 'adventure/420017b.pac'),
    new BrawlSceneDesc('adventure/420017c.pac', 'adventure/420017c.pac'),
    new BrawlSceneDesc('adventure/420019a.pac', 'adventure/420019a.pac'),
    new BrawlSceneDesc('adventure/420019b.pac', 'adventure/420019b.pac'),
    new BrawlSceneDesc('adventure/420021a.pac', 'adventure/420021a.pac'),
    new BrawlSceneDesc('adventure/420021c.pac', 'adventure/420021c.pac'),
    new BrawlSceneDesc('adventure/420021d.pac', 'adventure/420021d.pac'),
    new BrawlSceneDesc('adventure/420021e.pac', 'adventure/420021e.pac'),
    new BrawlSceneDesc('adventure/420023a.pac', 'adventure/420023a.pac'),
    new BrawlSceneDesc('adventure/420023b.pac', 'adventure/420023b.pac'),
    new BrawlSceneDesc('adventure/420023c.pac', 'adventure/420023c.pac'),
    new BrawlSceneDesc('adventure/420025a.pac', 'adventure/420025a.pac'),
    new BrawlSceneDesc('adventure/420025b.pac', 'adventure/420025b.pac'),
    new BrawlSceneDesc('adventure/420025c.pac', 'adventure/420025c.pac'),
    new BrawlSceneDesc('adventure/420027a.pac', 'adventure/420027a.pac'),
    new BrawlSceneDesc('adventure/420027b.pac', 'adventure/420027b.pac'),
    new BrawlSceneDesc('adventure/420027c.pac', 'adventure/420027c.pac'),
    new BrawlSceneDesc('adventure/420029b.pac', 'adventure/420029b.pac'),
    new BrawlSceneDesc('adventure/420031a.pac', 'adventure/420031a.pac'),
    new BrawlSceneDesc('adventure/420031b.pac', 'adventure/420031b.pac'),
    new BrawlSceneDesc('adventure/420031c.pac', 'adventure/420031c.pac'),
    new BrawlSceneDesc('adventure/420033a.pac', 'adventure/420033a.pac'),
    new BrawlSceneDesc('adventure/420033b.pac', 'adventure/420033b.pac'),
    new BrawlSceneDesc('adventure/420035a.pac', 'adventure/420035a.pac'),
    new BrawlSceneDesc('adventure/420037a.pac', 'adventure/420037a.pac'),
    new BrawlSceneDesc('adventure/420041.pac', 'adventure/420041.pac'),
    new BrawlSceneDesc('adventure/420042.pac', 'adventure/420042.pac'),
    new BrawlSceneDesc('adventure/420043.pac', 'adventure/420043.pac'),
    new BrawlSceneDesc('adventure/420044.pac', 'adventure/420044.pac'),
    new BrawlSceneDesc('adventure/420045.pac', 'adventure/420045.pac'),
    new BrawlSceneDesc('adventure/420046.pac', 'adventure/420046.pac'),
    new BrawlSceneDesc('adventure/420047.pac', 'adventure/420047.pac'),
    new BrawlSceneDesc('adventure/420051.pac', 'adventure/420051.pac'),
    new BrawlSceneDesc('adventure/420052.pac', 'adventure/420052.pac'),
    new BrawlSceneDesc('adventure/420053.pac', 'adventure/420053.pac'),
    new BrawlSceneDesc('adventure/420054.pac', 'adventure/420054.pac'),
    new BrawlSceneDesc('adventure/420055.pac', 'adventure/420055.pac'),
    new BrawlSceneDesc('adventure/420056.pac', 'adventure/420056.pac'),
    new BrawlSceneDesc('adventure/420057.pac', 'adventure/420057.pac'),
    new BrawlSceneDesc('adventure/420058.pac', 'adventure/420058.pac'),
    new BrawlSceneDesc('adventure/420059.pac', 'adventure/420059.pac'),
    new BrawlSceneDesc('adventure/420060.pac', 'adventure/420060.pac'),
    new BrawlSceneDesc('adventure/420061.pac', 'adventure/420061.pac'),
    new BrawlSceneDesc('adventure/420062.pac', 'adventure/420062.pac'),
    new BrawlSceneDesc('adventure/420063.pac', 'adventure/420063.pac'),
    new BrawlSceneDesc('adventure/420064.pac', 'adventure/420064.pac'),
    new BrawlSceneDesc('adventure/420065.pac', 'adventure/420065.pac'),
    new BrawlSceneDesc('adventure/420066.pac', 'adventure/420066.pac'),
    new BrawlSceneDesc('adventure/420067.pac', 'adventure/420067.pac'),
    new BrawlSceneDesc('adventure/420068.pac', 'adventure/420068.pac'),
    new BrawlSceneDesc('adventure/420069.pac', 'adventure/420069.pac'),
    new BrawlSceneDesc('adventure/420070.pac', 'adventure/420070.pac'),
    new BrawlSceneDesc('adventure/420071.pac', 'adventure/420071.pac'),
    new BrawlSceneDesc('adventure/420072.pac', 'adventure/420072.pac'),
    new BrawlSceneDesc('adventure/420073.pac', 'adventure/420073.pac'),
    new BrawlSceneDesc('adventure/420074.pac', 'adventure/420074.pac'),
    new BrawlSceneDesc('adventure/420075.pac', 'adventure/420075.pac'),
    new BrawlSceneDesc('adventure/420076.pac', 'adventure/420076.pac'),
    new BrawlSceneDesc('adventure/420077.pac', 'adventure/420077.pac'),
    new BrawlSceneDesc('adventure/420078.pac', 'adventure/420078.pac'),
    new BrawlSceneDesc('adventure/420079.pac', 'adventure/420079.pac'),
    new BrawlSceneDesc('adventure/420080.pac', 'adventure/420080.pac'),
    new BrawlSceneDesc('adventure/420081.pac', 'adventure/420081.pac'),
    new BrawlSceneDesc('adventure/420101.pac', 'adventure/420101.pac'),
    new BrawlSceneDesc('adventure/900001.pac', 'adventure/900001.pac'),
    new BrawlSceneDesc('adventure/900101.pac', 'adventure/900101.pac'),
    new BrawlSceneDesc('adventure/900201.pac', 'adventure/900201.pac'),
    new BrawlSceneDesc('adventure/910101.pac', 'adventure/910101.pac'),
    new BrawlSceneDesc('adventure/920001.pac', 'adventure/920001.pac'),
    new BrawlSceneDesc('adventure/920101.pac', 'adventure/920101.pac'),
    new BrawlSceneDesc('adventure/920201.pac', 'adventure/920201.pac'),
    new BrawlSceneDesc('adventure/920301.pac', 'adventure/920301.pac'),
    new BrawlSceneDesc('adventure/920401.pac', 'adventure/920401.pac'),
    new BrawlSceneDesc('adventure/920501.pac', 'adventure/920501.pac'),
    new BrawlSceneDesc('adventure/920601.pac', 'adventure/920601.pac'),
    new BrawlSceneDesc('adventure/920701.pac', 'adventure/920701.pac'),
    new BrawlSceneDesc('adventure/920801.pac', 'adventure/920801.pac'),
    new BrawlSceneDesc('adventure/010001.pac', 'adventure/010001.pac'),
    new BrawlSceneDesc('adventure/030001.pac', 'adventure/030001.pac'),
    new BrawlSceneDesc('adventure/030101.pac', 'adventure/030101.pac'),
    new BrawlSceneDesc('adventure/040001.pac', 'adventure/040001.pac'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
