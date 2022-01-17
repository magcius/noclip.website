import { commonSetup } from './Common';
import { SFAClass } from './SFAClass';
import { ObjectInstance, CommonObjectParams_SIZE, ObjectUpdateContext } from '../objects';
import { Plane } from '../../Geometry';
import { dataSubarray, getCamPos, mat4FromSRT } from '../util';
import { vec3, mat4 } from 'gl-matrix';

const OBJTYPE_TrigPln = 0x4c;

const Action_SIZE = 0x4;
interface Action {
    flags: number;
    type: number;
    param: number;
}

const ACTION_TYPES: {[key: number]: string} = {
    0x0: 'NoOp',
    0x4: 'Sound',
    0x8: 'HeatShimmer',
    0xa: 'EnvFx',
    0x27: 'LoadAssets',
    0x28: 'UnloadAssets',
};

interface TrigPlnData {
    plane: Plane;
    worldToPlaneSpaceMatrix: mat4;
    radius: number; // Note: Actually, the trigger is square-shaped.
}

function parseAction(data: DataView): Action {
    return {
        flags: data.getUint8(0),
        type: data.getUint8(1),
        param: data.getUint16(2),
    };
}

const scratchVec0 = vec3.create();
const scratchVec1 = vec3.create();
const scratchMtx0 = mat4.create();
const scratchMtx1 = mat4.create();

export class TriggerObj extends SFAClass {
    private actions: Action[];
    private prevPoint?: vec3;
    private triggerData?: TrigPlnData;

    private performActions(obj: ObjectInstance, leaving: boolean) {
        for (let action of this.actions) {
            if (!!(action.flags & 0x2) === leaving) {
                // console.log(`Action: flags ${!!(action.flags & 0x2) ? 'OnLeave' : 'OnEnter'} 0x${action.flags.toString(16)} type ${ACTION_TYPES[action.type] ?? `0x${action.type.toString(16)}`} param 0x${action.param.toString(16)}`);
            }
        }
    }

    constructor(obj: ObjectInstance, data: DataView) {
        super(obj, data);
        commonSetup(obj, data, 0x3d, 0x3e);

        this.actions = [];
        for (let i = 0; i < 8; i++) {
            const action = parseAction(dataSubarray(data, CommonObjectParams_SIZE, Action_SIZE, i));
            this.actions.push(action);
            // console.log(`Action #${i}: flags ${!!(action.flags & 0x2) ? 'OnLeave' : 'OnEnter'} 0x${action.flags.toString(16)} type ${ACTION_TYPES[action.type] ?? `0x${action.type.toString(16)}`} param 0x${action.param.toString(16)}`);
        }

        if (obj.commonObjectParams.objType === OBJTYPE_TrigPln) {
            mat4FromSRT(scratchMtx0, 1, 1, 1, obj.yaw, obj.pitch, obj.roll, obj.position[0], obj.position[1], obj.position[2]);
            vec3.set(scratchVec0, 1, 0, 0);
            vec3.transformMat4(scratchVec0, scratchVec0, scratchMtx0);
            vec3.set(scratchVec1, 0, 1, 0);
            vec3.transformMat4(scratchVec1, scratchVec1, scratchMtx0);
            mat4.invert(scratchMtx1, scratchMtx0);

            const plane = new Plane();
            plane.setTri(obj.position, scratchVec0, scratchVec1);
            const worldToPlaneSpaceMatrix = mat4.clone(scratchMtx1);
            const radius = 100 * obj.scale;

            this.triggerData = { plane, worldToPlaneSpaceMatrix, radius, };
        }
    };

    public override update(obj: ObjectInstance, updateCtx: ObjectUpdateContext) {
        if (obj.commonObjectParams.objType === OBJTYPE_TrigPln) {
            const currPoint = scratchVec0;
            // FIXME: The current point is not always the camera. It can also be the player character.
            getCamPos(currPoint, updateCtx.viewerInput.camera);

            if (this.prevPoint === undefined) {
                this.prevPoint = vec3.clone(currPoint);
            } else {
                const prevPointInPlane = this.triggerData!.plane.distance(this.prevPoint[0], this.prevPoint[1], this.prevPoint[2]) >= 0;
                const currPointInPlane = this.triggerData!.plane.distance(currPoint[0], currPoint[1], currPoint[2]) >= 0;

                if (currPointInPlane !== prevPointInPlane) {
                    const intersection = scratchVec1;
                    this.triggerData!.plane.intersectLineSegment(intersection, this.prevPoint, currPoint);
                    vec3.transformMat4(intersection, intersection, this.triggerData!.worldToPlaneSpaceMatrix);
                    if (-this.triggerData!.radius <= intersection[0] && intersection[0] <= this.triggerData!.radius &&
                        -this.triggerData!.radius <= intersection[1] && intersection[1] <= this.triggerData!.radius)
                    {
                        // if (currPointInPlane)
                        //     console.log(`Entered plane 0x${obj.commonObjectParams.id.toString(16)}`);
                        // else
                        //     console.log(`Exited plane 0x${obj.commonObjectParams.id.toString(16)}`);

                        this.performActions(obj, !currPointInPlane);
                    }
                }

                vec3.copy(this.prevPoint, currPoint);
            }
        }
    }
}