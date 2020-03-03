import { ModelRenderer, buildTransform, LevelGlobals } from "./render";
import { ObjectSpawn, ObjectDef, findGroundHeight, SpawnType, InteractionType, WaitParams, EndCondition, StateEdge, findGroundPlane, computePlaneHeight, fakeAux } from "./room";
import { RenderData } from "../BanjoKazooie/render";
import { vec3, mat4 } from "gl-matrix";
import { assertExists, assert, hexzero } from "../util";
import { ViewerRenderInput } from "../viewer";
import { MotionData, followPath, MotionResult, Motion, projectile, BasicMotionKind, vertical, motionBlockInit, randomCircle } from "./motion";
import { Vec3One, lerp, MathConstants } from "../MathHelpers";
import { getPathPoint } from "./animation";

function sendGlobalSignal(source: Actor, signal: number, globals: LevelGlobals): void {
    for (let i = 0; i < globals.allActors.length; i++) {
        globals.allActors[i].receiveSignal(source, signal, globals);
    }
}

function sendSignalToID(source: Actor, signal: number, targetID: number, globals: LevelGlobals): void {
    for (let i = 0; i < globals.allActors.length; i++) {
        if (globals.allActors[i].def.id !== targetID)
            continue;
        globals.allActors[i].receiveSignal(source, signal, globals);
        break;
    }
}

const cameraScratch = vec3.create();
export class Actor extends ModelRenderer {
    public motionData = new MotionData();
    protected currState = -1;
    protected currBlock = 0;
    protected currAux = 0;

    private blockEnd = 0;
    private loopTarget = 1;
    private photoTimer = 0;
    private target: Actor | null = null;

    protected translation = vec3.create();
    protected euler = vec3.create();
    protected scale = vec3.clone(Vec3One);

    constructor(renderData: RenderData, public spawn: ObjectSpawn, public def: ObjectDef, globals: LevelGlobals) {
        super(renderData, def.nodes, def.stateGraph.animations);
        this.motionData.path = spawn.path;
        this.reset(globals);
    }

    protected reset(globals: LevelGlobals): void {
        // set transform components
        vec3.copy(this.translation, this.spawn.pos);
        if (this.def.spawn === SpawnType.GROUND)
            this.translation[1] = findGroundHeight(globals.collision, this.spawn.pos[0], this.spawn.pos[2]);

        vec3.copy(this.euler, this.spawn.euler);

        vec3.mul(this.scale, this.def.scale, this.spawn.scale);
        buildTransform(this.modelMatrix, this.translation, this.spawn.euler, this.scale);

        this.motionData.reset();

        const ground = findGroundPlane(globals.collision, this.translation[0], this.translation[2]);
        this.motionData.groundHeight = computePlaneHeight(ground, this.translation[0], this.translation[2]);
        this.motionData.groundType = 0;
        if (ground !== null)
            this.motionData.groundType = ground.type;

        this.currAux = 0;
        if (this.animations.length > 0)
            this.setAnimation(0);

        if (this.def.stateGraph.states.length > 0)
            this.changeState(0, globals);
    }

    protected motion(viewerInput: ViewerRenderInput, globals: LevelGlobals): void {
        let updated = this.motionStep(viewerInput, globals);
        if (this.auxStep(viewerInput, globals))
            updated = true;
        if (updated)
            buildTransform(this.modelMatrix, this.translation, this.euler, this.scale);
        while (this.currState >= 0) {
            const state = this.def.stateGraph.states[this.currState];
            const result = this.stateOverride(state.startAddress, viewerInput, globals);
            if (result === MotionResult.Update)
                continue;
            else if (result === MotionResult.Done)
                break;
            const block = state.blocks[this.currBlock];
            if (block.wait !== null) {
                if (block.wait.allowInteraction && this.basicInteractions(block.wait, viewerInput, globals))
                    continue;
                if (!this.metEndCondition(block.wait.endCondition, globals))
                    break;
            }
            if (!this.chooseEdge(block.edges, globals))
                this.nextBlock(globals);
        }
    }

    // for actors with special state logic
    protected stateOverride(stateAddr: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        return MotionResult.None;
    }

    protected changeState(newIndex: number, globals: LevelGlobals): boolean {
        if (newIndex === -1)
            return false;
        if (this.def.stateGraph.states[newIndex].doCleanup && this.def.stateGraph.states[newIndex].blocks.length === 0)
            return false; // ignore states that just get rid of the object
        this.currState = newIndex;
        this.currBlock = -1;
        this.nextBlock(globals);
        return true;
    }

    private nextBlock(globals: LevelGlobals): void {
        this.currBlock++;
        const state = this.def.stateGraph.states[this.currState];
        if (this.currBlock >= state.blocks.length) {
            if (state.doCleanup)
                this.hidden = true;
            this.currState = -1;
            return;
        }

        const block = state.blocks[this.currBlock];
        if (block.animation >= 0) {
            if (block.animation !== this.currAnimation || block.force)
                this.setAnimation(block.animation);
            const currLoops = assertExists(this.renderers[this.headAnimationIndex]).animator.loopCount;
            this.loopTarget = currLoops + (block.wait !== null && block.wait.loopTarget > 0 ? block.wait.loopTarget : 1);
        }

        if (block.signal > 0)
            sendGlobalSignal(this, block.signal, globals);

        if (block.auxAddress >= 0) {
            this.currAux = block.auxAddress;
            if (block.auxAddress > 0) {
                this.motionData.stateFlags &= ~EndCondition.Aux;
                this.motionData.auxStart = -1;
            } else
                this.motionData.stateFlags |= EndCondition.Aux;
        }

        if (block.flagSet !== 0)
            this.motionData.stateFlags |= block.flagSet;
        if (block.flagClear !== 0)
            this.motionData.stateFlags &= ~block.flagClear;

        if (block.flagSet & EndCondition.Hidden)
            this.hidden = true;
        if (block.flagClear & EndCondition.Hidden)
            this.hidden = false;

        if (block.flagSet & EndCondition.PauseAnim)
            this.animationPaused = true;
        if (block.flagClear & EndCondition.PauseAnim)
            this.animationPaused = false;

        if (block.ignoreGround !== undefined)
            this.motionData.ignoreGround = block.ignoreGround;

        if (block.motion !== null) {
            this.motionData.currMotion = block.motion;
            this.motionData.currBlock = 0;
            this.motionData.start = -1;
            this.motionData.stateFlags &= ~(EndCondition.Pause | EndCondition.Motion | EndCondition.Target);
        }

        if (block.wait !== null)
            this.blockEnd = this.animationController.getTimeInSeconds() + block.wait.duration + block.wait.durationRange * Math.random();
    }

    public receiveSignal(source: Actor, signal: number, globals: LevelGlobals): void {
        if (this.currState === -1)
            return;
        const block = this.def.stateGraph.states[this.currState].blocks[this.currBlock];
        if (block.wait === null)
            return;
        for (let i = 0; i < block.wait.interactions.length; i++) {
            if (block.wait.interactions[i].type !== signal)
                continue;
            const distToSource = vec3.dist(this.renderers[0].translation, source.renderers[0].translation);
            switch (signal) {
                case 0x0A: {
                    if (distToSource >= 150)
                        return;
                    this.target = source;
                    // set apple
                } break;
                case 0x0E:
                case 0x14: {
                    if (distToSource >= 600)
                        return;
                    this.target = source;
                    // 0E sets apple
                } break;
                case 0x12: {
                    // player distance < 400?
                    this.target = source;
                } break;
                case 0x15: // only allowed from apple?
                case 0x16: {
                    if (source !== this.target)
                        return;
                } break;
                default:
                    this.target = source;
            }
            this.followEdge(block.wait.interactions[i], globals);
            break;
        }
    }

    private followEdge(edge: StateEdge, globals: LevelGlobals): boolean {
        if (edge.auxFunc !== 0) {
            this.currAux = edge.auxFunc;
            this.motionData.stateFlags &= ~EndCondition.Aux;
            this.motionData.auxStart = -1;
        }
        return this.changeState(edge.index, globals);
    }

    private chooseEdge(edges: StateEdge[], globals: LevelGlobals): boolean {
        let random = Math.random();
        let done = false;
        for (let i = 0; i < edges.length; i++) {
            switch (edges[i].type) {
                case InteractionType.Basic:
                    done = true; break;
                case InteractionType.Random: {
                    random -= edges[i].param;
                    done = random < 0;
                } break;
                case InteractionType.Behavior:
                    done = this.spawn.behavior === edges[i].param; break;
                case InteractionType.NonzeroBehavior:
                    done = this.spawn.behavior !== 0; break;
                case InteractionType.Flag:
                case InteractionType.NotFlag: {
                    const metCondition = this.metEndCondition(edges[i].param, globals);
                    done = metCondition === (edges[i].type === InteractionType.Flag);
                } break;
                case InteractionType.HasTarget:
                    done = this.target !== null; break;
                case InteractionType.OverWater:
                    done = this.motionData.groundType === 0x337FB2 || this.motionData.groundType === 0x7F66; break;
            }
            if (done)
                return this.followEdge(edges[i], globals);
        }
        return false;
    }

    protected metEndCondition(flags: number, globals: LevelGlobals): boolean {
        return (!!(flags & EndCondition.Dance) && globals.currentSong === 0) ||
            (!!(flags & EndCondition.Timer) && this.animationController.getTimeInSeconds() >= this.blockEnd) ||
            (!!(flags & EndCondition.Animation) && this.renderers[this.headAnimationIndex].animator.loopCount >= this.loopTarget) ||
            ((flags & this.motionData.stateFlags) !== 0);
    }

    private basicInteractions(block: WaitParams, viewerInput: ViewerRenderInput, globals: LevelGlobals): boolean {
        mat4.getTranslation(cameraScratch, viewerInput.camera.worldMatrix);
        const playerDist = vec3.dist(this.translation, cameraScratch);
        const onScreen = viewerInput.camera.frustum.containsSphere(this.translation, 100);
        for (let i = 0; i < block.interactions.length; i++) {
            switch (block.interactions[i].type) {
                case InteractionType.PokefluteA:
                case InteractionType.PokefluteB:
                case InteractionType.PokefluteC: {
                    // game radius is 1400 for song effects
                    if (playerDist < 3000 && block.interactions[i].type === globals.currentSong) {
                        return this.followEdge(block.interactions[i], globals);
                    }
                } break;
                case InteractionType.NearPlayer: {
                    if (playerDist < block.interactions[i].param) {
                        return this.followEdge(block.interactions[i], globals);
                    }
                } break;
                case InteractionType.PesterBall:
                case InteractionType.AppleHit: {
                    // hit at most every 10 seconds, and only if we're likely visible
                    if (viewerInput.time < globals.lastPesterBall + 10000 && playerDist > 400)
                        break;
                    if (playerDist < 1500 && onScreen && playerDist * Math.random() < viewerInput.deltaTime / 20) {
                        globals.lastPesterBall = viewerInput.time;
                        return this.followEdge(block.interactions[i], globals);
                    }
                } break;
                case InteractionType.Photo: {
                    if (onScreen && !this.hidden && playerDist < 4000)
                        this.photoTimer += viewerInput.deltaTime;
                    else
                        this.photoTimer = 0;
                    if (this.photoTimer > 3000) {
                        this.photoTimer = 0;
                        return this.followEdge(block.interactions[i], globals);
                    }
                }
            }
        }
        return false;
    }

    protected motionStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): boolean {
        if (this.motionData.currMotion.length === 0)
            return false;
        const dt = viewerInput.deltaTime / 1000;
        let result = MotionResult.None;
        let updated = false;
        while (this.motionData.currBlock < this.motionData.currMotion.length) {
            if (this.motionData.start < 0)
                motionBlockInit(this.motionData, this.translation, this.euler, viewerInput);
            const block: Motion = this.motionData.currMotion[this.motionData.currBlock];
            switch (block.kind) {
                case "animation": {
                    if (block.index !== this.currAnimation || block.force)
                        this.setAnimation(block.index);
                } break;
                case "path":
                    result = followPath(this.translation, this.euler, this.motionData, block, dt, globals); break;
                case "projectile":
                    result = projectile(this.translation, this.motionData, block, viewerInput.time, globals); break;
                case "vertical":
                    result = vertical(this.translation, this.euler, this.motionData, block, dt); break;
                case "random":
                    result = randomCircle(this.translation, this.euler, this.motionData, block, dt, globals); break;
                case "basic": {
                    switch (block.subtype) {
                        case BasicMotionKind.Placeholder:
                        case BasicMotionKind.Wait: {
                            if ((viewerInput.time - this.motionData.start) / 1000 > block.param)
                                result = MotionResult.Done;
                            else
                                result = MotionResult.None;
                        } break;
                    }
                } break;
            }
            if (result !== MotionResult.None)
                updated = true;
            if (result === MotionResult.Done) {
                this.motionData.currBlock++;
                this.motionData.start = -1;
            } else
                break;
        }
        if (this.motionData.currBlock >= this.motionData.currMotion.length)
            this.motionData.stateFlags |= EndCondition.Motion | EndCondition.Target;

        result = this.auxStep(viewerInput, globals);
        if (result !== MotionResult.None)
            updated = true;
        if (result === MotionResult.Done) {
            this.currAux = 0;
            this.motionData.stateFlags |= EndCondition.Aux;
        }
        return updated;
    }

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        return MotionResult.None;
    }
}

class Squirtle extends Actor {
    private depth = -95;

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.currAux === 0x802CBA90) {
            if (this.motionData.auxStart < 0)
                this.motionData.auxStart = viewerInput.time;
            const water = findGroundHeight(globals.collision, this.translation[0], this.translation[2]);
            const t = (viewerInput.time - this.motionData.auxStart) / 1000;
            this.translation[1] = water + 10 * Math.sin(t / 1.5 * MathConstants.TAU) + this.depth;
            this.depth = Math.min(this.depth + 60 * viewerInput.deltaTime / 1000, -45);
            return MotionResult.Update;
        }
        return MotionResult.None;
    }
}

class Kakuna extends Actor {
    protected reset(globals: LevelGlobals): void {
        super.reset(globals);
        this.motionData.storedValues[0] = this.translation[1];
        this.motionData.storedValues[1] = this.motionData.groundHeight + 25;
    }
}

class Grimer extends Actor {
    private static flags = 0;

    protected stateOverride(addr: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        let mask = 0;
        switch (addr) {
            case 0x802C0960:
                mask = 1; break;
            case 0x802C09C4:
                mask = 2; break;
            case 0x802C0A28:
                mask = 4; break;
            case 0x802C0A8C:
                mask = 8; break;
        }
        // the listed functions wait for the given bit to be set
        // if it is, let the state logic run, making the actor appear
        if (!!(Grimer.flags & mask) || mask === 0)
            return MotionResult.None;
        else
            return MotionResult.Done;
    }

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.currAux === 0x802C1018) {
            Grimer.flags |= 1 << (this.spawn.behavior - 1);
            return MotionResult.Done;
        }
        return MotionResult.None;
    }
}

// effectively the same extra logic as Grimer, but done in a more confusing way
class Lapras extends Actor {
    private static flags = 0;

    protected stateOverride(addr: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        let mask = 0;
        switch (addr) {
            case 0x802C816C:
                mask = 1; break;
            case 0x802C81C4:
                mask = 2; break;
            case 0x802C821C:
                mask = 4; break;
        }
        if (!!(Lapras.flags & mask) || mask === 0)
            return MotionResult.None;
        else
            return MotionResult.Done;
    }

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.currAux === fakeAux) {
            // this is handled in a much more complicated way using state transitions,
            // possibly to ensure the values are only changed once, though it doesn't matter
            Lapras.flags |= 1 << this.spawn.behavior;
            if (this.spawn.behavior === 2)
                Lapras.flags |= 2;
            return MotionResult.Done;
        }
        return MotionResult.None;
    }
}

const actorScratch = vec3.create();
class Porygon extends Actor {
    private startAngle = 0;
    private amplitude = 0;
    private endHeight = 0;

    protected stateOverride(addr: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        switch (addr) {
            case 0x802DD0E0: {
                if (this.spawn.behavior === 1 && this.currAnimation !== 1)
                    this.setAnimation(1);
            } break;
            case 0x802DD1D4: {
                // should see if signals matter, as this skips proper handling
                this.currBlock = this.spawn.behavior - 1;
            } break;
            case 0x802DD398: {
                if (this.currBlock === 2 && this.spawn.behavior === 2)
                    sendSignalToID(this, 0x2B, 1019, globals);
            } break;
        }

        return MotionResult.None;
    }

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.currAux === 0x802DD53C) {
            if (this.motionData.auxStart < 0) {
                this.motionData.auxStart = viewerInput.time;
                assert(this.motionData.start >= 0, 'aux before path');
                getPathPoint(actorScratch, this.motionData.path!, 1);
                vec3.scale(actorScratch, actorScratch, 100);
                this.endHeight = findGroundHeight(globals.collision, actorScratch[0], actorScratch[2]);
                this.amplitude = this.translation[1] + 50 - this.endHeight;
                this.startAngle = Math.asin((this.translation[1] - this.endHeight) / this.amplitude);
            }
            const frac = (viewerInput.time - this.motionData.auxStart) / 1000 * 3 / this.motionData.path!.duration;
            if (frac > 1)
                return MotionResult.Done;
            this.translation[1] = this.endHeight + this.amplitude * Math.sin(lerp(this.startAngle, Math.PI, frac));
            return MotionResult.Update;
        }
        return MotionResult.None;
    }
}

export function createActor(renderData: RenderData, spawn: ObjectSpawn, def: ObjectDef, globals: LevelGlobals): Actor {
    switch (def.id) {
        case 7: return new Squirtle(renderData, spawn, def, globals);
        case 14: return new Kakuna(renderData, spawn, def, globals);
        case 88: return new Grimer(renderData, spawn, def, globals);
        case 131: return new Lapras(renderData, spawn, def, globals);
        case 137: return new Porygon(renderData, spawn, def, globals);
    }
    return new Actor(renderData, spawn, def, globals);
}