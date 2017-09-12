
/// <reference path="../decl.d.ts" />

import * as LZ77 from 'lz77';
import * as Viewer from 'viewer';
import * as NITRO_BMD from './nitro_bmd';
import * as NITRO_GX from './nitro_gx';
import { fetch } from 'util'; 

const DL_VERT_SHADER_SOURCE = `
    precision mediump float;
    uniform mat4 u_modelView;
    uniform mat4 u_localMatrix;
    uniform mat4 u_projection;
    uniform mat4 u_texCoordMat;
    attribute vec3 a_position;
    attribute vec2 a_uv;
    attribute vec4 a_color;
    varying vec4 v_color;
    varying vec2 v_uv;
    
    void main() {
        gl_Position = u_projection * u_modelView * u_localMatrix * vec4(a_position, 1.0);
        v_color = a_color;
        v_uv = (u_texCoordMat * vec4(a_uv, 1.0, 1.0)).st;
    }
`;

const DL_FRAG_SHADER_SOURCE = `
    precision mediump float;
    varying vec2 v_uv;
    varying vec4 v_color;
    uniform sampler2D u_texture;
    
    void main() {
        gl_FragColor = texture2D(u_texture, v_uv);
        gl_FragColor *= v_color;
        if (gl_FragColor.a == 0.0)
            discard;
    }
`;

class NITRO_Program extends Viewer.Program {
    localMatrixLocation:WebGLUniformLocation;
    texCoordMatLocation:WebGLUniformLocation;
    positionLocation:number;
    colorLocation:number;
    uvLocation:number;

    vert = DL_VERT_SHADER_SOURCE;
    frag = DL_FRAG_SHADER_SOURCE;

    bind(gl:WebGLRenderingContext, prog:WebGLProgram) {
        super.bind(gl, prog);

        this.localMatrixLocation = gl.getUniformLocation(prog, "u_localMatrix");
        this.texCoordMatLocation = gl.getUniformLocation(prog, "u_texCoordMat");
        this.positionLocation = gl.getAttribLocation(prog, "a_position");
        this.colorLocation = gl.getAttribLocation(prog, "a_color");
        this.uvLocation = gl.getAttribLocation(prog, "a_uv");
    }
}

// 3 pos + 4 color + 2 uv
const VERTEX_SIZE = 9;
const VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;

enum RenderPass {
    OPAQUE = 0x01,
    TRANSLUCENT = 0x02,
};

function textureToCanvas(bmdTex:NITRO_BMD.Texture) {
    const canvas = document.createElement("canvas");
    canvas.width = bmdTex.width;
    canvas.height = bmdTex.height;
    canvas.title = bmdTex.name;

    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(canvas.width, canvas.height);

    for (let i = 0; i < imgData.data.length; i++)
        imgData.data[i] = bmdTex.pixels[i];

    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

class Scene implements Viewer.Scene {
    cameraController = Viewer.FPSCameraController;
    textures:HTMLCanvasElement[];
    modelFuncs:Function[];
    program:NITRO_Program;
    bmd:NITRO_BMD.BMD;

    constructor(gl:WebGLRenderingContext, bmd:NITRO_BMD.BMD) {
        this.program = new NITRO_Program();
        this.bmd = bmd;

        this.textures = bmd.textures.map((texture) => {
            return textureToCanvas(texture);
        });
        this.modelFuncs = bmd.models.map((bmdm) => this.translateModel(gl, bmdm));
    }

    translatePacket(gl:WebGLRenderingContext, packet:NITRO_GX.Packet) {
        const vertBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, packet.vertData, gl.STATIC_DRAW);

        const idxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, packet.idxData, gl.STATIC_DRAW);

        return () => {
            gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
            gl.vertexAttribPointer(this.program.positionLocation, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
            gl.vertexAttribPointer(this.program.colorLocation, 4, gl.FLOAT, false, VERTEX_BYTES, 3 * Float32Array.BYTES_PER_ELEMENT);
            gl.vertexAttribPointer(this.program.uvLocation, 2, gl.FLOAT, false, VERTEX_BYTES, 7 * Float32Array.BYTES_PER_ELEMENT);
            gl.enableVertexAttribArray(this.program.positionLocation);
            gl.enableVertexAttribArray(this.program.colorLocation);
            gl.enableVertexAttribArray(this.program.uvLocation);
            gl.drawElements(gl.TRIANGLES, packet.idxData.length, gl.UNSIGNED_SHORT, 0);
            gl.disableVertexAttribArray(this.program.positionLocation);
            gl.disableVertexAttribArray(this.program.colorLocation);
            gl.disableVertexAttribArray(this.program.uvLocation);
        };
    }

    translatePoly(gl:WebGLRenderingContext, poly:NITRO_BMD.Poly) {
        const funcs = poly.packets.map((packet) => this.translatePacket(gl, packet));
        return () => {
            funcs.forEach((f) => { f(); });
        };
    }

    translateMaterial(gl:WebGLRenderingContext, material:any) {
        const texture = material.texture;
        let texId;

        function wrapMode(repeat, flip) {
            if (repeat)
                return flip ? gl.MIRRORED_REPEAT : gl.REPEAT;
            else
                return gl.CLAMP_TO_EDGE; 
        }

        if (texture !== null) {
            texId = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texId);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

            const repeatS = (material.texParams >> 16) & 0x01;
            const repeatT = (material.texParams >> 17) & 0x01;
            const flipS = (material.texParams >> 18) & 0x01;
            const flipT = (material.texParams >> 19) & 0x01;

            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode(repeatS, flipS));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMode(repeatT, flipT));

            gl.bindTexture(gl.TEXTURE_2D, texId);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texture.width, texture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, texture.pixels);
        }

        return () => {
            if (texture !== null) {
                gl.uniformMatrix4fv(this.program.texCoordMatLocation, false, material.texCoordMat);
                gl.bindTexture(gl.TEXTURE_2D, texId);
            }

            gl.depthMask(material.depthWrite);
        };
    }

    translateBatch(gl:WebGLRenderingContext, batch:NITRO_BMD.Batch) {
        const batchPass = batch.material.isTranslucent ? RenderPass.TRANSLUCENT : RenderPass.OPAQUE;

        const applyMaterial = this.translateMaterial(gl, batch.material);
        const renderPoly = this.translatePoly(gl, batch.poly);
        return (pass:RenderPass) => {
            if (pass != batchPass)
                return;
            applyMaterial();
            renderPoly();
        };
    }

    translateModel(gl:WebGLRenderingContext, bmdm:NITRO_BMD.Model) {
        const localMatrix = window.mat4.create();
        const bmd = this.bmd;

        // Local fudge factor so that all the models in the viewer "line up".
        const localScaleFactor = 100;
        const scaleFactor = bmd.scaleFactor * localScaleFactor;

        window.mat4.scale(localMatrix, localMatrix, [scaleFactor, scaleFactor, scaleFactor]);
        const batches = bmdm.batches.map((batch) => this.translateBatch(gl, batch));
        return (pass:RenderPass) => {
            gl.uniformMatrix4fv(this.program.localMatrixLocation, false, localMatrix);
            batches.forEach((f) => { f(pass); });
        };
    }

    renderModels(pass:RenderPass) {
        return this.modelFuncs.forEach((func) => {
            func(pass);
        });
    }

    render(state:Viewer.RenderState) {
        const gl = state.viewport.gl;

        state.useProgram(this.program);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // First pass, opaque.
        this.renderModels(RenderPass.OPAQUE);

        // Second pass, translucent.
        this.renderModels(RenderPass.TRANSLUCENT);
    }
}

export class SceneDesc implements Viewer.SceneDesc {
    name:string;
    path:string;

    constructor(name:string, path:string) {
        this.name = name;
        this.path = path;
    }

    createScene(gl:WebGLRenderingContext):PromiseLike<Scene> {
        return fetch(this.path).then((result:ArrayBuffer) => {
            let decompressed = LZ77.decompress(result);
            let bmd = NITRO_BMD.parse(decompressed);
            return new Scene(gl, bmd);
        });
    }
}
