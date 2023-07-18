import { ObjectInstance } from '../objects.js';
import { SFAClass } from './SFAClass.js';
import { angle16ToRads } from '../util.js';

export function commonSetup(obj: ObjectInstance, data: DataView, yawOffs?: number, pitchOffs?: number, rollOffs?: number, animSpeed?: number) {
    if (yawOffs !== undefined)
        obj.yaw = angle16ToRads(data.getInt8(yawOffs) << 8);
    if (pitchOffs !== undefined)
        obj.pitch = angle16ToRads(data.getInt8(pitchOffs) << 8);
    if (rollOffs !== undefined)
        obj.roll = angle16ToRads(data.getInt8(rollOffs) << 8);
    if (animSpeed !== undefined)
        obj.animSpeed = animSpeed;
}

export function commonClass(yawOffs?: number, pitchOffs?: number, rollOffs?: number, animSpeed?: number): typeof SFAClass {
    return class extends SFAClass {
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, yawOffs, pitchOffs, rollOffs, animSpeed);
        }
    };
}

export function decorClass(animSpeed: number = 1.0): typeof SFAClass {
    return class extends SFAClass {
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x1a, 0x19, 0x18);
            obj.animSpeed = animSpeed;
            const scaleParam = data.getUint8(0x1b);
            if (scaleParam !== 0)
                obj.scale *= scaleParam / 255;
        }
    };
}

export function templeClass(): typeof SFAClass {
    return class extends SFAClass {
        constructor(obj: ObjectInstance, data: DataView) {
            super(obj, data);
            commonSetup(obj, data, 0x18);
            obj.setModelNum(data.getInt8(0x19));
        }
    };
}