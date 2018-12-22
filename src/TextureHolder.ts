
import * as Viewer from './viewer';
import { GfxSampler, GfxTexture, GfxDevice } from './gfx/platform/GfxPlatform';
import { getTransitionDeviceForWebGL2, getPlatformTexture, getPlatformSampler } from './gfx/platform/GfxPlatformWebGL2';
import { RenderState } from './render';

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
    public glTexture: WebGLTexture = null;
    public glSampler: WebGLSampler = null;
    public gfxTexture: GfxTexture = null;
    public gfxSampler: GfxSampler = null;
    public width: number = 0;
    public height: number = 0;
    public lodBias: number = 0;
    // GL fucking sucks. This is a convenience when building texture matrices.
    // gx_render does *not* use this parameter at all!
    public flipY: boolean = false;

    public reset(): void {
        this.glTexture = null;
        this.glSampler = null;
        this.gfxTexture = null;
        this.gfxSampler = null;
        this.width = 0;
        this.height = 0;
        this.lodBias = 0;
        this.flipY = false;
    }

    public copy(other: TextureMapping): void {
        this.glTexture = other.glTexture;
        this.glSampler = other.glSampler;
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

    public destroyGfx(device: GfxDevice): void {
        this.gfxTextures.forEach((texture) => device.destroyTexture(texture));
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.destroyGfx(getTransitionDeviceForWebGL2(gl));
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
            textureMapping.glTexture = textureOverride.glTexture;
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

    public setTextureOverride(name: string, textureOverride: TextureOverride): void {
        // Only allow setting texture overrides for textures that exist.
        if (!this.hasTexture(name))
           throw new Error(`Trying to override non-existent texture ${name}`);
        this.textureOverrides.set(name, textureOverride);
    }

    protected abstract addTextureGfx(device: GfxDevice, textureEntry: TextureType): LoadedTexture | null;

    protected addTexture(gl: WebGL2RenderingContext, textureEntry: TextureType): LoadedTexture | null {
        return this.addTextureGfx(getTransitionDeviceForWebGL2(gl), textureEntry);
    }

    public addTextures(gl: WebGL2RenderingContext, textureEntries: TextureType[]): void {
        for (let i = 0; i < textureEntries.length; i++) {
            const texture = textureEntries[i];

            // Don't add dupes for the same name.
            if (this.textureEntries.find((entry) => entry.name === texture.name) !== undefined)
                continue;

            const loadedTexture = this.addTexture(gl, texture);
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

    public addTexturesGfx(device: GfxDevice, textureEntries: TextureType[]): void {
        for (let i = 0; i < textureEntries.length; i++) {
            const texture = textureEntries[i];

            // Don't add dupes for the same name.
            if (this.textureEntries.find((entry) => entry.name === texture.name) !== undefined)
                continue;

            const loadedTexture = this.addTextureGfx(device, texture);
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

export function getGLTextureFromMapping(m: TextureMapping): WebGLTexture | null {
    if (m.gfxTexture)
        return getPlatformTexture(m.gfxTexture);
    else if (m.glTexture)
        return m.glTexture;
    else
        return null;
}

export function getGLSamplerFromMapping(m: TextureMapping): WebGLSampler | null {
    if (m.glSampler !== null)
        return m.glSampler;
    else if (m.gfxSampler !== null)
        return getPlatformSampler(m.gfxSampler);
    else
        return null;
}

export function bindGLTextureMappings(state: RenderState, textureMappings: TextureMapping[]): void {
    const gl = state.gl;

    for (let i = 0; i < textureMappings.length; i++) {
        const m = textureMappings[i];
        const glTexture = getGLTextureFromMapping(m);
        if (glTexture === null)
            continue;

        const glSampler = getGLSamplerFromMapping(m);
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, glTexture);
        gl.bindSampler(i, glSampler);
        state.renderStatisticsTracker.textureBindCount++;
    }
}
