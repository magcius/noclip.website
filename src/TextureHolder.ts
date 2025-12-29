
import * as Viewer from './viewer.js';
import { GfxSampler, GfxTexture, GfxDevice } from './gfx/platform/GfxPlatform.js';
import { TextureListHolder } from './ui.js';

export interface TextureOverride {
    gfxTexture: GfxTexture | null;
    gfxSampler?: GfxSampler;
    width: number;
    height: number;
    flipY: boolean;
    lateBinding?: string;
}

export interface TextureBase {
    name: string;
    width: number;
    height: number;
}

export class TextureMapping {
    public gfxTexture: GfxTexture | null = null;
    public gfxSampler: GfxSampler | null = null;
    public lateBinding: string | null = null;
    // These are not used when binding to samplers, and are conveniences for custom behavior.
    // TODO(jstpierre): Are any of these really worth anything?
    public width: number = 0;
    public height: number = 0;
    public lodBias: number = 0;
    // GL sucks. This is a convenience when building texture matrices.
    // The core renderer does not use this code at all.
    public flipY: boolean = false;

    public reset(): void {
        this.gfxTexture = null;
        this.gfxSampler = null;
        this.lateBinding = null;
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
        if (textureOverride.lateBinding)
            this.lateBinding = textureOverride.lateBinding;
        return true;
    }

    public copy(other: TextureMapping): void {
        this.gfxTexture = other.gfxTexture;
        this.gfxSampler = other.gfxSampler;
        this.lateBinding = other.lateBinding;
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

// TODO(jstpierre): TextureHolder needs to die.
export class TextureHolder implements TextureListHolder {
    public viewerTextures: Viewer.Texture[] = [];
    public gfxTextures: GfxTexture[] = [];
    public textureEntries: TextureBase[] = [];
    public textureOverrides = new Map<string, TextureOverride>();
    public onnewtextures: (() => void) | null = null;

    public get textureNames(): string[] {
        return this.viewerTextures.map((texture) => texture.name);
    }

    public async getViewerTexture(i: number) {
        const tex = this.viewerTextures[i];
        if (tex.surfaces.length === 0 && tex.activate !== undefined)
            await tex.activate();
        return tex;
    }

    public findTextureEntryIndex(name: string): number {
        for (let i = 0; i < this.textureEntries.length; i++) {
            if (this.textureEntries[i].name === name)
                return i;
        }

        return -1;
    }

    public hasTexture(name: string): boolean {
        return this.findTextureEntryIndex(name) >= 0;
    }

    protected fillTextureMappingFromEntry(textureMapping: TextureMapping, i: number): void {
        textureMapping.gfxTexture = this.gfxTextures[i];
        const texEntry = this.textureEntries[i];
        textureMapping.width = texEntry.width;
        textureMapping.height = texEntry.height;
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

        return false;
    }

    public setTextureOverride(name: string, textureOverride: TextureOverride): void {
        this.textureOverrides.set(name, textureOverride);
    }

    public destroy(device: GfxDevice): void {
        this.gfxTextures.forEach((texture) => device.destroyTexture(texture));
        this.viewerTextures.length = 0;
        this.gfxTextures.length = 0;
        this.textureEntries.length = 0;
        this.textureOverrides.clear();
    }
}

export class FakeTextureHolder extends TextureHolder {
    constructor(viewerTextures: Viewer.Texture[]) {
        super();
        this.viewerTextures = viewerTextures;
    }
}
