import { GndMap } from "./gnd.js";
import { RswPointLight, RswWorld } from "./rsw.js";
import { GND_CELL_SIZE } from "./coord.js";

export const MAX_POINT_LIGHTS = 64;

export const POINT_LIGHT_INTENSITY = 1.5;

export const POINT_LIGHT_FALLOFF_EXPONENT = 2.0;

export interface PointLight {
    pos: [number, number, number];
    color: [number, number, number];
    range: number;
}

export function loadPointLights(rsw: RswWorld, gnd: GndMap): PointLight[] {
    const mapOffX = gnd.width * GND_CELL_SIZE * 0.5;
    const mapOffZ = gnd.height * GND_CELL_SIZE * 0.5;
    const out: PointLight[] = [];
    for (const l of rsw.lights) {
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

export function pickActiveLights(lights: PointLight[], eyeX: number, eyeY: number, eyeZ: number, out: PointLight[]): void {
    const n = lights.length;
    if (n <= MAX_POINT_LIGHTS) {
        out.length = n;
        for (let i = 0; i < n; i++)
            out[i] = lights[i];
        return;
    }

    const K = MAX_POINT_LIGHTS;
    out.length = K;
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
                worstScore = scores[0]; worstIdx = 0;
                for (let j = 1; j < K; j++)
                    if (scores[j] < worstScore) { worstScore = scores[j]; worstIdx = j; }
            }
            continue;
        }
        if (score <= worstScore)
            continue;
        out[worstIdx] = l;
        scores[worstIdx] = score;
        worstScore = scores[0]; worstIdx = 0;
        for (let j = 1; j < K; j++)
            if (scores[j] < worstScore) { worstScore = scores[j]; worstIdx = j; }
    }
}
