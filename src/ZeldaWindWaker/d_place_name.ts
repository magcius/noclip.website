import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";
import { EDemoMode } from "./d_demo.js";
import { dProcName_e } from "./d_procname.js";
import { fopMsgM_create } from "./f_op_msg_mng.js";
import { cPhs__Status, fGlobals, fpc_bs__Constructor, fpcPf__Register, fpcSCtRq_Request, leafdraw_class } from "./framework.js";
import { dGlobals } from "./Main.js";

export const enum Placename {
    OutsetIsland,
    ForsakenFortress,
} 

export const enum PlacenameState {
    Init,
    Hidden,
    Visible,
} 

export function updatePlaceName(globals: dGlobals) {
    // From d_menu_window::dMs_placenameMove()
    if(globals.scnPlay.demo.getMode() == EDemoMode.Playing) {
        const frameNo = globals.scnPlay.demo.getFrameNoMsg();
        const demoName = globals.scnPlay.demo.getName();

        if(demoName == 'awake') { 
            if (frameNo >= 200 && frameNo < 0x15e) {
                globals.scnPlay.placenameIndex = Placename.OutsetIsland;
                globals.scnPlay.placenameState = PlacenameState.Visible;
            } else if(frameNo >= 0x15e) {
                globals.scnPlay.placenameState = PlacenameState.Hidden;
            }
        } else if (demoName == 'majyuu_shinnyuu') {
            if (frameNo >= 0xb54 && frameNo < 0xbea) {
                globals.scnPlay.placenameIndex = Placename.ForsakenFortress;
                globals.scnPlay.placenameState = PlacenameState.Visible;
            } else if(frameNo >= 0xbea) {
                globals.scnPlay.placenameState = PlacenameState.Hidden;
            }
        }
    }

    // From d_meter::dMeter_placeNameMove 
    if (globals.scnPlay.placenameState == PlacenameState.Visible) {
        fpcSCtRq_Request(globals.frameworkGlobals, null, dProcName_e.d_place_name, null);
    }
}


export class d_place_name extends leafdraw_class {
    public static PROCESS_NAME = dProcName_e.d_place_name;

    public override load(globals: dGlobals): cPhs__Status {
        debugger;
        return cPhs__Status.Complete;
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        debugger;
    }

    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        debugger;
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
