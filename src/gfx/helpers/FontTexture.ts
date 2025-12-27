
import { GfxDevice, GfxFormat, GfxTexture, GfxTextureDimension, GfxTextureUsage } from "../platform/GfxPlatform";

export class FontTexture {
    private readonly characters: string = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
    public readonly characterAdvanceX: number[] = [];
    public readonly gfxTexture: GfxTexture;
    public readonly cellWidth: number;
    public readonly cellHeight: number;

    constructor(device: GfxDevice, font: string, public readonly baseSize: number, public readonly strokeAmount: number = 5/32) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        const fontStr = `${this.baseSize}px ${font}`;
        ctx.font = fontStr;
        ctx.textAlign = `left`;
        ctx.textBaseline = `top`;

        // Would be nice if stroke width was independent of font size, but that doesn't seem easy.
        const strokeWidth = strokeAmount * this.baseSize;

        let cellWidth = 0;
        let cellHeight = 0;
        for (let i = 0; i < this.characters.length; i++) {
            const c = this.characters[i];
            const measure = ctx.measureText(c);
            this.characterAdvanceX[i] = measure.width;
            const w = Math.ceil(measure.actualBoundingBoxRight + measure.actualBoundingBoxLeft);
            const h = Math.ceil(measure.actualBoundingBoxDescent + measure.actualBoundingBoxAscent);
            cellWidth = Math.max(cellWidth, w);
            cellHeight = Math.max(cellHeight, h);
        }

        // Padding
        const extra = strokeWidth * 0.5;
        cellWidth += extra * 2;
        cellHeight += extra * 2;

        this.cellWidth = cellWidth;
        this.cellHeight = cellHeight;

        canvas.width = cellWidth;
        canvas.height = cellHeight;

        this.gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2DArray,
            width: cellWidth,
            height: cellHeight,
            depthOrArrayLayers: this.characters.length,
            pixelFormat: GfxFormat.U8_R_NORM,
            numLevels: 1,
            usage: GfxTextureUsage.Sampled | GfxTextureUsage.RenderTarget,
        });
        device.setResourceName(this.gfxTexture, `FontTexture ${font}`);

        ctx.font = fontStr;
        ctx.textAlign = `left`;
        ctx.textBaseline = `top`;

        ctx.strokeStyle = `rgba(255, 255, 255, 0.5)`;
        ctx.lineWidth = strokeWidth;
        for (let i = 0; i < this.characters.length; i++) {
            ctx.fillStyle = `black`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const char = this.characters[i];
            ctx.fillStyle = `rgba(255, 255, 255, 1.0)`;
            ctx.strokeText(char, extra, extra);
            ctx.fillText(char, extra, extra);

            device.copyCanvasToTexture(this.gfxTexture, i, canvas);
        }
    }

    public getFontScale(size: number): number {
        return size / this.baseSize;
    }

    public getCharacterIndex(c: string): number {
        return this.characters.indexOf(c);
    }

    public getCharacterAdvanceX(index: number): number {
        return this.characterAdvanceX[index];
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

export class FontTextureCache {
    private cache = new Map<string, FontTexture>();

    private static getBaseSize(size: number): number {
        if (size <= 12)
            return 12;
        else if (size <= 32)
            return 32;
        else
            return 64;
    }

    private static getCacheKey(font: string, size: number): string {
        return `${size}px ${font}`;
    }

    public getFont(device: GfxDevice, size: number, fontName: string = `sans-serif`): FontTexture {
        const baseSize = FontTextureCache.getBaseSize(size);
        const cacheKey = FontTextureCache.getCacheKey(fontName, baseSize);
        if (!this.cache.has(cacheKey))
            this.cache.set(cacheKey, new FontTexture(device, fontName, baseSize));
        return this.cache.get(cacheKey)!;
    }

    public destroy(device: GfxDevice): void {
        for (const fontTexture of this.cache.values())
            fontTexture.destroy(device);
    }
}
