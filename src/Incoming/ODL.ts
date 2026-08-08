
// Parser for Incoming (1998, Rage Software) ".odl" object-definition files.

const BRADAR_YAW_RATE = 0.3;
/**
 * Render/material flag bits for an Incoming object type, OR'd from the `drawtype` /
 * inline render-flag keywords.
 */
export const enum IncomingMaterialFlag {
    /** `self illuminating` — unlit / full-bright material. */
    SelfIlluminating = 0x01,
    /** `reflective` — environment-reflective material. */
    Reflective = 0x02,
    /** `semi transparent` — alpha-blended material. */
    SemiTransparent = 0x10,
    /** `semiinv` — inverse/additive blend material. */
    SemiInverse = 0x20,
}
/**
 * Texture attribute flags parsed from a `texture "path" <flags...>` declaration.
 */
export const enum IncomingTextureFlag {
    /** `transparent` — 1-bit color-key transparency (key-colored pixels are skipped). */
    ColorKey = 0x01,
    /** `alpha` — full alpha-blended. */
    Alpha = 0x02,
    /** `alphabright` — additive/bright alpha. */
    AlphaBright = 0x04,
    /** `alphainv` — inverse alpha. */
    AlphaInverse = 0x08,
}
/**
 * A light defined on an object type, in the part's local model space. Incoming supports three
 * kinds. All illuminate nearby geometry; lamp/point are omni, spot is a cone. Colours are RGB and
 * may exceed 255 (treated as HDR intensity, summed then clamped).
 */
export interface IncomingLight {
    /** Light kind. */
    readonly kind: "lamp" | "point" | "spot";
    /** Local-space position `[x, y, z]` relative to the owning part. */
    readonly position: [number, number, number];
    /** Light colour `[r, g, b]` (0..255+, HDR). For point/spot this is the first colour slot. */
    readonly color: [number, number, number];
    /** Effective radius/range in world units (lamp `radius`, point `range`). */
    readonly radius: number;
}
/**
 * A camera-facing billboard sprite on a part, from the `sprite` directive: a wingtip nav-light,
 * engine glow, or smoke emitter. The UV rect addresses a sub-region of the part's texture atlas
 * (`smoke.ppm`, 256×256). An optional `colourfade`/`colour` block animates {@link color} through
 * {@link cycleColors} over time.
 */
export interface IncomingSprite {
    /** Atlas sub-rect left edge, in texture pixels (`u=`). */
    readonly u: number;
    /** Atlas sub-rect top edge, in texture pixels (`v=`). */
    readonly v: number;
    /** Atlas sub-rect width, in texture pixels (`w=`). */
    readonly w: number;
    /** Atlas sub-rect height, in texture pixels (`h=`). */
    readonly h: number;
    /** Billboard world-space size (`size=`, engine default 24). */
    readonly size: number;
    /** Base RGB colour `[r, g, b]` 0..255 (`colour 1=R G B`, engine default 128,128,128). */
    readonly color: [number, number, number];
    /**
     * Colour-cycle keyframes `[r, g, b]` 0..255, from a `colourfade` + `colour` block. Empty when
     * the sprite has a static colour; otherwise the displayed colour cycles through these.
     */
    cycleColors: [number, number, number][];
    /** Colour-cycle rate from `colourfade speed N` (engine default 8); 0 when there is no cycle. */
    cycleSpeed: number;
}
/**
 * Procedural mesh geometry for a part, from the `sphere` / `hemisphere` directives: an energy
 * sphere/shield or a dome canopy, tessellated at radius `radius` with `width` longitude and
 * `height` latitude segments. Used instead of an `objfile` mesh.
 */
export interface IncomingProcGeom {
    /** Surface kind: a full sphere or a hemisphere dome. */
    readonly kind: "sphere" | "hemisphere";
    /** Surface radius (`rad=`), in model units (scaled by the part scale like any mesh). */
    readonly radius: number;
    /** Longitude tessellation segments (`width=`). */
    readonly width: number;
    /** Latitude tessellation segments (`height=`). */
    readonly height: number;
    /** Texture tiling around the longitude (hemisphere `repeat=` first value; 1 for a sphere). */
    readonly repeatU: number;
    /** Texture tiling along the latitude (hemisphere `repeat=` second value; 1 for a sphere). */
    readonly repeatV: number;
}

/**
 * A smoke-plume emitter on a part, from the `smoke` directive: a continuous stream of soft puffs
 * (e.g. the power-station cooling-tower smoke). The renderer animates a rising, expanding, fading
 * column of `smoke.ppm` billboards from {@link offset} (part-local).
 */
export interface IncomingSmoke {
    /** Emitter offset `[x, y, z]` in part-local space (e.g. the tower top). */
    readonly offset: [number, number, number];
    /** Initial puff billboard size (`size S`; engine default 70). Each puff grows +5/frame. */
    readonly size: number;
    /** Smoke colour `[r, g, b]` 0..255 (`colour R G B`). */
    readonly color: [number, number, number];
    /** Peak puff opacity 0..255 (`alpha A`, engine default 128). Only used for {@link additive} = false. */
    readonly alpha: number;
    /**
     * Frames between successive puff spawns (`rate N`; the engine's re-arm countdown, default 4).
     * The number of puffs alive at once is `ceil(lifetime / rate)`.
     */
    readonly rate: number;
    /**
     * Each puff's lifetime in game frames (`frames M`, default 42). A puff rises 16 world units
     * and grows 5 size units per frame, so the column is `lifetime * 16` units tall.
     */
    readonly lifetime: number;
    /**
     * True when the directive's `frames` value was negative: the engine sets the additive-blend
     * flag (`wFlags |= 0x20`) for the puffs (e.g. the chimney and aircraft-exhaust trails), versus
     * the alpha blend used by the cooling tower (`frames 42`, positive).
     */
    readonly additive: boolean;
}

/**
 * A single node of an object type's part hierarchy: one mesh (or mesh alias) with its own
 * material, plus a local offset/orientation relative to its parent. An object type's root
 * mesh is `parts[0]`; `child`/`sibling` directives append further parts. Fields relevant to
 * static level rendering are retained, including {@link lights}, {@link animFrames}, and
 * {@link sprite}; non-visual directives (dynamics, cannons, sound) are parsed but discarded.
 */
export interface IncomingPart {
    /** The part name (the `type`/`child`/`sibling` quoted token); referenced by `objfile as`. */
    readonly name: string;
    /**
     * The HUD/display label from the `name "x"` sub-command, if present (distinct from
     * {@link name}, which is the mesh-resolution key). Purely informational; not used for
     * rendering. Undefined when the part has no explicit `name` directive.
     */
    displayName?: string;
    /** Relative path (under `pcobject/`) of this part's highest-detail `.ian` file, if any. */
    objfile?: string;
    /** If set, this part reuses the mesh of the same-type part with this name (`objfile as`). */
    aliasOf?: string;
    /** Uniform model scale applied to this part's vertices (engine default 100.0). */
    scale: number;
    /** Relative path (under `ppm/`) of this part's material texture, if a `texture` was given. */
    texturePath?: string;
    /**
     * All `texture` paths declared on the part, in order. A single entry for most parts; multiple
     * entries are animation frames (e.g. the arctic energy shields cycle `water1`…`water16`).
     * {@link texturePath} mirrors the last entry for single-texture consumers.
     */
    textures: string[];
    /** Bitfield of {@link IncomingTextureFlag} for the material texture. */
    textureFlags: number;
    /** Bitfield of {@link IncomingMaterialFlag} render flags. */
    materialFlags: number;
    /** If true (`double sided` face flag), this part's triangles are never backface-culled. */
    doubleSided: boolean;
    /**
     * Mesh-mirror flags from `drawtype flipx`/`flipy`/`flipz` (engine face flags 0x02/0x04/0x08):
     * negate the mesh along that axis. Used to make a mirrored/180°-rotated variant from a shared
     * mesh (e.g. the `cobra` is a `flipx flipz` — 180° yaw — reuse of another helicopter mesh).
     */
    flipX: boolean;
    flipY: boolean;
    flipZ: boolean;
    /** Local position offset `[x, y, z]` (in root-model units) relative to the parent part. */
    position: [number, number, number];
    /** Local forward orientation vector `[x, y, z]` relative to the parent part. */
    forward: [number, number, number];
    /** Local up orientation vector `[x, y, z]` relative to the parent part. */
    up: [number, number, number];
    /**
     * Per-axis spin angular velocity `[x, y, z]` in radians per engine tick, from
     * `operate "spin" ax ay az`, or undefined if the part does not spin. Rotation is about the
     * part's own local axes (e.g. `[0, 0.08, 0]` spins about local up).
     */
    spin?: [number, number, number];
    /**
     * True when this part's {@link spin} should rotate only its descendants, NOT the part's own
     * mesh. Set for `operate "bradar"` (a radar relay): the engine sweeps the whole object, but its
     * structural base is radially symmetric at the game's low texture resolution so its rotation is
     * invisible there; at noclip's higher fidelity the base visibly (and wrongly) spins, so we keep
     * the base mesh static and rotate only the dish child on the axis. `operate "spin"` (rotors,
     * rings) leaves this false: the part's own mesh spins.
     */
    spinInheritOnly: boolean;
    /**
     * True for `operate "spinengines"`: the part's mesh pulses its Z-scale each frame (an engine
     * exhaust-flame flicker). Animated at render time.
     */
    flameFlicker: boolean;
    /** Lights defined on this part (`lamplight`/`pointlight`/`spotlight`), in part-local space. */
    lights: IncomingLight[];
    /**
     * Frame-animation model type names from `animatemodel "a" "b" ... end` (engine
     * `OdlCmdAnimateModel`): the part cycles its mesh through these types' models (e.g. tank
     * treads). Empty if the part has no model flipbook.
     */
    animFrames: string[];
    /**
     * Target local pose from an `animate` keyframe block (helicopter gear, VTOL engine tilt, wing
     * morph), or undefined. The renderer oscillates the part between its default pose and this target,
     * giving a living scene. `forward`/`up` are undefined when the keyframe only repositions the part.
     */
    animTarget?: { position: [number, number, number]; forward?: [number, number, number]; up?: [number, number, number] };
    /** The part's billboard sprite (`sprite` directive), or undefined if it has none. */
    sprite?: IncomingSprite;
    /** The part's procedural `sphere`/`hemisphere` geometry, or undefined if it uses an `objfile` mesh. */
    procGeom?: IncomingProcGeom;
    /** The part's `smoke` plume emitter (e.g. cooling-tower smoke), or undefined. */
    smoke?: IncomingSmoke;
    /** Index into {@link IncomingObjectType.parts} of this part's parent, or -1 for the root. */
    parentIndex: number;
}
/**
 * A reusable object type declared by a `type "name" { ... }` block: a hierarchy of one or
 * more {@link IncomingPart}s. Single-mesh objects (trees, buildings, animals) have exactly
 * one part; vehicles have a root plus child/sibling sub-parts (wheels, flaps, rotors).
 */
export interface IncomingObjectType {
    /** The type name, e.g. `"giraffe"`, used by `.wdl` `create` placements. */
    readonly name: string;
    /** The part hierarchy. `parts[0]` is the root; every other part has a valid parentIndex. */
    readonly parts: IncomingPart[];
    /**
     * Relative path (under `ppm/`) of the type's ground-shadow silhouette texture, from the
     * `shadow` directive (engine `OdlCmdShadow`, type-wide), or undefined if it casts no shadow. The
     * shadow's size/placement is derived from the object footprint at render time. Captured;
     * shadow rendering is not yet implemented.
     */
    shadowTexture?: string;
    /**
     * Maximum velocity in world units per engine tick, from the `dynamics` block's `max vel N`
     * field (engine `OdlCmdDynamics` @0x00406b58, stored raw at DynamicsData+0x8), or undefined if the
     * type has no `dynamics` block. Used as the constant traversal speed for an actor following an
     * MDL waypoint path (jets ≈ 80, transport helis ≈ 42, hovercraft ≈ 25, big ships ≈ 20).
     */
    maxVel?: number;
}
/**
 * The `land` block: the terrain source binaries and the (up to 8) land textures, in
 * declaration order (index 0..7 indexes the terrain tile-material LUT).
 */
export interface IncomingLand {
    /** Relative path (under the data root) of the int16 heightfield binary (`tland1.bin`). */
    heightfieldPath: string;
    /** Relative path of the per-tile cell/texcoord binary (`city2tc.bin`). */
    cellFlagsPath: string;
    /** Relative paths (under `ppm/`) of the up-to-8 land textures, index 0..7. */
    texturePaths: string[];
}
/**
 * The `sky` block: sky-dome gradient colors, fog, cloud plane height, and scene lighting.
 * Colors are RGB byte triples (0..255). Directions are in world space.
 */
export interface IncomingSky {
    /** True for a flat sky plane (`flat`); false for an earth/hemisphere backdrop. */
    flat: boolean;
    /** Relative path (under `ppm/`) of the sky/cloud texture, if any. */
    texturePath?: string;
    /** Up to 8 sky-dome gradient colors (top → bottom), each `[r, g, b]` in 0..255. */
    gradient: number[][];
    /** Fog color `[r, g, b]` in 0..255. */
    fogColor: number[];
    /** World-space Z height of the cloud plane (engine `cloud level`). */
    cloudLevelZ: number;
    /** Ambient light color `[r, g, b]` in 0..255 (`ambiance`). */
    ambient: number[];
    /** Directional (sun) light color `[r, g, b]` in 0..255 (`direct`). */
    directColor: number[];
    /** Directional (sun) light direction `[x, y, z]` in world space (`from`). */
    lightDir: number[];
    /**
     * True when the `from` line ends with `not_unit`: the engine does NOT normalize the light
     * vector, so its magnitude (~2) scales the directional term (`ProjectMeshWithDynamicLighting`).
     */
    lightUnnormalized: boolean;
    /** Relative path (under `ppm/`) of the sun sprite image (`sunimage`), or undefined. */
    sunImagePath?: string;
    /** Sun sprite color `[r, g, b]` in 0..255 (`color` after `sunimage`); warm sunset tint. */
    sunColor: number[];
    /** Sun sprite world-space size (`size`), or 0 if unspecified. */
    sunSize: number;
}
/** The decoded contents of a single `.odl` file. */
export interface IncomingODL {
    /** Object types declared in this file, keyed by lower-cased type name. */
    readonly types: Map<string, IncomingObjectType>;
    /** The `land` block, if this file declared one. */
    land?: IncomingLand;
    /** The `sky` block, if this file declared one. */
    sky?: IncomingSky;
    /**
     * The `offset` directive value (engine `g_flTerrainGridZBase`), added to BOTH the X and Z
     * of every `.wdl` placement to map level-authoring coordinates into terrain world space.
     * Defaults to 0 if no `offset` directive is present.
     */
    offset: number;
    /**
     * The `water <level>` directive: the world-space Y of the water surface (engine
     * `g_flWaterLevel`). Undefined if the level has no water. Terrain tiles flagged as water
     * (`city2tc` bit 0x2000) are covered by a flat water plane at this height.
     */
    waterLevel?: number;
    /** Relative paths of `include`d `.odl` files, to be loaded and merged by the caller. */
    readonly includes: string[];
}

function stripComment(line: string): string {
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            inQuote = !inQuote;
        } else if (!inQuote && (c === ";" || c === "#")) {
            return line.substring(0, i);
        }
    }
    return line;
}

function tokenize(line: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    while (i < line.length) {
        const c = line[i];
        if (c === " " || c === "\t" || c === "\r") {
            i++;
        } else if (c === '"') {
            let j = i + 1;
            while (j < line.length && line[j] !== '"') {
                j++;
            }
            tokens.push(line.substring(i + 1, j));
            i = j + 1;
        } else {
            let j = i;
            while (j < line.length && line[j] !== " " && line[j] !== "\t" && line[j] !== "\r") {
                j++;
            }
            tokens.push(line.substring(i, j));
            i = j;
        }
    }
    return tokens;
}

const TOP_LEVEL_KEYWORDS = new Set(["include", "type", "land", "sky", "offset", "water"]);
const DYNAMICS_ATTR_KEYWORDS = new Set([
    "mass", "max", "min", "range", "linear", "size", "angular", "fire", "up", "bank",
    "pitch", "yaw", "roll",
]);

function parseRenderFlags(tokens: string[], part: IncomingPart): void {
    const joined = tokens.join(" ").toLowerCase();
    if (joined.includes("self illuminating")) {
        part.materialFlags |= IncomingMaterialFlag.SelfIlluminating;
    }
    if (joined.includes("semi transparent")) {
        part.materialFlags |= IncomingMaterialFlag.SemiTransparent;
    }
    if (joined.includes("semiinv")) {
        part.materialFlags |= IncomingMaterialFlag.SemiInverse;
    }
    if (joined.includes("reflective")) {
        part.materialFlags |= IncomingMaterialFlag.Reflective;
    }
    if (joined.includes("double sided")) {
        part.doubleSided = true;
    }
    if (joined.includes("flipx")) {
        part.flipX = true;
    }
    if (joined.includes("flipy")) {
        part.flipY = true;
    }
    if (joined.includes("flipz")) {
        part.flipZ = true;
    }
}

function parseTextureFlags(tokens: string[]): number {
    let flags = 0;
    for (const t of tokens) {
        const k = t.toLowerCase();
        if (k === "transparent") {
            flags |= IncomingTextureFlag.ColorKey;
        } else if (k === "alpha") {
            flags |= IncomingTextureFlag.Alpha;
        } else if (k === "alphabright") {
            flags |= IncomingTextureFlag.AlphaBright;
        } else if (k === "alphainv") {
            flags |= IncomingTextureFlag.AlphaInverse;
        }
    }
    return flags;
}

function newPart(name: string, parentIndex: number): IncomingPart {
    return {
        name,
        scale: 100.0,
        textures: [],
        textureFlags: 0,
        materialFlags: 0,
        doubleSided: false,
        flipX: false,
        flipY: false,
        flipZ: false,
        position: [0, 0, 0],
        forward: [0, 0, 1],
        up: [0, 1, 0],
        spinInheritOnly: false,
        flameFlicker: false,
        lights: [],
        animFrames: [],
        parentIndex,
    };
}

function newType(name: string): IncomingObjectType {
    return { name, parts: [newPart(name, -1)] };
}

interface TypeParseState {
    readonly type: IncomingObjectType;
    cur: number;
    block?: "animframes" | "skip" | "colourcycle" | "animate" | "dynamics";
}

/**
 * Parses an Incoming `.odl` file body into an {@link IncomingODL}.
 *
 * `include` directives are collected (not resolved) — the caller is responsible for
 * fetching and merging included files, since file loading is asynchronous.
 *
 * @param text The full text of the `.odl` file.
 * @returns The decoded object-definition data.
 */
export function parseODL(text: string): IncomingODL {
    const types = new Map<string, IncomingObjectType>();
    const includes: string[] = [];
    let land: IncomingLand | undefined;
    let sky: IncomingSky | undefined;
    let offset = 0;
    let waterLevel: number | undefined;

    const lines = text.split("\n");
    let curType: TypeParseState | undefined;
    let curBlock: "type" | "land" | "sky" | undefined;

    for (const rawLine of lines) {
        const tokens = tokenize(stripComment(rawLine));
        if (tokens.length === 0) {
            continue;
        }
        const kw = tokens[0].toLowerCase();

        // A top-level keyword ends any current block.
        if (TOP_LEVEL_KEYWORDS.has(kw)) {
            curType = undefined;
            curBlock = undefined;
            if (kw === "include") {
                if (tokens.length >= 2) {
                    includes.push(tokens[1]);
                }
            } else if (kw === "offset") {
                // Single-line directive: a world-space bias added to .wdl placement X and Z.
                if (tokens.length >= 2) {
                    offset = floatOrZero(tokens[1]);
                }
            } else if (kw === "water") {
                // Single-line directive: the water-surface Y (engine g_flWaterLevel).
                if (tokens.length >= 2) {
                    waterLevel = floatOrZero(tokens[1]);
                }
            } else if (kw === "type") {
                const name = tokens.length >= 2 ? tokens[1] : "";
                const type = newType(name);
                curType = { type, cur: 0 };
                types.set(name.toLowerCase(), type);
                curBlock = "type";
            } else if (kw === "land") {
                land = { heightfieldPath: "", cellFlagsPath: "", texturePaths: [] };
                curBlock = "land";
            } else if (kw === "sky") {
                sky = {
                    flat: false, gradient: [], fogColor: [0, 0, 0],
                    cloudLevelZ: 0, ambient: [128, 128, 128], directColor: [255, 255, 255],
                    lightDir: [0, -1, 0], lightUnnormalized: false,
                    sunColor: [255, 255, 255], sunSize: 0,
                };
                curBlock = "sky";
            }
            continue;
        }

        // Otherwise the line is content of the active block.
        if (curBlock === "type" && curType !== undefined) {
            parseTypeLine(kw, tokens, curType);
        } else if (curBlock === "land" && land !== undefined) {
            parseLandLine(kw, tokens, land);
        } else if (curBlock === "sky" && sky !== undefined) {
            parseSkyLine(kw, tokens, sky);
        }
    }

    return { types, land, sky, offset, waterLevel, includes };
}

function parseTypeLine(kw: string, tokens: string[], state: TypeParseState): void {
    if (state.block === "colourcycle") {
        if (kw === "colour") {
            const sprite = state.type.parts[state.cur].sprite;
            if (sprite !== undefined) {
                sprite.cycleColors.push([floatOrZero(tokens[1]), floatOrZero(tokens[2]), floatOrZero(tokens[3])]);
            }
            return;
        }
        state.block = undefined;
    } else if (state.block === "dynamics") {
        // Get only the maximum velocity.
        if (DYNAMICS_ATTR_KEYWORDS.has(kw)) {
            if (kw === "max" && tokens.length >= 3 && tokens[1].toLowerCase() === "vel") {
                state.type.maxVel = floatOrZero(tokens[2]);
            }
            return;
        }
        state.block = undefined;
    } else if (state.block === "animate") {
        // `animate` keyframe block: each line `"PART" position … [forward …] [up …]` poses a
        // named sub-part; `wait` separates keyframes (the engine plays them in sequence; we treat
        // the final pose as the animation target and oscillate to it); `end` terminates. Match the
        // part by name and record its target pose.
        if (kw === "end") {
            state.block = undefined;
        } else if (kw !== "wait") {
            const name = tokens[0].toLowerCase();
            const part = state.type.parts.find((p) => p.name.toLowerCase() === name);
            if (part !== undefined) {
                const pi = tokens.findIndex((t) => t.toLowerCase() === "position");
                const fi = tokens.findIndex((t) => t.toLowerCase() === "forward");
                const ui = tokens.findIndex((t) => t.toLowerCase() === "up");
                const animTarget: { position: [number, number, number]; forward?: [number, number, number]; up?: [number, number, number] } = {
                    position: pi >= 0 ? [floatOrZero(tokens[pi + 1]), floatOrZero(tokens[pi + 2]), floatOrZero(tokens[pi + 3])] : [part.position[0], part.position[1], part.position[2]],
                };
                if (fi >= 0) {
                    animTarget.forward = [floatOrZero(tokens[fi + 1]), floatOrZero(tokens[fi + 2]), floatOrZero(tokens[fi + 3])];
                }
                if (ui >= 0) {
                    animTarget.up = [floatOrZero(tokens[ui + 1]), floatOrZero(tokens[ui + 2]), floatOrZero(tokens[ui + 3])];
                }
                part.animTarget = animTarget;
            }
        }
        return;
    } else if (state.block !== undefined) {
        // Inside an `animatemodel` (frame list) or `skip` block: consume lines until `end`.
        if (kw === "end") {
            state.block = undefined;
        } else if (state.block === "animframes") {
            state.type.parts[state.cur].animFrames.push(tokens[0]);
        }
        return;
    }
    if (kw === "child") {
        // A child of the current part: descend a level.
        const name = tokens.length >= 2 ? tokens[1] : "";
        state.cur = state.type.parts.push(newPart(name, state.cur)) - 1;
        return;
    }
    if (kw === "sibling") {
        // A sibling of the current part: same parent, stay at this level.
        const name = tokens.length >= 2 ? tokens[1] : "";
        const parentIndex = state.type.parts[state.cur].parentIndex;
        state.cur = state.type.parts.push(newPart(name, parentIndex)) - 1;
        return;
    }
    if (kw === "<<") {
        // Explicit one-level pop: subsequent parts attach to the current part's parent. The
        // engine's recursive type parser (DefineObjectType @0x404930) ends a nested `child`
        // block on any unrecognised keyword; `<<` is the convention used between sub-trees.
        state.cur = state.type.parts[state.cur].parentIndex;
        return;
    }
    if (kw === "parent") {
        // Return to the root part (index 0). Type-wide attributes that follow (cannons,
        // animatemodel, …) belong to the whole object. DefineObjectType special-cases the
        // `parent` keyword as a nested-block terminator before its sub-command table lookup.
        state.cur = 0;
        return;
    }

    const part = state.type.parts[state.cur];
    if (kw === "objfile") {
        const arg = tokens.length >= 2 ? tokens[1].toLowerCase() : "";
        if (arg === "lod") {
            // Lower-detail LOD variant: intentionally ignored — only the highest detail is kept.
        } else if (arg === "as") {
            // Alias: reuse another part's mesh (resolved by the consumer).
            if (tokens.length >= 3) {
                part.aliasOf = tokens[2];
            }
        } else {
            // objfile "path.ian" [scale S]
            if (tokens.length >= 2) {
                part.objfile = tokens[1];
            }
            const si = tokens.findIndex((t) => t.toLowerCase() === "scale");
            if (si >= 0 && si + 1 < tokens.length) {
                part.scale = parseFloat(tokens[si + 1]) || part.scale;
            }
        }
    } else if (kw === "scale") {
        if (tokens.length >= 2) {
            part.scale = parseFloat(tokens[1]) || part.scale;
        }
    } else if (kw === "texture") {
        if (tokens.length >= 2) {
            part.texturePath = tokens[1];
            part.textures.push(tokens[1]);
        }
        part.textureFlags |= parseTextureFlags(tokens.slice(2));
    } else if (kw === "drawtype") {
        parseRenderFlags(tokens.slice(1), part);
    } else if (kw === "position") {
        // "position X Y Z [forward fx fy fz] [up ux uy uz]"
        part.position = [floatOrZero(tokens[1]), floatOrZero(tokens[2]), floatOrZero(tokens[3])];
        applyOrientationTokens(tokens, part);
    } else if (kw === "forward") {
        applyOrientationTokens(tokens, part);
    } else if (kw === "operate") {
        // `operate "spin" ax ay az` installs a per-frame local-axis rotation on the part.
        // `operate "bradar"` (no args) is the radar behaviour: the engine continuously sweeps the
        // radar's facing each frame (UpdateDebrisPhysicsObject @0x4456a0 — the install table maps
        // "bradar"→that fn, which integrates+renormalizes a direction vector → continuous rotation).
        // Reproduced as a steady yaw about the part's up axis. The engine sweeps the WHOLE object, but
        // the structural base mesh is radially symmetric at the game's low texture resolution so its
        // rotation is invisible there; at higher fidelity it visibly (wrongly) spins. So `bradar` is
        // marked inherit-only: the base mesh stays static and only the dish child on the axis sweeps.
        const op = tokens.length >= 2 ? tokens[1].toLowerCase() : "";
        if (op === "spin") {
            part.spin = [floatOrZero(tokens[2]), floatOrZero(tokens[3]), floatOrZero(tokens[4])];
        }
        else if (op === "bradar") {
            part.spin = [0, BRADAR_YAW_RATE, 0];
            part.spinInheritOnly = true;
        }
        else if (op === "spinengines") {
            // `operate "spinengines"` (no args): the engine-exhaust flame flicker
            // (ApplyFrameShakeToObjectMatrix @0x4466b0 — a per-frame staircase Z-scale of the part's
            // matrix, ~2.0..2.6 over 4 engine frames). Reproduced as a per-part Z-scale oscillation.
            part.flameFlicker = true;
        }
    } else if (kw === "lamplight") {
        // lamplight x y z r g b radius (OdlCmdLampLight): an omni light in part-local space.
        part.lights.push({
            kind: "lamp",
            position: [floatOrZero(tokens[1]), floatOrZero(tokens[2]), floatOrZero(tokens[3])],
            color: [floatOrZero(tokens[4]), floatOrZero(tokens[5]), floatOrZero(tokens[6])],
            radius: floatOrZero(tokens[7]),
        });
    } else if (kw === "pointlight" || kw === "spotlight") {
        // pointlight: range falloff intensity [colours]; spotlight: inner outer angle [colours].
        // Both mark the part as a light emitter; treat as an omni at the part origin (range = the
        // first numeric operand). Cone narrowing for spot is approximated as omni for now.
        const nums = tokens.slice(1).map((t) => parseFloat(t)).filter((n) => Number.isFinite(n));
        part.lights.push({
            kind: kw === "spotlight" ? "spot" : "point",
            position: [0, 0, 0],
            color: [255, 255, 255],
            radius: nums.length > 0 ? nums[0] : 1500,
        });
    } else if (kw === "name") {
        // `name "x"` sets the part's HUD/display label (e.g. the targeting-reticle name). It is
        // distinct from the mesh-resolution key {@link IncomingPart.name}, so it is captured
        // separately rather than overwriting it. No rendering effect.
        if (tokens.length >= 2) {
            part.displayName = tokens[1];
        }
    } else if (kw === "animatemodel") {
        // animatemodel \n "f0" "f1" … \n end (OdlCmdAnimateModel @0x406150): a mesh flipbook
        // whose frames are other TYPE names; the engine cycles the part's displayed mesh through
        // them. Begin collecting frame names (one per following line) until `end`. Any names on
        // this same line are captured too for robustness, though the data lists them per-line.
        state.block = "animframes";
        for (let i = 1; i < tokens.length; i++) {
            part.animFrames.push(tokens[i]);
        }
    } else if (kw === "animate") {
        // animate \n "PART" position … \n wait \n … \n end: a sub-part keyframe pose sequence
        // (helicopter landing gear, VTOL engine tilt, wing morph). Begin capturing per-part target
        // poses; the renderer oscillates each part between its default and target pose (living scene).
        state.block = "animate";
    } else if (kw === "sprite") {
        // sprite u=U v=V w=W h=H size=S colour 1=R G B (ParseOdlSpriteDef @0x406690): a billboard.
        // The UV rect is in texture pixels; `size` is the world billboard size (default 24); the
        // base colour follows `colour` as `N=R G B` (the `N=` slot prefix is stripped).
        const kv = (key: string): number => {
            const t = tokens.find((tok) => tok.toLowerCase().startsWith(key));
            return t !== undefined ? floatOrZero(t.slice(key.length)) : NaN;
        };
        const sizeTok = kv("size=");
        let color: [number, number, number] = [128, 128, 128];
        const ci = tokens.findIndex((t) => t.toLowerCase() === "colour");
        if (ci >= 0 && ci + 3 < tokens.length) {
            const rTok = tokens[ci + 1];
            const r = floatOrZero(rTok.includes("=") ? rTok.slice(rTok.indexOf("=") + 1) : rTok);
            color = [r, floatOrZero(tokens[ci + 2]), floatOrZero(tokens[ci + 3])];
        }
        part.sprite = {
            u: kv("u="), v: kv("v="), w: kv("w="), h: kv("h="),
            size: Number.isFinite(sizeTok) ? sizeTok : 24,
            color, cycleColors: [], cycleSpeed: 0,
        };
    } else if (kw === "colourfade") {
        // colourfade speed N + following `colour R G B` lines: animates
        // the part's sprite colour through the cycle list. Begin collecting the colour keyframes.
        const si = tokens.findIndex((t) => t.toLowerCase() === "speed");
        if (part.sprite !== undefined && si >= 0) {
            part.sprite.cycleSpeed = floatOrZero(tokens[si + 1]);
        }
        state.block = "colourcycle";
    } else if (kw === "dynamics") {
        // dynamics "class" + following attribute lines: the flight/physics model.
        // Begin the attribute block; the in-block handler captures `max vel` (the traversal speed).
        state.block = "dynamics";
    } else if (kw === "shadow") {
        // shadow "tex" [flags]: a type-wide ground-shadow silhouette texture. The
        // engine derives the shadow's footprint/placement from the object bounding box at render
        // time; captured here for completeness (shadow rendering is not yet implemented).
        if (tokens.length >= 2) {
            state.type.shadowTexture = tokens[1];
        }
    } else if (kw === "sphere" || kw === "hemisphere") {
        // sphere rad=R width=W height=H / hemisphere rad=R width=W height=H repeat=U V
        // (OdlCmdSphere/OdlCmdHemisphere): a procedural mesh (energy sphere/shield, dome canopy)
        // built in place of an objfile. `repeat` (hemisphere only) tiles the texture U×V.
        const kv = (key: string): number => {
            const t = tokens.find((tok) => tok.toLowerCase().startsWith(key));
            return t !== undefined ? floatOrZero(t.slice(key.length)) : NaN;
        };
        let repeatU = 1, repeatV = 1;
        const ri = tokens.findIndex((t) => t.toLowerCase().startsWith("repeat="));
        if (ri >= 0) {
            repeatU = floatOrZero(tokens[ri].slice("repeat=".length)) || 1;
            repeatV = ri + 1 < tokens.length ? floatOrZero(tokens[ri + 1]) || 1 : 1;
        }
        part.procGeom = {
            kind: kw === "hemisphere" ? "hemisphere" : "sphere",
            radius: kv("rad="), width: kv("width="), height: kv("height="), repeatU, repeatV,
        };
    } else if (kw === "smoke") {
        // smoke ox oy oz [rate N] [frames M] [size S] [colour R G B] [alpha A] (OdlCmdSmokeOperate):
        // a continuous puff emitter (e.g. cooling-tower smoke). The first 3 numbers are the local
        // emitter offset; the renderer animates a rising/fading column from it.
        const after = (key: string): number => {
            const ix = tokens.findIndex((t) => t.toLowerCase() === key);
            return ix >= 0 && ix + 1 < tokens.length ? floatOrZero(tokens[ix + 1]) : NaN;
        };
        const ci = tokens.findIndex((t) => t.toLowerCase() === "colour");
        const sizeV = after("size");
        const alphaV = after("alpha");
        const rateV = after("rate");
        const framesV = after("frames");
        // `frames` is negative for additive-blended trails (chimney/exhaust) and positive for the
        // alpha-blended cooling-tower plume; the engine takes its absolute value as the lifetime.
        const framesRaw = Number.isFinite(framesV) ? framesV : 42;
        part.smoke = {
            offset: [floatOrZero(tokens[1]), floatOrZero(tokens[2]), floatOrZero(tokens[3])],
            size: Number.isFinite(sizeV) ? sizeV : 70,
            color: ci >= 0 && ci + 3 < tokens.length ? [floatOrZero(tokens[ci + 1]), floatOrZero(tokens[ci + 2]), floatOrZero(tokens[ci + 3])] : [60, 60, 60],
            alpha: Number.isFinite(alphaV) ? alphaV : 128,
            rate: Number.isFinite(rateV) ? Math.max(1, Math.abs(rateV)) : 4,
            lifetime: Math.max(1, Math.abs(framesRaw)),
            additive: framesRaw < 0,
        };
    } else if (kw === "double" || kw === "self" || kw === "semi" || kw === "reflective" || kw === "semiinv") {
        // Bare inline render-flag phrase on its own line.
        parseRenderFlags(tokens, part);
    }
}

function applyOrientationTokens(tokens: string[], part: IncomingPart): void {
    const fi = tokens.findIndex((t) => t.toLowerCase() === "forward");
    if (fi >= 0) {
        part.forward = [floatOrZero(tokens[fi + 1]), floatOrZero(tokens[fi + 2]), floatOrZero(tokens[fi + 3])];
    }
    const ui = tokens.findIndex((t) => t.toLowerCase() === "up");
    if (ui >= 0) {
        part.up = [floatOrZero(tokens[ui + 1]), floatOrZero(tokens[ui + 2]), floatOrZero(tokens[ui + 3])];
    }
}

function parseLandLine(kw: string, tokens: string[], land: IncomingLand): void {
    if (kw === "texture") {
        if (tokens.length >= 2) {
            land.texturePaths.push(tokens[1]);
        }
    } else {
        // The first two bare quoted strings are the heightfield then cell-flags binaries.
        if (land.heightfieldPath === "") {
            land.heightfieldPath = tokens[0];
        } else if (land.cellFlagsPath === "") {
            land.cellFlagsPath = tokens[0];
        }
    }
}

function parseSkyLine(kw: string, tokens: string[], sky: IncomingSky): void {
    if (kw === "flat") {
        sky.flat = true;
    } else if (kw === "texture") {
        if (tokens.length >= 2) {
            sky.texturePath = tokens[1];
        }
    } else if (kw === "rgb") {
        sky.gradient.push([intOrZero(tokens[1]), intOrZero(tokens[2]), intOrZero(tokens[3])]);
    } else if (kw === "fog") {
        sky.fogColor = [intOrZero(tokens[1]), intOrZero(tokens[2]), intOrZero(tokens[3])];
    } else if (kw === "cloud") {
        // "cloud level <z>"
        const z = tokens[tokens.length - 1];
        sky.cloudLevelZ = parseFloat(z) || 0;
    } else if (kw === "ambiance" || kw === "ambience") {
        sky.ambient = [intOrZero(tokens[1]), intOrZero(tokens[2]), intOrZero(tokens[3])];
    } else if (kw === "direct") {
        sky.directColor = [intOrZero(tokens[1]), intOrZero(tokens[2]), intOrZero(tokens[3])];
    } else if (kw === "from") {
        sky.lightDir = [floatOrZero(tokens[1]), floatOrZero(tokens[2]), floatOrZero(tokens[3])];
        sky.lightUnnormalized = tokens.some((t) => t.toLowerCase() === "not_unit");
    } else if (kw === "sunimage") {
        if (tokens.length >= 2) {
            sky.sunImagePath = tokens[1];
        }
    } else if (kw === "color") {
        // The `color R G B` line follows `sunimage`: the sun's (warm) tint color.
        sky.sunColor = [intOrZero(tokens[1]), intOrZero(tokens[2]), intOrZero(tokens[3])];
    } else if (kw === "size") {
        sky.sunSize = floatOrZero(tokens[1]);
    }
}

function intOrZero(t: string | undefined): number {
    const n = t !== undefined ? parseInt(t, 10) : 0;
    return Number.isFinite(n) ? n : 0;
}

function floatOrZero(t: string | undefined): number {
    const n = t !== undefined ? parseFloat(t) : 0;
    return Number.isFinite(n) ? n : 0;
}
