
// World-placed coloured point lights from the RSW (OT_LIGHTSRC). Indoor /
// dungeon maps seed dozens to hundreds at torches, lamps, candelabras, etc.;
// outdoor maps typically have none (their lighting is fully baked into the GND
// lightmap). The renderer adds a simple radial falloff per light on top of the
// baked terrain lighting, and applies the same lights to the RSM / Granny model
// passes with a Lambertian dot(N, L) so props pick up the glow correctly.
//
// Each light is parsed in RSW frame and converted here to the terrain's render
// frame (X mirrored about the map centre, Y negated, see coord.ts). Color and
// range are passed through unchanged.

import { GndMap } from "./gnd.js";
import { RswPointLight, RswWorld } from "./rsw.js";

// Cap on the shader's uniform light array. 64 is plenty for a single dungeon
// room around the camera (the densest maps in the corpus have ~800 lights total
// but only a handful are in close-quarter sight at once); if a map exceeds it we
// keep the N closest to the camera each frame (CPU-side sort + cull in
// `prepare`).
export const MAX_POINT_LIGHTS = 64;

// Global gain on the additive light contribution. RSW colours are already
// linear 0..1; pumping them slightly past 1.0 gives a noticeably warm glow on
// dim baked walls without blowing out the lit-floor highlights.
export const POINT_LIGHT_INTENSITY = 1.5;

// Falloff exponent: the per-light radial term is `pow(max(0, 1 - d/range), N)`,
// applied uniformly on terrain and models. 2.0 (inverse-square-ish) feels like
// a torch — bright at the source, fast falloff at the edge of `range`.
export const POINT_LIGHT_FALLOFF_EXPONENT = 2.0;

// A point light in the terrain's render frame: position is world XYZ, color is
// linear 0..1 RGB (pre-intensity, the shader multiplies by POINT_LIGHT_INTENSITY),
// range is in world units (the distance at which contribution falls to zero).
export interface PointLight {
    pos: [number, number, number];
    color: [number, number, number];
    range: number;
}

// Converts the RSW's map-centered, left-handed light positions into the
// terrain's corner-origin, right-handed render frame, exactly like the model
// placements and effect sources do: shift the centered RSW X by mapOffX into
// corner-origin, then mirror about the map centre (the two collapse to
// `mapOffX - pos.x`), shift Z by +mapOffZ, negate Y to match world_y = -height.
// (worldWidth - pos.x was wrong: pos.x is centered in [-mapOffX, +mapOffX], so
// worldWidth - pos.x ends up at [mapOffX, 3*mapOffX] and parks every light an
// extra mapOffX past the map's right edge — invisible.)
export function loadPointLights(rsw: RswWorld, gnd: GndMap): PointLight[] {
    const mapOffX = gnd.width * gnd.zoom * 0.5;
    const mapOffZ = gnd.height * gnd.zoom * 0.5;
    const out: PointLight[] = [];
    for (const l of rsw.lights) {
        // Cull obviously useless entries (zero range, all-black). Saves shader
        // cycles on maps that wrote disabled lights into the RSW.
        if (l.range <= 0)
            continue;
        if (l.color[0] <= 0 && l.color[1] <= 0 && l.color[2] <= 0)
            continue;
        out.push({
            pos: [mapOffX - l.pos.x, -l.pos.y, l.pos.z + mapOffZ],
            color: [l.color[0], l.color[1], l.color[2]],
            range: l.range,
        });
    }
    return out;
}

// Per-frame helper: picks the (up to MAX_POINT_LIGHTS) lights most likely to
// contribute at the camera position. The contribution metric is `range² /
// distanceFromCamera²` so a far but powerful light beats a near tiny one, and a
// light inside its own range from the camera always wins. Writes into `out`
// (caller-owned, length cap MAX_POINT_LIGHTS) and returns the count actually
// written. Pure CPU work; cheap even for the densest maps (~835 lights).
export function pickActiveLights(lights: PointLight[], eyeX: number, eyeY: number, eyeZ: number, out: (PointLight | null)[]): number {
    const n = lights.length;
    if (n <= MAX_POINT_LIGHTS) {
        for (let i = 0; i < n; i++)
            out[i] = lights[i];
        return n;
    }
    // For the over-cap path, score each light, partial-sort to keep the top K.
    // Avoid Array.sort on the full list — one pass + insertion into a fixed
    // K-sized array is cheaper at K=64, n<=~1000.
    const K = MAX_POINT_LIGHTS;
    const scores = new Float32Array(K);
    let filled = 0;
    let worstIdx = 0;
    let worstScore = Infinity;
    for (let i = 0; i < n; i++) {
        const l = lights[i];
        const dx = l.pos[0] - eyeX, dy = l.pos[1] - eyeY, dz = l.pos[2] - eyeZ;
        const dist2 = dx * dx + dy * dy + dz * dz + 1e-3;
        const score = (l.range * l.range) / dist2;
        if (filled < K) {
            out[filled] = l;
            scores[filled] = score;
            if (score < worstScore) {
                worstScore = score;
                worstIdx = filled;
            }
            filled++;
            if (filled === K) {
                // Rescan to find the true worst now that the array is full.
                worstScore = scores[0]; worstIdx = 0;
                for (let j = 1; j < K; j++)
                    if (scores[j] < worstScore) { worstScore = scores[j]; worstIdx = j; }
            }
            continue;
        }
        if (score <= worstScore)
            continue;
        // Replace the current worst, then rescan to find the new worst.
        out[worstIdx] = l;
        scores[worstIdx] = score;
        worstScore = scores[0]; worstIdx = 0;
        for (let j = 1; j < K; j++)
            if (scores[j] < worstScore) { worstScore = scores[j]; worstIdx = j; }
    }
    return K;
}
