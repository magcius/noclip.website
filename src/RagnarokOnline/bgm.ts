
// Per-map background music for the Ragnarok Online scenes.
//
// Each map's RSW has an associated BGM mp3 (table extracted from iRO's
// data/mp3nametable.txt; index at data/RagnarokOnline/bgm/index.json mapping
// map-id -> "<num>.mp3"). On scene load the renderer calls setMap(id) on the
// module-level player; if BGM is enabled, the player fetches and loops the
// track. Toggling off pauses; toggling on plays the current map's track.
//
// Default: OFF. The viewer is silent unless the user enables BGM. The track
// streams from /data/RagnarokOnline/bgm/<num>.mp3 — the same URL noclip's
// DataFetcher uses for everything else, so it goes through the same hosting.
//
// Implementation: a single shared HTMLAudioElement is reused across map
// changes (we just swap the src and call play()). The index.json is lazy-
// loaded on the first setMap call and cached for the rest of the session.

import { DataFetcher } from "../DataFetcher.js";

let indexPromise: Promise<Map<string, string> | null> | null = null;
let audio: HTMLAudioElement | null = null;
let enabled = false;
let currentMapId: string | null = null;
let currentVolume = 0.5;
let pathBase: string | null = null;
let lastFetcher: DataFetcher | null = null;
let sceneGeneration = 0;

// In-viewport toggle button overlay (in addition to the Render Hacks
// checkbox). Created lazily once a Ragnarok scene loads so it only appears
// for RO maps. Click toggles BGM on/off and counts as the user gesture
// browsers require to start playback. Listeners that consume `setEnabled`
// should not trigger this button programmatically — only user clicks here
// satisfy the autoplay gate.
let overlayButton: HTMLButtonElement | null = null;
const enabledListeners = new Set<(value: boolean) => void>();

function ensureOverlay(): void {
    if (overlayButton !== null || typeof document === "undefined")
        return;
    const b = document.createElement("button");
    b.type = "button";
    b.title = "Toggle BGM";
    // Match noclip's bottom-bar SingleIconButton look (~40px square, rounded,
    // dark semi-transparent, white icon), positioned to the LEFT of the
    // share+fullscreen cluster at the bottom-right. The pair takes roughly
    // 100–120 px combined; 140 px right offset clears them with some breathing
    // room across common viewport widths.
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

// Render Hacks checkbox subscribes here so flipping the overlay button keeps
// the menu checkbox in sync (and vice versa). Listener fires synchronously on
// every enabled-state change.
export function onEnabledChange(listener: (value: boolean) => void): () => void {
    enabledListeners.add(listener);
    return () => { enabledListeners.delete(listener); };
}

// Remove the overlay button (call when leaving Ragnarok scenes if desired —
// noclip's main app does not, currently, signal scene-group teardown).
export function hideOverlay(): void {
    if (overlayButton !== null) {
        overlayButton.remove();
        overlayButton = null;
    }
}

// Lazy-loads the map-id -> mp3-filename index. Returns null if it fetches fails
// (e.g., index.json not staged); the player then silently does nothing.
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

// Resolves the BGM mp3 for a map id and returns a blob URL the Audio element
// can load. Returns null if the map has no entry or the fetch fails. We go
// through the DataFetcher (rather than handing the URL straight to <audio
// src=>) so the asset routes the same way every other RO download does — the
// dev server serves data/ at /data/, deployments may rewrite the prefix.
//
// Cache the resolved object URL by FILENAME (not map id) so two maps sharing
// the same track (prontera + prt_in both play 08.mp3) hit the same blob URL.
// The Audio element's `src === url` short-circuit then keeps playback running
// across the map transition instead of restarting the same track.
//
// LRU-capped: each entry is a blob URL backed by an in-memory Blob, so an
// unbounded cache would leak roughly a track-sized chunk per unique track
// played in a session. The cap evicts the least-recently-used entry and
// revokes its URL — but never the URL currently loaded into the audio
// element (revoking that under playback would stop the music mid-track).
// Trade-off: a slightly larger LRU keeps cross-scene continuity for towns
// that revisit their entrance track within a few hops; 16 covers comfortably.
const BLOB_URL_CACHE_CAP = 16;
const blobUrlByFile = new Map<string, string>(); // insertion order = LRU order

function touchBlobUrlLru(file: string): void {
    // Move-to-end: re-inserting an existing key updates its position in the
    // Map's insertion order, which we treat as the LRU ordering.
    const v = blobUrlByFile.get(file)!;
    blobUrlByFile.delete(file);
    blobUrlByFile.set(file, v);
}

function evictIfNeeded(): void {
    while (blobUrlByFile.size > BLOB_URL_CACHE_CAP) {
        // Iterator order is insertion order: the first key is the LRU.
        const oldestKey = blobUrlByFile.keys().next().value as string | undefined;
        if (oldestKey === undefined)
            return;
        const url = blobUrlByFile.get(oldestKey)!;
        blobUrlByFile.delete(oldestKey);
        // Never revoke the URL the audio element is currently using — that
        // would kill playback. The cached entry is just dropped; if the same
        // track is requested again, we re-fetch and re-create a blob URL.
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

// Set the asset base prefix once (matches what other RO loaders use, e.g.,
// `RagnarokOnline`). DataFetcher resolves URLs relative to its data root.
export function setBgmPathBase(base: string): void {
    pathBase = base;
}

// Called on scene load. If enabled, swaps to the new map's track (or pauses
// when the map has no BGM entry). A no-op when this is the same map id we
// already have queued.
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

// Called by either the Render Hacks toggle or the overlay button. Turning on
// plays the current map's track (if any); turning off pauses.
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

// Volume control (0..1). Persists across map changes.
export function setVolume(v: number): void {
    currentVolume = Math.max(0, Math.min(1, v));
    if (audio !== null)
        audio.volume = currentVolume;
}

export function getVolume(): number {
    return currentVolume;
}

// Stops playback and clears the source. Call on scene destroy if the renderer
// wants to free the audio element; safe to call multiple times.
export function stop(): void {
    if (audio === null)
        return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
}

// Tears down the RO-scoped UI/audio state when a Ragnarok renderer is destroyed,
// without changing the user's enabled preference for the next RO scene.
export function teardownScene(): void {
    sceneGeneration++;
    currentMapId = null;
    lastFetcher = null;
    hideOverlay();
    stop();
}

// Internal: resolve the current map's URL and (re)start playback.
async function applyCurrent(dataFetcher: DataFetcher, generation: number): Promise<void> {
    if (currentMapId === null)
        return;
    const mapId = currentMapId;
    const url = await blobUrlForMap(dataFetcher, mapId);
    if (generation !== sceneGeneration || mapId !== currentMapId)
        return;
    // Race guard: the user can flip BGM OFF between the click that started
    // this fetch and its resolution. If we're no longer enabled, do nothing —
    // playing now would put music behind the checkbox in the OFF state.
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
        // Browsers block autoplay without a user gesture. The toggle in Render
        // Hacks (and the floating overlay button) IS a user gesture, so user
        // interaction will succeed; the initial scene-load call may not. Either
        // way we silently no-op.
    }
}
