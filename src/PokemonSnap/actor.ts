import { ModelRenderer, buildTransform } from "./render";
import { ObjectSpawn, ActorDef, findGroundHeight, SpawnType, InteractionType, WaitParams, EndCondition, StateEdge, findGroundPlane, computePlaneHeight, fakeAux, CollisionTree, ProjectileData, ObjectField, Level, GFXNode, AnimationData } from "./room";
import { RenderData } from "../BanjoKazooie/render";
import { vec3, mat4 } from "gl-matrix";
import { assertExists, assert, nArray } from "../util";
import { ViewerRenderInput } from "../viewer";
import { MotionData, followPath, MotionResult, Motion, projectile, BasicMotionKind, vertical, motionBlockInit, randomCircle, linear, walkToTarget, faceTarget, canHearSong, Target, approachPoint, attemptMove, MoveFlags } from "./motion";
import { Vec3One, lerp, MathConstants, getMatrixAxisZ, reflectVec3, normToLength, Vec3Zero, transformVec3Mat4w0 } from "../MathHelpers";
import { getPathPoint } from "./animation";
import { ObjectDef } from "./room";

const throwScratch = nArray(2, () => vec3.create());
export class LevelGlobals {
    public collision: CollisionTree | null = null;
    public currentSong = 0;
    public songStart = 0;
    public allActors: Actor[] = [];
    public translation = vec3.create(); // camera position

    public lastThrow = -1;
    public projectiles: Projectile[] = [];
    public pesterNext = false;

    public splashes: Splash[] = [];
    public zeroOne: ModelRenderer;

    constructor(public id: string) { }

    public update(viewerInput: ViewerRenderInput): void {
        mat4.getTranslation(this.translation, viewerInput.camera.worldMatrix);

        if (viewerInput.time > this.songStart + 10000) {
            if (this.currentSong !== 0)
                this.currentSong = 0;
            else
                this.currentSong = InteractionType.PokefluteA + ((Math.random() * 3) >>> 0);
            this.songStart = viewerInput.time;
        }

        if (this.lastThrow < 0)
            this.lastThrow = viewerInput.time + 3000; // extra wait before the first throw

        if (viewerInput.time > this.lastThrow + 2500) {
            let didThrow = false;
            // if we're above ground, throw the next type of projectile
            if (this.translation[1] > findGroundHeight(this.collision, this.translation[0], this.translation[2]) + 20) {
                getMatrixAxisZ(throwScratch[0], viewerInput.camera.worldMatrix);
                vec3.scale(throwScratch[0], throwScratch[0], -1);
                if (viewerInput.deltaTime > 0) {
                    vec3.scale(throwScratch[1], viewerInput.camera.linearVelocity, 1000 / viewerInput.deltaTime);
                    transformVec3Mat4w0(throwScratch[1], viewerInput.camera.worldMatrix, throwScratch[1]);
                } else
                    vec3.copy(throwScratch[1], Vec3Zero);

                for (let i = 0; i < this.projectiles.length; i++) {
                    if (this.projectiles[i].isPester === this.pesterNext && this.projectiles[i].tryThrow(this.translation, throwScratch[0], throwScratch[1])) {
                        didThrow = true;
                        break;
                    }
                }
            }
            if (didThrow) {
                this.lastThrow = viewerInput.time;
                this.pesterNext = !this.pesterNext; // alternate apple and pester ball
            } else
                this.lastThrow += 500; // wait a bit, then try again
        }
    }

    // TODO: pick a fish based on level logic
    public spawnFish(pos: vec3): void { }

    public createSplash(type: SplashType, pos: vec3, scale = Vec3One): void {
        for (let i = 0; i < this.splashes.length; i++) {
            if (this.splashes[i].type === type && this.splashes[i].tryStart(pos, scale, this))
                break;
        }
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

    public buildTempObjects(defs: ObjectDef[], data: RenderData[], zeroOneData: RenderData, projData: RenderData[], level: Level): ModelRenderer[] {
        const out: ModelRenderer[] = [];

        this.zeroOne = new ModelRenderer(zeroOneData, level.zeroOne.nodes, level.zeroOne.animations);
        out.push(this.zeroOne);

        // projectiles
        for (let t = 0; t < 2; t++) {
            for (let i = 0; i < 5; i++) {
                const proj = new Projectile(projData[t], level.projectiles[t], t === 1);
                this.projectiles.push(proj);
                out.push(proj);
            }
        }

        // projectile splashes
        for (let t = 2; t < 4; t++) {
            const type = t === 2 ? SplashType.AppleWater : SplashType.AppleLava;
            for (let i = 0; i < 3; i++) {
                const splash = new Splash(projData[t], level.projectiles[t].nodes, level.projectiles[t].animations, type, projectileScale);
                this.splashes.push(splash);
                out.push(splash);
            }
        }

        const splashIndex = defs.findIndex((d) => d.id === 1003);
        if (splashIndex >= 0) {
            const splashDef = defs[splashIndex] as ActorDef;
            for (let i = 0; i < 5; i++) {
                const splash = new Splash(data[splashIndex], splashDef.nodes, splashDef.stateGraph.animations, SplashType.Water, splashDef.scale);
                this.splashes.push(splash);
                out.push(splash);
            }
        }

        return out;
    }
}

const projectileScale = vec3.fromValues(.1, .1, .1);
const impactScratch = nArray(2, () => vec3.create());
const groundScratch = vec3.create();
export class Projectile extends ModelRenderer {
    public translation = vec3.create();
    public velocity = vec3.create();
    public landedAt = 0;
    public inWater = false;

    public static maxSlope = Math.sqrt(3) / 2; // y normal for thirty degree slope
    public static minSpeed = 390;

    constructor(renderData: RenderData, public def: ProjectileData, public isPester: boolean) {
        super(renderData, def.nodes, def.animations);
        this.visible = false;
    }

    public distFrom(pos: vec3): number {
        if (!this.visible || this.hidden || this.landedAt === 0)
            return Infinity;
        return vec3.dist(pos, this.translation);
    }

    public tryThrow(pos: vec3, dir: vec3, cameraVel: vec3): boolean {
        if (this.visible)
            return false;
        this.visible = true;
        this.landedAt = 0;
        this.inWater = false;
        this.animationPaused = false;
        this.setAnimation(0);
        vec3.normalize(this.velocity, dir);
        vec3.scale(this.velocity, this.velocity, 1500);
        vec3.scaleAndAdd(this.translation, pos, this.velocity, 1 / 10);
        vec3.add(this.velocity, this.velocity, cameraVel);
        mat4.fromScaling(this.modelMatrix, projectileScale);
        return true;
    }

    public eat(globals: LevelGlobals): void {
        this.visible = false;
        globals.sendGlobalSignal(this, InteractionType.AppleRemoved);
    }

    protected motion(viewerInput: ViewerRenderInput, globals: LevelGlobals): void {
        const dt = viewerInput.deltaTime / 1000;
        if (this.landedAt > 0) {
            const frames = 30 * (viewerInput.time - this.landedAt) / 1000;
            if (this.inWater) {
                if (frames > 60)
                    this.eat(globals);
                else
                    this.translation[1] -= 60 * dt;
            } else {
                if (frames > 170)
                    this.eat(globals);
                else if (frames > 140) {
                    const scale = .1 * Math.pow(.9, 2 * (frames - 140));
                    this.modelMatrix[0] = scale;
                    this.modelMatrix[5] = scale;
                    this.modelMatrix[10] = scale;
                    this.translation[1] -= scale * 360 * dt;
                }
            }
        } else if (!this.hitGround(viewerInput, globals)) {
            this.checkCollision(vec3.len(this.velocity), dt, globals);
            this.velocity[1] -= 1080 * dt;
        }
        if (this.landedAt === 0)
            vec3.scaleAndAdd(this.translation, this.translation, this.velocity, dt);
        this.modelMatrix[12] = this.translation[0];
        this.modelMatrix[13] = this.translation[1];
        this.modelMatrix[14] = this.translation[2];
    }

    private hitGround(viewerInput: ViewerRenderInput, globals: LevelGlobals): boolean {
        const ground = findGroundPlane(globals.collision, this.translation[0], this.translation[2]);
        const height = computePlaneHeight(ground, this.translation[0], this.translation[2]);
        if (this.translation[1] > height)
            return false;
        // TODO: find intersection point? might not matter as much at a faster framerate
        this.translation[1] = height + 12;
        if (ground.type === 0x337FB2)
            globals.spawnFish(this.translation);
        if (this.isPester) {
            globals.sendGlobalSignal(this, InteractionType.PesterLanded);
            switch (ground.type) {
                // volcano
                case 0x00FF00: globals.sendGlobalSignal(this, 0x26); break;
                // river
                case 0xFF0000: globals.sendGlobalSignal(this, 0x2A); break;
                case 0xFF7FB2: globals.sendGlobalSignal(this, 0x1D); break;
                // valley whirlpool
                case 0x0019FF: globals.sendTargetedSignal(this, 0x2B, 0x802D3B34); break;
            }
            this.visible = false; // TODO: smoke effect
            return true;
        }
        globals.sendGlobalSignal(this, InteractionType.AppleLanded);
        let slowdownFactor = 1;
        switch (ground.type) {
            case 0x0019FF:
            case 0x007F66:
            case 0x337FB2:
            case 0x4CCCCC: {
                globals.createSplash(SplashType.AppleWater, this.translation);
                this.landedAt = viewerInput.time;
                this.inWater = true;
            } break;
            case 0x00FF00:
            case 0xFF4C19: {
                globals.createSplash(SplashType.AppleLava, this.translation);
                this.landedAt = viewerInput.time;
                this.inWater = true;
            } break;
            case 0xFF0000: {
                this.visible = false;
            } break;
            // some of these play different sounds?
            case 0x193333:
            case 0x331919:
            case 0x4C1900:
            case 0x4C4C33:
            case 0x7F4C00:
            case 0x7F6633:
            case 0x7F667F:
            case 0x7F7F7F:
            case 0xFF7FB2:
                slowdownFactor = .3; break;
            case 0x4C7F00:
            case 0x996666:
            case 0xB2997F:
            case 0xFF9919:
                slowdownFactor = .2; break;
            default:
                slowdownFactor = 0;
        }
        if (!this.visible || this.landedAt !== 0)
            return true;
        // adjust velocity based on ground type
        vec3.normalize(groundScratch, ground?.normal);
        reflectVec3(this.velocity, this.velocity, groundScratch);
        const startSpeed = vec3.len(this.velocity);
        if (startSpeed * slowdownFactor < Projectile.minSpeed) {
            if (groundScratch[1] >= Projectile.maxSlope) {
                this.landedAt = viewerInput.time;
                this.animationPaused = true;
            } else
                vec3.scale(this.velocity, this.velocity, Projectile.minSpeed / startSpeed);
        } else
            vec3.scale(this.velocity, this.velocity, slowdownFactor);
        return true;
    }

    private checkCollision(currSpeed: number, dt: number, globals: LevelGlobals): void {
        vec3.normalize(impactScratch[0], this.velocity);
        let furthestIncursion = currSpeed * dt;
        let chosenCollider: Actor | null = null;
        for (let i = 0; i < globals.allActors.length; i++) {
            const collider = globals.allActors[i];
            if (!collider.getImpact(impactScratch[1], this.translation))
                continue;
            const distUntilClosest = vec3.dot(impactScratch[0], impactScratch[1]);
            if (distUntilClosest < 0)
                continue; // we're moving away now
            // compute as the other leg of the triangle
            const minDist = collider.def.radius - Math.sqrt(vec3.sqrLen(impactScratch[1]) - distUntilClosest * distUntilClosest);
            if (minDist < 0)
                continue;
            if (collider.def.flags & 2) {
                if (this.isPester)
                    collider.receiveSignal(this, InteractionType.PesterAlmost, globals);
                else
                    collider.receiveSignal(this, InteractionType.AppleAlmost, globals);
            }
            // find how far we've travelled into the collision sphere, assuming a linear trajectory
            const insideDistance = Math.sqrt(collider.def.radius * collider.def.radius - minDist * minDist) - distUntilClosest;
            if (insideDistance > furthestIncursion) {
                furthestIncursion = insideDistance;
                chosenCollider = collider;
            }
        }
        if (chosenCollider !== null) {
            vec3.copy(chosenCollider.motionData.lastImpact, impactScratch[0]);
            if (this.isPester) {
                chosenCollider.receiveSignal(this, InteractionType.PesterHit, globals);
                this.visible = false;
            } else {
                chosenCollider.receiveSignal(this, InteractionType.AppleHit, globals);
                // set position to the entry point of the collision sphere
                vec3.scaleAndAdd(this.translation, this.translation, impactScratch[0], -furthestIncursion);
                vec3.sub(impactScratch[1], this.translation, chosenCollider.center);
                vec3.normalize(impactScratch[1], impactScratch[1]);
                reflectVec3(this.velocity, this.velocity, impactScratch[1]);
                normToLength(this.velocity, Math.max(currSpeed / 2, 300));
            }
        }
    }
}

const enum SplashType {
    Water,
    Lava,
    AppleWater,
    AppleLava,
}

const scaleScratch = vec3.create();
class Splash extends ModelRenderer {
    constructor(renderData: RenderData, nodes: GFXNode[], animations: AnimationData[], public type: SplashType, private baseScale: vec3) {
        super(renderData, nodes, animations);
        this.visible = false;
    }

    public tryStart(pos: vec3, scale: vec3, globals: LevelGlobals): boolean {
        if (this.visible)
            return false;
        this.visible = true;
        vec3.mul(scaleScratch, this.baseScale, scale);
        mat4.fromScaling(this.modelMatrix, scaleScratch);
        this.modelMatrix[12] = pos[0];
        this.modelMatrix[13] = findGroundHeight(globals.collision, pos[0], pos[2]);
        this.modelMatrix[14] = pos[2];
        this.setAnimation(0);
        this.renderers[this.headAnimationIndex].animator.loopCount = 0;
        return true;
    }

    public motion(viewerInput: ViewerRenderInput, globals: LevelGlobals): void {
        if (this.renderers[this.headAnimationIndex].animator.loopCount >= 1)
            this.visible = false;
    }
}

const cameraScratch = vec3.create();
const collideScratch = nArray(2, () => vec3.create());
const splashScratch = vec3.create();
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
    public center = vec3.create();

    public tangible = true;

    constructor(renderData: RenderData, public spawn: ObjectSpawn, public def: ActorDef, globals: LevelGlobals) {
        super(renderData, def.nodes, def.stateGraph.animations);
        this.motionData.path = spawn.path;
        this.reset(globals);
    }

    public getImpact(dst: vec3, pos: vec3): boolean {
        if (!this.visible || this.hidden || !this.tangible || this.def.radius === 0)
            return false;
        vec3.sub(dst, this.center, pos);
        return true;
    }

    protected reset(globals: LevelGlobals): void {
        // set transform components
        vec3.copy(this.translation, this.spawn.pos);
        if (this.def.spawn === SpawnType.GROUND)
            this.translation[1] = findGroundHeight(globals.collision, this.spawn.pos[0], this.spawn.pos[2]);

        vec3.copy(this.euler, this.spawn.euler);

        vec3.mul(this.scale, this.def.scale, this.spawn.scale);
        this.updatePositions();

        this.motionData.reset();

        this.tangible = true;
        const ground = findGroundPlane(globals.collision, this.translation[0], this.translation[2]);
        this.motionData.groundHeight = computePlaneHeight(ground, this.translation[0], this.translation[2]);
        this.motionData.groundType = ground.type;

        this.currAux = 0;
        if (this.animations.length > 0)
            this.setAnimation(0);

        if (this.def.stateGraph.states.length > 0)
            this.changeState(0, globals);
    }

    protected updatePositions(): void {
        buildTransform(this.modelMatrix, this.translation, this.euler, this.scale);
        if (this.def.flags & 1) { // basically everything? include root node translation
            // the raw center shouldn't be multiplied by the scale in the model matrix, so divide out
            // it was predivided though, not sure what the raw value is supposed to mean...
            vec3.div(this.center, this.def.center, this.scale);
            vec3.add(this.center, this.center, this.renderers[0].translation);
        } else
            vec3.copy(this.center, this.def.center);
        vec3.transformMat4(this.center, this.center, this.modelMatrix);
    }

    protected motion(viewerInput: ViewerRenderInput, globals: LevelGlobals): void {
        this.motionStep(viewerInput, globals);
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
            this.endBlock(globals);
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

    protected endBlock(globals: LevelGlobals): void { }

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
            else if (block.signals[i].target === ObjectField.Target && this.target instanceof Actor)
                this.target.receiveSignal(this, block.signals[i].value, globals);
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
            if (this.target instanceof Projectile)
                this.target.eat(globals);
            else
                console.warn("eating non apple");
            this.target = null;
        }

        if (block.forwardSpeed !== undefined)
            this.motionData.forwardSpeed = block.forwardSpeed;

        if (block.tangible !== undefined)
            this.tangible = block.tangible;

        if (block.splash !== undefined) {
            if (block.splash.index === -1)
                vec3.copy(splashScratch, this.translation);
            else
                mat4.getTranslation(splashScratch, this.renderers[block.splash.index].modelMatrix); // use last frame model matrix, hopefully okay
            globals.createSplash(SplashType.Water, splashScratch, block.splash.scale);
        }

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
                case InteractionType.PhotoFocus:
                case InteractionType.PhotoSubject: {
                    // trigger if the object is on screen long enough
                    if (onScreen && playerDist < 1500)
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
                    let nearest: Projectile | null = null;
                    let dist = 600;
                    for (let i = 0; i < globals.projectiles.length; i++) {
                        if (globals.projectiles[i].isPester)
                            continue;
                        const newDist = globals.projectiles[i].distFrom(this.translation);
                        if (newDist < dist) {
                            dist = newDist;
                            nearest = globals.projectiles[i];
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

    protected motionStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): void {
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
                case "splash": {
                    if (block.index === -1)
                        vec3.copy(splashScratch, this.translation);
                    else
                        mat4.getTranslation(splashScratch, this.renderers[block.index].modelMatrix); // use last frame model matrix, hopefully okay
                    if (block.onImpact) {
                        const height = findGroundHeight(globals.collision, splashScratch[0], splashScratch[2]);
                        if (splashScratch[1] > height) {
                            result = MotionResult.None;
                            break;
                        }
                    }
                    globals.createSplash(SplashType.Water, splashScratch, block.scale);
                    result = MotionResult.Done;
                } break;
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
        if (this.motionData.currBlock >= this.motionData.currMotion.length && this.motionData.currMotion.length > 0)
            this.motionData.stateFlags |= EndCondition.Motion;

        result = this.auxStep(viewerInput, globals);
        if (result !== MotionResult.None)
            updated = true;
        if (result === MotionResult.Done) {
            this.currAux = 0;
            this.motionData.stateFlags |= EndCondition.Aux;
        }
        if (updated)
            this.updatePositions();
        if (this.motionData.stateFlags & EndCondition.Collide)
            this.collide(globals);
    }

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        return MotionResult.None;
    }

    // TODO: figure out the proper order of operations, respect collision flags
    // collision is run twice per frame in game, for all objects simultaneously
    // this seems to work well enough for now
    protected collide(globals: LevelGlobals): void {
        for (let i = 0; i < globals.allActors.length; i++) {
            const other = globals.allActors[i];
            // collide with all the previous actors, which have finished their motion
            if (!(other.motionData.stateFlags & EndCondition.Collide))
                continue;
            if (this === other)
                break;
            vec3.sub(collideScratch[0], other.center, this.center);
            const separation = vec3.len(collideScratch[0]) - other.def.radius - this.def.radius;
            if (separation > 0)
                continue;
            other.receiveSignal(this, InteractionType.Collided, globals);
            this.receiveSignal(other, InteractionType.Collided, globals); // can this break anything?
            // move them apart, though it won't affect the other one until next frame
            collideScratch[0][1] = 0;
            vec3.normalize(collideScratch[0], collideScratch[0]);

            const moveBoth = (this.motionData.stateFlags & EndCondition.AllowBump) && (other.motionData.stateFlags & EndCondition.AllowBump);
            const magnitude = separation * (moveBoth ? 1 / 2 : 1);
            if (this.motionData.stateFlags & EndCondition.AllowBump) {
                vec3.scaleAndAdd(collideScratch[1], this.translation, collideScratch[0], magnitude);
                if (!attemptMove(this.translation, collideScratch[1], this.motionData, globals, MoveFlags.Ground))
                    this.updatePositions();
            }
            if (other.motionData.stateFlags & EndCondition.AllowBump) {
                vec3.scaleAndAdd(collideScratch[1], other.translation, collideScratch[0], -magnitude);
                if (!attemptMove(other.translation, collideScratch[1], other.motionData, globals, MoveFlags.Ground))
                    other.updatePositions();
            }
        }
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
    public static currDiglett = 0;
    public static targetDiglett = 1;

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
            case 0x802E7CA4: {
                if (!canHearSong(this.translation, globals)) {
                    this.motionData.stateFlags |= EndCondition.Misc;
                    return MotionResult.Done;
                }
            } break;
        }
        return MotionResult.None;
    }

    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        switch (state.startAddress) {
            case 0x802E8290: {
                if (Pikachu.currDiglett & Pikachu.targetDiglett) {
                    this.changeState(state.blocks[0].edges[0].index, globals);
                    return;
                }
                Pikachu.targetDiglett <<= 1;
                const pathStart = this.motionData.storedValues[0];
                this.motionData.storedValues[1] = pathStart + (pathStart < 3 ? 1 : 2);
            } break;
        }
        super.startBlock(globals);
    }

    protected endBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        switch (state.startAddress) {
            case 0x802E8330:
                this.motionData.storedValues[0] = this.motionData.storedValues[1]; break;
        }
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

class Victreebel extends Actor {
    protected startBlock(globals: LevelGlobals): void {
        if (this.def.stateGraph.states[this.currState].startAddress === 0x802BFEF0) {
            this.translation[1] = assertExists(this.target).translation[1] - 100;
            this.updatePositions();
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
        if (state.startAddress === 0x802DD1D4) {
            if (this.target && vec3.dist(this.translation, this.target.translation) < 1000)
                this.currBlock = this.spawn.behavior - 1;
            else { // back to initial state
                this.changeState(0, globals);
                return;
            }
        }
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
        case 71: return new Victreebel(renderData, spawn, def, globals);
        case 88: return new Grimer(renderData, spawn, def, globals);
        case 131: return new Lapras(renderData, spawn, def, globals);
        case 137: return new Porygon(renderData, spawn, def, globals);
    }
    return new Actor(renderData, spawn, def, globals);
}