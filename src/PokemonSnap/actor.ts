import { ModelRenderer, buildTransform, LevelGlobals } from "./render";
import { ObjectSpawn, ObjectDef, findGroundHeight, SpawnType, CollisionTree, InteractionType, StateBlock } from "./room";
import { RenderData } from "../BanjoKazooie/render";
import { vec3, mat4 } from "gl-matrix";
import { assertExists } from "../util";
import { ViewerRenderInput } from "../viewer";

const enum EndConditions {
    Animation   = 0x01,
    Path        = 0x02,
    Timer       = 0x04,
    Motion      = 0x20,
}

const posScratch = vec3.create();
const scaleScratch = vec3.create();
const cameraScratch = vec3.create();
export class Actor extends ModelRenderer {
    private currState = -1;
    private currBlock = 0;
    private blockEnd = 0;
    private loopTarget = 1;

    constructor(renderData: RenderData, private spawn: ObjectSpawn, private def: ObjectDef, collision: CollisionTree) {
        super(renderData, def.nodes, def.stateGraph.animations);
        // set transform components
        vec3.copy(posScratch, spawn.pos);
        if (def.spawn === SpawnType.GROUND)
            posScratch[1] = findGroundHeight(collision, spawn.pos[0], spawn.pos[2]);

        vec3.mul(scaleScratch, def.scale, spawn.scale);
        buildTransform(this.modelMatrix, posScratch, spawn.euler, scaleScratch);

        if (def.stateGraph.states.length > 0)
            this.changeState(0);
    }

    protected motion(viewerInput: ViewerRenderInput, globals: LevelGlobals): void {
        while (this.currState >= 0) {
            const block = this.def.stateGraph.states[this.currState].blocks[this.currBlock];
            if (block.allowInteraction && this.basicInteractions(block, viewerInput, globals))
                continue;
            if (
                (block.endCondition & EndConditions.Timer && this.animationController.getTimeInSeconds() >= this.blockEnd) ||
                (block.endCondition & EndConditions.Animation && this.finishedAnimation()) ||
                (block.endCondition & EndConditions.Path && this.animationController.getTimeInSeconds() >= this.blockEnd + 3)
            )
                this.nextBlock();
            else
                break;
        }
    }

    private changeState(newIndex: number): void {
        this.currState = newIndex;
        this.currBlock = -1;
        this.nextBlock();
    }

    private nextBlock(): void {
        this.currBlock++;
        const state = this.def.stateGraph.states[this.currState];
        if (this.currBlock >= state.blocks.length)
            return this.handleTransition();

        const block = state.blocks[this.currBlock];
        if (block.animation >= 0) {
            if (block.animation !== this.currAnimation || block.force)
                this.setAnimation(block.animation);
            const currLoops = assertExists(this.renderers[this.headAnimationIndex]).animator.loopCount;
            this.loopTarget = currLoops + (block.loopTarget > 0 ? block.loopTarget : 1);
        }

        this.blockEnd = this.animationController.getTimeInSeconds() + block.duration + block.durationRange * Math.random();
    }

    private handleTransition(): void {
        const edges = this.def.stateGraph.states[this.currState].next;
        let random = Math.random();
        for (let i = 0; i < edges.length; i++) {
            switch (edges[i].type) {
                case InteractionType.Basic:
                    return this.changeState(edges[i].index);
                case InteractionType.Random: {
                    random -= edges[i].param;
                    if (random < 0)
                        return this.changeState(edges[i].index);
                } break;
                case InteractionType.Behavior: {
                    if (this.spawn.behavior === edges[i].param)
                        return this.changeState(edges[i].index);
                } break;
                case InteractionType.NonzeroBehavior: {
                    if (this.spawn.behavior !== 0)
                        return this.changeState(edges[i].index);
                } break;
            }
        }
        this.currState = -1;
    }

    private finishedAnimation(): boolean {
        return this.renderers[this.headAnimationIndex].animator.loopCount >= this.loopTarget;
    }

    private basicInteractions(block: StateBlock, viewerInput: ViewerRenderInput, globals: LevelGlobals): boolean {
        mat4.getTranslation(posScratch, this.modelMatrix);
        mat4.getTranslation(cameraScratch, viewerInput.camera.worldMatrix);
        const playerDist = vec3.dist(posScratch, cameraScratch);
        for (let i = 0; i < block.interactions.length; i++) {
            switch (block.interactions[i].type) {
                case InteractionType.PokefluteA:
                case InteractionType.PokefluteB:
                case InteractionType.PokefluteC: {
                    // game radius is 1400 for song effects
                    if (playerDist < 3000 && block.interactions[i].type === globals.currentSong) {
                        this.changeState(block.interactions[i].index);
                        return true;
                    }
                } break;
                case InteractionType.NearPlayer: {
                    if (playerDist < block.interactions[i].param) {
                        this.changeState(block.interactions[i].index);
                        return true;
                    }
                } break;
                case InteractionType.PesterBall:
                case InteractionType.Hit: {
                    // hit at most every 10 seconds, and only if we're likely visible
                    if (viewerInput.time < globals.lastPesterBall + 10000)
                        break;
                    if (playerDist < 2000 && onScreen(viewerInput, posScratch) && Math.random() < viewerInput.deltaTime / 5000) {
                        this.changeState(block.interactions[i].index);
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
