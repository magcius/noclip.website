import { HIEnt } from "./HIEnt.js";
import { HIEntMotionAsset } from "./HIEntMotion.js";
import { HIScene } from "./HIScene.js";
import { RwEngine, RwStream } from "./rw/rwcore.js";

export const enum HIEntButtonActMethod {
    Button,
    PressurePlate
}

export class HIEntButtonAsset {
    public modelPressedInfoID: number;
    public actMethod: HIEntButtonActMethod;
    public initButtonState: number;
    public isReset: number;
    public resetDelay: number;
    public buttonActFlags: number;

    constructor(stream: RwStream) {
        this.modelPressedInfoID = stream.readUint32();
        this.actMethod = stream.readUint32();
        this.initButtonState = stream.readInt32();
        this.isReset = stream.readInt32();
        this.resetDelay = stream.readFloat();
        this.buttonActFlags = stream.readUint32();
    }
}

export class HIEntButton extends HIEnt {
    public buttonAsset: HIEntButtonAsset;
    public motionAsset: HIEntMotionAsset;

    constructor(stream: RwStream, scene: HIScene) {
        super(stream, scene);
        this.buttonAsset = new HIEntButtonAsset(stream);
        this.motionAsset = new HIEntMotionAsset(stream);
        this.readLinks(stream);
        this.parseModelInfo(this.entAsset.modelInfoID, scene);
    }
    
    public override render(scene: HIScene, rw: RwEngine): void {
        if (this.model) {
            if (this.buttonAsset.actMethod === HIEntButtonActMethod.Button) {
                this.model.redMultiplier = scene.buttonManager.redMultiplier;
                this.model.greenMultiplier = scene.buttonManager.greenMultiplier;
                this.model.blueMultiplier = scene.buttonManager.blueMultiplier;
            }
        }

        super.render(scene, rw);
    }
}

export class HIEntButtonManager {
    public redMultiplier = 1.0;
    public greenMultiplier = 1.0;
    public blueMultiplier = 1.0;
    public colorMultiplier = 1.0;
    public colorMultiplierSign = 1;

    public update(scene: HIScene, dt: number) {
        this.colorMultiplier += dt * this.colorMultiplierSign * 2.5;
        if (this.colorMultiplier > 1.0) {
            this.colorMultiplierSign *= -1;
            this.colorMultiplier = 1.0;
        }
        if (this.colorMultiplier < 0.0) {
            this.colorMultiplierSign *= -1;
            this.colorMultiplier = 0.0;
        }
        this.redMultiplier = 0.6 + 0.4 * this.colorMultiplier;
        this.greenMultiplier = 0.6 + 0.4 * this.colorMultiplier;
        this.blueMultiplier = 0.6 + 0.4 * this.colorMultiplier;
    }
}