
// Regenerates src/RagnarokOnline/maps.ts from the staged map tree and the iRO
// English mapnametable (with kRO Korean as fallback). Run after staging iRO
// maps so the scene list picks up the new ids and English display names.
//
//   npx tsx src/RagnarokOnline/tools/regen-maps.ts
//
// Inputs:
//   data/RagnarokOnline/maps/*.rsw                              (scanned for the id list)
//   data/RagnarokOnline_raw/iro_tables/mapnametable.txt         (English names; preferred — iRO side dump, not from the GRF)
//   data/RagnarokOnline_raw/assets/data/misc/mapnametable.txt   (Korean kRO; fallback — from the GRF)
// Output:
//   src/RagnarokOnline/maps.ts (committed; the scene registry maps over it)

import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import * as path from "path";
import { MapCategory, parseEra } from "../mapcategory.js";

// Bare-named towns (and town-equivalent hubs) that no prefix rule catches.
const TOWNS = new Set([
    "prontera", "geffen", "payon", "morocc", "alberta", "izlude", "aldebaran", "comodo",
    "umbala", "niflheim", "amatsu", "gonryun", "ayothaya", "louyang", "jawaii", "einbroch",
    "einbech", "lighthalzen", "hugel", "rachel", "veins", "yuno", "xmas", "moscovia",
    "brasilis", "dewata", "malangdo", "malaya", "eclage", "mora", "manuk", "splendide",
    "dicastes01", "mid_camp", "prt_fild08", "new_1-1", "new_zone01", "prt_monk",
]);

// Named dungeons (and dungeon-like areas) whose ids don't contain `_dun`. Ids
// matching `/_dun/` are handled by the generic check in `classifyMap` below.
const NAMED_DUNGEON_RE = /^(gl_|abyss|abbey|juperos|jupe_|gefenia|cave\b|izlu2dun|anthell|in_sphinx|in_orcs|in_rogue|orcsdun|c_tower|tha_t|thana|treasure|kh_|ra_san|thor_v|moc_pryd|prt_sew|prt_maze|spl_in|ecl_tdun|1@|2@)/;

function classifyMap(id: string): MapCategory {
    id = parseEra(id).base;
    if (/_cas\d|g_cas/.test(id) || id.startsWith("nguild_") || /_gld\b|gld_/.test(id)) return "castle";
    if (/^\d+@/.test(id)) return "dungeon"; // instance dungeons read as dungeons for fog
    if (/^que_|^job_|^force_|^pvp_|^gvg|^arena|^ordeal|^poring_w|^guild_vs|^bat_|^job3|^turbo_|^sec_|^prt_are|auction/.test(id)) return "instance";
    if (/_fild\d|_field/.test(id)) return "field";
    if (/_dun/.test(id) || NAMED_DUNGEON_RE.test(id)) return "dungeon";
    if (/_in\d|^in_|_in$|_room|_indoor/.test(id)) return "indoor";
    if (TOWNS.has(id) || (/^(prt|gef|pay|moc|alde|cmd|um|nif|ama|gon|ayo|lou|ein|lhz|yuno|ra|ve|bra|dew|mal|izlude|glast|hu|mosk|dic|ecl|man|teak|tur|alb|pay)_/.test(id) && !/_dun|_fild|_in/.test(id))) return "city";
    return "other";
}

const MAPS_DIR = path.resolve("data/RagnarokOnline_raw/assets/data/maps");
const ENTITIES_DIR = path.resolve("data/RagnarokOnline/entities");
const IRO_NAMETABLE = path.resolve("data/RagnarokOnline_raw/iro_tables/mapnametable.txt");
const KRO_NAMETABLE = path.resolve("data/RagnarokOnline_raw/assets/data/misc/mapnametable.txt");
const OUT = path.resolve("src/RagnarokOnline/maps.ts");

// mapnametable.txt: each line `<map_id>.rsw#<display name>#`, CP949 encoded on
// kRO and Latin-1 on iRO (English names — Latin-1 is ASCII-safe). Decode either
// way: UTF-8 first (works on ASCII/Latin-1), else CP949 fallback.
function parseMapNameTable(file: string): Map<string, string> {
    const out = new Map<string, string>();
    if (!existsSync(file))
        return out;
    let text: string;
    try {
        text = readFileSync(file, "utf8");
        // If it has replacement chars, fall back to CP949.
        if (text.includes("�"))
            text = new TextDecoder("euc-kr").decode(readFileSync(file));
    } catch {
        text = new TextDecoder("euc-kr").decode(readFileSync(file));
    }
    for (const raw of text.split(/\r?\n/)) {
        const s = raw.trim();
        if (s.length === 0 || s.startsWith("//"))
            continue;
        // Format: <map>.rsw#<name>#
        const m = /^([A-Za-z0-9_@\-]+)\.rsw#([^#]*)#?/i.exec(s);
        if (m === null)
            continue;
        const id = m[1].toLowerCase();
        const name = m[2].trim();
        if (name.length > 0)
            out.set(id, name);
    }
    return out;
}

function main(): void {
    if (!existsSync(MAPS_DIR)) {
        console.error(`no maps dir: ${MAPS_DIR}`);
        process.exit(1);
    }

    const iro = parseMapNameTable(IRO_NAMETABLE);
    const kro = parseMapNameTable(KRO_NAMETABLE);
    console.log(`iRO names: ${iro.size}  kRO names: ${kro.size}`);

    // Bare ids come from the staged .rsw set. Exclude era-suffixed asset
    // files (`<id>@classic.rsw`) — they're inferred from the entity manifest
    // pass below so we don't double-count Gravity-rebuilt maps. Note the
    // `@` test is anchored to "@<era>" at the tail; engine instance maps
    // (`1@4cdn`, `2@nyd`) use `@` as a LEADING char and must stay in the
    // bare list.
    //
    // KEEP IN SYNC with the Era union in src/RagnarokOnline/mapcategory.ts.
    // If a third era token is ever added there, extend ERAS below (and the
    // `@classic.json` matcher further down) so the new variant is recognised
    // and excluded from the bare-id sweep.
    const ERAS = ["classic", "renewal"] as const;
    const ERA_SUFFIX_RE = new RegExp(`@(${ERAS.join("|")})\\.rsw$`, "i");
    const bareIds = readdirSync(MAPS_DIR)
        .filter((f) => f.toLowerCase().endsWith(".rsw"))
        .filter((f) => !ERA_SUFFIX_RE.test(f))
        .map((f) => f.slice(0, -".rsw".length).toLowerCase());
    const bareSet = new Set(bareIds);

    // Divergent maps come from the entity manifests: extract-entities.ts emits
    // `<id>@classic.json` only when classic and renewal entries actually
    // differ. We add a classic variant entry to the scene list for each such
    // map whose bare id is also staged (without bare assets the variant has
    // nothing to fall back to in the loader). Renewal is implicit in the bare
    // entry, so no separate `@renewal` UI entry is emitted.
    let classicIds: string[] = [];
    if (existsSync(ENTITIES_DIR)) {
        classicIds = readdirSync(ENTITIES_DIR)
            .filter((f) => f.toLowerCase().endsWith("@classic.json"))
            .map((f) => f.slice(0, -"@classic.json".length).toLowerCase())
            .filter((id) => bareSet.has(id));
    }
    const classicSet = new Set(classicIds);

    let namedEn = 0, namedKr = 0, unnamed = 0;
    const lookupName = (id: string): { display?: string, name: string } => {
        const en = iro.get(id);
        const kr = kro.get(id);
        let display: string | undefined;
        if (en !== undefined) { display = en; namedEn++; }
        else if (kr !== undefined) { display = kr; namedKr++; }
        else unnamed++;
        const name = display !== undefined ? `${id} — ${display}` : id;
        return { display, name };
    };

    type Entry = { id: string, name: string, category: MapCategory, era?: "classic" };
    const entries: Entry[] = [];
    for (const id of bareIds.sort((a, b) => a.localeCompare(b))) {
        const lookup = lookupName(id);
        const category = classifyMap(id);
        entries.push({ id, name: lookup.name, category });
        // Classic variant: same display name with a " (Classic)" suffix so the
        // user can tell them apart at a glance. The bare entry IS the renewal
        // alias (no separate @renewal variant — see the comment above).
        if (classicSet.has(id)) {
            const classicName = lookup.display !== undefined
                ? `${id} — ${lookup.display} (Classic)`
                : `${id} (classic)`;
            entries.push({ id: `${id}@classic`, name: classicName, category, era: "classic" });
        }
    }

    const body = entries
        .map((e) => {
            const fields = [
                `id: ${JSON.stringify(e.id)}`,
                `name: ${JSON.stringify(e.name)}`,
                `category: ${JSON.stringify(e.category)}`,
            ];
            if (e.era !== undefined)
                fields.push(`era: ${JSON.stringify(e.era)}`);
            return `    { ${fields.join(", ")} },`;
        })
        .join("\n");

    const contents = `
// Generated map manifest for the Ragnarok Online scene registry. Do not edit
// by hand: regenerate by running
//   npx tsx src/RagnarokOnline/tools/regen-maps.ts
//
// ${entries.length} entries (${bareIds.length} bare maps + ${classicIds.length} era-aware
// classic variants), drawn from staged .rsw files and the era-aware entity
// manifests written by extract-entities.ts. ${namedEn} with an iRO English
// name, ${namedKr} kRO Korean fallback, ${unnamed} unnamed.
//
// Era-aware entries (those with an \`era\` field) coexist with their bare
// alias — the bare id is the renewal-era alias (see PRIMARY_ERA in
// mapcategory.ts), so both \`geffen\` and \`geffen@classic\` are valid scene
// ids. The bare alias stays in the list for backward compatibility with
// shared URLs and Hercules warp scripts; the explicit \`@classic\` variant
// gives the non-primary era its own scene-list entry. The set of base ids
// with era variants is computed at module load time (see era.ts) and
// consumed by resolveWarpDest to route cross-map warps to the right version
// of the destination.

import type { MapCategory } from "./mapcategory.js";

export interface RagnarokMapEntry {
    id: string;
    name: string;
    // Pre-computed at regen time so the runtime doesn't re-parse ids. See
    // classifyMap in tools/regen-maps.ts for the classification rules.
    category: MapCategory;
    // Set on non-primary-era variants (e.g. \`{ id: "geffen@classic", era: "classic" }\`).
    // Bare alias entries leave this unset — they resolve to PRIMARY_ERA at
    // scene-load time.
    era?: "classic" | "renewal";
}

export const maps: RagnarokMapEntry[] = [
${body}
];
`;
    writeFileSync(OUT, contents);
    console.log(`wrote ${entries.length} entries (${bareIds.length} bare + ${classicIds.length} classic variants) to ${OUT}`);
    console.log(`  ${namedEn} English, ${namedKr} Korean fallback, ${unnamed} unnamed`);
}

main();
