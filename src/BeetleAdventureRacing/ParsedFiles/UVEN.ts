import { Filesystem, UVFile } from "../Filesystem";
import { assert } from "../../util";
import { UVMD } from "./UVMD";

export class UVEN {
    public clearR: number;
    public clearG: number;
    public clearB: number;
    public fogR: number;
    public fogG: number;
    public fogB: number;

    public shouldClearScreen: boolean;



    // TODO: actual state
    public uvmds: UVMD[] = [];

    constructor(uvFile: UVFile, filesystem: Filesystem) {
        assert(uvFile.chunks.length === 1);
        assert(uvFile.chunks[0].tag === 'COMM');
        const view = uvFile.chunks[0].buffer.createDataView();
        let curPos = 0;
        // read first 0x60 bytes
        this.clearR = view.getUint8(0);
        this.clearG = view.getUint8(1);
        this.clearB = view.getUint8(2);
        this.fogR = view.getUint8(3);
        this.fogG = view.getUint8(4);
        this.fogB = view.getUint8(5);

        this.shouldClearScreen = view.getUint8(0x2E) !== 0;

        //TODO: what do the rest mean
        let uvmdCt = view.getUint8(52);

        curPos += 0x60;
        for(let i = 0; i < uvmdCt; i++) {
            let uvmdIndex = view.getUint16(curPos);
            let unkByte = view.getUint8(curPos + 2); // this is some flags
            // & 2  - render model?
            // & 4  - enable fog?
            // & 8  - something to do with a matrix gen?

            this.uvmds.push(filesystem.getParsedFile(UVMD, "UVMD", uvmdIndex));

            curPos += 3;
        }
    }
}