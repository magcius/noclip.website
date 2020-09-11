
import ArrayBufferSlice from "../../ArrayBufferSlice";

const enum RelocationOp {
    R_INVALID = -1,
    R_PPC_NONE = 0,
    R_PPC_ADDR32 = 1,
    R_PPC_ADDR24 = 2,
    R_PPC_ADDR16 = 3,
    R_PPC_ADDR16_LO = 4,
    R_PPC_ADDR16_HI = 5,
    R_PPC_ADDR16_HA = 6,
    R_PPC_ADDR14 = 7,
    R_PPC_ADDR14_BRTAKEN = 8,
    R_PPC_ADDR14_BRNTAKEN = 9,
    R_PPC_REL24 = 10,
    R_PPC_REL14 = 11,
    R_DOLPHIN_NOP = 201,
    R_DOLPHIN_SECTION = 202,
    R_DOLPHIN_END = 203,
}

export function linkREL(buffer: ArrayBufferSlice, baseAddress: number): void {
    const view = buffer.createDataView();
    const relID = view.getUint32(0x00);
    const sectionTableCount = view.getUint32(0x0C);
    let sectionTableOffs = view.getUint32(0x10);

    const importTableOffs = view.getUint32(0x28);
    const importTableSize = view.getUint32(0x2C);

    if (importTableSize === 0) {
        // Nothing to do.
        return;
    }

    const sectionOffsets: number[] = [];
    for (let i = 0; i < sectionTableCount; i++) {
        const sectionOffs = view.getUint32(sectionTableOffs + 0x00);
        sectionOffsets.push(sectionOffs);
        sectionTableOffs += 0x08;
    }

    for (let importTableIdx = importTableOffs; importTableIdx < importTableOffs + importTableSize; importTableIdx += 0x08) {
        const importRelID = view.getUint32(importTableIdx + 0x00);
        const importRelocOffs = view.getUint32(importTableIdx + 0x04);

        // Process reloc data
        let relocIdx = importRelocOffs;
        let relOffs = 0;
        let relSectIdx = 0;
        while (true) {
            const opSkip = view.getUint16(relocIdx + 0x00);
            const op = view.getUint8(relocIdx + 0x02);
            const targetSection = view.getUint8(relocIdx + 0x03);
            const addend = view.getUint32(relocIdx + 0x04);

            relOffs += opSkip;

            const effectiveOffs = sectionOffsets[relSectIdx] + relOffs;

            let relocAddress: number;
            if (importRelID === relID) {
                // If this is a self-relocation, the address is relative to our data.
                relocAddress = baseAddress + sectionOffsets[targetSection] + addend;
            } else {
                // Otherwise, this is a DOL, where the address is absolute.
                relocAddress = addend;
            }

            if (op === RelocationOp.R_DOLPHIN_SECTION) {
                // Change section.
                relSectIdx = targetSection;
                relOffs = 0;
            } else if (op === RelocationOp.R_PPC_ADDR32) {
                view.setUint32(effectiveOffs, relocAddress);
            } else if (op === RelocationOp.R_PPC_ADDR16_LO) {
                view.setUint16(effectiveOffs, relocAddress & 0xFFFF);
            } else if (op === RelocationOp.R_PPC_ADDR16_HA) {
                if (!!(relocAddress & 0x8000))
                    relocAddress += 0x00010000;

                view.setUint16(effectiveOffs, (relocAddress >>> 16) & 0xFFFF);
            } else if (op === RelocationOp.R_PPC_REL24) {
                const rel = addend - (effectiveOffs + baseAddress);
                const orig = view.getUint32(effectiveOffs);
                const v = (orig & 0xFC000003) | (rel & 0x03FFFFFC);
                view.setUint32(effectiveOffs, v);
            } else if (op === RelocationOp.R_DOLPHIN_END) {
                break;
            } else {
                throw "whoops";
            }

            relocIdx += 0x08;
        }
    }

    // We've linked the REL, so clear the import tables to ensure that we don't re-link it further.

    // Relocation table offst
    view.setUint32(0x24, 0);

    // Import table offset
    view.setUint32(0x28, 0);

    // Import table size
    view.setUint32(0x2C, 0);
}
