import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';

import { SFA_GAME_INFO, GameInfo } from './scenes';
import { loadRes } from './resource';
import { ObjectManager } from './objects';

export class SFAWorldDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, private gameInfo: GameInfo = SFA_GAME_INFO, private isEarly: boolean = false, private isAncient: boolean = false) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        console.log(`Creating scene for world ${this.name} (ID ${this.id}) ...`);

        const pathBase = this.gameInfo.pathBase;
        const dataFetcher = context.dataFetcher;
        const objectMan = new ObjectManager(this.gameInfo);
        const [_, romlistFile] = await Promise.all([
            objectMan.create(dataFetcher),
            dataFetcher.fetchData(`${pathBase}/${this.id}.romlist.zlb`),
        ]);
        const romlist = loadRes(romlistFile).createDataView();

        let offs = 0;
        let i = 0;
        while (offs < romlist.byteLength) {
            const fields = {
                objType: romlist.getUint16(offs + 0x0),
                entrySize: romlist.getUint8(offs + 0x2),
                radius: 8 * romlist.getUint8(offs + 0x6),
                x: romlist.getFloat32(offs + 0x8),
                y: romlist.getFloat32(offs + 0xc),
                z: romlist.getFloat32(offs + 0x10),
            };

            console.log(`Object ${i}: ${JSON.stringify(fields, null, '\t')}`);

            const obj = objectMan.loadObject(fields.objType);
            console.log(`${obj.name} (type ${obj.objType} class ${obj.objClass})`);

            offs += fields.entrySize * 4;
            i++;
        }

        window.main.lookupObject = (objType: number) => {
            const obj = objectMan.loadObject(objType);
            console.log(`Object ${objType}: ${obj.name} (type ${obj.objType} class ${obj.objClass})`);
        };

        throw Error(`SFASceneDesc not implemented.`);
    }
}