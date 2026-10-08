import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { MDL0Model, PAT0, TEX0, parseNSBTX } from '../nns_g3d/NNS_G3D.js';
import { assert, readString } from '../util.js';

export interface MapMatrix {
    width: number;
    height: number;
    maps: number[];
    headers: number[];
}

export function parseMatrix(buffer: ArrayBufferSlice): MapMatrix {
    const view = buffer.createDataView();
    const flags = view.getUint32(0, true);
    assert(flags === 0 || flags === 1);
    const width = view.getUint16(4, true), height = view.getUint16(6, true);
    const count = width * height;
    assert(buffer.byteLength === 8 + count * 4 * (flags + 1));
    const maps = Array.from({ length: count }, (_, i) => view.getInt32(8 + i * 4, true));
    const headers = flags === 1 ? Array.from({ length: count }, (_, i) => view.getInt32(8 + count * 4 + i * 4, true)) : maps.map(() => -1);
    return { width, height, maps, headers };
}

export function parseMap(buffer: ArrayBufferSlice) {
    const view = buffer.createDataView();
    const magic = readString(buffer, 0, 2);
    assert(['WB', 'GC', 'NG', 'RD'].includes(magic));
    const sections = view.getUint16(2, true);
    assert(sections === (magic === 'NG' ? 2 : magic === 'GC' ? 4 : 3));
    const modelStart = view.getUint32(4, true), modelEnd = view.getUint32(8, true);
    const buildingsStart = view.getUint32(sections * 4, true);
    assert(view.getUint32(sections * 4 + 4, true) === buffer.byteLength);
    assert(modelStart >= 8 + sections * 4 && modelEnd >= modelStart && buildingsStart >= modelEnd);
    const count = view.getUint32(buildingsStart, true);
    assert(buildingsStart + 4 + count * 16 === buffer.byteLength);
    const buildings = Array.from({ length: count }, (_, i) => {
        const p = buildingsStart + 4 + i * 16;
        return {
            x: view.getInt32(p, true) / 4096,
            y: view.getInt32(p + 4, true) / 4096,
            z: view.getInt32(p + 8, true) / 4096,
            rotation: view.getUint16(p + 12, true) / 65536 * Math.PI * 2,
            id: view.getUint16(p + 14, false),
        };
    });
    return { model: buffer.slice(modelStart, modelEnd), buildings };
}

export function parseBuildingPack(buffer: ArrayBufferSlice): Map<number, ArrayBufferSlice> {
    const view = buffer.createDataView();
    assert(readString(buffer, 0, 2) === 'AB');
    const count = view.getUint16(2, true);
    assert(count % 2 === 0);
    const offsets = Array.from({ length: count + 1 }, (_, i) => view.getUint32(4 + i * 4, true));
    assert(offsets[0] >= 8 + count * 4 && offsets[count] === buffer.byteLength);
    const result = new Map<number, ArrayBufferSlice>();
    for (let i = 0; i < count / 2; i++) {
        assert(offsets[i] < offsets[i + 1]);
        const index = i + count / 2;
        assert(offsets[index] < offsets[index + 1]);
        const model = buffer.slice(offsets[index], offsets[index + 1]);
        assert(readString(model, 0, 4) === 'BMD0');
        const id = view.getUint16(offsets[i], true);
        assert(!result.has(id));
        result.set(id, model);
    }
    return result;
}

export function parseArchive(buffer: ArrayBufferSlice): ArrayBufferSlice[] {
    const view = buffer.createDataView();
    assert(readString(buffer, 0, 4) === 'NARC');
    assert(view.getUint32(8, true) === buffer.byteLength);
    let fat: ArrayBufferSlice | null = null, body: ArrayBufferSlice | null = null;
    let offset = view.getUint16(12, true);
    for (let i = 0; i < view.getUint16(14, true); i++) {
        const tag = readString(buffer, offset, 4), size = view.getUint32(offset + 4, true);
        assert(size >= 8 && offset + size <= buffer.byteLength);
        if (tag === 'BTAF') fat = buffer.slice(offset + 8, offset + size);
        if (tag === 'GMIF') body = buffer.slice(offset + 8, offset + size);
        offset += size;
    }
    assert(fat !== null && body !== null && offset === buffer.byteLength);
    const table = fat!.createDataView();
    const count = table.getUint16(0, true);
    assert(fat!.byteLength === 4 + count * 8);
    return Array.from({ length: count }, (_, i) => {
        const start = table.getUint32(4 + i * 8, true), end = table.getUint32(8 + i * 8, true);
        assert(start <= end && end <= body!.byteLength);
        return body!.slice(start, end);
    });
}

export function parseBuildingMetadata(buffer: ArrayBufferSlice) {
    const view = buffer.createDataView();
    const count = view.getUint16(2, true) / 2;
    const result = new Map<number, { door: number; offset: [number, number, number]; animations: ArrayBufferSlice[] }>();
    for (let i = 0; i < count; i++) {
        const start = view.getUint32(4 + i * 4, true), end = view.getUint32(8 + i * 4, true);
        assert(end - start >= 36);
        const animations: ArrayBufferSlice[] = [];
        const mode = view.getUint8(start + 16);
        const n = mode === 1 ? view.getUint8(start + 18) : mode === 3 ? 1 : 0;
        assert(n <= 4);
        for (let j = 0; j < n; j++) {
            const offset = view.getInt32(start + 20 + j * 4, true);
            if (offset === -1) continue;
            const at = start + 16 + offset;
            assert(at >= start + 36 && at + 12 <= end);
            const size = view.getUint32(at + 8, true);
            assert(at + size <= end);
            animations.push(buffer.slice(at, at + size));
        }
        result.set(view.getUint16(start, true), { door: view.getInt16(start + 4, true),
            offset: [view.getInt16(start + 6, true), view.getInt16(start + 8, true), view.getInt16(start + 10, true)], animations });
    }
    return result;
}

export function parseAreaPatterns(buffer: ArrayBufferSlice) {
    const view = buffer.createDataView(), count = view.getUint32(0, true);
    assert(count < 64 && 8 + count * 8 <= buffer.byteLength);
    return Array.from({ length: count }, (_, i) => {
        const start = view.getUint32(4 + i * 8, true), texStart = view.getUint32(8 + i * 8, true), end = view.getUint32(12 + i * 8, true);
        assert(start >= 8 + count * 8 && start < texStart && texStart < end && end <= buffer.byteLength);
        const v = buffer.slice(start, texStart).createDataView(), n = v.getUint32(0, true);
        let p = 4;
        const frames = Array.from({ length: n }, (_, j) => v.getUint16(p + j * 2, true));
        p = (p + n * 2 + 3) & ~3;
        const texIndices = Array.from({ length: n }, (_, j) => v.getUint8(p + j));
        p = (p + n + 3) & ~3;
        const palIndices = Array.from({ length: n }, (_, j) => v.getUint8(p + j));
        p = (p + n + 3) & ~3;
        const groups = v.getUint32(p, true); p += 4;
        const offsets = Array.from({ length: groups }, (_, j) => v.getUint8(p + j)); offsets.push(n);
        p = (p + groups + 3) & ~3;
        const duration = v.getUint32(p, true), texture = parseNSBTX(buffer.slice(texStart, end)).tex0;
        assert(duration > 0);
        const tracks = Array.from({ length: groups }, (_, j) => {
            assert(offsets[j] < offsets[j + 1] && offsets[j + 1] <= n);
            return frames.slice(offsets[j], offsets[j + 1]).map((frame, k) => {
                const index = offsets[j] + k;
                const texName = texture.textures[texIndices[index]].name, plttName = texture.palettes[palIndices[index]].name;
                assert(frame <= duration);
                return { frame, texName, plttName, fullTextureName: `${texName}/${plttName}` };
            });
        });
        return { texture, duration, tracks };
    });
}

export function bindAreaPatterns(model: MDL0Model, texture: TEX0, patterns: ReturnType<typeof parseAreaPatterns>) {
    const timed: { entry: PAT0['entries'][number]; duration: number }[] = [];
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    let duration = 0;
    const textures = [...texture.textures], palettes = [...texture.palettes];
    for (const pattern of patterns) {
        for (const track of pattern.tracks) {
            const materials = model.materials.filter((m) => track.some((f) => f.texName === m.textureName));
            if (materials.length === 0) continue;
            duration = duration === 0 ? pattern.duration : duration / gcd(duration, pattern.duration) * pattern.duration;
            for (const material of materials) timed.push({ entry: { name: material.name, animationTrack: track }, duration: pattern.duration });
            for (const tex of pattern.texture.textures) if (!textures.some((t) => t.name === tex.name)) textures.push(tex);
            for (const pal of pattern.texture.palettes) if (!palettes.some((t) => t.name === pal.name)) palettes.push(pal);
        }
    }
    const entries = timed.map(({ entry, duration: period }) => ({ name: entry.name, animationTrack: Array.from({ length: duration / period }, (_, i) => entry.animationTrack.map((f) => ({ ...f, frame: f.frame + i * period }))).flat() }));
    return { texture: { ...texture, textures, palettes }, pat: entries.length ? { name: 'Area', duration, entries } : undefined };
}
