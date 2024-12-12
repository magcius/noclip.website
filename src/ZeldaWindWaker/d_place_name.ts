import { mat4, vec3 } from "gl-matrix";
import { J2DGrafContext, J2DPane, J2DPicture, SCRN } from "../Common/JSYSTEM/J2D.js";
import { BTI, BTIData } from "../Common/JSYSTEM/JUTTexture.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";
import { EDemoMode } from "./d_demo.js";
import { dProcName_e } from "./d_procname.js";
import { dComIfG_resLoad, ResType } from "./d_resorce.js";
import { cPhs__Status, fGlobals, fopMsgM_Delete, fpc_bs__Constructor, fpcPf__Register, fpcSCtRq_Request, leafdraw_class, msg_class } from "./framework.js";
import { dGlobals } from "./Main.js";
import { MtxTrans } from "./m_do_mtx.js";

let currentPlaceName: number | null = null;

export const enum Placename {
    OutsetIsland,
    ForsakenFortress,
    DragonRoost,
}

export const enum PlacenameState {
    Init,
    Hidden,
    Visible,
}

export function updatePlaceName(globals: dGlobals) {
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
    private pane: J2DPane;
    private ctx2D: J2DGrafContext;
    private animFrame: number = 0;

    public override load(globals: dGlobals): cPhs__Status {
        let status = dComIfG_resLoad(globals, 'PName');
        if (status !== cPhs__Status.Complete)
            return status;

        const screen = globals.resCtrl.getObjectRes(ResType.Blo, `PName`, 0x04)
        this.ctx2D = new J2DGrafContext(globals.renderer.device);

        // The Outset Island image lives inside the arc. All others are loose files in 'res/placename/'
        let img: BTIData;
        if (globals.scnPlay.placenameIndex === Placename.OutsetIsland) {
            img = globals.resCtrl.getObjectRes(ResType.Bti, `PName`, 0x07)
        } else {
            const filename = `placename/pn_0${globals.scnPlay.placenameIndex + 1}.bti`; // @TODO: Need to support 2 digit numbers
            status = globals.modelCache.requestFileData(filename);
            if (status !== cPhs__Status.Complete)
                return status;
            const imgData = globals.modelCache.getFileData(filename);
            img = new BTIData(globals.context.device, globals.renderer.renderCache, BTI.parse(imgData, filename).texture);
        }

        this.pane = new J2DPane(screen.panes[0], globals.renderer.renderCache);
        this.pane.children[0].data.visible = false;
        this.pane.children[1].data.visible = false;
        const pic = this.pane.children[2] as J2DPicture;
        pic.setTexture(img);

        return cPhs__Status.Complete;
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const pane = this.pane.children[2];

        let x = (pane.data.x / 640);
        let y = 1.0 - (pane.data.y / 480);

        let h = (pane.data.h / 480);
        let w = h * (pane.data.w / pane.data.h) / globals.camera.aspect;

        // @TODO: Remove. Do this in J2D
        MtxTrans([x, y, -1], false, pane.drawMtx);
        mat4.scale(pane.drawMtx, pane.drawMtx, [w, h, 1]);

        renderInstManager.setCurrentList(globals.dlst.ui[0]);
        this.pane.draw(renderInstManager, viewerInput, this.ctx2D);
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

            const pct = (this.animFrame / 10)
            const alpha = pct * pct;

            this.pane.data.alpha = alpha * 0xFF;
        }
    }

    private closeAnime(deltaTimeFrames: number) {
        if (this.animFrame > 0) {
            this.animFrame -= deltaTimeFrames;

            const pct = (this.animFrame / 10)
            const alpha = pct * pct;

            this.pane.data.alpha = alpha * 0xFF;
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

