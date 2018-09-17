
// Implements Retro's MLVL format as seen in Metroid Prime 1.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";

import { ResourceSystem } from "./resource";
import * as STRG from "./strg";

export interface Area {
    areaName: string;
    areaMREAID: string;
}

export interface MLVL {
    areaTable: Area[];
    defaultSkyboxID: string;
}

function parse_MP1(resourceSystem: ResourceSystem, assetID: string, buffer: ArrayBufferSlice): MLVL {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) == 0xDEAFBABE);
    const version = view.getUint32(0x04);

    // Version that appears in Metroid Prime 1.
    assert(version === 0x11);

    // STRG file ID?
    const worldNameSTRGID = readString(buffer, 0x08, 4, false);
    const worldName: STRG.STRG = resourceSystem.loadAssetByID(worldNameSTRGID, 'STRG');

    const worldSaveID = view.getUint32(0x0C);
    const defaultSkyboxID = readString(buffer, 0x10, 4, false);

    // Memory Relay junk.
    let memoryRelayTableIdx = 0x14;
    const memoryRelayTableCount = view.getUint32(memoryRelayTableIdx + 0x00);
    memoryRelayTableIdx += 0x04;
    for (let i = 0; i < memoryRelayTableCount; i++) {
        const memoryRelayInstanceID = view.getUint32(memoryRelayTableIdx + 0x00);
        const targetInstanceID = view.getUint32(memoryRelayTableIdx + 0x04);
        const messageType = view.getUint16(memoryRelayTableIdx + 0x08);
        const active = !!view.getUint8(memoryRelayTableIdx + 0x0A);
        memoryRelayTableIdx += 0x0B;
    }

    const areaTableOffs = memoryRelayTableIdx;
    const areaTableCount = view.getUint32(areaTableOffs + 0x00);
    assert(view.getUint32(areaTableOffs + 0x04) === 0x01);
    let areaTableIdx = areaTableOffs + 0x08;
    const areaTable: Area[] = [];
    for (let i = 0; i < areaTableCount; i++) {
        const areaSTRGID = readString(buffer, areaTableIdx, 4, false);
        const areaSTRG: STRG.STRG = resourceSystem.loadAssetByID(areaSTRGID, 'STRG');
        const areaName = areaSTRG.strings[0];

        areaTableIdx += 0x04;

        areaTableIdx += 0x04 * 12; // Transform matrix
        areaTableIdx += 0x04 * 6; // AABB

        const areaMREAID = readString(buffer, areaTableIdx + 0x00, 4, false);
        const areaMREA = resourceSystem.findResourceByID(areaMREAID);
        assert(areaMREA !== null);

        const areaInternalID = view.getUint32(areaTableIdx + 0x04);
        areaTableIdx += 0x08;

        const attachedAreaCount = view.getUint32(areaTableIdx + 0x00);
        areaTableIdx += 0x04;
        for (let j = 0; j < attachedAreaCount; j++) {
            areaTableIdx += 0x02; // Attached Area Index Array
        }

        areaTableIdx += 0x04;

        const dependencyTableCount = view.getUint32(areaTableIdx);
        areaTableIdx += 0x04;
        for (let j = 0; j < dependencyTableCount; j++) {
            const dependencyID = view.getUint32(areaTableIdx + 0x00);
            const dependencyFOURCC = view.getUint32(areaTableIdx + 0x04);
            areaTableIdx += 0x08;
        }

        const dependencyOffsetTableCount = view.getUint32(areaTableIdx);
        areaTableIdx += 0x04;
        for (let j = 0; j < dependencyOffsetTableCount; j++) {
            const dependencyOffset = view.getUint32(areaTableIdx + 0x00);
            areaTableIdx += 0x04;
        }

        const dockCount = view.getUint32(areaTableIdx);
        areaTableIdx += 0x04;
        for (let j = 0; j < dockCount; j++) {
            const connectingDockCount = view.getUint32(areaTableIdx);
            areaTableIdx += 0x04;
            for (let k = 0; k < connectingDockCount; k++) {
                const connectingDockAreaIndex = view.getUint32(areaTableIdx + 0x00);
                const connectingDockDockIndex = view.getUint32(areaTableIdx + 0x04);
                areaTableIdx += 0x08;
            }
            const dockCoordinateCount = view.getUint32(areaTableIdx);
            areaTableIdx += 0x04;
            for (let k = 0; k < dockCoordinateCount; k++) {
                areaTableIdx += 0x0C; // xyz floats
            }
        }

        areaTable.push({ areaName, areaMREAID });
    }

    return { areaTable, defaultSkyboxID };
}

function parse_DKCR(resourceSystem: ResourceSystem, assetID: string, buffer: ArrayBufferSlice): MLVL {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) == 0xDEAFBABE);
    const version = view.getUint32(0x04);

    // Version that appears in Metroid Prime 1.
    assert(version === 0x1B);

    // STRG file ID?
    let offs = 0x08;
    const worldNameSTRGID = readString(buffer, offs, 0x08, false);
    offs += 0x08;
    const worldName: STRG.STRG = resourceSystem.loadAssetByID(worldNameSTRGID, 'STRG');

    const hasTimeAttack = !!view.getUint8(offs);
    offs += 0x01;

    if (hasTimeAttack) {
        const levelID = readString(buffer, offs, 0xFF, true);
        offs += levelID.length + 1;
        const timeAttackBronze = view.getFloat32(offs);
        offs += 0x04;
        const timeAttackSilver = view.getFloat32(offs);
        offs += 0x04;
        const timeAttackGold = view.getFloat32(offs);
        offs += 0x04;
        const timeAttackShiny = view.getFloat32(offs);
        offs += 0x04;
    }

    const worldSaveID = readString(buffer, offs, 0x08, false);
    offs += 0x08;
    const defaultSkyboxID = readString(buffer, offs, 0x08, false);
    offs += 0x08;

    const areaTableOffs = offs;
    const areaTableCount = view.getUint32(areaTableOffs + 0x00);
    let areaTableIdx = areaTableOffs + 0x04;
    const areaTable: Area[] = [];
    for (let i = 0; i < areaTableCount; i++) {
        // areaSTRG is empty in DKCR.
        areaTableIdx += 0x08;

        areaTableIdx += 0x04 * 12; // Transform matrix
        areaTableIdx += 0x04 * 6; // AABB

        const areaMREAID = readString(buffer, areaTableIdx + 0x00, 0x08, false);
        areaTableIdx += 0x08;
        const areaMREA = resourceSystem.findResourceByID(areaMREAID);
        assert(areaMREA !== null);

        const areaInternalID = readString(buffer, areaTableIdx + 0x00, 0x08, false);
        areaTableIdx += 0x08;

        // Always 0.
        areaTableIdx += 0x04;

        // Internal area name
        const areaName = readString(buffer, areaTableIdx, 0xFF, true);
        areaTableIdx += areaName.length;

        areaTable.push({ areaName, areaMREAID });
    }

    return { areaTable, defaultSkyboxID };
}

export function parse(resourceSystem: ResourceSystem, assetID: string, buffer: ArrayBufferSlice): MLVL {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) == 0xDEAFBABE);
    const version = view.getUint32(0x04);

    // Metroid Prime 1
    if (version === 0x11)
        return parse_MP1(resourceSystem, assetID, buffer);

    // Donkey Kong Country Returns
    if (version === 0x1B)
        return parse_DKCR(resourceSystem, assetID, buffer);

    throw "whoops";
}
