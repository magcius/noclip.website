
// Klonoa

import * as Viewer from '../viewer';
import * as CX from '../compression/CX';
import * as BRRES from './brres';
import * as U8 from './u8';
import Progressable from '../Progressable';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { fetchData } from '../fetch';
import { RRESTextureHolder, MDL0ModelInstance, MDL0Model } from './render';
import { GfxRenderInstViewRenderer } from '../gfx/render/GfxRenderer';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { GXRenderHelperGfx } from '../gx/gx_render';
import AnimationController from '../AnimationController';
import { assert, assertExists } from '../util';

const id = 'klonoa';
const name = "Klonoa";

const pathBase = `klonoa`;

class BasicRRESRenderer implements Viewer.SceneGfx {
    public viewRenderer = new GfxRenderInstViewRenderer();
    public renderTarget = new BasicRenderTarget();
    public modelInstances: MDL0ModelInstance[] = [];
    public modelData: MDL0Model[] = [];

    public renderHelper: GXRenderHelperGfx;
    public textureHolder = new RRESTextureHolder()
    public animationController = new AnimationController();

    constructor(device: GfxDevice) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    protected prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.fillSceneParams(viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.viewRenderer.prepareToRender(device);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        const mainPassRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, mainPassRenderer);
        return mainPassRenderer;
    }
}

class KlonoaSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        const stageBinName = `${this.id}.bin`;
        const texBinName = `tex${this.id.slice(1, 3)}.bin`;

        function fetchLandscapeBin(filename: string) {
            return fetchData(`${pathBase}/us/landscape/${filename}`, abortSignal).then((data) => {
                if (data.byteLength === 0)
                    return data;
                else
                    return CX.decompress(data);
            });
        }

        return Progressable.all([fetchLandscapeBin(stageBinName), fetchLandscapeBin(texBinName)]).then(([stageBinData, texBinData]) => {
            const renderer = new BasicRRESRenderer(device);

            if (texBinData.byteLength !== 0) {
                const texBinRRES = BRRES.parse(texBinData);
                renderer.textureHolder.addRRESTextures(device, texBinRRES);
            }

            const arc = U8.parse(stageBinData);

            const texRRESData = arc.findFileData(`arc/tex.bin`);
            if (texRRESData !== null) {
                const texRRES = BRRES.parse(texRRESData);
                renderer.textureHolder.addRRESTextures(device, texRRES);
            }

            for (let i = 0; i < 10; i++) {
                const mdl0RRESData = arc.findFileData(`arc/mdl_${i}.bin`);
                if(mdl0RRESData === null)
                    continue;
                const mdl0RRES = BRRES.parse(mdl0RRESData);
                assert(mdl0RRES.mdl0.length === 1);
                const mdl0Data = new MDL0Model(device, renderer.renderHelper, mdl0RRES.mdl0[0]);
                renderer.modelData.push(mdl0Data);

                const modelInstance = new MDL0ModelInstance(device, renderer.renderHelper, renderer.textureHolder, mdl0Data);
                renderer.modelInstances.push(modelInstance);
            }

            const anmRRESData = arc.findFileData(`arc/anm.bin`);
            if (anmRRESData !== null) {
                const anmRRES = BRRES.parse(arc.findFileData(`arc/anm.bin`));
                for (let i = 0; i < renderer.modelInstances.length; i++)
                    renderer.modelInstances[i].bindRRESAnimations(renderer.animationController, anmRRES);
            }

            renderer.renderHelper.finishBuilder(device, renderer.viewRenderer);

            return renderer;
        });
    }
}

const sceneDescs = [
    new KlonoaSceneDesc("s000", "s000"),
    new KlonoaSceneDesc("s001", "s001"),
    new KlonoaSceneDesc("s010", "s010"),
    new KlonoaSceneDesc("s020", "s020"),
    new KlonoaSceneDesc("s030", "s030"),
    new KlonoaSceneDesc("s040", "s040"),
    new KlonoaSceneDesc("s043", "s043"),
    new KlonoaSceneDesc("s050", "s050"),
    new KlonoaSceneDesc("s110", "s110"),
    new KlonoaSceneDesc("s111", "s111"),
    new KlonoaSceneDesc("s112", "s112"),
    new KlonoaSceneDesc("s113", "s113"),
    new KlonoaSceneDesc("s120", "s120"),
    new KlonoaSceneDesc("s121", "s121"),
    new KlonoaSceneDesc("s122", "s122"),
    new KlonoaSceneDesc("s123", "s123"),
    new KlonoaSceneDesc("s124", "s124"),
    new KlonoaSceneDesc("s125", "s125"),
    new KlonoaSceneDesc("s126", "s126"),
    new KlonoaSceneDesc("s127", "s127"),
    new KlonoaSceneDesc("s210", "s210"),
    new KlonoaSceneDesc("s211", "s211"),
    new KlonoaSceneDesc("s212", "s212"),
    new KlonoaSceneDesc("s213", "s213"),
    new KlonoaSceneDesc("s220", "s220"),
    new KlonoaSceneDesc("s221", "s221"),
    new KlonoaSceneDesc("s222", "s222"),
    new KlonoaSceneDesc("s223", "s223"),
    new KlonoaSceneDesc("s224", "s224"),
    new KlonoaSceneDesc("s225", "s225"),
    new KlonoaSceneDesc("s226", "s226"),
    new KlonoaSceneDesc("s310", "s310"),
    new KlonoaSceneDesc("s311", "s311"),
    new KlonoaSceneDesc("s312", "s312"),
    new KlonoaSceneDesc("s313", "s313"),
    new KlonoaSceneDesc("s314", "s314"),
    new KlonoaSceneDesc("s315", "s315"),
    new KlonoaSceneDesc("s320", "s320"),
    new KlonoaSceneDesc("s321", "s321"),
    new KlonoaSceneDesc("s322", "s322"),
    new KlonoaSceneDesc("s323", "s323"),
    new KlonoaSceneDesc("s324", "s324"),
    new KlonoaSceneDesc("s325", "s325"),
    new KlonoaSceneDesc("s326", "s326"),
    new KlonoaSceneDesc("s327", "s327"),
    new KlonoaSceneDesc("s328", "s328"),
    new KlonoaSceneDesc("s329", "s329"),
    new KlonoaSceneDesc("s330", "s330"),
    new KlonoaSceneDesc("s410", "s410"),
    new KlonoaSceneDesc("s412", "s412"),
    new KlonoaSceneDesc("s413", "s413"),
    new KlonoaSceneDesc("s420", "s420"),
    new KlonoaSceneDesc("s421", "s421"),
    new KlonoaSceneDesc("s422", "s422"),
    new KlonoaSceneDesc("s423", "s423"),
    new KlonoaSceneDesc("s424", "s424"),
    new KlonoaSceneDesc("s425", "s425"),
    new KlonoaSceneDesc("s426", "s426"),
    new KlonoaSceneDesc("s427", "s427"),
    new KlonoaSceneDesc("s428", "s428"),
    new KlonoaSceneDesc("s430", "s430"),
    new KlonoaSceneDesc("s431", "s431"),
    new KlonoaSceneDesc("s510", "s510"),
    new KlonoaSceneDesc("s511", "s511"),
    new KlonoaSceneDesc("s512", "s512"),
    new KlonoaSceneDesc("s513", "s513"),
    new KlonoaSceneDesc("s514", "s514"),
    new KlonoaSceneDesc("s515", "s515"),
    new KlonoaSceneDesc("s516", "s516"),
    new KlonoaSceneDesc("s520", "s520"),
    new KlonoaSceneDesc("s521", "s521"),
    new KlonoaSceneDesc("s522", "s522"),
    new KlonoaSceneDesc("s523", "s523"),
    new KlonoaSceneDesc("s524", "s524"),
    new KlonoaSceneDesc("s525", "s525"),
    new KlonoaSceneDesc("s526", "s526"),
    new KlonoaSceneDesc("s527", "s527"),
    new KlonoaSceneDesc("s528", "s528"),
    new KlonoaSceneDesc("s530", "s530"),
    new KlonoaSceneDesc("s610", "s610"),
    new KlonoaSceneDesc("s611", "s611"),
    new KlonoaSceneDesc("s612", "s612"),
    new KlonoaSceneDesc("s613", "s613"),
    new KlonoaSceneDesc("s614", "s614"),
    new KlonoaSceneDesc("s615", "s615"),
    new KlonoaSceneDesc("s616", "s616"),
    new KlonoaSceneDesc("s617", "s617"),
    new KlonoaSceneDesc("s620", "s620"),
    new KlonoaSceneDesc("s621", "s621"),
    new KlonoaSceneDesc("s622", "s622"),
    new KlonoaSceneDesc("s623", "s623"),
    new KlonoaSceneDesc("s624", "s624"),
    new KlonoaSceneDesc("s625", "s625"),
    new KlonoaSceneDesc("s626", "s626"),
    new KlonoaSceneDesc("s627", "s627"),
    new KlonoaSceneDesc("s630", "s630"),
    new KlonoaSceneDesc("s631", "s631"),
    new KlonoaSceneDesc("s632", "s632"),
    new KlonoaSceneDesc("s633", "s633"),
    new KlonoaSceneDesc("s634", "s634"),
    new KlonoaSceneDesc("s635", "s635"),
    new KlonoaSceneDesc("s636", "s636"),
    new KlonoaSceneDesc("s730", "s730"),
    new KlonoaSceneDesc("s731", "s731"),
    new KlonoaSceneDesc("s732", "s732"),
    new KlonoaSceneDesc("s810", "s810"),
    new KlonoaSceneDesc("s811", "s811"),
    new KlonoaSceneDesc("s812", "s812"),
    new KlonoaSceneDesc("s813", "s813"),
    new KlonoaSceneDesc("s814", "s814"),
    new KlonoaSceneDesc("s815", "s815"),
    new KlonoaSceneDesc("s816", "s816"),
    new KlonoaSceneDesc("s817", "s817"),
    new KlonoaSceneDesc("s818", "s818"),
    new KlonoaSceneDesc("s820", "s820"),
    new KlonoaSceneDesc("s821", "s821"),
    new KlonoaSceneDesc("s822", "s822"),
    new KlonoaSceneDesc("s900", "s900"),
    new KlonoaSceneDesc("s901", "s901"),
    new KlonoaSceneDesc("s902", "s902"),
    new KlonoaSceneDesc("s903", "s903"),
    new KlonoaSceneDesc("s910", "s910"),
    new KlonoaSceneDesc("s911", "s911"),
    new KlonoaSceneDesc("s912", "s912"),
    new KlonoaSceneDesc("s913", "s913"),
    new KlonoaSceneDesc("s920", "s920"),
    new KlonoaSceneDesc("s921", "s921"),
    new KlonoaSceneDesc("s922", "s922"),
    new KlonoaSceneDesc("s923", "s923"),
    new KlonoaSceneDesc("s930", "s930"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
