
// Era-aware destination resolution for warps. Maps can exist as `<base>@<era>`
// variants (e.g. `geffen@classic`, `geffen@renewal`); the bare id is the
// primary-era alias.

import { DataFetcher, NamedArrayBufferSlice } from "../DataFetcher.js";
import { maps } from "./maps.js";
import { Era, parseEra, PRIMARY_ERA } from "./mapcategory.js";

const eraAwareBases: Set<string> = new Set();
const eraQualifiedIds: Set<string> = new Set();
for (const m of maps) {
    if (m.era !== undefined) {
        eraAwareBases.add(parseEra(m.id).base);
        eraQualifiedIds.add(m.id);
    }
}

export function hasEraVariants(baseId: string): boolean {
    return eraAwareBases.has(baseId);
}

export function resolveWarpDest(rawDest: string, destEra: Era | undefined, sourceMapEra: Era): string {
    const parsed = parseEra(rawDest);
    if (parsed.era !== null)
        return rawDest;
    if (!eraAwareBases.has(parsed.base))
        return rawDest;
    // Fall through to the bare id when the requested era variant isn't registered.
    // The bare id IS that era's alias, so rewriting would 404.
    const qualified = `${parsed.base}@${destEra ?? sourceMapEra}`;
    return eraQualifiedIds.has(qualified) ? qualified : rawDest;
}

export function eraSharedKey(id: string): string {
    return parseEra(id).base;
}

export function eraSuffix(id: string): string {
    const e = parseEra(id).era;
    return e === null ? "" : `@${e}`;
}

export function eraOf(id: string): Era {
    return parseEra(id).era ?? PRIMARY_ERA;
}

// Tries the era-qualified asset first, falls back to the bare path on 404.
// Era variants that don't ship distinct geometry share the bare files.
export async function fetchEraOrBare(dataFetcher: DataFetcher, baseUrl: string, id: string, ext: string): Promise<NamedArrayBufferSlice> {
    const base = parseEra(id).base;
    const era = eraSuffix(id);
    if (era !== "") {
        const eraTry = await dataFetcher.fetchData(`${baseUrl}/${base}${era}${ext}`, { allow404: true });
        // allow404 resolves as a zero-byte slice rather than null.
        if (eraTry.byteLength > 0)
            return eraTry;
    }
    return dataFetcher.fetchData(`${baseUrl}/${base}${ext}`);
}
