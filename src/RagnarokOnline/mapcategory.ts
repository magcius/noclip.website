import { maps } from "./maps.js";

export type MapCategory = "city" | "field" | "dungeon" | "indoor" | "castle" | "instance" | "other";

const CATEGORY_BY_ID: Map<string, MapCategory> = new Map(maps.map((m) => [m.id, m.category]));

export function mapCategory(id: string): MapCategory {
    return CATEGORY_BY_ID.get(id) ?? "other";
}

export function mapWantsFog(id: string): boolean {
    return mapCategory(id) === "dungeon";
}

export type WeatherKind = "snow";

const WEATHER_MAPS: Record<string, WeatherKind> = {
    "xmas": "snow",
    "xmas_fild01": "snow",
};

export function mapWeather(id: string): WeatherKind | null {
    return WEATHER_MAPS[id] ?? null;
}
