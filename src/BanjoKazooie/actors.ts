import { GeometryRenderer, FlipbookRenderer, GeometryData, MovementController } from './render';
import { vec3, mat4 } from 'gl-matrix';
import { nArray, assertExists } from '../util';
import { MathConstants } from '../MathHelpers';
import { Sparkler, Emitter, SparkleColor } from './particles';
import { getPointHermite } from '../Spline';

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

class ShinyObject extends GeometryRenderer {
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


export interface RailNode {
    pos: vec3;
    next: number;
    isKeyframe: boolean;
    time: number;
}

export interface Rail {
    points: vec3[];
    // TODO: understand and parse these
    keyframes: number[];
    loopStart: number;
}

export function buildRails(nodes: (RailNode | undefined)[]): Rail[] {
    const allRails: Rail[] = [];
    const childNodes = new Set<number>();
    const usedNodes = new Set<number>();

    // preprocess
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        if (node === undefined)
            continue;
        if (node.next > nodes.length)
            node.next = 0;
        else
            childNodes.add(node.next);
    }

    for (let i = 1; i <= nodes.length; i++) {
        if (childNodes.has(i))
            continue;
        const startNode = nodes[i];
        if (startNode === undefined)
            continue;
        if (startNode.isKeyframe || startNode.next === 0)
            continue;

        const points = [startNode.pos];
        const keyframes: number[] = [];

        let nextIndex = startNode.next;
        usedNodes.clear();
        while (nextIndex !== 0) {
            const curr = nodes[nextIndex];
            if (curr === undefined) {
                console.warn('bad next node index', nextIndex);
                break;
            }
            if (curr.isKeyframe)
                keyframes.push(curr.time);
            else
                points.push(curr.pos);
            // an already used node indicates a loop, break after adding it
            if (usedNodes.has(nextIndex))
                break;
            usedNodes.add(nextIndex);

            nextIndex = curr.next;
        }

        keyframes.sort();

        // a point exactly equal to the last point indicates a loop in the rail
        let loopStart = 1;
        const lastPoint = points[points.length - 1];
        for (let i = 0; i < points.length - 1; i++) {
            if (vec3.exactEquals(points[i], lastPoint)) {
                loopStart = i / (points.length - 1);
                break;
            }
        }
        allRails.push({ points, keyframes, loopStart });
    }
    return allRails;
}

function getKeyframeIndex(rail: Rail, param: number): number {
    for (let i = 0; i < rail.keyframes.length; i++) {
        if (param <= rail.keyframes[i])
            return i;
    }
    return rail.keyframes.length;
}

const railScratch = nArray(2, () => vec3.create());
function rideRail(dst: vec3, rail: Rail, param: number, target: number): number {
    calcRailPos(dst, rail.points, param);
    if (target === 0)
        return param; // no movement required

    let step = target > 0 ? .01 : -.01;
    target = Math.abs(target);
    while (Math.abs(step) > 1e-7) {
        let trialDist = 0;
        let trialParam = param + step;
        if (rail.loopStart < 1 && (step > 0 && trialParam >= 1) || (step < 0 && trialParam < rail.loopStart)) {
            // shift by the loop length
            trialParam += (rail.loopStart - 1) * (step > 0 ? 1 : -1);
            // we've looped around, so break the path into two parts across the loop point
            // note that in reverse, any rail before the loop starts would be skipped
            calcRailPos(railScratch[0], rail.points, trialParam);
            vec3.copy(railScratch[1], rail.points[rail.points.length - 1]); // loop point is also the last
            // game does something different, which doesn't make physical sense but is faster?
            // it takes absolute value of the deltas' components, adds the new vectors, and uses *that* length
            trialDist = vec3.dist(dst, railScratch[1]) + vec3.dist(railScratch[1], railScratch[0]);
        } else {
            // clamp linear rails to endpoints
            if (rail.loopStart === 1)
                if (trialParam > 1)
                    trialParam = 1;
                else if (trialParam < 0)
                    trialParam = 0;
            calcRailPos(railScratch[0], rail.points, trialParam);
            trialDist = vec3.dist(dst, railScratch[0]);
        }

        const closeEnough = Math.abs(target - trialDist) < 0.1;
        if (trialDist < target || closeEnough) {
            param = trialParam;
            target -= trialDist;
            vec3.copy(dst, railScratch[0]);
            if (closeEnough)
                return param;
            // if we hit the end of a linear rail, we're done
            if (rail.loopStart === 1) {
                if (step > 0 && trialParam === 1)
                    return 1;
                if (step < 0 && trialParam === 0)
                    return 0;
            }
        } else {
            // we overshot, try again with a smaller step
            step /= 2;
        }
    }
    return param;
}

const s0Scratch = vec3.create();
const s1Scratch = vec3.create();
const railPointScratch: vec3[] = nArray(4, () => s0Scratch);
function calcRailPos(dst: vec3, pts: vec3[], t: number): void {
    if (t >= 1) {
        vec3.copy(dst, pts[pts.length - 1]);
        return;
    } else if (t <= 0) {
        vec3.copy(dst, pts[0]);
        return;
    }

    if (pts.length < 4) {
        railPointScratch[0] = pts[0];
        railPointScratch[1] = pts[0];
        railPointScratch[2] = pts[1];
        railPointScratch[3] = pts.length === 2 ? pts[1] : pts[2];
        calcRailPos(dst, railPointScratch, t);
        return;
    }

    const scaledParam = (pts.length - 1) * t;
    const startIndex = scaledParam >>> 0;

    const p0 = pts[startIndex];
    const p1 = pts[startIndex + 1];
    if (startIndex > 0)
        vec3.sub(s0Scratch, p1, pts[startIndex - 1]);
    else
        vec3.sub(s0Scratch, p1, p0);
    if (startIndex + 2 < pts.length)
        vec3.sub(s1Scratch, pts[startIndex + 2], p0);
    else
        vec3.sub(s1Scratch, p1, p0);

    vec3.scale(s0Scratch, s0Scratch, .5);
    vec3.scale(s1Scratch, s1Scratch, .5);

    for (let i = 0; i < 3; i++)
        dst[i] = getPointHermite(p0[i], p1[i], s0Scratch[i], s1Scratch[i], scaledParam % 1);
}

const railEulerScratch = nArray(2, () => vec3.create());
function calcRailEuler(dst: vec3, rail: Rail, param: number): void {
    calcRailPos(railEulerScratch[0], rail.points, param);
    let testParam = (param + .0001 >= 1) ? param - .0001 : param;
    rideRail(railEulerScratch[1], rail, testParam, 5);

    const delta = railEulerScratch[0];
    vec3.sub(delta, railEulerScratch[1], railEulerScratch[0]);
    dst[0] = -Math.atan2(delta[1], Math.hypot(delta[0], delta[2]));
    dst[1] = Math.atan2(delta[0], delta[2]);
    dst[2] = 0;
}

const riderScratch = vec3.create();
export class RailRider extends GeometryRenderer {
    public waitTimer = 0;
    public moveTimer = 0;
    public rail: Rail | null = null;

    constructor(geometryData: GeometryData) {
        super(geometryData);
    }

    public setRail(rails: Rail[]): void {
        mat4.getTranslation(riderScratch, this.modelMatrix);
        for (let i = 0; i < rails.length; i++) {
            for (let j = 0; j < rails[i].points.length; j++) {
                if (vec3.exactEquals(riderScratch, rails[i].points[j])) {
                    this.rail = rails[i];
                    this.moveTimer = j / (rails[i].points.length - 1);
                    break;
                }
            }
            if (this.rail !== null) {
                break;
            }
        }
    }

    protected movement(deltaSeconds: number): void {
        if (this.rail === null)
            return;
        if (this.waitTimer > 0) {
            this.waitTimer = Math.max(this.waitTimer - deltaSeconds, 0);
            if (this.waitTimer < 0)
                this.waitTimer = 0;
            return;
        }
        const oldTimer = this.moveTimer;
        this.moveTimer = rideRail(riderScratch, this.rail, this.moveTimer, 100 * deltaSeconds);
        mat4.fromTranslation(this.modelMatrix, riderScratch);
        calcRailEuler(riderScratch, this.rail, this.moveTimer);
        mat4.rotateY(this.modelMatrix, this.modelMatrix, riderScratch[1]);
        mat4.rotateX(this.modelMatrix, this.modelMatrix, riderScratch[0]);
        // no roll from a rail
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
        case 0x1d8: return new ShinyObject(geometryData, emitters, 1 / 60, 0, SparkleColor.DarkBlue);
        case 0x1d9: return new ShinyObject(geometryData, emitters, 1 / 60, 0, SparkleColor.Red);
        case 0x1da: return new ShinyObject(geometryData, emitters, 1 / 60);

        case 0x0e6: return new RailRider(geometryData); // gloop
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
    constructor(private modelVector: vec3) { }

    public movement(dst: mat4, _: number): void {
        mat4.fromTranslation(dst, this.modelVector);
    }
}
