
import * as BMD from './bmd';
import * as GX from './gx';
import * as Texture from './texture';
import * as Viewer from 'viewer';

import { fetch } from 'util';
import { Progressable } from '../progress';

class BlackProgram extends Viewer.Program {
    public static a_position = 0;
    public static a_tex0 = 1;
    public static a_clr0 = 2;
    public scalePositionLocation: WebGLUniformLocation;

    public vert = `
precision mediump float;
uniform mat4 u_modelView;
uniform mat4 u_projection;
uniform float u_scalePosition;
layout(location = ${BlackProgram.a_position}) in vec3 a_position;
layout(location = ${BlackProgram.a_tex0}) in vec2 a_tex0;
layout(location = ${BlackProgram.a_clr0}) in vec4 a_clr0;
out vec2 v_tex0;
out vec4 v_clr0;

void main() {
    v_tex0 = a_tex0;
    v_clr0 = a_clr0;

    vec4 scaledPosition = vec4(a_position * u_scalePosition, 1.0);
    gl_Position = u_projection * u_modelView * scaledPosition;
}`;

    public frag = `
precision mediump float;
uniform sampler2D u_tex0;
in vec2 v_tex0;
in vec4 v_clr0;

void main() {
    gl_FragColor = v_clr0; // texture(u_tex0, v_tex0);
    gl_FragColor.a = 1.0;
}
`;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);

        this.scalePositionLocation = gl.getUniformLocation(prog, "u_scalePosition");
    }

    public static getAttribLocation(vtxAttrib: GX.VertexAttribute) {
        switch (vtxAttrib) {
        case GX.VertexAttribute.POS:
            return this.a_position;
        case GX.VertexAttribute.TEX0:
            return this.a_tex0;
        case GX.VertexAttribute.CLR0:
            return this.a_clr0;
        }
        return null;
    }

    public getScaleUniformLocation(vtxAttrib: GX.VertexAttribute) {
        switch (vtxAttrib) {
        case GX.VertexAttribute.POS:
            return this.scalePositionLocation;
        }
        return null;
    }
}

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

            const attribLocation = BlackProgram.getAttribLocation(attrib.vtxAttrib);
            if (attribLocation === null) continue; // XXX(jstpierre)
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

    public exec(state: Viewer.RenderState) {
        const gl = state.gl;

        // Bind our uniforms.
        const prog = (<BlackProgram> state.currentProgram);

        // First up, bind vtx attr scales.
        for (const attrib of this.shape.packedVertexAttributes) {
            const location = prog.getScaleUniformLocation(attrib.vtxAttrib);
            if (location === null)
                continue;
            const vertexArray = this.bmd.vtx1.vertexArrays.get(attrib.vtxAttrib);
            gl.uniform1f(location, vertexArray.scale);
        }

        gl.bindVertexArray(this.vao);

        // Do draw calls.
        for (const drawCall of this.shape.drawCalls) {
            gl.drawArrays(translatePrimType(gl, drawCall.primType), drawCall.first, drawCall.vertexCount);
        }

        gl.bindVertexArray(null);
    }
}

class Command_Material {
    public bmd: BMD.BMD;
    public material: BMD.MaterialEntry;

    private tex0: WebGLTexture = null;
    private renderFlags: Viewer.RenderFlags;

    constructor(gl: WebGL2RenderingContext, bmd: BMD.BMD, material: BMD.MaterialEntry) {
        this.bmd = bmd;
        this.material = material;

        this.renderFlags = Command_Material.translateRenderFlags(this.material);

        const tex0Index = this.material.textureIndexes[6];
        if (tex0Index > 0)
            this.tex0 = Command_Material.translateTexture(gl, this.bmd.tex1.textures[tex0Index]);
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
        const decodedTexture = Texture.decodeTexture(texture, !!ext_compressed_texture_s3tc);
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

    private static translateCullMode(cullMode: GX.CullMode): Viewer.RenderCullMode {
        switch (cullMode) {
        case GX.CullMode.ALL:
            return Viewer.RenderCullMode.FRONT_AND_BACK;
        case GX.CullMode.FRONT:
            return Viewer.RenderCullMode.FRONT;
        case GX.CullMode.BACK:
            return Viewer.RenderCullMode.BACK;
        case GX.CullMode.NONE:
            return Viewer.RenderCullMode.NONE;
        }
    }

    private static translateRenderFlags(material: BMD.MaterialEntry): Viewer.RenderFlags {
        const renderFlags = new Viewer.RenderFlags();
        renderFlags.cullMode = this.translateCullMode(material.cullMode);
        renderFlags.depthWrite = material.depthWrite;
        renderFlags.depthTest = material.depthTest;
        renderFlags.frontFace = Viewer.RenderFrontFaceMode.CW;
        return renderFlags;
    }

    public exec(state: Viewer.RenderState) {
        const gl = state.gl;

        state.useFlags(this.renderFlags);
        gl.bindTexture(gl.TEXTURE_2D, this.tex0);
    }
}

type Command = Command_Shape | Command_Material;

export class Scene implements Viewer.Scene {
    public gl: WebGL2RenderingContext;
    public cameraController = Viewer.FPSCameraController;
    public textures: HTMLCanvasElement[];
    private program_Black: BlackProgram;
    private bmd: BMD.BMD;
    private commands: Command[];

    constructor(gl: WebGL2RenderingContext, bmd: BMD.BMD) {
        this.gl = gl;
        this.program_Black = new BlackProgram();
        this.bmd = bmd;
        this.translateModel(this.bmd);

        this.textures = this.bmd.tex1.textures.map((tex) => this.translateTextureToCanvas(tex));
    }

    private translateTextureToCanvas(texture: BMD.TEX1_Texture): HTMLCanvasElement {
        const rgbaTexture = Texture.decodeTexture(texture, false);
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

    public render(state: Viewer.RenderState) {
        state.useProgram(this.program_Black);
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
