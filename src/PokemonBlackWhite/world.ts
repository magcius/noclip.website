import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { MDL0Model, TEX0, SRT0, PAT0, parseNSBTP, parseNSBTX } from '../nns_g3d/NNS_G3D.js';
import { assert, assertExists } from '../util.js';
import { bindAreaPatterns, parseAreaPatterns, parseArchive, parseBuildingMetadata, parseBuildingPack, parseMap, parseMatrix } from './bin.js';
import { JointAnimation, parseJointAnimation } from './nsbca.js';
import { parseModel } from './nsbmd.js';
import { parseTextureAnimation } from './nsbta.js';

export const archiveNames = ['maps.narc', 'matrices.narc', 'headers.narc', 'areas.bin', 'terrain_textures.narc', 'buildings.narc', 'building_textures.narc', 'map_changes.narc', 'texture_animations.narc', 'pattern_animations.narc', 'entities.narc'];

export type GameVersion = 'Black' | 'White';

export interface WorldObject {
    model: MDL0Model;
    texture: TEX0;
    position: [number, number, number];
    rotation: number;
    srt?: SRT0;
    pat?: PAT0;
    joint?: JointAnimation;
}

function compatible(model: MDL0Model, tex: TEX0): boolean {
    return model.materials.every((m) =>
        (m.textureName === null || tex.textures.some((t) => t.name === m.textureName)) &&
        (m.paletteName === null || tex.palettes.some((p) => p.name === m.paletteName)));
}

export class WorldData {
    public maps: ArrayBufferSlice[];
    public matrices: ArrayBufferSlice[];
    public headers: DataView;
    public areas: DataView;
    public terrainTextures: TEX0[];
    public packs: ReturnType<typeof parseBuildingPack>[];
    public metadata: ReturnType<typeof parseBuildingMetadata>[];
    public animations: SRT0[];
    public buildingTextures: TEX0[];
    public changes: DataView;
    public patterns: ReturnType<typeof parseAreaPatterns>[];
    public entities: ArrayBufferSlice[];
    private parsedMaps = new Map<number, ReturnType<typeof parseMap>>();
    private parsedModels = new Map<ArrayBufferSlice, ReturnType<typeof parseModel>>();
    private buildingAnimations = new Map<ArrayBufferSlice[], Pick<WorldObject, 'srt' | 'pat' | 'joint'>>();

    constructor(data: ArrayBufferSlice[]) {
        assert(data.length === archiveNames.length);
        this.maps = parseArchive(data[0]);
        this.matrices = parseArchive(data[1]);
        this.headers = parseArchive(data[2])[0].createDataView();
        this.areas = data[3].createDataView();
        this.terrainTextures = parseArchive(data[4]).map((b) => parseNSBTX(b).tex0);
        this.packs = parseArchive(data[5]).map(parseBuildingPack);
        this.metadata = parseArchive(data[5]).map(parseBuildingMetadata);
        this.buildingTextures = parseArchive(data[6]).map((b) => parseNSBTX(b).tex0);
        this.changes = parseArchive(data[7])[0].createDataView();
        this.animations = parseArchive(data[8]).map((b) => parseTextureAnimation(b).srt0);
        this.patterns = parseArchive(data[9]).map(parseAreaPatterns);
        this.entities = parseArchive(data[10]);
    }

    public getMap(id: number) {
        if (!this.parsedMaps.has(id)) this.parsedMaps.set(id, parseMap(assertExists(this.maps[id])));
        return this.parsedMaps.get(id)!;
    }

    public getModel(buffer: ArrayBufferSlice) {
        if (!this.parsedModels.has(buffer)) this.parsedModels.set(buffer, parseModel(buffer));
        return this.parsedModels.get(buffer)!;
    }

    public getBuildingAnimations(animations: ArrayBufferSlice[]) {
        if (!this.buildingAnimations.has(animations)) {
            const result: Pick<WorldObject, 'srt' | 'pat' | 'joint'> = {};
            for (const animation of animations) {
                const tag = animation.createDataView().getUint32(0, false);
                if (tag === 0x42434130) result.joint = parseJointAnimation(animation);
                if (tag === 0x42544130) result.srt = parseTextureAnimation(animation).srt0;
                if (tag === 0x42545030) result.pat = parseNSBTP(animation).pat0[0];
            }
            this.buildingAnimations.set(animations, result);
        }
        return this.buildingAnimations.get(animations)!;
    }

    public destroy(): void {
        this.parsedMaps.clear();
        this.parsedModels.clear();
        this.buildingAnimations.clear();
    }
}

export function loadWorld(data: ArrayBufferSlice[] | WorldData, selectedHeader = -1, season = 0, version: GameVersion = 'White') {
    assert(Number.isInteger(season) && season >= 0 && season <= 3);
    assert(version === 'Black' || version === 'White');
    const shared = data instanceof WorldData ? data : new WorldData(data);
    const { matrices, headers, areas, terrainTextures, packs, metadata, animations, buildingTextures, changes, patterns, entities } = shared;
    assert(changes.byteLength % 16 === 0);
    let matrixId = selectedHeader < 0 ? 0 : headers.getUint16(selectedHeader * 48 + 4, true);
    const type = selectedHeader < 0 ? 0 : headers.getUint8(selectedHeader * 48);
    const span = type === 1 ? 2048 : type === 5 ? 1024 : 512;
    for (let p = 0; p < changes.byteLength; p += 16) {
        if (changes.getUint16(p, true) !== matrixId || changes.getUint8(p + 2) !== 1) continue;
        const condition = changes.getUint8(p + 3);
        const index = condition === 0 ? season : condition === 1 ? (version === 'White' ? 1 : 0) : condition === 2 ? season + (version === 'White' ? 1 : 0) : 0;
        matrixId = changes.getUint16(p + 4 + index * 2, true);
        break;
    }
    const matrix = parseMatrix(assertExists(matrices[matrixId]));
    const replacements = new Map<number, number>();
    for (let p = 0; p < changes.byteLength; p += 16) {
        if (changes.getUint16(p, true) !== matrixId) continue;
        const kind = changes.getUint16(p + 2, true);
        const original = changes.getUint16(p + 4, true);
        if (kind === 0) replacements.set(original, changes.getUint16(p + 4 + season * 2, true));
        if (kind === 256 && version === 'White') replacements.set(original, changes.getUint16(p + 6, true));
    }
    const objects: WorldObject[] = [];
    const add = (buffer: ArrayBufferSlice, tex: TEX0, x: number, y: number, z: number, rotation = 0, srt?: SRT0, pat?: PAT0, joint?: JointAnimation) => {
        const bmd = shared.getModel(buffer);
        for (const model of bmd.models) {
            const texture = bmd.tex0 ?? tex;
            assert(compatible(model, texture), `Missing textures for ${model.name}`);
            objects.push({ model, texture, position: [x, y, z], rotation, srt, pat, joint });
        }
    };
    const anchorCells = matrix.headers.flatMap((h, i) => h >= 0 ? [i] : []);
    const activeCells: number[] = [];
    for (let i = 0; i < matrix.maps.length; i++) {
        const mapId = replacements.get(matrix.maps[i]) ?? matrix.maps[i];
        if (mapId < 0) continue;
        const x = i % matrix.width, z = Math.floor(i / matrix.width);
        let header = matrix.headers[i];
        if (header < 0 && anchorCells.length > 0) {
            const nearest = anchorCells.reduce((a, b) => {
                const distance = (j: number) => (j % matrix.width - x) ** 2 + (Math.floor(j / matrix.width) - z) ** 2;
                return distance(a) <= distance(b) ? a : b;
            });
            header = matrix.headers[nearest];
        }
        if (header < 0) header = selectedHeader;
        assert(header >= 0 && (header + 1) * 48 <= headers.byteLength);
        const baseArea = headers.getUint16(header * 48 + 2, true);
        const seasonal = baseArea >= 2 && baseArea < 210;
        let area = baseArea + (seasonal ? season : 0);
        assert((area + 1) * 10 <= areas.byteLength);
        const map = shared.getMap(mapId);
        const model = shared.getModel(map.model).models[0];
        const packForArea = (a: number) => a >= 210 ? a - 210 : Math.max(0, Math.floor((a - 2) / 4));
        const matches = (a: number) => {
            const p = packs[packForArea(a)];
            return p !== undefined && compatible(model, terrainTextures[areas.getUint16(a * 10 + 2, true)]);
        };
        if (!matches(area)) {
            assert(matrix.headers[i] === -1, `Area mismatch for header ${header}, map ${mapId}`);
            const candidates = Array.from({ length: areas.byteLength / 10 }, (_, a) => a).filter((a) => areas.getUint8(a * 10 + 6) === 1 && matches(a));
            area = assertExists(candidates.find((a) => a >= 2 && a < 210 && (a - 2) % 4 === season) ?? candidates[0], `No area for map ${mapId}`);
        }
        const textureIndex = areas.getUint16(area * 10 + 2, true);
        const packIndex = area >= 210 ? area - 210 : Math.max(0, Math.floor((area - 2) / 4));
        let texture = assertExists(terrainTextures[textureIndex]);
        if (!compatible(model, texture))
            texture = assertExists(terrainTextures.find((t) => compatible(model, t)));
        const patIndex = areas.getUint8(area * 10 + 5);
        const animated = bindAreaPatterns(model, texture, patIndex === 255 ? [] : assertExists(patterns[patIndex]));
        const srtIndex = areas.getUint8(area * 10 + 4);
        add(map.model, animated.texture, (x + 0.5) * span, 0, (z + 0.5) * span, 0, srtIndex === 255 ? undefined : assertExists(animations[srtIndex]), animated.pat);
        const pack = assertExists(packs[packIndex]);
        const addBuilding = (id: number, bx: number, by: number, bz: number, rotation: number, door = false) => {
            const buffer = assertExists(pack.get(id), `Missing building ${id}, pack ${packIndex}, map ${mapId}`);
            const meta = assertExists(metadata[packIndex].get(id));
            const { srt, pat, joint } = shared.getBuildingAnimations(meta.animations);
            add(buffer, buildingTextures[packIndex], bx, by, bz, rotation, srt, pat, joint);
            if (!door && meta.door !== -1) {
                const [dx, dy, dz] = meta.offset;
                addBuilding(meta.door, bx + dx, by + dy, bz + dz, rotation, true);
            }
        };
        const buildingRecords = matrix.headers[i] < 0 && !map.buildings.every((b) => pack.has(b.id)) ? [] : map.buildings;
        for (const building of buildingRecords)
            addBuilding(building.id, (x + 0.5) * span + building.x, building.y, (z + 0.5) * span - building.z, building.rotation);
        if (selectedHeader < 0 || matrix.headers[i] === selectedHeader || matrixId !== 0) activeCells.push(i);
    }
    assert(activeCells.length > 0);
    const target: [number, number, number] = [activeCells.reduce((s, i) => s + i % matrix.width, 0) / activeCells.length * span + span / 2, 0,
        activeCells.reduce((s, i) => s + Math.floor(i / matrix.width), 0) / activeCells.length * span + span / 2];
    const distance = selectedHeader < 0 ? 10500 : matrixId === 0 ? 850 : Math.max(700, Math.min(4500, Math.max(matrix.width, matrix.height) * span * 0.8));
    if (matrixId === 0) {
        const getWarp = (h: number, index: number) => {
            const v = entities[headers.getUint16(h * 48 + 22, true)].createDataView();
            assert(index < v.getUint8(6));
            const p = 8 + v.getUint8(4) * 20 + v.getUint8(5) * 36 + index * 20;
            assert(p + 20 <= v.byteLength && v.getUint16(p + 6, true) === 0);
            return { header: v.getUint16(p, true), index: v.getUint16(p + 2, true),
                x: v.getInt16(p + 8, true), y: v.getInt16(p + 10, true), z: v.getInt16(p + 12, true) };
        };
        const placed = new Map<number, [number, number, number]>([[0, [0, 0, 0]]]);
        for (const [header, entrance] of [[155, 0], [346, 0], [376, 0], [385, 0], [156, 0], [152, 2], [206, 0], ...Array.from({ length: 9 }, (_, i) => [356 + i, 0])]) {
            const source = getWarp(header, entrance), destination = getWarp(source.header, source.index);
            assert(destination.header === header);
            const parent = assertExists(placed.get(headers.getUint16(source.header * 48 + 4, true)));
            const offset: [number, number, number] = [parent[0] + destination.x - source.x, parent[1] + destination.y - source.y, parent[2] + destination.z - source.z];
            placed.set(headers.getUint16(header * 48 + 4, true), offset);
            for (const object of loadWorld(shared, header, season, version).objects) {
                object.position = [object.position[0] + offset[0], object.position[1] + offset[1], object.position[2] + offset[2]];
                objects.push(object);
            }
        }
    }
    return { objects, target, distance };
}

const locations: [number, string][] = [
    [389, 'Nuvema Town'], [397, 'Accumula Town'], [6, 'Striaton City'], [16, 'Nacrene City'],
    [28, 'Castelia City'], [62, 'Nimbasa City'], [96, 'Driftveil City'], [107, 'Mistralton City'],
    [113, 'Icirrus City'], [120, 'Opelucid City'], [406, 'Lacunosa Town'], [412, 'Undella Town'],
    [249, 'Skyarrow Bridge'], [253, 'Driftveil Drawbridge'], [254, 'Tubeline Bridge'], [255, 'Village Bridge'],
    [263, 'Marvelous Bridge'], [279, 'Entralink'], [235, 'Liberty Garden'], [238, 'P2 Laboratory'],
    [317, 'Route 1'], [319, 'Route 2'], [321, 'Route 3'], [326, 'Route 4'], [329, 'Route 5'],
    [331, 'Route 6'], [337, 'Route 7'], [345, 'Route 8'], [348, 'Route 9'], [355, 'Route 10'],
    [365, 'Route 11'], [368, 'Route 12'], [370, 'Route 13'], [374, 'Route 14'], [378, 'Route 15'],
    [383, 'Route 16'], [423, 'Route 17'], [387, 'Route 18'], [154, 'Pinwheel Forest'], [157, 'Desert Resort'],
    [191, 'Cold Storage'], [194, 'Chargestone Cave (Exterior)'], [198, 'Twist Mountain (Exterior)'], [205, 'Dragonspiral Tower (Exterior)'],
    [230, 'Giant Chasm (Exterior)'], [240, 'Undella Bay'],
    [424, 'White Forest'], [155, 'Pinwheel Forest (Inner Forest)'], [158, 'Desert Resort (Ruins)'],
    [136, 'Pokémon League (Approach)'], [139, 'Pokémon League (Summit)'], [214, 'Victory Road (Exterior)'],
    [232, 'Giant Chasm (Crater)'], [233, 'Giant Chasm (Snowy Crater)'], [346, 'Moor of Icirrus'],
    [376, 'Abundant Shrine'], [385, 'Lostlorn Forest'], [156, 'Rumination Field'],
    [280, 'Entree Forest'],
    ...Array.from({ length: 8 }, (_, i): [number, string] => [281 + i, `Entree Forest (Area ${281 + i})`]),
    [289, 'Entralink (Other World)'], [250, 'Bridge Gate (Skyarrow Bridge)'], [147, 'Unity Tower (Island)'],
    [64, 'Nimbasa City (Amusement Park)'], [152, 'Dreamyard'], [199, 'Twist Mountain (Courtyard)'],
    [206, 'Dragonspiral Tower (Entrance)'], [342, 'Celestial Tower (Rooftop)'], [418, 'Anville Town'],
    ...Array.from({ length: 11 }, (_, i): [number, string] => [30 + i, `Castelia City (Area ${30 + i})`]),
    [137, 'Pokémon League (Courtyard)'], [138, 'Pokémon League (Upper Courtyard)'],
    ...Array.from({ length: 9 }, (_, i): [number, string] => [356 + i, `Route 10 (Badge Gate ${i + 1})`]),
];

export function getLocations(version: GameVersion): [number, string][] {
    return locations.map(([header, name]) => version === 'Black' && header === 424 ? [0, 'Black City'] : [header, name]);
}
