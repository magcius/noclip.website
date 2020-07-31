import { UVFile, Filesystem } from "../Filesystem";
import { assert } from "../../util";
import { UVTX } from "./UVTX";

class UVTSFrame {
    //public uvtx: UVTX; // ushort uvtxIndex
    public uvtxIndex: number; // Loading UVTX directly causes infinite recursion. TODO: better solution?
    public unk_sbyte: number;
    public frameLengthUnits: number;
}

enum AnimationMode {
    PlayOnce = 0,
    Loop = 1,
    Bounce = 2
}

export class AnimationState {
    public enabled: boolean; // set to false to pause animation
    public thisSlotIsAllocated: boolean; // table is inited with a bunch of entries where this is 0, it's set to 1 when the slot is chosen to be used
    public currentFrame: number;
    public unitsUntilFrameEnds: number;
    public uvts: UVTS;
}

// UVTS aka "tseq"
// I assume this stands for "texture sequence" since that's what this is!
// For having textures that animate by cycling through a set of images
export class UVTS {
    public frames: UVTSFrame[]; // originally a pointer
    public animationMode: AnimationMode;
    public playAnimationInReverse: boolean; // if this is true, start at 0 and ++, otherwise start at the end and --
    public unitsPerSecond: number;

    constructor(uvFile: UVFile, filesystem: Filesystem) {
        assert(uvFile.chunks.length === 1);
        assert(uvFile.chunks[0].tag === 'COMM');
        const buffer = uvFile.chunks[0].buffer;
        const view = buffer.createDataView();
        let curPos = 0;

        // This seems to be a byte that tells the UVTS parser whether to load the UVTXs
        // or not. I assume it's not important?
        let unk_loadImmediately = view.getUint8(0);
        let frameCount = view.getUint8(1);
        curPos += 2;
        this.frames = [];
        for(let i = 0; i < frameCount; i++) {
            let uvtxIndex = view.getUint16(curPos);
            let frameLengthUnits = view.getFloat32(curPos + 2);
            
            //let uvtx = filesystem.getParsedFile(UVTX, "UVTX", uvtxIndex);

            this.frames.push({uvtxIndex, unk_sbyte: -1, frameLengthUnits});
            curPos += 6;
        }

        this.animationMode = view.getUint8(curPos);
        this.playAnimationInReverse = view.getUint8(curPos + 1) !== 0;
        this.unitsPerSecond = view.getFloat32(curPos + 2);
    }
}