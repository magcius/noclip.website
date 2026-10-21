import { cosf, f, s16, sinf, sqrtf } from "./f32.js";
import { G } from "./globals.js";
import { Vec3f, vec3 } from "./types.js";
import { AdvanceRng, Vec3fAddInPlace, Vec3fClear, Vec3fMulAdd, Vec3fScaleInPlace } from "./vecmath.js";

export const WEATHER_VIEWS = 2;
export const RAIN_PARTICLES = 512;
export const RAIN_PARTICLE_SLOTS = 522;

const RANDOM_TO_TWO = f(2.0 / 65535.0);
const WIND_TURN = f(6.2831855);
const WIND_STRENGTH_MAX = f(1.0);
const WIND_STRENGTH_MIN = f(0.5);
const LIGHTNING_TIMER_RATE = f(343.0);
const LIGHTNING_TIMER_LIMIT = 2048.0;
const LIGHTNING_CHANCE = 0x80;
const LIGHTNING_FLASH_FRAMES = 3;
const LIGHTNING_AREA_MASK = 0x7ff;
const EYE_AHEAD = f(3.0);
const RAIN_MIN_CAMERA_SPEED = f(0.2777777612);
const RAIN_CAMERA_SPEED_MUL = f(3.600000143);
const SNOW_FALL_RATE = f(0.5);
const SNOW_DRIFT = f(0.25);
const PARTICLE_UNITS = 16383.5;
const DRIFT_HOLD_MASK = 0xf;

export const weatherGlobals = {
    g_dwRainParticleCount: 0,
    g_fWindAngle: 0.0,
    g_fWindStrength: WIND_STRENGTH_MIN,
    g_vWindVelocity: vec3(),
    g_fRainCameraSpeed: 0.0,
    g_fRainCameraSpeedScale: 0.0,
    g_dwLightningFlashCounter: -1,
    g_fLightningFlashTimer: 0.0,
    g_bRainParticlesInitialized: 0,
    g_awRainParticlePos: Array.from({ length: WEATHER_VIEWS }, () => Array.from({ length: RAIN_PARTICLE_SLOTS }, () => [0, 0, 0])),
    g_avRainPrevCameraPos: [vec3(), vec3()] as Vec3f[],
    g_avRainVelocity: [vec3(), vec3()] as Vec3f[],
    g_avLightningBolt0: vec3(),
};

export function resetWeather(): void {
    const w = weatherGlobals;
    w.g_dwRainParticleCount = 0;
    w.g_fWindAngle = 0.0;
    w.g_fWindStrength = WIND_STRENGTH_MIN;
    Vec3fClear(w.g_vWindVelocity);
    w.g_fRainCameraSpeed = 0.0;
    w.g_fRainCameraSpeedScale = 0.0;
    w.g_dwLightningFlashCounter = -1;
    w.g_fLightningFlashTimer = 0.0;
    w.g_bRainParticlesInitialized = 0;
}

export function InitRandomRainParticles(): void {
    const w = weatherGlobals;
    w.g_dwRainParticleCount = RAIN_PARTICLES;
    for (let view = 0; view < WEATHER_VIEWS; view++) {
        for (let i = 0; i < RAIN_PARTICLES; i++) {
            const particle = w.g_awRainParticlePos[view][i];
            particle[0] = s16(AdvanceRng());
            particle[1] = s16(AdvanceRng());
            particle[2] = s16(AdvanceRng());
        }
    }
}

function randomUnit(): number {
    return f(f(f(AdvanceRng() & 0xffff) * RANDOM_TO_TWO) - f(1.0));
}

export function UpdateWindDirection(): void {
    const w = weatherGlobals;
    const dt = G.g_fFrameDeltaTime;
    w.g_fWindAngle = f(w.g_fWindAngle + f(randomUnit() * dt));
    if (w.g_fWindAngle >= WIND_TURN) {
        w.g_fWindAngle = f(w.g_fWindAngle - WIND_TURN);
    } else if (w.g_fWindAngle < 0.0) {
        w.g_fWindAngle = f(w.g_fWindAngle + WIND_TURN);
    }
    w.g_fWindStrength = f(w.g_fWindStrength + f(randomUnit() * dt));
    if (w.g_fWindStrength > WIND_STRENGTH_MAX) {
        w.g_fWindStrength = WIND_STRENGTH_MAX;
    } else if (w.g_fWindStrength < WIND_STRENGTH_MIN) {
        w.g_fWindStrength = WIND_STRENGTH_MIN;
    }
    w.g_vWindVelocity.x = f(cosf(w.g_fWindAngle) * f(dt * w.g_fWindStrength));
    w.g_vWindVelocity.y = f(sinf(w.g_fWindAngle) * f(dt * w.g_fWindStrength));
    w.g_vWindVelocity.z = 0.0;
}

export function UpdateLightningFlash(): void {
    const w = weatherGlobals;
    if (w.g_dwLightningFlashCounter >= 0) {
        w.g_fLightningFlashTimer = f(w.g_fLightningFlashTimer + f(LIGHTNING_TIMER_RATE * G.g_fFrameDeltaTime));
        if (w.g_dwLightningFlashCounter > 0) {
            w.g_dwLightningFlashCounter--;
        } else if (w.g_fLightningFlashTimer > LIGHTNING_TIMER_LIMIT) {
            w.g_dwLightningFlashCounter = -1;
        }
    } else if ((AdvanceRng() & 0xffff) < LIGHTNING_CHANCE) {
        w.g_dwLightningFlashCounter = LIGHTNING_FLASH_FRAMES;
        w.g_fLightningFlashTimer = 0.0;
        w.g_avLightningBolt0.x = f(AdvanceRng() & LIGHTNING_AREA_MASK);
        w.g_avLightningBolt0.y = f(AdvanceRng() & LIGHTNING_AREA_MASK);
        w.g_avLightningBolt0.z = G.g_LoadedTrack.minZ;
    }
}

export function UpdatePrecipitationParticles(): void {
    const w = weatherGlobals;
    const dt = G.g_fFrameDeltaTime;
    UpdateWindDirection();
    if (G.g_dwRainMode) {
        UpdateLightningFlash();
    }
    w.g_dwRainParticleCount = Math.trunc(RAIN_PARTICLES / G.g_dwNumViewports);
    const eye = vec3();
    for (let view = 0; view < G.g_dwNumViewports; view++) {
        const camera = G.g_aVehicles[view].activeCamera;
        Vec3fMulAdd(eye, camera.position, camera.forward, EYE_AHEAD);
        if (!w.g_bRainParticlesInitialized) {
            InitRandomRainParticles();
            for (const previous of w.g_avRainPrevCameraPos) {
                previous.x = eye.x;
                previous.y = eye.y;
                previous.z = eye.z;
            }
            w.g_bRainParticlesInitialized = 1;
        }
        if (!G.g_dwSnowMode && !G.g_dwRainMode) {
            return;
        }
        const previous = w.g_avRainPrevCameraPos[view];
        let dx = f(eye.x - previous.x);
        let dy = f(eye.y - previous.y);
        let dz = f(eye.z - previous.z);
        w.g_fRainCameraSpeed = f(sqrtf(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz))) / dt);
        if (w.g_fRainCameraSpeed > RAIN_MIN_CAMERA_SPEED) {
            const scale = f(f(sqrtf(f(w.g_fRainCameraSpeed * RAIN_CAMERA_SPEED_MUL)) * RAIN_MIN_CAMERA_SPEED) / w.g_fRainCameraSpeed);
            w.g_fRainCameraSpeedScale = scale;
            dx = f(dx * scale);
            dy = f(dy * scale);
            dz = f(dz * scale);
            w.g_fRainCameraSpeed = f(w.g_fRainCameraSpeed * scale);
        } else {
            w.g_fRainCameraSpeedScale = f(1.0);
        }
        if (G.g_dwSnowMode) {
            dz = f(dz + f(dt * SNOW_FALL_RATE));
        } else {
            const velocity = w.g_avRainVelocity[view];
            velocity.x = f(cosf(w.g_fWindAngle) * f(dt * w.g_fWindStrength));
            const sine = sinf(w.g_fWindAngle);
            velocity.z = f(dt + dt);
            const move = vec3(dx, dy, dz);
            dz = f(dz + velocity.z);
            velocity.y = f(sine * f(dt * w.g_fWindStrength));
            dx = f(dx + velocity.x);
            dy = f(dy + velocity.y);
            Vec3fScaleInPlace(move, f(w.g_fRainCameraSpeedScale * f(0.5)));
            Vec3fAddInPlace(velocity, move);
        }
        let driftStepX = 0.0;
        let driftStepY = 0.0;
        if (G.g_dwSnowMode) {
            driftStepX = f(f(randomUnit() * dt) * SNOW_DRIFT);
            driftStepY = f(f(randomUnit() * dt) * SNOW_DRIFT);
        }
        previous.x = eye.x;
        previous.y = eye.y;
        previous.z = eye.z;
        let holdX = AdvanceRng() & DRIFT_HOLD_MASK;
        let holdY = AdvanceRng() & DRIFT_HOLD_MASK;
        let driftX = s16(driftStepX * PARTICLE_UNITS);
        let driftY = s16(driftStepY * PARTICLE_UNITS);
        const moveX = s16(dx * PARTICLE_UNITS);
        const moveY = s16(dy * PARTICLE_UNITS);
        const moveZ = s16(dz * PARTICLE_UNITS);
        const particles = w.g_awRainParticlePos[view];
        for (let i = 0; i < w.g_dwRainParticleCount; i++) {
            const particle = particles[i];
            if (holdX !== 0) {
                holdX--;
                particle[0] = s16(particle[0] + moveX);
            } else {
                particle[0] = s16(particle[0] + moveX + driftX);
                driftX = s16(-driftX);
                holdX = AdvanceRng() & DRIFT_HOLD_MASK;
            }
            if (holdY !== 0) {
                holdY--;
                particle[1] = s16(particle[1] + moveY);
            } else {
                particle[1] = s16(particle[1] + moveY + driftY);
                driftY = s16(-driftY);
                holdY = AdvanceRng() & DRIFT_HOLD_MASK;
            }
            particle[2] = s16(particle[2] + moveZ);
        }
    }
}
