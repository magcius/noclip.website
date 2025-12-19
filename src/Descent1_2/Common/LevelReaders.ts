import { vec3 } from "gl-matrix";
import { assert } from "../../util";
import { DescentDataReader } from "./DataReader";
import {
    DescentLevelGameInfo,
    DescentSegment,
    DescentWall,
} from "./LevelTypes";

export function readSegmentConnections(
    reader: DescentDataReader,
    levelVersion: number,
    segment: DescentSegment,
    levelSegments: DescentSegment[],
    mask: number,
) {
    for (let i = 0; i < 6; ++i) {
        if (mask & (1 << i)) {
            const connectedSegmentId = reader.readInt16();
            if (connectedSegmentId >= 0) {
                segment.sides[i].connection = levelSegments[connectedSegmentId];
            } else if (connectedSegmentId === -2) {
                segment.sides[i].openFace = true;
            }
        }
    }
}

export function readSegmentVertices(
    reader: DescentDataReader,
    levelVersion: number,
    segment: DescentSegment,
    levelVertices: vec3[],
) {
    for (let i = 0; i < 8; ++i) {
        const vertexIndex = reader.readInt16();
        segment.vertices[i] = levelVertices[vertexIndex];
    }
}

export function readSegmentTextures(
    reader: DescentDataReader,
    levelVersion: number,
    segment: DescentSegment,
) {
    for (let i = 0; i < 6; ++i) {
        const side = segment.sides[i];
        if (side.mayBeRendered) {
            const rawBase = reader.readUint16();
            side.baseTextureIndex = rawBase & 0x7fff;
            if (rawBase & 0x8000) {
                const rawOverlay = reader.readUint16();
                side.overlayTextureIndex = rawOverlay & 0x3fff;
                side.overlayRotation = rawOverlay >> 14;
            } else {
                side.overlayTextureIndex = 0;
            }

            for (let j = 0; j < 4; ++j) {
                const u = reader.readInt16() / 2048.0;
                const v = reader.readInt16() / 2048.0;
                const l = reader.readUint16() / 32768.0;
                side.uvl[j] = vec3.fromValues(u, v, l);
            }
        }
    }
}

export function readSegmentWalls(
    reader: DescentDataReader,
    levelVersion: number,
    segment: DescentSegment,
) {
    const mask = reader.readUint8();
    const emptyWallNum = levelVersion < 13 ? 255 : 2047;
    for (let i = 0; i < 6; ++i) {
        if (mask & (1 << i)) {
            const wallNum =
                levelVersion < 13 ? reader.readUint8() : reader.readInt16();
            if (wallNum !== emptyWallNum) {
                segment.sides[i].wallNum = wallNum;
            }
        }
    }
}

export function readSegmentSpecial(
    reader: DescentDataReader,
    levelVersion: number,
    segment: DescentSegment,
    mask?: number,
) {
    if (mask != null) {
        // Check if mask indicates special data presence
        if (!(mask & (1 << 6))) return;
    }

    segment.special = reader.readUint8();
    segment.matcen_num = reader.readUint8();

    if (levelVersion > 5) {
        reader.offset += 1;
        segment.flags_value = reader.readUint8();
        segment.light = reader.readFix();
    } else {
        reader.offset += 2;
    }
}

export function readLevelGameInfo(
    reader: DescentDataReader,
    levelVersion: number,
): DescentLevelGameInfo {
    const gameDataSignature = reader.readUint16();
    assert(gameDataSignature === 0x6705);
    const gameDataVersion = reader.readUint16();
    assert(gameDataVersion >= 22);

    const size = reader.readInt32();
    reader.offset += 15;
    const levelNumber = reader.readInt32();
    const playerOffset = reader.readInt32();
    const playerSize = reader.readInt32();
    const objectsOffset = reader.readInt32();
    const objectsCount = reader.readInt32();
    const objectsSize = reader.readInt32();
    const wallsOffset = reader.readInt32();
    const wallsCount = reader.readInt32();
    const wallsSize = reader.readInt32();
    const doorsOffset = reader.readInt32();
    const doorsCount = reader.readInt32();
    const doorsSize = reader.readInt32();
    const triggersOffset = reader.readInt32();
    const triggersCount = reader.readInt32();
    const triggersSize = reader.readInt32();
    const linksOffset = reader.readInt32();
    const linksCount = reader.readInt32();
    const linksSize = reader.readInt32();
    const reactorTriggersOffset = reader.readInt32();
    const reactorTriggersCount = reader.readInt32();
    const reactorTriggersSize = reader.readInt32();
    const matcenOffset = reader.readInt32();
    const matcenCount = reader.readInt32();
    const matcenSize = reader.readInt32();
    let deltaLightIndicesOffset = -1;
    let deltaLightIndicesCount = 0;
    let deltaLightIndicesSize = 0;
    let deltaLightsOffset = -1;
    let deltaLightsCount = 0;
    let deltaLightsSize = 0;

    if (gameDataVersion >= 29) {
        deltaLightIndicesOffset = reader.readInt32();
        deltaLightIndicesCount = reader.readInt32();
        deltaLightIndicesSize = reader.readInt32();
        deltaLightsOffset = reader.readInt32();
        deltaLightsCount = reader.readInt32();
        deltaLightsSize = reader.readInt32();
    }

    const levelName = reader.readLevelString(36);

    return {
        version: gameDataVersion,
        size,
        levelNumber,
        playerOffset,
        playerSize,
        objectsOffset,
        objectsCount,
        objectsSize,
        wallsOffset,
        wallsCount,
        wallsSize,
        doorsOffset,
        doorsCount,
        doorsSize,
        triggersOffset,
        triggersCount,
        triggersSize,
        linksOffset,
        linksCount,
        linksSize,
        reactorTriggersOffset,
        reactorTriggersCount,
        reactorTriggersSize,
        matcenOffset,
        matcenCount,
        matcenSize,
        deltaLightIndicesOffset,
        deltaLightIndicesCount,
        deltaLightIndicesSize,
        deltaLightsOffset,
        deltaLightsCount,
        deltaLightsSize,
        levelName,
    };
}

export function readWall(reader: DescentDataReader, gameInfoVersion: number) {
    const segment_num = reader.readInt32();
    const side_num = reader.readInt32();
    const hit_points = reader.readFix();
    const linked_wall = reader.readInt32();
    const type = reader.readUint8();
    const flags =
        gameInfoVersion < 37 ? reader.readUint8() : reader.readUint16();
    const state = reader.readUint8();
    const trigger = reader.readUint8();
    const door_clip = reader.readUint8();
    const keys = reader.readUint8();
    reader.readUint8();
    const cloak_opacity = reader.readUint8();
    return new DescentWall(
        hit_points,
        linked_wall,
        type,
        flags,
        state,
        trigger,
        door_clip,
        keys,
        cloak_opacity,
    );
}
