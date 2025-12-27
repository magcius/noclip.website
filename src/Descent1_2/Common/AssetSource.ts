import ArrayBufferSlice from "../../ArrayBufferSlice";
import {
    DescentEClip,
    DescentJoint,
    DescentPigBitmap,
    DescentPowerUp,
    DescentReactor,
    DescentRobot,
    DescentTmap,
    DescentVClip,
    DescentWClip,
} from "./AssetTypes";
import { DescentPolymodel } from "./Polymodel";

export abstract class DescentBitmapSource {
    /** 1 for Descent 1, 2 for Descent 2 */
    public abstract get gameVersion(): number;
    public abstract get bitmaps(): DescentPigBitmap[];
    public abstract loadBitmap(bitmap: DescentPigBitmap): ArrayBufferSlice;
}

export abstract class DescentGameDataSource {
    /** 1 for Descent 1, 2 for Descent 2 */
    public abstract get gameVersion(): number;
    public abstract get pigTextureIds(): number[];
    public abstract get tmaps(): DescentTmap[];
    public abstract get vclips(): DescentVClip[];
    public abstract get eclips(): DescentEClip[];
    public abstract get wclips(): DescentWClip[];
    public abstract get robots(): DescentRobot[];
    public abstract get joints(): DescentJoint[];
    public abstract get powerUps(): DescentPowerUp[];
    public abstract get polymodels(): DescentPolymodel[];
    public abstract get objBitmapIds(): number[];
    public abstract get objBitmapPointers(): number[];
    public abstract get reactors(): DescentReactor[];
    public abstract get playerModelNum(): number;
}
