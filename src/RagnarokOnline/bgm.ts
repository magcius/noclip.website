
// Per-map background music. setMap(id) swaps the active track when BGM is
// enabled; tracks loop on a shared HTMLAudioElement. The id -> filename mapping
// is lazy-loaded from data/RagnarokOnline/bgm/index.json. Default OFF.
//
// The on/off state and volume persist across scene switches; the renderer's
// render-hacks panel hosts the toggle + slider (no separate overlay).

import { DataFetcher } from "../DataFetcher.js";

let indexPromise: Promise<Map<string, string> | null> | null = null;
let audio: HTMLAudioElement | null = null;
let enabled = false;
let currentMapId: string | null = null;
let currentVolume = 0.5;
let pathBase: string | null = null;
let lastFetcher: DataFetcher | null = null;
let sceneGeneration = 0;

function loadIndex(dataFetcher: DataFetcher): Promise<Map<string, string> | null> {
    if (indexPromise !== null)
        return indexPromise;
    if (pathBase === null)
        return Promise.resolve(null);
    const url = `${pathBase}/bgm/index.json`;
    indexPromise = (async () => {
        try {
            const data = await dataFetcher.fetchData(url, { allow404: true });
            const text = new TextDecoder("utf-8").decode(data.createTypedArray(Uint8Array));
            const obj = JSON.parse(text) as Record<string, string>;
            return new Map(Object.entries(obj));
        } catch {
            return null;
        }
    })();
    return indexPromise;
}

async function urlForMap(dataFetcher: DataFetcher, mapId: string): Promise<string | null> {
    if (pathBase === null)
        return null;
    const idx = await loadIndex(dataFetcher);
    if (idx === null)
        return null;
    const file = idx.get(mapId);
    if (file === undefined)
        return null;
    return dataFetcher.getDataURLForPath(`${pathBase}/bgm/${file}`);
}

function ensureAudio(): HTMLAudioElement {
    if (audio === null) {
        audio = new Audio();
        audio.loop = true;
        audio.preload = "auto";
        audio.volume = currentVolume;
    }
    return audio;
}

export function setBgmPathBase(base: string): void {
    pathBase = base;
}

export async function setMap(dataFetcher: DataFetcher, mapId: string): Promise<void> {
    const generation = ++sceneGeneration;
    lastFetcher = dataFetcher;
    if (mapId === currentMapId)
        return;
    currentMapId = mapId;
    if (!enabled)
        return;
    await applyCurrent(dataFetcher, generation);
}

export async function setEnabled(value: boolean, dataFetcher: DataFetcher | null): Promise<void> {
    if (enabled === value) return;
    enabled = value;
    if (!value) {
        if (audio !== null)
            audio.pause();
        return;
    }
    const f = dataFetcher ?? lastFetcher;
    if (f !== null)
        await applyCurrent(f, sceneGeneration);
}

export function isEnabled(): boolean {
    return enabled;
}

export function setVolume(v: number): void {
    currentVolume = Math.max(0, Math.min(1, v));
    if (audio !== null)
        audio.volume = currentVolume;
}

export function getVolume(): number {
    return currentVolume;
}

export function stop(): void {
    if (audio === null)
        return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
}

// Teardown for scene destroy; preserves the user's enabled preference.
export function teardownScene(): void {
    sceneGeneration++;
    currentMapId = null;
    lastFetcher = null;
    stop();
}

async function applyCurrent(dataFetcher: DataFetcher, generation: number): Promise<void> {
    if (currentMapId === null)
        return;
    const mapId = currentMapId;
    const url = await urlForMap(dataFetcher, mapId);
    if (generation !== sceneGeneration || mapId !== currentMapId)
        return;
    // User may have flipped BGM OFF while the fetch was in flight.
    if (!enabled)
        return;
    const a = ensureAudio();
    if (url === null) {
        a.pause();
        a.removeAttribute("src");
        a.load();
        return;
    }
    if (a.src === url) {
        a.play().catch(() => { /* autoplay block; user gesture required */ });
        return;
    }
    a.src = url;
    a.volume = currentVolume;
    try {
        await a.play();
    } catch {
        // Autoplay blocked without a user gesture; user interaction will succeed.
    }
}
