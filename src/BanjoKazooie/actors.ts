import { GeometryRenderer, FlipbookRenderer, GeometryData, MovementController } from './render';
import { vec3, mat4 } from 'gl-matrix';
import { assertExists, nArray } from '../util';
import { MathConstants } from '../MathHelpers';

export class ClankerPart extends GeometryRenderer {
    public clankerVectors: vec3[];
}

export class ClankerTooth extends ClankerPart {
    constructor(geometryData: GeometryData, private isRight: boolean) {
        super(geometryData);
    }

    protected movement(): void {
        const vectorIndex = this.isRight ? 9 : 7;
        mat4.fromTranslation(this.modelMatrix, assertExists(this.clankerVectors[vectorIndex]));
    }
}

const enum BoltState {
    InClanker,
    Rising,
    AtPeak,
    Falling,
}

const scratchVec = vec3.create();
export class ClankerBolt extends ClankerPart {
    private boltState = BoltState.InClanker;
    private static peak = vec3.fromValues(2640, 5695, -10);

    protected movement(): void {
        let timer = this.animationController.getTimeInSeconds();
        vec3.copy(scratchVec, assertExists(this.clankerVectors[5]));
        let newState = this.boltState;

        switch (this.boltState) {
            case BoltState.InClanker:
                if (timer >= 2 && Math.hypot(scratchVec[0] - ClankerBolt.peak[0], scratchVec[2] - ClankerBolt.peak[2]) <= 60)
                    newState = BoltState.Rising;
                break;
            case BoltState.Rising:
                if (timer >= 1) newState = BoltState.AtPeak;
                break;
            case BoltState.AtPeak:
                if (timer >= 1) newState = BoltState.Falling;
                break;
            case BoltState.Falling:
                if (timer >= 1) newState = BoltState.InClanker;
                break;
        }
        if (this.boltState !== newState) {
            this.boltState = newState;
            timer = 0;
            this.animationController.setPhaseToCurrent();
        }

        switch (this.boltState) {
            case BoltState.InClanker: break; // already set
            case BoltState.Rising:
                vec3.lerp(scratchVec, scratchVec, ClankerBolt.peak, Math.sin(timer * Math.PI / 2));
                break;
            case BoltState.AtPeak:
                vec3.copy(scratchVec, ClankerBolt.peak);
                break;
            case BoltState.Falling:
                vec3.lerp(scratchVec, scratchVec, ClankerBolt.peak, Math.cos(timer * Math.PI / 2));
                break;
        }
        mat4.fromTranslation(this.modelMatrix, scratchVec);
    }
}

export function createRenderer(objectID: number, geometryData: GeometryData): GeometryRenderer | FlipbookRenderer {
    switch (objectID) {
        case 0x43: return new ClankerBolt(geometryData);
        case 0x44: return new ClankerTooth(geometryData, false);
        case 0x45: return new ClankerTooth(geometryData, true);
    }
    return new GeometryRenderer(geometryData);
}

const movementScratch = vec3.create();
class Bobber implements MovementController {
    private speed = 80 + 20 * Math.random();
    private basePos = vec3.create();
    private baseYaw = 0;
    private baseRoll = 0;
    private baseScale = 1;
    protected amplitudes = nArray(3, () => 0);

    constructor(obj: GeometryRenderer) {
        mat4.getTranslation(this.basePos, obj.modelMatrix);
        mat4.getScaling(movementScratch, obj.modelMatrix);
        this.baseScale = movementScratch[0]; // assume uniform
        // BK uses a slightly different convention than the existing logic
        this.baseRoll = Math.atan2(obj.modelMatrix[1], obj.modelMatrix[5]);
        this.baseYaw = -Math.atan2(obj.modelMatrix[2], obj.modelMatrix[0]);
        // nothing sets pitch, so ignore
    }

    public movement(dst: mat4, time: number) {
        const phase = time * this.speed * MathConstants.DEG_TO_RAD;
        mat4.fromYRotation(dst, this.baseYaw + Math.sin(phase) * this.amplitudes[0]);
        mat4.rotateX(dst, dst, Math.cos(phase) * this.amplitudes[1]);
        mat4.rotateZ(dst, dst, this.baseRoll);
        if (this.baseScale !== 1) {
            vec3.set(movementScratch, this.baseScale, this.baseScale, this.baseScale);
            mat4.scale(dst, dst, movementScratch);
        }
        dst[12] = this.basePos[0];
        dst[13] = this.basePos[1] + Math.sin(phase) * this.amplitudes[2];
        dst[14] = this.basePos[2];
    }
}

// these objects sink and tilt when Banjo lands on them
// inside Clanker, there's extra logic to move with the water level,
// but the sinking behavior doesn't trigger (maybe a bug)
export class SinkingBobber extends Bobber {
    constructor(obj: GeometryRenderer) {
        super(obj);
        this.amplitudes[0] = 2 * MathConstants.DEG_TO_RAD;
        this.amplitudes[1] = 4.5 * MathConstants.DEG_TO_RAD;
        this.amplitudes[2] = 10;
    }
}

export class WaterBobber extends Bobber {
    constructor(obj: GeometryRenderer) {
        super(obj);
        this.amplitudes[0] = 3 * MathConstants.DEG_TO_RAD;
        this.amplitudes[1] = 7.5 * MathConstants.DEG_TO_RAD;
        this.amplitudes[2] = 20;
    }
}
