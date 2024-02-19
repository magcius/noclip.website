import { HIEnt } from "./HIEnt.js";
import { HIEntMotionAsset } from "./HIEntMotion.js";
import { HIEvent } from "./HIEvent.js";
import { HIScene } from "./HIScene.js";
import { RwStream } from "./rw/rwcore.js";

export const enum HIPlatformType {
    ER,
    Orbit,
    Spline,
    MP,
    Mech,
    Pen,
    ConvBelt,
    Falling,
    FR,
    Breakaway,
    Springboard,
    Teeter,
    Paddle,
    FM
}

export interface HIPlatformConvBeltData {
    speed: number;
}

export interface HIPlatformFRData {
    fspeed: number;
    rspeed: number;
    ret_delay: number;
    post_ret_delay: number;
}

export class HIPlatformAsset {
    public type: HIPlatformType;
    public flags: number;
    public cb: HIPlatformConvBeltData;
    public fr: HIPlatformFRData;

    constructor(stream: RwStream) {
        const end = stream.pos + 0x3C;

        this.type = stream.readUint8();
        stream.pos += 1; // padding
        this.flags = stream.readUint16();

        switch (this.type) {
        case HIPlatformType.ConvBelt:
            this.cb = {
                speed: stream.readFloat()
            };
            break;
        case HIPlatformType.FR:
            this.fr = {
                fspeed: stream.readFloat(),
                rspeed: stream.readFloat(),
                ret_delay: stream.readFloat(),
                post_ret_delay: stream.readFloat()
            };
            break;
        }

        stream.pos = end;
    }
}

export class HIPlatform extends HIEnt {
    public platformAsset: HIPlatformAsset;
    public motionAsset: HIEntMotionAsset;

    constructor(stream: RwStream) {
        super(stream);
        this.platformAsset = new HIPlatformAsset(stream);
        this.motionAsset = new HIEntMotionAsset(stream);
        this.readLinks(stream);
    }

    public override setup(scene: HIScene): void {
        this.parseModelInfo(this.entAsset.modelInfoID, scene);
    }
    
    public override handleEvent(event: HIEvent, params: number[], scene: HIScene): void {
        switch (event) {
        case HIEvent.SetSkyDome:
            scene.skydomeManager.addEntity(this, params[0], params[1] !== 0);
            break;
        }
    }
}