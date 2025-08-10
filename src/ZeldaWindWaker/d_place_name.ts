
import { J2DAnchorPos, J2DPicture, J2DScreen } from "../Common/JSYSTEM/J2Dv1.js";
import { BTI, BTIData } from "../Common/JSYSTEM/JUTTexture.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { assertExists } from "../util.js";
import { ViewerRenderInput } from "../viewer.js";
import { EDemoMode } from "./d_demo.js";
import { dProcName_e } from "./d_procname.js";
import { dComIfG_resLoad, ResType } from "./d_resorce.js";
import { cPhs__Status, fGlobals, fopMsgM_Delete, fpc_bs__Constructor, fpcPf__Register, fpcSCtRq_Request, msg_class } from "./framework.js";
import { dGlobals } from "./Main.js";

let currentPlaceName: number | null = null;

export const enum Placename {
    OutsetIsland,
    ForsakenFortress,
    DragonRoost,
    ForestHaven,
    GreatfishIsland,
    WindfallIsland,
    TowerOfTheGods,
    KingdomOfHyrule,
    GaleIsle,
    HeadstoneIsle,
    FireMountain,
    IceRingIsle,
    FairyAtoll,
    DragonRoostCavern,
    ForbiddenWoods,
    TowerOfTheGods2,
    EarthTemple,
    WindTemple,
    GanonsTower,
}

export const enum PlacenameState {
    Init,
    Hidden,
    Visible,
}

export function dPn__update(globals: dGlobals) {
    // TODO: Initiate other place names manually

    // From d_menu_window::dMs_placenameMove()
    if (globals.scnPlay.demo.getMode() === EDemoMode.Playing) {
        const frameNo = globals.scnPlay.demo.getFrameNoMsg();
        const demoName = globals.scnPlay.demo.getName();

        if (demoName === 'awake') {
            if (frameNo >= 200 && frameNo < 350) {
                globals.scnPlay.placenameIndex = Placename.OutsetIsland;
                globals.scnPlay.placenameState = PlacenameState.Visible;
            } else if (frameNo >= 0x15e) {
                globals.scnPlay.placenameState = PlacenameState.Hidden;
            }
        } else if (demoName === 'majyuu_shinnyuu') {
            if (frameNo >= 0xb54 && frameNo < 0xbea) {
                globals.scnPlay.placenameIndex = Placename.ForsakenFortress;
                globals.scnPlay.placenameState = PlacenameState.Visible;
            } else if (frameNo >= 0xbea) {
                globals.scnPlay.placenameState = PlacenameState.Hidden;
            }
        }
    }

    // From d_meter::dMeter_placeNameMove
    if (currentPlaceName === null) {
        if (globals.scnPlay.placenameState === PlacenameState.Visible) {
            fpcSCtRq_Request(globals.frameworkGlobals, null, dProcName_e.d_place_name, null);
            currentPlaceName = globals.scnPlay.placenameIndex;
        }
    } else {
        if (globals.scnPlay.placenameState === PlacenameState.Hidden) {
            currentPlaceName = null;
        }
    }
}


export class d_place_name extends msg_class {
    public static PROCESS_NAME = dProcName_e.d_place_name;
    private screen: J2DScreen;
    private animFrame: number = 0;

    public override load(globals: dGlobals): cPhs__Status {
        let status = dComIfG_resLoad(globals, 'PName');
        if (status !== cPhs__Status.Complete)
            return status;

        const screenData = globals.resCtrl.getObjectRes(ResType.Blo, `PName`, 0x04);
        this.screen = new J2DScreen(screenData, globals.renderer.renderCache, globals.resCtrl.getResResolver('PName'), J2DAnchorPos.Left);
        this.screen.search('blc1')!.hide();
        this.screen.search('blc2')!.hide();

        // The Outset Island image lives inside the PName arc. All others are loose files in 'res/placename/'
        if (globals.scnPlay.placenameIndex === Placename.OutsetIsland) {
            return cPhs__Status.Complete;
        }

        const placenameId = (globals.scnPlay.placenameIndex + 1);
        const filename = `placename/pn_${placenameId.toString().padStart(2, "0")}.bti`;
        status = globals.modelCache.requestFileData(filename);
        if (status !== cPhs__Status.Complete)
            return status;
        const imgData = globals.modelCache.getFileData(filename);

        const img = new BTIData(globals.sceneContext.device, globals.renderer.renderCache, BTI.parse(imgData, filename).texture);
        const pic = assertExists(this.screen.search('\0\0pn')) as J2DPicture;
        pic.setTexture(img);

        return cPhs__Status.Complete;
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        renderInstManager.setCurrentList(globals.dlst.ui[0]);
        this.screen.draw(renderInstManager, globals.scnPlay.currentGrafPort);
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        if (globals.scnPlay.placenameState === PlacenameState.Visible) {
            this.openAnime(deltaTimeFrames);
        } else if (globals.scnPlay.placenameState === PlacenameState.Hidden) {
            if (this.closeAnime(deltaTimeFrames))
                fopMsgM_Delete(globals.frameworkGlobals, this);
        }
    }

    private openAnime(deltaTimeFrames: number) {
        if (this.animFrame < 10) {
            this.animFrame += deltaTimeFrames;

            const pct = Math.min(this.animFrame / 10, 1.0)
            const alpha = pct * pct;

            this.screen.data.alpha = alpha * 0xFF;
        }
    }

    private closeAnime(deltaTimeFrames: number) {
        if (this.animFrame > 0) {
            this.animFrame -= deltaTimeFrames;

            const pct = Math.min(this.animFrame / 10, 1.0)
            const alpha = pct * pct;

            this.screen.data.alpha = alpha * 0xFF;
        }

        return this.animFrame <= 0;
    }
}

interface constructor extends fpc_bs__Constructor {
    PROCESS_NAME: dProcName_e;
}

export function d_pn__RegisterConstructors(globals: fGlobals): void {
    function R(constructor: constructor): void {
        fpcPf__Register(globals, constructor.PROCESS_NAME, constructor);
    }

    R(d_place_name);
}
