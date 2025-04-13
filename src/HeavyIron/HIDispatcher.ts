import { HIBase, HIBaseAsset } from "./HIBase.js";
import { HIEvent } from "./HIEvent.js";
import { HIScene } from "./HIScene.js";
import { RwStream } from "./rw/rwcore.js";

export class HIDispatcher extends HIBase {
    constructor(stream: RwStream, scene: HIScene) {
        super(new HIBaseAsset(stream), scene);
        this.readLinks(stream);
    }

    public override handleEvent(event: HIEvent, params: number[], scene: HIScene) {
    }
}