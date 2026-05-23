
// Entity layer for Ragnarok Online maps: places NPCs and monsters from the
// per-map entity manifest as animated, grounded billboards.
//
// A manifest (extracted from the Hercules server scripts) lists, in GAT cell
// coordinates: the map's NPCs (one each, facing a fixed direction), its monster
// spawns (a count of instances scattered over a spawn area, each with a walk
// speed), and its warps. This module fetches the manifest, collects the unique
// sprite paths, fetches + parses + uploads each unique .spr/.act once (dedup),
// then instantiates the placements onto the terrain via the shared cell->world
// transform.
//
// NPCs are static (idle, fixed facing). Monsters WANDER: each picks a random
// nearby walkable GAT cell, paths to it on the walkability grid (the ported
// FindPath), walks the path cell-by-cell at its mob_db speed, pauses, and
// repeats. The target selection and idle cadence are our own synthesis (the real
// client never moves mobs locally — the server streamed positions), so the
// roaming is plausible ambient life rather than authentic server behaviour; the
// pathfinder itself is the faithful port. All motion is driven off real elapsed
// dt so it looks identical at any render rate.
//
// Warps are stashed but not drawn (their glow is a .str effect, a later phase).
// Name labels are deferred (text rendering is a separate subsystem).

import { vec3 } from "gl-matrix";
import { DataFetcher } from "../DataFetcher.js";
import { GndMap } from "./gnd.js";
import { GatMap, isWalkable } from "./gat.js";
import { findPath, PathStep } from "./pathfinder.js";
import { parseSPR, SprModel } from "./spr.js";
import { parseACT, ActModel } from "./act.js";
import { SpriteActor } from "./sprite.js";
import { gatCellToWorld, gatCellGroundHeight, gatCellSurfaceHeight } from "./coord.js";
import { RswEffectSource } from "./rsw.js";

// One monster spawn from the manifest: a sprite, an instance count, a spawn
// area in GAT cells, and a walk speed (ms per cell). A zero area
// (cellX=cellY=spanX=spanY=0) is a whole-map random spawn.
interface MobSpawn {
    id: number;
    sprite: string;
    name: string;
    count: number;
    cellX: number;
    cellY: number;
    spanX: number;
    spanY: number;
    speed: number;
    // mob_db Mode.CanMove. Mobs with this off (Pupa, plants, eggs, mushrooms)
    // never wander — they stand idle forever.
    canMove?: boolean;
}

// One NPC from the manifest: a sprite at a fixed GAT cell, facing a direction
// (0..7), with a display name.
interface NpcEntry {
    sprite: string;
    cellX: number;
    cellY: number;
    dir: number;
    name: string;
}

// One warp from the manifest: a destination map reached from a GAT cell
// rectangle, plus the arrival cell on that destination map. Drives both the
// warp-portal placement and the click-to-travel hit test.
export interface WarpEntry {
    cellX: number;
    cellY: number;
    spanX: number;
    spanY: number;
    dest: string;
    // Arrival cell on the destination map (GAT cells). Older manifests predating
    // the dest-coordinate extraction omit these; treat as absent (0) then.
    destX?: number;
    destY?: number;
    // Hint for resolving the destination's era when the destination map has
    // both classic and renewal variants. Set by the extractor for warps whose
    // source Hercules script was era-specific (pre-re-only or re-only); omitted
    // for shared-script warps (the scene loader falls back to the source map's
    // own era then). See era.ts:resolveWarpDest.
    destEra?: "classic" | "renewal";
}

interface EntityManifest {
    mobs?: MobSpawn[];
    npcs?: NpcEntry[];
    warps?: WarpEntry[];
}

// A decoded, parsed sprite ready to upload: its SPR (frame images) and ACT
// (animation actions). One per unique sprite path.
export interface LoadedSprite {
    spr: SprModel;
    act: ActModel;
}

// One placed STATIC sprite (an NPC) to instantiate in the renderer: which loaded
// sprite it uses (an index into the `sprites` array), its idle action state +
// facing direction, the world ground anchor (feet on the terrain), and the
// display name (drawn as a floating billboard label above the sprite).
export interface EntityPlacement {
    spriteIndex: number;
    state: number;       // action base = state*8 (0 = idle/stand)
    direction: number;   // 0..7 facing
    worldPos: [number, number, number];
    name: string;
    // How the sprite sits on worldPos: "feet" (default, NPCs stand on the ground)
    // or "center" (effect sprites are authored around their emit point).
    anchor?: "feet" | "center";
}

// Everything the renderer needs to build the sprite pass for a map: the unique
// loaded sprites (uploaded once each), the static NPC placements that reference
// them, and the wandering mob entities (each advanced per-frame).
export interface EntitySceneData {
    sprites: LoadedSprite[];
    placements: EntityPlacement[];
    mobs: MobEntity[];
    // Warps are parsed and kept for later phases but draw nothing now.
    warps: WarpEntry[];
}

// Action state indices in a monster .act (actions are grouped state*8 + dir).
// The standard mob layout is: 0 stand, 1 walk, 2 attack, 3 hurt, 4 die.
const STATE_IDLE = 0;
const STATE_WALK = 1;
const STATE_DEAD = 4;

// Click-to-kill (our addition, not from the engine): how long a felled mob
// holds its corpse (the last frame of the die action) before it respawns at
// its original spawn cell. The real server picked respawn delays per spawn;
// a flat 30s reads as "stays dead for a while" without feeling glacial.
const RESPAWN_SECONDS = 30;

// Seconds per .act delay unit, matching DELAY_TO_SECONDS in sprite.ts (the
// engine's motion advance is floor(elapsedMs / 24 / delay)). Duplicated here
// so the death-frame stepper drives the same cadence as the actor's normal
// time-based advance.
const ACT_DELAY_TO_SECONDS = 24.0 / 1000.0;

// (Per-sprite anchor overrides used to live here for sprites whose artwork
// extends below the .act attach point — gate-guard soldiers etc. That is now
// handled algorithmically in sprite.ts: each frame's bottommost visible pixel
// is detected and used as the ground anchor, with automatic fallback to the
// attach point when the visible artwork extends meaningfully below it.)

// Wander tuning (our synthesis, not from the decomp).
// How far (in GAT cells) a mob may pick its next target from its current cell.
const ROAM_RADIUS = 8;
// Idle pause between walks, in seconds: a base wait plus a random extra,
// matching Hercules' next_walktime exactly (MIN_RANDOMWALKTIME 4000 ms +
// rnd()%1000, so 4-5 seconds). The previous 0.5-1.5 s read as ADHD twitching.
const IDLE_BASE_SECONDS = 4.0;
const IDLE_RANDOM_SECONDS = 1.0;
// How many random target cells to try before giving up this cycle (then idle and
// retry next cycle).
const MAX_TARGET_TRIES = 8;
// After this many consecutive failed pickAndStartPath cycles, start backing off
// the idle timer (doubling each cycle, capped by IDLE_BACKOFF_MAX_SECONDS) so a
// mob in a fully blocked pocket stops re-allocating findPath state every 4-5 s.
const IDLE_BACKOFF_THRESHOLD = 5;
// Cap on the backed-off idle timer (seconds): the mob still occasionally
// retries (it might become reachable if the player walks elsewhere) but only
// once a minute or so once we know it's stuck.
const IDLE_BACKOFF_MAX_SECONDS = 60;
// Clamp on the per-frame dt accumulator so a stall (backgrounded tab) can't burst
// a mob across many cells in one frame.
const MAX_DT = 0.25;

// Walk-animation cadence factor, from the engine: the walk frame is
// floor(distanceTravelled * WALK_MOTION_SCALE / actionDelay) % frameCount, where
// distance is in world units (one orthogonal cell = the GAT zoom, ~5 units) and
// actionDelay is the walk action's .act delay clamped to >= 1. Tying the frame
// to distance (not the frame clock) makes a slow mob's legs cycle slowly and a
// fast mob's quickly, at a pace that matches its actual movement.
const WALK_MOTION_SCALE = 1.48;

// World-units-per-cell conversion direction codes are the engine's (see
// pathfinder). Convert a movement delta (dx, dz) to an 8-dir actor facing using
// the same atan2(dx, -dz) convention the sprite renderer uses for the camera.
function moveDirToFacing(dx: number, dz: number): number {
    if (dx === 0 && dz === 0)
        return 0;
    // Match the direction enum the NPC facings use (N=0, W=2, S=4, E=6,
    // counter-clockwise), with +X = east and +Z = north in the render frame.
    const deg = Math.atan2(dx, dz) * 180 / Math.PI;
    return ((-Math.round(deg / 45)) % 8 + 8) % 8;
}

// World position for a GAT cell, grounded on the walkable surface (feet on
// what the player walks on). Prefers the GAT cell's own corner heights when a
// GAT is loaded — those follow the top of any RSM prop dropped on the cell
// (stairs, plazas, platforms) — and falls back to the underlying GND height
// otherwise. The GAT layer is authored to match what the pathfinder routes
// over, so using it puts entities on the same surface the player stands on.
function cellWorldPos(gnd: GndMap, gat: GatMap | null, gatX: number, gatY: number): [number, number, number] {
    const h = gat !== null ? gatCellSurfaceHeight(gat, gatX, gatY) : gatCellGroundHeight(gnd, gatX, gatY);
    return gatCellToWorld(gatX, gatY, h, gnd.zoom, gnd.width);
}

// Lifecycle state for a mob. "alive" is the normal wander loop. "dying" plays
// the die action once frame-by-frame (driven manually so it doesn't loop the
// way the actor's time-based advance does). "dead" holds the final corpse
// frame for RESPAWN_SECONDS, then the mob respawns at its original spawn cell.
type MobLifecycle = "alive" | "dying" | "dead";

// A wandering monster: owns its animated actor and live world position (the
// renderer's sprite instance reads the same vec3), and runs a dt-driven state
// machine over the GAT walkability grid.
//
// States:
//   idle  -> wait a randomized pause, then pick a random walkable target within
//            ROAM_RADIUS and FindPath to it; on success start walking, else idle
//            again next cycle.
//   walk  -> advance along the path cell-by-cell at `speed` (ms/cell), lerping
//            the world position between cell centers; face the movement
//            direction; at the end, go idle.
//   dying -> click-to-kill: freeze the wander, switch to the die action, step
//            its motion frame-by-frame off real dt, then become dead.
//   dead  -> hold the corpse on the last die frame for RESPAWN_SECONDS, then
//            snap back to alive at the original spawn cell.
export class MobEntity {
    public actor: SpriteActor;
    public worldPos: vec3;

    // Display name (from mob_db, English where available). Carried so the
    // renderer can attach a floating name label that follows the mob — empty
    // string for nameless spawns.
    public name: string;

    // Public so the renderer can skip click-picks on already-dying/dead mobs
    // (and could later e.g. dim the corpse). Driven by kill() + update().
    public lifecycle: MobLifecycle = "alive";

    // Step event for the dust-puff renderer. `stepEpoch` increments every time
    // the mob crosses into a new GAT cell during a walk; `stepWorldX/Y/Z` holds
    // the world position of that new cell at the moment of the step. The dust
    // renderer keeps a parallel "last-seen epoch" per mob and spawns a puff
    // when the epoch advances — so a renderer can be added/removed and the
    // mob never has to know it exists. Respawn (cellX/cellY snapping back to
    // the spawn cell) intentionally does NOT bump the epoch: it's a teleport,
    // not a step.
    public stepEpoch: number = 0;
    public stepWorldX: number = 0;
    public stepWorldY: number = 0;
    public stepWorldZ: number = 0;

    private gnd: GndMap;
    private gat: GatMap;
    private secondsPerCell: number; // straight-step duration (ms/cell -> s)
    private secondsPerDiag: number; // diagonal step is sqrt(2) longer

    private cellX: number;
    private cellY: number;

    // Original spawn cell, saved so a respawn returns the mob to the same
    // walkable spot it was placed at (the cell is known-walkable — it passed
    // the spawn-area scatter — so we don't need to re-probe it).
    private spawnCellX: number;
    private spawnCellY: number;

    private canMove: boolean;
    private walking = false;
    private path: PathStep[] = [];
    private segIndex = 0;     // index of the destination cell of the current segment
    private segElapsed = 0;   // seconds spent in the current segment
    private segDuration = 0;  // seconds the current segment takes
    private idleTimer = 0;    // seconds left to wait before picking a new target
    private accum = 0;        // bounded dt accumulator
    private walkDist = 0;     // world units travelled in the current walk (drives the walk frame)

    // Death-animation stepper (only meaningful while lifecycle === "dying").
    // The actor's normal time-based advance loops; we step the die motion
    // manually so it plays once and then holds the last frame.
    private deathMotion = 0;
    private deathAccum = 0;
    // Seconds remaining as a corpse before respawn (only set while "dead").
    private respawnTimer = 0;

    // Consecutive idle cycles that failed to find a usable path (every random
    // target rejected: unwalkable, too close, no route within the node budget).
    // A mob trapped in a fully-blocked spawn pocket would otherwise re-run
    // findPath every 4-5 seconds forever — once we cross IDLE_BACKOFF_THRESHOLD,
    // the idle timer doubles (with a ceiling) so we stop burning CPU on a
    // hopeless search. Reset to 0 on any success or on respawn.
    private idleFailStreak = 0;

    constructor(actor: SpriteActor, gnd: GndMap, gat: GatMap, startCellX: number, startCellY: number, speedMsPerCell: number, canMove: boolean, name: string) {
        this.actor = actor;
        this.gnd = gnd;
        this.gat = gat;
        this.cellX = startCellX;
        this.cellY = startCellY;
        this.spawnCellX = startCellX;
        this.spawnCellY = startCellY;
        this.canMove = canMove;
        this.name = name;
        this.secondsPerCell = Math.max(speedMsPerCell, 1) / 1000;
        this.secondsPerDiag = this.secondsPerCell * Math.SQRT2;

        const p = cellWorldPos(gnd, gat, startCellX, startCellY);
        this.worldPos = vec3.fromValues(p[0], p[1], p[2]);

        this.actor.setState(STATE_IDLE);
        this.actor.setWorldDirection((Math.random() * 8) | 0);
        this.idleTimer = IDLE_BASE_SECONDS + Math.random() * IDLE_RANDOM_SECONDS;
    }

    // Click-to-kill (viewer affordance, not from the engine): freeze any
    // in-flight wander, switch the actor to the die action, and start the
    // death-frame stepper. The mob then becomes a corpse for RESPAWN_SECONDS
    // before respawning at its spawn cell. No-op for an already-dying/dead
    // mob, or for a sprite whose .act doesn't carry a die action — without
    // the check, actionIndex() would clamp to the last available action and
    // we'd render some other state (often walk) as the "death".
    public kill(): void {
        if (this.lifecycle !== "alive")
            return;
        if (!this.actor.hasState(STATE_DEAD))
            return;
        this.lifecycle = "dying";
        this.deathMotion = 0;
        this.deathAccum = 0;
        this.walking = false;
        this.path = [];
        this.actor.setState(STATE_DEAD);
        // Pin motion at 0 (also flips externalMotion on, suppressing the
        // actor's looping time-based advance so we drive the frame manually).
        this.actor.setMotion(0);
    }

    // Advances the wander state machine and updates the live world position,
    // actor state, and facing. Driven by real elapsed dt (seconds).
    public update(dtSeconds: number): void {
        this.accum += dtSeconds;
        if (this.accum > MAX_DT)
            this.accum = MAX_DT;
        const dt = this.accum;
        this.accum = 0;

        if (this.lifecycle === "dying") {
            this.updateDying(dt);
            return;
        }
        if (this.lifecycle === "dead") {
            this.respawnTimer -= dt;
            if (this.respawnTimer <= 0)
                this.respawn();
            return;
        }

        if (this.walking)
            this.updateWalk(dt);
        else
            this.updateIdle(dt);
    }

    // Steps the die-action motion frame off real dt at the action's own .act
    // delay cadence (same units as the actor's time-based advance). When the
    // last frame lands, hold it and switch to "dead" with the respawn timer
    // armed. A missing/single-frame die action collapses straight to "dead".
    private updateDying(dt: number): void {
        const motionCount = this.actor.currentMotionCount();
        if (motionCount <= 1) {
            this.lifecycle = "dead";
            this.respawnTimer = RESPAWN_SECONDS;
            return;
        }
        const delaySeconds = this.actor.currentDelay() * ACT_DELAY_TO_SECONDS;
        if (delaySeconds <= 0) {
            // No cadence on this action — just call it dead at frame 0.
            this.lifecycle = "dead";
            this.respawnTimer = RESPAWN_SECONDS;
            return;
        }
        this.deathAccum += dt;
        while (this.deathAccum >= delaySeconds) {
            this.deathAccum -= delaySeconds;
            this.deathMotion++;
            if (this.deathMotion >= motionCount - 1) {
                // Last frame of the die action: pin the corpse there, hand
                // off to the dead-state countdown.
                this.deathMotion = motionCount - 1;
                this.actor.setMotion(this.deathMotion);
                this.lifecycle = "dead";
                this.respawnTimer = RESPAWN_SECONDS;
                return;
            }
            this.actor.setMotion(this.deathMotion);
        }
    }

    // Snaps the mob back to alive at its original spawn cell with a fresh
    // idle pause and a random facing — same setup as the constructor's
    // post-spawn state.
    private respawn(): void {
        this.lifecycle = "alive";
        this.cellX = this.spawnCellX;
        this.cellY = this.spawnCellY;
        this.setWorldFromCell(this.cellX, this.cellY);
        this.walking = false;
        this.path = [];
        this.idleFailStreak = 0; // fresh body, fresh wander attempts
        this.actor.setState(STATE_IDLE);
        this.actor.setWorldDirection((Math.random() * 8) | 0);
        this.idleTimer = IDLE_BASE_SECONDS + Math.random() * IDLE_RANDOM_SECONDS;
    }

    private updateIdle(dt: number): void {
        // Immobile mobs (Mode.CanMove off) never wander: they hold the idle
        // animation forever and never path.
        if (!this.canMove)
            return;
        this.idleTimer -= dt;
        if (this.idleTimer > 0)
            return;
        if (!this.pickAndStartPath()) {
            // No target/path this cycle: wait again and retry. After enough
            // consecutive failures (the spawn pocket is unreachable for this
            // mob), back off the retry interval exponentially up to the cap so
            // we stop burning A* allocations on a hopeless search every cycle.
            this.idleFailStreak++;
            const base = IDLE_BASE_SECONDS + Math.random() * IDLE_RANDOM_SECONDS;
            const overshoot = this.idleFailStreak - IDLE_BACKOFF_THRESHOLD;
            if (overshoot > 0) {
                const factor = Math.min(1 << overshoot, IDLE_BACKOFF_MAX_SECONDS / base);
                this.idleTimer = Math.min(base * factor, IDLE_BACKOFF_MAX_SECONDS);
            } else {
                this.idleTimer = base;
            }
        }
    }

    // Picks a random walkable target cell within ROAM_RADIUS, paths to it, and if
    // a usable path is found, begins walking. Returns true on success.
    private pickAndStartPath(): boolean {
        for (let tries = 0; tries < MAX_TARGET_TRIES; tries++) {
            const tx = this.cellX + ((Math.random() * (2 * ROAM_RADIUS + 1)) | 0) - ROAM_RADIUS;
            const ty = this.cellY + ((Math.random() * (2 * ROAM_RADIUS + 1)) | 0) - ROAM_RADIUS;
            if (tx === this.cellX && ty === this.cellY)
                continue;
            if (!isWalkable(this.gat, tx, ty))
                continue;
            const path = findPath(this.gat, this.cellX, this.cellY, tx, ty);
            if (path === null || path.length < 2)
                continue;
            this.path = path;
            this.segIndex = 1; // path[0] is the current cell; first move is to path[1]
            this.walkDist = 0;
            this.walking = true;
            this.idleFailStreak = 0; // success: reset the backoff counter
            this.actor.setState(STATE_WALK);
            this.startSegment();
            return true;
        }
        return false;
    }

    // Sets up the segment from path[segIndex-1] to path[segIndex]: its duration
    // (diagonal steps take sqrt(2) longer) and the actor's facing.
    private startSegment(): void {
        const from = this.path[this.segIndex - 1];
        const to = this.path[this.segIndex];
        const diagonal = from.x !== to.x && from.y !== to.y;
        this.segDuration = diagonal ? this.secondsPerDiag : this.secondsPerCell;
        this.segElapsed = 0;
        // The path step carries the engine's move-direction code; map the actual
        // world delta to the actor facing (same convention as the renderer).
        const a = cellWorldPos(this.gnd, this.gat, from.x, from.y);
        const b = cellWorldPos(this.gnd, this.gat, to.x, to.y);
        this.actor.setWorldDirection(moveDirToFacing(b[0] - a[0], b[2] - a[2]));
    }

    private updateWalk(dt: number): void {
        // Remember where we were so the walk-animation distance accumulates from
        // the actual position delta this step (the engine's AddDist).
        const prevX = this.worldPos[0], prevZ = this.worldPos[2];

        let remaining = dt;
        // Drain dt across segments so a large dt can cross more than one cell.
        while (remaining > 0) {
            const left = this.segDuration - this.segElapsed;
            if (remaining < left) {
                this.segElapsed += remaining;
                remaining = 0;
            } else {
                // Finished this segment: snap to its destination cell and advance.
                remaining -= left;
                this.segElapsed = this.segDuration;
                const to = this.path[this.segIndex];
                this.cellX = to.x;
                this.cellY = to.y;
                // Stepped into a new cell: publish the step event for the dust
                // renderer (it polls stepEpoch per mob). World pos is the cell's
                // own ground anchor — same as worldPos when the segment lands.
                const stepPos = cellWorldPos(this.gnd, this.gat, to.x, to.y);
                this.stepWorldX = stepPos[0];
                this.stepWorldY = stepPos[1];
                this.stepWorldZ = stepPos[2];
                this.stepEpoch++;
                this.segIndex++;
                if (this.segIndex >= this.path.length) {
                    // Arrived at the goal: stop, ground exactly, go idle.
                    this.setWorldFromCell(this.cellX, this.cellY);
                    this.accumulateWalkDist(prevX, prevZ);
                    this.walking = false;
                    this.path = [];
                    this.actor.setState(STATE_IDLE);
                    this.idleTimer = IDLE_BASE_SECONDS + Math.random() * IDLE_RANDOM_SECONDS;
                    return;
                }
                this.startSegment();
            }
        }
        // Interpolate the world position across the current segment.
        const from = this.path[this.segIndex - 1];
        const to = this.path[this.segIndex];
        const a = cellWorldPos(this.gnd, this.gat, from.x, from.y);
        const b = cellWorldPos(this.gnd, this.gat, to.x, to.y);
        const t = this.segDuration > 0 ? this.segElapsed / this.segDuration : 1;
        this.worldPos[0] = a[0] + (b[0] - a[0]) * t;
        this.worldPos[1] = a[1] + (b[1] - a[1]) * t;
        this.worldPos[2] = a[2] + (b[2] - a[2]) * t;

        this.accumulateWalkDist(prevX, prevZ);
    }

    // Accumulates the horizontal distance moved this step and sets the walk
    // animation frame from it. The engine drives the walk frame off travel
    // distance (not the frame clock), so the legs cycle in step with how far the
    // mob actually moved — slow mobs animate slowly, fast mobs quickly.
    private accumulateWalkDist(prevX: number, prevZ: number): void {
        const dx = this.worldPos[0] - prevX;
        const dz = this.worldPos[2] - prevZ;
        this.walkDist += Math.sqrt(dx * dx + dz * dz);
        const frame = Math.floor(this.walkDist * WALK_MOTION_SCALE / this.actor.currentDelay());
        this.actor.setMotion(frame);
    }

    private setWorldFromCell(cx: number, cy: number): void {
        const p = cellWorldPos(this.gnd, this.gat, cx, cy);
        this.worldPos[0] = p[0];
        this.worldPos[1] = p[1];
        this.worldPos[2] = p[2];
    }
}

// Rebuilds the fetch URL for a sprite path from the manifest (segments joined by
// '/', each percent-encoded so CP949 directory names like the monster folder
// resolve to the same staged path as elsewhere). Returns the .spr and .act URLs.
function spriteUrls(spritePath: string): { spr: string, act: string } {
    const enc = spritePath.split("/").map(encodeURIComponent).join("/");
    return { spr: `${enc}.spr`, act: `${enc}.act` };
}

// Fetches + parses one unique sprite (its .spr and .act). Returns null if either
// is missing or unparseable so the caller can drop those entities.
async function loadSprite(dataFetcher: DataFetcher, pathBase: string, spritePath: string): Promise<LoadedSprite | null> {
    try {
        const { spr: sprUrl, act: actUrl } = spriteUrls(spritePath);
        const [sprRaw, actRaw] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/sprite/${sprUrl}`),
            dataFetcher.fetchData(`${pathBase}/sprite/${actUrl}`),
        ]);
        return { spr: parseSPR(sprRaw), act: parseACT(actRaw) };
    } catch {
        return null;
    }
}

// Finds a walkable GAT cell near (gatX, gatY): the cell itself if walkable, else
// a short outward spiral search. Returns null if nothing walkable is nearby.
function nearestWalkable(gat: GatMap, gatX: number, gatY: number, maxRadius: number): [number, number] | null {
    if (isWalkable(gat, gatX, gatY))
        return [gatX, gatY];
    for (let r = 1; r <= maxRadius; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                    continue; // ring only
                const cx = gatX + dx, cy = gatY + dy;
                if (isWalkable(gat, cx, cy))
                    return [cx, cy];
            }
        }
    }
    return null;
}

// Number of rejection-sampling attempts to land a uniformly-random WALKABLE cell
// inside an inclusive cell rectangle [x0,x1] x [y0,y1] before giving up. Keeping
// this scatter purely random (rather than snapping a single candidate to the
// nearest walkable, which biases many mobs onto the same few walkable border
// cells of an obstacle) avoids clumping.
const WALKABLE_SAMPLE_TRIES = 32;

// Picks a uniformly-random walkable GAT cell strictly within the inclusive
// rectangle [x0,x1] x [y0,y1] (already clamped to the grid). Returns null if no
// walkable cell turned up within the attempt budget (a near-fully-blocked area).
function randomWalkableInRect(gat: GatMap, x0: number, y0: number, x1: number, y1: number): [number, number] | null {
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w <= 0 || h <= 0)
        return null;
    for (let t = 0; t < WALKABLE_SAMPLE_TRIES; t++) {
        const cx = x0 + ((Math.random() * w) | 0);
        const cy = y0 + ((Math.random() * h) | 0);
        if (isWalkable(gat, cx, cy))
            return [cx, cy];
    }
    return null;
}

// Loads a map's entity manifest, fetches/parses each unique sprite once, and
// builds the placements: one static billboard per NPC, and `count` wandering mob
// entities per monster spawn (each snapped to a random walkable cell). Failure
// tolerant — a missing manifest yields no entities (the map still renders), and a
// missing/unparseable sprite drops only the entities that use it.
export async function loadEntities(dataFetcher: DataFetcher, pathBase: string, mapId: string, gnd: GndMap, gat: GatMap | null): Promise<EntitySceneData> {
    const empty: EntitySceneData = { sprites: [], placements: [], mobs: [], warps: [] };

    let manifest: EntityManifest;
    try {
        const raw = await dataFetcher.fetchData(`${pathBase}/entities/${mapId}.json`, { allow404: true });
        manifest = JSON.parse(new TextDecoder().decode(raw.createTypedArray(Uint8Array))) as EntityManifest;
    } catch {
        return empty;
    }

    const npcs = manifest.npcs ?? [];
    const mobSpawns = manifest.mobs ?? [];
    const warps = manifest.warps ?? [];

    // Collect unique sprite paths across NPCs and mobs, then fetch/parse each
    // once. The index of each path in the loaded array is the sheet handle the
    // placements/mobs reference.
    const uniquePaths: string[] = [];
    const pathIndex = new Map<string, number>();
    const claim = (p: string): void => {
        if (!pathIndex.has(p)) {
            pathIndex.set(p, uniquePaths.length);
            uniquePaths.push(p);
        }
    };
    for (const n of npcs)
        claim(n.sprite);
    for (const m of mobSpawns)
        claim(m.sprite);

    const loaded = await Promise.all(uniquePaths.map((p) => loadSprite(dataFetcher, pathBase, p)));

    // Compact the successfully-loaded sprites into a dense array and remap each
    // unique path to its dense index (so a dropped sprite leaves no gap).
    const sprites: LoadedSprite[] = [];
    const denseIndex = new Map<string, number>();
    for (let i = 0; i < uniquePaths.length; i++) {
        const ls = loaded[i];
        if (ls === null)
            continue;
        denseIndex.set(uniquePaths[i], sprites.length);
        sprites.push(ls);
    }

    const placements: EntityPlacement[] = [];
    const mobs: MobEntity[] = [];

    // NPCs: one idle billboard each at its cell, facing its manifest direction.
    // RO has 8 directions; the idle action for direction d is action 0*8 + d.
    // No per-sprite anchor override is needed — sprite.ts auto-detects the
    // ground anchor from each frame's visible bottom (see its buildQuads).
    for (const n of npcs) {
        const idx = denseIndex.get(n.sprite);
        if (idx === undefined)
            continue;
        placements.push({
            spriteIndex: idx,
            state: STATE_IDLE,
            direction: ((n.dir % 8) + 8) % 8,
            worldPos: cellWorldPos(gnd, gat, n.cellX, n.cellY),
            name: n.name ?? "",
        });
    }

    // Monsters: `count` wandering entities per spawn, each snapped to a random
    // walkable GAT cell. A bounded spawn (any span > 0) scatters within
    // [cellX +/- spanX, cellY +/- spanY]; a whole-map spawn (all zero) scatters
    // over the entire GAT grid. If we have no GAT (shouldn't happen for staged
    // maps), we cannot place wandering mobs, so skip them.
    if (gat !== null) {
        const gatW = gat.width, gatH = gat.height;
        for (const m of mobSpawns) {
            const idx = denseIndex.get(m.sprite);
            if (idx === undefined)
                continue;
            const ls = sprites[idx];
            const wholeMap = m.cellX === 0 && m.cellY === 0 && m.spanX === 0 && m.spanY === 0;

            // Resolve the inclusive cell rectangle the spawn scatters over: the
            // whole grid for a (0,0,0,0) spawn, else [cellX +/- spanX] x [cellY
            // +/- spanY] clamped to the grid. Hercules' span is a half-extent, so
            // the rect is centered on (cellX, cellY) and 2*span+1 cells wide.
            let x0: number, y0: number, x1: number, y1: number;
            if (wholeMap) {
                x0 = 0; y0 = 0; x1 = gatW - 1; y1 = gatH - 1;
            } else {
                x0 = Math.max(0, m.cellX - m.spanX);
                y0 = Math.max(0, m.cellY - m.spanY);
                x1 = Math.min(gatW - 1, m.cellX + m.spanX);
                y1 = Math.min(gatH - 1, m.cellY + m.spanY);
            }

            for (let i = 0; i < m.count; i++) {
                // Scatter uniformly over the spawn rect, keeping only walkable
                // cells: every initial placement is on walkable ground AND inside
                // the spawn area, with no clumping on obstacle borders. If the
                // rect is so blocked that rejection sampling fails, fall back to a
                // bounded spiral from its center so the mob still spawns nearby
                // (clamped back into the rect) rather than being dropped.
                let cell = randomWalkableInRect(gat, x0, y0, x1, y1);
                if (cell === null) {
                    const cx = (x0 + x1) >> 1, cy = (y0 + y1) >> 1;
                    cell = nearestWalkable(gat, cx, cy, 16);
                    if (cell !== null) {
                        cell[0] = Math.max(x0, Math.min(x1, cell[0]));
                        cell[1] = Math.max(y0, Math.min(y1, cell[1]));
                        if (!isWalkable(gat, cell[0], cell[1]))
                            cell = null;
                    }
                }
                if (cell === null)
                    continue; // no walkable ground in the spawn area; drop this one
                const actor = new SpriteActor(ls.spr, ls.act);
                mobs.push(new MobEntity(actor, gnd, gat, cell[0], cell[1], m.speed, m.canMove !== false, m.name ?? ""));
            }
        }
    }

    return { sprites, placements, mobs, warps };
}

// ---------------------------------------------------------------------------
// World-placed ambient effect sources (RSW OT_EFFECTSRC).
//
// Each source carries RO's built-in effect id (the EF_* enum). In the engine
// these spawn a looping particle emitter of that effect at the source position.
// Almost all ambient ids (torch, smoke, firefly, sparkle, ...) are SPRITE
// particle effects: the emitter plays a small .spr/.act in place, NOT a .str
// file. We render the confidently-identified ones as a single looping animated
// billboard of that effect's actual sprite at the source — a faithful stand-in
// for the engine's in-place particle (a flame/sparkle that animates at a point).
//
// We deliberately map ONLY effect ids whose exact sprite is in the extracted
// corpus; an id with a missing sprite, or one we can't confidently identify, is
// skipped (no guessed substitute). See EFFECT_SPRITE_TABLE.
// ---------------------------------------------------------------------------

// Confidently-identified ambient effect ids -> the sprite the engine spawns for
// them (relative path under the sprite root; the effect sprite folder "이팩트" is
// the decomp's "misc\" alias). Only ids whose sprite is staged are listed here:
//   EF_TORCH   (47) -> torch_01:  a looping flame (the most common map effect;
//                                  e.g. the Lutie xmas torches).
//   EF_FIREFLY (45) -> particle1: a glowing firefly mote.
// Intentionally OMITTED because their exact sprite is NOT in the extracted
// corpus (rendering a guessed substitute would be unfaithful):
//   EF_SMOKE (44)      -> misc\chimneysmoke (absent)
//   EF_BANJJAKII (165) -> misc\christmas    (absent; Lutie's Christmas sparkles)
// And the texture-particle effects (EF_TORCH_RED/GREEN, EF_GLOW*, EF_FORESTLIGHT*,
// ...) are not sprite-based at all, so they have no .spr to place.
const EFFECT_SPRITE_TABLE: Record<number, string> = {
    47: "이팩트/torch_01",
    45: "이팩트/particle1",
};

// Loads + places the renderable ambient effect sources from an RSW. Returns the
// loaded sprites and static placements to MERGE into the map's EntitySceneData
// (so they share the one sprite renderer). Each placement is an idle, looping
// billboard at the source's world position. Effect ids not in
// EFFECT_SPRITE_TABLE — or whose sprite fails to load — are skipped silently.
//
// `mapOffX/mapOffZ` are half the map extent (the RSW frame is map-centered, the
// terrain corner-origin), matching buildPlacementMatrix: render position is
// (pos.x + mapOffX, -pos.y, pos.z + mapOffZ).
export async function loadEffectSources(
    dataFetcher: DataFetcher,
    pathBase: string,
    effects: RswEffectSource[],
    mapOffX: number,
    mapOffZ: number,
): Promise<{ sprites: LoadedSprite[], placements: EntityPlacement[] }> {
    const result = { sprites: [] as LoadedSprite[], placements: [] as EntityPlacement[] };
    if (effects.length === 0)
        return result;

    // Which sprite paths we actually need (the identified, tabled ids present in
    // this map), loaded once each.
    const wanted = new Set<string>();
    for (const e of effects) {
        const sprite = EFFECT_SPRITE_TABLE[e.type];
        if (sprite !== undefined)
            wanted.add(sprite);
    }
    if (wanted.size === 0)
        return result;

    const paths = Array.from(wanted);
    const loaded = await Promise.all(paths.map((p) => loadSprite(dataFetcher, pathBase, p)));
    const index = new Map<string, number>();
    for (let i = 0; i < paths.length; i++) {
        const ls = loaded[i];
        if (ls === null)
            continue; // sprite missing/unparseable: its sources drop out
        index.set(paths[i], result.sprites.length);
        result.sprites.push(ls);
    }

    for (const e of effects) {
        const sprite = EFFECT_SPRITE_TABLE[e.type];
        if (sprite === undefined)
            continue;
        const idx = index.get(sprite);
        if (idx === undefined)
            continue;
        // RO frame -> render frame: negate Y, shift X/Z by half the map extent,
        // and mirror X about the map centre (W = 2*mapOffX) to match the terrain,
        // models and gat-cell placements (RO is left-handed; see coord.ts).
        result.placements.push({
            spriteIndex: idx,
            state: STATE_IDLE,     // the effect sprite's first action loops in place
            direction: 0,
            worldPos: [mapOffX - e.pos.x, -e.pos.y, e.pos.z + mapOffZ],
            name: "",              // ambient effects have no name label
            anchor: "center",      // emit-point centred, not feet-planted on the ground
        });
    }

    return result;
}
