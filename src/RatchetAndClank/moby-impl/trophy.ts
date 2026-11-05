import { GfxDevice } from "../../gfx/platform/GfxPlatform";
import { MobyInstance } from "../bin-gameplay";
import { LevelResources } from "../loader";
import { MobyDrawKit, MobyImpl, updateTransform } from "./moby";

export class Trophy implements MobyImpl {
    initialZ = 0;
    phase = 0;

    constructor(private mobyInstance: MobyInstance, private resources: LevelResources) {
        this.initialZ = mobyInstance.position.z;

        if (this.resources.levelNumber !== 3) {
            this.mobyInstance.rotation.x = Math.random() * 2 * Math.PI;
            this.mobyInstance.rotation.y = Math.random() * 2 * Math.PI;
            this.mobyInstance.rotation.z = Math.random() * 2 * Math.PI;
        } else {
            this.mobyInstance.rotation.y = Math.PI / 2;
            // TODO: collision snap
            updateTransform(this.mobyInstance);
        }
    }

    update(drawKit: MobyDrawKit) {
        if (this.resources.levelNumber !== 3) {
            this.mobyInstance.position.z = this.initialZ + 1 + 0.3 * Math.sin(this.phase);
            this.mobyInstance.rotation.x += 120 * (Math.PI / 180) * (drawKit.dt / 1000);
            this.mobyInstance.rotation.y += 40 * (Math.PI / 180) * (drawKit.dt / 1000);
            this.mobyInstance.rotation.z += 20 * (Math.PI / 180) * (drawKit.dt / 1000);
            this.phase += 90 * (Math.PI / 180) * (drawKit.dt / 1000);

            updateTransform(this.mobyInstance);
        }
    }

    drawAfterTies(drawKit: MobyDrawKit) {
    }

    drawAfterMobys(drawKit: MobyDrawKit) {
    }

    destroy(device: GfxDevice) {
    }
}
