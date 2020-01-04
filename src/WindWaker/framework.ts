
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { ViewerRenderInput } from "../viewer";
import { vec3 } from "gl-matrix";
import { fopAcM_prm_class } from "./Actors";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assertExists, nArray, arrayRemove } from "../util";

export type fpc_pc__ProfileList = { Profiles: ArrayBufferSlice[] };

interface GlobalUserData {
    frameworkGlobals: fGlobals;
}

export class fGlobals {
    // fpcDt
    public dtQueue: base_process_class[] = [];
    // fpcCt
    public ctQueue: standard_create_request_class<any>[] = [];
    // fpcLy
    public lyNextID: number = 1;
    public lyRoot = new layer_class(0);
    public lyCurr: layer_class = this.lyRoot;
    // fpcEx, fpcLy, fpcLi
    public liQueue: base_process_class[][] = nArray(0x10, () => []);
    // fopDw
    public dwQueue: leafdraw_class[][] = nArray(1000, () => []);

    public f_pc_constructors: fpc_bs__Constructor[] = [];

    constructor(public f_pc_profiles: fpc_pc__ProfileList) {
    }
}

//#region cPhs

export const enum cPhs__Status {
    Loading,
    Next,
    Complete,
    Error,
}

type cPhs__Handler<T> = (globals: fGlobals, globalUserData: GlobalUserData, userData: T) => cPhs__Status;

class request_of_phase_process_class<T> {
    public step: number = 0;

    constructor(public mtd: cPhs__Handler<T>[] | null) {
    }

    private Complete(): cPhs__Status {
        this.mtd = null;
        return cPhs__Status.Complete;
    }

    private Next(): cPhs__Status {
        this.step++;
        if (this.step >= this.mtd!.length)
            return this.Complete();
        else
            return cPhs__Status.Next;
    }

    public Do(globals: fGlobals, globalUserData: GlobalUserData, userData: T): cPhs__Status {
        if (this.mtd === null)
            return this.Complete();
        const status = this.mtd[this.step](globals, globalUserData, userData);
        if (status === cPhs__Status.Complete)
            return this.Complete();
        else if (status === cPhs__Status.Next)
            return this.Next();
        else
            return status;
    }
}

//#endregion

//#region fpc

//#region fpcDt

function fpcDt_ToDeleteQ(globals: fGlobals, pc: base_process_class): void {
    // fpcDt_ToQueue
    globals.dtQueue.push(pc);

    // fpcEx_ExecuteQTo, fpcLyTg_ToQueue
    arrayRemove(pc.ly.pcQueue, pc);
}

function fpcDt_Handler(globals: fGlobals, globalUserData: GlobalUserData): void {
    for (let i = 0; i < globals.dtQueue.length; i++) {
        const pc = globals.dtQueue[i];
        fpcLy_SetCurrentLayer(globals, pc.ly);
        // fpcLnTg_QueueTo
        arrayRemove(globals.liQueue[pc.pi.listID], pc);
        pc.delete(globalUserData);
    }
}

//#endregion

//#region cPhs, fpcCt, fpcSCtRq

interface fpc_bs__Constructor {
    new(globalUserData: fGlobals, profile: DataView): base_process_class;
}

class standard_create_request_class<T = any> {
    public phase = new request_of_phase_process_class<this>([
        // this.Load,
        this.CreateProcess,
        this.SubCreateProcess,
        this.ChildrenLoading,
    ]);
    public process: base_process_class | null = null;

    constructor(public layer: layer_class, public constructor: fpc_bs__Constructor, public profileBinary: ArrayBufferSlice, public userData: T) {
    }

    // fpcSCtRq_Handler
    public Handle(globals: fGlobals, globalUserData: GlobalUserData): cPhs__Status {
        while (true) {
            const status = this.phase.Do(globals, globalUserData, this);
            if (status !== cPhs__Status.Next)
                return status;
        }
    }

    private CreateProcess(globals: fGlobals, globalUserData: GlobalUserData, userData: this): cPhs__Status {
        const self = userData;
        self.process = new self.constructor(globals, self.profileBinary.createDataView());
        return cPhs__Status.Next;
    }

    private SubCreateProcess(globals: fGlobals, globalUserData: GlobalUserData, userData: this): cPhs__Status {
        const self = userData;
        const process = self.process!;
        fpcLy_SetCurrentLayer(globals, self.layer);
        const status = process.load(globalUserData, self.userData!);
        return status;
    }

    private ChildrenLoading(globals: fGlobals, globalUserData: GlobalUserData, userData: this): cPhs__Status {
        const self = userData;
        if (self.process instanceof process_node_class && self.process.layer.creatingCount > 0)
            return cPhs__Status.Loading;
        else
            return cPhs__Status.Next;
    }
}

export function fpcCt_Handler(globals: fGlobals, globalUserData: GlobalUserData): boolean {
    // fpcCtRq_Handler
    let hadAnyLoading = false;
    for (let i = 0; i < globals.ctQueue.length; i++) {
        const rq = globals.ctQueue[i];
        // fpcCtRq_Do
        const status = rq.Handle(globals, globalUserData);
        let shouldDelete = false;

        if (status === cPhs__Status.Complete) {
            fpcEx_ToExecuteQ(globals, rq.process!);
            shouldDelete = true;
        } else if (status === cPhs__Status.Error) {
            console.error(`Had error loading`);
            shouldDelete = true;
        } else if (status === cPhs__Status.Loading) {
            hadAnyLoading = true;
        }

        if (shouldDelete) {
            // fpcCtRq_Delete
            globals.ctQueue.splice(i--, 1);
            rq.layer.creatingCount--;
        }
    }
    return hadAnyLoading;
}

function fpcCtRq_ToCreateQ(globals: fGlobals, rq: standard_create_request_class): void {
    // fpcLy_CreatingMesg
    rq.layer.creatingCount++;
    // fpcCtTg_ToCreateQ
    globals.ctQueue.push(rq);
}

export function fpcSCtRq_Request<G>(globals: fGlobals, ly: layer_class | null, pcName: fpc__ProcessName, userData: G): boolean {
    const constructor = fpcPf_Get__Constructor(globals, pcName);
    if (constructor === null)
        return false;

    if (ly === null)
        ly = fpcLy_CurrentLayer(globals);

    const binary = fpcPf_Get__ProfileBinary(globals, pcName);
    const rq = new standard_create_request_class(ly, constructor, binary, userData);
    fpcCtRq_ToCreateQ(globals, rq);
    return true;
}

//#endregion

//#region fpcLy (framework process layer)

// From what I can tell, theprocess  layer system is practically never used that much in the game.
// root -> d_scn_play -> d_scn_room seem to be the active number of layers during gameplay...
// We don't bother with the node tree, we just record the processes for each layer in a list.
class layer_class {
    public pcQueue: base_process_class[] = [];
    public creatingCount: number = 0;

    constructor(public layerID: number) {
    }
}

function fpcLy_Layer(globals: fGlobals, layerID: number): layer_class {
    if (layerID === 0xFFFFFFFD) {
        return globals.lyCurr;
    } else if (layerID === 0) {
        return globals.lyRoot;
    } else {
        throw "whoops";
    }
}

function fpcLy_CurrentLayer(globals: fGlobals): layer_class {
    return globals.lyCurr;
}

function fpcLy_SetCurrentLayer(globals: fGlobals, layer: layer_class): void {
    globals.lyCurr = layer;
}

//#endregion

//#region fpcEx (framework process executor)

function fpcEx_Handler(globals: fGlobals, globalUserData: GlobalUserData): void {
    for (let i = 0; i < globals.liQueue.length; i++) {
        for (let j = 0; j < globals.liQueue[i].length; j++) {
            const pc = globals.liQueue[i][j];
            fpcLy_SetCurrentLayer(globals, pc.ly);
            globals.liQueue[i][j].execute(globalUserData);
        }
    }
}

function fpcEx_ToExecuteQ(globals: fGlobals, process: base_process_class): void {
    // fpcLyTg_ToQueue
    const layer = fpcLy_Layer(globals, process.pi.layerID);
    layer.pcQueue.push(process);

    // fpcEx_ToLineQ

    // The game checks if it's root, or the layer's process node is active in the process list,
    // but for us, it always will be...

    // fpcLnTg_ToQueue
    globals.liQueue[process.pi.listID].push(process);
}

//#endregion

//#region fpcBs (framework process base)

// Most of the base classes for things extend from this.

class process_priority_class {
    public layerID: number = -1;
    public listID: number = -1;
    public listIndex: number = -1;
}

export class base_process_class {
    public processName: number;
    public parameters: number;

    // line tag
    // delete tag
    public ly: layer_class;
    public pi = new process_priority_class();

    constructor(globals: fGlobals, profile: DataView) {
        // fpcBs_Create
        this.pi.layerID = profile.getUint32(0x00);
        this.pi.listID = profile.getUint16(0x04);
        this.pi.listIndex = profile.getUint16(0x06);
        this.processName = profile.getUint32(0x08);
        this.parameters = profile.getUint32(0x18);
    }

    // In the original game, construction is inside "create". Here, we split it into construction and "load".
    public load(globals: GlobalUserData, userData: any): cPhs__Status {
        return cPhs__Status.Complete;
    }

    public execute(globals: GlobalUserData): void {
    }

    public delete(globals: GlobalUserData): void {
    }
}

export const enum fpc__ProcessName {
    d_s_play  = 0x0007,

    d_a_grass = 0x01B8,
    d_a_ep    = 0x00BA,
    d_a_tbox  = 0x0126,
};

function fpcPf_Get__ProfileBinary(globals: fGlobals, pcName: fpc__ProcessName): ArrayBufferSlice {
    return assertExists(globals.f_pc_profiles.Profiles[pcName]);
}

function fpcPf_Get__Constructor(globals: fGlobals, pcName: fpc__ProcessName): fpc_bs__Constructor | null {
    const pf = globals.f_pc_constructors[pcName];
    if (pf !== undefined)
        return pf;
    else
        return null;
}

export function fpcPf__Register(globals: fGlobals, pcName: fpc__ProcessName, constructor: fpc_bs__Constructor): void {
    globals.f_pc_constructors[pcName] = constructor;
}

//#endregion

//#region fpcDw

class process_node_class extends base_process_class {
    public layer: layer_class;

    constructor(globals: fGlobals, profile: DataView) {
        super(globals, profile);

        this.layer = new layer_class(globals.lyNextID++);
    }

    public draw(globals: GlobalUserData, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const fGlobals = globals.frameworkGlobals;
        fpcLy_SetCurrentLayer(fGlobals, this.layer);
    }
}

class leafdraw_class extends base_process_class {
    public drawPriority: number;

    constructor(globals: fGlobals, profile: DataView) {
        super(globals, profile);
        this.drawPriority = profile.getUint16(0x20);
    }

    public draw(globals: GlobalUserData, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    }
}

function fpcDw_Handler(globals: fGlobals, globalUserData: GlobalUserData, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    // fpcM_DrawIterater
    for (let i = 0; i < globals.lyRoot.pcQueue.length; i++) {
        const pc = globals.lyRoot.pcQueue[i];
        if (pc instanceof leafdraw_class || pc instanceof process_node_class) {
            fpcLy_SetCurrentLayer(globals, pc.ly);
            pc.draw(globalUserData, renderInstManager, viewerInput);
        }
    }
}

//#endregion

//#region fpcM (Manager)

export function fpcM_Management(globals: fGlobals, globalUserData: GlobalUserData, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    fpcDt_Handler(globals, globalUserData);
    fpcCt_Handler(globals, globalUserData);
    // fpcPi_Handler(globals);
    fpcEx_Handler(globals, globalUserData);
    fpcDw_Handler(globals, globalUserData, renderInstManager, viewerInput);
}

// TODO(jstpierre): Remove this in favor of explicit scene loading from the Renderer.

//#endregion

//#region fop

//#region fopDw (framework operation draw)

export function fopDw_Draw(globals: fGlobals, globalUserData: GlobalUserData, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    for (let i = 0; i < globals.dwQueue.length; i++) {
        for (let j = 0; j < globals.dwQueue[i].length; j++) {
            const pc = globals.dwQueue[i][j];
            fpcLy_SetCurrentLayer(globals, pc.ly);
            globals.dwQueue[i][j].draw(globalUserData, renderInstManager, viewerInput);
        }
    }
}

function fopDwTg_ToDrawQ(globals: fGlobals, dw: leafdraw_class, priority: number): void {
    globals.dwQueue[priority].push(dw);
}

function fopDwTg_DrawQTo(globals: fGlobals, dw: leafdraw_class, priority: number): void {
    arrayRemove(globals.dwQueue[priority], dw);
}

//#endregion

export class fopScn extends process_node_class {
}

export class fopAc_ac_c extends leafdraw_class {
    public pos = vec3.create();
    public rot = vec3.create();
    public scale = vec3.create();
    public parentPcId: number;
    public subtype: number;
    public roomNo: number;

    private loadInit: boolean = false;

    public load(globals: GlobalUserData, prm: fopAcM_prm_class): cPhs__Status {
        if (!this.loadInit) {
            vec3.copy(this.pos, prm.pos);
            vec3.copy(this.rot, prm.rot);
            vec3.copy(this.scale, prm.scale);
            this.subtype = prm.subtype;
            this.parentPcId = prm.parentPcId;
            this.parameters = prm.parameters;
            this.roomNo = prm.roomNo;
            this.loadInit = true;
        }

        const status = this.subload(globals);
        if (status === cPhs__Status.Complete)
            fopDwTg_ToDrawQ(globals.frameworkGlobals, this, this.drawPriority);
        return status;
    }

    public delete(globals: GlobalUserData): void {
        fopDwTg_DrawQTo(globals.frameworkGlobals, this, this.drawPriority);
    }

    protected subload(globals: GlobalUserData): cPhs__Status {
        return cPhs__Status.Complete;
    }
}

export function fopAcM_create(globals: fGlobals, pcName: fpc__ProcessName, parameter: number, pos: vec3, roomNo: number, rot: vec3, scale: vec3, subtype: number, parentPcId: number): boolean {
    // Create on current layer.
    const prm: fopAcM_prm_class = {
        parameters: parameter, pos, roomNo, rot, scale, subtype, parentPcId,
        enemyNo: -1, gbaName: 0x00, layer: -1,
    };

    const layer = fpcLy_CurrentLayer(globals);
    return fpcSCtRq_Request(globals, layer, pcName, prm);
}

//#endregion
