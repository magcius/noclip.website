import { hexzero } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import * as GX_Texture from '../gx/gx_texture';
import { loadTextureFromMipChain, translateWrapModeGfx, translateTexFilterGfx } from '../gx/gx_render';
import { GfxDevice, GfxMipFilterMode, GfxTexture, GfxSampler, GfxFormat, makeTextureDescriptor2D, GfxWrapMode, GfxTexFilterMode } from '../gfx/platform/GfxPlatform';
import { DataFetcher } from '../DataFetcher';

import { GameInfo } from './scenes';
import { loadRes } from './resource';

export interface SFATexture {
    gfxTexture: GfxTexture;
    gfxSampler: GfxSampler;
    width: number;
    height: number;
}

export abstract class TextureCollection {
    public abstract getTexture(device: GfxDevice, num: number, alwaysUseTex1?: boolean): SFATexture | null;
}

function loadTexture(device: GfxDevice, texData: ArrayBufferSlice): SFATexture {
    const dv = texData.createDataView();
    const textureInput = {
        name: `Texture`,
        width: dv.getUint16(0x0A),
        height: dv.getUint16(0x0C),
        format: dv.getUint8(0x16),
        mipCount: dv.getUint16(0x1c) + 1,
        data: texData.slice(0x60),
    };
    const fields = {
        wrapS: dv.getUint8(0x17),
        wrapT: dv.getUint8(0x18),
        minFilt: dv.getUint8(0x19),
        magFilt: dv.getUint8(0x1A),
    };
    
    const mipChain = GX_Texture.calcMipChain(textureInput, textureInput.mipCount);
    const gfxTexture = loadTextureFromMipChain(device, mipChain).gfxTexture;
    
    // GL texture is bound by loadTextureFromMipChain.
    const [minFilter, mipFilter] = translateTexFilterGfx(fields.minFilt);
    const gfxSampler = device.createSampler({
        wrapS: translateWrapModeGfx(fields.wrapS),
        wrapT: translateWrapModeGfx(fields.wrapT),
        minFilter: minFilter,
        magFilter: translateTexFilterGfx(fields.magFilt)[0],
        mipFilter: mipFilter,
        minLOD: 0,
        maxLOD: 100,
    });

    return {
        gfxTexture,
        gfxSampler,
        width: textureInput.width,
        height: textureInput.height,
    };
}

function isValidTextureTabValue(tabValue: number) {
    return tabValue != 0xFFFFFFFF && (tabValue & 0x80000000) != 0;
}

function loadFirstValidTexture(device: GfxDevice, tab: DataView, bin: ArrayBufferSlice): SFATexture | null {
    let firstValidId = 0;
    let found = false;
    for (let i = 0; i < tab.byteLength; i += 4) {
        const tabValue = tab.getUint32(i);
        if (tabValue == 0xFFFFFFFF) {
            console.log(`no valid id found`);
            break;
        }
        if (isValidTextureTabValue(tabValue)) {
            found = true;
            break;
        }
        ++firstValidId;
    }
    if (!found) {
        return null;
    }

    return loadTextureFromTable(device, tab, bin, firstValidId);
}

function loadTextureFromTable(device: GfxDevice, tab: DataView, bin: ArrayBufferSlice, id: number): (SFATexture | null) {
    const tabValue = tab.getUint32(id * 4);
    if (isValidTextureTabValue(tabValue)) {
        const binOffs = (tabValue & 0x00FFFFFF) * 2;
        const compData = bin.slice(binOffs);
        const uncompData = loadRes(compData);
        return loadTexture(device, uncompData);
    } else {
        // TODO: also seen is value 0x01000000
        console.warn(`Texture id 0x${id.toString(16)} (tab value 0x${hexzero(tabValue, 8)}) not found in table. Using first valid texture.`);
        return loadFirstValidTexture(device, tab, bin);
    }
}

function makeFakeTexture(device: GfxDevice, num: number): SFATexture {
    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, 2, 2, 1));
    const gfxSampler = device.createSampler({
        wrapS: GfxWrapMode.REPEAT,
        wrapT: GfxWrapMode.REPEAT,
        minFilter: GfxTexFilterMode.BILINEAR,
        magFilter: GfxTexFilterMode.BILINEAR,
        mipFilter: GfxMipFilterMode.NO_MIP,
        minLOD: 0,
        maxLOD: 100,
    });

    // Thanks, StackOverflow.
    let seed = num;
    console.log(`Creating fake texture from seed ${seed}`);
    function random() {
        let x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
    }

    const baseColor = [127 + random() * 127, 127 + random() * 127, 127 + random() * 127];
    const darkBase = [baseColor[0] * 0.7, baseColor[1] * 0.7, baseColor[2] * 0.7];
    const light = [baseColor[0], baseColor[1], baseColor[2], 0xff];
    const dark = [darkBase[0], darkBase[1], darkBase[2], 0xff];

    const pixels = new Uint8Array(4 * 4);
    pixels.set(dark, 0);
    pixels.set(light, 4);
    pixels.set(light, 8);
    pixels.set(dark, 12);

    const hostAccessPass = device.createHostAccessPass();
    hostAccessPass.uploadTextureData(gfxTexture, 0, [pixels]);
    device.submitPass(hostAccessPass);

    return {
        gfxTexture,
        gfxSampler,
        width: 2,
        height: 2,
    }
}

class TextureFile {
    private textures: (SFATexture | null)[] = [];

    constructor(private tab: DataView, private bin: ArrayBufferSlice) {
    }

    public getTexture(device: GfxDevice, num: number): SFATexture | null {
        if (this.textures[num] === undefined) {
            try {
                this.textures[num] = loadTextureFromTable(device, this.tab, this.bin, num);
            } catch (e) {
                console.warn(`Failed to load texture 0x${num.toString(16)} due to exception:`);
                console.error(e);
                this.textures[num] = makeFakeTexture(device, num);
            }
        }

        return this.textures[num];
    }
}

export class SFATextureCollection implements TextureCollection {
    private textableBin: DataView;
    private texpre: TextureFile;
    private tex1: TextureFile;

    constructor(private gameInfo: GameInfo) {
    }

    public async create(dataFetcher: DataFetcher, subdir: string) {
        const pathBase = this.gameInfo.pathBase;
        const [textableBin, texpreTab, texpreBin, tex1Tab, tex1Bin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/TEXTABLE.bin`),
            dataFetcher.fetchData(`${pathBase}/TEXPRE.tab`),
            dataFetcher.fetchData(`${pathBase}/TEXPRE.bin`),
            dataFetcher.fetchData(`${pathBase}/${subdir}/TEX1.tab`),
            dataFetcher.fetchData(`${pathBase}/${subdir}/TEX1.bin`),
        ]);
        this.textableBin = textableBin.createDataView();
        this.texpre = new TextureFile(texpreTab.createDataView(), texpreBin);
        this.tex1 = new TextureFile(tex1Tab.createDataView(), tex1Bin);
    }

    public getTexture(device: GfxDevice, texId: number, alwaysUseTex1: boolean = false): SFATexture | null {
        let file: TextureFile;
        if (alwaysUseTex1) {
            file = this.tex1;
        } else {
            const textableValue = this.textableBin.getUint16(texId * 2);
            if (texId < 3000 || textableValue == 0) {
                texId = textableValue;
                throw Error(`TEX0 files are not implemented.`);
            } else {
                texId = textableValue + 1;
                file = this.texpre;
                console.log(`loading texpre #${texId}`);
            }
        }

        return file.getTexture(device, texId);
    }
}

export class FakeTextureCollection implements TextureCollection {
    textures: SFATexture[] = [];

    public getTexture(device: GfxDevice, num: number): SFATexture | null {
        if (this.textures[num] === undefined) {
            this.textures[num] = makeFakeTexture(device, num);
        }
        return this.textures[num];
    }
}