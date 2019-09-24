
import * as Viewer from './viewer';
import { GfxSampler, GfxTexture, GfxDevice } from './gfx/platform/GfxPlatform';

// Used mostly by indirect texture FB installations...
export interface TextureOverride {
    gfxTexture: GfxTexture;
    gfxSampler?: GfxSampler;
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
    public gfxTexture: GfxTexture | null = null;
    public gfxSampler: GfxSampler | null = null;
    public width: number = 0;
    public height: number = 0;
    public lodBias: number = 0;
    // GL sucks. This is a convenience when building texture matrices.
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

    public fillFromTextureOverride(textureOverride: TextureOverride): boolean {
        this.gfxTexture = textureOverride.gfxTexture;
        if (textureOverride.gfxSampler)
            this.gfxSampler = textureOverride.gfxSampler;
        this.width = textureOverride.width;
        this.height = textureOverride.height;
        this.flipY = textureOverride.flipY;
        return true;
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
        this.viewerTextures.length = 0;
        this.gfxTextures.length = 0;
        this.textureEntries.length = 0;
        this.textureOverrides.clear();
    }

    protected searchTextureEntryIndex(name: string): number {
        for (let i = 0; i < this.textureEntries.length; i++) {
            if (this.textureEntries[i].name === name)
                return i;
        }

        return -1;
    }

    public findTextureEntryIndex(name: string): number {
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
            textureMapping.fillFromTextureOverride(textureOverride);
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
        if (textureEntryIndex >= 0)
            return this.textureEntries[textureEntryIndex];
        return null;
    }

    public setTextureOverride(name: string, textureOverride: TextureOverride, checkExisting: boolean = true): void {
        // Only allow setting texture overrides for textures that exist.
        if (checkExisting && !this.hasTexture(name))
           throw new Error(`Trying to override non-existent texture ${name}`);
        this.textureOverrides.set(name, textureOverride);
    }

    protected abstract loadTexture(device: GfxDevice, textureEntry: TextureType): LoadedTexture | null;

    public addTextures(device: GfxDevice, textureEntries: (TextureType | null)[], overwrite: boolean = false): void {
        for (let i = 0; i < textureEntries.length; i++) {
            const texture = textureEntries[i];
            if (texture === null)
                continue;

            let index = this.textureEntries.findIndex((entry) => entry.name === texture.name);
            // Don't add dupes for the same name.
            if (index >= 0 && !overwrite)
                continue;
            if (index < 0)
                index = this.textureEntries.length;

            const loadedTexture = this.loadTexture(device, texture);
            if (loadedTexture === null)
                continue;

            const { gfxTexture, viewerTexture } = loadedTexture;
            this.textureEntries[index] = texture;
            this.gfxTextures[index] = gfxTexture;
            this.viewerTextures[index] = viewerTexture;
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
