
import * as Viewer from './viewer';
import { GfxSampler, GfxTexture, GfxDevice } from './gfx/platform/GfxPlatform';

// Used mostly by indirect texture FB installations...
export interface TextureOverride {
    glTexture?: WebGLTexture;
    gfxTexture?: GfxTexture;
    width: number;
    height: number;
    flipY: boolean;
}

export interface TextureBase {
    name: string;
    width: number;
    height: number;
}

export class TextureMapping {
    public gfxTexture: GfxTexture = null;
    public gfxSampler: GfxSampler = null;
    public width: number = 0;
    public height: number = 0;
    public lodBias: number = 0;
    // GL fucking sucks. This is a convenience when building texture matrices.
    // The core renderer does not use this code at all.
    public flipY: boolean = false;

    public reset(): void {
        this.gfxTexture = null;
        this.gfxSampler = null;
        this.width = 0;
        this.height = 0;
        this.lodBias = 0;
        this.flipY = false;
    }

    public copy(other: TextureMapping): void {
        this.gfxTexture = other.gfxTexture;
        this.gfxSampler = other.gfxSampler;
        this.width = other.width;
        this.height = other.height;
        this.lodBias = other.lodBias;
        this.flipY = other.flipY;
    }
}

export interface LoadedTexture {
    gfxTexture: GfxTexture;
    viewerTexture: Viewer.Texture;
}

export abstract class TextureHolder<TextureType extends TextureBase> {
    public viewerTextures: Viewer.Texture[] = [];
    public gfxTextures: GfxTexture[] = [];
    public textureEntries: TextureType[] = [];
    public textureOverrides = new Map<string, TextureOverride>();
    public onnewtextures: (() => void) | null = null;

    public destroy(device: GfxDevice): void {
        this.gfxTextures.forEach((texture) => device.destroyTexture(texture));
    }

    protected searchTextureEntryIndex(name: string): number {
        for (let i = 0; i < this.textureEntries.length; i++) {
            if (this.textureEntries[i].name === name)
                return i;
        }

        return -1;
    }

    protected findTextureEntryIndex(name: string): number {
        return this.searchTextureEntryIndex(name);
    }

    public hasTexture(name: string): boolean {
        return this.findTextureEntryIndex(name) >= 0;
    }

    protected fillTextureMappingFromEntry(textureMapping: TextureMapping, textureEntryIndex: number): void {
        textureMapping.gfxTexture = this.gfxTextures[textureEntryIndex];
        const tex0Entry = this.textureEntries[textureEntryIndex];
        textureMapping.width = tex0Entry.width;
        textureMapping.height = tex0Entry.height;
        textureMapping.flipY = false;
    }

    public fillTextureMapping(textureMapping: TextureMapping, name: string): boolean {
        const textureOverride = this.textureOverrides.get(name);
        if (textureOverride) {
            textureMapping.gfxTexture = textureOverride.gfxTexture;
            textureMapping.width = textureOverride.width;
            textureMapping.height = textureOverride.height;
            textureMapping.flipY = textureOverride.flipY;
            return true;
        }

        const textureEntryIndex = this.findTextureEntryIndex(name);
        if (textureEntryIndex >= 0) {
            this.fillTextureMappingFromEntry(textureMapping, textureEntryIndex);
            return true;
        }

        throw new Error(`Cannot find texture ${name}`);
    }

    public findTexture(name: string): TextureType | null {
        const textureEntryIndex = this.findTextureEntryIndex(name);
        if (textureEntryIndex >= 0) {
            return this.textureEntries[textureEntryIndex];
        }
        return null;
    }

    public setTextureOverride(name: string, textureOverride: TextureOverride, checkExisting: boolean = true): void {
        // Only allow setting texture overrides for textures that exist.
        if (checkExisting && !this.hasTexture(name))
           throw new Error(`Trying to override non-existent texture ${name}`);
        this.textureOverrides.set(name, textureOverride);
    }

    protected abstract loadTexture(device: GfxDevice, textureEntry: TextureType): LoadedTexture | null;

    public addTextures(device: GfxDevice, textureEntries: TextureType[]): void {
        for (let i = 0; i < textureEntries.length; i++) {
            const texture = textureEntries[i];

            // Don't add dupes for the same name.
            if (this.textureEntries.find((entry) => entry.name === texture.name) !== undefined)
                continue;

            const loadedTexture = this.loadTexture(device, texture);
            if (loadedTexture === null)
                continue;

            const { gfxTexture, viewerTexture } = loadedTexture;
            this.textureEntries.push(texture);
            this.gfxTextures.push(gfxTexture);
            this.viewerTextures.push(viewerTexture);
        }

        if (this.onnewtextures !== null)
            this.onnewtextures();
    }
}

export class FakeTextureHolder extends TextureHolder<any> {
    constructor(viewerTextures: Viewer.Texture[]) {
        super();
        this.viewerTextures = viewerTextures;
    }

    // Not allowed.
    public loadTexture(device: GfxDevice, entry: any): LoadedTexture {
        throw new Error();
    }
}
