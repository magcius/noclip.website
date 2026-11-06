
// Parser for Incoming (1998, Rage Software) ".odl" object-definition files.

// Stands in for the engine's continuous radar sweep, which has no authored rate.
const BRADAR_YAW_RATE = 0.3;

/** Render flags for an object type, OR'd from `drawtype` and the inline render-flag keywords. */
export const enum IncomingMaterialFlag {
    /** `self illuminating`, drawn full-bright. */
    SelfIlluminating = 0x01,
    /** `reflective`, environment-reflective. */
    Reflective = 0x02,
    /** `semi transparent`, alpha-blended. */
    SemiTransparent = 0x10,
    /** `semiinv`, inverse or additive blend. */
    SemiInverse = 0x20,
}

/** Texture attributes from a `texture "path" <flags...>` declaration. */
export const enum IncomingTextureFlag {
    /** `transparent`, 1-bit color-key: key-colored pixels are skipped. */
    ColorKey = 0x01,
    /** `alpha`, fully alpha-blended. */
    Alpha = 0x02,
    /** `alphabright`, additive. */
    AlphaBright = 0x04,
    /** `alphainv`, inverse alpha. */
    AlphaInverse = 0x08,
}

/** A light on a part, in that part's local model space. */
export interface IncomingLight {
    /** `lamp` and `point` are omni, `spot` is a cone. */
    readonly kind: "lamp" | "point" | "spot";
    /** Local-space position relative to the owning part. */
    readonly position: [number, number, number];
    /** RGB. Values may exceed 255, since lights are summed and then clamped. */
    readonly color: [number, number, number];
    /** Range in world units: lamp `radius`, point `range`. */
    readonly radius: number;
}

/**
 * A camera-facing billboard from the `sprite` directive, used for nav lights, engine glow and
 * smoke. The UV rect addresses a sub-region of the part's 256x256 `smoke.ppm` atlas.
 */
export interface IncomingSprite {
    /** Atlas left edge in texture pixels, `u=`. */
    readonly u: number;
    /** Atlas top edge in texture pixels, `v=`. */
    readonly v: number;
    /** Atlas width in texture pixels, `w=`. */
    readonly w: number;
    /** Atlas height in texture pixels, `h=`. */
    readonly h: number;
    /** World-space billboard size, `size=`, engine default 24. */
    readonly size: number;
    /** Base RGB 0..255, `colour 1=R G B`, engine default 128,128,128. */
    readonly color: [number, number, number];
    /** RGB keyframes from a `colourfade` block. Empty when the sprite holds a static colour. */
    cycleColors: [number, number, number][];
    /** Cycle rate from `colourfade speed N`, engine default 8. Zero for a static colour. */
    cycleSpeed: number;
}

/** Procedural geometry from `sphere` or `hemisphere`, used in place of an `objfile` mesh. */
export interface IncomingProcGeom {
    /** Which surface to tessellate. */
    readonly kind: "sphere" | "hemisphere";
    /** Radius in model units, `rad=`, scaled by the part scale like any mesh. */
    readonly radius: number;
    /** Longitude segments, `width=`. */
    readonly width: number;
    /** Latitude segments, `height=`. */
    readonly height: number;
    /** Texture tiling around the longitude: the hemisphere's first `repeat=` value, else 1. */
    readonly repeatU: number;
    /** Texture tiling along the latitude: the hemisphere's second `repeat=` value, else 1. */
    readonly repeatV: number;
}

/**
 * A smoke-plume emitter from the `smoke` directive, such as the power station's cooling tower. The
 * renderer animates a rising, expanding, fading column of `smoke.ppm` billboards from
 * {@link offset}.
 */
export interface IncomingSmoke {
    /** Emitter offset in part-local space. */
    readonly offset: [number, number, number];
    /** Starting billboard size, `size S`, engine default 70. Each puff grows 5 per frame. */
    readonly size: number;
    /** RGB 0..255, `colour R G B`. */
    readonly color: [number, number, number];
    /** Peak puff opacity 0..255, `alpha A`, engine default 128. Ignored when {@link additive}. */
    readonly alpha: number;
    /**
     * Frames between puff spawns, `rate N`, engine default 4. Puffs alive at once come to
     * `ceil(lifetime / rate)`.
     */
    readonly rate: number;
    /**
     * Puff lifetime in game frames, `frames M`, engine default 42. A puff rises 16 world units per
     * frame, making the column `lifetime * 16` units tall.
     */
    readonly lifetime: number;
    /**
     * True when `frames` was authored negative, which makes the engine blend the puffs additively.
     * Chimney and exhaust trails are additive; the cooling tower is not.
     */
    readonly additive: boolean;
}

/**
 * One node of an object type's part hierarchy: a mesh with its own material and a local pose
 * relative to its parent. `parts[0]` is the root, and `child` and `sibling` directives append the
 * rest. Non-visual directives such as dynamics, cannons and sound are parsed and discarded.
 */
export interface IncomingPart {
    /** The `type`, `child` or `sibling` token. Doubles as the key `objfile as` resolves against. */
    readonly name: string;
    /** HUD label from the `name "x"` sub-command. Informational, with no rendering effect. */
    displayName?: string;
    /** Path under `pcobject/` to this part's highest-detail `.ian`. */
    objfile?: string;
    /** Reuse the mesh of the same-type part with this name, from `objfile as`. */
    aliasOf?: string;
    /** Uniform model scale for this part's vertices, engine default 100.0. */
    scale: number;
    /** Path under `ppm/` to this part's material texture. */
    texturePath?: string;
    /**
     * Every `texture` path declared on the part, in order. More than one means animation frames,
     * such as the arctic energy shields cycling `water1` through `water16`. {@link texturePath}
     * mirrors the last entry for single-texture consumers.
     */
    textures: string[];
    /** Bitfield of {@link IncomingTextureFlag}. */
    textureFlags: number;
    /** Bitfield of {@link IncomingMaterialFlag}. */
    materialFlags: number;
    /** Never backface-cull this part's triangles, from the `double sided` face flag. */
    doubleSided: boolean;
    /**
     * Negate the mesh along an axis, from `drawtype flipx`, `flipy` and `flipz`, which are engine
     * face flags 0x02, 0x04 and 0x08. This builds a mirrored variant from a shared mesh: the
     * `cobra` is a `flipx flipz`, so a 180-degree yaw, of another helicopter.
     */
    flipX: boolean;
    flipY: boolean;
    flipZ: boolean;
    /** Position offset in root-model units, relative to the parent part. */
    position: [number, number, number];
    /** Forward orientation vector, relative to the parent part. */
    forward: [number, number, number];
    /** Up orientation vector, relative to the parent part. */
    up: [number, number, number];
    /**
     * Per-axis spin in radians per engine tick, from `operate "spin" ax ay az`, about the part's
     * own local axes.
     */
    spin?: [number, number, number];
    /**
     * Apply {@link spin} to this part's descendants but not its own mesh. Set for
     * `operate "bradar"`, a radar relay. The engine sweeps the whole object, but the structural base
     * is radially symmetric at the game's texture resolution, so its rotation never shows there. At
     * noclip's fidelity the base visibly and wrongly spins, so only the dish child turns.
     * `operate "spin"`, for rotors and rings, leaves this false and spins the part's own mesh.
     */
    spinInheritOnly: boolean;
    /**
     * Pulse the mesh's Z-scale each frame for an exhaust-flame flicker, from
     * `operate "spinengines"`. Animated at render time.
     */
    flameFlicker: boolean;
    /** Lights from `lamplight`, `pointlight` and `spotlight`, in part-local space. */
    lights: IncomingLight[];
    /**
     * Type names from `animatemodel "a" "b" ... end`, whose models the part cycles its mesh
     * through, as tank treads do. Empty when the part has no flipbook.
     */
    animFrames: string[];
    /**
     * Target local pose from an `animate` keyframe block, such as helicopter gear, VTOL engine tilt
     * or wing morph. The renderer oscillates the part between its default pose and this one.
     * `forward` and `up` are absent when the keyframe only moves the part.
     */
    animTarget?: { position: [number, number, number]; forward?: [number, number, number]; up?: [number, number, number] };
    /** Billboard sprite from the `sprite` directive. */
    sprite?: IncomingSprite;
    /** Procedural geometry, present instead of an `objfile` mesh. */
    procGeom?: IncomingProcGeom;
    /** Smoke plume emitter from the `smoke` directive. */
    smoke?: IncomingSmoke;
    /** Index into {@link IncomingObjectType.parts} of the parent, or -1 for the root. */
    parentIndex: number;
}

/**
 * A reusable object type from a `type "name" { ... }` block. Buildings and animals have a single
 * part; vehicles have a root plus children and siblings for their rotors and flaps.
 */
export interface IncomingObjectType {
    /** The type name, such as `"giraffe"`, used by `.wdl` `create` placements. */
    readonly name: string;
    /** The hierarchy. `parts[0]` is the root and every other part has a valid `parentIndex`. */
    readonly parts: IncomingPart[];
    /**
     * Path under `ppm/` to the type-wide ground-shadow silhouette, from the `shadow` directive.
     * Captured only; shadow rendering is not implemented.
     */
    shadowTexture?: string;
    /**
     * Maximum velocity in world units per engine tick, from the `dynamics` block's `max vel N`.
     * Used as the constant traversal speed for an actor following an MDL waypoint path: jets are
     * about 80, transport helicopters 42, hovercraft 25, big ships 20.
     */
    maxVel?: number;
}

/** The `land` block: terrain source binaries plus the land textures. */
export interface IncomingLand {
    /** Path under the data root to the int16 heightfield binary, `tland1.bin`. */
    heightfieldPath: string;
    /** Path to the per-tile cell and texcoord binary, `city2tc.bin`. */
    cellFlagsPath: string;
    /** Paths under `ppm/` to the land textures. Declaration order indexes the tile-material LUT. */
    texturePaths: string[];
}

/** The `sky` block: dome gradient, fog, cloud plane and scene lighting. */
export interface IncomingSky {
    /** True for a flat sky plane, `flat`; false for a hemisphere backdrop. */
    flat: boolean;
    /** Path under `ppm/` to the sky or cloud texture. */
    texturePath?: string;
    /** Up to 8 dome gradient colors, top to bottom, each RGB 0..255. */
    gradient: number[][];
    /** Fog color, RGB 0..255. */
    fogColor: number[];
    /** World-space Z of the cloud plane, from `cloud level`. */
    cloudLevelZ: number;
    /** Ambient light color from `ambiance`, RGB 0..255. */
    ambient: number[];
    /** Sun color from `direct`, RGB 0..255. */
    directColor: number[];
    /** World-space sun direction, from `from`. */
    lightDir: number[];
    /**
     * True when the `from` line ends in `not_unit`, which stops the engine normalizing the light
     * vector, so its magnitude of roughly 2 scales the directional term.
     */
    lightUnnormalized: boolean;
    /** Path under `ppm/` to the sun sprite, from `sunimage`. */
    sunImagePath?: string;
    /** Sun sprite tint from the `color` line after `sunimage`, RGB 0..255. */
    sunColor: number[];
    /** World-space sun sprite size, or 0 when unspecified. */
    sunSize: number;
}

/** The decoded contents of a single `.odl` file. */
export interface IncomingODL {
    /** Object types declared in this file, keyed by lower-cased name. */
    readonly types: Map<string, IncomingObjectType>;
    /** The `land` block, when the file declared one. */
    land?: IncomingLand;
    /** The `sky` block, when the file declared one. */
    sky?: IncomingSky;
    /**
     * The `offset` directive, added to both the X and Z of every `.wdl` placement to map authoring
     * coordinates into terrain world space. Defaults to 0.
     */
    offset: number;
    /**
     * World-space Y of the water surface from `water <level>`. Terrain tiles flagged as water are
     * covered by a flat plane at this height. Absent when the level has none.
     */
    waterLevel?: number;
    /** Paths of `include`d `.odl` files, for the caller to load and merge. */
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
 * Parses an `.odl` file body. `include` directives are collected rather than resolved, since
 * loading files is asynchronous and the caller owns it.
 *
 * @param text Full text of the file.
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

        if (TOP_LEVEL_KEYWORDS.has(kw)) {
            curType = undefined;
            curBlock = undefined;
            if (kw === "include") {
                if (tokens.length >= 2) {
                    includes.push(tokens[1]);
                }
            } else if (kw === "offset") {
                if (tokens.length >= 2) {
                    offset = floatOrZero(tokens[1]);
                }
            } else if (kw === "water") {
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
        if (DYNAMICS_ATTR_KEYWORDS.has(kw)) {
            if (kw === "max" && tokens.length >= 3 && tokens[1].toLowerCase() === "vel") {
                state.type.maxVel = floatOrZero(tokens[2]);
            }
            return;
        }
        state.block = undefined;
    } else if (state.block === "animate") {
        // Each line poses a named sub-part as `"PART" position … [forward …] [up …]`, `wait`
        // separates keyframes and `end` closes the block. The engine plays the sequence through; we
        // keep the last pose as a target and oscillate to it.
        if (kw === "end") {
            state.block = undefined;
        } else if (kw !== "wait") {
            const name = tokens[0].toLowerCase();
            const part = state.type.parts.find((p) => p.name.toLowerCase() === name);
            if (part !== undefined) {
                const positionIdx = tokens.findIndex((t) => t.toLowerCase() === "position");
                const forwardIdx = tokens.findIndex((t) => t.toLowerCase() === "forward");
                const upIdx = tokens.findIndex((t) => t.toLowerCase() === "up");
                const animTarget: { position: [number, number, number]; forward?: [number, number, number]; up?: [number, number, number] } = {
                    position: positionIdx >= 0 ? [floatOrZero(tokens[positionIdx + 1]), floatOrZero(tokens[positionIdx + 2]), floatOrZero(tokens[positionIdx + 3])] : [part.position[0], part.position[1], part.position[2]],
                };
                if (forwardIdx >= 0) {
                    animTarget.forward = [floatOrZero(tokens[forwardIdx + 1]), floatOrZero(tokens[forwardIdx + 2]), floatOrZero(tokens[forwardIdx + 3])];
                }
                if (upIdx >= 0) {
                    animTarget.up = [floatOrZero(tokens[upIdx + 1]), floatOrZero(tokens[upIdx + 2]), floatOrZero(tokens[upIdx + 3])];
                }
                part.animTarget = animTarget;
            }
        }
        return;
    } else if (state.block !== undefined) {
        if (kw === "end") {
            state.block = undefined;
        } else if (state.block === "animframes") {
            state.type.parts[state.cur].animFrames.push(tokens[0]);
        }
        return;
    }
    if (kw === "child") {
        const name = tokens.length >= 2 ? tokens[1] : "";
        state.cur = state.type.parts.push(newPart(name, state.cur)) - 1;
        return;
    }
    if (kw === "sibling") {
        const name = tokens.length >= 2 ? tokens[1] : "";
        const parentIndex = state.type.parts[state.cur].parentIndex;
        state.cur = state.type.parts.push(newPart(name, parentIndex)) - 1;
        return;
    }
    if (kw === "<<") {
        // The engine's recursive type parser ends a nested `child` block on any unrecognised
        // keyword. `<<` is the convention the data uses between sub-trees.
        state.cur = state.type.parts[state.cur].parentIndex;
        return;
    }
    if (kw === "parent") {
        // Type-wide attributes follow, so return to the root. The engine special-cases `parent` as
        // a block terminator before its sub-command table lookup.
        state.cur = 0;
        return;
    }

    const part = state.type.parts[state.cur];
    if (kw === "objfile") {
        const objfileArg = tokens.length >= 2 ? tokens[1].toLowerCase() : "";
        if (objfileArg === "lod") {
            // Only the highest detail is kept, so drop the LOD variants.
        } else if (objfileArg === "as") {
            // Aliases another part's mesh, resolved by the consumer.
            if (tokens.length >= 3) {
                part.aliasOf = tokens[2];
            }
        } else {
            // objfile "path.ian" [scale S]
            if (tokens.length >= 2) {
                part.objfile = tokens[1];
            }
            const scaleIdx = tokens.findIndex((t) => t.toLowerCase() === "scale");
            if (scaleIdx >= 0 && scaleIdx + 1 < tokens.length) {
                part.scale = parseFloat(tokens[scaleIdx + 1]) || part.scale;
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
        // position X Y Z [forward fx fy fz] [up ux uy uz]
        part.position = [floatOrZero(tokens[1]), floatOrZero(tokens[2]), floatOrZero(tokens[3])];
        applyOrientationTokens(tokens, part);
    } else if (kw === "forward") {
        applyOrientationTokens(tokens, part);
    } else if (kw === "operate") {
        // `bradar` takes no arguments: the engine integrates and renormalizes a direction vector
        // each frame, giving a continuous sweep. See IncomingPart.spinInheritOnly for why only the
        // children turn here.
        const operation = tokens.length >= 2 ? tokens[1].toLowerCase() : "";
        if (operation === "spin") {
            part.spin = [floatOrZero(tokens[2]), floatOrZero(tokens[3]), floatOrZero(tokens[4])];
        }
        else if (operation === "bradar") {
            part.spin = [0, BRADAR_YAW_RATE, 0];
            part.spinInheritOnly = true;
        }
        else if (operation === "spinengines") {
            // The engine walks the part's Z-scale up a staircase from about 2.0 to 2.6 over 4
            // frames.
            part.flameFlicker = true;
        }
    } else if (kw === "lamplight") {
        // lamplight x y z r g b radius
        part.lights.push({
            kind: "lamp",
            position: [floatOrZero(tokens[1]), floatOrZero(tokens[2]), floatOrZero(tokens[3])],
            color: [floatOrZero(tokens[4]), floatOrZero(tokens[5]), floatOrZero(tokens[6])],
            radius: floatOrZero(tokens[7]),
        });
    } else if (kw === "pointlight" || kw === "spotlight") {
        // pointlight is `range falloff intensity [colours]`, spotlight `inner outer angle
        // [colours]`. Both become an omni at the part origin taking the first operand as range,
        // which approximates the spot cone.
        const operands = tokens.slice(1).map((t) => parseFloat(t)).filter((n) => Number.isFinite(n));
        part.lights.push({
            kind: kw === "spotlight" ? "spot" : "point",
            position: [0, 0, 0],
            color: [255, 255, 255],
            radius: operands.length > 0 ? operands[0] : 1500,
        });
    } else if (kw === "name") {
        // Captured separately rather than overwriting IncomingPart.name, which meshes resolve by.
        if (tokens.length >= 2) {
            part.displayName = tokens[1];
        }
    } else if (kw === "animatemodel") {
        // animatemodel \n "f0" "f1" … \n end. The frame names are other type names. The data lists
        // one per line, but take any on this line too.
        state.block = "animframes";
        for (let i = 1; i < tokens.length; i++) {
            part.animFrames.push(tokens[i]);
        }
    } else if (kw === "animate") {
        state.block = "animate";
    } else if (kw === "sprite") {
        // sprite u=U v=V w=W h=H size=S colour 1=R G B. The UV rect is in texture pixels, and the
        // first colour operand carries an `N=` slot prefix to strip.
        const numberFor = (prefix: string): number => {
            const token = tokens.find((t) => t.toLowerCase().startsWith(prefix));
            return token !== undefined ? floatOrZero(token.slice(prefix.length)) : NaN;
        };
        const authoredSize = numberFor("size=");
        let color: [number, number, number] = [128, 128, 128];
        const colourIdx = tokens.findIndex((t) => t.toLowerCase() === "colour");
        if (colourIdx >= 0 && colourIdx + 3 < tokens.length) {
            const redToken = tokens[colourIdx + 1];
            const red = floatOrZero(redToken.includes("=") ? redToken.slice(redToken.indexOf("=") + 1) : redToken);
            color = [red, floatOrZero(tokens[colourIdx + 2]), floatOrZero(tokens[colourIdx + 3])];
        }
        part.sprite = {
            u: numberFor("u="), v: numberFor("v="), w: numberFor("w="), h: numberFor("h="),
            size: Number.isFinite(authoredSize) ? authoredSize : 24,
            color, cycleColors: [], cycleSpeed: 0,
        };
    } else if (kw === "colourfade") {
        // colourfade speed N, then `colour R G B` lines holding the keyframes.
        const speedIdx = tokens.findIndex((t) => t.toLowerCase() === "speed");
        if (part.sprite !== undefined && speedIdx >= 0) {
            part.sprite.cycleSpeed = floatOrZero(tokens[speedIdx + 1]);
        }
        state.block = "colourcycle";
    } else if (kw === "dynamics") {
        // dynamics "class", then attribute lines. Only `max vel` is kept.
        state.block = "dynamics";
    } else if (kw === "shadow") {
        // shadow "tex" [flags]
        if (tokens.length >= 2) {
            state.type.shadowTexture = tokens[1];
        }
    } else if (kw === "sphere" || kw === "hemisphere") {
        // sphere rad=R width=W height=H, or hemisphere rad=R width=W height=H repeat=U V, where
        // `repeat` is hemisphere-only.
        const numberFor = (prefix: string): number => {
            const token = tokens.find((t) => t.toLowerCase().startsWith(prefix));
            return token !== undefined ? floatOrZero(token.slice(prefix.length)) : NaN;
        };
        let repeatU = 1, repeatV = 1;
        const repeatIdx = tokens.findIndex((t) => t.toLowerCase().startsWith("repeat="));
        if (repeatIdx >= 0) {
            repeatU = floatOrZero(tokens[repeatIdx].slice("repeat=".length)) || 1;
            repeatV = repeatIdx + 1 < tokens.length ? floatOrZero(tokens[repeatIdx + 1]) || 1 : 1;
        }
        part.procGeom = {
            kind: kw === "hemisphere" ? "hemisphere" : "sphere",
            radius: numberFor("rad="), width: numberFor("width="), height: numberFor("height="), repeatU, repeatV,
        };
    } else if (kw === "smoke") {
        // smoke ox oy oz [rate N] [frames M] [size S] [colour R G B] [alpha A]. The first three
        // numbers are the local emitter offset.
        const numberAfter = (keyword: string): number => {
            const at = tokens.findIndex((t) => t.toLowerCase() === keyword);
            return at >= 0 && at + 1 < tokens.length ? floatOrZero(tokens[at + 1]) : NaN;
        };
        const colourIdx = tokens.findIndex((t) => t.toLowerCase() === "colour");
        const authoredSize = numberAfter("size");
        const authoredAlpha = numberAfter("alpha");
        const authoredRate = numberAfter("rate");
        const authoredFrames = numberAfter("frames");
        const signedFrames = Number.isFinite(authoredFrames) ? authoredFrames : 42;
        part.smoke = {
            offset: [floatOrZero(tokens[1]), floatOrZero(tokens[2]), floatOrZero(tokens[3])],
            size: Number.isFinite(authoredSize) ? authoredSize : 70,
            color: colourIdx >= 0 && colourIdx + 3 < tokens.length ? [floatOrZero(tokens[colourIdx + 1]), floatOrZero(tokens[colourIdx + 2]), floatOrZero(tokens[colourIdx + 3])] : [60, 60, 60],
            alpha: Number.isFinite(authoredAlpha) ? authoredAlpha : 128,
            rate: Number.isFinite(authoredRate) ? Math.max(1, Math.abs(authoredRate)) : 4,
            lifetime: Math.max(1, Math.abs(signedFrames)),
            additive: signedFrames < 0,
        };
    } else if (kw === "double" || kw === "self" || kw === "semi" || kw === "reflective" || kw === "semiinv") {
        // The same render flags can appear bare on their own line instead of after `drawtype`.
        parseRenderFlags(tokens, part);
    }
}

function applyOrientationTokens(tokens: string[], part: IncomingPart): void {
    const forwardIdx = tokens.findIndex((t) => t.toLowerCase() === "forward");
    if (forwardIdx >= 0) {
        part.forward = [floatOrZero(tokens[forwardIdx + 1]), floatOrZero(tokens[forwardIdx + 2]), floatOrZero(tokens[forwardIdx + 3])];
    }
    const upIdx = tokens.findIndex((t) => t.toLowerCase() === "up");
    if (upIdx >= 0) {
        part.up = [floatOrZero(tokens[upIdx + 1]), floatOrZero(tokens[upIdx + 2]), floatOrZero(tokens[upIdx + 3])];
    }
}

function parseLandLine(kw: string, tokens: string[], land: IncomingLand): void {
    if (kw === "texture") {
        if (tokens.length >= 2) {
            land.texturePaths.push(tokens[1]);
        }
    } else {
        // The first two bare quoted strings are the heightfield, then the cell flags.
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
        // cloud level <z>
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
        // This `color` line follows `sunimage` and tints the sun, not the sky.
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
