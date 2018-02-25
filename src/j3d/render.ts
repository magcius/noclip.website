
import * as BMD from './bmd';
import * as GX from './gx_enum';
import * as GX_Material from './gx_material';
import * as GX_Texture from './gx_texture';
import * as Viewer from 'viewer';

import { RenderFlags, RenderState } from '../render';
import { Progressable } from '../progress';
import { fetch } from '../util';

function translateCompType(gl: WebGL2RenderingContext, compType: GX.CompType): { type: GLenum, normalized: boolean } {
    switch (compType) {
    case GX.CompType.F32:
        return { type: gl.FLOAT, normalized: false };
    case GX.CompType.S8:
        return { type: gl.BYTE, normalized: false };
    case GX.CompType.S16:
        return { type: gl.SHORT, normalized: false };
    case GX.CompType.U16:
        return { type: gl.UNSIGNED_SHORT, normalized: false };
    case GX.CompType.U8:
        return { type: gl.UNSIGNED_BYTE, normalized: false };
    case GX.CompType.RGBA8: // XXX: Is this right?
        return { type: gl.UNSIGNED_BYTE, normalized: true };
    default:
        throw new Error(`Unknown CompType ${compType}`);
    }
}

function translatePrimType(gl: WebGL2RenderingContext, primType: GX.PrimitiveType): number {
    switch (primType) {
    case GX.PrimitiveType.TRIANGLESTRIP:
        return gl.TRIANGLE_STRIP;
    case GX.PrimitiveType.TRIANGLEFAN:
        return gl.TRIANGLE_FAN;
    default:
        throw new Error(`Unknown PrimType ${primType}`);
    }
}

class Command_Shape {
    public bmd: BMD.BMD;
    public shape: BMD.Shape;
    public buffer: WebGLBuffer;
    public vao: WebGLVertexArrayObject;

    constructor(gl: WebGL2RenderingContext, bmd: BMD.BMD, shape: BMD.Shape) {
        this.bmd = bmd;
        this.shape = shape;
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        this.buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.shape.packedData, gl.STATIC_DRAW);

        for (const attrib of this.shape.packedVertexAttributes) {
            const vertexArray = this.bmd.vtx1.vertexArrays.get(attrib.vtxAttrib);

            const attribLocation = attrib.vtxAttrib;
            gl.enableVertexAttribArray(attribLocation);

            const { type, normalized } = translateCompType(gl, vertexArray.compType);

            gl.vertexAttribPointer(
                attribLocation,
                vertexArray.compCount,
                type, normalized,
                this.shape.packedVertexSize,
                attrib.offset,
            );
        }
    }

    public exec(state: RenderState) {
        const gl = state.gl;

        gl.bindVertexArray(this.vao);

        // Do draw calls.
        for (const drawCall of this.shape.drawCalls) {
            gl.drawArrays(translatePrimType(gl, drawCall.primType), drawCall.first, drawCall.vertexCount);
        }

        gl.bindVertexArray(null);
    }

    public destroy(gl: WebGL2RenderingContext) {
        gl.deleteVertexArray(this.vao);
        gl.deleteBuffer(this.buffer);
    }
}

class Command_Material {
    public bmd: BMD.BMD;
    public material: GX_Material.GXMaterial;

    private textures: WebGLTexture[] = [];
    private renderFlags: RenderFlags;
    private program: GX_Material.GX_Program;

    constructor(gl: WebGL2RenderingContext, bmd: BMD.BMD, material: GX_Material.GXMaterial) {
        this.bmd = bmd;
        this.material = material;
        this.program = new GX_Material.GX_Program(material);
        this.renderFlags = GX_Material.translateRenderFlags(this.material);

        this.textures = this.translateTextures(gl);
    }

    private translateTextures(gl: WebGL2RenderingContext): WebGLTexture[] {
        const textures = [];
        for (let i = 0; i < this.material.textureIndexes.length; i++) {
            const texIndex = this.material.textureIndexes[i];
            if (texIndex >= 0)
                textures[i] = Command_Material.translateTexture(gl, this.bmd.tex1.textures[texIndex]);
            else
                textures[i] = null;
        }
        return textures;
    }

    private static translateTexFilter(gl: WebGL2RenderingContext, texFilter: GX.TexFilter) {
        // TODO(jstpierre): Upload mipmaps as well.
        switch (texFilter) {
        case GX.TexFilter.LIN_MIP_NEAR:
        case GX.TexFilter.LIN_MIP_LIN:
        case GX.TexFilter.LINEAR:
            return gl.LINEAR;
        case GX.TexFilter.NEAR_MIP_NEAR:
        case GX.TexFilter.NEAR_MIP_LIN:
        case GX.TexFilter.NEAR:
            return gl.NEAREST;
        }
    }

    private static translateWrapMode(gl: WebGL2RenderingContext, wrapMode: GX.WrapMode) {
        switch (wrapMode) {
        case GX.WrapMode.CLAMP:
            return gl.CLAMP_TO_EDGE;
        case GX.WrapMode.MIRROR:
            return gl.MIRRORED_REPEAT;
        case GX.WrapMode.REPEAT:
            return gl.REPEAT;
        }
    }

    private static translateTexture(gl: WebGL2RenderingContext, texture: BMD.TEX1_Texture) {
        const texId = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texId);

        const ext_compressed_texture_s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
        const decodedTexture = GX_Texture.decodeTexture(texture, !!ext_compressed_texture_s3tc);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.translateTexFilter(gl, texture.minFilter));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.translateTexFilter(gl, texture.magFilter));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.translateWrapMode(gl, texture.wrapS));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.translateWrapMode(gl, texture.wrapT));

        if (decodedTexture.type === 'RGBA') {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, decodedTexture.width, decodedTexture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, decodedTexture.pixels);
        } else if (decodedTexture.type === 'S3TC') {
            gl.compressedTexImage2D(gl.TEXTURE_2D, 0, ext_compressed_texture_s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT, decodedTexture.width, decodedTexture.height, 0, decodedTexture.pixels);
        }

        return texId;
    }

    public exec(state: RenderState) {
        const gl = state.gl;

        state.useProgram(this.program);

        // Bind our scale uniforms.
        for (const vertexArray of this.bmd.vtx1.vertexArrays.values()) {
            const location = this.program.getScaleUniformLocation(vertexArray.vtxAttrib);
            if (location === null)
                continue;
            gl.uniform1f(location, vertexArray.scale);
        }

        state.useFlags(this.renderFlags);

        for (let i = 0; i < this.textures.length; i++) {
            const texture = this.textures[i];
            if (texture === null)
                continue;
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, texture);
        }
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.textures.forEach((texture) => gl.deleteTexture(texture));
        this.program.destroy(gl);
    }
}

type Command = Command_Shape | Command_Material;

export class Scene implements Viewer.Scene {
    public gl: WebGL2RenderingContext;
    public cameraController = Viewer.FPSCameraController;
    public textures: HTMLCanvasElement[];
    private bmd: BMD.BMD;
    private commands: Command[];

    constructor(gl: WebGL2RenderingContext, bmd: BMD.BMD) {
        this.gl = gl;
        this.bmd = bmd;
        this.translateModel(this.bmd);

        this.textures = this.bmd.tex1.textures.map((tex) => this.translateTextureToCanvas(tex));
    }

    private translateTextureToCanvas(texture: BMD.TEX1_Texture): HTMLCanvasElement {
        const rgbaTexture = GX_Texture.decodeTexture(texture, false);
        // Should never happen.
        if (rgbaTexture.type === 'S3TC')
            return null;
        const canvas = document.createElement('canvas');
        canvas.width = rgbaTexture.width;
        canvas.height = rgbaTexture.height;
        canvas.title = `${texture.name} ${texture.format}`;
        const ctx = canvas.getContext('2d');
        const imgData = new ImageData(rgbaTexture.width, rgbaTexture.height);
        imgData.data.set(new Uint8Array(rgbaTexture.pixels.buffer));
        ctx.putImageData(imgData, 0, 0);
        return canvas;
    }

    public render(state: RenderState) {
        for (const command of this.commands)
            command.exec(state);
    }

    private translateModel(bmd: BMD.BMD) {
        this.commands = [];
        // Iterate through scene graph.
        this.translateSceneGraph(bmd.inf1.sceneGraph);
    }

    private translateSceneGraph(node: BMD.HierarchyNode) {
        switch (node.type) {
        case BMD.HierarchyType.Open:
            for (const child of node.children)
                this.translateSceneGraph(child);
            break;
        case BMD.HierarchyType.Shape:
            const shape = this.bmd.shp1.shapes[node.shapeIdx];
            this.commands.push(new Command_Shape(this.gl, this.bmd, shape));
            break;
        case BMD.HierarchyType.Joint:
            // XXX: Implement joints...
            break;
        case BMD.HierarchyType.Material:
            const material = this.bmd.mat3.materialEntries[node.materialIdx];
            this.commands.push(new Command_Material(this.gl, this.bmd, material));
            break;
        }
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.commands.forEach((command) => command.destroy(gl));
    }
}

export class SceneDesc implements Viewer.SceneDesc {
    public id: string;
    public name: string;
    public path: string;

    constructor(name: string, path: string) {
        this.name = name;
        this.path = path;
        this.id = this.path;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Scene> {
        return fetch(this.path).then((result: ArrayBuffer) => {
            const bmd = BMD.parse(result);
            return new Scene(gl, bmd);
        });
    }
}
