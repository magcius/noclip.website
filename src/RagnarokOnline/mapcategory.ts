
// Classifies a map by its id. Consumed by the scene list (grouping), the sky
// renderer (dome enable + default sky tint), and the fog path (dungeons only).
// The category for each known map is baked into the manifest by regen-maps.ts;
// the runtime is just a lookup. Ids outside the manifest fall back to "other".

import { maps } from "./maps.js";

export type MapCategory = "city" | "field" | "dungeon" | "indoor" | "castle" | "instance" | "other";

// Maps with both vintages (Geffen, Payon, Izlude) ship as `<base>@<era>` scenes;
// the bare id resolves to PRIMARY_ERA so existing URLs keep working.
export type Era = "classic" | "renewal";

export const PRIMARY_ERA: Era = "renewal";

// `geffen@classic` -> {base:"geffen", era:"classic"}; `geffen` -> {base, era:null}.
// Instance maps `1@gef`/`2@nyd` have `@` early; only trailing `@<era>` matches.
export function parseEra(id: string): { base: string, era: Era | null } {
    const at = id.lastIndexOf("@");
    if (at <= 0)
        return { base: id, era: null };
    const tail = id.substring(at + 1);
    if (tail === "classic" || tail === "renewal")
        return { base: id.substring(0, at), era: tail as Era };
    return { base: id, era: null };
}

export function eraOfScene(id: string): Era {
    return parseEra(id).era ?? PRIMARY_ERA;
}

const CATEGORY_BY_ID: Map<string, MapCategory> = new Map(maps.map((m) => [m.id, m.category]));

export function mapCategory(id: string): MapCategory {
    return CATEGORY_BY_ID.get(id) ?? "other";
}

// RO's per-map fog reads as atmosphere inside dungeons but as a flat haze over
// open towns and fields, so only honour it for dungeon-type maps.
export function mapWantsFog(id: string): boolean {
    return mapCategory(id) === "dungeon";
}

export type WeatherKind = "snow";

// Only the OUTDOOR Lutie maps snow; xmas_in and the toy-factory dungeons don't.
const WEATHER_MAPS: Record<string, WeatherKind> = {
    "xmas": "snow",
    "xmas_fild01": "snow",
};

// Era-shared, so strip the era suffix before lookup.
export function mapWeather(id: string): WeatherKind | null {
    return WEATHER_MAPS[parseEra(id).base] ?? null;
}
