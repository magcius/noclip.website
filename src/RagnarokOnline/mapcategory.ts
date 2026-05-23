
// Classifies a map by its id, used to drive fog (dungeons only) and grouping.

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

// Bare-named towns (and town-equivalent hubs) that no prefix rule catches.
const TOWNS = new Set([
    "prontera", "geffen", "payon", "morocc", "alberta", "izlude", "aldebaran", "comodo",
    "umbala", "niflheim", "amatsu", "gonryun", "ayothaya", "louyang", "jawaii", "einbroch",
    "einbech", "lighthalzen", "hugel", "rachel", "veins", "yuno", "xmas", "moscovia",
    "brasilis", "dewata", "malangdo", "malaya", "eclage", "mora", "manuk", "splendide",
    "dicastes01", "mid_camp", "prt_fild08", "new_1-1", "new_zone01", "prt_monk",
]);

// Named dungeons (and dungeon-like areas) without a `_dun` suffix.
const NAMED_DUNGEON_RE = /^(gl_|abyss|abbey|juperos|jupe_|gefenia|cave\b|beach_dun|izlu2dun|iz_dun|anthell|in_sphinx|in_orcs|in_rogue|orcsdun|c_tower|tha_t|thana|treasure|nyd_dun|mag_dun|kh_|lhz_dun|ra_san|ice_dun|thor_v|gld_dun|gld2_dun|moc_pryd|prt_sew|prt_maze|pay_dun|gef_dun|alde_dun|um_dun|ama_dun|gon_dun|ayo_dun|lou_dun|ein_dun|bra_dun|dew_dun|mal_dun|spl_in|dic_dun|ecl_tdun|1@|2@)/;

export function mapCategory(id: string): MapCategory {
    id = parseEra(id).base;
    if (/_cas\d|g_cas/.test(id) || id.startsWith("nguild_") || /_gld\b|gld_/.test(id)) return "castle";
    if (/^\d+@/.test(id)) return "dungeon"; // instance dungeons read as dungeons for fog
    if (/^que_|^job_|^force_|^pvp_|^gvg|^arena|^ordeal|^poring_w|^guild_vs|^bat_|^job3|^turbo_|^sec_|^prt_are|auction/.test(id)) return "instance";
    if (/_fild\d|_field/.test(id)) return "field";
    if (/_dun\d/.test(id) || NAMED_DUNGEON_RE.test(id)) return "dungeon";
    if (/_in\d|^in_|_in$|_room|_indoor/.test(id)) return "indoor";
    if (TOWNS.has(id) || (/^(prt|gef|pay|moc|alde|cmd|um|nif|ama|gon|ayo|lou|ein|lhz|yuno|ra|ve|bra|dew|mal|izlude|glast|hu|mosk|dic|ecl|man|teak|tur|alb|pay)_/.test(id) && !/_dun|_fild|_in/.test(id))) return "city";
    return "other";
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
