import { parseTextureAnimation, sampleTextureTrack } from '../nsbta.js';
import { parseModel } from '../nsbmd.js';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import ArrayBufferSlice from '../../ArrayBufferSlice.js';
import { White } from '../../Color.js';
import { parseNSBTX } from '../../nns_g3d/NNS_G3D.js';
import { parseArchive, parseBuildingPack, parseMap, parseMatrix } from '../bin.js';
import { readCmds, VERTEX_SIZE } from '../nitro_gx.js';
import { compileModel, bakeDraw } from '../geometry.js';
import { archiveNames, GameVersion, getLocations, loadWorld, WorldData } from '../world.js';

const root = resolve(process.argv[2] ?? 'data/PokemonBlackWhite/White');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
assert(manifest.version === 'Black' || manifest.version === 'White');
const version: GameVersion = manifest.version;
assert.equal(manifest.gameCode.slice(0, 3), version === 'White' ? 'IRA' : 'IRB');
const locations = getLocations(version);
const read = (name: string) => {
    const b = readFileSync(resolve(root, name));
    assert.equal(b.byteLength, manifest.files[name].bytes, `${name}: size differs from extraction manifest`);
    assert.equal(createHash('sha256').update(b).digest('hex'), manifest.files[name].sha256, `${name}: checksum differs from extraction manifest`);
    return new ArrayBufferSlice(b.buffer, b.byteOffset, b.byteLength);
};
const maps = parseArchive(read('maps.narc')).map(parseMap);
const matrices = parseArchive(read('matrices.narc')).map(parseMatrix);
const packs = parseArchive(read('buildings.narc')).map(parseBuildingPack);
const textures = parseArchive(read('terrain_textures.narc')).map(parseNSBTX);
const buildingTextures = parseArchive(read('building_textures.narc')).map(parseNSBTX);
let models = 0, shapes = 0, triangles = 0;
for (const buffer of [...maps.map((m) => m.model), ...packs.flatMap((p) => [...p.values()])]) {
    for (const model of parseModel(buffer).models) {
        models++;
        for (const draw of compileModel(model)) {
            const shape = draw.shape;
            const data = bakeDraw(draw, White, 1);
            assert.equal(data.indexBuffer.length % 3, 0, `${model.name}/${shape.name}: triangles`);
            for (const index of data.indexBuffer) assert(index < data.packedVertexBuffer.length / VERTEX_SIZE);
            for (const value of data.packedVertexBuffer) assert(Number.isFinite(value));
            shapes++;
            triangles += data.indexBuffer.length / 3;
        }
    }
}
for (const matrix of matrices) for (const map of matrix.maps) assert(map === -1 || map >= 0 && map < maps.length);
for (let p = 0; p < packs.length; p++) {
    const tex = buildingTextures[p].tex0;
    for (const [id, buffer] of packs[p]) for (const model of parseModel(buffer).models) {
        for (const m of model.materials) {
            assert(m.textureName === null || tex.textures.some((t) => t.name === m.textureName), `Pack ${p}, building ${id}: ${m.textureName}`);
            assert(m.paletteName === null || tex.palettes.some((t) => t.name === m.paletteName), `Pack ${p}, building ${id}: ${m.paletteName}`);
        }
    }
}
const one = new Uint8Array(12);
new DataView(one.buffer).setUint16(4, 1, true);
new DataView(one.buffer).setUint16(6, 1, true);
new DataView(one.buffer).setInt32(8, -1, true);
assert.deepEqual(parseMatrix(new ArrayBufferSlice(one.buffer)), { width: 1, height: 1, maps: [-1], headers: [-1] });
assert.throws(() => parseMatrix(new ArrayBufferSlice(one.buffer.slice(0, 7))));

const emptyPrimitive = new Uint8Array([0x40, 0x41, 0, 0, 2, 0, 0, 0]);
assert.equal(readCmds(new ArrayBufferSlice(emptyPrimitive.buffer), { color: White, alpha: 1 }).indexBuffer.length, 0);
const scaledTriangle = new Uint32Array([
    0x2323401B, 8192, 8192, 8192, 0, 4096, 0, 4096 << 16, 0,
    0x00004123, 0, 4096,
]);
const scaled = readCmds(new ArrayBufferSlice(scaledTriangle.buffer), { color: White, alpha: 1 });
assert.deepEqual([...scaled.indexBuffer], [0, 1, 2]);
assert.deepEqual([...scaled.packedVertexBuffer.slice(0, 3)], [2, 0, 0]);
const sceneData = archiveNames.map(read);
let scenes = 0;
for (const season of [0, 1, 2, 3]) {
    for (const header of [-1, ...locations.map(([id]) => id)]) {
        const world = loadWorld(sceneData, header, season, version);
        assert(world.objects.length > 0);
        if (header === -1) {
            assert.equal(world.objects.filter((o) => o.model.name === 't1_labo_01').length, 1, 'Only the real Nuvema laboratory belongs in the region');
            assert.equal(world.objects.filter((o) => o.model.name === 't1_house_02').length, 3, 'Only the real Nuvema houses belong in the region');
        }
        for (const n of world.target) assert(Number.isFinite(n));
        scenes++;
    }
}
console.log(JSON.stringify({ version, maps: maps.length, matrices: matrices.length, buildingPacks: packs.length, terrainTextures: textures.length, models, shapes, triangles, scenes, checks: 'passed' }, null, 2));

const { parseBuildingMetadata } = await import('../bin.js');
const { parseJointAnimation, sampleJointAnimation } = await import('../nsbca.js');
const { parseNSBTP } = await import('../../nns_g3d/NNS_G3D.js');
let jointAnimations = 0, textureAnimations = 0, changingJoints = 0, jointFramesChecked = 0;
for (const [p, buffer] of parseArchive(read('buildings.narc')).entries()) {
    for (const [id, metadata] of parseBuildingMetadata(buffer)) {
        const model = parseModel(packs[p].get(id)!).models[0];
        for (const animation of metadata.animations) {
            const tag = animation.createDataView().getUint32(0, false);
            if (tag === 0x42434130) {
                const joint = parseJointAnimation(animation);
                let changed = false;
                const first = sampleJointAnimation(joint, model, 0);
                for (let frame = 0; frame < joint.duration; frame += 0.5) {
                    jointFramesChecked++;
                    const matrices = sampleJointAnimation(joint, model, frame);
                    for (let i = 0; i < matrices.length; i++) for (let j = 0; j < 16; j++) {
                        assert(Number.isFinite(matrices[i][j]));
                        changed ||= Math.abs(matrices[i][j] - first[i][j]) > 0.0001;
                    }
                    for (const draw of compileModel(model, matrices)) {
                        assert(draw.matrices.length <= 31);
                        for (const value of bakeDraw(draw, White, 1).packedVertexBuffer) assert(Number.isFinite(value));
                    }
                }
                assert.deepEqual(sampleJointAnimation(joint, model, joint.duration), first);
                if (changed) changingJoints++;
                jointAnimations++;
            } else if (tag === 0x42544130) {
                const srt = parseTextureAnimation(animation).srt0;
                assert(srt.entries.length > 0 && srt.duration > 0);
                for (const entry of srt.entries) for (const channel of [entry.scaleS, entry.scaleT, entry.rot, entry.transS, entry.transT]) {
                    for (let frame = 0; frame < srt.duration; frame += 0.5)
                        assert(Number.isFinite(sampleTextureTrack(channel, frame, channel === entry.rot)));
                }
                textureAnimations++;
            } else if (tag === 0x42545030) {
                for (const pat of parseNSBTP(animation).pat0) {
                    assert(pat.entries.length > 0 && pat.duration > 0);
                    for (const entry of pat.entries) for (const frame of entry.animationTrack) {
                        assert(buildingTextures[p].tex0.textures.some((t) => t.name === frame.texName));
                        assert(buildingTextures[p].tex0.palettes.some((t) => t.name === frame.plttName));
                    }
                }
                textureAnimations++;
            }
        }
    }
}
assert(changingJoints > 0);
const overview = loadWorld(sceneData, -1, 0, version);
assert(overview.objects.some((o) => o.pat !== undefined));
assert(overview.objects.some((o) => o.srt !== undefined));
assert(overview.objects.some((o) => o.joint !== undefined));
console.log(JSON.stringify({ jointAnimations, jointFramesChecked, changingJoints, textureAnimations, overviewObjects: overview.objects.length, animationChecks: 'passed' }, null, 2));

assert.equal(sampleTextureTrack({ frames: [{ frame: 0, value: -1 }, { frame: 4, value: 1 }] }, 2), 0);
assert.equal(sampleTextureTrack({ frames: [{ frame: 0, value: -1 }, { frame: 4, value: 1 }] }, 4.9), 1);
const flagModel = parseModel(packs[21].get(242)!).models[0];
const flagMetadata = parseBuildingMetadata(parseArchive(read('buildings.narc'))[21]).get(242)!;
const flagAnimation = parseJointAnimation(flagMetadata.animations.find((a) => a.createDataView().getUint32(0, false) === 0x42434130)!);
for (let frame = 0; frame < flagAnimation.duration; frame++) {
    const joints = sampleJointAnimation(flagAnimation, flagModel, frame);
    for (const draw of compileModel(flagModel, joints)) {
        const vertices = bakeDraw(draw, White, 1).packedVertexBuffer;
        for (let p = 0; p < vertices.length; p += VERTEX_SIZE) for (let axis = 0; axis < 3; axis++)
            assert(Math.abs(vertices[p + axis]) < 150, `Flag exceeds its local footprint at frame ${frame}`);
    }
}
console.log(JSON.stringify({ flagFramesChecked: flagAnimation.duration, flagDeformationRegression: 'passed', textureInterpolation: 'passed' }));

assert(getLocations('Black').some(([header, name]) => header === 0 && name === 'Black City'));
assert(!getLocations('Black').some(([header]) => header === 424));
assert(getLocations('White').some(([header, name]) => header === 424 && name === 'White Forest'));
const rotationMidpoint = sampleTextureTrack({ frames: [{ frame: 0, value: Math.PI * 0.9 }, { frame: 2, value: -Math.PI * 0.9 }] }, 1, true);
assert(Math.abs(rotationMidpoint - Math.PI) < 0.000001);
console.log(JSON.stringify({ versionSelection: 'passed', extractionChecksums: 'passed', rotationWrap: 'passed' }));

const sharedWorld = new WorldData(sceneData);
const snapshot = (world: ReturnType<typeof loadWorld>) => world.objects.map((o) => [o.model.name, ...o.position, o.rotation]);
assert.deepEqual(snapshot(loadWorld(sharedWorld, -1, 0, version)), snapshot(overview));
loadWorld(sharedWorld, -1, 3, version);
assert.deepEqual(snapshot(loadWorld(sharedWorld, -1, 0, version)), snapshot(overview));
const cachedA = loadWorld(sharedWorld, 64, 0, version), cachedB = loadWorld(sharedWorld, 64, 0, version);
assert.equal(cachedA.objects[0].model, cachedB.objects[0].model);
assert.notEqual(cachedA.objects[0].position, cachedB.objects[0].position);
console.log(JSON.stringify({ sharedWorldGeometry: 'passed', seasonCacheIsolation: 'passed' }));

for (let season = 0; season < 4; season++) {
    const region = loadWorld(sharedWorld, -1, season, version);
    for (const name of ['c04_a00_00', 'c04_a01_00', 'm_dun0301_01_01', 'm_dun0301_02_01'])
        assert(!region.objects.some((o) => o.model.name === name), `${name} overlaps Nimbasa or Route 5`);
    assert(region.objects.some((o) => o.model.name === 'map11_13'));
    assert(region.objects.some((o) => o.model.name === 'map13_14'));
    assert(loadWorld(sharedWorld, 64, season, version).objects.some((o) => o.model.name === 'c04_a00_00'));
    assert(loadWorld(sharedWorld, 158, season, version).objects.some((o) => o.model.name === 'm_dun0301_01_01'));
}
console.log(JSON.stringify({ overlappingMapRegression: 'passed', separateParkAndRuins: 'passed' }));

const listedHeaders = new Set(locations.map(([header]) => header));
const headerData = sharedWorld.headers;
const listedMatrices = new Set(locations.map(([header]) => headerData.getUint16(header * 48 + 4, true)));
const otherVersionHeaders = version === 'Black' ? new Set([295, 424]) : new Set([0, 294]);
let outdoorHeaders = 0;
for (let header = 0; header < headerData.byteLength / 48; header++) {
    const area = headerData.getUint16(header * 48 + 2, true);
    if (sharedWorld.areas.getUint8(area * 10 + 6) !== 1 || otherVersionHeaders.has(header)) continue;
    outdoorHeaders++;
    const matrix = headerData.getUint16(header * 48 + 4, true);
    assert(listedHeaders.has(header) || matrix !== 0 && listedMatrices.has(matrix), `Outdoor header ${header} is missing from the menu`);
}
const blackCity = loadWorld(sharedWorld, 0, 0, 'Black');
const whiteForest = loadWorld(sharedWorld, 424, 0, 'White');
assert(blackCity.objects.some((o) => o.model.name === 'bc_00_00'));
assert(!whiteForest.objects.some((o) => o.model.name === 'bc_00_00'));
const blackOpelucid = loadWorld(sharedWorld, 120, 0, 'Black');
const whiteOpelucid = loadWorld(sharedWorld, 120, 0, 'White');
assert(blackOpelucid.objects.some((o) => o.model.name === 'c8_buildb_01'));
assert(!whiteOpelucid.objects.some((o) => o.model.name === 'c8_buildb_01'));
console.log(JSON.stringify({ outdoorHeaders, outdoorMenuCoverage: 'passed', blackCityAndOpelucid: 'passed' }));
