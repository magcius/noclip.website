import { vec3 } from "gl-matrix";
import { RwStream } from "./rw/rwcore.js";

export const enum HIEntMotionType {
    ER,
    Orbit,
    Spline,
    MP,
    Mech,
    Pend,
    None
}

export interface HIEntMotionERData {
    ret_pos: vec3;
    ext_dpos: vec3;
    ext_tm: number;
    ext_wait_tm: number;
    ret_tm: number;
    ret_wait_tm: number;
}

export interface HIEntMotionOrbitData {
    center: vec3;
    w: number;
    h: number;
    period: number;
}

export interface HIEntMotionMPData {
    flags: number;
    mp_id: number;
    speed: number;
}

export const enum HIEntMotionMechType {
    Slide,
    Rot,
    SlideRot,
    SlideThenRot,
    RotThenSlide
}

export const enum HIEntMotionMechFlags {
    Returns = (1<<0),
    Once = (1<<1)
}

export interface HIEntMotionMechData {
    type: HIEntMotionMechType;
    flags: number;
    sld_axis: number;
    rot_axis: number;
    sld_dist: number;
    sld_tm: number;
    sld_acc_tm: number;
    sld_dec_tm: number;
    rot_dist: number;
    rot_tm: number;
    rot_acc_tm: number;
    rot_dec_tm: number;
    ret_delay: number;
    post_ret_delay: number;
}

export interface HIEntMotionPenData {
    flags: number;
    plane: number;
    pad: number;
    len: number;
    range: number;
    period: number;
    phase: number;
}

export const enum HIEntMotionFlags {
    Stopped = (1<<2)
}

export class HIEntMotionAsset {
    public type: HIEntMotionType;
    public use_banking: number;
    public flags: number;
    public er: HIEntMotionERData;
    public orb: HIEntMotionOrbitData;
    public mp: HIEntMotionMPData;
    public mech: HIEntMotionMechData;
    public pen: HIEntMotionPenData;

    constructor(stream: RwStream) {
        const end = stream.pos + 0x30;

        this.type = stream.readUint8();
        this.use_banking = stream.readUint8();
        this.flags = stream.readUint16();

        switch (this.type) {
        case HIEntMotionType.ER:
            this.er = {
                ret_pos: stream.readVec3(),
                ext_dpos: stream.readVec3(),
                ext_tm: stream.readFloat(),
                ext_wait_tm: stream.readFloat(),
                ret_tm: stream.readFloat(),
                ret_wait_tm: stream.readFloat()
            };
            break;
        case HIEntMotionType.Orbit:
            this.orb = {
                center: stream.readVec3(),
                w: stream.readFloat(),
                h: stream.readFloat(),
                period: stream.readFloat()
            };
            break;
        case HIEntMotionType.MP:
            this.mp = {
                flags: stream.readUint32(),
                mp_id: stream.readUint32(),
                speed: stream.readFloat()
            };
            break;
        case HIEntMotionType.Mech:
            this.mech = {
                type: stream.readUint8(),
                flags: stream.readUint8(),
                sld_axis: stream.readUint8(),
                rot_axis: stream.readUint8(),
                sld_dist: stream.readFloat(),
                sld_tm: stream.readFloat(),
                sld_acc_tm: stream.readFloat(),
                sld_dec_tm: stream.readFloat(),
                rot_dist: stream.readFloat(),
                rot_tm: stream.readFloat(),
                rot_acc_tm: stream.readFloat(),
                rot_dec_tm: stream.readFloat(),
                ret_delay: stream.readFloat(),
                post_ret_delay: stream.readFloat()
            };
            break;
        case HIEntMotionType.Pend:
            this.pen = {
                flags: stream.readUint8(),
                plane: stream.readUint8(),
                pad: stream.readUint16(), // padding
                len: stream.readFloat(),
                range: stream.readFloat(),
                period: stream.readFloat(),
                phase: stream.readFloat()
            };
            break;
        }

        stream.pos = end;
    }
}

export class HIEntMotion {
    constructor(public asset: HIEntMotionAsset) {
    }
}