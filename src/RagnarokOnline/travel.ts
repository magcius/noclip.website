
// Warp click-to-travel. triggerTravel switches scenes by setting the location
// hash (`#<group>/<mapId>`), which the app's hashchange handler resolves to a
// scene load. A one-shot "pending arrival" carries the destination's landing
// cell across the load (a fresh scene has no channel to receive it otherwise).

// Literal to avoid an import cycle (scenes -> render -> travel -> scenes).
const SCENE_GROUP_ID = "RagnarokOnline";

interface PendingArrival {
    mapId: string;
    cellX: number;
    cellY: number;
}

let pendingArrival: PendingArrival | null = null;

// Drop the pending arrival if the user navigates somewhere other than the
// pending target, so it doesn't pop on a later unrelated visit to that map.
let hashListenerInstalled = false;
function ensureHashListener(): void {
    if (hashListenerInstalled || typeof window === "undefined")
        return;
    hashListenerInstalled = true;
    window.addEventListener("hashchange", () => {
        if (pendingArrival === null)
            return;
        const targetHash = `#${SCENE_GROUP_ID}/${pendingArrival.mapId}`;
        if (window.location.hash !== targetHash)
            pendingArrival = null;
    });
}

export function setPendingArrival(mapId: string, cellX: number, cellY: number): void {
    pendingArrival = { mapId, cellX, cellY };
    ensureHashListener();
}

// Consumes and clears the pending arrival if it targets `mapId`, else null.
export function takePendingArrival(mapId: string): { cellX: number, cellY: number } | null {
    if (pendingArrival === null || pendingArrival.mapId !== mapId)
        return null;
    const { cellX, cellY } = pendingArrival;
    pendingArrival = null;
    return { cellX, cellY };
}

export function triggerTravel(mapId: string, arrivalCellX?: number, arrivalCellY?: number): void {
    if (arrivalCellX !== undefined && arrivalCellY !== undefined)
        setPendingArrival(mapId, arrivalCellX, arrivalCellY);

    const hash = `#${SCENE_GROUP_ID}/${mapId}`;
    if (window.location.hash === hash) {
        // Same map: hashchange won't fire. Drop the arrival rather than letting
        // it mis-apply to a later load.
        if (pendingArrival !== null && pendingArrival.mapId === mapId)
            pendingArrival = null;
        return;
    }
    window.location.hash = hash;
}
