
// Billboard sprite actor + GPU renderer for Ragnarok Online SPR/ACT characters.
//
// An RO character is a stack of flat .spr images (clips) laid out each animation
// frame by an .act. For a free-fly viewer we draw each clip as a world-space
// Y-up (cylindrical) billboard: a real quad that stands vertically on the
// terrain at the actor's ground anchor and rotates around the world up-axis to
// face the camera horizontally. Unlike the original engine's screen-space
// projection (built for its locked camera), this stays a correct upright cutout
// from any orbit/pitch/zoom.
//
// The clip layout is the engine's: clip pixel offsets (recentered per .act
// version) position each image around the anchor, with mirror and rotation; the
// anchor is the feet (RO's +y is down the image, so it maps to world-up
// negated). Pixels map to world units by a fixed scale.
//
// Animation is framerate-independent: the action advances by accumulated real
// dt drained against the .act per-frame delay (the original stepped once per
// ~60fps frame; the delay table is in those units). No per-render-frame counters.

import { mat4, vec3 } from "gl-matrix";
import { GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { DeviceProgram } from "../Program.js";
import { DecodedImage } from "./bmp.js";
import { ActModel, recalcClipXY } from "./act.js";
import { SprModel } from "./spr.js";

// The original advances the motion as floor(elapsedMs / 24 / delay): one frame
// lasts delay * 24 ms. So seconds-per-frame = delay * (24/1000).
const DELAY_TO_SECONDS = 24.0 / 1000.0;

// Upper bound on a single accumulated step so a huge dt (a stall, a backgrounded
// tab) cannot spin the advance loop for an unbounded number of frames.
const MAX_ACCUM = 1.0;

// How far the billboard's up-axis leans from vertical (world-up) toward the
// camera's up-axis as the camera pitches. 0 = always vertical (edge-on from
// above); 1 = always fully face the camera (lies flat looking straight down).
// A partial value keeps sprites readable from an angled view while staying
// mostly upright.
const BILLBOARD_TILT = 0.5;

// World units per sprite pixel. A ground cell is `zoom` (~10) world units wide,
// and a Poring is ~37px, so this puts it at roughly two-thirds of a cell.
// Tunable — the original's on-screen scale doesn't map to a single world ratio.
const SPRITE_WORLD_SCALE = 0.2;

// Per-image cache of the bottommost row containing any non-transparent pixel,
// in image-local pixel coords (0..h-1). Computed once per DecodedImage; the
// images are shared by reference across clips so the cache is effective.
const visibleBottomRowCache = new WeakMap<DecodedImage, number>();

// Scans the image RGBA from the bottom row up for the first row with any
// alpha > 0. Returns -1 for an entirely transparent image. The image rgba is
// stored top-down (see bmp.ts decodeBMP / spr.ts compositeIndexed), so the
// bottom row is at index (h-1).
function visibleBottomRowOf(img: DecodedImage): number {
    const cached = visibleBottomRowCache.get(img);
    if (cached !== undefined)
        return cached;
    const w = img.width, h = img.height;
    let row = -1;
    for (let y = h - 1; y >= 0; y--) {
        let any = false;
        const base = y * w * 4 + 3; // alpha byte of first pixel in row
        for (let x = 0; x < w; x++) {
            if (img.rgba[base + x * 4] !== 0) {
                any = true;
                break;
            }
        }
        if (any) { row = y; break; }
    }
    visibleBottomRowCache.set(img, row);
    return row;
}

// Parallel to visibleBottomRowOf: the topmost row in the image with any
// non-transparent pixel. Used to plant name labels just above the visible
// hat/head of the current frame (ignoring the transparent margin baked into
// the sprite sheet). Cached per-image alongside the bottom-row cache.
const visibleTopRowCache = new WeakMap<DecodedImage, number>();
function visibleTopRowOf(img: DecodedImage): number {
    const cached = visibleTopRowCache.get(img);
    if (cached !== undefined)
        return cached;
    const w = img.width, h = img.height;
    let row = -1;
    for (let y = 0; y < h; y++) {
        let any = false;
        const base = y * w * 4 + 3; // alpha byte of first pixel in row
        for (let x = 0; x < w; x++) {
            if (img.rgba[base + x * 4] !== 0) {
                any = true;
                break;
            }
        }
        if (any) { row = y; break; }
    }
    visibleTopRowCache.set(img, row);
    return row;
}

// Per-actor (spr+act pair) cache of the ground anchor in clip-pixel space —
// see computeActorFootPxY. Computed once per pair the first time we draw it.
const actorFootPxYCache = new WeakMap<ActModel, WeakMap<SprModel, number>>();

// The actor's "foot line" in clip-y, derived from the idle pose. For each
// direction's idle motion-0 frame we compute the frame's lowest visible pixel
// (max over its clips of (clip.y + visRow) * zoomY) and return the MIN across
// directions. Rationale: the same character drawn from different angles often
// extends below its feet by a varying amount (a dress hem on front views, a
// spear butt on side views, a cape, etc.); per-frame anchoring would bob the
// figure by that variance as the camera orbits and the displayed direction
// changes. The min picks the frame with the smallest downward extension —
// effectively the artist's "true feet" row that's common to every direction —
// and lets other frames' hem/spear/cape dip below the ground geometrically.
//
// Scanning only the idle action (state 0, indices 0..7) avoids contamination
// from non-standing poses (dying/sitting) whose visible bottom may sit much
// higher and would pull the anchor up. NaN is returned for an actor with no
// visible pixels in any idle frame; callers should fall back to attach.
function computeActorFootPxY(act: ActModel, spr: SprModel): number {
    let minPerFrameMax = Infinity;
    const idleDirs = Math.min(8, act.actions.length);
    for (let a = 0; a < idleDirs; a++) {
        const motion = act.actions[a].motions[0];
        if (motion === undefined)
            continue;
        let frameMax = -Infinity;
        for (const c of motion.clips) {
            if (c.sprIndex < 0)
                continue;
            const frames = c.clipType === 0 ? spr.indexed : spr.rgba;
            if (c.sprIndex >= frames.length)
                continue;
            const img = frames[c.sprIndex];
            // Recenter pre-0x0205 clips against the .spr image dims, matching
            // the same correction buildQuads applies at draw time.
            let cy = c.y;
            if (act.version < 0x0205) {
                const tmp = { ...c };
                recalcClipXY(tmp, img.width, img.height, false, false);
                cy = tmp.y;
            }
            const visRow = visibleBottomRowOf(img);
            if (visRow < 0)
                continue;
            const visPxY = (cy + visRow) * c.zoomY;
            if (visPxY > frameMax)
                frameMax = visPxY;
        }
        if (frameMax > -Infinity && frameMax < minPerFrameMax)
            minPerFrameMax = frameMax;
    }
    return minPerFrameMax === Infinity ? NaN : minPerFrameMax;
}

function actorFootPxY(act: ActModel, spr: SprModel): number {
    let inner = actorFootPxYCache.get(act);
    if (inner === undefined) {
        inner = new WeakMap();
        actorFootPxYCache.set(act, inner);
    }
    const cached = inner.get(spr);
    if (cached !== undefined)
        return cached;
    const v = computeActorFootPxY(act, spr);
    inner.set(spr, v);
    return v;
}

// 3 floats world pos + 2 floats uv + 1 u32 color = 24 bytes.
const SPRITE_VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4 + 4;
const SPRITE_FLOATS_PER_VERTEX = 6;

// One drawable quad: 6 vertices (two triangles), plus which uploaded frame to
// bind (clipType 0 = indexed frame, otherwise the rgba frame set) and which
// sprite sheet that frame belongs to (filled by the renderer when flattening
// many instances across many sheets).
interface SpriteQuad {
    sheet: number;
    clipType: number;
    sprIndex: number;
    verts: Float32Array;     // 6 * (x,y,z,u,v,color); color word reinterpreted u32
    colors: Uint32Array;     // 6 packed RGBA, one per vertex
}

// CPU-side animation driver: selects the action from (state, direction),
// advances the motion frame off real dt, and builds the current frame's clips as
// world-space billboard quads. The GPU side (textures, draws) is the renderer's.
export class SpriteActor {
    private spr: SprModel;
    private act: ActModel;

    private state = 0;     // action base = state*8 (0 = idle/stand)
    private worldDir = 0;  // entity facing in the world, 0..7
    private dir = 0;       // displayed direction (worldDir relative to camera)
    private motion = 0;    // current frame within the action
    private accum = 0;     // dt accumulator for time-based animation

    // When true, the motion frame is set externally (e.g. a walking mob drives
    // its frame off distance travelled, the way the engine does) and the
    // time-based advance() is a no-op so the two drivers don't fight.
    private externalMotion = false;

    constructor(spr: SprModel, act: ActModel) {
        this.spr = spr;
        this.act = act;
    }

    // The SprModel this actor animates. The renderer uses it to look up which
    // uploaded sheet an actor draws from (mobs hold an actor, not a sheet index).
    public get sprModel(): SprModel {
        return this.spr;
    }

    public setState(state: number): void {
        if (state !== this.state) {
            this.state = state;
            this.motion = 0;
            this.accum = 0;
            this.externalMotion = false;
        }
    }

    // The playback delay of the current (state, dir) action, clamped to >= 1, as
    // the engine's GetDelay would return it. Used by a mob to scale its
    // distance-driven walk cadence the way the engine's m_motionSpeed does.
    public currentDelay(): number {
        const a = this.actionIndex();
        const d = a < this.act.delay.length ? this.act.delay[a] : 4.0;
        return d < 1 ? 1 : d;
    }

    // Number of motion frames in the current (state, dir) action.
    public currentMotionCount(): number {
        const a = this.actionIndex();
        if (a >= this.act.actions.length)
            return 0;
        return this.act.actions[a].motions.length;
    }

    // Does this .act actually carry the given state (state*8 + 0 lands inside
    // the action table)? actionIndex() clamps a missing state down to the last
    // available action, which would silently substitute (e.g. show walk frames
    // for a sprite asked to die) — callers that need the real state must
    // pre-check with this.
    public hasState(state: number): boolean {
        return this.act.actions.length > state * 8;
    }

    // Axis-aligned bounding rect of the current motion frame, in WORLD units,
    // sized to enclose every drawable clip this tick. Used by callers that
    // need to fit a hit area to the on-screen sprite (a click hitbox should
    // grow with a big mob and shrink with a small one). Returns null when the
    // frame has no drawable clips (sprite still loading, animation gap), so
    // the caller can fall back to a fixed-size guess. Rotation is ignored
    // (rare on character sprites and would only widen the box slightly).
    public currentFrameWorldSize(): { width: number, height: number } | null {
        if (this.act.actions.length === 0)
            return null;
        const action = this.actionIndex();
        const motions = this.act.actions[action].motions;
        if (motions.length === 0)
            return null;
        const mot = motions[this.motion % motions.length];
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let any = false;
        for (const src of mot.clips) {
            if (src.sprIndex < 0)
                continue;
            const frames = src.clipType === 0 ? this.spr.indexed : this.spr.rgba;
            if (src.sprIndex >= frames.length)
                continue;
            const img = frames[src.sprIndex];
            let clipX = src.x, clipY = src.y;
            if (this.act.version < 0x0205) {
                const tmp = { ...src };
                recalcClipXY(tmp, img.width, img.height, false, false);
                clipX = tmp.x;
                clipY = tmp.y;
            }
            const x0 = clipX * src.zoomX;
            const y0 = clipY * src.zoomY;
            const x1 = (clipX + img.width - 1.0) * src.zoomX;
            const y1 = (clipY + img.height - 1.0) * src.zoomY;
            // Mirrored clips swap left/right but cover the same horizontal
            // span; just take min/max of the pair.
            const loX = Math.min(x0, x1), hiX = Math.max(x0, x1);
            const loY = Math.min(y0, y1), hiY = Math.max(y0, y1);
            if (loX < minX) minX = loX;
            if (loY < minY) minY = loY;
            if (hiX > maxX) maxX = hiX;
            if (hiY > maxY) maxY = hiY;
            any = true;
        }
        if (!any)
            return null;
        return {
            width: (maxX - minX) * SPRITE_WORLD_SCALE,
            height: (maxY - minY) * SPRITE_WORLD_SCALE,
        };
    }

    // World-Y distance from the actor's world anchor (worldPos.y) UP to the
    // topmost VISIBLE pixel of the current motion frame, in world units.
    // Returns null for a frame with no visible pixels.
    //
    // For "feet" anchor: the anchor sits on the foot row (see actorFootPxY),
    // and the topmost visible pixel is somewhere above it; the value is the
    // height of the head/hat above the ground. For "center" anchor: the
    // anchor sits at the .act attach point (clip-y 0), and the value is the
    // distance from there to the visible top.
    //
    // Compared to currentFrameWorldSize().height — which is the full bounding
    // box including any hem/cape that dips below the foot row — this is the
    // exact height to land a label or icon at the head without over-shooting.
    public currentFrameTopAboveAnchor(anchor: SpriteAnchor = "feet"): number | null {
        if (this.act.actions.length === 0)
            return null;
        const action = this.actionIndex();
        const motions = this.act.actions[action].motions;
        if (motions.length === 0)
            return null;
        const mot = motions[this.motion % motions.length];

        let minVisPxY = Infinity;
        for (const c of mot.clips) {
            if (c.sprIndex < 0)
                continue;
            const frames = c.clipType === 0 ? this.spr.indexed : this.spr.rgba;
            if (c.sprIndex >= frames.length)
                continue;
            const img = frames[c.sprIndex];
            // Recenter pre-0x0205 clips against the .spr image dims, matching
            // the same correction buildQuads applies at draw time.
            let cy = c.y;
            if (this.act.version < 0x0205) {
                const tmp = { ...c };
                recalcClipXY(tmp, img.width, img.height, false, false);
                cy = tmp.y;
            }
            const topRow = visibleTopRowOf(img);
            if (topRow < 0)
                continue;
            const visPxY = (cy + topRow) * c.zoomY;
            if (visPxY < minVisPxY)
                minVisPxY = visPxY;
        }
        if (minVisPxY === Infinity)
            return null;

        let anchorPxY: number;
        if (anchor === "center") {
            anchorPxY = 0;
        } else {
            const foot = actorFootPxY(this.act, this.spr);
            anchorPxY = Number.isNaN(foot) ? 0 : foot;
        }
        // RO's +y is down the image; the top pixel has the smaller pxY, so
        // (anchorPxY - minVisPxY) is positive and grows with head height.
        return (anchorPxY - minVisPxY) * SPRITE_WORLD_SCALE;
    }

    // Drives the motion frame directly (used while walking, off distance) and
    // suppresses the time-based advance() until the next setState. Mirrors the
    // engine's ProcessMotionWithDist, which sets m_curMotion from accumulated
    // travel rather than from the frame clock.
    public setMotion(motion: number): void {
        const count = this.currentMotionCount();
        if (count <= 0)
            return;
        this.motion = ((motion % count) + count) % count;
        this.externalMotion = true;
    }

    // The entity's facing in the world (0..7). The drawn frame is this relative
    // to the camera, set per-frame via updateFacing.
    public setWorldDirection(d: number): void {
        this.worldDir = ((d % 8) + 8) % 8;
        this.dir = this.worldDir;
    }

    // Recompute the displayed sprite direction for the current camera direction
    // (0..7). RO draws an actor's facing relative to the view, so orbiting the
    // camera cycles which of the 8 directional frames is shown.
    public updateFacing(camDir: number): void {
        this.dir = ((this.worldDir - camDir) % 8 + 8) % 8;
    }

    private actionIndex(): number {
        if (this.act.actions.length === 0)
            return 0;
        const idx = this.state * 8 + this.dir;
        const last = this.act.actions.length - 1;
        return idx < 0 ? 0 : (idx > last ? last : idx);
    }

    // Framerate-independent frame stepping: accumulate dt and advance the motion
    // index whenever a frame's worth of .act delay has elapsed.
    public advance(dtSeconds: number): void {
        if (this.externalMotion)
            return; // motion frame is driven externally (distance-based walk)
        if (this.act.actions.length === 0)
            return;
        const action = this.actionIndex();
        const motionCount = this.act.actions[action].motions.length;
        if (motionCount <= 0)
            return;

        let d = action < this.act.delay.length ? this.act.delay[action] : 4.0;
        d *= DELAY_TO_SECONDS;
        if (d <= 0)
            return; // no cadence -> hold the current frame

        this.accum += dtSeconds;
        if (this.accum > MAX_ACCUM)
            this.accum = MAX_ACCUM;
        while (this.accum >= d) {
            this.accum -= d;
            this.motion = (this.motion + 1) % motionCount;
        }
    }

    // Builds the current motion's clips as world-space billboard quads. `camRight`
    // is the camera's horizontal right vector; the billboard plane is spanned by
    // camRight (horizontal) and world-up (vertical), so the sprite stays vertical
    // and turns to face the camera. `worldPos` is the anchor; `anchor` selects how
    // the frame sits on it: "feet" plants the frame's lowest pixel on the anchor
    // (characters/NPCs stand on the ground), while "center" places the .act attach
    // point (clip origin) on the anchor — RO's native placement, correct for
    // effect sprites (torch flames, etc.) that are authored around their emit
    // point and would otherwise float up by half their height.
    public buildQuads(camRight: vec3, camUp: vec3, worldPos: vec3, anchor: SpriteAnchor = "feet"): SpriteQuad[] {
        const out: SpriteQuad[] = [];
        if (this.act.actions.length === 0)
            return out;

        const action = this.actionIndex();
        const motions = this.act.actions[action].motions;
        if (motions.length === 0)
            return out;
        const mot = motions[this.motion % motions.length];

        const ax = worldPos[0], ay = worldPos[1], az = worldPos[2];

        // Pass 1: gather each clip's four corners in clip-pixel space (image +x
        // right, +y down). The ground anchor is computed once per actor (see
        // actorFootPxY) and stays constant across all frames/directions — using
        // the per-frame visible-bottom would bob the figure by several pixels
        // as the displayed direction changes (different directions extend below
        // the feet by different amounts: dress hem on front views, spear butt
        // on side views, etc.). The cached value is the artist's "true feet"
        // row, common to every idle direction, and lets the extending hem/
        // weapon dip below the ground geometrically. The .act attach point is
        // NOT a useful "feet" marker for RO NPC sprites — it sits roughly a
        // third of the way down the image (head/shoulders), well above the
        // feet, so anchoring by attach buries the body.
        interface ClipCorners {
            clipType: number;
            sprIndex: number;
            color: number;
            cx: number[]; // 4 corners: TL, TR, BL, BR
            cy: number[];
        }
        const clips: ClipCorners[] = [];

        for (const src of mot.clips) {
            if (src.sprIndex < 0)
                continue;
            const frames = src.clipType === 0 ? this.spr.indexed : this.spr.rgba;
            if (src.sprIndex >= frames.length)
                continue;
            const img = frames[src.sprIndex];

            // Pre-0x0205 .act files store clip origins to be recentered against
            // the referenced .spr frame's dimensions; from 0x0205 the parser
            // already recentered using the clip's own stored width/height.
            let clipX = src.x, clipY = src.y;
            if (this.act.version < 0x0205) {
                const tmp = { ...src };
                recalcClipXY(tmp, img.width, img.height, false, false);
                clipX = tmp.x;
                clipY = tmp.y;
            }

            // Clip pixel rect (top-left origin after recentering), scaled by the
            // clip's own zoom.
            const x1 = clipX * src.zoomX;
            const y1 = clipY * src.zoomY;
            const x2 = (clipX + img.width - 1.0) * src.zoomX;
            const y2 = (clipY + img.height - 1.0) * src.zoomY;

            const color = ((src.r | (src.g << 8) | (src.b << 16) | (src.a << 24)) >>> 0);

            const cx: number[] = [0, 0, 0, 0];
            const cy: number[] = [0, 0, 0, 0];
            if (src.angle !== 0) {
                const rad = src.angle * Math.PI / 180.0;
                const cs = Math.cos(rad), sn = Math.sin(rad);
                cx[0] = x1 * cs - y1 * sn; cy[0] = x1 * sn + y1 * cs;
                cx[1] = x2 * cs - y1 * sn; cy[1] = x2 * sn + y1 * cs;
                cx[2] = x1 * cs - y2 * sn; cy[2] = x1 * sn + y2 * cs;
                cx[3] = x2 * cs - y2 * sn; cy[3] = x2 * sn + y2 * cs;
            } else {
                // Horizontal mirror swaps the left/right edges.
                const xl = src.mirror ? x2 : x1;
                const xr = src.mirror ? x1 : x2;
                cx[0] = xl; cy[0] = y1; // TL
                cx[1] = xr; cy[1] = y1; // TR
                cx[2] = xl; cy[2] = y2; // BL
                cx[3] = xr; cy[3] = y2; // BR
            }

            clips.push({ clipType: src.clipType, sprIndex: src.sprIndex, color, cx, cy });
        }

        if (clips.length === 0)
            return out;

        // Anchor decision. Both modes share a single piece of math: offV = K - pxY
        // (so a pixel at clip-y K lands on the ground and smaller pxY rises).
        //
        //   "feet" (default): K = the actor's cached foot-line clipY (see
        //     actorFootPxY) — the artist's true foot row, common to every idle
        //     direction. Frames whose hem/spear/cape extend below that row let
        //     the extension dip into the ground geometrically.
        //
        //   "center" (explicit, for effect sources): K = 0 — always anchor at
        //     the .act attach point, regardless of the artwork's visible bottom
        //     (effect sprites have their emit point at the attach, by design).
        let anchorPxY: number;
        if (anchor === "center") {
            anchorPxY = 0;
        } else {
            const foot = actorFootPxY(this.act, this.spr);
            anchorPxY = Number.isNaN(foot) ? 0 : foot;
        }

        // Pass 2: emit. A clip pixel maps to a world offset along camRight
        // (horizontal) and world-up (vertical); the vertical is measured up
        // from the chosen anchorPxY so that anchor pixel sits on the ground.
        const emit = (verts: Float32Array, colors: Uint32Array, vi: number, pxX: number, pxY: number, u: number, v: number, color: number): void => {
            const offH = pxX * SPRITE_WORLD_SCALE;
            const offV = (anchorPxY - pxY) * SPRITE_WORLD_SCALE;
            const o = vi * SPRITE_FLOATS_PER_VERTEX;
            verts[o + 0] = ax + camRight[0] * offH + camUp[0] * offV;
            verts[o + 1] = ay + camRight[1] * offH + camUp[1] * offV;
            verts[o + 2] = az + camRight[2] * offH + camUp[2] * offV;
            verts[o + 3] = u;
            verts[o + 4] = v;
            colors[vi] = color;
        };

        for (const c of clips) {
            const verts = new Float32Array(6 * SPRITE_FLOATS_PER_VERTEX);
            const colors = new Uint32Array(6);
            // Two triangles: (TL, TR, BL) and (TR, BR, BL).
            emit(verts, colors, 0, c.cx[0], c.cy[0], 0.0, 0.0, c.color);
            emit(verts, colors, 1, c.cx[1], c.cy[1], 1.0, 0.0, c.color);
            emit(verts, colors, 2, c.cx[2], c.cy[2], 0.0, 1.0, c.color);
            emit(verts, colors, 3, c.cx[1], c.cy[1], 1.0, 0.0, c.color);
            emit(verts, colors, 4, c.cx[3], c.cy[3], 1.0, 1.0, c.color);
            emit(verts, colors, 5, c.cx[2], c.cy[2], 0.0, 1.0, c.color);
            // sheet is filled by the renderer (the actor only knows its own
            // sprite, not its index in the renderer's sheet registry).
            out.push({ sheet: 0, clipType: c.clipType, sprIndex: c.sprIndex, verts, colors });
        }

        return out;
    }
}

// Shader for the world-space sprite billboard: vertices arrive in world space and
// are projected by the scene matrix; the fragment samples the frame, modulates by
// the per-vertex tint, alpha-tests (RO cutout) then alpha-blends.
class SpriteProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;
    public static a_Color = 2;

    public static ub_SceneParams = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
};

uniform sampler2D u_FrameTexture;

varying vec2 v_TexCoord;
varying vec4 v_Color;
`;

    public override vert = `
layout(location = ${SpriteProgram.a_Position}) in vec3 a_Position;
layout(location = ${SpriteProgram.a_TexCoord}) in vec2 a_TexCoord;
layout(location = ${SpriteProgram.a_Color}) in vec4 a_Color;

void main() {
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(a_Position, 1.0);
    v_TexCoord = a_TexCoord;
    v_Color = a_Color;
}
`;

    public override frag = `
void main() {
    vec4 t_Texel = texture(SAMPLER_2D(u_FrameTexture), v_TexCoord);
    vec4 t_Color = t_Texel * v_Color;
    if (t_Color.a < 0.5)
        discard; // RO alpha cutout
    gl_FragColor = t_Color;
}
`;
}

function createRGBATexture(device: GfxDevice, img: DecodedImage): GfxTexture {
    const texture = device.createTexture({
        pixelFormat: GfxFormat.U8_RGBA_NORM,
        width: img.width,
        height: img.height,
        depthOrArrayLayers: 1,
        numLevels: 1,
        dimension: GfxTextureDimension.n2D,
        usage: GfxTextureUsage.Sampled,
    });
    device.uploadTextureData(texture, 0, [img.rgba]);
    return texture;
}

// How a sprite frame sits on its world anchor (see buildQuads).
export type SpriteAnchor = "feet" | "center";

// All data a placed sprite instance needs: which uploaded sprite sheet it draws
// from (an index into the renderer's sheet registry), its animated actor, the
// world anchor (render frame), and how the frame sits on it ("feet" by default).
export interface SpriteInstance {
    sheet: number;
    actor: SpriteActor;
    worldPos: vec3;
    anchor?: SpriteAnchor;
}

// One uploaded sprite sheet: the GPU frame textures for a single unique .spr,
// split by clip set (indexed vs rgba) exactly as the SprModel stores them.
interface SpriteSheet {
    indexedTex: (GfxTexture | null)[];
    rgbaTex: (GfxTexture | null)[];
}

// Owns the GPU resources for the whole sprite pass: a registry of uploaded
// sprite sheets (each unique .spr decoded/uploaded once), the shared billboard
// pipeline, and a transient per-frame vertex buffer re-filled from every
// instance's quads across every sheet. Driven from inside the terrain
// renderer's prepare/render cycle (transparent pass after the opaque scene).
export class SpriteRenderer {
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private sampler: GfxSampler;

    private sheets: SpriteSheet[] = [];

    private vertexBuffer: GfxIndexBufferDescriptor["buffer"] | null = null;
    private vertexCapacityVerts = 0;
    private device: GfxDevice;

    private instances: SpriteInstance[] = [];
    private scratchRight = vec3.create();
    private scratchUp = vec3.create();

    constructor(device: GfxDevice, cache: GfxRenderHelper["renderCache"]) {
        this.device = device;
        this.program = cache.createProgram(new SpriteProgram());

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: SpriteProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0 },
                { location: SpriteProgram.a_TexCoord, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0 },
                { location: SpriteProgram.a_Color, format: GfxFormat.U8_RGBA_NORM, bufferByteOffset: 5 * 4, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: SPRITE_VERTEX_STRIDE_BYTES, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
            indexBufferFormat: null,
        });

        // Nearest, clamp-to-edge: the faithful RO pixel-art look.
        this.sampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });
    }

    // Uploads a unique .spr's frames as a new sheet and returns its index. Call
    // once per distinct sprite; many instances then reference the index. The
    // SprModel's frames are decoded RGBA already, so a sheet is just GPU uploads.
    public addSheet(spr: SprModel): number {
        const indexedTex = spr.indexed.map((img) => (img.width > 0 && img.height > 0) ? createRGBATexture(this.device, img) : null);
        const rgbaTex = spr.rgba.map((img) => (img.width > 0 && img.height > 0) ? createRGBATexture(this.device, img) : null);
        this.sheets.push({ indexedTex, rgbaTex });
        return this.sheets.length - 1;
    }

    public addInstance(inst: SpriteInstance): void {
        this.instances.push(inst);
    }

    private frameTexture(sheet: number, clipType: number, sprIndex: number): GfxTexture | null {
        if (sprIndex < 0 || sheet < 0 || sheet >= this.sheets.length)
            return null;
        const s = this.sheets[sheet];
        const set = clipType === 0 ? s.indexedTex : s.rgbaTex;
        if (sprIndex >= set.length)
            return null;
        return set[sprIndex];
    }

    // Builds this frame's quads for every instance, uploads them to a transient
    // vertex buffer, and submits one draw per quad. Call inside the renderer's
    // prepare cycle after the opaque passes, with the active list selected.
    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4, cameraWorldMatrix: mat4, dtSeconds: number): void {
        if (this.instances.length === 0)
            return;
        const renderInstManager = renderHelper.renderInstManager;

        // The camera's right axis (world-to-camera column 0) flattened onto the
        // horizontal plane: the billboard turns around world-up to face the
        // camera while staying vertical. Degenerate (camera rolled to vertical
        // right) falls back to world +X.
        vec3.set(this.scratchRight, cameraWorldMatrix[0], 0, cameraWorldMatrix[2]);
        if (vec3.len(this.scratchRight) < 1e-5)
            vec3.set(this.scratchRight, 1, 0, 0);
        else
            vec3.normalize(this.scratchRight, this.scratchRight);

        // Up-axis: world-up leaned toward the camera's up by BILLBOARD_TILT, so
        // the sprite tilts to face an elevated camera instead of going edge-on.
        // (worldUp is (0,1,0), so mix = ((1-t)*0 + t*cux, (1-t) + t*cuy, ...).)
        const t = BILLBOARD_TILT;
        vec3.set(this.scratchUp, t * cameraWorldMatrix[4], (1 - t) + t * cameraWorldMatrix[5], t * cameraWorldMatrix[6]);
        if (vec3.len(this.scratchUp) < 1e-5)
            vec3.set(this.scratchUp, 0, 1, 0);
        else
            vec3.normalize(this.scratchUp, this.scratchUp);

        // Camera yaw -> one of 8 directions, matching the actor facing convention
        // (atan2(dirX, -dirZ)). The camera looks along its -Z; flatten that to the
        // ground plane. Each actor's drawn frame is its world facing minus this.
        const fwdX = -cameraWorldMatrix[8], fwdZ = -cameraWorldMatrix[10];
        const yawDeg = Math.atan2(fwdX, -fwdZ) * 180 / Math.PI;
        const camDir = ((Math.round(yawDeg / 45) % 8) + 8) % 8;

        // Sort instances back-to-front by squared distance from the camera so
        // overlapping actors composite correctly: with depthWrite below, the
        // depth buffer prevents far sprites from painting over near ones, but
        // the near sprite's soft alpha-cutout edges still blend against the
        // framebuffer — drawing the far one first means those edges blend
        // against the far sprite's body instead of the terrain, killing the
        // halo at the silhouette.
        const camX = cameraWorldMatrix[12], camY = cameraWorldMatrix[13], camZ = cameraWorldMatrix[14];
        this.instances.sort((a, b) => {
            const ax = a.worldPos[0] - camX, ay = a.worldPos[1] - camY, az = a.worldPos[2] - camZ;
            const bx = b.worldPos[0] - camX, by = b.worldPos[1] - camY, bz = b.worldPos[2] - camZ;
            return (bx * bx + by * by + bz * bz) - (ax * ax + ay * ay + az * az);
        });

        const quads: SpriteQuad[] = [];
        for (const inst of this.instances) {
            inst.actor.updateFacing(camDir);
            inst.actor.advance(dtSeconds);
            const built = inst.actor.buildQuads(this.scratchRight, this.scratchUp, inst.worldPos, inst.anchor ?? "feet");
            for (const q of built) {
                // Tag each quad with its instance's sheet so the draw loop binds
                // the right uploaded frame texture.
                q.sheet = inst.sheet;
                quads.push(q);
            }
        }
        if (quads.length === 0)
            return;

        // Resolve each quad's frame texture once, dropping any whose texture is
        // missing. Order is PRESERVED: a single actor's clips stack back-to-front
        // in array order (and the blend has no depth write), so we must not
        // globally reorder by texture — that would re-layer body parts. Instead we
        // coalesce *consecutive* quads sharing a texture into one draw below, which
        // collapses each actor's same-sheet clips and runs of adjacent same-sheet
        // mobs without changing the draw order or the look.
        const drawTex: GfxTexture[] = [];
        const drawQuads: SpriteQuad[] = [];
        for (const q of quads) {
            const tex = this.frameTexture(q.sheet, q.clipType, q.sprIndex);
            if (tex === null)
                continue;
            drawTex.push(tex);
            drawQuads.push(q);
        }
        if (drawQuads.length === 0)
            return;

        const vertexCount = drawQuads.length * 6;
        const data = new ArrayBuffer(vertexCount * SPRITE_VERTEX_STRIDE_BYTES);
        const f = new Float32Array(data);
        const u = new Uint32Array(data);

        // Flatten in original order, coalescing consecutive same-texture quads into
        // draw ranges.
        const ranges: { tex: GfxTexture, start: number, count: number }[] = [];
        for (let qi = 0; qi < drawQuads.length; qi++) {
            const quad = drawQuads[qi];
            for (let vi = 0; vi < 6; vi++) {
                const dst = (qi * 6 + vi) * SPRITE_FLOATS_PER_VERTEX;
                const src = vi * SPRITE_FLOATS_PER_VERTEX;
                f[dst + 0] = quad.verts[src + 0];
                f[dst + 1] = quad.verts[src + 1];
                f[dst + 2] = quad.verts[src + 2];
                f[dst + 3] = quad.verts[src + 3];
                f[dst + 4] = quad.verts[src + 4];
                u[dst + 5] = quad.colors[vi];
            }
            const tex = drawTex[qi];
            const last = ranges.length > 0 ? ranges[ranges.length - 1] : null;
            if (last !== null && last.tex === tex)
                last.count += 6;
            else
                ranges.push({ tex, start: qi * 6, count: 6 });
        }

        if (vertexCount > this.vertexCapacityVerts) {
            if (this.vertexBuffer !== null)
                this.device.destroyBuffer(this.vertexBuffer);
            this.vertexBuffer = this.device.createBuffer(vertexCount * SPRITE_VERTEX_STRIDE_BYTES, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
            this.vertexCapacityVerts = vertexCount;
        }
        if (this.vertexBuffer === null)
            return;
        this.device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(data));

        const vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [{ buffer: this.vertexBuffer, byteOffset: 0 }];

        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 1 }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(this.inputLayout, vertexBufferDescriptors, null);

        let offs = template.allocateUniformBuffer(SpriteProgram.ub_SceneParams, 16);
        const mapped = template.mapUniformBufferF32(SpriteProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, clipFromWorld);

        // Two-sided billboard; depth test AND depth write on so sprites occlude
        // each other (the cutout discard at 0.5 keeps transparent regions out
        // of the depth buffer; opaque-ish edges write depth and form a clean
        // silhouette). Default depth compare is LessEqual, which lets the
        // co-planar clips of one actor (all sharing the billboard plane's
        // depth) stack in submission order — body, then head, then accessories.
        // Standard src-alpha over blend for the soft cutout edge.
        const megaState = template.setMegaStateFlags({ cullMode: GfxCullMode.None, depthWrite: true });
        setAttachmentStateSimple(megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        // One draw per distinct frame texture (covers all quads sharing it).
        for (const r of ranges) {
            const renderInst = renderInstManager.newRenderInst();
            renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: r.tex, gfxSampler: this.sampler }]);
            renderInst.setDrawCount(r.count, r.start);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        for (const sheet of this.sheets) {
            for (const t of sheet.indexedTex)
                if (t !== null)
                    device.destroyTexture(t);
            for (const t of sheet.rgbaTex)
                if (t !== null)
                    device.destroyTexture(t);
        }
        if (this.vertexBuffer !== null)
            device.destroyBuffer(this.vertexBuffer);
    }
}
