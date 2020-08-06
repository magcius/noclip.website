import { Filesystem, UVFile } from "../Filesystem";
import { assert } from "../../util";
import { UVMD } from "./UVMD";

export class UVEN {
    // TODO: actual state
    public uvmds: UVMD[] = [];

    constructor(uvFile: UVFile, filesystem: Filesystem) {
        assert(uvFile.chunks.length === 1);
        assert(uvFile.chunks[0].tag === 'COMM');
        const view = uvFile.chunks[0].buffer.createDataView();
        let curPos = 0;
        // read first 0x60 bytes

        //TODO: what do the rest mean
        let uvmdCt = view.getUint8(52);

        curPos += 0x60;
        for(let i = 0; i < uvmdCt; i++) {
            let uvmdIndex = view.getUint16(curPos);
            let unkByte = view.getUint8(curPos + 2);

            this.uvmds.push(filesystem.getParsedFile(UVMD, "UVMD", uvmdIndex));

            curPos += 3;
        }
    }
}