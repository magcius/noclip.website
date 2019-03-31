import { vec2 } from "gl-matrix";

export class Texture {
    public clipLeft = 0;
    public clipRight = 0;
    public clipTop = 0;
    public clipBottom = 0;
    public tiledU: boolean = false;
    public tiledV: boolean = false;
    public spriteAnim: TextureSpriteAnim = null;

    constructor(public index: number, public parent: TextureBlock, public colorTableOffs: number, public translucent: boolean) {
    }

    public width(): number {
        return this.clipRight - this.clipLeft + 1;
    }

    public height(): number {
        return this.clipBottom - this.clipTop + 1;
    }

    public name(): string {
        return `${this.parent.bank}_${this.parent.dataOffs.toString(16)}_${this.index}`;
    }

    public pixels(): Uint8Array {
        if (!this.parent || !this.parent.pixels || this.parent.pixels.length == 0) {
            return null;
        }
        const width = this.clipRight - this.clipLeft + 1;
        const height = this.clipBottom - this.clipTop + 1;
        if (width == this.parent.width && height == this.parent.height) {
            return new Uint8Array(this.parent.pixels);
        }
        let clipped = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            const src = ((y + this.clipTop) * this.parent.width + this.clipLeft) * 4;
            const dst = y * width * 4;
            clipped.set(this.parent.pixels.slice(src, src + width * 4), dst);
        }
        return clipped;
    }
}

export class TextureBlock {
    public textures: Texture[] = [];
    public format: string;
    public pixels: Uint8Array;

    constructor(public width: number, public height: number, public bitDepth: number, public bank: number, public dataOffs: number, private deswizzle: boolean) {
        this.format = `Indexed${bitDepth}`
    }

    public isOvf(): boolean {
        return this.bank == 0 && this.dataOffs >= 0x100000;
    }

    public build(texDataView: DataView, texClutView: DataView) {
        if (this.deswizzle) {
            let dataOffs = this.dataOffs;
            if (this.bank == 0) {
                dataOffs -= 0x100000;
            }
            if (this.bitDepth == 8) {
                deswizzleIndexed8(texDataView, dataOffs, this.width, this.height);
            } else if (this.bitDepth == 4) {
                deswizzleIndexed4(texDataView, dataOffs, this.width, this.height);
            }
        }
        this.pixels = new Uint8Array(this.width * this.height * 4);
        this.textures.forEach((texture) => {
            this.fillFromTexture(texture, texDataView, texClutView);
        });
    }

    public key(): string {
        return `${this.bank}${this.dataOffs}`
    }

    private fillFromTexture(texture: Texture, texDataView: DataView, texClutView: DataView) {
        if (texture.colorTableOffs >= texClutView.byteLength) {
            // There are at least two maps where the .BIN file references textures that
            // do not exist in the .IMG file due to the pair of files being out of sync
            // at the time the game was shipped. These maps are:
            //   Neverland - Clock Tower (Beta)
            //   End of the World - Deep Jungle (World Terminus)
            return;
        }
        let dataOffs = this.dataOffs;
        if (this.bank >= 0) {
            dataOffs += 0x100000 * (this.isOvf() ? -1 : this.bank);
        }
        const pixelsPerByte = this.bitDepth == 4 ? 2 : 1;
        for (let y = texture.clipTop; y <= texture.clipBottom; y++) {
            for (let x = texture.clipLeft; x <= texture.clipRight; x++) {
                const offs = y * this.width + x;
                let p = texDataView.getUint8(dataOffs + offs / pixelsPerByte);
                if (pixelsPerByte == 2) {
                    p = ((x % 2 == 0) ? p : (p >> 4)) & 0xF;
                } else {
                    // Flip bits 4 and 5: 000xy000 -> 000yx000
                    p = ((p & 0xE7) | ((p & 0x8) << 1) | ((p & 0x10) >> 1));
                }
                this.pixels[offs * 4] = texClutView.getUint8(texture.colorTableOffs + p * 4);
                this.pixels[offs * 4 + 1] = texClutView.getUint8(texture.colorTableOffs + p * 4 + 1);
                this.pixels[offs * 4 + 2] = texClutView.getUint8(texture.colorTableOffs + p * 4 + 2);
                this.pixels[offs * 4 + 3] = Math.min(0xFF, texClutView.getUint8(texture.colorTableOffs + p * 4 + 3) * 2);
            }
        }
    }
}

export class TextureAtlas {
    public width: number = 0;
    public height: number = 0;
    public pixels: Uint8Array = null;
    // TextureBlock key -> [x, y]
    private blockMap: Map<string, [number, number]> = new Map();

    constructor(textureBlocks: TextureBlock[]) {
        this._buildAtlas(textureBlocks);
    }

    public getTextureBlockPos(textureBlock: TextureBlock): [number, number] {
        const key = textureBlock.key();
        if (!this.blockMap.has(key)) {
            return null;
        }
        return this.blockMap.get(key);
    }

    private _buildAtlas(textureBlocks: TextureBlock[]) {
        const textureBlocksSorted = textureBlocks.slice(0).sort((a, b) => {
            return a.bitDepth < b.bitDepth || (a.bitDepth == b.bitDepth && a.dataOffs < b.dataOffs) ? -1 : 1;
        });
        // Number of 256x256 blocks to fill in the atlas.
        let numSquares = 0;
        for (let i = 0; i < textureBlocksSorted.length; i++) {
            // Assume 4-bit texture blocks are 512x256, whereas 8-bit texture blocks are 256x256.
            numSquares += textureBlocksSorted[i].bitDepth == 4 ? 2 : 1;
        }
        const squaresPerRow = Math.round(Math.sqrt(numSquares) / 2) * 2;
        const squaresPerCol = Math.floor(numSquares / squaresPerRow) + 1;
        this.width = squaresPerRow * 256;
        this.height = squaresPerCol * 256;
        this.pixels = new Uint8Array(this.width * this.height * 4);
        let atlasIndex = 0;
        for (let i = 0; i < textureBlocksSorted.length; i++) {
            const textureBlock = textureBlocksSorted[i];
            const atlasX = atlasIndex % squaresPerRow;
            const atlasY = Math.floor(atlasIndex / squaresPerRow);
            this.blockMap.set(textureBlock.key(), [atlasX, atlasY]);
            for (let y = 0; y < textureBlock.height; y++) {
                const src = y * textureBlock.width * 4;
                const dst = ((atlasY * 256 + y) * squaresPerRow + atlasX) * 1024
                this.pixels.set(textureBlock.pixels.slice(src, src + textureBlock.width * 4), dst);
            }
            atlasIndex += textureBlocksSorted[i].bitDepth == 4 ? 2 : 1;
        }
    }
}

export class TextureSpriteAnim {
    uAnim: Float32Array;
    vAnim: Float32Array;

    constructor(textureBlock: TextureBlock, texture: Texture, spriteLeftAnim: Uint16Array, spriteTopAnim: Uint16Array, public numFrames: number, public spriteWidth: number, public spriteHeight: number, public speed: number) {
        this.uAnim = new Float32Array(this.numFrames);
        this.vAnim = new Float32Array(this.numFrames);
        for (let i = 0; i < this.numFrames; i++) {
            this.uAnim[i] = (spriteLeftAnim[i] - texture.clipLeft) / textureBlock.width;
            this.vAnim[i] = (spriteTopAnim[i] - texture.clipTop) / textureBlock.height;
        }
    }

    public getUVOffset(time: number, uvOffsetOut: vec2) {
        const frame = Math.floor(time * 0.03 / this.speed) % this.numFrames;
        return vec2.copy(uvOffsetOut, [this.uAnim[frame], this.vAnim[frame]]);
    }
}

export function deswizzleIndexed8(texView: DataView, offs: number, width: number, height: number) {
    const byteLength = width * height;
    const source = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) {
        source[i] = texView.getUint8(offs + i);
    }
    for (let i = 0; i < byteLength; i++) {
        const a = (i % 4) * 4 + (Math.floor(i / 8) % 2) * 2;
        const b = (Math.floor(i / 0x10) * 0x20) % (width * 4) + Math.floor(i / (width * 4)) * (width * 4);
        const c = ((Math.floor(i / 4) + Math.floor((i + width * 2) / (width * 4))) % 2) * 0x10;
        const d = Math.floor(i / (width * 2)) % 2;
        texView.setUint8(offs + i, source[a + b + c + d]);
    }
}

export function deswizzleIndexed4(texView: DataView, offs: number, width: number, height: number) {
    if (width < 0x20 || height < 0x16) {
        return;
    }
    const byteLength = width * height / 2;
    const source = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) {
        source[i] = texView.getUint8(offs + i);
    }
    const rows = Math.min(height, 0x80) / 0x10;
    const columns = Math.min(4, width / 0x20);
    const tiles = rows * width / 0x80;
    for (let i = 0; i < byteLength; i++) {
        let v = [0, 0];
        for (let j = 0; j < 2; j++) {
            const index = i * 2 + j;
            const a = Math.floor(index / 0x20) % columns * tiles * 0x200;
            const b = Math.floor(index / 0x80) % Math.floor(width / 0x80) * Math.floor(Math.min(height, 0x80) / 0x10) * 0x40;
            const c = (Math.floor(index / (tiles * 0x10)) % 2) * tiles * 0x40;
            const d = (Math.floor(index / (tiles * 0x40)) % 4) * tiles * 0x80;
            const e = (Math.floor(index / (tiles * 0x20)) % 2);
            const f = (index % 4) * 8;
            const g = Math.floor((index % 0x20) / 8) * 2;
            const h = Math.floor((index + (Math.floor(Math.floor(index / (tiles * 0x10) + 2) / 4) % 2) * 4) % 8 / 4) * 0x20;
            const m = Math.floor(index / (tiles * 0x800)) * tiles * 0x800;
            const n = (Math.floor(index / (tiles * 0x100)) % rows) * 0x40;
            const r = a + b + c + d + e + f + g + h + m + n;
            let x = source[Math.floor(r / 2)];
            if (r % 2 == 1) {
                x >>= 4;
            }
            v[j] = x & 0xF;
        }
        texView.setUint8(offs + i, v[0] | (v[1] << 4));
    }
}