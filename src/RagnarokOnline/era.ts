
// Era-aware destination resolution for warps and any other cross-map
// references. Multiple historical "versions" of the same Ragnarok map are
// served under `<base>@<era>` scene ids (e.g. `geffen@classic`,
// `geffen@renewal`); the bare id (`geffen`) is a primary-era alias. When a
// pre-renewal city's warp script targets `payon`, we want it to land on
// `payon@classic` if classic Payon exists — and the renewal-era script's
// same warp should land on `payon@renewal`. This module owns that mapping.

import { DataFetcher, NamedArrayBufferSlice } from "../DataFetcher.js";
import { maps } from "./maps.js";
import { Era, parseEra, PRIMARY_ERA } from "./mapcategory.js";

// Computed once at module load. Two indexes built from maps.ts:
//   eraAwareBases  — base ids that have ANY era-tagged variant entry. Drives
//                    the "this destination might need era qualification" gate.
//   eraQualifiedIds — exact `<base>@<era>` ids actually present as entries.
//                    Drives the "resolved era variant exists; rewrite to it"
//                    decision. When a base has e.g. only `geffen@classic`
//                    registered (no `geffen@renewal`), a warp targeting it
//                    from a renewal-era source should fall back to bare
//                    `geffen` (which IS the renewal alias) rather than
//                    rewrite to a non-existent `geffen@renewal` URL.
const eraAwareBases: Set<string> = new Set();
const eraQualifiedIds: Set<string> = new Set();
for (const m of maps) {
    if (m.era !== undefined) {
        eraAwareBases.add(parseEra(m.id).base);
        eraQualifiedIds.add(m.id);
    }
}

// True if `baseId` (with no era suffix) has any era-tagged variant in maps.ts.
// Cheap O(1) lookup against the precomputed set.
export function hasEraVariants(baseId: string): boolean {
    return eraAwareBases.has(baseId);
}

// Resolves a warp's raw destination id to the era-qualified scene id the user
// should travel to.
//
//   rawDest        — destination map id as it appears in the Hercules script
//                    (almost always a bare id like `payon`; occasionally a
//                    pre-resolved `payon@classic` if the extractor tagged it).
//   destEra        — explicit era hint on the warp entry (set by the extractor
//                    when the warp's source script was era-specific). Omitted
//                    for shared-script warps.
//   sourceMapEra   — era of the scene we're currently in (eraOfScene(thisId)).
//                    Used as the fallback era when destEra is absent.
//
// Resolution rules:
//   1) Already-qualified rawDest (`payon@classic`): pass through.
//   2) Bare rawDest with no era-aware variants in the registry: pass through
//      (no `@` suffix needed).
//   3) Bare rawDest with era variants: append explicit destEra, else fall
//      back to sourceMapEra. The fallback covers shared-script warps where
//      the natural intent is "the same era as where the player came from."
//   4) But: only rewrite if the chosen `<base>@<era>` is actually a
//      registered entry in maps.ts. If it isn't (e.g. only `geffen@classic`
//      exists, no `geffen@renewal`), the bare id IS the alias for that era,
//      so passing through avoids 404ing on a phantom URL.
export function resolveWarpDest(rawDest: string, destEra: Era | undefined, sourceMapEra: Era): string {
    const parsed = parseEra(rawDest);
    if (parsed.era !== null)
        return rawDest;
    if (!eraAwareBases.has(parsed.base))
        return rawDest;
    const qualified = `${parsed.base}@${destEra ?? sourceMapEra}`;
    return eraQualifiedIds.has(qualified) ? qualified : rawDest;
}

// Strips any `@<era>` suffix from a scene id, returning the bare base. Used
// when fetching era-shared per-map data (BGM track, fog table, particle
// emitters): Gravity authored these against the engine id with no concept of
// our era split, so a classic+renewal pair shares one underlying resource.
// For ids without a known era suffix (instance maps `1@gef`, bare ids),
// returns the id unchanged.
export function eraSharedKey(id: string): string {
    return parseEra(id).base;
}

// The era SUFFIX of a scene id (`@classic`, `@renewal`, or "" for bare).
// Used by the scene loader to rewrite the GND filename embedded in the RSW
// (which always names the bare GND, e.g. `geffen.gnd`) up to the era-aware
// asset on disk (`geffen@classic.gnd`).
export function eraSuffix(id: string): string {
    const e = parseEra(id).era;
    return e === null ? "" : `@${e}`;
}

// Convenience: the era of a scene id, defaulting to PRIMARY_ERA for bare ids.
// Re-exported here so callers needing only era utilities don't pull mapcategory.
export function eraOf(id: string): Era {
    return parseEra(id).era ?? PRIMARY_ERA;
}

// Fetches an era-specific asset (`<base><eraSuffix><ext>`) with a fall-through
// to the bare path (`<base><ext>`) when the era-specific URL 404s. Used for
// RSW/GND/GAT so divergent maps without separately-extracted vintage assets
// share the bare geometry — they only need a per-era ENTITY manifest (NPCs +
// warps), not duplicate map geometry. Era-less scene ids (no `@<era>`) skip
// the first try and fetch the bare URL directly.
//
// `baseUrl` is the directory URL (e.g. `RagnarokOnline/maps`). `id` is the
// scene id, possibly era-qualified. `ext` includes the leading dot (`.rsw`).
//
// Throws on bare-url failure (not on era-url 404 — that's the fallback case).
export async function fetchEraOrBare(dataFetcher: DataFetcher, baseUrl: string, id: string, ext: string): Promise<NamedArrayBufferSlice> {
    const base = parseEra(id).base;
    const era = eraSuffix(id);
    if (era !== "") {
        const eraTry = await dataFetcher.fetchData(`${baseUrl}/${base}${era}${ext}`, { allow404: true });
        // DataFetcher resolves allow404 misses as a named zero-byte slice, not
        // null. Treat that sentinel as a miss so era variants can share the
        // bare geometry asset when only their entity manifests differ.
        if (eraTry.byteLength > 0)
            return eraTry;
    }
    return dataFetcher.fetchData(`${baseUrl}/${base}${ext}`);
}
