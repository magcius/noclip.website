import { vec3 } from "gl-matrix";
import { Descent1Level } from "../D1/D1Level";
import { Descent2Level } from "../D2/D2Level";
import { DescentFlickeringLight } from "./Level";
import { DescentSegment } from "./LevelTypes";

/** Run light flicker, return lights that turned on/off. */
export function flickerLights(
    level: Descent1Level | Descent2Level,
    deltaSeconds: number,
): {
    on: DescentFlickeringLight[];
    off: DescentFlickeringLight[];
} {
    const lightsOn: DescentFlickeringLight[] = [];
    const lightsOff: DescentFlickeringLight[] = [];

    for (const light of level.flickeringLights) {
        // Don't bother running flickering lights without deltas
        if (light.deltas.length === 0) continue;

        // Simulate the original game: use the timer, keep track of the
        // delay, rotate mask one bit to the left for the new state
        light.timer -= deltaSeconds;

        if (light.timer < 0) {
            light.timer += light.delay * -Math.floor(light.timer / light.delay);

            light.mask = (light.mask << 1) | (light.mask >>> 31);
            const state = !!(light.mask & 1);

            if (state !== light.isOn) {
                light.isOn = state;
                (state ? lightsOn : lightsOff).push(light);
            }
        }
    }

    return { on: lightsOn, off: lightsOff };
}

function getSegmentCenter(segment: DescentSegment) {
    const v = vec3.create();
    for (const vertex of segment.vertices) vec3.add(v, v, vertex);
    vec3.scale(v, v, 1 / segment.vertices.length);
    return v;
}

const MAGICAL_LIGHT_CONSTANT = 16;

function applySegmentLightSub(
    segment: DescentSegment,
    lightCenter: vec3,
    light: number,
    depth: number,
    visited: Set<number>,
) {
    const segmentCenter = getSegmentCenter(segment);
    const distance = vec3.distance(segmentCenter, lightCenter);

    if (distance <= 80)
        segment.light +=
            (light * MAGICAL_LIGHT_CONSTANT) / Math.max(1, distance);

    if (depth < 2) {
        for (const side of segment.sides) {
            const neighbor = side.connection;
            if (neighbor !== null && !visited.has(neighbor.segmentNum)) {
                visited.add(neighbor.segmentNum);
                applySegmentLightSub(
                    segment,
                    lightCenter,
                    light,
                    depth + 1,
                    visited,
                );
            }
        }
    }
}

export function applySegmentLight(
    segment: DescentSegment,
    center: vec3 | null,
    light: number,
) {
    applySegmentLightSub(
        segment,
        center ?? getSegmentCenter(segment),
        light,
        0,
        new Set(),
    );
}
