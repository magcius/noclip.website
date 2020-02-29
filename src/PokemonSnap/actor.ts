import { ModelRenderer, buildTransform, LevelGlobals } from "./render";
import { ObjectSpawn, ObjectDef, findGroundHeight, SpawnType, InteractionType, WaitParams, EndCondition, StateEdge } from "./room";
import { RenderData } from "../BanjoKazooie/render";
import { vec3, mat4 } from "gl-matrix";
import { assertExists } from "../util";
import { ViewerRenderInput } from "../viewer";
import { MotionData, runMotion, nextMotionBlock } from "./motion";

const cameraScratch = vec3.create();
export class Actor extends ModelRenderer {
    private currState = -1;
    private currBlock = 0;
    public motionData: MotionData;
    private blockEnd = 0;
    private loopTarget = 1;
    private target: Actor | null = null;

    private translation = vec3.create();
    private euler = vec3.create();
    private scale = vec3.fromValues(1, 1, 1);

    constructor(renderData: RenderData, private spawn: ObjectSpawn, private def: ObjectDef, globals: LevelGlobals) {
        super(renderData, def.nodes, def.stateGraph.animations);
        // set transform components
        vec3.copy(this.translation, spawn.pos);
        if (def.spawn === SpawnType.GROUND)
            this.translation[1] = findGroundHeight(globals.collision!, spawn.pos[0], spawn.pos[2]);

        vec3.copy(this.euler, spawn.euler);

        vec3.mul(this.scale, def.scale, spawn.scale);
        buildTransform(this.modelMatrix, this.translation, spawn.euler, this.scale);

        this.motionData = {
            refPosition: vec3.create(),
            paused: false,
            done: false,
            currMotion: [],
            pathParam: 0,
            currBlock: 0,
            allowWater: false,
            start: -1,

            path: spawn.path,
        };

        if (def.stateGraph.states.length > 0)
            this.changeState(0, globals);
    }

    protected motion(viewerInput: ViewerRenderInput, globals: LevelGlobals): void {
        if (runMotion(this.translation, this.euler, this.scale, this.motionData, viewerInput, globals))
            buildTransform(this.modelMatrix, this.translation, this.euler, this.scale);
        while (this.currState >= 0) {
            const block = this.def.stateGraph.states[this.currState].blocks[this.currBlock];
            if (block.wait !== null) {
                if (block.wait.allowInteraction && this.basicInteractions(block.wait, viewerInput, globals))
                    continue;
                if (!this.metEndCondition(block.wait.endCondition, globals))
                    break;
            }
            if (!this.handleTransition(block.edges, globals))
                this.nextBlock(globals);
        }
    }

    private changeState(newIndex: number, globals: LevelGlobals): boolean {
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

        if (block.signal > 0) {
            for (let i = 0; i < globals.allObjects.length; i++) {
                globals.allObjects[i].receiveSignal(this, block.signal, globals);
            }
        }

        if (block.flagSet & EndCondition.Motion)
            this.motionData.paused = true;
        if (block.flagClear & EndCondition.Motion)
            this.motionData.paused = false;

        if (block.flagSet & EndCondition.Hidden)
            this.hidden = true;
        if (block.flagClear & EndCondition.Hidden)
            this.hidden = false;

        if (block.flagSet & EndCondition.PauseAnim)
            this.animationPaused = true;
        if (block.flagClear & EndCondition.PauseAnim)
            this.animationPaused = false;

        if (block.allowWater !== undefined)
            this.motionData.allowWater = block.allowWater;

        if (block.motion !== null) {
            this.motionData.currMotion = block.motion;
            this.motionData.currBlock = -1;
            this.motionData.done = false;
            nextMotionBlock(this.motionData);
        }

        if (block.wait !== null)
            this.blockEnd = this.animationController.getTimeInSeconds() + block.wait.duration + block.wait.durationRange * Math.random();
    }

    protected receiveSignal(source: Actor, signal: number, globals: LevelGlobals): void {
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
            this.changeState(block.wait.interactions[i].index, globals);
            break;
        }
    }

    private handleTransition(edges: StateEdge[], globals: LevelGlobals): boolean {
        let random = Math.random();
        for (let i = 0; i < edges.length; i++) {
            switch (edges[i].type) {
                case InteractionType.Basic:
                    return this.changeState(edges[i].index, globals);
                case InteractionType.Random: {
                    random -= edges[i].param;
                    if (random < 0)
                        return this.changeState(edges[i].index, globals);
                } break;
                case InteractionType.Behavior: {
                    if (this.spawn.behavior === edges[i].param)
                        return this.changeState(edges[i].index, globals);
                } break;
                case InteractionType.NonzeroBehavior: {
                    if (this.spawn.behavior !== 0)
                        return this.changeState(edges[i].index, globals);
                } break;
                case InteractionType.Flag:
                case InteractionType.NotFlag: {
                    const metCondition = this.metEndCondition(edges[i].param, globals);
                    if (metCondition === (edges[i].type === InteractionType.Flag))
                        return this.changeState(edges[i].index, globals);
                } break;
                case InteractionType.HasTarget: {
                    if (this.target !== null)
                        return this.changeState(edges[i].index, globals);
                } break;
            }
        }
        return false;
    }

    protected metEndCondition(flags: number, globals: LevelGlobals): boolean {
        return (!!(flags & EndCondition.Dance) && globals.currentSong === 0) ||
            (!!(flags & EndCondition.Timer) && this.animationController.getTimeInSeconds() >= this.blockEnd) ||
            (!!(flags & EndCondition.Animation) && this.renderers[this.headAnimationIndex].animator.loopCount >= this.loopTarget) ||
            (!!(flags & EndCondition.Path) && this.motionData.done);
    }

    private basicInteractions(block: WaitParams, viewerInput: ViewerRenderInput, globals: LevelGlobals): boolean {
        mat4.getTranslation(cameraScratch, viewerInput.camera.worldMatrix);
        const playerDist = vec3.dist(this.translation, cameraScratch);
        for (let i = 0; i < block.interactions.length; i++) {
            switch (block.interactions[i].type) {
                case InteractionType.PokefluteA:
                case InteractionType.PokefluteB:
                case InteractionType.PokefluteC: {
                    // game radius is 1400 for song effects
                    if (playerDist < 3000 && block.interactions[i].type === globals.currentSong) {
                        this.changeState(block.interactions[i].index, globals);
                        return true;
                    }
                } break;
                case InteractionType.NearPlayer: {
                    if (playerDist < block.interactions[i].param) {
                        this.changeState(block.interactions[i].index, globals);
                        return true;
                    }
                } break;
                case InteractionType.PesterBall:
                case InteractionType.Hit: {
                    // hit at most every 10 seconds, and only if we're likely visible
                    if (viewerInput.time < globals.lastPesterBall + 10000)
                        break;
                    if (playerDist < 2000 && onScreen(viewerInput, this.translation) && Math.random() < viewerInput.deltaTime / 5000) {
                        this.changeState(block.interactions[i].index, globals);
                        globals.lastPesterBall = viewerInput.time;
                        return true;
                    }
                } break;
            }
        }
        return false;
    }
}

function onScreen(viewerInput: ViewerRenderInput, pos: vec3, radius = 1): boolean {
    return viewerInput.camera.frustum.containsSphere(pos, radius);
}
