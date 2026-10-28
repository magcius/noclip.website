import { TGRTrack } from "../data.js";
import { f } from "./f32.js";
import { TrackGate, TrackPoint, TrackSection, Vec3f, vec3 } from "./types.js";

export const TRACK_SECTION_ALTERNATE = 0x0001;
export const TRACK_SECTION_VISITED = 0x8000;
export const TRACK_SURFACE_START = 2;
export const TRACK_SURFACE_PAVED = 3;
export const TRACK_SURFACE_SLOW = 4;
export const TRACK_GATES = 10;
export const TRACK_INSTANCE_SHELTER = 0x0010;

const GRID_SIZE = 2048.0;
const GRID_CELL_SCALE = 0.03125;
const GRID_CELLS = 64;
const GRID_ROW_SHIFT = 6;
const TRACK_SECTION_ROW_EXTENDED = 2;

export interface TrackSurface {
    vertices: number[];
    instance: number;
}

export interface SimInstance {
    matrix: number[][];
    invScale: number;
    groups: number;
    hidesGroups: number;
    flags: number;
}

export interface TrackGridCursor {
    start: number;
    count: number;
}

export interface SimTrack {
    view: DataView;
    pointerBase: number;
    surfaces: TrackSurface[];
    vertices: Vec3f[];
    gridTriangles: Uint16Array;
    gridCellStarts: Uint16Array;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    startPosition: Vec3f;
    startHeading: number;
    instances: SimInstance[];
    gridInstances: Uint16Array;
    gridInstanceStarts: Uint16Array;
    rootSection: TrackSection;
    sections: TrackSection[];
    fogColor: number[];
    cameraPoints: Vec3f[];
    nearbyInstances: Uint16Array;
    triangleNearbyInstances: Uint16Array;
    triangleFlags: Uint8Array;
    gates: TrackGate[];
    gateCount: number;
}

function readVec3(view: DataView, o: number): Vec3f {
    return vec3(view.getFloat32(o), view.getFloat32(o + 4), view.getFloat32(o + 8));
}

function readU16Array(view: DataView, o: number, count: number): Uint16Array {
    const out = new Uint16Array(count);
    for (let i = 0; i < count; i++) {
        out[i] = view.getUint16(o + i * 2);
    }
    return out;
}

export function loadSimTrack(track: TGRTrack, selectedTrackId: number): SimTrack {
    const view = track.data.createDataView();
    const base = track.pointerBase;
    const offs = (p: number): number => p - base;
    const cells = GRID_CELLS * GRID_CELLS;
    const gridCellStarts = readU16Array(view, offs(view.getUint32(0x24)), cells + 1);
    const gridTriangles = readU16Array(view, offs(view.getUint32(0x20)), gridCellStarts[cells]);
    let triangleCount = view.getUint32(0x10);
    for (const index of gridTriangles) {
        if (index !== 0xffff && index >= triangleCount) {
            triangleCount = index + 1;
        }
    }
    const surfaces: TrackSurface[] = [];
    let vertexCount = 0;
    for (let i = 0; i < triangleCount; i++) {
        const o = offs(view.getUint32(0x0c)) + i * 8;
        const s = { vertices: [view.getUint16(o), view.getUint16(o + 2), view.getUint16(o + 4)], instance: view.getUint16(o + 6) };
        surfaces.push(s);
        for (const v of s.vertices) {
            vertexCount = Math.max(vertexCount, v + 1);
        }
    }
    const vertexTable = offs(view.getUint32(0x14));
    vertexCount = Math.min(vertexCount, Math.floor((track.data.byteLength - vertexTable) / 12));
    const vertices: Vec3f[] = [];
    for (let i = 0; i < vertexCount; i++) {
        vertices.push(readVec3(view, vertexTable + i * 12));
    }
    const gridInstanceStarts = readU16Array(view, offs(view.getUint32(0x6c)), cells + 1);
    const gridInstances = readU16Array(view, offs(view.getUint32(0x68)), gridInstanceStarts[cells]);

    const instances: SimInstance[] = [];
    const instanceTable = offs(view.getUint32(0x60));
    for (let i = 0; i < view.getUint32(0x64); i++) {
        const o = instanceTable + i * 0x54;
        const matrix = [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => view.getFloat32(o + (r * 4 + c) * 4)));
        instances.push({
            matrix,
            invScale: view.getFloat32(o + 0x40),
            groups: view.getUint16(o + 0x48),
            hidesGroups: view.getUint16(o + 0x4a),
            flags: view.getUint16(o + 0x4c),
        });
    }

    const sectionMap = new Map<number, TrackSection>();
    const parseSection = (address: number): TrackSection => {
        const existing = sectionMap.get(address);
        if (existing !== undefined) {
            return existing;
        }
        const o = offs(address);
        const pointCount = view.getUint16(o + 0x14);
        const points: TrackPoint[] = [];
        for (let i = 0; i <= pointCount; i++) {
            const p = o + 0x40 + i * 0x28;
            points.push({ left: readVec3(view, p), position: readVec3(view, p + 0x0c), right: readVec3(view, p + 0x18), distance: view.getFloat32(p + 0x24) });
        }
        const section: TrackSection = {
            address,
            child: null,
            next: null,
            gridMinX: view.getUint8(o + 0x10),
            gridMinY: view.getUint8(o + 0x11),
            gridMaxX: view.getUint8(o + 0x12),
            gridMaxY: view.getUint8(o + 0x13),
            pointCount,
            flags: view.getUint16(o + 0x16),
            points,
        };
        sectionMap.set(address, section);
        const child = view.getUint32(o);
        const next = view.getUint32(o + 4);
        section.child = child !== 0 ? parseSection(child) : null;
        section.next = next !== 0 ? parseSection(next) : null;
        return section;
    };
    const sections: TrackSection[] = [];
    const sectionTable = offs(view.getUint32(0x78));
    for (let i = 0; i < view.getInt32(0x7c); i++) {
        sections.push(parseSection(view.getUint32(sectionTable + i * 4)));
    }
    const rootSection = parseSection(view.getUint32(0x70));

    const cameraPoints: Vec3f[] = [];
    const cameraTable = offs(view.getUint32(0x84));
    for (let i = 0; i < view.getInt32(0x88); i++) {
        cameraPoints.push(readVec3(view, cameraTable + i * 12));
    }
    const triangleNearbyInstances = readU16Array(view, offs(view.getUint32(0x90)), triangleCount);
    let nearbyLength = 0;
    const nearbyTable = offs(view.getUint32(0x8c));
    const nearbyLimit = (view.byteLength - nearbyTable) >> 1;
    triangleNearbyInstances.forEach((start) => {
        let j = start;
        if (j >= nearbyLimit) {
            return;
        }
        while (j + 1 < nearbyLimit && view.getUint16(nearbyTable + j * 2) !== 0) {
            j++;
        }
        nearbyLength = Math.max(nearbyLength, j + 1);
    });
    const nearbyInstances = readU16Array(view, nearbyTable, nearbyLength);
    const flagsTable = offs(view.getUint32(0x94));
    const triangleFlags = new Uint8Array(triangleCount);
    for (let i = 0; i < triangleCount; i++) {
        triangleFlags[i] = view.getUint8(flagsTable + i);
    }
    const gates: TrackGate[] = [];
    for (let i = 0; i < TRACK_GATES; i++) {
        const o = 0x98 + i * 0x14;
        gates.push({
            ends: [
                { x: view.getFloat32(o), y: view.getFloat32(o + 4) },
                { x: view.getFloat32(o + 8), y: view.getFloat32(o + 12) },
            ],
            seconds: view.getFloat32(o + 16),
        });
    }

    const simTrack: SimTrack = {
        view,
        pointerBase: base,
        surfaces,
        vertices,
        gridTriangles,
        gridCellStarts,
        minX: view.getFloat32(0x28),
        maxX: view.getFloat32(0x2c),
        minZ: view.getFloat32(0x38),
        maxZ: view.getFloat32(0x3c),
        startPosition: readVec3(view, 0x40),
        startHeading: view.getFloat32(0x4c),
        instances,
        gridInstances,
        gridInstanceStarts,
        rootSection,
        sections,
        fogColor: [view.getUint8(0x80), view.getUint8(0x81), view.getUint8(0x82)],
        cameraPoints,
        nearbyInstances,
        triangleNearbyInstances,
        triangleFlags,
        gates,
        gateCount: view.getInt32(0x160),
    };
    prepareInstances(simTrack);
    PrepareTrackSections(simTrack, selectedTrackId);
    return simTrack;
}

function prepareInstances(track: SimTrack): void {
    for (const instance of track.instances) {
        const m = instance.matrix;
        const x = f(f(1 * m[0][0]) + f(0 * m[1][0]));
        const ax = f(x + f(0 * m[2][0]));
        const ay = f(f(f(1 * m[0][1]) + f(0 * m[1][1])) + f(0 * m[2][1]));
        const az = f(f(f(1 * m[0][2]) + f(0 * m[1][2])) + f(0 * m[2][2]));
        const length = f(Math.sqrt(f(f(az * az) + f(f(ax * ax) + f(ay * ay)))));
        if (length === 0) {
            continue;
        }
        instance.invScale = f(1 / length);
    }
}

function MarkTrackSections(section: TrackSection | null, selectedTrackId: number): void {
    for (; section !== null; section = section.next) {
        if (section.flags & TRACK_SECTION_VISITED) {
            continue;
        }
        if (section.flags & TRACK_SECTION_ALTERNATE) {
            continue;
        }
        section.flags |= TRACK_SECTION_VISITED;
        if (section.gridMinY === TRACK_SECTION_ROW_EXTENDED && (selectedTrackId === 3 || selectedTrackId === 8)) {
            section.gridMinY = 0;
        }
        MarkTrackSections(section.child, selectedTrackId);
    }
}

function UnmarkTrackSections(section: TrackSection | null): void {
    for (; section !== null; section = section.next) {
        if (section.flags & TRACK_SECTION_VISITED) {
            section.flags &= ~TRACK_SECTION_VISITED & 0xffff;
            UnmarkTrackSections(section.child);
        }
    }
}

export function PrepareTrackSections(track: SimTrack, selectedTrackId: number): void {
    MarkTrackSections(track.rootSection, selectedTrackId);
    UnmarkTrackSections(track.rootSection);
}

function PackGridCell(starts: Uint16Array, column: number, row: number): number {
    const cell = (column + (row << GRID_ROW_SHIFT)) & 0xffff;
    const start = starts[cell];
    return ((((starts[(cell + 1) & 0xffff] - start) & 0xffff) << 16) | start) >>> 0;
}

function IsOnGrid(x: number, y: number): boolean {
    return !(x < 0 || GRID_SIZE <= x || y < 0 || GRID_SIZE <= y);
}

function IsGridCell(column: number, row: number): boolean {
    return column >= 0 && column < GRID_CELLS && row >= 0 && row < GRID_CELLS;
}

export function LookupTrackGridCell(track: SimTrack, x: number, y: number): number {
    if (!IsOnGrid(x, y)) {
        return 0;
    }
    return PackGridCell(track.gridCellStarts, Math.trunc(f(x * GRID_CELL_SCALE)) & 0xff, Math.trunc(f(y * GRID_CELL_SCALE)) & 0xff);
}

export function LookupInstanceCellAtPoint(track: SimTrack, x: number, y: number): number {
    if (!IsOnGrid(x, y)) {
        return 0;
    }
    return PackGridCell(track.gridInstanceStarts, Math.trunc(f(x * GRID_CELL_SCALE)) & 0xff, Math.trunc(f(y * GRID_CELL_SCALE)) & 0xff);
}

export function FindTrackGridCellByIndex(track: SimTrack, column: number, row: number): number {
    if (!IsGridCell(column, row)) {
        return 0;
    }
    return PackGridCell(track.gridCellStarts, column, row);
}

export function LookupInstanceGridCell(track: SimTrack, column: number, row: number): number {
    if (!IsGridCell(column, row)) {
        return 0;
    }
    return PackGridCell(track.gridInstanceStarts, column, row);
}

function AdvanceGridCursor(cursor: TrackGridCursor): number {
    const start = cursor.start;
    const packed = ((start + 1) & 0xffff) | (((cursor.count - 1) & 0xffff) << 16);
    cursor.count = (packed >>> 16) & 0xffff;
    cursor.start = packed & 0xffff;
    return start;
}

export function NextGridCellTriangle(track: SimTrack, cursor: TrackGridCursor): number {
    if (cursor.count === 0) {
        return 0;
    }
    return track.gridTriangles[AdvanceGridCursor(cursor)];
}

export function NextGridCellInstance(track: SimTrack, cursor: TrackGridCursor): number {
    if (cursor.count === 0) {
        return 0;
    }
    return track.gridInstances[AdvanceGridCursor(cursor)];
}

export function gridCursor(found: number): TrackGridCursor {
    return { start: found & 0xffff, count: (found >>> 16) & 0xffff };
}
