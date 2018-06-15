
import * as Viewer from "../viewer";
import { RenderState, RenderFlags } from "../render";
import * as BRRES from './brres';

import * as GX from '../gx/gx_enum';
import * as GX_Texture from '../gx/gx_texture';
import * as GX_Material from '../gx/gx_material';
import { align, assert } from "../util";
import { mat3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import BufferCoalescer, { CoalescedBuffers } from "../BufferCoalescer";

export class Scene implements Viewer.MainScene {
    public textures: Viewer.Texture[];
    private glTextures: WebGLTexture[];

    constructor(gl: WebGL2RenderingContext, public rres: BRRES.RRES) {
        this.textures = rres.textures.map((texture) => Scene.translateTextureToViewer(texture));
        this.glTextures = rres.textures.map((texture) => Scene.translateTexture(gl, texture));
        this.translateRRES(gl, rres);
    }

    public render(state: RenderState): void {
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.glTextures.forEach((texture) => gl.deleteTexture(texture));
    }

    private translateRRES(gl: WebGL2RenderingContext, rres: BRRES.RRES): void {
    }

    public static translateTexture(gl: WebGL2RenderingContext, texture: BRRES.TEX0): WebGLTexture {
        const texId = gl.createTexture();
        (<any> texId).name = texture.name;
        gl.bindTexture(gl.TEXTURE_2D, texId);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, texture.mipCount - 1);

        const format = texture.format;

        let offs = 0, width = texture.width, height = texture.height;
        for (let i = 0; i < texture.mipCount; i++) {
            const name = texture.name;
            const size = GX_Texture.calcTextureSize(format, width, height);
            const data = texture.data !== null ? texture.data.subarray(offs, size) : null;
            const surface = { name, format, width, height, data };
            const level = i;
            GX_Texture.decodeTexture(surface).then((rgbaTexture) => {
                gl.bindTexture(gl.TEXTURE_2D, texId);
                gl.texImage2D(gl.TEXTURE_2D, level, gl.RGBA8, surface.width, surface.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgbaTexture.pixels);
            });
            offs += size;
            width /= 2;
            height /= 2;
        }

        return texId;
    }

    private static translateTextureToViewer(texture: BRRES.TEX0): Viewer.Texture {
        const surfaces = [];

        let width = texture.width, height = texture.height, offs = 0;
        const format = texture.format;
        for (let i = 0; i < texture.mipCount; i++) {
            const name = texture.name;
            const size = GX_Texture.calcTextureSize(format, width, height);
            const data = texture.data !== null ? texture.data.subarray(offs, size) : null;
            const surface = { name, format, width, height, data };
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.title = `${texture.name} ${texture.format}`;
            GX_Texture.decodeTexture(surface).then((rgbaTexture) => {
                const ctx = canvas.getContext('2d');
                const imgData = new ImageData(surface.width, surface.height);
                imgData.data.set(new Uint8Array(rgbaTexture.pixels.buffer));
                ctx.putImageData(imgData, 0, 0);
            });
            surfaces.push(canvas);

            offs += size;
            width /= 2;
            height /= 2;
        }

        return { name: texture.name, surfaces };
    }
}
