import { f, s16, s32, u8 } from "./f32.js";
import { G } from "./globals.js";
import { weatherGlobals } from "./weather.js";
import { TRACK_SURFACE_PAVED, TRACK_SURFACE_SLOW } from "./track.js";
import { RigidBody, SPRAY_SEGMENTS, SPRAY_SEGMENT_VERTICES, VEHICLE_WHEELS, Vec3f, Vehicle, vec3 } from "./types.js";
import {
    AdvanceRng,
    Vec3fClear,
    Vec3fDistanceSquared,
    Vec3fDot,
    Vec3fLength,
    Vec3fLerp,
    Vec3fMulAdd,
    Vec3fMulAddInPlace,
    Vec3fScale,
    Vec3fScaleInPlace,
    Vec3fSubtract,
    Vec3fSubtractInPlace,
} from "./vecmath.js";

export const PARTICLES = 256;

const SPRAY_UNITS = f(127.0);
const SPRAY_STEP_SHIFT = 12;
const SPRAY_FADE_SEGMENT = 5;
const SPRAY_TEXTURE_NEAR = 0x10;
const SPRAY_TEXTURE_FAR = 0x410;
const SPRAY_TEXTURE_SEGMENT_SHIFT = 11;
const SPRAY_FRAMES = f(3.0);
const SCATTER_DISTANCE_SQUARED = f(256.0);
const PARTICLE_MIN_SHARE = f(1.0 / 32.0);
const PARTICLE_SHARE = f(1.0 / 65280.0);
const RANDOM_SHARE = f(1.0 / 65535.0);
const TRACK_INSTANCE_SHELTER = 0x10;

export interface Particle {
    position: Vec3f;
    velocity: Vec3f;
    size: number;
    next: number;
    fade: number;
    alpha: number;
}

export const g_aParticlePool: Particle[] = Array.from({ length: PARTICLES }, () => ({
    position: vec3(),
    velocity: vec3(),
    size: 0,
    next: 0,
    fade: 0,
    alpha: 0,
}));

export const effectsGlobals = {
    g_wParticleFreeListHead: 0,
    g_wExhaustParticleListHead: 0,
    g_wTireSmokeListHead: 0,
    g_wPavedTireSmokeListHead: 0,
    initialized: false,
};

function wheelBodies(vehicle: Vehicle): RigidBody[] {
    const b = vehicle.wheelBodies;
    return [b[3], b[1], b[0], b[2]];
}

function setSprayColors(vehicle: Vehicle, wheel: number, colors: number[]): void {
    const head = vehicle.sprayVertices[wheel][0];
    head[0].cn[0] = colors[0];
    head[0].cn[1] = colors[1];
    head[0].cn[2] = colors[2];
    head[1].cn[0] = colors[3];
    head[1].cn[1] = colors[4];
    head[1].cn[2] = colors[5];
}

function ColorSpraySegment(vehicle: Vehicle, wheel: number): void {
    const head = vehicle.sprayVertices[wheel][0];
    const last = vehicle.sprayVertices[wheel][1];
    const track = G.g_dwSelectedTrackId;
    switch (vehicle.spraySegmentSurfaces[wheel][0]) {
        case 0:
            head[0].cn[0] = head[1].cn[0] = 0x30;
            head[0].cn[1] = head[1].cn[1] = 0x20;
            head[0].cn[2] = head[1].cn[2] = 0x10;
            return;
        case TRACK_SURFACE_PAVED:
            if (G.g_dwRainMode) {
                setSprayColors(vehicle, wheel, [0x64, 0x68, 0x6c, 0xa0, 0xa8, 0xb0]);
                return;
            }
            break;
        case TRACK_SURFACE_SLOW:
            if (track === 2 || track === 7) {
                if (G.g_dwSnowMode) {
                    setSprayColors(vehicle, wheel, [0x46, 0x64, 0x64, 0xd7, 0xeb, 0xc3]);
                } else {
                    setSprayColors(vehicle, wheel, [0x32, 0x64, 0x5f, 0xd2, 0xf0, 0xbe]);
                }
            } else if (track === 3 || track === 8) {
                setSprayColors(vehicle, wheel, [0x10, 0x10, 0x00, 0x40, 0x40, 0x10]);
            } else {
                setSprayColors(vehicle, wheel, [0x30, 0x18, 0x08, 0x80, 0x60, 0x40]);
            }
            if (G.g_dwRainMode) {
                for (let i = 0; i < 3; i++) {
                    head[0].cn[i] = u8(Math.trunc(head[0].cn[i] / 2) + 0x20);
                    head[1].cn[i] = u8(Math.trunc(head[1].cn[i] / 2) + 0x20);
                }
            } else if (G.g_dwNightMode) {
                for (let i = 0; i < 3; i++) {
                    head[0].cn[i] >>= 1;
                    head[1].cn[i] >>= 1;
                }
            }
            return;
    }
    vehicle.spraySegmentSurfaces[wheel][0] = -1;
    for (let k = 0; k < 2; k++) {
        head[k].cn[0] = last[k].cn[0];
        head[k].cn[1] = last[k].cn[1];
        head[k].cn[2] = last[k].cn[2];
    }
}

function AgeSpraySegment(vehicle: Vehicle, wheel: number, age: number): void {
    const vertices = vehicle.sprayVertices[wheel];
    const velocities = vehicle.sprayVelocities[wheel];
    for (let k = 0; k < SPRAY_SEGMENT_VERTICES; k++) {
        const to = vertices[age][k];
        const from = vertices[age - 1][k];
        to.ob[0] = from.ob[0];
        to.ob[1] = from.ob[1];
        to.ob[2] = from.ob[2];
        to.tc[0] = from.tc[0];
        to.tc[1] = from.tc[1];
        to.cn[0] = from.cn[0];
        to.cn[1] = from.cn[1];
        to.cn[2] = from.cn[2];
        to.cn[3] = from.cn[3];
        velocities[age][k][0] = velocities[age - 1][k][0];
        velocities[age][k][1] = velocities[age - 1][k][1];
        velocities[age][k][2] = velocities[age - 1][k][2];
    }
    vehicle.spraySegmentSurfaces[wheel][age] = vehicle.spraySegmentSurfaces[wheel][age - 1];
}

export function SpawnExhaustParticle(vehicle: Vehicle): void {
    const e = effectsGlobals;
    let random = f(AdvanceRng() & 0x1fff);
    const revs = f(vehicle.engineRpm * f(0.001));
    vehicle.exhaustTimer = f(vehicle.exhaustTimer + f(G.g_fFrameDeltaTime * f(f(f(1.0) + revs) + f(random * f(1.0 / 65536.0)))));
    if (!(vehicle.exhaustTimer > f(0.25))) {
        return;
    }
    const index = e.g_wParticleFreeListHead;
    if (index === 0) {
        return;
    }
    vehicle.exhaustTimer = 0.0;
    const particle = g_aParticlePool[index];
    e.g_wParticleFreeListHead = particle.next;
    particle.next = e.g_wExhaustParticleListHead;
    e.g_wExhaustParticleListHead = index;
    Vec3fScale(particle.velocity, vehicle.frame.forward, f(f(-1.5) - revs));
    const exhaust = vec3();
    Vec3fSubtract(exhaust, vehicle.wheelFrames[2].position, vehicle.frame.forward);
    Vec3fMulAdd(exhaust, exhaust, vehicle.frame.up, f(0.2));
    Vec3fMulAdd(exhaust, exhaust, vehicle.frame.side, f(0.2));
    random = f(f(AdvanceRng() & 0xffff) * RANDOM_SHARE);
    Vec3fSubtract(particle.position, vehicle.exhaustPosition, exhaust);
    Vec3fMulAdd(particle.position, exhaust, particle.position, f(random * random));
    vehicle.exhaustPosition.x = exhaust.x;
    vehicle.exhaustPosition.y = exhaust.y;
    vehicle.exhaustPosition.z = exhaust.z;
    const size = f(f(1.0) + f(revs * f(0.1)));
    particle.size = f(size * f(0.15));
    particle.fade = u8(f(f(f(1.0) / f(Vec3fLength(vehicle.placedVelocity) + size)) * f(255.0)));
    particle.alpha = 255;
}

export function EmitTireSpray(vehicle: Vehicle): void {
    let sheltered = false;
    if (vehicle.groundInstanceCount && G.g_LoadedTrack.instances[vehicle.groundInstances[0]].flags & TRACK_INSTANCE_SHELTER) {
        sheltered = true;
    }
    const track = G.g_dwSelectedTrackId;
    if (G.g_dwSnowMode && track !== 2 && track !== 7) {
        return;
    }
    const bodies = wheelBodies(vehicle);
    const speedShare = f(f(f(1.0) - f(f(50.0) / f(vehicle.speedKph + f(50.0)))) * f(3.0));
    let forwardSpeed = Vec3fDot(vehicle.frame.forward, vehicle.placedVelocity);
    if (forwardSpeed < 0.0) {
        forwardSpeed = -forwardSpeed;
    }
    const velocity = vec3();
    const position = vec3();
    for (let wheel = 0; wheel < VEHICLE_WHEELS; wheel++) {
        let holding: boolean;
        vehicle.sprayPhases[wheel] = f(vehicle.sprayPhases[wheel] + f(G.g_fFrameDeltaTime * f(4.0)));
        if (vehicle.sprayPhases[wheel] > f(0.75)) {
            holding = false;
            if (vehicle.sprayPhases[wheel] >= f(1.7)) {
                vehicle.sprayPhases[wheel] = f(vehicle.sprayPhases[wheel] - f(1.0));
            } else {
                vehicle.sprayPhases[wheel] = 0.0;
            }
            vehicle.sprayAdvanced[wheel] = 1;
        } else {
            holding = true;
            vehicle.sprayAdvanced[wheel] = 0;
        }
        if (bodies[wheel].contactFrames !== 0) {
            vehicle.sprayFramesLeft[wheel] = SPRAY_FRAMES;
            vehicle.spraySurfaces[wheel] = bodies[wheel].surface;
        } else if (vehicle.sprayFramesLeft[wheel] !== 0.0) {
            vehicle.sprayFramesLeft[wheel] = f(vehicle.sprayFramesLeft[wheel] - f(1.0));
        }
        const surface = vehicle.spraySurfaces[wheel];
        let throwing = false;
        let scale = 0;
        if (vehicle.sprayFramesLeft[wheel] !== 0.0) {
            if (holding) {
                scale = f(1.5);
                throwing = true;
            } else if (surface === TRACK_SURFACE_SLOW) {
                scale = f(2.5);
                throwing = true;
            } else if (surface === TRACK_SURFACE_PAVED && G.g_dwRainMode && !sheltered) {
                scale = f(1.5);
                throwing = true;
                if (!holding) {
                    vehicle.sprayPhases[wheel] = f(7.75);
                }
            }
        }
        if (throwing) {
            if (!holding) {
                Vec3fScale(velocity, vehicle.frame.up, scale);
                if (surface !== TRACK_SURFACE_PAVED) {
                    Vec3fMulAddInPlace(velocity, vehicle.frame.side, wheel === 0 ? scale : wheel < 3 ? -scale : scale);
                }
                if (surface !== TRACK_SURFACE_PAVED) {
                    Vec3fScaleInPlace(velocity, speedShare);
                    Vec3fMulAddInPlace(velocity, vehicle.placedVelocity, f(0.3));
                    Vec3fMulAddInPlace(velocity, vehicle.frame.side, f(Vec3fDot(vehicle.frame.side, vehicle.placedVelocity) * f(0.5)));
                } else {
                    const slide = f(f(f(1.0) - f(f(25.0) / f(f(f(2.24) * forwardSpeed) + f(25.0)))) * f(3.0));
                    Vec3fScaleInPlace(velocity, slide);
                    if (slide !== 0.0) {
                        if (wheel >= 2) {
                            velocity.z = f(velocity.z + velocity.z);
                        }
                        Vec3fMulAddInPlace(velocity, vehicle.frame.side, f(Vec3fDot(vehicle.frame.side, vehicle.placedVelocity) * f(0.3)));
                    }
                }
            }
            Vec3fMulAdd(position, vehicle.wheelFrames[wheel].position, vehicle.frame.up, f(-0.25));
            if (surface !== TRACK_SURFACE_PAVED || wheel < 2) {
                Vec3fMulAddInPlace(position, vehicle.frame.side, wheel !== 0 && wheel < 3 ? f(-0.15) : f(0.15));
            }
            const thrown = vec3(position.x, position.y, position.z);
            if (!holding && Vec3fDistanceSquared(position, vehicle.sprayPositions[wheel]) < SCATTER_DISTANCE_SQUARED) {
                const random = f(f(AdvanceRng() & 0xffff) * RANDOM_SHARE);
                Vec3fLerp(position, vehicle.sprayPositions[wheel], position, f(random * random));
            }
            vehicle.sprayPositions[wheel].x = thrown.x;
            vehicle.sprayPositions[wheel].y = thrown.y;
            vehicle.sprayPositions[wheel].z = thrown.z;
        } else {
            Vec3fClear(velocity);
            const p = vehicle.wheelFrames[wheel].position;
            position.x = p.x;
            position.y = p.y;
            position.z = p.z;
        }
        if (!holding) {
            const velocities = vehicle.sprayVelocities[wheel][0];
            velocities[1][0] = s16(f(velocity.x * SPRAY_UNITS));
            velocities[1][1] = s16(f(velocity.y * SPRAY_UNITS));
            velocities[1][2] = s16(f(velocity.z * SPRAY_UNITS));
            velocities[0][2] = 0;
            if (surface === TRACK_SURFACE_PAVED && G.g_dwRainMode) {
                velocities[0][0] = velocities[1][0];
                velocities[0][1] = velocities[1][1];
            } else {
                velocities[0][0] = velocities[1][0] >> 1;
                velocities[0][1] = velocities[1][1] >> 1;
            }
        }
        vehicle.spraySegmentSurfaces[wheel][0] = s16(surface);
        const head = vehicle.sprayVertices[wheel][0];
        const origin = vehicle.sprayOrigin;
        head[1].ob[0] = s16(f(f(position.x - origin.x) * SPRAY_UNITS));
        head[1].ob[1] = s16(f(f(position.y - origin.y) * SPRAY_UNITS));
        head[1].ob[2] = s16(f(f(position.z - origin.z) * SPRAY_UNITS));
        head[0].ob[0] = head[1].ob[0];
        head[0].ob[1] = head[1].ob[1];
        head[0].ob[2] = head[1].ob[2];
    }
}

export function MoveTireSpray(): void {
    const step = s32(f(G.g_fFrameDeltaTime * (1 << SPRAY_STEP_SHIFT)));
    const fall = s16(f(f(f(9.81) * G.g_fFrameDeltaTime) * SPRAY_UNITS));
    if (G.g_dwRacePauseState !== 0) {
        return;
    }
    for (let i = 0; i < G.g_dwNumVehicles; i++) {
        const vehicle = G.g_aRacerSlots[i].vehicle;
        if (vehicle === null) {
            continue;
        }
        const origin = vehicle.sprayOrigin;
        const position = vehicle.frame.position;
        const shiftX = s16(f(f(origin.x - position.x) * SPRAY_UNITS));
        const shiftY = s16(f(f(origin.y - position.y) * SPRAY_UNITS));
        const shiftZ = s16(f(f(origin.z - position.z) * SPRAY_UNITS));
        origin.x = f(origin.x - f(shiftX * f(1.0 / 127.0)));
        origin.y = f(origin.y - f(shiftY * f(1.0 / 127.0)));
        origin.z = f(origin.z - f(shiftZ * f(1.0 / 127.0)));
        for (let wheel = 0; wheel < VEHICLE_WHEELS; wheel++) {
            const advanced = vehicle.sprayAdvanced[wheel] !== 0;
            if (advanced) {
                ColorSpraySegment(vehicle, wheel);
                AgeSpraySegment(vehicle, wheel, 1);
            }
            for (let age = SPRAY_SEGMENTS - 1; age !== 0; age--) {
                if (age === 1 || advanced) {
                    AgeSpraySegment(vehicle, wheel, age);
                }
                const surface = vehicle.spraySegmentSurfaces[wheel][age];
                const segment = vehicle.sprayVertices[wheel][age];
                let alpha: number;
                if (surface === -1) {
                    alpha = 0;
                } else if (age >= SPRAY_FADE_SEGMENT) {
                    alpha = Math.trunc((255 * (SPRAY_SEGMENTS - 1 - age)) / 4);
                } else {
                    alpha = 255;
                }
                segment[0].cn[3] = alpha;
                segment[1].cn[3] = alpha;
                if (surface === TRACK_SURFACE_PAVED) {
                    segment[0].tc[0] = SPRAY_TEXTURE_FAR;
                    segment[1].tc[0] = SPRAY_TEXTURE_NEAR;
                } else {
                    segment[0].tc[0] = SPRAY_TEXTURE_NEAR;
                    segment[1].tc[0] = SPRAY_TEXTURE_FAR;
                }
                segment[0].tc[1] = s16(age << SPRAY_TEXTURE_SEGMENT_SHIFT);
                segment[1].tc[1] = s16(age << SPRAY_TEXTURE_SEGMENT_SHIFT);
                if (surface === -1 || age === 1 || (age === 2 && advanced)) {
                    for (let k = 0; k < 2; k++) {
                        segment[k].ob[0] = s16(segment[k].ob[0] + shiftX);
                        segment[k].ob[1] = s16(segment[k].ob[1] + shiftY);
                        segment[k].ob[2] = s16(segment[k].ob[2] + shiftZ);
                    }
                } else if (age !== SPRAY_SEGMENTS - 1) {
                    const velocities = vehicle.sprayVelocities[wheel][age];
                    segment[0].ob[0] = s16(segment[0].ob[0] + ((velocities[0][0] * step) >> SPRAY_STEP_SHIFT) + shiftX);
                    segment[0].ob[1] = s16(segment[0].ob[1] + ((velocities[0][1] * step) >> SPRAY_STEP_SHIFT) + shiftY);
                    segment[0].ob[2] = s16(segment[0].ob[2] + shiftZ);
                    segment[1].ob[0] = s16(segment[1].ob[0] + ((velocities[1][0] * step) >> SPRAY_STEP_SHIFT) + shiftX);
                    segment[1].ob[1] = s16(segment[1].ob[1] + ((velocities[1][1] * step) >> SPRAY_STEP_SHIFT) + shiftY);
                    segment[1].ob[2] = s16(segment[1].ob[2] + ((velocities[1][2] * step) >> SPRAY_STEP_SHIFT) + shiftZ);
                    if (segment[1].ob[2] < segment[0].ob[2]) {
                        segment[1].ob[2] = segment[0].ob[2];
                    } else {
                        velocities[1][2] = s16(velocities[1][2] - fall);
                    }
                }
            }
        }
    }
}

export function SpawnTireSmoke(vehicle: Vehicle): void {
    const e = effectsGlobals;
    if (vehicle.body.skidding === 0 || !(vehicle.speedKph > f(40.0))) {
        return;
    }
    const rate = f(f(G.g_fFrameDeltaTime * f(0.5)) + f(vehicle.speedKph * f(0.000660066)));
    const bodies = wheelBodies(vehicle);
    for (let wheel = 0; wheel < VEHICLE_WHEELS; wheel++) {
        vehicle.smokeTimers[wheel] = f(vehicle.smokeTimers[wheel] + f(rate * f(f(vehicle.body.skidding) * f(0.03))));
        if (!(vehicle.smokeTimers[wheel] > f(0.75))) {
            continue;
        }
        vehicle.smokeTimers[wheel] = 0.0;
        const body = bodies[wheel];
        if (body.contactFrames === 0) {
            continue;
        }
        if (body.surface !== 1 && body.surface !== 2 && body.surface !== TRACK_SURFACE_PAVED) {
            continue;
        }
        const index = e.g_wParticleFreeListHead;
        if (index === 0) {
            continue;
        }
        const particle = g_aParticlePool[index];
        e.g_wParticleFreeListHead = particle.next;
        if (body.surface === TRACK_SURFACE_PAVED) {
            particle.next = e.g_wPavedTireSmokeListHead;
            e.g_wPavedTireSmokeListHead = index;
        } else {
            particle.next = e.g_wTireSmokeListHead;
            e.g_wTireSmokeListHead = index;
        }
        Vec3fScale(particle.velocity, vehicle.placedVelocity, f(0.2));
        Vec3fMulAddInPlace(particle.velocity, vehicle.frame.up, wheel < 2 ? f(0.25) : f(2.0));
        if (wheel < 2) {
            Vec3fMulAddInPlace(particle.velocity, vehicle.frame.side, wheel === 0 ? f(0.5) : f(-0.5));
        }
        Vec3fSubtractInPlace(particle.velocity, vehicle.frame.forward);
        const fade = f(f(1.0) - f(f(50.0) / f(vehicle.speedKph + f(50.0))));
        Vec3fScaleInPlace(particle.velocity, fade);
        Vec3fSubtract(particle.position, vehicle.wheelFrames[wheel].position, vehicle.frame.forward);
        particle.position.z = f(particle.position.z + f(vehicle.groundDistance * f(0.5)));
        const thrown = vec3(particle.position.x, particle.position.y, particle.position.z);
        if (Vec3fDistanceSquared(particle.position, vehicle.smokePositions[wheel]) < SCATTER_DISTANCE_SQUARED) {
            const random = f(f(AdvanceRng() & 0xffff) * RANDOM_SHARE);
            Vec3fLerp(particle.position, vehicle.smokePositions[wheel], particle.position, f(random * random));
        }
        vehicle.smokePositions[wheel].x = thrown.x;
        vehicle.smokePositions[wheel].y = thrown.y;
        vehicle.smokePositions[wheel].z = thrown.z;
        particle.size = f(0.4);
        particle.fade = 25;
        particle.alpha = u8(f(f(f(f(239.0) * fade) * f(0.7)) + f(16.0)));
    }
}

function moveParticle(particle: Particle, share: number, step: number, rise: number): void {
    const wind = weatherGlobals.g_vWindVelocity;
    particle.position.x = f(particle.position.x + f(wind.x + f(f(particle.velocity.x * share) * step)));
    particle.position.y = f(particle.position.y + f(wind.y + f(f(particle.velocity.y * share) * step)));
    particle.position.z = f(particle.position.z + f(wind.z + f(f(f(rise * share) + f(0.8)) * step)));
}

export function UpdateExhaustParticles(): void {
    const e = effectsGlobals;
    const grow = f(f(0.3) * G.g_fFrameDeltaTime);
    let prev: Particle | null = null;
    let index = e.g_wExhaustParticleListHead;
    while (index !== 0) {
        const particle = g_aParticlePool[index];
        const step = G.g_fFrameDeltaTime;
        const next = particle.next;
        const share = f(f(particle.alpha * particle.fade) * PARTICLE_SHARE);
        particle.size = f(particle.size + grow);
        moveParticle(particle, share, step, particle.velocity.z);
        particle.fade = u8(f(f(5.7375) / f(particle.size * particle.size)));
        if (share < PARTICLE_MIN_SHARE) {
            if (prev === null) {
                e.g_wExhaustParticleListHead = particle.next;
            } else {
                prev.next = particle.next;
            }
            particle.next = e.g_wParticleFreeListHead;
            e.g_wParticleFreeListHead = index;
        } else {
            prev = particle;
        }
        index = next;
    }
}

export function UpdateTireSmoke(): void {
    const e = effectsGlobals;
    const grow = f(f(0.7) * G.g_fFrameDeltaTime);
    for (let list = 0; list < 2; list++) {
        let prev: Particle | null = null;
        let index = list !== 0 ? e.g_wTireSmokeListHead : e.g_wPavedTireSmokeListHead;
        while (index !== 0) {
            const particle = g_aParticlePool[index];
            const step = G.g_fFrameDeltaTime;
            const rise = particle.velocity.z;
            const next = particle.next;
            const share = f(f(particle.alpha * particle.fade) * PARTICLE_SHARE);
            particle.size = f(particle.size + grow);
            moveParticle(particle, share, step, rise);
            particle.velocity.z = f(rise - f(step * f(19.62)));
            particle.fade = u8(f(f(102.0) / particle.size));
            if (share < PARTICLE_MIN_SHARE || particle.velocity.z < f(-30.0)) {
                if (prev !== null) {
                    prev.next = particle.next;
                } else if (list !== 0) {
                    e.g_wTireSmokeListHead = particle.next;
                } else {
                    e.g_wPavedTireSmokeListHead = particle.next;
                }
                particle.next = e.g_wParticleFreeListHead;
                e.g_wParticleFreeListHead = index;
            } else {
                prev = particle;
            }
            index = next;
        }
    }
}

export function InitParticleSystem(): void {
    const e = effectsGlobals;
    for (let i = 1; i < PARTICLES; i++) {
        g_aParticlePool[i].next = i + 1;
    }
    g_aParticlePool[PARTICLES - 1].next = 0;
    e.g_wParticleFreeListHead = 1;
    for (let i = 0; i < G.g_dwNumActiveVehicles; i++) {
        G.g_aVehicles[i].exhaustTimer = 0.0;
    }
    e.g_wExhaustParticleListHead = 0;
    e.g_wTireSmokeListHead = 0;
    e.g_wPavedTireSmokeListHead = 0;
}

export function UpdateAllVehicleEffects(): void {
    const e = effectsGlobals;
    if (!e.initialized) {
        InitParticleSystem();
        e.initialized = true;
    }
    const each = (fn: (vehicle: Vehicle) => void): void => {
        for (let i = 0; i < G.g_dwNumVehicles; i++) {
            const vehicle = G.g_aRacerSlots[i].vehicle;
            if (vehicle !== null) {
                fn(vehicle);
            }
        }
    };
    if (G.g_dwSnowMode) {
        UpdateExhaustParticles();
        each((vehicle) => {
            SpawnExhaustParticle(vehicle);
            EmitTireSpray(vehicle);
        });
    } else if (!G.g_dwNightMode && !G.g_dwRainMode) {
        UpdateTireSmoke();
        each((vehicle) => {
            SpawnTireSmoke(vehicle);
            EmitTireSpray(vehicle);
        });
    } else {
        each(EmitTireSpray);
    }
}

export function resetEffects(): void {
    effectsGlobals.initialized = false;
}
