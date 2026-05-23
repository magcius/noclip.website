
// Per-map background music. setMap(id) swaps the active track when BGM is
// enabled; tracks loop on a shared HTMLAudioElement. The id -> filename mapping
// is lazy-loaded from data/RagnarokOnline/bgm/index.json. Default OFF.

import { DataFetcher } from "../DataFetcher.js";

let indexPromise: Promise<Map<string, string> | null> | null = null;
let audio: HTMLAudioElement | null = null;
let enabled = false;
let currentMapId: string | null = null;
let currentVolume = 0.5;
let pathBase: string | null = null;
let lastFetcher: DataFetcher | null = null;
let sceneGeneration = 0;

// In-viewport toggle button. A click here counts as the user gesture browsers
// require to start playback; programmatic setEnabled calls do not.
let overlayButton: HTMLButtonElement | null = null;
const enabledListeners = new Set<(value: boolean) => void>();

function ensureOverlay(): void {
    if (overlayButton !== null || typeof document === "undefined")
        return;
    const b = document.createElement("button");
    b.type = "button";
    b.title = "Toggle BGM";
    // Match noclip's bottom-bar SingleIconButton; positioned left of the
    // share+fullscreen cluster.
    b.style.cssText = [
        "position: fixed",
        "bottom: 16px",
        "right: 140px",
        "z-index: 99",
        "width: 40px",
        "height: 40px",
        "border-radius: 4px",
        "border: 0",
        "background: rgba(33, 33, 33, 0.85)",
        "color: white",
        "font: 20px/1 sans-serif",
        "cursor: pointer",
        "padding: 0",
        "transition: background 0.15s ease",
    ].join("; ");
    b.onmouseenter = () => { b.style.background = "rgba(60, 60, 60, 0.95)"; };
    b.onmouseleave = () => { b.style.background = "rgba(33, 33, 33, 0.85)"; };
    b.onclick = () => {
        void setEnabled(!enabled, lastFetcher);
    };
    document.body.appendChild(b);
    overlayButton = b;
    refreshOverlay();
}

function refreshOverlay(): void {
    if (overlayButton === null)
        return;
    overlayButton.textContent = enabled ? "♪" : "♪̸";
    overlayButton.style.color = enabled ? "#9cf" : "rgba(255,255,255,0.55)";
}

export function onEnabledChange(listener: (value: boolean) => void): () => void {
    enabledListeners.add(listener);
    return () => { enabledListeners.delete(listener); };
}

export function hideOverlay(): void {
    if (overlayButton !== null) {
        overlayButton.remove();
        overlayButton = null;
    }
}

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

// Blob URL cache keyed by FILENAME (not map id) so maps sharing a track (e.g.
// prontera + prt_in both play 08.mp3) hit the same URL — the audio element's
// `src === url` check then keeps playback running across the map transition
// instead of restarting. LRU-capped; never revokes the URL the audio element
// is currently using (would stop playback mid-track).
const BLOB_URL_CACHE_CAP = 16;
const blobUrlByFile = new Map<string, string>(); // insertion order = LRU order

function touchBlobUrlLru(file: string): void {
    const v = blobUrlByFile.get(file)!;
    blobUrlByFile.delete(file);
    blobUrlByFile.set(file, v);
}

function evictIfNeeded(): void {
    while (blobUrlByFile.size > BLOB_URL_CACHE_CAP) {
        const oldestKey = blobUrlByFile.keys().next().value as string | undefined;
        if (oldestKey === undefined)
            return;
        const url = blobUrlByFile.get(oldestKey)!;
        blobUrlByFile.delete(oldestKey);
        if (audio === null || audio.src !== url)
            URL.revokeObjectURL(url);
    }
}

async function blobUrlForMap(dataFetcher: DataFetcher, mapId: string): Promise<string | null> {
    if (pathBase === null)
        return null;
    const idx = await loadIndex(dataFetcher);
    if (idx === null)
        return null;
    const file = idx.get(mapId);
    if (file === undefined)
        return null;
    const cached = blobUrlByFile.get(file);
    if (cached !== undefined) {
        touchBlobUrlLru(file);
        return cached;
    }
    try {
        const data = await dataFetcher.fetchData(`${pathBase}/bgm/${file}`, { allow404: true });
        const blob = new Blob([data.createTypedArray(Uint8Array)], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        blobUrlByFile.set(file, url);
        evictIfNeeded();
        return url;
    } catch {
        return null;
    }
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
    ensureOverlay();
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
    refreshOverlay();
    for (const listener of enabledListeners)
        listener(value);
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
    hideOverlay();
    stop();
}

async function applyCurrent(dataFetcher: DataFetcher, generation: number): Promise<void> {
    if (currentMapId === null)
        return;
    const mapId = currentMapId;
    const url = await blobUrlForMap(dataFetcher, mapId);
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
