import { maps } from "./maps.js";

export type Era = "classic" | "renewal";

const URL_KEY = "era";
const CLASSIC_SUFFIX = "@classic";
const CLASSIC_GEOMETRY_BASES = new Set(
    maps.filter((m) => m.era === "classic").map((m) => stripClassicSuffix(m.id)),
);

function stripClassicSuffix(id: string): string {
    return id.endsWith(CLASSIC_SUFFIX) ? id.slice(0, -CLASSIC_SUFFIX.length) : id;
}

function readFromUrl(): Era {
    if (typeof window === "undefined") return "renewal";
    return new URLSearchParams(window.location.search).get(URL_KEY) === "classic" ? "classic" : "renewal";
}

let era: Era = readFromUrl();

export function currentEra(): Era {
    return era;
}

export function eraForScene(sceneId: string): Era {
    return sceneId.endsWith(CLASSIC_SUFFIX) ? "classic" : currentEra();
}

export function baseMapId(sceneId: string): string {
    return stripClassicSuffix(sceneId);
}

export function resolveWarpTargetEra(destEra: Era | undefined, sourceSceneId: string): Era {
    return destEra ?? eraForScene(sourceSceneId);
}

export function resolveWarpDestForEra(rawDest: string, targetEra: Era): string {
    const dest = baseMapId(rawDest);
    return targetEra === "classic" && CLASSIC_GEOMETRY_BASES.has(dest) ? `${dest}@classic` : dest;
}

export function setEra(next: Era): void {
    if (next === era) return;
    era = next;
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);
    if (next === "renewal") u.searchParams.delete(URL_KEY);
    else u.searchParams.set(URL_KEY, next);
    window.history.replaceState(null, "", u.toString());
}
