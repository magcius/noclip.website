
// Runs every offline extraction stage in dependency order. Stages whose
// inputs are missing are skipped; non-zero exits log and continue. CLI args
// (e.g. a map id) are forwarded to extract.ts only.
//
//   npx tsx src/RagnarokOnline/tools/extract-all.ts [mapId ...]

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import * as path from "path";

const HERE = path.resolve("src/RagnarokOnline/tools");

interface Stage {
    name: string;
    script: string;
    args?: string[];
    requires?: string;
}

const passthrough = process.argv.slice(2);

const stages: Stage[] = [
    { name: "extract",            script: "extract.ts",            args: passthrough, requires: "data/RagnarokOnline_raw/assets/data/maps" },
    { name: "patch-malangdo-yut", script: "patch-malangdo-yut.ts", requires: "data/RagnarokOnline/maps/malangdo.gnd" },
    { name: "extract-emitters",   script: "extract-emitters.ts",   requires: "data/RagnarokOnline_raw/iro_effecttool" },
    { name: "extract-entities",   script: "extract-entities.ts",   requires: "../Hercules" },
    { name: "regen-maps",         script: "regen-maps.ts",         requires: "data/RagnarokOnline/maps" },
];

for (const stage of stages) {
    console.log(`\n=== ${stage.name} ===`);
    if (stage.requires !== undefined && !existsSync(path.resolve(stage.requires))) {
        console.warn(`  skip ${stage.name}: missing ${stage.requires}`);
        continue;
    }
    const res = spawnSync("npx", ["tsx", path.join(HERE, stage.script), ...(stage.args ?? [])], { stdio: "inherit" });
    if (res.status !== 0)
        console.error(`  ${stage.name} exited ${res.status} — continuing`);
}
