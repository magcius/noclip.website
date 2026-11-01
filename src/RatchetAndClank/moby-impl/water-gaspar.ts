import { assert } from "../../util";
import { MobyInstance } from "../bin-gameplay";
import { OverlaySection } from "../bin-overlay";
import { LevelResources } from "../loader";
import { MobyDrawKit, MobyImpl } from "./moby";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";
import { Water_B } from "./water-b";
import { Water_C } from "./water-c";
import { Water_F } from "./water-f";

// this one moby implements water kinds B, C, and F
// TODO: this should take the dynamic lava texture from kind F and make kind B and C use it too
export class Water_Gaspar implements MobyImpl {
    overlaySections: OverlaySection[];

    childImplB: Water_B;
    childImplC: Water_C;
    childImplF: Water_F;

    constructor(private mobyInstance: MobyInstance, private resources: LevelResources) {
        assert(resources.overlaySections !== null);
        this.overlaySections = resources.overlaySections;

        this.childImplB = new Water_B(mobyInstance, resources);
        this.childImplC = new Water_C(mobyInstance, resources);
        this.childImplF = new Water_F(mobyInstance, resources);
    }

    update(drawKit: MobyDrawKit) {
        this.childImplB.update(drawKit);
        this.childImplC.update(drawKit);
        this.childImplF.update(drawKit);
    }

    drawAfterTies(drawKit: MobyDrawKit) {
        this.childImplB.drawAfterTies(drawKit);
        this.childImplC.drawAfterTies(drawKit);
        this.childImplF.drawAfterTies(drawKit);
    }

    drawAfterMobys(drawKit: MobyDrawKit) {
        this.childImplB.drawAfterMobys(drawKit);
        this.childImplC.drawAfterMobys(drawKit);
        this.childImplF.drawAfterMobys(drawKit);
    }

    destroy(device: GfxDevice) {
        this.childImplB.destroy(device);
        this.childImplC.destroy(device);
        this.childImplF.destroy(device);
    }
}
