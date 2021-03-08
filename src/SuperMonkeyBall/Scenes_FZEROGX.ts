import * as Viewer from '../viewer';

import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { CameraController } from '../Camera';
import { AmusementVisionSceneDesc, AmusementVisionSceneRenderer } from './AVscene';
import { makeBackbufferDescSimple, GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { AVLZ_Type } from './AVLZ';

enum FZEROGXPass {
    SKYBOX = 0x01,
    MAIN = 0x02,
}

export class FZEROGXSceneRenderer extends AmusementVisionSceneRenderer {
    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(8/60);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(device, passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }
}

const pathBase = `FZEROGX`;
class FZEROGXSceneDesc extends AmusementVisionSceneDesc {

    // COLI Scene
    public static createSceneFromCOLIScene(device: GfxDevice, lzss: ArrayBufferSlice): FZEROGXSceneRenderer {
        const sceneRenderer = new FZEROGXSceneRenderer(device);





        return sceneRenderer;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {   
        const sceneRender = new FZEROGXSceneRenderer(device);
        const cache = sceneRender.renderHelper.renderInstManager.gfxRenderCache;
        
        const dataFetcher = context.dataFetcher;

        //load common Model
        if (this.backGroundName != ``){
            await super.loadGMA(device, context, dataFetcher, `${pathBase}/init/common`, sceneRender);
        }
        
        //load stage Model
        await super.loadGMA(device, context, dataFetcher, `${pathBase}/stage/st${this.id}`, sceneRender, true, AVLZ_Type.FZGX);
        
        //load stage BackGround Model
        if (this.backGroundName != ``){
            const path = this.backGroundName.substring(this.backGroundName.length-2, 2) === `jp` ? `${pathBase}/jp/bg/bg_${this.backGroundName}` : `${pathBase}/bg/bg_${this.backGroundName}`;
            await super.loadGMA(device, context, dataFetcher, path, sceneRender, true, AVLZ_Type.FZGX);
        }
        return sceneRender;
    }
}

const id = 'fzgx';
const name = 'F-ZERO GX';
const sceneDescs = [
    "Rudy Cup",
    new FZEROGXSceneDesc("01", "mut", "Mute City - Twist Road"),
    new FZEROGXSceneDesc("16", "cas", "Casino Palace - Split Oval"),
    new FZEROGXSceneDesc("26", "san", "Sand Ocean - Surface Slide"), // NBT, Skin Model
    new FZEROGXSceneDesc("08", "lig", "Lightning - Loop Cross"),
    new FZEROGXSceneDesc("05", "tow", "Aeropolis - Multiplex"),
    // new FZEROGXSceneDesc("01", "mut_jp", "[JP]Mute City - Twist Road"),
    "Sapphire Cup",
    new FZEROGXSceneDesc("14", "big", "Big Blue - Drift Highway"),
    new FZEROGXSceneDesc("13", "por", "Port Town - Long Pipe"),
    new FZEROGXSceneDesc("11", "for", "Green Plant - Mobious Ring"), // NBT
    new FZEROGXSceneDesc("07", "por", "Port Town - Aerodive"),
    new FZEROGXSceneDesc("03", "mut", "Mute City - Serial Gaps"),
    // new FZEROGXSceneDesc("03", "mut_jp", "[JP]Mute City - Serial Gaps"),
    "Emerald Cup",
    new FZEROGXSceneDesc("15", "fir", "Fire Field - Cylinder Knot"),
    new FZEROGXSceneDesc("10", "for", "Green Plant - Intersection"), // NBT
    new FZEROGXSceneDesc("29", "cas", "Casino Palace - Double Branches"),
    new FZEROGXSceneDesc("09", "lig", "Lightning - Half-Pipe"),
    new FZEROGXSceneDesc("27", "big", "Big Blue - Ordeal"),
    // new FZEROGXSceneDesc("15", "fir_jp", "[JP]Fire Field Cylinder Knot"),
    "Diamond Cup",
    new FZEROGXSceneDesc("24", "ele", "Cosmo Termial - Trident"),
    new FZEROGXSceneDesc("25", "san", "Sand Ocean - Lateral Shift"), // NBT
    new FZEROGXSceneDesc("17", "fir", "Fire Field - Undulation"),
    new FZEROGXSceneDesc("21", "tow", "Aeropolis - Dragon Slope"),
    new FZEROGXSceneDesc("28", "rai", "Phantom Road - Slim-Line Slits"),
    // new FZEROGXSceneDesc("17", "fir_jp", "[JP]Fire Field - Undulation"),
    "AX Cup",
    new FZEROGXSceneDesc("31", "tow", "Aeropolis - Screw Drive"),
    new FZEROGXSceneDesc("32", "met", "Outer Space - Meteor Stream"), // NBT
    new FZEROGXSceneDesc("33", "por", "Port Town - Cylinder Wave"),
    new FZEROGXSceneDesc("34", "lig", "Lightning - Thunder Road"),
    new FZEROGXSceneDesc("35", "for", "Green Plant - Spiral"), //
    new FZEROGXSceneDesc("36", "com", "Mute City - Sonic Oval"),
    "Story Mode",
    new FZEROGXSceneDesc("37", "com_s", "Chapter 1"),
    new FZEROGXSceneDesc("38", "san_s", "Chapter 2"), // NBT
    new FZEROGXSceneDesc("39", "cas_s", "Chapter 3"),
    new FZEROGXSceneDesc("40", "big_s", "Chapter 4"),
    new FZEROGXSceneDesc("41", "por_s", "Chapter 5"),
    new FZEROGXSceneDesc("42", "lig_s", "Chapter 6"),
    new FZEROGXSceneDesc("43", "mut_s", "Chapter 7"), // NBT
    new FZEROGXSceneDesc("44", "fir_s", "Chapter 8"),
    new FZEROGXSceneDesc("45", "rai_s", "Chapter 9"),
    // new FZEROGXSceneDesc("43", "com_s_jp", "[JP]Chapter 7"),
    "MISC",
    new FZEROGXSceneDesc("49", "com", "Interview"),
    new FZEROGXSceneDesc("50", "com", "Victory Lap"),
    new FZEROGXSceneDesc("00", "", "st00"),

    // no plans to push those
    new FZEROGXSceneDesc("age_noclip/common", "", "Unused Model(Official GMA)"),
    new FZEROGXSceneDesc("_smb/st001", "", "st001"),
    new FZEROGXSceneDesc("_smb/st002", "", "st002"),
    new FZEROGXSceneDesc("_smb/st131", "", "st131"),
    new FZEROGXSceneDesc("_smb/st132", "", "st132"),
    new FZEROGXSceneDesc("_smb/st133", "", "st133"),
    new FZEROGXSceneDesc("_smb/st134", "", "st134"),
    new FZEROGXSceneDesc("_smb/st135", "", "st135"),
    new FZEROGXSceneDesc("_smb/st136", "", "st136"),

    new FZEROGXSceneDesc("age_noclip/bg_mut", "", "MuteCity BackGround"),

    new FZEROGXSceneDesc("age_noclip/C01_ROAD01", "", "C01_ROAD01 (2 Displaylist)"),
    new FZEROGXSceneDesc("age_noclip/C01_MAP", "", "C01 MAP"),
    new FZEROGXSceneDesc("age_noclip/triangle_2dlist", "", "Triangle(Unofficial GMA)"),
    new FZEROGXSceneDesc("age_noclip/Arc_Cube", "", "ARC Cube(Unofficial GMA)"),

    new FZEROGXSceneDesc("age_noclip/st01_snesmc1", "", "Mute City - First Circuit (hack)"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };