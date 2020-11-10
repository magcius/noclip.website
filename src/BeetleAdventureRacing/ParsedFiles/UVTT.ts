import { vec3 } from "gl-matrix";
import { assert } from "../../util";
import { Filesystem, UVFile } from "../Filesystem";

class Pnt {
    up: vec3;
    pos: vec3;
    fwd: vec3;
    right: vec3;
    trackSectionLength: number;
    trackSectionWidth: number;
}

class PntAndProgress {
    progress: number;
    pnt: Pnt;
}

export class UVTT {
    pnts: Pnt[];
    route: PntAndProgress[];

    constructor(uvFile: UVFile, filesystem: Filesystem) {
        assert(uvFile.chunks.length === 2);
        assert(uvFile.chunks[0].tag === 'PNTS');
        assert(uvFile.chunks[1].tag === 'LNKS');


        const pntsView = uvFile.chunks[0].buffer.createDataView();
        const lnksView = uvFile.chunks[1].buffer.createDataView();

        this.pnts = [];
        let numPnts = pntsView.getUint32(0);
        for (let i = 0; i < numPnts; i++) {
            let offs = 4 + (i * 0x38);

            let up = vec3.fromValues(
                pntsView.getFloat32(offs + 0x0),
                pntsView.getFloat32(offs + 0x4),
                pntsView.getFloat32(offs + 0x8)
            );

            let pos = vec3.fromValues(
                pntsView.getFloat32(offs + 0x0C),
                pntsView.getFloat32(offs + 0x10),
                pntsView.getFloat32(offs + 0x14)
            );

            let fwd = vec3.fromValues(
                pntsView.getFloat32(offs + 0x18),
                pntsView.getFloat32(offs + 0x1C),
                pntsView.getFloat32(offs + 0x20)
            );

            let right = vec3.fromValues(
                pntsView.getFloat32(offs + 0x24),
                pntsView.getFloat32(offs + 0x28),
                pntsView.getFloat32(offs + 0x2C)
            )

            let trackSectionLength = pntsView.getFloat32(offs + 0x30);
            let trackSectionWidth = pntsView.getFloat32(offs + 0x34);

            this.pnts.push({ up, pos, fwd, right, trackSectionLength, trackSectionWidth });
        }

        let progressSoFar = 0;
        this.route = [];
        let numLnks = lnksView.getUint32(0);
        for (let i = 0; i < numLnks; i++) {
            let offs = 4 + (i * 0x8);

            let start = lnksView.getUint32(offs + 0x0);
            let length = lnksView.getUint32(offs + 0x4);

            for (let j = start; j < (start + length); j++) {
                this.route.push({ progress: progressSoFar, pnt: this.pnts[j] });
                progressSoFar += this.pnts[j].trackSectionLength;
            }
        }
    }

    public getPointAlongTrack(progress: number): vec3 {
        if (progress < 0) {
            throw new Error();
        }

        for (let pntAndProgress of this.route) {
            if (progress < pntAndProgress.progress + pntAndProgress.pnt.trackSectionLength) {
                let result = vec3.create();
                vec3.scaleAndAdd(result, pntAndProgress.pnt.pos, pntAndProgress.pnt.fwd, (progress - pntAndProgress.progress))
                return result;
            }
        }

        // To handle the accidental zone in II
        let result = vec3.create();
        vec3.scaleAndAdd(result, this.route[this.route.length - 1].pnt.pos, this.route[this.route.length - 1].pnt.fwd, (progress - this.route[this.route.length - 1].progress))
        return result;
    }
}