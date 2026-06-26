// Parser for Incoming (1998, Rage Software) ".mdl" mission-definition files. Only placement data
// is handled.

import { num, stripComment, tokenize } from "./WDL.js";

/** A position specified relative to another labeled object's resolved world transform. */
export interface IncomingMDLRef {
    /** The referenced object's `label`, resolved against the level's WDL + MDL placements. */
    readonly label: string;
    /**
     * How the offset is interpreted. If `"world"`, world axis-aligned (`relative to`). If `"local"`,
     * the reference's full rotated frame (`local to`, `fixed_to ... at`). If `"localxz"`, the
     * reference's yaw-only (XZ) frame (`... toxz`).
     */
    readonly mode: "world" | "local" | "localxz";
    /** Offset component dx, interpreted per {@link mode}. */
    readonly dx: number;
    /** Offset component dy, interpreted per {@link mode}. */
    readonly dy: number;
    /** Offset component dz, interpreted per {@link mode}. */
    readonly dz: number;
    /**
     * If true, sample terrain height for Y at the resolved (x, z) (an `on ground` reference
     * position).
     */
    readonly onGround: boolean;
}
/** An absolute (level-authoring space) MDL position, before the ODL `offset` is applied. */
export interface IncomingMDLAbs {
    /** Level-space X. */
    readonly x: number;
    /** Level-space Y; only when {@link onGround} is false. */
    readonly y: number;
    /** Level-space Z. */
    readonly z: number;
    /** If true, Y is sampled from the heightfield at (x, z). */
    readonly onGround: boolean;
}
/**
 * A single waypoint of a moving actor's path (`goto X Y Z …` or a `patrol`'s `point X Y Z …`).
 * Position is expressed as a {@link IncomingMDLPlacement} position.
 */
export interface IncomingMDLWaypoint {
    /** Absolute (level-space) waypoint. */
    readonly abs?: IncomingMDLAbs;
    /** Reference-relative waypoint (`relative to`/`local to`/`local toxz "label"`). */
    readonly ref?: IncomingMDLRef;
}
/** A moving actor's traversal path from its inline `task`/`patrol` (`goto`/`point` sequence). */
export interface IncomingMDLPath {
    /** Ordered waypoints. Needs 2 or more unique points (with the start position) for motion. */
    readonly waypoints: IncomingMDLWaypoint[];
    /** Always true. */
    readonly loop: boolean;
}
/**
 * A single `create` placement parsed from an `.mdl` mission file. Exactly one of {@link abs} or
 * {@link ref} is present for a positionable actor; both are omitted for dynamic spawns (`position
 * at generation point`) or actors with no parsed position.
 */
export interface IncomingMDLPlacement {
    /** The object type name to instance (matches an `IncomingObjectType.name`). */
    readonly typeName: string;
    /** True for `create hero "type"` — the player-controlled object. */
    readonly isHero: boolean;
    /** This placement's `label`, or omitted if unlabeled. */
    readonly label?: string;
    /**
     * Explicit forward orientation, or omitted to inherit the reference object's
     * (e.g. `fixed_to`).
     */
    readonly forward?: [number, number, number];
    /** Up orientation vector (x, y, z). */
    readonly up: [number, number, number];
    /** Absolute position, or omitted when positioned via {@link ref} or unresolvable. */
    readonly abs?: IncomingMDLAbs;
    /** Reference-relative position, or omitted when {@link abs} is used or unresolvable. */
    readonly ref?: IncomingMDLRef;
    /** This actor's movement path from its inline `task`/`patrol`, or omitted if static. */
    readonly path?: IncomingMDLPath;
}

interface MDLBuildState {
    typeName: string;
    isHero: boolean;
    label?: string;
    forward?: [number, number, number];
    up: [number, number, number];
    abs?: IncomingMDLAbs;
    ref?: IncomingMDLRef;
    posSpecified: boolean;
    waypoints: IncomingMDLWaypoint[];
}

function newBuildState(tokens: string[]): MDLBuildState {
    const isHero = tokens.length >= 2 && tokens[1].toLowerCase() === "hero";
    const typeName = isHero ? (tokens.length >= 3 ? tokens[2] : "") : (tokens.length >= 2 ? tokens[1] : "");
    return { typeName, isHero, up: [0, 1, 0], posSpecified: false, waypoints: [] };
}

function parsePositionSpec(tokens: string[]): IncomingMDLWaypoint | undefined {
    const lower = tokens.map((t) => t.toLowerCase());
    // Ignore dynamic spawns.
    if (lower[1] === "at") {
        return undefined;
    }
    const groundIdx = lower.indexOf("ground");
    const onGround = groundIdx >= 0;
    let x: number, y: number, z: number;
    if (onGround) {
        x = num(tokens[1]);
        y = 0;
        z = num(tokens[groundIdx + 1]);
    } else {
        x = num(tokens[1]);
        y = num(tokens[2]);
        z = num(tokens[3]);
    }
    // A reference frame turns parsed numbers into an offset from another object.
    const hasRelative = lower.indexOf("relative") >= 0;
    const hasLocal = lower.indexOf("local") >= 0;
    const toxzIdx = lower.indexOf("toxz");
    const toIdx = lower.indexOf("to");
    const refKwIdx = toxzIdx >= 0 ? toxzIdx : toIdx;
    if ((hasRelative || hasLocal) && refKwIdx >= 0 && refKwIdx + 1 < tokens.length) {
        const mode: IncomingMDLRef["mode"] = toxzIdx >= 0 ? "localxz" : (hasLocal ? "local" : "world");
        return { ref: { label: tokens[refKwIdx + 1], mode, dx: x, dy: y, dz: z, onGround } };
    }
    return { abs: { x, y, z, onGround } };
}

function parsePositionLine(tokens: string[], state: MDLBuildState): void {
    if (state.posSpecified) {
        return;
    }
    state.posSpecified = true;
    const spec = parsePositionSpec(tokens);
    if (spec === undefined) {
        return;
    }
    state.abs = spec.abs;
    state.ref = spec.ref;
}
/**
 * Parses an Incoming `.mdl` mission file into the list of object placements it `create`s, in file
 * order. Mission-only directives are ignored.

 * Callers must apply the ODL `offset`, sample terrain for `on ground`, and resolve
 * {@link IncomingMDLPlacement.ref} against the level's labeled placements.
 * @param text The full text of the `.mdl` file.
 * @returns Every parsed `create` placement, in file order.
 */
export function parseMDL(text: string): IncomingMDLPlacement[] {
    // Mutable view of the placement record so a post-pass can attach `set_task` paths by label.
    type MutablePlacement = { -readonly [K in keyof IncomingMDLPlacement]: IncomingMDLPlacement[K] };
    const placements: MutablePlacement[] = [];
    const lines = text.split("\n");
    const makePath = (waypoints: IncomingMDLWaypoint[]): IncomingMDLPath | undefined =>
        waypoints.length > 0 ? { waypoints, loop: true } : undefined;
    let state: MDLBuildState | undefined;
    // True while inside a `set_task`/`switch_hero` block, whose scripted waypoints are dropped.
    let inSetTask = false;

    const flush = () => {
        if (state !== undefined) {
            placements.push({
                typeName: state.typeName, isHero: state.isHero, label: state.label,
                forward: state.forward, up: state.up, abs: state.abs, ref: state.ref,
                path: makePath(state.waypoints),
            });
        }
        state = undefined;
    };
    const closeSetTask = () => {
        inSetTask = false;
    };

    for (const rawLine of lines) {
        const tokens = tokenize(stripComment(rawLine));
        if (tokens.length === 0) {
            continue;
        }
        const kw = tokens[0].toLowerCase();
        // Movement + task-structure keywords are handled regardless of whether a `create` is open,
        // since `set_task` blocks live at the top level between creates.
        if (kw === "create" || kw === "createstatic") {
            // `create "type"` / `create hero "type"` (mission actors) and `createstatic "type"`
            // (static props, e.g. energy shields) both begin a placement.
            closeSetTask();
            flush();
            state = newBuildState(tokens);
            continue;
        }
        if (kw === "set_task" || kw === "switch_hero") {
            // Scripted reassignment of a labeled actor; gated, so not applied at first-load.
            closeSetTask();
            flush();
            inSetTask = true;
            continue;
        }
        if (kw === "goto" || kw === "point") {
            // A movement waypoint; route to the inline task (set_task waypoints are dropped).
            const wp = parsePositionSpec(tokens);
            if (wp !== undefined && !inSetTask && state !== undefined) {
                state.waypoints.push(wp);
            }
            continue;
        }
        if (kw === "end") {
            closeSetTask();
            continue;
        }
        if (kw === "task" || kw === "patrol" || state === undefined) {
            continue;
        }
        if (kw === "label") {
            if (tokens.length >= 2) {
                state.label = tokens[1];
            }
        } else if (kw === "position") {
            parsePositionLine(tokens, state);
        } else if (kw === "forward") {
            // `forward fx fy fz [up ux uy uz]`. First forward wins (mirrors the position rule).
            if (state.forward === undefined) {
                state.forward = [num(tokens[1]), num(tokens[2]), num(tokens[3])];
                const upIdx = tokens.findIndex((t) => t.toLowerCase() === "up");
                if (upIdx >= 0) {
                    state.up = [num(tokens[upIdx + 1]), num(tokens[upIdx + 2]), num(tokens[upIdx + 3])];
                }
            }
        } else if (kw === "fixed_to") {
            // `fixed_to "label" at X Y Z` — rigidly attached; offset in the label's frame.
            const atIdx = tokens.findIndex((t) => t.toLowerCase() === "at");
            if (!state.posSpecified && tokens.length >= 2 && atIdx >= 0) {
                state.posSpecified = true;
                state.ref = {
                    label: tokens[1], mode: "local",
                    dx: num(tokens[atIdx + 1]), dy: num(tokens[atIdx + 2]), dz: num(tokens[atIdx + 3]),
                    onGround: false,
                };
                state.abs = undefined;
            }
        }
    }
    closeSetTask();
    flush();
    // set_task / switch_hero paths are scripted (mission-gated) — not applied at first-load.
    return placements;
}
