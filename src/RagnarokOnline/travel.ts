
// Warp click-to-travel plumbing for the Ragnarok Online scenes.
//
// Clicking a rendered warp portal loads its destination map. Two pieces live
// here, decoupled from the renderer and the scene loader:
//
//   * triggerTravel: switches the active scene to a map id using noclip's own
//     idiomatic mechanism — setting the location hash, which the app's
//     hashchange handler turns into a scene load. (We do not reach into the
//     viewer/Main internals.)
//
//   * a one-shot "pending arrival": the warp carries the arrival cell on the
//     destination map, but a fresh scene load has no channel to receive it. We
//     stash it here keyed by destination map id; the destination scene's
//     createScene consumes (and clears) it to frame the camera at the landing
//     point. A stale entry for a different map is ignored and overwritten, so a
//     normal scene-select never reads a leftover arrival.

// The scene-group id under which every RO map is registered (see scenes.ts:
// sceneGroup.id). The location hash form is `#<groupId>/<mapId>`. Kept as a
// literal here to avoid an import cycle (scenes -> render -> travel -> scenes).
const SCENE_GROUP_ID = "RagnarokOnline";

// The arrival cell handed off to the next-loaded map (GAT cells). Cleared once
// consumed so it applies to exactly one load.
interface PendingArrival {
    mapId: string;
    cellX: number;
    cellY: number;
}

let pendingArrival: PendingArrival | null = null;

// Stash-and-clear watcher: when the user navigates somewhere other than the
// pending target (e.g. picks a different map from the scene list after clicking
// a warp), drop the pending arrival so it doesn't pop applied to a later
// unrelated visit to the same map. Registered once, idempotently. The window
// guard keeps this safe for any non-browser (test) host that ever loads the
// module.
let hashListenerInstalled = false;
function ensureHashListener(): void {
    if (hashListenerInstalled || typeof window === "undefined")
        return;
    hashListenerInstalled = true;
    window.addEventListener("hashchange", () => {
        if (pendingArrival === null)
            return;
        const targetHash = `#${SCENE_GROUP_ID}/${pendingArrival.mapId}`;
        // Navigated somewhere other than our pending destination: drop it. The
        // arrival is consumed (and cleared) by the matching map's createScene,
        // so when navigation lands on the target this branch never trips.
        if (window.location.hash !== targetHash)
            pendingArrival = null;
    });
}

// Records where the camera should land on the next load of `mapId`. Overwrites
// any prior pending arrival (only the most recent warp click matters).
export function setPendingArrival(mapId: string, cellX: number, cellY: number): void {
    pendingArrival = { mapId, cellX, cellY };
    ensureHashListener();
}

// Consumes the pending arrival if it targets `mapId`, returning its cell and
// clearing it. Returns null when there's no arrival for this map (a normal
// scene-select or a mismatched leftover), so the scene frames the whole map.
export function takePendingArrival(mapId: string): { cellX: number, cellY: number } | null {
    if (pendingArrival === null || pendingArrival.mapId !== mapId)
        return null;
    const { cellX, cellY } = pendingArrival;
    pendingArrival = null;
    return { cellX, cellY };
}

// Travels to a destination map, optionally landing at an arrival cell. Switches
// the scene by setting the location hash (`#<group>/<mapId>`), which is exactly
// how the app loads a scene from a URL — the hashchange handler resolves the id
// and loads it. An id whose assets aren't staged still resolves to a registered
// SceneDesc and fails gracefully at load (a clean error, no crash). A no-op if
// already on that map.
export function triggerTravel(mapId: string, arrivalCellX?: number, arrivalCellY?: number): void {
    if (arrivalCellX !== undefined && arrivalCellY !== undefined)
        setPendingArrival(mapId, arrivalCellX, arrivalCellY);

    const hash = `#${SCENE_GROUP_ID}/${mapId}`;
    if (window.location.hash === hash) {
        // Same map: the hashchange won't fire, so nothing reloads. Drop any
        // arrival we just set rather than leaving it to mis-apply to a later
        // load of this map.
        if (pendingArrival !== null && pendingArrival.mapId === mapId)
            pendingArrival = null;
        return;
    }
    window.location.hash = hash;
}
