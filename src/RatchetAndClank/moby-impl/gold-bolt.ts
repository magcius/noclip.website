import { GfxDevice } from "../../gfx/platform/GfxPlatform";
import { MobyInstance } from "../bin-gameplay";
import { LevelResources } from "../loader";
import { MobyUpdateKit, MobyImpl, updateTransform } from "./moby";

export class GoldBolt implements MobyImpl {
    private initialZ = 0;
    private phase = 0;

    constructor(private mobyInstance: MobyInstance, private resources: LevelResources) {
        this.initialZ = mobyInstance.position.z;

        this.mobyInstance.rotation.x = Math.random() * 2 * Math.PI;
        this.mobyInstance.rotation.y = Math.random() * 2 * Math.PI;
        this.mobyInstance.rotation.z = Math.random() * 2 * Math.PI;
    }

    update(updateKit: MobyUpdateKit) {
        this.mobyInstance.position.z = this.initialZ + 1 + 0.3 * Math.sin(this.phase);
        this.mobyInstance.rotation.x += 120 * (Math.PI / 180) * (updateKit.dt / 1000);
        this.mobyInstance.rotation.y += 40 * (Math.PI / 180) * (updateKit.dt / 1000);
        this.mobyInstance.rotation.z += 20 * (Math.PI / 180) * (updateKit.dt / 1000);
        this.phase += 90 * (Math.PI / 180) * (updateKit.dt / 1000);

        updateTransform(this.mobyInstance);
    }

    drawAfterTies(updateKit: MobyUpdateKit) {
    }

    drawAfterMobys(updateKit: MobyUpdateKit) {
    }

    destroy(device: GfxDevice) {
    }
}
