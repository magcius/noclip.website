
// Implements Retro's MLVL format as seen in Metroid Prime 1.

import { assert, assertExists } from "../util";

import { InputStream } from "./stream"
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

enum WorldVersion {
    MP1 = 0x11,
    MP2 = 0x17,
    MP3 = 0x19,
    DKCR = 0x1B
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem, assetID: string): MLVL {
    assert(stream.readUint32() == 0xDEAFBABE);
    const version: WorldVersion = stream.readUint32();

    const worldNameID = stream.readAssetID();

    if (version == WorldVersion.MP2) {
        const darkWorldNameID = stream.readAssetID();
    }

    if (version >= WorldVersion.MP2 && version <= WorldVersion.MP3) {
        const templeKeyWorldIndex = stream.readInt32();
    }

    if (version == WorldVersion.DKCR) {
        const hasTimeAttack = stream.readBool();

        if (hasTimeAttack) {
            const levelNumber = stream.readString();
            const timeAttackBronze = stream.readFloat32();
            const timeAttackSilver = stream.readFloat32();
            const timeAttackGold = stream.readFloat32();
            const timeAttackShinyGold = stream.readFloat32();
        }
    }

    const worldSaveID = stream.readAssetID();
    const defaultSkyboxID = stream.readAssetID();

    // Memory Relay junk.
    if (version == WorldVersion.MP1) {
        const memoryRelayTableCount = stream.readUint32();
        stream.skip(memoryRelayTableCount * 0xB);
    }

    // Areas
    const areaCount = stream.readUint32();

    if (version == WorldVersion.MP1)
        assert(stream.readInt32() == 1);

    const areaTable: Area[] = [];
    for (let i = 0; i < areaCount; i++) {
        const areaSTRGID = stream.readAssetID();
        const areaSTRG = resourceSystem.loadAssetByID<STRG.STRG>(areaSTRGID, 'STRG');
        let areaName = (areaSTRG !== null ? areaSTRG.strings[0] : "");

        stream.skip(4*12); // Transform matrix
        stream.skip(4*6); // AABB

        const areaMREAID = stream.readAssetID();
        const areaMREA = resourceSystem.findResourceByID(areaMREAID);
        const areaInternalID = stream.readAssetID();

        if (version <= WorldVersion.MP3) {
            const attachedAreaCount = stream.readUint32();
            stream.skip(attachedAreaCount*2);
        }

        if (version <= WorldVersion.MP2) {
            stream.skip(4);
            const dependencyTableCount = stream.readUint32();
            stream.skip(dependencyTableCount*8);
            const dependencyOffsetCount = stream.readUint32();
            stream.skip(dependencyOffsetCount*4);
        }
        
        if (version <= WorldVersion.MP3) {
            const dockCount = stream.readUint32();
            for (let j = 0; j < dockCount; j++) {
                const connectingDockCount = stream.readUint32();
                stream.skip(connectingDockCount*8);
                const coordCount = stream.readUint32();
                stream.skip(coordCount*12);
            }
        }

        if (version == WorldVersion.MP2) {
            const numModules = stream.readUint32();

            for (let j = 0; j < numModules; j++)
                stream.readString();

            const numOffsets = stream.readUint32();
            stream.skip(numOffsets*4);
        }

        if (version == WorldVersion.DKCR) {
            stream.skip(4);
        }

        if (version >= WorldVersion.MP2) {
            const internalAreaName = stream.readString();

            if (areaName.length === 0)
                areaName = "!" + internalAreaName;
        }

        areaTable.push({ areaName, areaMREAID });
    }

    return { areaTable, defaultSkyboxID };
}