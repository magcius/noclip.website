import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { TextDecoder } from "util";

function UTF8ToString(array: Uint8Array) {
    let length = 0; while (length < array.length && array[length]) length++;
    return new TextDecoder().decode(array.subarray(0, length));
}

interface Asset {
    offset: number;
    size: number;
    name: string;
}

function loadDIR(buf: ArrayBuffer) {
    let assets = [] as Asset[];
    let view = new DataView(buf);
    for (let i = 0; i < buf.byteLength; i += 32) {
        let offset = view.getUint32(i + 0, true);
        let size = view.getUint32(i + 4, true);
        let name = UTF8ToString(new Uint8Array(buf, i + 8, 24));
        assets.push({ offset, size, name });
    }
    return assets;
}

function loadAsset(img: ArrayBuffer, asset: Asset) {
    return img.slice(2048 * asset.offset, 2048 * (asset.offset + asset.size));
}

const pathBase = "../../../data/gta3/models/gta3";

function main() {
    const assets = loadDIR(readFileSync(pathBase + ".dir").buffer);
    const img = readFileSync(pathBase + ".img").buffer;
    mkdirSync(pathBase, { recursive: true });
    for (const asset of assets) {
        const name = asset.name.toLowerCase();
        writeFileSync(pathBase + "/" + name, Buffer.from(loadAsset(img, asset)));
        console.log("Saved", name);
    }
}

main();
