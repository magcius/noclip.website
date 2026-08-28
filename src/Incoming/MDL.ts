// Parser for Incoming (1998, Rage Software) ".mdl" mission-definition files. Reads placement data
// only.

import { num, stripComment, tokenize } from "./WDL.js";

/** A position given relative to another labeled object's resolved world transform. */
export interface IncomingMDLRef {
    /** The referenced object's `label`, resolved against the level's WDL and MDL placements. */
    readonly label: string;
    /**
     * Which frame the offset is measured in: `"world"` for world axis-aligned (`relative to`),
     * `"local"` for the reference's full rotated frame (`local to`, `fixed_to ... at`), or
     * `"localxz"` for its yaw-only frame (`... toxz`).
     */
    readonly mode: "world" | "local" | "localxz";
    /** Offset X, in the frame named by {@link mode}. */
    readonly dx: number;
    /** Offset Y, in the frame named by {@link mode}. */
    readonly dy: number;
    /** Offset Z, in the frame named by {@link mode}. */
    readonly dz: number;
    /** Sample terrain height for Y at the resolved (x, z), from an `on ground` reference. */
    readonly onGround: boolean;
}

/** An absolute level-space position, before the ODL `offset` is applied. */
export interface IncomingMDLAbs {
    /** Level-space X. */
    readonly x: number;
    /** Level-space Y. Only meaningful when {@link onGround} is false. */
    readonly y: number;
    /** Level-space Z. */
    readonly z: number;
    /** Sample Y from the heightfield at (x, z) instead of using {@link y}. */
    readonly onGround: boolean;
}

/** One waypoint of a moving actor's path, from `goto X Y Z …` or a `patrol`'s `point X Y Z …`. */
export interface IncomingMDLWaypoint {
    /** Absolute waypoint, present unless {@link ref} is. */
    readonly abs?: IncomingMDLAbs;
    /** Reference-relative waypoint, from `relative to`, `local to` or `local toxz "label"`. */
    readonly ref?: IncomingMDLRef;
}

/** A moving actor's traversal path, from its inline `task` or `patrol`. */
export interface IncomingMDLPath {
    /** Ordered waypoints. Motion needs two or more distinct points, counting the start position. */
    readonly waypoints: IncomingMDLWaypoint[];
    /** Always true. */
    readonly loop: boolean;
}

/**
 * One `create` placement. A positionable actor carries exactly one of {@link abs} or {@link ref};
 * both are absent for dynamic spawns (`position at generation point`) and for actors whose position
 * did not parse.
 */
export interface IncomingMDLPlacement {
    /** Object type to instance, matching an `IncomingObjectType.name`. */
    readonly typeName: string;
    /** True for `create hero "type"`, the player-controlled object. */
    readonly isHero: boolean;
    /** This placement's `label`. */
    readonly label?: string;
    /** Explicit forward orientation. Absent to inherit the reference object's, as `fixed_to` does. */
    readonly forward?: [number, number, number];
    /** Up orientation vector. */
    readonly up: [number, number, number];
    /** Absolute position. */
    readonly abs?: IncomingMDLAbs;
    /** Reference-relative position. */
    readonly ref?: IncomingMDLRef;
    /** Movement path from the inline `task` or `patrol`. Absent for a static actor. */
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
    // `position at generation point` spawns dynamically and has nothing to place.
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
    // A reference frame turns the parsed numbers into an offset from another object.
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
 * Parses an `.mdl` mission file. Mission-only directives are ignored, as are `set_task` and
 * `switch_hero` paths, which are mission-gated rather than applied at first load.
 *
 * Callers must apply the ODL `offset`, sample terrain for `on ground`, and resolve
 * {@link IncomingMDLPlacement.ref} against the level's labeled placements.
 *
 * @param text Full text of the file.
 * @returns Every `create` placement, in file order.
 */
export function parseMDL(text: string): IncomingMDLPlacement[] {
    type MutablePlacement = { -readonly [K in keyof IncomingMDLPlacement]: IncomingMDLPlacement[K] };
    const placements: MutablePlacement[] = [];
    const lines = text.split("\n");
    const makePath = (waypoints: IncomingMDLWaypoint[]): IncomingMDLPath | undefined =>
        waypoints.length > 0 ? { waypoints, loop: true } : undefined;
    let state: MDLBuildState | undefined;
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
        // `set_task` blocks sit at the top level between creates, so movement and task-structure
        // keywords have to be handled whether or not a `create` is open.
        if (kw === "create" || kw === "createstatic") {
            closeSetTask();
            flush();
            state = newBuildState(tokens);
            continue;
        }
        if (kw === "set_task" || kw === "switch_hero") {
            closeSetTask();
            flush();
            inSetTask = true;
            continue;
        }
        if (kw === "goto" || kw === "point") {
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
            // `forward fx fy fz [up ux uy uz]`. First one wins, as with position.
            if (state.forward === undefined) {
                state.forward = [num(tokens[1]), num(tokens[2]), num(tokens[3])];
                const upIdx = tokens.findIndex((t) => t.toLowerCase() === "up");
                if (upIdx >= 0) {
                    state.up = [num(tokens[upIdx + 1]), num(tokens[upIdx + 2]), num(tokens[upIdx + 3])];
                }
            }
        } else if (kw === "fixed_to") {
            // `fixed_to "label" at X Y Z` attaches rigidly, offset in the label's own frame.
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
    return placements;
}
