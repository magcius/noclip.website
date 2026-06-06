import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { PNG } from "pngjs";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { parseGranny, extractGrannyModel } from "../granny.js";

function findGr2(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) out.push(...findGr2(p));
        else if (p.toLowerCase().endsWith(".gr2")) out.push(p);
    }
    return out;
}

const root = process.argv[2];
const pngIdx = process.argv.indexOf("--png");
const pngDir = pngIdx >= 0 ? process.argv[pngIdx + 1] : null;
if (pngDir) mkdirSync(pngDir, { recursive: true });

let ok = 0, bad = 0;
for (const path of findGr2(root).sort()) {
    try {
        const buf = readFileSync(path);
        const slice = new ArrayBufferSlice(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        const gr = parseGranny(slice);
        const model = extractGrannyModel(gr);
        const totalVerts = model.meshes.reduce((a, m) => a + m.vertexCount, 0);
        const totalTris = model.meshes.reduce((a, m) => a + m.indices.length / 3, 0);
        const decoded = model.textures.filter((t) => t !== null).length;
        const meshTex = model.meshes.map((m) => m.textureIndex).join(",");
        const bones = model.skeletons.reduce((a, s) => a + s.bones.length, 0);
        const anim = model.animations[0];
        const animTracks = anim ? anim.tracks.filter((t) => t.position !== null || t.orientation !== null || t.scaleShear !== null).length : 0;
        const animStr = anim ? `anim(dur=${anim.duration.toFixed(2)}s tracks=${animTracks}/${anim.tracks.length})` : "no-anim";
        console.log(`OK  ${path.replace(root, "").replace(/^\//, "")}  meshes=${model.meshes.length} verts=${totalVerts} tris=${totalTris} tex=${model.textures.length}(decoded ${decoded}) meshTexIdx=[${meshTex}] bones=${bones} ${animStr}`);
        if (pngDir) {
            model.textures.forEach((t, i) => {
                if (t === null) return;
                const png = new PNG({ width: t.width, height: t.height });
                t.rgba.forEach((v, j) => { png.data[j] = v; });
                writeFileSync(join(pngDir, `${basename(path, ".gr2")}_${i}.png`), PNG.sync.write(png));
            });
        }
        ok++;
    } catch (e) {
        console.log(`BAD ${path.replace(root, "").replace(/^\//, "")}  ${(e as Error).message}`);
        bad++;
    }
}
console.log(`\n=== ${ok} ok, ${bad} bad ===`);
