import { ModelRenderer, buildTransform } from "./render";
import { ObjectSpawn, ActorDef, findGroundHeight, SpawnType, InteractionType, WaitParams, EndCondition, StateEdge, findGroundPlane, computePlaneHeight, fakeAux, CollisionTree } from "./room";
import { RenderData } from "../BanjoKazooie/render";
import { vec3, mat4 } from "gl-matrix";
import { assertExists, assert, nArray } from "../util";
import { ViewerRenderInput } from "../viewer";
import { MotionData, followPath, MotionResult, Motion, projectile, BasicMotionKind, vertical, motionBlockInit, randomCircle, linear, walkToTarget, faceTarget, canHearSong, Target, approachPoint } from "./motion";
import { Vec3One, lerp, MathConstants } from "../MathHelpers";
import { getPathPoint } from "./animation";
import { randomRange } from "../BanjoKazooie/particles";

interface Apple {
    translation: vec3;
    free: boolean;
    thrown: number;
}

const appleScratch = vec3.create();
export class LevelGlobals {
    public collision: CollisionTree | null = null;
    public currentSong = 0;
    public songStart = 0;
    public lastPesterBall = 0;
    public lastApple = 0;
    public allActors: Actor[] = [];
    public translation = vec3.create(); // camera position
    public apples: Apple[] = nArray(5, () => <Apple>{ translation: vec3.create(), free: true, thrown: 0 });

    public update(viewerInput: ViewerRenderInput): void {
        mat4.getTranslation(this.translation, viewerInput.camera.worldMatrix);

        if (viewerInput.time > this.songStart + 10000) {
            const r = (Math.random() * 6) >>> 0;
            if (r > 2)
                this.currentSong = 0;
            else
                this.currentSong = InteractionType.PokefluteA + r;
            this.songStart = viewerInput.time;
        }

        if (viewerInput.time > this.lastApple + 2500) {
            let freeApple: Apple | null = null;
            for (let i = 0; i < this.apples.length; i++) {
                if (!this.apples[i].free && viewerInput.time > this.apples[i].thrown + 10000) {
                    this.apples[i].free = true;
                    this.sendGlobalSignal(this.apples[i], InteractionType.AppleRemoved);
                }
                if (this.apples[i].free)
                    freeApple = this.apples[i];
            }

            if (freeApple === null)
                this.lastApple += 500; // wait a bit, then try again
            else {
                // choose a randomized landing point roughly in front of the camera
                // maybe replace with actual physics later?
                vec3.set(freeApple.translation, 0, 0, -1200);
                vec3.transformMat4(freeApple.translation, freeApple.translation, viewerInput.camera.worldMatrix);
                freeApple.translation[0] += randomRange(250);
                freeApple.translation[2] += randomRange(250);
                if (this.throwApple(freeApple)) {
                    freeApple.free = false;
                    freeApple.thrown = viewerInput.time;
                    this.lastApple = viewerInput.time;
                } else
                    this.lastApple += 500;
            }
        }
    }

    // send signals based on the ground type
    // each level actually has its own function
    private throwApple(apple: Apple): boolean {
        const ground = findGroundPlane(this.collision, apple.translation[0], apple.translation[2]);
        if (ground === null)
            return false;
        const groundHeight = computePlaneHeight(ground, apple.translation[0], apple.translation[2]);
        if (groundHeight < this.translation[1] - 1500)
            return false;
        switch (ground.type) {
            case 0x19FF: // valley whirlpool
                this.sendTargetedSignal(null, 0x2B, 0x802D3B34);
                return false;
            case 0xFF0000:
                return false;
            case 0xFF00:
                this.sendGlobalSignal(null, 0x26);
            case 0xFF4C19:
                return false; // lava splash
            case 0x337FB2:
            // spawn random fish
            case 0x19FF:
            case 0x7F66:
            case 0x4CCCCC:
                return false; // water splash
        }
        vec3.normalize(appleScratch, ground.normal);
        if (appleScratch[1] < Math.sqrt(3) / 2)
            return false;
        apple.translation[1] = groundHeight;
        this.sendGlobalSignal(apple, InteractionType.AppleLanded);
        return true;
    }

    public sendGlobalSignal(source: Target | null, signal: number): void {
        for (let i = 0; i < this.allActors.length; i++) {
            this.allActors[i].receiveSignal(source, signal, this);
        }
    }

    public sendTargetedSignal(source: Target | null, signal: number, targetPointer: number): void {
        for (let i = 0; i < this.allActors.length; i++) {
            if (this.allActors[i].def.globalPointer !== targetPointer)
                continue;
            this.allActors[i].receiveSignal(source, signal, this);
            break;
        }
    }
}

const cameraScratch = vec3.create();
export class Actor extends ModelRenderer {
    public motionData = new MotionData();
    protected currState = -1;
    protected currBlock = 0;
    protected currAux = 0;
    protected target: Target | null = null;

    private blockEnd = 0;
    private loopTarget = 1;
    private photoTimer = 0;

    public translation = vec3.create();
    public euler = vec3.create();
    public scale = vec3.clone(Vec3One);

    constructor(renderData: RenderData, public spawn: ObjectSpawn, public def: ActorDef, globals: LevelGlobals) {
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
            if (!this.chooseEdge(block.edges, globals)) {
                this.currBlock++;
                this.startBlock(globals);
            }
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
        this.currBlock = 0;
        this.startBlock(globals);
        return true;
    }

    protected startBlock(globals: LevelGlobals): void {
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

        for (let i = 0; i < block.signals.length; i++) {
            switch (block.signals[i].condition) {
                case InteractionType.Behavior:
                    if (this.spawn.behavior !== block.signals[i].conditionParam)
                        continue;
                    break;
                case InteractionType.OverSurface:
                    if (this.motionData.groundType !== 0x337FB2 && this.motionData.groundType !== 0x7F66 && this.motionData.groundType !== 0xFF4C19)
                        continue;
            }
            if (block.signals[i].target === 0)
                globals.sendGlobalSignal(this, block.signals[i].value);
            else
                globals.sendTargetedSignal(this, block.signals[i].value, block.signals[i].target);
        }

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

        if (block.eatApple && this.target !== null) {
            const apple = this.target as Apple;
            if (apple.free === undefined)
                console.warn("eating non apple");
            else {
                apple.free = true;
                globals.sendGlobalSignal(this.target, InteractionType.AppleRemoved);
            }
        }

        if (block.forwardSpeed !== undefined)
            this.motionData.forwardSpeed = block.forwardSpeed;

        if (block.motion !== null) {
            this.motionData.currMotion = block.motion;
            this.motionData.currBlock = 0;
            this.motionData.start = -1;
            this.motionData.stateFlags &= ~(EndCondition.Pause | EndCondition.Motion | EndCondition.Target);
        }

        if (block.wait !== null)
            this.blockEnd = this.animationController.getTimeInSeconds() + block.wait.duration + block.wait.durationRange * Math.random();
    }

    public receiveSignal(source: Target | null, signal: number, globals: LevelGlobals): boolean {
        if (this.currState === -1)
            return false;
        const block = this.def.stateGraph.states[this.currState].blocks[this.currBlock];
        if (block.wait === null)
            return false;
        // these are handled even if there's no corresponding edge
        if (signal === InteractionType.AppleRemoved || signal === InteractionType.TargetRemoved) {
            if (source !== this.target)
                return false;
            this.target = null;
        }
        for (let i = 0; i < block.wait.interactions.length; i++) {
            if (block.wait.interactions[i].type !== signal)
                continue;
            const distToSource = source !== null ? vec3.dist(this.translation, source.translation) : Infinity;
            switch (signal) {
                case InteractionType.PesterLanded: {
                    if (distToSource >= 150)
                        return false;
                    this.target = source;
                } break;
                case InteractionType.AppleLanded:
                case InteractionType.GravelerLanded: {
                    if (distToSource >= 600)
                        return false;
                    this.target = source;
                } break;
                case InteractionType.PhotoTaken: {
                    if (vec3.dist(this.translation, globals.translation) >= 400)
                        return false;
                    this.target = source;
                } break;
                case InteractionType.AppleRemoved:
                case InteractionType.TargetRemoved:
                    break; // just avoid setting the target
                default:
                    if (source !== null)
                        this.target = source;
            }
            return this.followEdge(block.wait.interactions[i], globals);
        }
        return false;
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
        let follow = false;
        for (let i = 0; i < edges.length; i++) {
            switch (edges[i].type) {
                case InteractionType.Basic:
                    follow = true; break;
                case InteractionType.Random: {
                    random -= edges[i].param;
                    follow = random < 0;
                } break;
                case InteractionType.Behavior:
                    follow = this.spawn.behavior === edges[i].param; break;
                case InteractionType.NonzeroBehavior:
                    follow = this.spawn.behavior !== 0; break;
                case InteractionType.Flag:
                case InteractionType.NotFlag: {
                    const metCondition = this.metEndCondition(edges[i].param, globals);
                    follow = metCondition === (edges[i].type === InteractionType.Flag);
                } break;
                case InteractionType.HasTarget:
                    follow = this.target !== null; break;
                case InteractionType.OverSurface:
                    follow = this.motionData.groundType === 0x337FB2 || this.motionData.groundType === 0x7F66 || this.motionData.groundType === 0xFF4C19; break;
            }
            if (follow)
                return this.followEdge(edges[i], globals);
        }
        return false;
    }

    protected metEndCondition(flags: number, globals: LevelGlobals): boolean {
        return (!!(flags & EndCondition.Dance) && !canHearSong(this.translation, globals)) ||
            (!!(flags & EndCondition.Timer) && this.animationController.getTimeInSeconds() >= this.blockEnd) ||
            (!!(flags & EndCondition.Animation) && this.renderers[this.headAnimationIndex].animator.loopCount >= this.loopTarget) ||
            ((flags & this.motionData.stateFlags) !== 0);
    }

    private basicInteractions(block: WaitParams, viewerInput: ViewerRenderInput, globals: LevelGlobals): boolean {
        mat4.getTranslation(cameraScratch, viewerInput.camera.worldMatrix);
        const playerDist = vec3.dist(this.translation, cameraScratch);
        const onScreen = viewerInput.camera.frustum.containsSphere(this.translation, 100) && !this.hidden;
        for (let i = 0; i < block.interactions.length; i++) {
            switch (block.interactions[i].type) {
                case InteractionType.PokefluteA:
                case InteractionType.PokefluteB:
                case InteractionType.PokefluteC: {
                    if (canHearSong(this.translation, globals) && block.interactions[i].type === globals.currentSong) {
                        this.target = globals;
                        return this.followEdge(block.interactions[i], globals);
                    }
                } break;
                case InteractionType.NearPlayer: {
                    if (playerDist < block.interactions[i].param) {
                        this.target = globals;
                        return this.followEdge(block.interactions[i], globals);
                    }
                } break;
                case InteractionType.PesterHit:
                case InteractionType.AppleHit: {
                    // hit at most every 10 seconds, and only if we're likely visible
                    if (viewerInput.time < globals.lastPesterBall + 10000 && playerDist > 400)
                        break;
                    if (playerDist < 1500 && onScreen && playerDist * Math.random() < viewerInput.deltaTime / 20) {
                        globals.lastPesterBall = viewerInput.time;
                        return this.followEdge(block.interactions[i], globals);
                    }
                } break;
                case InteractionType.PhotoFocus:
                case InteractionType.PhotoSubject: {
                    // trigger if the object is on screen long enough
                    if (onScreen && playerDist < 3000)
                        this.photoTimer += viewerInput.deltaTime;
                    else
                        this.photoTimer = 0;
                    // PhotoFocus specifies a number of frames, for PhotoSubject just choose three seconds
                    const limit = block.interactions[i].type === InteractionType.PhotoSubject ? 3000 : block.interactions[i].param / 30 * 1000;
                    if (this.photoTimer > limit) {
                        this.photoTimer = 0;
                        return this.followEdge(block.interactions[i], globals);
                    }
                } break;
                case InteractionType.FindApple: {
                    let nearest: Apple | null = null;
                    let dist = 600;
                    for (let i = 0; i < globals.apples.length; i++) {
                        if (!globals.apples[i].free)
                            continue;
                        const newDist = vec3.dist(this.translation, globals.apples[i].translation);
                        if (newDist < dist) {
                            dist = newDist;
                            nearest = globals.apples[i];
                        }
                    }
                    if (nearest !== null) {
                        this.target = nearest;
                        return this.followEdge(block.interactions[i], globals);
                    }
                } break;
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
            if (this.motionData.start < 0) {
                result = motionBlockInit(this.motionData, this.translation, this.euler, viewerInput, this.target);
                if (result === MotionResult.Done) {
                    this.motionData.currBlock++;
                    this.motionData.start = -1;
                    continue;
                }
            }
            const block: Motion = this.motionData.currMotion[this.motionData.currBlock];
            switch (block.kind) {
                case "animation": {
                    if (block.index !== this.currAnimation || block.force)
                        this.setAnimation(block.index);
                    result = MotionResult.Done;
                } break;
                case "path":
                    result = followPath(this.translation, this.euler, this.motionData, block, dt, globals); break;
                case "projectile":
                    result = projectile(this.translation, this.motionData, block, viewerInput.time, globals); break;
                case "vertical":
                    result = vertical(this.translation, this.euler, this.motionData, block, dt); break;
                case "random":
                    result = randomCircle(this.translation, this.euler, this.motionData, block, dt, globals); break;
                case "linear":
                    result = linear(this.translation, this.euler, this.motionData, block, dt, viewerInput.time); break;
                case "walkToTarget":
                    result = walkToTarget(this.translation, this.euler, this.motionData, block, this.target, dt, globals); break;
                case "faceTarget":
                    result = faceTarget(this.translation, this.euler, this.motionData, block, this.target, dt, globals); break;
                case "point":
                    result = approachPoint(this.translation, this.euler, this.motionData, globals, block, dt); break;
                case "basic": {
                    switch (block.subtype) {
                        case BasicMotionKind.Placeholder:
                        case BasicMotionKind.Wait: {
                            if ((viewerInput.time - this.motionData.start) / 1000 > block.param)
                                result = MotionResult.Done;
                            else
                                result = MotionResult.None;
                        } break;
                        case BasicMotionKind.Song: {
                            if (canHearSong(this.translation, globals))
                                result = MotionResult.None;
                            else
                                result = MotionResult.Done;
                        } break;
                        case BasicMotionKind.SetSpeed: {
                            this.motionData.forwardSpeed = block.param;
                            result = MotionResult.Done;
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
            this.motionData.stateFlags |= EndCondition.Motion;

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

class Charmander extends Actor {
    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        switch (state.startAddress) {
            case 0x802D94E8: {
                if (this.motionData.storedValues[0] === 0 && this.currBlock === 0 && (this.spawn.behavior === 1 || this.spawn.behavior === 2)) {
                    this.changeState(state.blocks[0].edges[0].index, globals);
                    return;
                }
            } break;
            case 0x802D97B8: {
                if (this.currBlock === 0) {
                    const targetBehavior = this.spawn.behavior === 1 ? 3 : 4;
                    this.target = globals.allActors.find((o) => o.spawn.id === this.spawn.id && o.spawn.behavior === targetBehavior)!;
                } else if (this.currBlock === 1)
                    this.motionData.storedValues[0] = 1;
            } break;
        }
        super.startBlock(globals);
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

const deltaScratch = vec3.create();
class Pikachu extends Actor {
    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        switch (this.currAux) {
            case 0x802CB814: {
                getPathPoint(this.motionData.destination, assertExists(this.spawn.path), 1);
                vec3.sub(deltaScratch, this.motionData.destination, this.translation);
                if (Math.hypot(deltaScratch[0], deltaScratch[2]) < 475) {
                    this.receiveSignal(this, 0x23, globals);
                    return MotionResult.Done;
                }
            } break;
        }
        return MotionResult.None;
    }
}

class Vulpix extends Actor {
    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        switch (this.currAux) {
            // runs both of these at the same time, second one is actually for cleanup
            case 0x802D9DFC:
            case 0x802D9E7C: {
                if (this.motionData.stateFlags & EndCondition.Misc)
                    return MotionResult.Done;
                getPathPoint(this.motionData.destination, assertExists(this.spawn.path), 1);
                vec3.sub(deltaScratch, this.motionData.destination, this.translation);
                if (Math.hypot(deltaScratch[0], deltaScratch[2]) < 1000) {
                    this.receiveSignal(this, 0x2C, globals);
                    return MotionResult.Done;
                }
            } break;
        }
        return MotionResult.None;
    }
}

class Weepinbell extends Actor {
    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        switch (state.startAddress) {
            case 0x802BF68C: {
                this.motionData.storedValues[1] = .08;
            } break;
            case 0x802BFA3C: {
                vec3.copy(this.motionData.destination, this.translation);
            } break;
        }
        super.startBlock(globals);
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

    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        if (state.startAddress === 0x802DD1D4)
            this.currBlock = this.spawn.behavior - 1;
        super.startBlock(globals);
        if (state.startAddress === 0x802DD0E0 && this.spawn.behavior === 1 && this.currAnimation !== 1)
            this.setAnimation(1);
        if (state.startAddress === 0x802DD398 && this.currBlock === 2 && this.spawn.behavior === 2)
            globals.sendGlobalSignal(this, 0x2B);
    }

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.currAux === 0x802DD53C) {
            if (this.motionData.auxStart < 0) {
                this.motionData.auxStart = viewerInput.time;
                assert(this.motionData.start >= 0, 'aux before path');
                getPathPoint(actorScratch, this.motionData.path!, 1);
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

export function createActor(renderData: RenderData, spawn: ObjectSpawn, def: ActorDef, globals: LevelGlobals): Actor {
    switch (def.id) {
        case 4: return new Charmander(renderData, spawn, def, globals);
        case 7: return new Squirtle(renderData, spawn, def, globals);
        case 14: return new Kakuna(renderData, spawn, def, globals);
        case 25: return new Pikachu(renderData, spawn, def, globals);
        case 37: return new Vulpix(renderData, spawn, def, globals);
        case 70: return new Weepinbell(renderData, spawn, def, globals);
        case 88: return new Grimer(renderData, spawn, def, globals);
        case 131: return new Lapras(renderData, spawn, def, globals);
        case 137: return new Porygon(renderData, spawn, def, globals);
    }
    return new Actor(renderData, spawn, def, globals);
}