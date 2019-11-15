
/*
After running this script, install the basisu CLI from

    https://github.com/BinomialLLC/basis_universal

and run the following command from both of the newly created textures/{opaque,transparent}/ directories:

    for i in *; do basisu -mipmap $i/*.png -output_file $i.basis; done
*/

import { createWriteStream, writeFileSync, promises as fs } from 'fs';
import * as stream from 'stream';
import { TextDecoder, promisify, TextEncoder } from 'util';
import { PNG } from 'pngjs';
import * as rw from 'librw';
import { deflate } from 'pako';

const finished = promisify(stream.finished);

function UTF8ToString(array: Uint8Array) {
    let length = 0; while (length < array.length && array[length]) length++;
    return new TextDecoder().decode(array.subarray(0, length));
}

function StringToUTF8(s: string) {
    return new TextEncoder().encode(s);
}

interface Asset {
    offset: number;
    size: number;
    name: string;
    data?: Uint8Array;
}

function loadDIR(buf: ArrayBuffer) {
    const assets = [];
    const view = new DataView(buf);
    const start = 8;
    const dirLength = 32 * view.getUint32(4, true);
    for (let i = start; i < start + dirLength; i += 32) {
        const offset = view.getUint32(i + 0, true);
        const size = view.getUint16(i + 4, true);
        const name = UTF8ToString(new Uint8Array(buf, i + 8, 24));
        assets.push({ offset, size, name });
    }
    return assets;
}

function loadAsset(img: ArrayBuffer, asset: Asset) {
    return new Uint8Array(img, 2048 * asset.offset, 2048 * asset.size);
}

function writeIMGZ(path: string, assets: Asset[], size: number) {
    const bytes = new Uint8Array(2048 * size);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x56455232); // "VER2" in ASCII
    view.setUint32(4, assets.length, true);

    for(let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        const j = 8 + 32 * i;
        view.setUint32(j + 0, asset.offset, true);
        view.setUint16(j + 4, asset.size, true);
        bytes.set(StringToUTF8(asset.name), j + 8);
        bytes.set(asset.data, 2048 * asset.offset);
        console.log(asset.name);
    }

    const gz = deflate(bytes, { level: 9 });
    console.log('Compressed', bytes.byteLength / 1e6, 'MB to', gz.byteLength / 1e6, 'MB');
    writeFileSync(path, gz); // somehow using fs.writeFile here hangs...
}

const pathBase = '../../../data/GrandTheftAutoSanAndreas';

async function main() {
    const texturesOpaque: string[] = [];
    const texturesTransparent: string[] = [];
    const files = new Map<string, Uint8Array>();
    for (const imgName of ['gta3', 'gta_int']) {
        const img = await fs.readFile(`${pathBase}/models/${imgName}.img`);
        const assets = loadDIR(img.buffer);
        await rw.init({ gtaPlugins: true, platform: rw.Platform.PLATFORM_D3D8 });
        rw.Texture.setCreateDummies(true);
        rw.Texture.setLoadTextures(false);

        for (const asset of assets) {
            const name = asset.name.toLowerCase();
            const buffer = loadAsset(img.buffer, asset);
            if (name.endsWith('.txd')) {
                const txdName = name.substr(0, name.length - 4);
                const stream = new rw.StreamMemory(buffer);
                const header = new rw.ChunkHeaderInfo(stream);
                if (header.type !== rw.PluginID.ID_TEXDICTIONARY) throw new Error('invalid TXD');

                const txd = new rw.TexDictionary(stream);
                for (let lnk = txd.textures.begin; !lnk.is(txd.textures.end); lnk = lnk.next) {
                    const texture = rw.Texture.fromDict(lnk);
                    const texName = texture.name.toLowerCase();
                    const image = texture.raster.toImage();
                    image.unindex();

                    const { width, height, bpp } = image;
                    const transparent = image.hasAlpha();
                    const pixels = image.pixels!;

                    const png = new PNG({ width, height, colorType: transparent ? 6 : 2 });
                    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                        const i = x + y * width;
                        png.data[4*i+0] = pixels[bpp*i+0];
                        png.data[4*i+1] = pixels[bpp*i+1];
                        png.data[4*i+2] = pixels[bpp*i+2];
                        if (bpp === 4) png.data[4*i+3] = pixels[bpp*i+3];
                    }

                    const list = transparent ? texturesTransparent : texturesOpaque;
                    const index = list.length.toString(0x10).padStart(4, '0');
                    const path = `${transparent ? 'transparent' : 'opaque'}/${index.substr(0, 2)}`;
                    const fname = `${path}/${index.substr(2, 2)}.png`;
                    list.push(`${txdName}/${texName}\n`);
                    await fs.mkdir(`${pathBase}/textures/${path}`, { recursive: true });
                    await finished(png.pack().pipe(createWriteStream(`${pathBase}/textures/${fname}`)));
                    console.log(fname);

                    image.delete();
                }
                txd.delete();
                header.delete();
                stream.delete();
            } else {
                files.set(name, buffer);
            }
        }
    }
    await fs.writeFile(`${pathBase}/textures/opaque.txt`, texturesOpaque.join(''));
    await fs.writeFile(`${pathBase}/textures/transparent.txt`, texturesTransparent.join(''));

    let offset = Math.ceil((8 + 32 * files.size) / 2048);
    const assets = [];
    for (const [name, data] of files) {
        const size = data.byteLength / 2048;
        const asset: Asset = { name, size, offset, data };
        assets.push(asset);
        offset += size;
    }
    writeIMGZ(`${pathBase}/models/gta_notxd.imgz`, assets, offset);
}

main();
