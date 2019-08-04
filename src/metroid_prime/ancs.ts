
// Implements Retro's ANCS format as seen in Metroid Prime 1.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, align, readString } from "../util";

import { ResourceSystem } from "./resource";
import { CMDL } from "./cmdl"
import { AABB } from "../Geometry";

// minimal implementation of ANCS
export interface MetroidCharacter {
    charID: number;
    name: string;
    model: CMDL;
    skinID: string;
    skelID: string;
}

export interface ANCS {
    characters: MetroidCharacter[];
}

export function parse(resourceSystem: ResourceSystem, assetID: string, buffer: ArrayBufferSlice): ANCS {
    const view = buffer.createDataView();
    assert(view.getUint16(0x0) == 1); // ANCS version
    assert(view.getUint16(0x2) == 1); // character set version
    const numChars = view.getUint32(0x4);
    const charSet: MetroidCharacter[] = [];
    let readIdx = 0x8;

    for (let i = 0; i < numChars; i++) {
        const charID = view.getUint32(readIdx);
        const charVersion = view.getUint16(readIdx+4);
        readIdx += 6;
        const name: string = readString(buffer, readIdx);
        readIdx += name.length + 1;
        
        const modelID: string = readString(buffer, readIdx+0, 4, false);
        const skinID: string = readString(buffer, readIdx+4, 4, false);
        const skelID: string = readString(buffer, readIdx+8, 4, false);
        
        const model = resourceSystem.loadAssetByID(modelID, 'CMDL');
        const char: MetroidCharacter = { charID, name, model, skinID, skelID };
        charSet.push(char);

        // we don't really care about the rest of the data, but have to parse it to reach the next character in the set
        const numAnimNames = view.getUint32(readIdx + 0xC);
        readIdx += 0x10;

        for (let nameIdx = 0; nameIdx < numAnimNames; nameIdx++) {
            const animName: string = readString(buffer, readIdx+5);
            readIdx += animName.length + 6;
        }

        const pas4 = readString(buffer, readIdx, 4, false);
        const numAnimStates = view.getUint32(readIdx+4);
        const defaultAnimState = view.getUint32(readIdx+8);
        assert(pas4 == 'PAS4');
        readIdx += 0xC;

        for (let stateIdx = 0; stateIdx < numAnimStates; stateIdx++) {
            const parmInfoCount = view.getUint32(readIdx+4);
            const animInfoCount = view.getUint32(readIdx+8);
            readIdx += 0xC;
            
            let combinedParmSize = 0;

            for (let parmIdx = 0; parmIdx < parmInfoCount; parmIdx++) {
                const parmType = view.getUint32(readIdx);
                assert(parmType >= 0 && parmType <= 4);
                
                const parmValueSize = (parmType == 3 ? 1 : 4);
                readIdx += 0xC + (parmValueSize * 2);
                combinedParmSize += parmValueSize;
            }

            readIdx += animInfoCount * (4 + combinedParmSize);
        }
        
        const numGenericParticles = view.getUint32(readIdx);
        readIdx += (4*numGenericParticles) + 4;
        const numSwooshParticles = view.getUint32(readIdx);
        readIdx += (4*numSwooshParticles) + 4;

        if (charVersion >= 6) {
            readIdx += 4;
        }
        
        const numElectricParticles = view.getUint32(readIdx);
        readIdx += (4*numElectricParticles) + 4;    

        if (charVersion >= 10) {
            const numSpawnParticles = view.getUint32(readIdx);
            readIdx += (4*numSpawnParticles) + 4;
        }

        readIdx += 0x4;
        if (charVersion >= 10) {
            readIdx += 0x4;
        }

        if (charVersion >= 2) {
            const numAnimBounds = view.getUint32(readIdx);
            readIdx += 0x4;

            for (let animIdx = 0; animIdx < numAnimBounds; animIdx++) {
                const animName = readString(buffer, readIdx);
                readIdx += animName.length + 1;
                readIdx += 0x18;
            }

            const numEffects = view.getUint32(readIdx);
            readIdx += 4;
            
            for (let effectIdx = 0; effectIdx < numEffects; effectIdx++) {
                const effectName = readString(buffer, readIdx);
                readIdx += effectName.length + 1;
                const numComponents = view.getUint32(readIdx);
                readIdx += 4;

                for (let componentIdx = 0; componentIdx < numComponents; componentIdx++) {
                    const componentName = readString(buffer, readIdx);
                    readIdx += componentName.length + 1;
                    readIdx += 0x8;
                    const locatorBoneName = readString(buffer, readIdx);
                    readIdx += locatorBoneName.length + 1;
                    readIdx += 0xC;
                }
            }

            if (charVersion >= 4) {
                const frozenModelID = readString(buffer, readIdx, 4, false);
                const frozenSkinID = readString(buffer, readIdx+4, 4, false);
                readIdx += 8;

                if (charVersion >= 5) {
                    const animCount = view.getUint32(readIdx);
                    readIdx += (animCount * 4) + 4;

                    if (charVersion >= 10) {
                        readIdx += 5;
                        const indexedBoundsCount = view.getUint32(readIdx);
                        readIdx += (0x1C * indexedBoundsCount);
                    }
                }
            }
        }
    }

    return { characters: charSet };
}
