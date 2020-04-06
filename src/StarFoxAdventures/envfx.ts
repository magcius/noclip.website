import { DataFetcher } from '../DataFetcher';
import { GfxDevice} from '../gfx/platform/GfxPlatform';

import { GameInfo } from './scenes';
import { TextureCollection, SFATexture } from './textures';
import { dataSubarray } from './util';

enum EnvfxType {
    Atmosphere = 5,
}

class Atmosphere {
    public textures: (SFATexture | null)[] = [];
}

export class EnvfxManager {
    private envfxactBin: DataView;
    public atmosphere = new Atmosphere();
    private readonly ENVFX_SIZE = 0x60;

    constructor(private gameInfo: GameInfo, private texColl: TextureCollection) {
    }

    public async create(dataFetcher: DataFetcher) {
        const pathBase = this.gameInfo.pathBase;
        this.envfxactBin = (await dataFetcher.fetchData(`${pathBase}/ENVFXACT.bin`)).createDataView();
    }

    public loadEnvfx(device: GfxDevice, index: number) {
        const data = dataSubarray(this.envfxactBin, index * this.ENVFX_SIZE, this.ENVFX_SIZE);
        const fields = {
            index: index,
            type: data.getUint8(0x5c),
            texIds: [] as number[],
        };
        for (let i = 0; i < 4; i++) {
            fields.texIds.push(data.getUint16(0x2e + i * 2));
        }
        for (let i = 0; i < 4; i++) {
            fields.texIds.push(data.getUint16(0x3e + i * 2));
        }

        console.log(`envfxact ${index}: ${JSON.stringify(fields, null, '\t')}`);

        if (fields.type == EnvfxType.Atmosphere) {
            const BASE = 0xc38;
            this.atmosphere.textures = [];
            for (let i = 0; i < 8; i++) {
                const texId = BASE + fields.texIds[i];
                console.log(`loading atmosphere texture ${i}: 0x${texId.toString(16)}`);
                this.atmosphere.textures[i] = this.texColl.getTexture(device, BASE + fields.texIds[i], false);
            }
        }

        return fields;
    }
}