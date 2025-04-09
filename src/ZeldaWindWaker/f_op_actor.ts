
import { mat4, ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import { Camera } from "../Camera.js";
import { AABB } from "../Geometry.js";
import { MathConstants, transformVec3Mat4w1 } from "../MathHelpers.js";
import { assert } from "../util.js";
import { dKy_tevstr_c, dKy_tevstr_init } from "./d_kankyo.js";
import { dProcName_e } from "./d_procname.js";
import { base_process_class, cPhs__Status, fGlobals, fopDwTg_DrawQTo, fopDwTg_ToDrawQ, fpcDt_Delete, fpcPc__IsVisible, fpcSCtRq_Request, leafdraw_class } from "./framework.js";
import { dGlobals } from "./Main.js";
import { dCamera_c } from "./d_camera.js";

const scratchVec3a = vec3.create();
const scratchAABB = new AABB();
export class fopAc_ac_c extends leafdraw_class {
    public pos = vec3.create();
    public rot = vec3.create();
    public scale = vec3.fromValues(1, 1, 1);
    public parentPcId: number = 0xFFFFFFFF;
    public subtype: number = 0xFF;
    public roomNo: number = -1;
    public tevStr = new dKy_tevstr_c();
    public demoActorID: number = -1;
    protected cullSizeBox: AABB | null = null;
    protected cullSizeSphere: vec4 | null = null;
    protected cullMtx: mat4 | null = null;
    protected cullFarDistanceRatio: number = 0.5;
    // noclip addition
    public roomLayer: number = -1;

    private loadInit: boolean = false;

    constructor(globals: fGlobals, pcName: number, pcId: number, profile: DataView) {
        super(globals, pcName, pcId, profile);

        // Initialize our culling information from the profile...
        const cullType = profile.getUint8(0x2D);
        if (cullType < 0x0E) {
            this.cullSizeBox = Object.freeze(fopAc_ac_c.cullSizeBox[cullType]);
        } else if (cullType === 0x0E) {
            this.cullSizeBox = new AABB();
        } else if (cullType < 0x17) {
            this.cullSizeSphere = fopAc_ac_c.cullSizeSphere[cullType - 0x0F];
        } else if (cullType === 0x17) {
            this.cullSizeSphere = vec4.create();
        }
    }

    public override load(globals: dGlobals, prm: fopAcM_prm_class | null): cPhs__Status {
        if (!this.loadInit) {
            this.loadInit = true;

            if (prm !== null) {
                if (prm.pos !== null)
                    vec3.copy(this.pos, prm.pos);
                if (prm.rot !== null)
                    vec3.copy(this.rot, prm.rot);
                if (prm.scale !== null)
                    vec3.copy(this.scale, prm.scale);
                this.subtype = prm.subtype;
                this.parentPcId = prm.parentPcId;
                this.parameters = prm.parameters;
                this.roomNo = prm.roomNo;
                this.roomLayer = prm.layer;
            }

            dKy_tevstr_init(this.tevStr, this.roomNo);
        }

        const status = this.subload(globals, prm);
        assert(status !== cPhs__Status.Complete);
        if (status === cPhs__Status.Next)
            fopDwTg_ToDrawQ(globals.frameworkGlobals, this, this.drawPriority);
        return status;
    }

    private static cullSizeBox: AABB[] = [
        new AABB(-40.0,    0.0, -40.0,     40.0, 125.0,  40.0), // 0x00
        new AABB(-25.0,    0.0, -25.0,     25.0,  50.0,  25.0), // 0x01
        new AABB(-50.0,    0.0, -50.0,     50.0, 100.0,  50.0), // 0x02
        new AABB(-75.0,    0.0, -75.0,     75.0, 150.0,  75.0), // 0x03
        new AABB(-100.0,   0.0, -100.0,   100.0, 800.0, 100.0), // 0x04
        new AABB(-125.0,   0.0, -125.0,   125.0, 250.0, 125.0), // 0x05
        new AABB(-150.0,   0.0, -150.0,   150.0, 300.0, 150.0), // 0x06
        new AABB(-200.0,   0.0, -200.0,   200.0, 400.0, 200.0), // 0x07
        new AABB(-600.0,   0.0, -600.0,   600.0, 900.0, 600.0), // 0x08
        new AABB(-250.0,   0.0, -50.0,    250.0, 900.0,  50.0), // 0x09
        new AABB(-60.0,    0.0, -20.0,     40.0, 130.0, 150.0), // 0x0A
        new AABB(-75.0,    0.0, -75.0,     75.0, 210.0,  75.0), // 0x0B
        new AABB(-70.0, -100.0, -80.0,     70.0, 240.0, 100.0), // 0x0C
        new AABB(-60.0,  -20.0, -60.0,     60.0, 160.0,  60.0), // 0x0D
    ];

    private static cullSizeSphere: vec4[] = [
        vec4.fromValues(0.0, 0.0, 0.0, 80.0),
        vec4.fromValues(0.0, 0.0, 0.0, 50.0),
        vec4.fromValues(0.0, 0.0, 0.0, 100.0),
        vec4.fromValues(0.0, 0.0, 0.0, 150.0),
        vec4.fromValues(0.0, 0.0, 0.0, 200.0),
        vec4.fromValues(0.0, 0.0, 0.0, 250.0),
        vec4.fromValues(0.0, 0.0, 0.0, 300.0),
        vec4.fromValues(0.0, 0.0, 0.0, 400.0),
    ];

    protected setCullSizeBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void {
        assert(this.cullSizeBox !== null && !Object.isFrozen(this.cullSizeBox));
        this.cullSizeBox.set(minX, minY, minZ, maxX, maxY, maxZ);
    }

    protected setCullSizeSphere(x: number, y: number, z: number, r: number): void {
        assert(this.cullSizeSphere !== null && this.cullSizeSphere[3] === 0.0);
        vec4.set(this.cullSizeSphere, x, y, z, r);
    }

    protected cullingCheck(camera: dCamera_c): boolean {
        if (!fpcPc__IsVisible(this))
            return false;

        // Make sure that all culling matrices are filled in, before I forget...
        if (this.cullMtx === null)
            throw "whoops";

        const frustum = camera.frustum;

        if (this.cullSizeBox !== null) {
            // If the box is empty, that means I forgot to fill it in for a certain actor.
            // Sound the alarms so that I fill it in!
            if (this.cullSizeBox.isEmpty())
                debugger;

            scratchAABB.transform(this.cullSizeBox, this.cullMtx);

            if (!frustum.contains(scratchAABB))
                return false;

            // Calculate screen area.
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (let i = 0; i < 8; i++) {
                scratchAABB.cornerPoint(scratchVec3a, i);
                vec3.transformMat4(scratchVec3a, scratchVec3a, camera.clipFromWorldMatrix);
                minX = Math.min(minX, scratchVec3a[0]); maxX = Math.max(maxX, scratchVec3a[0]);
                minY = Math.min(minY, scratchVec3a[1]); maxY = Math.max(maxY, scratchVec3a[1]);
            }
            const extX = (maxX - minX) * 0.5;
            const extY = (maxY - minY) * 0.5;
            const area = extX * extY;

            if (area <= 0.0002)
                return false;
        } else if (this.cullSizeSphere !== null) {
            vec3.set(scratchVec3a, this.cullSizeSphere[0], this.cullSizeSphere[1], this.cullSizeSphere[2]);
            transformVec3Mat4w1(scratchVec3a, this.cullMtx, scratchVec3a);
            const radius = this.cullSizeSphere[3];

            if (!frustum.containsSphere(scratchVec3a, radius))
                return false;

            // Calculate the length of a line R at distance D from the camera.
            const r = Math.abs(camera.clipFromViewMatrix[11] * this.cullSizeSphere[2] + camera.clipFromViewMatrix[15]);
            const area = MathConstants.TAU * r;

            if (area <= 0.0002)
                return false;
        }

        return true;
    }

    public override delete(globals: dGlobals): void {
        fopDwTg_DrawQTo(globals.frameworkGlobals, this, this.drawPriority);
    }

    protected subload(globals: dGlobals, prm: fopAcM_prm_class | null): cPhs__Status {
        return cPhs__Status.Next;
    }
}

//#region fopAc
export interface fopAcM_prm_class {
    parameters: number;
    pos: ReadonlyVec3 | null;
    rot: ReadonlyVec3 | null;
    enemyNo: number;
    scale: ReadonlyVec3 | null;
    gbaName: number;
    parentPcId: number;
    subtype: number;
    roomNo: number;
    // NOTE(jstpierre): This isn't part of the original struct, it simply doesn't
    // load inactive layers...
    layer: number;
}

export function fopAcM_delete(globals: fGlobals, ac: fopAc_ac_c): void {
    return fpcDt_Delete(globals, ac);
}

export function fopAcM_create(globals: fGlobals, pcName: dProcName_e, parameters: number, pos: ReadonlyVec3 | null, roomNo: number, rot: ReadonlyVec3 | null, scale: ReadonlyVec3 | null, subtype: number, parentPcId: number): number | null {
    // Create on current layer.
    const prm: fopAcM_prm_class = {
        parameters, pos, roomNo, rot, scale, subtype, parentPcId,
        enemyNo: -1, gbaName: 0x00, layer: -1,
    };

    return fpcSCtRq_Request(globals, null, pcName, prm);
}

export function fopAcIt_JudgeByID<T extends base_process_class>(globals: fGlobals, pcId: number | null): T | null {
    if (pcId === null)
        return null;
    for (let i = 0; i < globals.lnQueue.length; i++) {
        if (globals.lnQueue[i].processId === pcId)
            return globals.lnQueue[i] as unknown as T;
    }
    return null;
}

export function fopAcM_searchFromName(globals: dGlobals, procName: string, paramMask: number, param: number): fopAc_ac_c | null {
    const objName = globals.dStage_searchName(procName);
    if (!objName) { return null; }

    for (let i = 0; i < globals.frameworkGlobals.lnQueue.length; i++) {
        const act = globals.frameworkGlobals.lnQueue[i] as fopAc_ac_c;
        if (act.profName === objName.pcName
            && objName.subtype === act.subtype
            && (paramMask === 0 || param === (act.parameters & paramMask))
        )
            return act;
    }

    return null;
}
