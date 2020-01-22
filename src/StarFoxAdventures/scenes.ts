import * as pako from 'pako';
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';

import { SFARenderer } from './render';
import { hexzero } from '../util';

const pathBase = 'sfa';

class ZLBHeader {
    static readonly SIZE = 16;

    magic: number;
    unk4: number;
    unk8: number;
    size: number;

    constructor(dv: DataView) {
        this.magic = dv.getUint32(0x0);
        this.unk4 = dv.getUint32(0x4);
        this.unk8 = dv.getUint32(0x8);
        this.size = dv.getUint32(0xC);
    }
}

function stringToFourCC(s: string): number {
    return (s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)
}

class SFASceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const sceneData = await dataFetcher.fetchData(`${pathBase}/${this.id}`);

        console.log(`Creating SFA scene for ${this.id} ...`);

        let offs = 0;
        const dv = sceneData.createDataView();
        const header = new ZLBHeader(dv);
        offs += ZLBHeader.SIZE;

        if (header.magic != stringToFourCC('ZLB\0')) {
            throw Error(`Invalid magic identifier 0x${hexzero(header.magic, 8)}`);
        }

        const uncompressed = pako.inflate(new Uint8Array(sceneData.copyToBuffer(ZLBHeader.SIZE, header.size)));
        const uncompDv = new DataView(uncompressed.buffer);
        const posOffset = uncompDv.getUint32(0x58);
        const posCount = uncompDv.getUint16(0x90);
        console.log(`Loading ${posCount} positions from 0x${posOffset.toString(16)}`);
        
        const verts = new Int16Array(posCount * 3);
        offs = posOffset;
        for (let i = 0; i < posCount; i++) {
            verts[i * 3 + 0] = uncompDv.getInt16(offs + 0x00, false);
            verts[i * 3 + 1] = uncompDv.getInt16(offs + 0x02, false);
            verts[i * 3 + 2] = uncompDv.getInt16(offs + 0x04, false);
            offs += 0x06;
        }

        const renderer = new SFARenderer(device, verts);
        
        return renderer;
    }
}

const sceneDescs = [
    'Test',
    new SFASceneDesc('mod48.zlb.bin', 'Cape Claw'),
];

const id = 'sfa';
const name = 'Star Fox Adventures';
export const sceneGroup: Viewer.SceneGroup = {
    id, name, sceneDescs,
};
