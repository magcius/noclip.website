
import * as BMD from './bmd';
import * as GX from './gx_enum';
import * as GX_Material from './gx_material';
import * as GX_Texture from './gx_texture';
import * as Viewer from 'viewer';
import * as RARC from './rarc';
import * as YAZ0 from '../yaz0';

import { RenderFlags, RenderState, RenderPass } from '../render';
import { Progressable } from '../progress';
import { fetch, assert, readString } from '../util';

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

        this.shape.drawCalls.forEach((drawCall) => {
            gl.drawArrays(translatePrimType(gl, drawCall.primType), drawCall.first, drawCall.vertexCount);
        });

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
        switch (texFilter) {
        case GX.TexFilter.LIN_MIP_NEAR:
            return gl.LINEAR_MIPMAP_NEAREST;
        case GX.TexFilter.LIN_MIP_LIN:
            return gl.LINEAR_MIPMAP_LINEAR;
        case GX.TexFilter.LINEAR:
            return gl.LINEAR;
        case GX.TexFilter.NEAR_MIP_NEAR:
            return gl.NEAREST_MIPMAP_NEAREST;
        case GX.TexFilter.NEAR_MIP_LIN:
            return gl.NEAREST_MIPMAP_LINEAR;
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

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.translateTexFilter(gl, texture.minFilter));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.translateTexFilter(gl, texture.magFilter));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.translateWrapMode(gl, texture.wrapS));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.translateWrapMode(gl, texture.wrapT));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, texture.mipCount - 1);

        const ext_compressed_texture_s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
        const name = texture.name;
        const format = texture.format;

        let offs = 0, width = texture.width, height = texture.height;
        for (let i = 0; i < texture.mipCount; i++) {
            const size = GX_Texture.calcTextureSize(format, width, height);
            const data = texture.data.slice(offs, offs + size);
            const surface = { name, format, width, height, data };
            const decodedTexture = GX_Texture.decodeTexture(surface, !!ext_compressed_texture_s3tc);

            if (decodedTexture.type === 'RGBA') {
                gl.texImage2D(gl.TEXTURE_2D, i, gl.RGBA8, decodedTexture.width, decodedTexture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, decodedTexture.pixels);
            } else if (decodedTexture.type === 'S3TC') {
                gl.compressedTexImage2D(gl.TEXTURE_2D, i, ext_compressed_texture_s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT, decodedTexture.width, decodedTexture.height, 0, decodedTexture.pixels);
            }

            offs += size;
            width /= 2;
            height /= 2;
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

        // Bind our texture matrices.
        for (let i = 0; i < this.material.texMatrices.length; i++) {
            const texMtx = this.material.texMatrices[i];
            const location = this.program.getTexMtxLocation(i);
            if (texMtx !== null)
                gl.uniformMatrix3fv(location, false, texMtx.matrix);
        }
        state.useFlags(this.renderFlags);

        for (let i = 0; i < this.textures.length; i++) {
            const texture = this.textures[i];
            if (texture === null)
                continue;
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.uniform1i(this.program.getSamplerLocation(i), i);
            gl.bindTexture(gl.TEXTURE_2D, texture);
        }
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.textures.forEach((texture) => gl.deleteTexture(texture));
        this.program.destroy(gl);
    }
}

type Command = Command_Shape | Command_Material;

export class Scene {
    public gl: WebGL2RenderingContext;
    public textures: HTMLCanvasElement[];
    private bmd: BMD.BMD;
    private opaqueCommands: Command[];
    private transparentCommands: Command[];

    private materialCommands: Command_Material[];
    private shapeCommands: Command_Shape[];

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
        canvas.style.backgroundColor = 'black';
        const ctx = canvas.getContext('2d');
        const imgData = new ImageData(rgbaTexture.width, rgbaTexture.height);
        imgData.data.set(new Uint8Array(rgbaTexture.pixels.buffer));
        ctx.putImageData(imgData, 0, 0);
        return canvas;
    }

    public render(state: RenderState) {
        state.setClipPlanes(10, 500000);

        let commands;
        if (state.currentPass === RenderPass.OPAQUE) {
            commands = this.opaqueCommands;
        } else if (state.currentPass === RenderPass.TRANSPARENT) {
            commands = this.transparentCommands;
        }

        commands.forEach((command) => {
            command.exec(state);
        });
    }

    private translateModel(bmd: BMD.BMD) {
        this.materialCommands = bmd.mat3.materialEntries.map((material) => {
            return new Command_Material(this.gl, this.bmd, material);
        });
        this.shapeCommands = bmd.shp1.shapes.map((shape) => {
            return new Command_Shape(this.gl, this.bmd, shape);
        });

        this.opaqueCommands = [];
        this.transparentCommands = [];

        // Iterate through scene graph.
        // TODO(jstpierre): Clean this up.
        const context = {};
        this.translateSceneGraph(bmd.inf1.sceneGraph, context);
    }

    private translateSceneGraph(node: BMD.HierarchyNode, context) {
        switch (node.type) {
        case BMD.HierarchyType.Open:
            for (const child of node.children)
                this.translateSceneGraph(child, context);
            break;
        case BMD.HierarchyType.Shape:
            context.currentCommandList.push(this.shapeCommands[node.shapeIdx]);
            break;
        case BMD.HierarchyType.Joint:
            // XXX: Implement joints...
            break;
        case BMD.HierarchyType.Material:
            const materialIdx = this.bmd.mat3.remapTable[node.materialIdx];
            const materialCommand = this.materialCommands[materialIdx];
            context.currentCommandList = materialCommand.material.translucent ? this.transparentCommands : this.opaqueCommands;
            context.currentCommandList.push(materialCommand);
            break;
        }
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.materialCommands.forEach((command) => command.destroy(gl));
        this.shapeCommands.forEach((command) => command.destroy(gl));
    }
}

class MultiScene implements Viewer.Scene {
    public cameraController = Viewer.FPSCameraController;
    public renderPasses = [ RenderPass.OPAQUE, RenderPass.TRANSPARENT ];
    public scenes: Scene[];
    public textures: HTMLCanvasElement[];

    constructor(scenes: Scene[]) {
        this.scenes = scenes;
        this.textures = [];
        for (const scene of this.scenes)
            this.textures = this.textures.concat(scene.textures);
    }

    public render(renderState: RenderState) {
        this.scenes.forEach((scene) => {
            scene.render(renderState);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.scenes.forEach((scene) => scene.destroy(gl));
    }
}

export class SceneDesc implements Viewer.SceneDesc {
    public id: string;
    public name: string;
    public path: string;
    public vrbox: string;

    constructor(name: string, path: string, vrbox: string) {
        this.name = name;
        this.path = path;
        this.vrbox = vrbox;
        this.id = this.path;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.Scene> {
        const scenes = [ this.createSceneFromPath(gl, this.path) ];
        if (this.vrbox)
            scenes.push(this.createSceneFromPath(gl, this.vrbox));
        return Progressable.all(scenes).then((scenes) => {
            return new MultiScene(scenes);
        });
    }

    private createSceneFromPath(gl: WebGL2RenderingContext, path: string): Progressable<Scene> {
        if (!path)
            return new Progressable(Promise.resolve(null));

        return fetch(path).then((result: ArrayBuffer) => {
            if (readString(result, 0, 4) === 'Yaz0') {
                const dec = YAZ0.decompress(result);
                const rarc = RARC.parse(dec);
                result = rarc.files[0].buffer;
            }

            const bmd = BMD.parse(result);
            return new Scene(gl, bmd);
        });
    }
}
