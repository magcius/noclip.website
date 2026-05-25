
// Classifies a map by its id. Consumed by the scene list (grouping), the sky
// renderer (dome enable + default sky tint), and the fog path (dungeons only).
// The category for each known map is baked into the manifest by gen-maps.ts;
// the runtime is just a lookup. Ids outside the manifest fall back to "other".

import { maps } from "./maps.js";

export type MapCategory = "city" | "field" | "dungeon" | "indoor" | "castle" | "instance" | "other";

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

export function mapWeather(id: string): WeatherKind | null {
    return WEATHER_MAPS[id] ?? null;
}
