import { Filesystem, UVFile } from "../Filesystem";
import { assert } from "../../util";
import { mat4 } from "gl-matrix";
import { UVCT } from "./UVCT";
import { parseMatrix } from "./Common";

export class UVTR {
    //TODO: this is bad(?)
    public uvcts: [UVCT, mat4][];

    // TODO flesh out with more revEng
    constructor(uvFile: UVFile, filesystem: Filesystem) {
        assert(uvFile.chunks.length === 1);
        assert(uvFile.chunks[0].tag === 'COMM');


        const view = uvFile.chunks[0].buffer.createDataView();

        //TODO: more research, figure out what other data does.
        // Copied (with slight modifications) from the PW64 code
        const minX = view.getFloat32(0x00);
        const minY = view.getFloat32(0x04);

        const gridWidth = view.getUint8(0x18);
        const gridHeight = view.getUint8(0x19);
        const cellX = view.getFloat32(0x1A);
        const cellY = view.getFloat32(0x1E);
        const unk = view.getFloat32(0x22);

        this.uvcts = [];
        let offs = 0x26;
        for (let i = 0; i < gridWidth * gridHeight; i++) {
            const flag = view.getUint8(offs++);

            if (flag === 0) {
                // No data in this cell.
                continue;
            }

            let mat;
            ({ mat, curPos: offs } = parseMatrix(view, offs));

            const rotation = view.getInt8(offs + 0);
            assert(rotation === 0x00);
            const contourIndex = view.getUint16(offs + 1);
            offs += 3;

            const uvct = filesystem.getParsedFile(UVCT, "UVCT", contourIndex);

            this.uvcts.push([uvct, mat]);
        }

        // TODO: there is other processing after this in the game
    }
}
