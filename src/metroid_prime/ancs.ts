
// Implements Retro's ANCS format as seen in Metroid Prime 1.

import { assert } from "../util";

import { ResourceSystem } from "./resource";
import { CMDL } from "./cmdl"
import { InputStream } from "./stream";

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

export function parse(stream: InputStream, resourceSystem: ResourceSystem, assetID: string): ANCS {
    assert(stream.readUint16() == 1); // ANCS version
    assert(stream.readUint16() == 1); // character set version
    const numChars = stream.readUint32();
    const charSet: MetroidCharacter[] = [];

    for (let i = 0; i < numChars; i++) {
        const charID = stream.readUint32();
        const charVersion = stream.readUint16();
        const name = stream.readString();
        const modelID = stream.readAssetID();
        const skinID = stream.readAssetID();
        const skelID = stream.readAssetID();

        const model = resourceSystem.loadAssetByID<CMDL>(modelID, 'CMDL');
        const char: MetroidCharacter = { charID, name, model, skinID, skelID };
        charSet.push(char);

        // we don't really care about the rest of the data, but have to parse it to reach the next character in the set
        const numAnimNames = stream.readUint32();

        for (let nameIdx = 0; nameIdx < numAnimNames; nameIdx++) {
            const animID = stream.readUint32();
            if (charVersion < 10) {
                const unk = stream.readString();
            }
            const animName = stream.readString();
        }

        const pas4 = stream.readFourCC();
        const numAnimStates = stream.readUint32();
        const defaultAnimState = stream.readUint32();
        assert(pas4 == 'PAS4');

        for (let stateIdx = 0; stateIdx < numAnimStates; stateIdx++) {
            stream.skip(4);
            const parmInfoCount = stream.readUint32();
            const animInfoCount = stream.readUint32();
            
            let combinedParmSize = 0;

            for (let parmIdx = 0; parmIdx < parmInfoCount; parmIdx++) {
                const parmType = stream.readUint32();
                assert(parmType >= 0 && parmType <= 4);
                
                const parmValueSize = (parmType == 3 ? 1 : 4);
                stream.skip(8);
                stream.skip(parmValueSize * 2);
                combinedParmSize += parmValueSize;
            }

            stream.skip(animInfoCount * (4 + combinedParmSize));
        }
        
        const numGenericParticles = stream.readUint32();
        stream.skip(4*numGenericParticles);
        const numSwooshParticles = stream.readUint32();
        stream.skip(4*numSwooshParticles);

        if (charVersion >= 6) {
            stream.skip(4);
        }
        
        const numElectricParticles = stream.readUint32();
        stream.skip(4*numElectricParticles);

        if (charVersion >= 10) {
            const numSpawnParticles = stream.readUint32();
            stream.skip(4*numSpawnParticles);
        }

        stream.skip(4);
        if (charVersion >= 10) {
            stream.skip(4);
        }

        if (charVersion >= 2) {
            const numAnimBounds = stream.readUint32();

            for (let animIdx = 0; animIdx < numAnimBounds; animIdx++) {
                const animName = stream.readString();
                stream.skip(0x18);
            }

            const numEffects = stream.readUint32();
            
            for (let effectIdx = 0; effectIdx < numEffects; effectIdx++) {
                const effectName = stream.readString();
                const numComponents = stream.readUint32();

                for (let componentIdx = 0; componentIdx < numComponents; componentIdx++) {
                    const componentName = stream.readString();
                    stream.skip(8);
                    // Bone name in MP1, bone ID in MP2
                    if (charVersion >= 10) {
                        stream.skip(4);
                    }
                    else {
                        const locatorBoneName = stream.readString();
                    }   
                    stream.skip(12);
                }
            }

            if (charVersion >= 4) {
                const frozenModelID = stream.readAssetID();
                const frozenSkinID = stream.readAssetID();

                if (charVersion >= 5) {
                    const animCount = stream.readUint32();
                    stream.skip(animCount * 4);

                    if (charVersion >= 10) {
                        stream.skip(5);
                        const indexedBoundsCount = stream.readUint32();
                        stream.skip(0x1C * indexedBoundsCount);
                    }
                }
            }
        }
    }

    return { characters: charSet };
}
