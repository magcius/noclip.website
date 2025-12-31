import { vec3 } from "gl-matrix";
import { DescentObject, DescentObjectType } from "./LevelObject";
import { DescentSegment, DescentWall } from "./LevelTypes";

export class DescentLightDelta {
    constructor(
        public segmentNum: number,
        public sideNum: number,
        public vertexLightDeltas: [number, number, number, number],
    ) {}
}

export class DescentFlickeringLight {
    public deltas: DescentLightDelta[] = [];

    constructor(
        public segmentNum: number,
        public sideNum: number,
        public mask: number,
        public timer: number,
        public delay: number,
        public isOn: boolean,
    ) {}
}

/**
 * A registered level in Descent (.RDL) or Descent 2 (.RL2).
 */
export abstract class DescentLevel {
    /** 1 for Descent 1, 2 for Descent 2 */
    public abstract get gameVersion(): number;
    /** Descent 2 levels can have different palettes,
     * but in Descent 1, this is hardcoded. */
    public abstract get paletteName(): string;
    public abstract get vertices(): vec3[];
    public abstract get segments(): DescentSegment[];
    public abstract get walls(): DescentWall[];
    public abstract get objects(): DescentObject[];
    public abstract get flickeringLights(): DescentFlickeringLight[];

    /** Whether an object should be rendered. */
    public objectShouldBeVisible(object: DescentObject): boolean {
        if (object.type === DescentObjectType.GHOST) {
            return false;
        }
        if (object.type === DescentObjectType.PLAYER) {
            // Render only the main player spawn
            return object.subtypeId === 0;
        }
        if (object.type === DescentObjectType.COOP) {
            // Render only the main player spawn
            return false;
        }
        if (object.type === DescentObjectType.POWERUP) {
            // Do not render flags.
            switch (object.subtypeId) {
                case 46:
                case 47:
                    return false;
            }
        }
        return true;
    }

    public abstract destroy(): void;
}
