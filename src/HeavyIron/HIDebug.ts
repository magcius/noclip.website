import { IS_DEVELOPMENT } from "../BuildVersion.js";
import { HIBase } from "./HIBase.js";
import { HIEvent } from "./HIEvent.js";
import { HIScene } from "./HIScene.js";

export class HIEventLog {
    public enabled = false;
    public depth = 0;
    public ignore = new Set<HIEvent>();

    public push(scene: HIScene, to: HIBase, event: HIEvent, from?: HIBase) {
        if (this.ignore.has(event)) return;

        if (this.enabled) {
            let msg = '';
            for (let i = 0; i < this.depth; i++) {
                msg += '> ';
            }

            const toAsset = scene.findAsset(to.baseAsset.id)!;
            if (from) {
                const fromAsset = scene.findAsset(from.baseAsset.id)!;
                msg += `[Event] ${HIEvent[event]} sent to ${toAsset.name} from ${fromAsset.name}`;
            } else {
                msg += `[Event] ${HIEvent[event]} sent to ${toAsset.name}`;
            }

            console.log(msg);
        }
        
        this.depth++;
    }

    public pop(event: HIEvent) {
        if (this.ignore.has(event)) return;

        this.depth--;
    }
}

export class HIDebug {
    public eventLog = new HIEventLog();

    constructor() {
        this.eventLog.enabled = IS_DEVELOPMENT;
    }
}