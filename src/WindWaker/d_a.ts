
import { fopAc_ac_c, cPhs__Status, fGlobals, fpcPf__Register, fpc__ProcessName, fpc_bs__Constructor } from "./framework";
import { dGlobals } from "./zww_scenes";
import { vec3, mat4 } from "gl-matrix";
import { dComIfG_resLoad, ResType } from "./d_resorce";
import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { ViewerRenderInput } from "../viewer";
import { settingTevStruct, LightType, setLightTevColorType, LIGHT_INFLUENCE, dKy_plight_set, dKy_plight_cut } from "./d_kankyo";
import { mDoExt_modelUpdateDL } from "./m_do_ext";
import { JPABaseEmitter } from "../Common/JSYSTEM/JPA";
import { cLib_addCalc2 } from "./SComponent";

// Framework'd actors

export function mDoMtx_XrotM(dst: mat4, n: number): void {
    mat4.rotateX(dst, dst, n * Math.PI / 0x7FFF);
}

export function mDoMtx_YrotM(dst: mat4, n: number): void {
    mat4.rotateY(dst, dst, n * Math.PI / 0x7FFF);
}

export function mDoMtx_ZrotM(dst: mat4, n: number): void {
    mat4.rotateZ(dst, dst, n * Math.PI / 0x7FFF);
}

export const calc_mtx = mat4.create();

export function MtxTrans(pos: vec3, concat: boolean, m: mat4 = calc_mtx): void {
    if (concat) {
        mat4.translate(calc_mtx, calc_mtx, pos);
    } else {
        mat4.fromTranslation(calc_mtx, pos);
    }
}

export function MtxPosition(dst: vec3, src: vec3 = dst, m: mat4 = calc_mtx): void {
    vec3.transformMat4(dst, src, m);
}

const scratchMat4a = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();

class d_a_grass extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_grass;

    static kSpawnPatterns = [
        { group: 0, count: 1 },
        { group: 0, count: 7 },
        { group: 1, count: 15 },
        { group: 2, count: 3 },
        { group: 3, count: 7 },
        { group: 4, count: 11 },
        { group: 5, count: 7 },
        { group: 6, count: 5 },
    ];
    
    static kSpawnOffsets = [
        [
            [0, 0, 0],
            [3, 0, -50],
            [-2, 0, 50],
            [50, 0, 27],
            [52, 0, -25],
            [-50, 0, 22],
            [-50, 0, -29],
        ],
        [
            [-18, 0, 76],
            [-15, 0, 26],
            [133, 0, 0],
            [80, 0, 23],
            [86, 0, -83],
            [33, 0, -56],
            [83, 0, -27],
            [-120, 0, -26],
            [-18, 0, -65],
            [-20, 0, -21],
            [-73, 0, 1],
            [-67, 0, -102],
            [-21, 0, 126],
            [-120, 0, -78],
            [-70, 0, -49],
            [32, 0, 103],
            [34, 0, 51],
            [-72, 0, 98],
            [-68, 0, 47],
            [33, 0, -5],
            [135, 0, -53],
        ],
        [
            [-75, 0, -50],
            [75, 0, -25],
            [14, 0, 106],
        ],
        [
            [-24, 0, -28],
            [27, 0, -28],
            [-21, 0, 33],
            [-18, 0, -34],
            [44, 0, -4],
            [41, 0, 10],
            [24, 0, 39],
        ],
        [
            [-55, 0, -22],
            [-28, 0, -50],
            [-77, 0, 11],
            [55, 0, -44],
            [83, 0, -71],
            [11, 0, -48],
            [97, 0, -34],
            [-74, 0, -57],
            [31, 0, 58],
            [59, 0, 30],
            [13, 0, 23],
            [-12, 0, 54],
            [55, 0, 97],
            [10, 0, 92],
            [33, 0, -10],
            [-99, 0, -27],
            [40, 0, -87],
        ],
        [
            [0, 0, 3],
            [-26, 0, -29],
            [7, 0, -25],
            [31, 0, -5],
            [-7, 0, 40],
            [-35, 0, 15],
            [23, 0, 32],
        ],
        [
            [-40, 0, 0],
            [0, 0, 0],
            [80, 0, 0],
            [-80, 0, 0],
            [40, 0, 0],
        ]
    ];

    public subload(globals: dGlobals): cPhs__Status {
        const enum FoliageType {
            Grass,
            Tree,
            WhiteFlower,
            PinkFlower
        };

        const spawnPatternId = (this.parameters & 0x00F) >> 0;
        const type: FoliageType = (this.parameters & 0x030) >> 4;
        const itemIdx = (this.parameters >> 6) & 0x3f; // Determines which item spawns when this is cut down

        const pattern = d_a_grass.kSpawnPatterns[spawnPatternId];
        const offsets = d_a_grass.kSpawnOffsets[pattern.group];
        const count = pattern.count;

        switch (type) {
            case FoliageType.Grass:
                for (let j = 0; j < count; j++) {
                    // @NOTE: Grass does not observe actor rotation or scale
                    const offset = vec3.set(scratchVec3a, offsets[j][0], offsets[j][1], offsets[j][2]);
                    const pos = vec3.add(scratchVec3a, offset, this.pos);
                    globals.scnPlay.grassPacket.newData(pos, this.roomNo, itemIdx);
                }
            break;

            case FoliageType.Tree:
                const rotation = mat4.fromYRotation(scratchMat4a, this.rot[1] / 0x7FFF * Math.PI);

                for (let j = 0; j < count; j++) {
                    const offset = vec3.transformMat4(scratchVec3a, offsets[j], rotation);
                    const pos = vec3.add(scratchVec3b, offset, this.pos);
                    globals.scnPlay.treePacket.newData(pos, 0, this.roomNo);
                }
            break;

            case FoliageType.WhiteFlower:
            case FoliageType.PinkFlower:
                for (let j = 0; j < count; j++) {
                    const isPink = (type === FoliageType.PinkFlower);

                    // @NOTE: Flowers do not observe actor rotation or scale
                    const offset = vec3.set(scratchVec3a, offsets[j][0], offsets[j][1], offsets[j][2]);
                    const pos = vec3.add(scratchVec3a, offset, this.pos);
                    globals.scnPlay.flowerPacket.newData(globals, pos, isPink, this.roomNo, itemIdx);
                }
            break;
            default:
                console.warn('Unknown grass actor type');
        }

        return cPhs__Status.Next;
    }
}

// TODO(jstpierre): Bad hack
export function createEmitter(globals: dGlobals, resourceId: number): JPABaseEmitter {
    const renderer = globals.renderer;
    const emitter = renderer.effectSystem!.createBaseEmitter(renderer.device, renderer.renderCache, resourceId);
    return emitter;
}

// -------------------------------------------------------
// Generic Torch
// -------------------------------------------------------
class d_a_ep extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_ep;

    private type: number;
    private hasGa: boolean;
    private hasObm: boolean;
    private model: J3DModelInstance;
    private posTop = vec3.create();
    private light = new LIGHT_INFLUENCE();
    private state: number = 0;
    private lightPower: number = 0.0;
    private lightPowerTarget: number = 0.0;

    public subload(globals: dGlobals): cPhs__Status {
        const status = dComIfG_resLoad(globals, `Ep`);
        if (status !== cPhs__Status.Complete)
            return status;

        this.hasGa = !!((this.parameters >>> 6) & 0x01);
        this.hasObm = !!((this.parameters >>> 7) & 0x01);
        this.type = (this.parameters & 0x3F);
        if (this.type === 0x3F)
            this.type = 0;

        if (this.type === 0 || this.type === 3) {
            this.model = new J3DModelInstance(globals.resCtrl.getObjectRes(ResType.Model, `Ep`, this.hasObm ? 0x04 : 0x05));
        }

        this.CreateInit();

        dKy_plight_set(globals.g_env_light, this.light);

        // Create particle systems.

        // TODO(jstpierre): Implement the real thing.
        const pa = createEmitter(globals, 0x0001);
        vec3.copy(pa.globalTranslation, this.posTop);
        pa.globalTranslation[1] += -240 + 235 + 15;
        if (this.type !== 2) {
            const pb = createEmitter(globals, 0x4004);
            vec3.copy(pb.globalTranslation, pa.globalTranslation);
            pb.globalTranslation[1] += 20;
        }
        const pc = createEmitter(globals, 0x01EA);
        vec3.copy(pc.globalTranslation, this.posTop);
        pc.globalTranslation[1] += -240 + 235 + 8;
        // TODO(jstpierre): ga

        return cPhs__Status.Next;
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.type === 0 || this.type === 3) {
            settingTevStruct(globals, LightType.BG0, this.pos, this.tevStr);
            setLightTevColorType(globals, this.model, this.tevStr, viewerInput.camera);
            mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput);
        }
    }

    public execute(globals: dGlobals): void {
        if (this.type === 0 || this.type === 3) {
            if (this.hasGa)
                this.ga_move();
        }

        this.ep_move();
    }

    public delete(globals: dGlobals): void {
        dKy_plight_cut(globals.g_env_light, this.light);
    }

    private CreateInit(): void {
        this.daEp_set_mtx();
    }

    private daEp_set_mtx(): void {
        if (this.type === 0 || this.type === 3) {
            MtxTrans(this.pos, false);
            mDoMtx_YrotM(calc_mtx, this.rot[1]);
            mDoMtx_XrotM(calc_mtx, this.rot[0]);
            mDoMtx_ZrotM(calc_mtx, this.rot[2]);
            mat4.copy(this.model.modelMatrix, calc_mtx);
            vec3.set(this.posTop, 0, 140, 0);
            MtxPosition(this.posTop);
        } else {
            vec3.copy(this.posTop, this.pos);
        }
    }

    private ga_move(): void {
        // TODO(jstpierre): ga
    }

    private ep_move(): void {
        // tons of fun timers and such
        if (this.state === 0) {
            // check switches
            this.state = 3;
            this.lightPowerTarget = this.scale[0];
        } else if (this.state === 3 || this.state === 4) {
            this.lightPower = cLib_addCalc2(this.lightPower, this.lightPowerTarget, 0.5, 0.2);
            if (this.type !== 2) {
                // check a bunch of stuff, collision, etc.
                // setSimple 0x4004
            }
        }

        vec3.copy(this.light.pos, this.posTop);
        this.light.color.r = 600 / 0xFF;
        this.light.color.g = 400 / 0xFF;
        this.light.color.b = 120 / 0xFF;
        this.light.power = this.lightPower * 150.0;
        this.light.fluctuation = 250.0;

        // other emitter stuff
    }
}

interface constructor extends fpc_bs__Constructor {
    PROCESS_NAME: fpc__ProcessName;
}

export function d_a__RegisterConstructors(globals: fGlobals): void {
    function R(constructor: constructor): void {
        fpcPf__Register(globals, constructor.PROCESS_NAME, constructor);
    }

    R(d_a_grass);
    R(d_a_ep);
}
