
// Offline entity-extraction tool for the Ragnarok Online port.
//
// Parses the Hercules server scripts into a per-map entity manifest (mobs, NPCs,
// warps) and stages the SPR/ACT sprite assets those entities need. Output:
//   data/RagnarokOnline/entities/<map>.json
//   data/RagnarokOnline/sprite/<dir>/<name>.spr|.act   (deduped)
//
// Run with: tsx src/RagnarokOnline/tools/extract-entities.ts
//
// This is the Hercules pass of the two-pass pipeline (the asset pass lives in
// extract.ts). It is re-runnable: pulling newer scripts and re-running flows new
// content into the manifests. The base map assets for the maps below are staged
// by extract.ts; this tool only adds the entity layer + their sprites.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import * as path from "path";

// ---- Source roots ----------------------------------------------------------

const HERCULES = path.resolve("../Hercules");
// Mob DB: read pre-renewal first, then renewal — renewal is the modern source
// of truth (it adds ~750 mobs unique to renewal-era maps and updates the stats
// of existing ones), so the second pass overrides the first on shared ids.
// Both eras' mob ids match for the classic mobs (Poring=1002, etc.).
const MOB_DBS = [
    path.join(HERCULES, "db/pre-re/mob_db.conf"),
    path.join(HERCULES, "db/re/mob_db.conf"),
];

// Client sprite tree. Monsters live under the CP949 "몬스터" dir; NPC job
// sprites under "npc". On disk the Korean names are already UTF-8.
const SPRITE_SRC = path.resolve("../client_data/assets/graphics/sprite");
const MONSTER_DIR = "몬스터";
const NPC_SPRITE_DIR = "npc";

// ---- Destination roots -----------------------------------------------------

const OUT_ENTITIES = path.resolve("data/RagnarokOnline/entities");
const OUT_SPRITE = path.resolve("data/RagnarokOnline/sprite");

// Maps to extract entities for.

// ---- Manifest shapes -------------------------------------------------------

interface MobEntry {
    id: number;
    sprite: string;   // sprite path relative to the sprite root, no extension
    name: string;     // display name from the spawn line
    count: number;
    cellX: number; cellY: number; // spawn-rect center (GAT cells); 0,0 = whole map
    spanX: number; spanY: number; // spawn-rect radius; 0,0 = whole map
    speed: number;    // movement speed in ms per cell (mob_db MoveSpeed)
    canMove: boolean; // mob_db Mode.CanMove: immobile mobs (Pupa, plants) never wander
}

interface NpcEntry {
    sprite: string;   // sprite path relative to the sprite root, no extension
    cellX: number; cellY: number; dir: number;
    name: string;     // visible name (the #suffix hidden part stripped)
}

interface WarpEntry {
    cellX: number; cellY: number;
    spanX: number; spanY: number;
    dest: string;     // destination map id
    destX: number; destY: number; // arrival cell on the destination map (GAT cells)
    // Era hint for the destination resolver (set on warps from era-specific
    // source scripts; omitted for shared-script warps so the runtime falls
    // back to the source scene's own era). Lines up with entity.ts:WarpEntry.
    destEra?: "classic" | "renewal";
}

interface Manifest {
    mobs: MobEntry[];
    npcs: NpcEntry[];
    warps: WarpEntry[];
}

// ---- mob_db: Id -> SpriteName ----------------------------------------------

// One mob_db record's fields we care about: the sprite name and the walk speed
// (MoveSpeed, ms per cell). DEFAULT_MOVE_SPEED is the engine's stock value, used
// when a record omits MoveSpeed.
const DEFAULT_MOVE_SPEED = 150;
interface MobDbEntry { sprite: string; speed: number; canMove: boolean; }

// The libconfig-style mob_db lists records with `Id: <n>`, `SpriteName:
// "<NAME>"`, `MoveSpeed: <ms>`, and a `Mode: { ... }` block of behavior flags.
// We need the sprite, the walk speed, and the Mode.CanMove flag (mobs whose Mode
// lacks CanMove — Pupa, plants, eggs, mushrooms — never wander; their MoveSpeed
// is meaningless). A line scan suffices: Id leads each record; SpriteName,
// MoveSpeed and the Mode block follow within it. CanMove is only honored while
// inside that record's Mode block. The record commits when the next Id is seen.
function parseMobDb(): Map<number, MobDbEntry> {
    const out = new Map<number, MobDbEntry>();
    for (const dbPath of MOB_DBS) {
        if (!existsSync(dbPath))
            continue;
        const text = readFileSync(dbPath, "utf8");
        let curId = -1, curSprite = "", curSpeed = DEFAULT_MOVE_SPEED, curCanMove = false;
        let inMode = false;
        const commit = (): void => {
            if (curId >= 0 && curSprite !== "")
                out.set(curId, { sprite: curSprite, speed: curSpeed, canMove: curCanMove });
            curId = -1; curSprite = ""; curSpeed = DEFAULT_MOVE_SPEED; curCanMove = false; inMode = false;
        };
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trim();
            const idM = /^Id:\s*(\d+)\b/.exec(line);
            if (idM !== null) { commit(); curId = parseInt(idM[1], 10); continue; }
            if (curId < 0)
                continue;
            // Track the Mode flag block so CanMove is only read from this
            // record's Mode object (the flags share generic names with no
            // record prefix).
            if (/^Mode:\s*\{/.test(line)) { inMode = true; continue; }
            if (inMode) {
                if (line.includes("}")) { inMode = false; continue; }
                if (/^CanMove:\s*true\b/.test(line)) curCanMove = true;
                continue;
            }
            const spM = /^SpriteName:\s*"([^"]+)"/.exec(line);
            if (spM !== null) { curSprite = spM[1]; continue; }
            const msM = /^MoveSpeed:\s*(\d+)\b/.exec(line);
            if (msM !== null) { curSpeed = parseInt(msM[1], 10); continue; }
        }
        commit();
    }
    return out;
}

// ---- Sprite resolution -----------------------------------------------------

// Mob sprite: the mob_db SpriteName lowercased, under the monster dir. Verified
// against the corpus (PORING -> 몬스터/poring.spr, LUNATIC -> lunatic.spr, ...).
function mobSpriteRel(spriteName: string): string {
    return `${MONSTER_DIR}/${spriteName.toLowerCase()}`;
}

// NPC sprite: the script's SPRITE-constant name lowercased, under the npc dir
// (4_F_KAFRA1 -> npc/4_f_kafra1.spr). A few constants have no visible sprite
// (HIDDEN_NPC, FAKE_NPC, INVISIBLE_NPC) — those are placeable triggers, not
// drawable, so we skip them.
const INVISIBLE_NPC_SPRITES = new Set(["HIDDEN_NPC", "FAKE_NPC", "INVISIBLE_NPC", "HIDDEN_WARP_NPC", "WARPNPC", "CLEAR_NPC"]);

function npcSpriteRel(spriteToken: string): string | null {
    if (INVISIBLE_NPC_SPRITES.has(spriteToken.toUpperCase()))
        return null;
    // Numeric SPRITE tokens are player-job IDs (rare for town NPCs); we don't
    // resolve those to a file here. Skip and report.
    if (/^-?\d+$/.test(spriteToken))
        return null;
    return `${NPC_SPRITE_DIR}/${spriteToken.toLowerCase()}`;
}

// Confirms a sprite's .spr exists on disk (the .act sits beside it). `rel` is the
// sprite path relative to the sprite root, no extension.
function spriteExists(rel: string): boolean {
    const segs = rel.split("/");
    return existsSync(path.join(SPRITE_SRC, ...segs) + ".spr");
}

// ---- Hercules script load list ---------------------------------------------

// Hercules does not load every .txt under npc/ — it loads exactly the files
// named in its config, following the era-specific entry point. A raw directory
// walk pulls in content the live server never loads: seasonal events and
// especially npc/custom/ (the sample Healer, Warper, Stylist, Job Master,
// MVP/bank/lottery rooms and other novelty NPCs), all of which over-populate
// towns with content that isn't part of the map.
//
// Instead we reproduce the server's own load order. The entry points are
// libconfig files (npc/pre-re/scripts_main.conf and npc/re/scripts_main.conf)
// whose `npc_global_list` tuples list script files as bare quoted paths and
// pull in further lists via `@include`. Lines beginning with `//` are disabled.
// Following the includes and collecting the live (non-commented) quoted paths
// yields exactly the set the server loads — which excludes npc/custom/ because
// scripts_custom.conf, while included, has all of its entries commented out by
// default.
//
// We process BOTH eras' load lists in one pass: each era's main conf shares the
// era-neutral `npc/scripts*.conf` family and adds its own subtree (npc/pre-re/*
// or npc/re/*). A Set dedups the shared files so they're scanned once. The
// result captures pre-renewal-only content (old Morroc), renewal-only content
// (Malangdo, Eclage, Dewata, ...), and all shared towns.
//
// A separate `npc_removed_list` (scripts_removed.conf, shared between eras)
// names files to drop even if they appear in the load list; we honor it.

// Pulls every double-quoted token out of one libconfig line, after stripping a
// `//` line comment. Used for both `@include "x.conf"` and bare `"npc/x.txt",`
// list entries. A line that is entirely commented out yields nothing.
function quotedTokens(line: string): string[] {
    const noComment = line.replace(/\/\/.*$/, "");
    const out: string[] = [];
    const re = /"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(noComment)) !== null)
        out.push(m[1]);
    return out;
}

// Strips `/* ... */` block comments from `src`, preserving newlines (so line
// numbers + the line-by-line parsers downstream stay aligned). `/*` inside a
// double-quoted string literal is NOT a comment opener — required so e.g.
// an NPC `mes "/* hint */"` line doesn't toggle global comment state.
function stripBlockComments(src: string): string {
    let out = "";
    let i = 0, inStr = false, inCom = false;
    while (i < src.length) {
        const c = src[i];
        if (inCom) {
            if (c === "*" && src[i + 1] === "/") { inCom = false; i += 2; continue; }
            // Preserve newlines so line numbers stay aligned.
            if (c === "\n") out += "\n";
            i++;
            continue;
        }
        if (inStr) {
            out += c;
            if (c === "\\" && i + 1 < src.length) { out += src[i + 1]; i += 2; continue; }
            if (c === '"') inStr = false;
            i++;
            continue;
        }
        if (c === "/" && src[i + 1] === "*") { inCom = true; i += 2; continue; }
        if (c === '"') { inStr = true; out += c; i++; continue; }
        // A `//` line comment is also a comment opener but we leave it intact
        // here — the line-by-line parsers handle `//` themselves.
        out += c;
        i++;
    }
    return out;
}

// Recursively parses a libconfig script list, accumulating the loaded .txt
// script files into `scripts` and the removed-file paths into `removed`. Paths
// in the conf are relative to the Hercules root. `@include` lines recurse into
// the named conf; quoted ".txt" tokens are script files; quoted ".conf" tokens
// reached outside an `@include` are ignored (none occur in practice).
function parseScriptConf(confRel: string, scripts: Set<string>, removed: Set<string>, seen: Set<string>): void {
    if (seen.has(confRel))
        return;
    seen.add(confRel);

    const confPath = path.join(HERCULES, confRel);
    if (!existsSync(confPath)) {
        console.warn(`  conf include missing: ${confRel}`);
        return;
    }

    // Track whether we are inside the removed-file list, so its entries are
    // dropped from (not added to) the load set.
    let inRemoved = false;
    // Strip /* ... */ block comments first so a commented-out @include or
    // quoted script path doesn't get picked up by the line scan below.
    const text = stripBlockComments(readFileSync(confPath, "utf8"));
    for (const raw of text.split(/\r?\n/)) {
        const noComment = raw.replace(/\/\/.*$/, "");

        if (/\bnpc_removed_list\s*:/.test(noComment)) inRemoved = true;
        else if (inRemoved && noComment.includes(")")) inRemoved = false;

        const includeM = /@include\s+"([^"]+)"/.exec(noComment);
        if (includeM !== null) {
            parseScriptConf(includeM[1], scripts, removed, seen);
            continue;
        }

        for (const tok of quotedTokens(raw)) {
            if (!tok.endsWith(".txt"))
                continue;
            if (inRemoved) removed.add(tok);
            else scripts.add(tok);
        }
    }
}

// Resolves one era's load list to absolute script file paths, honoring the
// removed-file list and skipping any entry whose file is absent. Called per
// era (pre-renewal and renewal) so we can scan each independently and apply
// per-map era preference downstream.
const PRE_RE_ROOT_CONF = "npc/pre-re/scripts_main.conf";
const RE_ROOT_CONF = "npc/re/scripts_main.conf";

function collectScriptFiles(rootConf: string): string[] {
    const scripts = new Set<string>();
    const removed = new Set<string>();
    parseScriptConf(rootConf, scripts, removed, new Set<string>());

    const out: string[] = [];
    for (const rel of scripts) {
        if (removed.has(rel))
            continue;
        const full = path.join(HERCULES, rel);
        if (!existsSync(full)) {
            console.warn(`  listed script missing: ${rel}`);
            continue;
        }
        out.push(full);
    }
    return out;
}

// Extracts the visible display name from an NPC's name field. Hercules names
// carry two kinds of hidden suffix: `#tag` (the hidden part shown to no one) and
// `::uniqueID` (the internal unique-name used by duplicate()/event hooks).
// Both are stripped; "Kafra Employee::kaf_prontera" -> "Kafra Employee", and a
// name that is only a hidden tag ("#prt_key-1") becomes "".
function visibleName(name: string): string {
    let s = name;
    const colons = s.indexOf("::");
    if (colons >= 0) s = s.slice(0, colons);
    const hash = s.indexOf("#");
    if (hash >= 0) s = s.slice(0, hash);
    return s.trim();
}

// Parses an NPC/warp/mob definition line, returning its leading
// `map,x,y,dir` (or `map,x,y,xs,ys` for mobs) plus the tab-separated fields.
// Returns null for lines that aren't map-anchored definitions OR are disabled
// by a leading `//` comment. Skipping commented lines matters: their coords[0]
// would otherwise read as "//<mapId>" and write to "<mapId>.json" under POSIX
// path normalisation, silently overwriting the real manifest with the disabled
// content (this had wiped prt_in's NPCs/mobs and replaced its warps with four
// commented-out tiles in npc/warps/cities/prontera.txt).
interface Line { coords: string[]; fields: string[]; }
function splitLine(raw: string): Line | null {
    // Definition lines are tab-separated: <coords>\t<type>\t<name>\t<args>.
    // Script bodies and `function`/`-`-anchored entries either don't start with
    // a map name or have no tab structure of interest. Commented-out entries
    // (with or without indent) drop out.
    const lead = raw.trimStart();
    if (lead.startsWith("//"))
        return null;
    const fields = raw.split("\t");
    if (fields.length < 2)
        return null;
    const coords = fields[0].split(",");
    return { coords, fields };
}

// Which load-list a script file came from. Drives era assignment for every
// entity the file declares — see emitManifests for the per-(map, era) fan-out.
// "shared" = a script that both eras' main.conf @includes (npc/cities/*.txt
// etc. — Gravity-authored once, used in both vintages); "pre-re" or "re" =
// scripts unique to that era's subtree (npc/pre-re/* or npc/re/*).
type EntryEra = "pre-re" | "re" | "shared";

interface ScanResult {
    mobs: { name: string; cellX: number; cellY: number; spanX: number; spanY: number; mobId: number; count: number; era: EntryEra }[];
    npcs: { spriteToken: string; cellX: number; cellY: number; dir: number; name: string; era: EntryEra }[];
    warps: (WarpEntry & { era: EntryEra })[];
}

// Scans every npc/*.txt for lines anchored to `mapId`. Hercules definition
// types we handle:
//   monster:                     <map,x,y,xs,ys> monster <name> <id,amt,d1,d2{,event}>
//   warp:                        <map,x,y,dir>   warp    <name> <xs,ys,dest,dx,dy>
//   script/duplicate/shop/...:   <map,x,y,dir>   <type>  <name> <SPRITE,...>
// Multi-line script bodies start with `{` on the def line and continue on
// following lines; those continuation lines never start with a tab-coords field
// matching our map, so a per-line scan is safe.
// Scans `text` for scripted `monster(...)` calls embedded in NPC script
// bodies. These are placed by OnInit/OnTimer/OnTouch handlers and don't show
// up as tab-anchored definition lines, so the line scanner misses them.
// Real examples: niflheim.txt (Ashe Bruce's "touch the book" Rideword
// spawns), quests_airship.txt (the staged Gremlin/Beholder encounters
// inside airplane_01).
//
// monster() signature (script.c):
//   monster "<map>",<x>,<y>,"<name>",<id|CONST>,<count>{,"<event>"};
//   monster("<map>",<x>,<y>,"<name>",<id|CONST>,<count>{,"<event>"});
//
// Mob identifier is either a numeric id (rare in scripts) or a SpriteName
// constant (GREMLIN, G_RIDEWORD, ...). We resolve constants via the
// reverse mob_db lookup; unknown / non-literal mob args are skipped.
//
// Caveat handling: any monster() whose map/x/y/count is not a literal (i.e.
// a script variable like .@x or $RANDOM) gets SKIPPED rather than emitted
// with a placeholder. The runtime has nowhere meaningful to draw a mob with
// no coords, and emitting a fake spawn at (0,0) would just clutter origin.
// `warp()` script calls are intentionally NOT scanned: they teleport the
// calling player rather than declaring a placeable warp tile (the visible
// warp tiles already come through as `WARPNPC` script definitions caught
// by the line scanner).
function scanScriptedSpawns(text: string, mobIdByName: Map<string, number>):
    { mapId: string; x: number; y: number; name: string; mobId: number; count: number }[] {
    const out: { mapId: string; x: number; y: number; name: string; mobId: number; count: number }[] = [];
    // Match `monster(...)` OR `monster "..."` opening. Quoted-string-first arg
    // (the map id) is the easy disambiguator from `killmonster`/`areamonster`/
    // `summon`/etc. The name field may be a raw "..." quoted literal or a
    // gettext-style _("...") wrapper (Hercules uses both interchangeably).
    const re = /\bmonster\s*[\(\s]\s*"([^"]+)"\s*,\s*([^,]+),\s*([^,]+),\s*(?:_\s*\(\s*)?"([^"]*)"\s*\)?\s*,\s*([A-Z_][A-Z0-9_]*|-?\d+)\s*,\s*([^,;)\s]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const mapId = m[1].trim();
        const xRaw = m[2].trim(), yRaw = m[3].trim();
        const nameLit = m[4].trim();
        const mobTok = m[5].trim();
        const countRaw = m[6].trim();
        // Literal coords + count only; skip script-variable args.
        const x = parseInt(xRaw, 10), y = parseInt(yRaw, 10), count = parseInt(countRaw, 10);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(count)) continue;
        // mapId may also be a variable — script.c accepts strings only there,
        // but we already required a literal "..." so this is safe.
        // Resolve mob: numeric -> direct; constant -> SpriteName lookup.
        let mobId: number;
        if (/^-?\d+$/.test(mobTok)) {
            mobId = parseInt(mobTok, 10);
        } else {
            const lookup = mobIdByName.get(mobTok.toUpperCase());
            if (lookup === undefined) continue;
            mobId = lookup;
        }
        // Name may be "--ja--" (mob_db default-name marker); pass through and
        // let the manifest reader treat it like any other name. Avoids special
        // casing here.
        out.push({ mapId, x, y, name: nameLit, mobId, count });
    }
    return out;
}

// One pass over every loaded script, tagging each entry with its source file's
// era and bucketing by the map id in its coordinate field. Returns one big
// map (mapId -> entries) for the whole corpus; the main loop fans entries out
// into per-(map, era) manifests downstream.
function scanAllScripts(files: { file: string, era: EntryEra }[], mobIdByName: Map<string, number>): Map<string, ScanResult> {
    const byMap = new Map<string, ScanResult>();
    const NPC_TYPES = new Set(["script", "shop", "cashshop", "pointshop", "marketshop", "trader"]);
    const bucket = (id: string): ScanResult => {
        let r = byMap.get(id);
        if (r === undefined) { r = { mobs: [], npcs: [], warps: [] }; byMap.set(id, r); }
        return r;
    };

    for (const { file, era } of files) {
        // Block-comment-strip first: NPCs wrapped in /* ... */ (e.g. the
        // disabled Curator of Library in npc/cities/prontera.txt) would
        // otherwise be parsed as live map entries because splitLine only
        // skips `//` line comments.
        const text = stripBlockComments(readFileSync(file, "utf8"));
        // Second pass: scripted monster() spawns. Done BEFORE the line scan
        // because the line scan only sees tab-anchored definition lines.
        for (const { mapId, x, y, name, mobId, count } of scanScriptedSpawns(text, mobIdByName)) {
            const res = bucket(mapId);
            res.mobs.push({ name, cellX: x, cellY: y, spanX: 0, spanY: 0, mobId, count, era });
        }
        for (const raw of text.split(/\r?\n/)) {
            const line = splitLine(raw);
            if (line === null)
                continue;
            const { coords, fields } = line;
            const mapId = coords[0];
            if (!mapId || fields.length < 2)
                continue;
            const res = bucket(mapId);

            const type = fields[1].trim();

            if (type === "monster" || type === "boss_monster") {
                // coords: map,x,y,xs,ys ; fields[2]=name ; fields[3]=id,amt,d1,d2{,event}
                const x = +coords[1], y = +coords[2], xs = +coords[3], ys = +coords[4];
                const args = (fields[3] ?? "").split(",");
                const mobId = parseInt(args[0], 10);
                const count = parseInt(args[1] ?? "1", 10);
                if (!Number.isFinite(mobId)) continue;
                res.mobs.push({ name: fields[2].trim(), cellX: x, cellY: y, spanX: xs, spanY: ys, mobId, count, era });
                continue;
            }

            if (type === "warp") {
                // coords: map,x,y,dir ; fields[3]=xs,ys,dest,dx,dy
                // dx,dy are the arrival cell on the destination map; keep them so
                // the viewer can place the camera at the landing point.
                const x = +coords[1], y = +coords[2];
                const args = (fields[3] ?? "").split(",");
                const xs = parseInt(args[0], 10), ys = parseInt(args[1], 10);
                const dest = args[2] ?? "";
                if (dest === "") continue;
                const dx = parseInt(args[3], 10), dy = parseInt(args[4], 10);
                res.warps.push({
                    cellX: x, cellY: y, spanX: xs, spanY: ys, dest,
                    destX: Number.isFinite(dx) ? dx : 0,
                    destY: Number.isFinite(dy) ? dy : 0,
                    era,
                });
                continue;
            }

            // NPC-like definitions, including duplicate(Parent).
            const isDuplicate = type.startsWith("duplicate(");
            if (NPC_TYPES.has(type) || isDuplicate) {
                const x = +coords[1], y = +coords[2], dir = +coords[3];
                // SPRITE is the first comma-separated token of the args field.
                const args = (fields[3] ?? "").split(",");
                const spriteToken = (args[0] ?? "").replace(/[{].*$/, "").trim();
                if (spriteToken === "") continue;
                res.npcs.push({ spriteToken, cellX: x, cellY: y, dir, name: visibleName(fields[2]), era });
                continue;
            }
        }
    }
    return byMap;
}

// ---- Era-aware map fan-out -------------------------------------------------

// Filters a scan's entries to those whose era is in `allowed`, and tags the
// resulting warps with `destEra` so cross-map warps from this manifest carry
// the right era hint into the runtime resolver. A "shared" warp leaves
// destEra undefined regardless (the runtime falls back to the source scene's
// own era when no hint is set — see era.ts:resolveWarpDest).
function filterByEra(scan: ScanResult, allowed: EntryEra[], destEra: "classic" | "renewal"): ScanResult {
    const ok = (e: { era: EntryEra }): boolean => allowed.includes(e.era);
    return {
        mobs: scan.mobs.filter(ok),
        npcs: scan.npcs.filter(ok),
        warps: scan.warps.filter(ok).map((w) => ({
            ...w,
            destEra: w.era === "shared" ? undefined : destEra,
        })),
    };
}

function hasContent(scan: ScanResult): boolean {
    return scan.mobs.length > 0 || scan.npcs.length > 0 || scan.warps.length > 0;
}

// A map's entries are era-divergent when classic and renewal would produce
// meaningfully different manifests — i.e. there exists at least one entry
// from an era-specific script (pre-re-only or re-only). Maps with only
// "shared" entries collapse to a single manifest because both eras would
// produce byte-identical content. We use this signal to decide whether to
// emit per-era manifests at all (most cities + dungeons don't diverge — no
// point writing three identical .json files).
function isEraDivergent(scan: ScanResult): boolean {
    const eraSpecific = (e: { era: EntryEra }): boolean => e.era !== "shared";
    return scan.mobs.some(eraSpecific) || scan.npcs.some(eraSpecific) || scan.warps.some(eraSpecific);
}

// Maps a raw scan for one mapId into the (possibly multiple) manifest names +
// pre-filtered scans that should be written. Returns [] when nothing of value
// resolves (no entity content; manifest is skipped and the scene 404s cleanly).
//
// Era-divergent maps produce THREE files: <id>@classic.json (pre-re + shared),
// <id>@renewal.json (re + shared), and a bare <id>.json that aliases the
// primary (renewal) era — so existing URLs and inter-map warp scripts naming
// bare ids keep working without knowing about era variants.
//
// Non-divergent maps produce ONE bare <id>.json (no point emitting redundant
// per-era copies of the same content). Renewal-removed legacy maps (only
// pre-re entries exist) fall through to that single bare manifest using the
// pre-re entries.
function emitManifests(mapId: string, scan: ScanResult): { name: string, scan: ScanResult }[] {
    if (isEraDivergent(scan)) {
        const out: { name: string, scan: ScanResult }[] = [];
        const classic = filterByEra(scan, ["pre-re", "shared"], "classic");
        const renewal = filterByEra(scan, ["re", "shared"], "renewal");
        if (hasContent(classic))
            out.push({ name: `${mapId}@classic`, scan: classic });
        if (hasContent(renewal)) {
            out.push({ name: `${mapId}@renewal`, scan: renewal });
            out.push({ name: mapId, scan: renewal });   // bare alias = renewal
        } else if (hasContent(classic)) {
            // Pre-re-only map (renewal removed it): the bare alias falls back
            // to classic so the scene still loads under its canonical id.
            out.push({ name: mapId, scan: classic });
        }
        return out;
    }
    // Non-divergent: a single bare manifest covers both eras. Pull from any
    // entries (they're all "shared", which exist in both era buckets).
    const bare = filterByEra(scan, ["pre-re", "re", "shared"], "renewal");
    return hasContent(bare) ? [{ name: mapId, scan: bare }] : [];
}

// ---- Sprite staging --------------------------------------------------------

// Copies a sprite's .spr + .act pair from the client tree into OUT_SPRITE at the
// same relative path. `rel` is forward-slash, no extension. Dedup via `copied`.
function stageSprite(rel: string, copied: Set<string>): void {
    if (copied.has(rel)) return;
    const segs = rel.split("/");
    for (const ext of [".spr", ".act"]) {
        const src = path.join(SPRITE_SRC, ...segs) + ext;
        const dst = path.join(OUT_SPRITE, ...segs) + ext;
        if (!existsSync(src)) continue;
        mkdirSync(path.dirname(dst), { recursive: true });
        copyFileSync(src, dst);
    }
    copied.add(rel);
}

// ---- Main ------------------------------------------------------------------

function main(): void {
    if (!existsSync(HERCULES)) { console.error(`Hercules not found: ${HERCULES}`); process.exit(1); }
    if (!existsSync(SPRITE_SRC)) { console.error(`Sprite source not found: ${SPRITE_SRC}`); process.exit(1); }

    mkdirSync(OUT_ENTITIES, { recursive: true });

    const mobDb = parseMobDb();
    console.log(`mob_db: ${mobDb.size} mobs loaded`);
    for (const [id, label] of [[1002, "Poring"], [1008, "Pupa"], [1063, "Lunatic"], [1113, "Drops"]] as [number, string][]) {
        const e = mobDb.get(id);
        if (e !== undefined)
            console.log(`  ${label} (${id}): CanMove=${e.canMove} speed=${e.speed}`);
    }

    // Reverse lookup SpriteName -> Id for scripted monster() calls (whose
    // first arg is the SpriteName constant rather than a numeric id).
    // Renewal wins on shared names because the renewal mob_db is processed
    // second in parseMobDb; reusing the same iteration order here keeps the
    // two sources in sync.
    const mobIdByName = new Map<string, number>();
    for (const [id, e] of mobDb)
        mobIdByName.set(e.sprite.toUpperCase(), id);

    // Resolve each era's load list; the eras share many files (npc/cities/*,
    // npc/quests/*, etc. — Gravity-authored once and @included by both
    // scripts_main.conf). Tag each unique file with its origin: in BOTH
    // lists = "shared" (entries are era-shared and duplicate into both
    // sides), in pre-re only = "pre-re", in re only = "re".
    const preReFiles = collectScriptFiles(PRE_RE_ROOT_CONF);
    const reFiles = collectScriptFiles(RE_ROOT_CONF);
    const preSet = new Set(preReFiles);
    const reSet = new Set(reFiles);
    const filesWithEra: { file: string, era: EntryEra }[] = [];
    let preReOnlyFiles = 0, reOnlyFiles = 0, sharedFiles = 0;
    for (const file of new Set([...preReFiles, ...reFiles])) {
        const inPre = preSet.has(file), inRe = reSet.has(file);
        const era: EntryEra = (inPre && inRe) ? "shared" : (inPre ? "pre-re" : "re");
        if (era === "shared") sharedFiles++;
        else if (era === "pre-re") preReOnlyFiles++;
        else reOnlyFiles++;
        filesWithEra.push({ file, era });
    }
    console.log(`scripts: ${filesWithEra.length} files (${sharedFiles} shared, ${preReOnlyFiles} pre-re-only, ${reOnlyFiles} re-only)`);

    const stagedSprites = new Set<string>();

    const EVENT_NAME = /\b(demo|popup|test)\b|event/i;
    // One scan over every file (each read once), tagging each entry with its
    // source era so emitManifests can fan into per-(map, era) buckets.
    const byMap = scanAllScripts(filesWithEra, mobIdByName);
    console.log(`scanned ${byMap.size} maps with script entries\n`);

    // Track which manifest files this run produces so we can sweep any stale
    // .json from a previous run (a map whose entities have since been filtered
    // out, e.g. CLEAR_NPC additions to the invisible-sprite list).
    const writtenManifests = new Set<string>();

    let mapsWritten = 0, totalNpcs = 0, totalMobInstances = 0, totalWarps = 0, eraVariantsWritten = 0;
    for (const [mapId, scan] of byMap) {
        // Fan into per-(map, era) manifests. Most maps emit a single bare
        // <mapId>.json (renewal-preference, with a pre-re fallback for
        // renewal-removed maps). Era-aware maps emit three: <mapId>.json
        // (= renewal alias), <mapId>@renewal.json, and <mapId>@classic.json.
        for (const { name: manifestId, scan: filteredScan } of emitManifests(mapId, scan)) {
            // Mobs: resolve id -> sprite via mob_db. Every map declared with
            // mob spawns gets them placed; a few cities have single rare
            // "tame" spawns (Wild Rose, etc.) with multi-hour respawn timers
            // that we treat as legitimate content rather than filtering on a
            // map-name heuristic.
            const mobs: MobEntry[] = [];
            let totalMonsters = 0;
            for (const m of filteredScan.mobs) {
                const dbEntry = mobDb.get(m.mobId);
                if (dbEntry === undefined) continue;
                const rel = mobSpriteRel(dbEntry.sprite);
                if (!spriteExists(rel)) continue;
                stageSprite(rel, stagedSprites);
                mobs.push({ id: m.mobId, sprite: rel, name: m.name, count: m.count, cellX: m.cellX, cellY: m.cellY, spanX: m.spanX, spanY: m.spanY, speed: dbEntry.speed, canMove: dbEntry.canMove });
                totalMonsters += m.count;
            }

            // NPCs: resolve SPRITE token -> sprite file; skip event/demo/debug
            // NPCs and dedup stacked NPCs sharing a cell.
            const npcs: NpcEntry[] = [];
            const cellTaken = new Set<string>();
            for (const n of filteredScan.npcs) {
                if (EVENT_NAME.test(n.name)) continue;
                const cellKey = `${n.cellX},${n.cellY}`;
                if (cellTaken.has(cellKey)) continue;
                const rel = npcSpriteRel(n.spriteToken);
                if (rel === null) continue;
                if (!spriteExists(rel)) continue;
                stageSprite(rel, stagedSprites);
                cellTaken.add(cellKey);
                npcs.push({ sprite: rel, cellX: n.cellX, cellY: n.cellY, dir: n.dir, name: n.name });
            }

            // Warps: drop the per-entry `era` scratch field but keep destEra
            // (the runtime-relevant hint set by filterByEra). For an era-aware
            // map both the @classic and @renewal manifests use destEra, so the
            // resolver picks the matching dest variant when both eras exist.
            const warps: WarpEntry[] = filteredScan.warps.map((w) => ({
                cellX: w.cellX, cellY: w.cellY, spanX: w.spanX, spanY: w.spanY,
                dest: w.dest, destX: w.destX, destY: w.destY,
                destEra: w.destEra,
            }));

            if (mobs.length === 0 && npcs.length === 0 && warps.length === 0)
                continue; // nothing resolved for this manifest; skip silently

            const fileName = `${manifestId}.json`;
            writeFileSync(path.join(OUT_ENTITIES, fileName), JSON.stringify({ mobs, npcs, warps } as Manifest, null, 1));
            writtenManifests.add(fileName);
            mapsWritten++;
            if (manifestId.includes("@")) eraVariantsWritten++;
            totalNpcs += npcs.length;
            totalMobInstances += totalMonsters;
            totalWarps += warps.length;
        }
    }

    // Sweep stale manifests left over from previous runs.
    let stale = 0;
    for (const f of readdirSync(OUT_ENTITIES)) {
        if (!f.endsWith(".json")) continue;
        if (writtenManifests.has(f)) continue;
        unlinkSync(path.join(OUT_ENTITIES, f));
        stale++;
    }
    if (stale > 0)
        console.log(`removed ${stale} stale manifest(s) from a previous run.`);

    console.log(`${mapsWritten} map manifests written (${totalNpcs} NPCs, ${totalMobInstances} monster instances, ${totalWarps} warps).`);

    console.log(`\n${stagedSprites.size} unique sprite (.spr/.act) pairs staged into ${OUT_SPRITE}`);
}

main();
