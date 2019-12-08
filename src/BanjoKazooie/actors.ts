import { GeometryRenderer, FlipbookRenderer, GeometryData, MovementController } from './render';
import { vec3, mat4 } from 'gl-matrix';
import { nArray, assertExists } from '../util';
import { MathConstants } from '../MathHelpers';
import { Sparkler, Emitter, SparkleColor } from './particles';

export class ClankerTooth extends GeometryRenderer {
    constructor(geometryData: GeometryData, public index: number) {
        super(geometryData);
    }
}

const enum BoltState {
    InClanker,
    Rising,
    AtPeak,
    Falling,
}

const scratchVec = vec3.create();
export class ClankerBolt extends GeometryRenderer {
    public clankerVector: vec3;
    private boltState = BoltState.InClanker;
    private static peak = vec3.fromValues(2640, 5695, -10);

    protected movement(): void {
        let timer = this.animationController.getTimeInSeconds();
        vec3.copy(scratchVec, this.clankerVector);
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

export class ShinyObject extends GeometryRenderer {
    constructor(geometryData: GeometryData, emitters: Emitter[], sparkleRate: number, private turnRate: number = 0, sparkleColor: number = 3) {
        super(geometryData);
        for (let i = 0; i < 4; i++) {
            const sparkler = new Sparkler(sparkleRate, sparkleColor);
            sparkler.movementController = new ModelPin(assertExists(this.modelPointArray[i + 5]));
            emitters.push(sparkler);
        }
    }

    protected movement(deltaSeconds: number) {
        mat4.rotateY(this.modelMatrix, this.modelMatrix, deltaSeconds * this.turnRate * MathConstants.DEG_TO_RAD)
    }
}

// TODO: avoid having to thread the emitter list all the way through
export function createRenderer(emitters: Emitter[], objectID: number, geometryData: GeometryData): GeometryRenderer | FlipbookRenderer {
    switch (objectID) {
        case 0x043: return new ClankerBolt(geometryData);
        case 0x044: return new ClankerTooth(geometryData, 7); // left
        case 0x045: return new ClankerTooth(geometryData, 9); // right
        case 0x046: return new ShinyObject(geometryData, emitters, .015, 230); // jiggy
        case 0x047: return new ShinyObject(geometryData, emitters, .03, 200); // empty honeycomb
        case 0x1d8: return new ShinyObject(geometryData, emitters, 1/60, 0, SparkleColor.DarkBlue);
        case 0x1d9: return new ShinyObject(geometryData, emitters, 1/60, 0, SparkleColor.Red);
        case 0x1da: return new ShinyObject(geometryData, emitters, 1/60);
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

export class ModelPin implements MovementController {
    constructor(private modelVector: vec3) {}

    public movement(dst: mat4, _: number): void {
        mat4.fromTranslation(dst, this.modelVector);
    }
}