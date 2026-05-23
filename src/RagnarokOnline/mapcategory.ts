
// Classifies a map by its id, using RO's strict naming conventions plus a small
// curated town list (towns are bare-named, e.g. "geffen", so a prefix rule can't
// catch them). Used to drive fog (only dungeons read well under the even-tint
// fog; open towns/fields just look hazed) and available for grouping the scene
// list later.

export type MapCategory = "city" | "field" | "dungeon" | "indoor" | "castle" | "instance" | "other";

// Historical "version" of a map. RO has two main vintages: pre-renewal (2002–
// 2010 art and content) and renewal (2010+). A few towns got rebuilt in place
// at the same engine id (Geffen, Payon, Izlude); for those we ship both eras
// side-by-side under a `<base>@<era>` scene id (e.g. `geffen@classic`,
// `geffen@renewal`). The bare id (`geffen`) is a primary alias resolving to
// PRIMARY_ERA, so existing URLs and inter-map warp scripts keep working.
export type Era = "classic" | "renewal";

// The era served when a bare id is encountered. Renewal because our default
// asset extraction is from a modern client and the Hercules union prefers
// renewal scripts; classic is the explicit opt-in.
export const PRIMARY_ERA: Era = "renewal";

// Parses `geffen@classic` -> {base:"geffen", era:"classic"}, `geffen` ->
// {base:"geffen", era:null}. The `@` delimiter is unambiguous because RO's
// instance maps (`1@gef`, `2@nyd`) put `@` only as a leading position char.
export function parseEra(id: string): { base: string, era: Era | null } {
    const at = id.lastIndexOf("@");
    // Instance maps like `1@gef` have `@` early; only treat trailing `@<era>`
    // as our era suffix (era is always a known string).
    if (at <= 0)
        return { base: id, era: null };
    const tail = id.substring(at + 1);
    if (tail === "classic" || tail === "renewal")
        return { base: id.substring(0, at), era: tail as Era };
    return { base: id, era: null };
}

// Era of a scene given its id. Era-suffixed ids return the suffix's era; bare
// ids return PRIMARY_ERA (whether they have era variants or not — a town
// without era variants effectively IS its primary era).
export function eraOfScene(id: string): Era {
    return parseEra(id).era ?? PRIMARY_ERA;
}

// Bare-named towns (and a few town-equivalent hubs) that no prefix rule catches.
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
    // Strip any trailing era suffix before classifying — era variants of the
    // same logical map share the category of their base id.
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

// Whether the even-tint fog should apply on this map. RO's per-map fog reads as
// atmosphere inside dungeons but as a flat, pointless haze over open towns and
// fields, so we only honour it for dungeon-type maps. (Atmospheric towns like
// Niflheim could be whitelisted here if desired.)
export function mapWantsFog(id: string): boolean {
    return mapCategory(id) === "dungeon";
}

// Per-map weather. RO drives weather from a script table (CWeather::AddScript /
// ScriptProcess) keyed by map name; for the viewer we keep a small static table
// here so other weather (rain, falling petals, ...) can be slotted in later.
// "snow" is the camera-relative falling-flake field (see weather.ts).
//
// Only the OUTDOOR Lutie maps snow: xmas (the town) and xmas_fild01 (the field).
// The interior xmas_in and the toy-factory dungeons xmas_dun01/xmas_dun02 are
// indoors and do NOT snow.
export type WeatherKind = "snow";

const WEATHER_MAPS: Record<string, WeatherKind> = {
    "xmas": "snow",
    "xmas_fild01": "snow",
};

// The weather kind for a map, or null if the map has none. Era-shared (xmas
// classic and xmas renewal both snow if either does), so strip the era suffix
// before the table lookup.
export function mapWeather(id: string): WeatherKind | null {
    return WEATHER_MAPS[parseEra(id).base] ?? null;
}
