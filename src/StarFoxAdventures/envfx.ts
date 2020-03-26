import { DataFetcher } from '../DataFetcher';
import { GfxDevice} from '../gfx/platform/GfxPlatform';

import { GameInfo } from './scenes';
import { TextureCollection, SFATexture } from './textures';

function dataSubarray(data: DataView, byteOffset: number, byteLength?: number): DataView {
    return new DataView(data.buffer, data.byteOffset + byteOffset, byteLength);
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
            texIds: [0],
        };
        fields.texIds = [];
        for (let i = 0; i < 4; i++) {
            fields.texIds.push(data.getUint16(0x2e + i * 2));
        }
        for (let i = 0; i < 4; i++) {
            fields.texIds.push(data.getUint16(0x3e + i * 2));
        }

        if (fields.type == 5) { // Atmosphere
            const BASE = 0xc38;
            this.atmosphere.textures = [];
            for (let i = 0; i < 8; i++) {
                const texId = BASE + fields.texIds[i];
                console.log(`loading sky texture ${i}: 0x${texId.toString(16)}`);
                this.atmosphere.textures[i] = this.texColl.getTexture(device, BASE + fields.texIds[i], false);
            }
        }

        return fields;
    }
}