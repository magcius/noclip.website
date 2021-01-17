
import { mat4 } from "gl-matrix";
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from "../../../gfx/helpers/RenderTargetHelpers";
import { GfxDevice } from "../../../gfx/platform/GfxPlatform";
import { fillSceneParamsDataOnTemplate, GXRenderHelperGfx } from "../../../gx/gx_render";
import { TPLTextureHolder } from "../../../PaperMarioTTYD/render";
import * as TPL from "../../../PaperMarioTTYD/tpl";
import * as U8 from "../../../rres/u8";
import * as CX from "../../Compression/CX"
import { SceneContext } from "../../../SceneBase";
import { TextureMapping } from "../../../TextureHolder";
import { assertExists } from "../../../util";
import { SceneDesc, SceneGfx, SceneGroup, ViewerRenderInput } from "../../../viewer";
import { Layout, LayoutAnimation, LayoutDrawInfo, LayoutResourceCollection, parseBRLAN, parseBRLYT } from "./Layout";
import { getTimeInFrames } from '../../../AnimationController';

class BannerBinRenderer implements SceneGfx {
    public renderTarget = new BasicRenderTarget();
    public textureHolder = new TPLTextureHolder();
    private drawInfo = new LayoutDrawInfo();
    private renderHelper: GXRenderHelperGfx;
    private resourceCollection: LayoutResourceCollection;
    private layout: Layout;
    private startLayoutAnimation: LayoutAnimation;
    private loopLayoutAnimation: LayoutAnimation;

    constructor(device: GfxDevice, private arc: U8.U8Archive) {
        this.renderHelper = new GXRenderHelperGfx(device);

        const brlytData = arc.findFileData('arc/blyt/banner.brlyt')!;
        const rlyt = parseBRLYT(brlytData);
        console.log(rlyt);

        this.resourceCollection = new LayoutResourceCollection();
        rlyt.txl1.map((txl1) => {
            const path = `arc/timg/${txl1.filename}`;
            const tplData = assertExists(arc.findFileData(path));
            const tpl = TPL.parse(tplData, [txl1.filename]);
            this.textureHolder.addTPLTextures(device, tpl);

            const textureMapping = new TextureMapping();
            this.textureHolder.fillTextureMapping(textureMapping, txl1.filename);
            this.resourceCollection.textures.push(textureMapping);
        });

        this.layout = new Layout(device, this.renderHelper.getCache(), rlyt, this.resourceCollection);

        const startAnim = parseBRLAN(arc.findFileData('arc/anim/banner_Start.brlan')!);
        this.startLayoutAnimation = new LayoutAnimation(this.layout, startAnim);

        const loopAnim = parseBRLAN(arc.findFileData('arc/anim/banner_Loop.brlan')!);
        this.loopLayoutAnimation = new LayoutAnimation(this.layout, loopAnim);

        const font_e = this.layout.findPaneByName('font_e');
        if (font_e !== null)
            font_e.visible = true;
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const deltaTimeFrames = getTimeInFrames(viewerInput.deltaTime, 60);
        if (this.startLayoutAnimation.isOver())
            this.loopLayoutAnimation.update(deltaTimeFrames);
        else
            this.startLayoutAnimation.update(deltaTimeFrames);

        mat4.copy(this.drawInfo.viewMatrix, viewerInput.camera.viewMatrix);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        this.layout.draw(device, this.renderHelper.renderInstManager, this.drawInfo);
        this.renderHelper.renderInstManager.popTemplateRenderInst();

        const hostAccessPass = device.createHostAccessPass();
        this.renderHelper.prepareToRender(device, hostAccessPass);
        device.submitPass(hostAccessPass);

        const renderPass = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor, viewerInput.onscreenTexture);
        this.renderHelper.renderInstManager.drawOnPassRenderer(device, renderPass);
        device.submitPass(renderPass);

        this.renderHelper.renderInstManager.resetRenderInsts();
        return null;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
        this.textureHolder.destroy(device);
    }
}

class BannerBinSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const data = await dataFetcher.fetchData(`WiiBanner/${this.id}/banner.bin`);
        // ignore IMD5 header
        const arcData = data.slice(0x24);
        const arc = U8.parse(CX.decompress(arcData));
        return new BannerBinRenderer(device, arc);
    }
}

const id = 'WiiBanners';
const name = 'Wii Banners';

const sceneDescs = [
    new BannerBinSceneDesc('WiiShopChannel', 'Wii Shop Channel'),
];

export const sceneGroup: SceneGroup = {
    id, name, sceneDescs, hidden: true,
};
