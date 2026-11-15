import { MobyInstance } from "../bin-gameplay";
import { LevelResources } from "../loader";
import { MobyUpdateKit, MobyImpl } from "./moby";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";
import { Water_B } from "./water-b";
import { Water_C } from "./water-c";
import { Water_F } from "./water-f";

// this one moby implements water kinds B, C, and F
// TODO: this should take the dynamic lava texture from kind F and make kind B and C use it too
export class Water_Gaspar implements MobyImpl {
    private childImplB: Water_B;
    private childImplC: Water_C;
    private childImplF: Water_F;

    constructor(private mobyInstance: MobyInstance, private resources: LevelResources) {
        this.childImplB = new Water_B(mobyInstance, resources);
        this.childImplC = new Water_C(mobyInstance, resources);
        this.childImplF = new Water_F(mobyInstance, resources);
    }

    update(updateKit: MobyUpdateKit) {
        this.childImplB.update(updateKit);
        this.childImplC.update(updateKit);
        this.childImplF.update(updateKit);
    }

    drawAfterTies(updateKit: MobyUpdateKit) {
        this.childImplB.drawAfterTies(updateKit);
        this.childImplC.drawAfterTies(updateKit);
        this.childImplF.drawAfterTies(updateKit);
    }

    drawAfterMobys(updateKit: MobyUpdateKit) {
        this.childImplB.drawAfterMobys(updateKit);
        this.childImplC.drawAfterMobys(updateKit);
        this.childImplF.drawAfterMobys(updateKit);
    }

    destroy(device: GfxDevice) {
        this.childImplB.destroy(device);
        this.childImplC.destroy(device);
        this.childImplF.destroy(device);
    }
}
