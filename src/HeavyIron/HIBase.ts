import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { HIEvent } from "./HIEvent.js";
import { HIScene } from "./HIScene.js";
import { RwStream } from "./rw/rwcore.js";

export class HILinkAsset {
    public srcEvent: number;
    public dstEvent: number;
    public dstAssetID: number;
    public param: ArrayBufferSlice;
    public paramWidgetAssetID: number;
    public chkAssetID: number;

    constructor(stream: RwStream) {
        this.srcEvent = stream.readUint16();
        this.dstEvent = stream.readUint16();
        this.dstAssetID = stream.readUint32();
        this.param = stream.read(0x10);
        this.paramWidgetAssetID = stream.readUint32();
        this.chkAssetID = stream.readUint32();
    }
}

export const enum HIBaseFlags {
    Enabled = 0x1,
    Persistent = 0x2,
    Valid = 0x4,
    Cutscene = 0x8,
    ShadowRec = 0x10,
    IsEntity = 0x20,
}

export class HIBaseAsset {
    public id: number;
    public baseType: number;
    public linkCount: number;
    public baseFlags: number;

    constructor(stream?: RwStream) {
        if (stream) {
            this.id = stream.readUint32();
            this.baseType = stream.readUint8();
            this.linkCount = stream.readUint8();
            this.baseFlags = stream.readUint16();
        }
    }
}

export class HIBase {
    public baseFlags: number;
    public links: HILinkAsset[] = [];

    /**
     * Load any needed assets from scene.assetManager here
     */
    constructor(public baseAsset: HIBaseAsset, scene: HIScene) {
        this.baseFlags = this.baseAsset.baseFlags;
    }

    public readLinks(stream: RwStream) {
        for (let i = 0; i < this.baseAsset.linkCount; i++) {
            this.links.push(new HILinkAsset(stream));
        }
    }

    /**
     * Virtual function
     * Load any needed objects from the scene here
     */
    public setup(scene: HIScene) {}

    /**
     * Virtual function
     */
    public reset(scene: HIScene) {
        this.baseFlags = this.baseAsset.baseFlags;
    }

    /**
     * Virtual function
     */
    public handleEvent(event: HIEvent, params: number[], scene: HIScene) {}

    /**
     * Virtual function
     */
    public parseEventParams(event: HIEvent, stream: RwStream): number[] {
        return [
            stream.readFloat(),
            stream.readFloat(),
            stream.readFloat(),
            stream.readFloat()
        ];
    }

    public enable() {
        this.baseFlags |= HIBaseFlags.Enabled;
    }

    public disable() {
        this.baseFlags &= ~HIBaseFlags.Enabled;
    }

    public isEnabled() {
        return (this.baseFlags & HIBaseFlags.Enabled) !== 0;
    }
}