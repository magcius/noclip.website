
// Implements Retro's MLVL format as seen in Metroid Prime 1.

import { ResourceSystem } from "./resource";
import { assert, readString } from "../util";
import ArrayBufferSlice from "ArrayBufferSlice";

interface Area {
    areaSTRGID: string;
    areaMREAID: string;
}

export interface MLVL {
    areaTable: Area[];
}

export function parse(resourceSystem: ResourceSystem, assetID: string, buffer: ArrayBufferSlice): MLVL {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) == 0xDEAFBABE);
    const version = view.getUint32(0x04);

    // Version that appears in Metroid Prime 1.
    assert(version === 0x11);

    // STRG file ID?
    const worldNameSTRGID = readString(buffer, 0x08, 4, false);
    const worldNameSTRG = resourceSystem.findResourceByID(worldNameSTRGID);
    resourceSystem.loadAssetByID(worldNameSTRGID, 'STRG');

    const worldSaveID = view.getUint32(0x0C);
    const skyboxID = view.getUint32(0x10);

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
        const areaSTRG = resourceSystem.findResourceByID(areaSTRGID);
        assert(areaSTRG !== null);

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

        // TODO(jstpierre): Verify with Aruki. Seems to be undocumented?
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

        areaTable.push({ areaSTRGID, areaMREAID });
    }

    return { areaTable };
}
