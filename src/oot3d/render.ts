
import * as CMB from './cmb';
import * as ZSI from './zsi';

import * as Viewer from '../viewer';

import { Progressable } from '../progress';
import { CullMode, RenderFlags, RenderState, Program } from '../render';
import { fetch } from '../util';

class OoT3D_Program extends Program {
    public posScaleLocation: WebGLUniformLocation;
    public uvScaleLocation: WebGLUniformLocation;
    public alphaTestLocation: WebGLUniformLocation;

    public static a_position = 0;
    public static a_color = 1;
    public static a_uv = 2;

    public vert = `
precision mediump float;

uniform mat4 u_modelView;
uniform mat4 u_localMatrix;
uniform mat4 u_projection;
uniform float u_posScale;
uniform float u_uvScale;
layout(location = ${OoT3D_Program.a_position}) in vec3 a_position;
layout(location = ${OoT3D_Program.a_uv}) in vec2 a_uv;
layout(location = ${OoT3D_Program.a_color}) in vec4 a_color;
varying vec4 v_color;
varying vec2 v_uv;

void main() {
    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0) * u_posScale;
    v_color = a_color;
    v_uv = a_uv * u_uvScale;
    v_uv.t = 1.0 - v_uv.t;
}`;

    public frag = `
precision mediump float;
varying vec2 v_uv;
varying vec4 v_color;
uniform sampler2D u_texture;
uniform bool u_alphaTest;

void main() {
    gl_FragColor = texture2D(u_texture, v_uv);
    gl_FragColor *= v_color;
    if (u_alphaTest && gl_FragColor.a <= 0.8)
        discard;
}`;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);

        this.posScaleLocation = gl.getUniformLocation(prog, "u_posScale");
        this.uvScaleLocation = gl.getUniformLocation(prog, "u_uvScale");
        this.alphaTestLocation = gl.getUniformLocation(prog, "u_alphaTest");
    }
}

function textureToCanvas(texture: CMB.Texture) {
    const canvas = document.createElement("canvas");
    canvas.width = texture.width;
    canvas.height = texture.height;
    canvas.title = texture.name;

    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(canvas.width, canvas.height);

    for (let i = 0; i < imgData.data.length; i++)
        imgData.data[i] = texture.pixels[i];

    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

type RenderFunc = (renderState: RenderState) => void;

class Scene implements Viewer.Scene {
    public cameraController = Viewer.FPSCameraController;
    public textures: HTMLCanvasElement[];
    public program: OoT3D_Program;
    public zsi: ZSI.ZSI;
    public model: RenderFunc;

    constructor(gl: WebGL2RenderingContext, zsi: ZSI.ZSI) {
        this.program = new OoT3D_Program();
        this.textures = zsi.mesh.textures.map((texture) => {
            return textureToCanvas(texture);
        });
        this.zsi = zsi;

        this.model = this.translateModel(gl, zsi.mesh);
    }

    public render(state: RenderState) {
        const gl = state.viewport.gl;
        state.useProgram(this.program);
        this.model(state);
    }

    private translateDataType(gl: WebGL2RenderingContext, dataType: CMB.DataType) {
        switch (dataType) {
            case CMB.DataType.Byte:   return gl.BYTE;
            case CMB.DataType.UByte:  return gl.UNSIGNED_BYTE;
            case CMB.DataType.Short:  return gl.SHORT;
            case CMB.DataType.UShort: return gl.UNSIGNED_SHORT;
            case CMB.DataType.Int:    return gl.INT;
            case CMB.DataType.UInt:   return gl.UNSIGNED_INT;
            case CMB.DataType.Float:  return gl.FLOAT;
            default: throw new Error();
        }
    }

    private dataTypeSize(dataType: CMB.DataType) {
        switch (dataType) {
            case CMB.DataType.Byte:   return 1;
            case CMB.DataType.UByte:  return 1;
            case CMB.DataType.Short:  return 2;
            case CMB.DataType.UShort: return 2;
            case CMB.DataType.Int:    return 4;
            case CMB.DataType.UInt:   return 4;
            case CMB.DataType.Float:  return 4;
            default: throw new Error();
        }
    }

    private translateSepd(gl: WebGL2RenderingContext, cmbContext: any, sepd: CMB.Sepd) {
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cmbContext.idxBuffer);

        gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.posBuffer);
        gl.vertexAttribPointer(OoT3D_Program.a_position, 3, this.translateDataType(gl, sepd.posType), false, 0, sepd.posStart);

        gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.colBuffer);
        gl.vertexAttribPointer(OoT3D_Program.a_color, 4, this.translateDataType(gl, sepd.colType), true, 0, sepd.colStart);

        gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.txcBuffer);
        gl.vertexAttribPointer(OoT3D_Program.a_uv, 2, this.translateDataType(gl, sepd.txcType), false, 0, sepd.txcStart);

        gl.enableVertexAttribArray(OoT3D_Program.a_position);
        gl.enableVertexAttribArray(OoT3D_Program.a_color);
        gl.enableVertexAttribArray(OoT3D_Program.a_uv);

        gl.bindVertexArray(null);

        return () => {
            gl.uniform1f(this.program.uvScaleLocation, sepd.txcScale);
            gl.uniform1f(this.program.posScaleLocation, sepd.posScale);

            gl.bindVertexArray(vao);

            for (const prm of sepd.prms)
                gl.drawElements(gl.TRIANGLES, prm.count, this.translateDataType(gl, prm.indexType), prm.offset * this.dataTypeSize(prm.indexType));

            gl.bindVertexArray(null);
        };
    }

    private translateTexture(gl: WebGL2RenderingContext, texture: CMB.Texture): WebGLTexture {
        const texId = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texId);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texture.width, texture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, texture.pixels);
        return texId;
    }

    private translateMaterial(gl: WebGL2RenderingContext, cmbContext: any, material: CMB.Material) {
        function translateWrapMode(wrapMode: CMB.TextureWrapMode) {
            switch (wrapMode) {
            case CMB.TextureWrapMode.CLAMP: return gl.CLAMP_TO_EDGE;
            case CMB.TextureWrapMode.REPEAT: return gl.REPEAT;
            default: throw new Error();
            }
        }

        function translateTextureFilter(filter: CMB.TextureFilter) {
            switch (filter) {
            case CMB.TextureFilter.LINEAR: return gl.LINEAR;
            case CMB.TextureFilter.NEAREST: return gl.NEAREST;
            case CMB.TextureFilter.LINEAR_MIPMAP_LINEAR: return gl.NEAREST;
            case CMB.TextureFilter.LINEAR_MIPMAP_NEAREST: return gl.NEAREST;
            case CMB.TextureFilter.NEAREST_MIPMAP_NEAREST: return gl.NEAREST;
            case CMB.TextureFilter.NEAREST_MIPMIP_LINEAR: return gl.NEAREST;
            default: throw new Error();
            }
        }

        return () => {
            for (let i = 0; i < 1; i++) {
                const binding = material.textureBindings[i];
                if (binding.textureIdx === -1)
                    continue;

                gl.uniform1i(this.program.alphaTestLocation, material.alphaTestEnable ? 1 : 0);

                gl.activeTexture(gl.TEXTURE0 + i);
                gl.bindTexture(gl.TEXTURE_2D, cmbContext.textures[binding.textureIdx]);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, translateTextureFilter(binding.minFilter));
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, translateTextureFilter(binding.magFilter));
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, translateWrapMode(binding.wrapS));
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, translateWrapMode(binding.wrapT));
            }
        };
    }

    private translateMesh(gl: WebGL2RenderingContext, cmbContext: any, mesh: CMB.Mesh) {
        const mat = cmbContext.matFuncs[mesh.matsIdx];
        const sepd = cmbContext.sepdFuncs[mesh.sepdIdx];

        return () => {
            mat(mesh);
            sepd();
        };
    }

    private translateCmb(gl: WebGL2RenderingContext, cmb: CMB.CMB) {
        if (!cmb)
            return () => {};

        const posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.posBuffer, gl.STATIC_DRAW);

        const colBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.colBuffer, gl.STATIC_DRAW);

        const nrmBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.nrmBuffer, gl.STATIC_DRAW);

        const txcBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, txcBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.txcBuffer, gl.STATIC_DRAW);

        const textures: WebGLTexture[] = cmb.textures.map((texture) => {
            return this.translateTexture(gl, texture);
        });

        const idxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cmb.indexBuffer, gl.STATIC_DRAW);

        const cmbContext: any = {
            posBuffer,
            colBuffer,
            nrmBuffer,
            txcBuffer,
            idxBuffer,
            textures,
        };

        cmbContext.sepdFuncs = cmb.sepds.map((sepd) => this.translateSepd(gl, cmbContext, sepd));
        cmbContext.matFuncs = cmb.materials.map((material) => this.translateMaterial(gl, cmbContext, material));

        const meshFuncs = cmb.meshs.map((mesh) => this.translateMesh(gl, cmbContext, mesh));

        return () => {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
            for (const func of meshFuncs)
                func();
        };
    }

    private translateModel(gl: WebGL2RenderingContext, mesh: ZSI.Mesh) {
        const opaque = this.translateCmb(gl, mesh.opaque);
        const transparent = this.translateCmb(gl, mesh.transparent);

        const renderFlags = new RenderFlags();
        renderFlags.blend = true;
        renderFlags.depthTest = true;
        renderFlags.cullMode = CullMode.BACK;

        return (state: RenderState) => {
            state.useFlags(renderFlags);
            opaque();
            transparent();
        };
    }
}

class MultiScene implements Viewer.Scene {
    public cameraController = Viewer.FPSCameraController;
    public scenes: Viewer.Scene[];
    public textures: HTMLCanvasElement[];

    constructor(scenes: Viewer.Scene[]) {
        this.scenes = scenes;
        this.textures = [];
        for (const scene of this.scenes)
            this.textures = this.textures.concat(scene.textures);
    }
    public render(renderState: RenderState) {
        this.scenes.forEach((scene) => scene.render(renderState));
    }
}

function dirname(path: string): string {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/');
}

export class SceneDesc implements Viewer.SceneDesc {
    public name: string;
    public path: string;
    public id: string;

    constructor(name: string, path: string) {
        this.name = name;
        this.path = path;
        this.id = this.path;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.Scene> {
        return fetch(this.path).then((result: ArrayBuffer) => {
            return this._createSceneFromData(gl, result);
        });
    }

    private _createSceneFromData(gl: WebGL2RenderingContext, result: ArrayBuffer): Progressable<Viewer.Scene> {
        const zsi = ZSI.parse(result);
        if (zsi.mesh) {
            return new Progressable(Promise.resolve(new Scene(gl, zsi)));
        } else if (zsi.rooms) {
            const basePath = dirname(this.path);
            const roomFilenames = zsi.rooms.map((romPath) => {
                const filename = romPath.split('/').pop();
                return basePath + '/' + filename;
            });

            return Progressable.all(roomFilenames.map((filename) => {
                return fetch(filename).then((roomResult) => this._createSceneFromData(gl, roomResult));
            })).then((scenes: Viewer.Scene[]) => {
                return new MultiScene(scenes);
            });
        } else {
            throw new Error(`wtf`);
        }
    }
}
