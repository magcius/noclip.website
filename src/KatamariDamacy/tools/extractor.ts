
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { openSync, readSync, closeSync, writeFileSync, mkdirSync } from "fs";
import { readString, hexzero, leftPad } from "../../util";
import { assert } from "console";

// Ported from "unpack.py" by Murugo.

function fetchDataFragmentSync(path: string, byteOffset: number, byteLength: number): ArrayBufferSlice {
    const fd = openSync(path, 'r');
    const b = Buffer.alloc(byteLength);
    readSync(fd, b, 0, byteLength, byteOffset);
    closeSync(fd);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);
}

function writeBufferSync(path: string, buffer: ArrayBufferSlice): void {
    writeFileSync(path, Buffer.from(buffer.copyToBuffer()));
}

const logicalBlockSize = 0x800;
function iso9660GetDataLBA(isoFilename: string, lba: number, byteLength: number): ArrayBufferSlice {
    return fetchDataFragmentSync(isoFilename, lba * logicalBlockSize, byteLength);
}

function iso9660GetDataFilename(isoFilename: string, filename: string): ArrayBufferSlice | null {
    const primaryVolume = iso9660GetDataLBA(isoFilename, 0x10, logicalBlockSize * 2);

    const primaryVolumeMagic = readString(primaryVolume, 0x00, 0x06);
    if (primaryVolumeMagic !== '\x01CD001')
        throw new Error('Expected primary volume descriptor at offset 0x8000');

    const primaryVolumeView = primaryVolume.createDataView();

    const rootDirectoryLBA = primaryVolumeView.getUint32(0x009E, true);
    const rootDirectory = iso9660GetDataLBA(isoFilename, rootDirectoryLBA, logicalBlockSize);
    const rootDirectoryView = rootDirectory.createDataView();

    let offs = 0x00;
    while (true) {
        const recordLen = rootDirectoryView.getUint8(offs + 0x00);
        if (recordLen == 0)
            break;
        const lba = rootDirectoryView.getUint32(offs + 0x02, true);
        const byteLength = rootDirectoryView.getUint32(offs + 0x0A, true);
        const dirFilenameLength = rootDirectoryView.getUint8(offs + 0x20);
        const dirFilename = readString(rootDirectory, offs + 0x21, dirFilenameLength);
        if (dirFilename === filename)
            return iso9660GetDataLBA(isoFilename, lba, byteLength);
        offs += recordLen;
    }

    return null;
}

function parseName(view: DataView, offs: number, size: number): string {
    const chartable: { [k: number]: string } = {
        0x100: ' ',
        0x200: 'A', 0x201: 'B', 0x202: 'C', 0x203: 'D', 0x204: 'E', 0x205: 'F', 0x206: 'G', 0x207: 'H',
        0x208: 'I', 0x209: 'J', 0x20A: 'K', 0x20B: 'L', 0x20C: 'M', 0x20D: 'N', 0x20E: 'O', 0x20F: 'P',
        0x210: 'Q', 0x211: 'R', 0x212: 'S', 0x213: 'T', 0x214: 'U', 0x215: 'V', 0x216: 'W', 0x217: 'X',
        0x218: 'Y', 0x219: 'Z',
        0x220: 'a', 0x221: 'b', 0x222: 'c', 0x223: 'd', 0x224: 'e', 0x225: 'f', 0x226: 'g', 0x227: 'h',
        0x228: 'i', 0x229: 'j', 0x22A: 'k', 0x22B: 'l', 0x22C: 'm', 0x22D: 'n', 0x22E: 'o', 0x22F: 'p',
        0x230: 'q', 0x231: 'r', 0x232: 's', 0x233: 't', 0x234: 'u', 0x235: 'v', 0x236: 'w', 0x237: 'x',
        0x238: 'y', 0x239: 'z',
        0x240: '_', 0x241: '"', 0x242: "'", 0x243: ',' ,0x244: '.', 0x245: '/', 0x246: '<', 0x247: '>',
        0x248: '!', 0x249: '…', 0x24A: '[', 0x24B: ']' ,0x24C: '?', 0x24D: '-', 0x24E: '~', 0x24F: '#',
        0x250: '0', 0x251: '1', 0x252: '2', 0x253: '3', 0x254: '4', 0x255: '5', 0x256: '6', 0x257: '7',
        0x258: '8', 0x259: '9', 0x25A: '&', 0x25B: ':', 0x25C: 'ã', 0x25D: 'é', 0x25E: '★', 0x25F: '(',
        0x260: ')',
    };

    let S = '';
    for (let i = 0; i < size; i += 0x02) {
        let c = view.getUint16(offs + i, true);
        if (c === 0xFFFF)
            break;
        S += chartable[c];
    }
    return S;
}

function dumpObjectNames(elf: ArrayBufferSlice): void {
    const view = elf.createDataView();

    const nametableOffs = 0xE06B8;
    const objectDescTableOffs = 0xCDF70;

    let nameIdx = nametableOffs, objectDescIdx = objectDescTableOffs;
    for (let i = 0; i < 1718; i++) {
        const internalNamePtr = view.getUint32(objectDescIdx + 0x00, true);
        const internalName = readString(elf, internalNamePtr - 0xFF000);

        const objectName = parseName(view, nameIdx, 0x50);
        console.log(`${leftPad('' + i, 4)}\t${hexzero(i, 4)}\t${internalName}\t${objectName}`);
        nameIdx += 0x50;
        objectDescIdx += 0x24;
    }
}

function extractGalleryIndex(pathOutBase: string, elf: ArrayBufferSlice): void {
    const view = elf.createDataView();

    const nametableOffs = 0xE06B8;
    const objectDescTableOffs = 0xCDF70;
    const objectFileTableOffs = 0x180E50;
    const objectBaseLBA = 0x136B8D;
    const galleryObjects: any[] = [];

    let nameIdx = nametableOffs, objectDescIdx = objectDescTableOffs, objectFileIdx = objectFileTableOffs;
    for (let i = 0; i < 1718; i++) {
        const internalNamePtr = view.getUint32(objectDescIdx + 0x00, true);
        const internalName = readString(elf, internalNamePtr - 0xFF000);
        const lba = objectBaseLBA + view.getUint32(objectFileIdx + 0x08, true);
        const filename = `${objectFileTableOffs.toString(16)}/${lba.toString(16)}.bin`;

        const objectName = parseName(view, nameIdx, 0x50);
        nameIdx += 0x50;
        objectDescIdx += 0x24;
        objectFileIdx += 0x10;

        galleryObjects.push({ Name: objectName, InternalName: internalName, Filename: filename });
    }

    const data = JSON.stringify(galleryObjects);
    writeFileSync(`${pathBaseOut}/gallery.json`, data);
}

class BitStream {
    public r = 0;
    public buf: bigint = 0n;
    public offs = 0;

    constructor(private view: DataView) {
    }

    public getnext(numBits: number): number {
        assert(numBits <= 53);

        let val = 0n;
        if (this.r >= numBits) {
            this.r -= numBits;
        } else {
            numBits -= this.r;
            val = this.buf << BigInt(numBits);
            if (this.offs < this.view.byteLength) {
                this.buf = this.view.getBigUint64(this.offs + 0x00, true);
            } else {
                throw new Error('Stream ended early decompressing file!');
            }

            this.offs += 0x08;
            this.r = 0x40 - numBits;
        }

        val |= this.buf & ((1n << BigInt(numBits)) - 1n);
        this.buf >>= BigInt(numBits);
        return Number(val);
    }
}

function extractCompressedFile(buffer: ArrayBufferSlice, rlparam: number, uncompressedSize: number): ArrayBuffer {
    const dst = new Uint8Array(uncompressedSize);

    const windowBits = rlparam & 0xFF;
    const lengthBits = rlparam >>> 8;

    const stream = new BitStream(buffer.createDataView());

    let idx = 0;
    while (idx < uncompressedSize) {
        const b = stream.getnext(1);

        if (b) {
            // Literal
            dst[idx++] = stream.getnext(8) & 0xFF;
        } else {
            // Window
            let offs = idx - Math.abs(stream.getnext(windowBits)) - 1;
            const length = stream.getnext(lengthBits) + 2;
            for (let i = 0; i < length; i++)
                dst[idx++] = dst[offs++];
        }
    }

    return dst.buffer as ArrayBuffer;
}

interface ExtractedFile {
    lba: number;
    buffer: ArrayBuffer;
}

function extractFile(isoFilename: string, elf: ArrayBufferSlice, fileTableOffs: number, baseLBA: number = 0): ExtractedFile {
    const view = elf.createDataView();

    const rlparam = view.getUint32(fileTableOffs + 0x00, true);
    const uncompressedSizeAndFlags = view.getUint32(fileTableOffs + 0x04, true);
    const lba = baseLBA + view.getUint32(fileTableOffs + 0x08, true);
    const compressedSize = view.getUint32(fileTableOffs + 0x0C, true);

    const isCompressed = !!(uncompressedSizeAndFlags & 0x01);
    const enforceChecksum = !!(uncompressedSizeAndFlags & 0x04);
    const uncompressedSize = uncompressedSizeAndFlags >>> 4;

    // Make sure to include space for the 0x10-byte header
    const headerSize = 0x10;

    let buffer: ArrayBuffer;
    if (isCompressed) {
        const compressedData = iso9660GetDataLBA(isoFilename, lba, headerSize + compressedSize).slice(headerSize);
        buffer = extractCompressedFile(compressedData, rlparam, uncompressedSize);
    } else {
        buffer = iso9660GetDataLBA(isoFilename, lba, headerSize + uncompressedSize).copyToBuffer(headerSize);
    }

    return { lba, buffer };
}

function extractFileTable(outPath: string, isoFilename: string, elf: ArrayBufferSlice, fileTableOffs: number, count: number, baseLBA: number = 0x00): void {
    const outFolderPath = `${outPath}/${fileTableOffs.toString(16)}`;
    mkdirSync(outFolderPath, { recursive: true });

    let idx = fileTableOffs;
    for (let i = 0; i < count; i++, idx += 0x10) {
        const file = extractFile(isoFilename, elf, idx, baseLBA);

        const filename = `${file.lba.toString(16)}.bin`;
        const outFilePath = `${outFolderPath}/${filename}`;

        console.log('Extracted', outFilePath);
        writeFileSync(outFilePath, Buffer.from(file.buffer));
    }
}

const pathBaseIn  = `../../../data/katamari_damacy_raw`;
const pathBaseOut = `../../../data/katamari_damacy`;

function main() {
    const isoFilename = `${pathBaseIn}/KatamariDamacy.iso`;

    const elf = iso9660GetDataFilename(isoFilename, `SLUS_210.08;1`);
    extractGalleryIndex(pathBaseOut, elf);
    // dumpObjectNames(elf);

    extractFileTable(pathBaseOut, isoFilename, elf, 0x17C340, 0x4);
    extractFileTable(pathBaseOut, isoFilename, elf, 0x17F100, 0x17);
    extractFileTable(pathBaseOut, isoFilename, elf, 0x17F590, 0x18C);
    extractFileTable(pathBaseOut, isoFilename, elf, 0x1879B0, 0x3D, 0x0);

    const objectFileTableOffs = 0x180E50;
    const objectBaseLBA = 0x136B8D;
    const objectCount = 1718;
    extractFileTable(pathBaseOut, isoFilename, elf, objectFileTableOffs, objectCount, objectBaseLBA);

    writeBufferSync(`${pathBaseOut}/levelBlock.bin`,        elf.slice(0xBF1A0, 0xC0034));
    writeBufferSync(`${pathBaseOut}/objectBlock.bin`,       elf.slice(0xCDF70, 0xDD108));
    writeBufferSync(`${pathBaseOut}/collectionBlock.bin`,   elf.slice(0xDD108, 0xE06B8));
    writeBufferSync(`${pathBaseOut}/transformBlock.bin`,    elf.slice(0x111260, 0x112FFC));
    writeBufferSync(`${pathBaseOut}/randomBlock.bin`,       elf.slice(0x116980, 0x117238));
    writeBufferSync(`${pathBaseOut}/pathBlock.bin`,         elf.slice(0x117290, 0X1607B0)); // maybe split this up?
    writeBufferSync(`${pathBaseOut}/movementBlock.bin`,     elf.slice(0x161D90, 0X162CF4));
    writeBufferSync(`${pathBaseOut}/parentBlock.bin`,       elf.slice(0x162EC0, 0X168850));
    writeBufferSync(`${pathBaseOut}/missionBlock.bin`,      elf.slice(0x180340, 0X180E50));
    writeBufferSync(`${pathBaseOut}/animationBlock.bin`,    elf.slice(0x30DC00, 0X386C54));
}

main();
