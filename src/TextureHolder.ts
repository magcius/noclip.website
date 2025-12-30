
import * as Viewer from './viewer.js';
import { GfxSampler, GfxTexture, GfxDevice } from './gfx/platform/GfxPlatform.js';
import { TextureListHolder } from './ui.js';

export interface TextureBase {
    name: string;
    width: number;
    height: number;
}

export class TextureMapping {
    public gfxTexture: GfxTexture | null = null;
    public gfxSampler: GfxSampler | null = null;
    public lateBinding: string | null = null;

    public reset(): void {
        this.gfxTexture = null;
        this.gfxSampler = null;
        this.lateBinding = null;
    }

    public copy(other: TextureMapping): void {
        this.gfxTexture = other.gfxTexture;
        this.gfxSampler = other.gfxSampler;
        this.lateBinding = other.lateBinding;
    }
}

// TODO(jstpierre): TextureHolder needs to die.
export class TextureHolder implements TextureListHolder {
    public gfxTextures: GfxTexture[] = [];
    public viewerTextures: Viewer.Texture[] = [];
    public _textureNames: string[] = [];
    public onnewtextures: (() => void) | null = null;

    public get textureNames(): string[] {
        return this._textureNames;
    }

    public async getViewerTexture(i: number) {
        return this.viewerTextures[i];
    }

    public fillTextureMapping(dst: TextureMapping, name: string): boolean {
        const textureEntryIndex = this.textureNames.indexOf(name);
        if (textureEntryIndex >= 0) {
            dst.gfxTexture = this.gfxTextures[textureEntryIndex];
            return true;
        }

        return false;
    }

    public destroy(device: GfxDevice): void {
        this.gfxTextures.forEach((texture) => device.destroyTexture(texture));
        this.gfxTextures.length = 0;
        this.viewerTextures.length = 0;
        this.textureNames.length = 0;
    }
}

export class FakeTextureHolder extends TextureHolder {
    constructor(viewerTextures: Viewer.Texture[]) {
        super();
        this.viewerTextures = viewerTextures;
    }

    public override get textureNames(): string[] {
        return this.viewerTextures.map((tex) => tex.name);
    }
}
