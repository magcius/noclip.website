
// Regenerates src/RagnarokOnline/maps.ts from the staged map tree and the iRO
// English mapnametable (with kRO Korean as fallback). Run after staging iRO
// maps so the scene list picks up the new ids and English display names.
//
//   npx tsx src/RagnarokOnline/tools/regen-maps.ts
//
// Inputs:
//   data/RagnarokOnline/maps/*.rsw                              (scanned for the id list)
//   data/RagnarokOnline_raw/iro_tables/mapnametable.txt         (English names, preferred; iRO side dump, not from the GRF)
//   data/RagnarokOnline_raw/assets/data/misc/mapnametable.txt   (Korean kRO fallback, from the GRF)
// Output:
//   src/RagnarokOnline/maps.ts (committed; the scene registry maps over it)

import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import * as path from "path";
import { MapCategory } from "../mapcategory.js";

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
    id = id.replace(/@classic$/, "");
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
const IRO_NAMETABLE = path.resolve("data/RagnarokOnline_raw/iro_tables/mapnametable.txt");
const KRO_NAMETABLE = path.resolve("data/RagnarokOnline_raw/assets/data/misc/mapnametable.txt");
const OUT = path.resolve("src/RagnarokOnline/maps.ts");

// mapnametable.txt: `<map_id>.rsw#<display name>#`. kRO is CP949; iRO is ASCII
// (which decodes through CP949 unchanged). WHATWG's "euc-kr" label is the CP949 index.
function parseMapNameTable(file: string): Map<string, string> {
    const out = new Map<string, string>();
    if (!existsSync(file))
        return out;
    const text = new TextDecoder("euc-kr").decode(readFileSync(file));
    for (const raw of text.split(/\r?\n/)) {
        const s = raw.trim();
        if (s.length === 0 || s.startsWith("//"))
            continue;
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

    // Bare ids: one per `<id>.rsw`. Era-suffixed files (`<id>@classic.rsw`)
    // are emitted as separate scene entries because they ship distinct
    // geometry (pre-renewal kRO snapshot); maps that differ only in entities
    // share geometry with the bare id and are handled by the runtime era
    // toggle. Instance maps (`1@4cdn`, `2@nyd`) use `@` as a LEADING char and
    // stay in the bare list.
    const ERA_SUFFIX_RE = /@classic\.rsw$/i;
    const allRsw = readdirSync(MAPS_DIR).filter((f) => f.toLowerCase().endsWith(".rsw"));
    const bareIds = allRsw
        .filter((f) => !ERA_SUFFIX_RE.test(f))
        .map((f) => f.slice(0, -".rsw".length).toLowerCase())
        .sort((a, b) => a.localeCompare(b));
    const bareSet = new Set(bareIds);
    const classicBaseIds = allRsw
        .filter((f) => ERA_SUFFIX_RE.test(f))
        .map((f) => f.slice(0, -"@classic.rsw".length).toLowerCase())
        .filter((id) => bareSet.has(id))
        .sort((a, b) => a.localeCompare(b));

    let namedEn = 0, namedKr = 0, unnamed = 0;
    type Entry = { id: string, name: string, category: MapCategory, era?: "classic" };
    const entries: Entry[] = [];
    const lookupName = (id: string): { display?: string, name: string } => {
        const en = iro.get(id);
        const kr = kro.get(id);
        let display: string | undefined;
        if (en !== undefined) { display = en; namedEn++; }
        else if (kr !== undefined) { display = kr; namedKr++; }
        else unnamed++;
        return { display, name: display !== undefined ? `${id} - ${display}` : id };
    };
    for (const id of bareIds)
        entries.push({ id, ...lookupName(id), category: classifyMap(id) });
    for (const base of classicBaseIds) {
        const en = iro.get(base);
        const kr = kro.get(base);
        const display = en ?? kr;
        const name = display !== undefined ? `${base} - ${display} (Pre-Renewal)` : `${base} (Pre-Renewal)`;
        entries.push({ id: `${base}@classic`, name, category: classifyMap(base), era: "classic" });
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
// ${entries.length} entries (${bareIds.length} bare + ${classicBaseIds.length}
// pre-renewal classic variants with rebuilt geometry). ${namedEn} with an iRO
// English name, ${namedKr} kRO Korean fallback, ${unnamed} unnamed.

import type { MapCategory } from "./mapcategory.js";

export interface RagnarokMapEntry {
    id: string;
    name: string;
    category: MapCategory;
    // Set on dedicated pre-renewal scene entries; their assets and entity
    // manifest are loaded from the @classic-suffixed files regardless of the
    // global era toggle.
    era?: "classic";
}

export const maps: RagnarokMapEntry[] = [
${body}
];
`;
    writeFileSync(OUT, contents);
    console.log(`wrote ${entries.length} entries to ${OUT}`);
    console.log(`  ${namedEn} English, ${namedKr} Korean fallback, ${unnamed} unnamed`);
}

main();
