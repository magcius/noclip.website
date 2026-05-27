import { vec3 } from "gl-matrix";
import { DataFetcher } from "../DataFetcher.js";
import { GndMap } from "./gnd.js";
import { GatMap, isWalkable } from "./gat.js";
import { findPath, PathStep } from "./pathfinder.js";
import { parseSPR, SprModel } from "./spr.js";
import { parseACT, ActModel } from "./act.js";
import { SpriteActor, computeActorFootPxY, SpriteKind } from "./sprite.js";
import { gatCellToWorld, gatCellGroundHeight, gatCellSurfaceHeight } from "./coord.js";
import { RswEffectSource } from "./rsw.js";
import type { Era } from "./era.js";

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

    canMove?: boolean;
}

interface NpcEntry {
    sprite: string;
    cellX: number;
    cellY: number;
    dir: number;
    name: string;
}

export interface WarpEntry {
    cellX: number;
    cellY: number;
    spanX: number;
    spanY: number;
    dest: string;

    destX?: number;
    destY?: number;

    destEra?: Era;
}

interface EntityManifest {
    mobs?: MobSpawn[];
    npcs?: NpcEntry[];
    warps?: WarpEntry[];
}

export interface LoadedSprite {
    spr: SprModel;
    act: ActModel;
    footPxY: number;
}

export interface EntityPlacement {
    spriteIndex: number;
    state: number;
    direction: number;
    worldPos: [number, number, number];
    name: string;

    anchor?: "feet" | "center";
    kind?: SpriteKind;
}

export interface EntitySceneData {
    sprites: LoadedSprite[];
    placements: EntityPlacement[];
    mobs: MobEntity[];
    warps: WarpEntry[];
}

const STATE_IDLE = 0;
const STATE_WALK = 1;
const STATE_HIT = 3;
const STATE_DEAD = 4;

const RESPAWN_SECONDS = 30;

const ACT_DELAY_TO_SECONDS = 24.0 / 1000.0;

const ROAM_RADIUS = 8;

const IDLE_BASE_SECONDS = 4.0;
const IDLE_RANDOM_SECONDS = 1.0;
const MAX_TARGET_TRIES = 8;

const IDLE_BACKOFF_THRESHOLD = 5;
const IDLE_BACKOFF_MAX_SECONDS = 60;
const MAX_DT = 0.25;

const WALK_MOTION_SCALE = 1.48;

function moveDirToFacing(dx: number, dz: number): number {
    if (dx === 0 && dz === 0)
        return 0;
    const oct = -Math.round(Math.atan2(dx, dz) * 4 / Math.PI);
    return (oct % 8 + 8) % 8;
}

function cellWorldPos(gnd: GndMap, gat: GatMap | null, gatX: number, gatY: number): [number, number, number] {
    const h = gat !== null ? gatCellSurfaceHeight(gat, gatX, gatY) : gatCellGroundHeight(gnd, gatX, gatY);
    return gatCellToWorld(gatX, gatY, h, gnd.width);
}

type MobLifecycle = "alive" | "hit" | "dying" | "dead";

export class MobEntity {
    public actor: SpriteActor;
    public worldPos: vec3;

    public name: string;

    public lifecycle: MobLifecycle = "alive";

    public stepEpoch: number = 0;
    public stepWorldX: number = 0;
    public stepWorldY: number = 0;
    public stepWorldZ: number = 0;

    private gnd: GndMap;
    private gat: GatMap;
    private secondsPerCell: number;
    private secondsPerDiag: number;

    private cellX: number;
    private cellY: number;

    private spawnCellX: number;
    private spawnCellY: number;

    private canMove: boolean;
    private walking = false;
    private path: PathStep[] = [];
    private segIndex = 0;
    private segElapsed = 0;
    private segDuration = 0;
    private idleTimer = 0;
    private accum = 0;
    private walkDist = 0;

    private deathMotion = 0;
    private deathAccum = 0;
    private respawnTimer = 0;

    private hitMotion = 0;
    private hitAccum = 0;

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

    public kill(): void {
        if (this.lifecycle !== "alive")
            return;
        if (!this.actor.hasState(STATE_DEAD))
            return;
        this.walking = false;
        this.path = [];

        if (this.actor.hasState(STATE_HIT)) {
            this.lifecycle = "hit";
            this.hitMotion = 0;
            this.hitAccum = 0;
            this.actor.setState(STATE_HIT);
            this.actor.setMotion(0);
            return;
        }
        this.lifecycle = "dying";
        this.deathMotion = 0;
        this.deathAccum = 0;
        this.actor.setState(STATE_DEAD);

        this.actor.setMotion(0);
    }

    public update(dtSeconds: number): void {
        this.accum += dtSeconds;
        if (this.accum > MAX_DT)
            this.accum = MAX_DT;
        const dt = this.accum;
        this.accum = 0;

        if (this.lifecycle === "hit") {
            this.updateHit(dt);
            return;
        }
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

    private updateHit(dt: number): void {
        const motionCount = this.actor.currentMotionCount();
        const delaySeconds = this.actor.currentDelay() * ACT_DELAY_TO_SECONDS;
        if (motionCount <= 1 || delaySeconds <= 0) {
            this.lifecycle = "dying";
            this.deathMotion = 0;
            this.deathAccum = 0;
            this.actor.setState(STATE_DEAD);
            this.actor.setMotion(0);
            return;
        }
        this.hitAccum += dt;
        while (this.hitAccum >= delaySeconds) {
            this.hitAccum -= delaySeconds;
            this.hitMotion++;
            if (this.hitMotion >= motionCount - 1) {
                this.actor.setMotion(motionCount - 1);
                this.lifecycle = "dying";
                this.deathMotion = 0;
                this.deathAccum = 0;
                this.actor.setState(STATE_DEAD);
                this.actor.setMotion(0);
                return;
            }
            this.actor.setMotion(this.hitMotion);
        }
    }

    private updateDying(dt: number): void {
        const motionCount = this.actor.currentMotionCount();
        if (motionCount <= 1) {
            this.lifecycle = "dead";
            this.respawnTimer = RESPAWN_SECONDS;
            return;
        }
        const delaySeconds = this.actor.currentDelay() * ACT_DELAY_TO_SECONDS;
        if (delaySeconds <= 0) {
            this.lifecycle = "dead";
            this.respawnTimer = RESPAWN_SECONDS;
            return;
        }
        this.deathAccum += dt;
        while (this.deathAccum >= delaySeconds) {
            this.deathAccum -= delaySeconds;
            this.deathMotion++;
            if (this.deathMotion >= motionCount - 1) {
                this.deathMotion = motionCount - 1;
                this.actor.setMotion(this.deathMotion);
                this.lifecycle = "dead";
                this.respawnTimer = RESPAWN_SECONDS;
                return;
            }
            this.actor.setMotion(this.deathMotion);
        }
    }

    private respawn(): void {
        this.lifecycle = "alive";
        this.cellX = this.spawnCellX;
        this.cellY = this.spawnCellY;
        this.setWorldFromCell(this.cellX, this.cellY);
        this.walking = false;
        this.path = [];
        this.idleFailStreak = 0;
        this.actor.setState(STATE_IDLE);
        this.actor.setWorldDirection((Math.random() * 8) | 0);
        this.idleTimer = IDLE_BASE_SECONDS + Math.random() * IDLE_RANDOM_SECONDS;
    }

    private updateIdle(dt: number): void {
        if (!this.canMove)
            return;
        this.idleTimer -= dt;
        if (this.idleTimer > 0)
            return;
        if (!this.pickAndStartPath()) {

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
            this.segIndex = 1;
            this.walkDist = 0;
            this.walking = true;
            this.idleFailStreak = 0;
            this.actor.setState(STATE_WALK);
            this.startSegment();
            return true;
        }
        return false;
    }

    private startSegment(): void {
        const from = this.path[this.segIndex - 1];
        const to = this.path[this.segIndex];
        const diagonal = from.x !== to.x && from.y !== to.y;
        this.segDuration = diagonal ? this.secondsPerDiag : this.secondsPerCell;
        this.segElapsed = 0;
        const a = cellWorldPos(this.gnd, this.gat, from.x, from.y);
        const b = cellWorldPos(this.gnd, this.gat, to.x, to.y);
        this.actor.setWorldDirection(moveDirToFacing(b[0] - a[0], b[2] - a[2]));
    }

    private updateWalk(dt: number): void {
        const prevX = this.worldPos[0], prevZ = this.worldPos[2];

        let remaining = dt;

        while (remaining > 0) {
            const left = this.segDuration - this.segElapsed;
            if (remaining < left) {
                this.segElapsed += remaining;
                remaining = 0;
            } else {
                remaining -= left;
                this.segElapsed = this.segDuration;
                const to = this.path[this.segIndex];
                this.cellX = to.x;
                this.cellY = to.y;

                const stepPos = cellWorldPos(this.gnd, this.gat, to.x, to.y);
                this.stepWorldX = stepPos[0];
                this.stepWorldY = stepPos[1];
                this.stepWorldZ = stepPos[2];
                this.stepEpoch++;
                this.segIndex++;
                if (this.segIndex >= this.path.length) {
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

function spriteUrls(spritePath: string): { spr: string, act: string } {
    const enc = spritePath.split("/").map(encodeURIComponent).join("/");
    return { spr: `${enc}.spr`, act: `${enc}.act` };
}

async function loadSprite(dataFetcher: DataFetcher, pathBase: string, spritePath: string): Promise<LoadedSprite | null> {
    try {
        const { spr: sprUrl, act: actUrl } = spriteUrls(spritePath);
        const [sprRaw, actRaw] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/sprite/${sprUrl}`),
            dataFetcher.fetchData(`${pathBase}/sprite/${actUrl}`),
        ]);
        const spr = parseSPR(sprRaw);
        const act = parseACT(actRaw);
        return { spr, act, footPxY: computeActorFootPxY(act, spr) };
    } catch {
        return null;
    }
}

function nearestWalkable(gat: GatMap, gatX: number, gatY: number, maxRadius: number): [number, number] | null {
    if (isWalkable(gat, gatX, gatY))
        return [gatX, gatY];
    for (let r = 1; r <= maxRadius; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                    continue;
                const cx = gatX + dx, cy = gatY + dy;
                if (isWalkable(gat, cx, cy))
                    return [cx, cy];
            }
        }
    }
    return null;
}

const WALKABLE_SAMPLE_TRIES = 32;

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

export async function loadEntities(dataFetcher: DataFetcher, pathBase: string, mapId: string, era: Era, gnd: GndMap, gat: GatMap | null): Promise<EntitySceneData> {
    const empty: EntitySceneData = { sprites: [], placements: [], mobs: [], warps: [] };

    const tryFetch = async (name: string): Promise<EntityManifest | null> => {
        const raw = await dataFetcher.fetchData(`${pathBase}/entities/${name}.json`, { allow404: true });
        if (raw.byteLength === 0) return null;
        try {
            return JSON.parse(new TextDecoder().decode(raw.createTypedArray(Uint8Array))) as EntityManifest;
        } catch {
            return null;
        }
    };

    const manifest = mapId.endsWith("@classic")
        ? await tryFetch(mapId)
        : ((await tryFetch(`${mapId}@${era}`)) ?? (await tryFetch(mapId)));
    if (manifest === null)
        return empty;

    const npcs = manifest.npcs ?? [];
    const mobSpawns = manifest.mobs ?? [];
    const warps = manifest.warps ?? [];

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

    if (gat !== null) {
        const gatW = gat.width, gatH = gat.height;
        for (const m of mobSpawns) {
            const idx = denseIndex.get(m.sprite);
            if (idx === undefined)
                continue;
            const ls = sprites[idx];
            const wholeMap = m.cellX === 0 && m.cellY === 0 && m.spanX === 0 && m.spanY === 0;

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
                    continue;
                const actor = new SpriteActor(ls.spr, ls.act, ls.footPxY);
                mobs.push(new MobEntity(actor, gnd, gat, cell[0], cell[1], m.speed, m.canMove !== false, m.name ?? ""));
            }
        }
    }

    return { sprites, placements, mobs, warps };
}

const EFFECT_SPRITE_TABLE: Record<number, string> = {
    47: "이팩트/torch_01",
    45: "이팩트/particle1",
};

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
            continue;
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

        result.placements.push({
            spriteIndex: idx,
            state: STATE_IDLE,
            direction: 0,
            worldPos: [mapOffX - e.pos.x, -e.pos.y, e.pos.z + mapOffZ],
            name: "",
            anchor: "center",
            kind: "effect",
        });
    }

    return result;
}
