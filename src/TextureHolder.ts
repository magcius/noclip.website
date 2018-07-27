
import * as Viewer from './viewer';

// Used mostly by indirect texture FB installations...
export interface TextureOverride {
    glTexture: WebGLTexture;
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
    public width: number = 0;
    public height: number = 0;
    public lodBias: number = 0;
    // GL fucking sucks. This is a convenience when building texture matrices.
    // gx_render does *not* use this parameter at all!
    public flipY: boolean = false;
}

export interface LoadedTexture {
    glTexture: WebGLTexture;
    viewerTexture: Viewer.Texture;
}

export abstract class TextureHolder<TextureType extends TextureBase> {
    public viewerTextures: Viewer.Texture[] = [];
    public glTextures: WebGLTexture[] = [];
    public textureEntries: TextureType[] = [];
    public textureOverrides = new Map<string, TextureOverride>();

    public destroy(gl: WebGL2RenderingContext): void {
        this.glTextures.forEach((texture) => gl.deleteTexture(texture));
    }

    // TODO(jstpierre): Optimize interface to not require an array construct every frame...
    protected tryTextureNameVariants(name: string): string[] {
        // Default implementation.
        return null;
    }

    private findTextureEntryIndex(name: string): number {
        const nameVariants = this.tryTextureNameVariants(name);

        if (nameVariants !== null) {
            for (let j = 0; j < nameVariants.length; j++) {
                for (let i = 0; i < this.textureEntries.length; i++) {
                    if (this.textureEntries[i].name === nameVariants[j])
                        return i;
                }
            }
        } else {
            for (let i = 0; i < this.textureEntries.length; i++) {
                if (this.textureEntries[i].name === name)
                    return i;
            }
        }

        // console.error("Cannot find texture", name);
        return -1;
    }

    public hasTexture(name: string): boolean {
        return this.findTextureEntryIndex(name) >= 0;
    }

    public fillTextureMapping(textureMapping: TextureMapping, name: string): boolean {
        const textureOverride = this.textureOverrides.get(name);
        if (textureOverride) {
            textureMapping.glTexture = textureOverride.glTexture;
            textureMapping.width = textureOverride.width;
            textureMapping.height = textureOverride.height;
            textureMapping.flipY = textureOverride.flipY;
            return true;
        }

        const textureEntryIndex = this.findTextureEntryIndex(name);
        if (textureEntryIndex >= 0) {
            textureMapping.glTexture = this.glTextures[textureEntryIndex];
            const tex0Entry = this.textureEntries[textureEntryIndex];
            textureMapping.width = tex0Entry.width;
            textureMapping.height = tex0Entry.height;
            textureMapping.flipY = false;
            return true;
        }

        return false;
    }

    public setTextureOverride(name: string, textureOverride: TextureOverride): void {
        // Only allow setting texture overrides for textures that exist.
        // TODO(jstpierre): Bring this back when I fix ZTP scene loader.
        // if (!this.hasTexture(name))
        //    throw new Error(`Trying to override non-existent texture ${name}`);
        this.textureOverrides.set(name, textureOverride);
    }

    protected abstract addTexture(gl: WebGL2RenderingContext, textureEntry: TextureType): LoadedTexture | null;

    public addTextures(gl: WebGL2RenderingContext, textureEntries: TextureType[]): void {
        for (const texture of textureEntries) {
            // Don't add dupes for the same name.
            if (this.textureEntries.find((entry) => entry.name === texture.name) !== undefined)
                continue;

            const loadedTexture = this.addTexture(gl, texture);
            if (loadedTexture === null)
                continue;

            const { glTexture, viewerTexture } = loadedTexture;
            this.textureEntries.push(texture);
            this.glTextures.push(glTexture);
            this.viewerTextures.push(viewerTexture);
        }
    }
}
