import { BTI, BTIData } from "../Common/JSYSTEM/JUTTexture.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";
import { EDemoMode } from "./d_demo.js";
import { dProcName_e } from "./d_procname.js";
import { dComIfG_resLoad, ResType } from "./d_resorce.js";
import { cPhs__Status, fGlobals, fpc_bs__Constructor, fpcPf__Register, fpcSCtRq_Request, leafdraw_class } from "./framework.js";
import { dGlobals } from "./Main.js";

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
    if(!currentPlaceName) {
        if (globals.scnPlay.placenameState == PlacenameState.Visible) {
            fpcSCtRq_Request(globals.frameworkGlobals, null, dProcName_e.d_place_name, null);
            currentPlaceName = globals.scnPlay.placenameIndex;
        }
    } else {
        if (globals.scnPlay.placenameState == PlacenameState.Hidden) {
            currentPlaceName = null;
        }
    }
}


export class d_place_name extends leafdraw_class {
    public static PROCESS_NAME = dProcName_e.d_place_name;

    public override load(globals: dGlobals): cPhs__Status {
        let status = dComIfG_resLoad(globals, 'PName');
        if (status != cPhs__Status.Complete)
            return status;

        // The Outset Island image lives inside the arc. All others are loose files in 'res/placename/'
        let img: BTIData;
        if( globals.scnPlay.placenameIndex === Placename.OutsetIsland ) {
            img = globals.resCtrl.getObjectRes(ResType.Bti, `PName`, 0x07)
        } else {
            const filename = `placename/pn_0${globals.scnPlay.placenameIndex + 1}.bti`; // @TODO: Need to support 2 digit numbers
            status = globals.modelCache.requestFileData(filename);
            if (status !== cPhs__Status.Complete)
                return status;
            const imgData = globals.modelCache.getFileData(filename);
            img = new BTIData(globals.context.device, globals.renderer.renderCache, BTI.parse(imgData, filename).texture);
        }
    
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
