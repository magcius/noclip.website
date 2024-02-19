import { Color } from "../Color.js";
import { HIBase } from "./HIBase.js";
import { HIEvent } from "./HIEvent.js";
import { HIScene } from "./HIScene.js";
import { RwStream } from "./rw/rwcore.js";

export class HIFogAsset {
    public bkgndColor: Color;
    public fogColor: Color;
    public fogDensity: number;
    public fogStart: number;
    public fogStop: number;
    public transitionTime: number;
    public fogType: number;

    constructor(stream: RwStream) {
        this.bkgndColor = stream.readRGBA();
        this.fogColor = stream.readRGBA();
        this.fogDensity = stream.readFloat();
        this.fogStart = stream.readFloat();
        this.fogStop = stream.readFloat();
        this.transitionTime = stream.readFloat();
        this.fogType = stream.readUint8();
        stream.pos += 3; // padding
    }
}

export class HIFog extends HIBase {
    public fogAsset: HIFogAsset;

    constructor(stream: RwStream) {
        super(stream);
        this.fogAsset = new HIFogAsset(stream);
        this.readLinks(stream);
    }

    public override handleEvent(event: HIEvent, params: number[], scene: HIScene) {
        switch (event) {
        case HIEvent.On:
        {
            scene.camera.fog = {
                start: this.fogAsset.fogStart,
                stop: this.fogAsset.fogStop,
                fogcolor: this.fogAsset.fogColor,
                bgcolor: this.fogAsset.bkgndColor
            };
            break;
        }
        case HIEvent.Off:
            scene.camera.fog = undefined;
            break;
        }
    }
}