
import { mat4 } from 'gl-matrix';

import * as Viewer from 'viewer';
import * as Yaz0 from 'yaz0';

import { GX2AttribFormat, GX2TexClamp, GX2TexXYFilterType, GX2TexMipFilterType, GX2FrontFaceMode, GX2CompareFunction, GX2PrimitiveType, GX2IndexFormat } from './gx2_enum';
import { deswizzler } from './gx2_swizzle';
import * as GX2Texture from './gx2_texture';
import * as BFRES from './bfres';
import * as SARC from './sarc';

import { Progressable } from 'progress';
import { be16toh, be32toh } from 'endian';
import { assert, fetch } from 'util';

type RenderFunc = (renderState: Viewer.RenderState) => void;

class ProgramGambit_UBER extends Viewer.Program {
    public a0Location: WebGLUniformLocation;
    public e0Location: WebGLUniformLocation;

    public static attribLocations: { [name: string]: number } = {
        _p0: 0,
        _u0: 1,
    };
    private $a = ProgramGambit_UBER.attribLocations;
    public vert = `
uniform mat4 u_modelView;
uniform mat4 u_projection;
layout(location = ${this.$a._p0}) in vec3 _p0;
layout(location = ${this.$a._u0}) in vec2 _u0;
out vec2 a_u0;

void main() {
    gl_Position = u_projection * u_modelView * vec4(_p0, 1.0);
    a_u0 = _u0;
}
`;
    public frag = `
in vec2 a_u0;
uniform sampler2D _a0;
uniform sampler2D _e0;

vec4 textureSRGB(sampler2D s, vec2 uv) {
    vec4 srgba = texture(s, uv);
    vec3 srgb = srgba.rgb;
#ifdef HAS_WEBGL_compressed_texture_s3tc_srgb
    vec3 rgb = srgb;
#else
    // http://chilliant.blogspot.com/2012/08/srgb-approximations-for-hlsl.html
    vec3 rgb = srgb * (srgb * (srgb * 0.305306011 + 0.682171111) + 0.012522878);
#endif
    return vec4(rgb, srgba.a);
}

void main() {
    o_color = textureSRGB(_a0, a_u0);
    // TODO(jstpierre): Configurable alpha test
    if (o_color.a < 0.5)
        discard;
    o_color.rgb += texture(_e0, a_u0).rgb;
    o_color.rgb = pow(o_color.rgb, vec3(1.0 / 2.2));
}
`;

    bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);
        this.a0Location = gl.getUniformLocation(prog, "_a0");
        this.e0Location = gl.getUniformLocation(prog, "_e0");
    }
}

interface GX2AttribFormatInfo {
    size: number;
    elemSize: number;
    type: number;
    normalized: boolean;
}

function getAttribFormatInfo(gl: WebGL2RenderingContext, format: GX2AttribFormat) {
    switch (format) {
    case GX2AttribFormat._8_SINT:
        return { size: 1, elemSize: 1, type: gl.BYTE, normalized: false };
    case GX2AttribFormat._8_SNORM:
        return { size: 1, elemSize: 1, type: gl.BYTE, normalized: true };
    case GX2AttribFormat._8_UINT:
        return { size: 1, elemSize: 1, type: gl.UNSIGNED_BYTE, normalized: false };
    case GX2AttribFormat._8_UNORM:
        return { size: 1, elemSize: 1, type: gl.UNSIGNED_BYTE, normalized: true };
    case GX2AttribFormat._8_8_UNORM:
        return { size: 2, elemSize: 1, type: gl.UNSIGNED_BYTE, normalized: true };
    case GX2AttribFormat._8_8_SNORM:
        return { size: 2, elemSize: 1, type: gl.UNSIGNED_BYTE, normalized: true };
    case GX2AttribFormat._16_16_UNORM:
        return { size: 2, elemSize: 2, type: gl.UNSIGNED_SHORT, normalized: true };
    case GX2AttribFormat._16_16_SNORM:
        return { size: 2, elemSize: 2, type: gl.SHORT, normalized: true };
    case GX2AttribFormat._16_16_FLOAT:
        return { size: 2, elemSize: 2, type: gl.HALF_FLOAT, normalized: false };
    case GX2AttribFormat._16_16_16_16_FLOAT:
        return { size: 4, elemSize: 2, type: gl.HALF_FLOAT, normalized: false };
    case GX2AttribFormat._32_32_FLOAT:
        return { size: 2, elemSize: 4, type: gl.FLOAT, normalized: false };
    case GX2AttribFormat._32_32_32_FLOAT:
        return { size: 4, elemSize: 4, type: gl.FLOAT, normalized: false };
    default:
        const m_: never = format;
        throw new Error(`Unsupported attribute format ${format}`);
    }
}

export class Scene implements Viewer.Scene {
    public cameraController = Viewer.FPSCameraController;
    public textures: HTMLCanvasElement[];

    private modelFuncs: RenderFunc[];
    private glTextures: WebGLTexture[];
    private blankTexture: WebGLTexture;

    constructor(gl: WebGL2RenderingContext, private fres: BFRES.FRES, private isSkybox: boolean) {
        this.fres = fres;

        this.blankTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.blankTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

        this.modelFuncs = this.translateFRES(gl, this.fres);

        this.textures = this.fres.textures.map((textureEntry) => {
            const tex = textureEntry.texture;
            const surface = tex.surface;
            const canvas = document.createElement('canvas');
            canvas.width = surface.width;
            canvas.height = surface.height;
            canvas.title = `${textureEntry.entry.name} ${surface.format} (${surface.width}x${surface.height})`;
            GX2Texture.decodeSurface(tex.surface, tex.texData, tex.mipData).then((decodedTexture) => {
                GX2Texture.textureToCanvas(canvas, decodedTexture);
            });
            return canvas;
        });
    }

    private translateVertexBuffer(gl: WebGL2RenderingContext, attrib: BFRES.VtxAttrib, buffer: BFRES.BufferData): WebGLBuffer {
        let bufferData = buffer.data;
        switch (getAttribFormatInfo(gl, attrib.format).elemSize) {
        case 1:
            break;
        case 2:
            bufferData = be16toh(buffer.data);
            break;
        case 4:
            bufferData = be32toh(buffer.data);
            break;
        default:
            throw new Error(`Unsupported vertex format ${attrib}`);
        }

        const glBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, bufferData, gl.STATIC_DRAW);
        return glBuffer;
    }

    private translateFVTX(gl: WebGL2RenderingContext, fvtx: BFRES.FVTX): WebGLVertexArrayObject {
        const glBuffers: WebGLBuffer[] = [];

        for (let i = 0; i < fvtx.attribs.length; i++) {
            const attrib = fvtx.attribs[i];
            const location = ProgramGambit_UBER.attribLocations[attrib.name];

            if (location === undefined)
                continue;

            const buffer = fvtx.buffers[attrib.bufferIndex];
            assert(buffer.stride === 0);
            assert(attrib.bufferStart === 0);
            glBuffers[i] = this.translateVertexBuffer(gl, attrib, buffer);
        }

        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        for (let i = 0; i < fvtx.attribs.length; i++) {
            const attrib = fvtx.attribs[i];
            const location = ProgramGambit_UBER.attribLocations[attrib.name];

            if (location === undefined)
                continue;

            const formatInfo = getAttribFormatInfo(gl, attrib.format);
            gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers[i]);
            gl.vertexAttribPointer(location, formatInfo.size, formatInfo.type, formatInfo.normalized, 0, 0);
            gl.enableVertexAttribArray(location);
        }

        return vao;
    }

    private translateTexClamp(gl: WebGL2RenderingContext, clampMode: GX2TexClamp) {
        switch (clampMode) {
        case GX2TexClamp.CLAMP:
            return gl.CLAMP_TO_EDGE;
        case GX2TexClamp.WRAP:
            return gl.REPEAT;
        case GX2TexClamp.MIRROR:
            return gl.MIRRORED_REPEAT;
        default:
            throw new Error(`Unknown tex clamp mode ${clampMode}`);
        }
    }

    private translateTexFilter(gl: WebGL2RenderingContext, filter: GX2TexXYFilterType, mipFilter: GX2TexMipFilterType) {
        if (mipFilter === GX2TexMipFilterType.LINEAR && filter === GX2TexXYFilterType.BILINEAR)
            return gl.LINEAR_MIPMAP_LINEAR;
        if (mipFilter === GX2TexMipFilterType.LINEAR && filter === GX2TexXYFilterType.POINT)
            return gl.NEAREST_MIPMAP_LINEAR;
        if (mipFilter === GX2TexMipFilterType.POINT && filter === GX2TexXYFilterType.BILINEAR)
            return gl.LINEAR_MIPMAP_NEAREST;
        if (mipFilter === GX2TexMipFilterType.POINT && filter === GX2TexXYFilterType.POINT)
            return gl.NEAREST_MIPMAP_LINEAR;
        if (mipFilter === GX2TexMipFilterType.NO_MIP && filter === GX2TexXYFilterType.BILINEAR)
            return gl.LINEAR;
        if (mipFilter === GX2TexMipFilterType.NO_MIP && filter === GX2TexXYFilterType.POINT)
            return gl.NEAREST;
        throw new Error(`Unknown texture filter mode`);
    }

    private translateFrontFaceMode(gl: WebGL2RenderingContext, frontFaceMode: GX2FrontFaceMode) {
        switch (frontFaceMode) {
        case GX2FrontFaceMode.CCW:
            return gl.CCW;
        case GX2FrontFaceMode.CW:
            return gl.CW;
        }
    }

    private translateCompareFunction(gl: WebGL2RenderingContext, compareFunc: GX2CompareFunction) {
        switch (compareFunc) {
        case GX2CompareFunction.NEVER:
            return gl.NEVER;
        case GX2CompareFunction.LESS:
            return gl.LESS;
        case GX2CompareFunction.EQUAL:
            return gl.EQUAL;
        case GX2CompareFunction.LEQUAL:
            return gl.LEQUAL;
        case GX2CompareFunction.GREATER:
            return gl.GREATER;
        case GX2CompareFunction.NOTEQUAL:
            return gl.NOTEQUAL;
        case GX2CompareFunction.GEQUAL:
            return gl.GEQUAL;
        case GX2CompareFunction.ALWAYS:
            return gl.ALWAYS;
        }
    }

    private translateFMAT(gl: WebGL2RenderingContext, fmat: BFRES.FMAT): RenderFunc {
        // We only support the albedo/emissive texture.
        const attribNames = ['_a0', '_e0'];
        const textureAssigns = fmat.textureAssigns.filter((textureAssign) => {
            return attribNames.includes(textureAssign.attribName);
        });

        const samplers: WebGLSampler[] = [];
        for (const textureAssign of textureAssigns) {
            const sampler = gl.createSampler();
            gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, this.translateTexClamp(gl, textureAssign.texClampU));
            gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, this.translateTexClamp(gl, textureAssign.texClampV));
            // XXX(jstpierre): Introduce this when we start decoding mipmaps.
            const texFilterMip = GX2TexMipFilterType.NO_MIP;
            gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, this.translateTexFilter(gl, textureAssign.texFilterMag, texFilterMip));
            gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, this.translateTexFilter(gl, textureAssign.texFilterMin, texFilterMip));
            samplers.push(sampler);
        }

        const prog = new ProgramGambit_UBER();
        const skyboxCameraMat = mat4.create();

        const renderState = fmat.renderState;

        return (state: Viewer.RenderState) => {
            state.useProgram(prog);

            if (this.isSkybox) {
                // XXX: Kind of disgusting. Calculate a skybox camera matrix by removing translation.
                mat4.copy(skyboxCameraMat, state.modelView);
                skyboxCameraMat[12] = 0;
                skyboxCameraMat[13] = 0;
                skyboxCameraMat[14] = 0;
                gl.uniformMatrix4fv(prog.modelViewLocation, false, skyboxCameraMat);
            }

            // Render state.
            gl.frontFace(this.translateFrontFaceMode(gl, renderState.frontFaceMode));

            if (renderState.cullFront || renderState.cullBack) {
                gl.enable(gl.CULL_FACE);
                if (renderState.cullFront && renderState.cullBack)
                    gl.cullFace(gl.FRONT_AND_BACK);
                else if (renderState.cullFront)
                    gl.cullFace(gl.FRONT);
                else
                    gl.cullFace(gl.BACK);
            } else {
                gl.disable(gl.CULL_FACE);
            }

            if (renderState.depthTest)
                gl.enable(gl.DEPTH_TEST);
            else
                gl.disable(gl.DEPTH_TEST);

            gl.depthMask(renderState.depthWrite);
            gl.depthFunc(this.translateCompareFunction(gl, renderState.depthCompareFunc));

            // Textures.
            for (let i = 0; i < attribNames.length; i++) {
                const attribName = attribNames[i];

                gl.activeTexture(gl.TEXTURE0 + i);

                let uniformLocation;
                if (attribName === '_a0')
                    uniformLocation = prog.a0Location;
                else if (attribName === '_e0')
                    uniformLocation = prog.e0Location;
                else
                    assert(false);

                gl.uniform1i(uniformLocation, i);

                const textureAssignIndex = textureAssigns.findIndex((textureAssign) => textureAssign.attribName === attribName);
                if (textureAssignIndex >= 0) {
                    const textureAssign = textureAssigns[textureAssignIndex];

                    const ftexIndex = this.fres.textures.findIndex((textureEntry) => textureEntry.entry.offs === textureAssign.ftexOffs);
                    const ftex = this.fres.textures[ftexIndex];
                    assert(ftex.entry.name === textureAssign.textureName);

                    const glTexture = this.glTextures[ftexIndex];
                    gl.bindTexture(gl.TEXTURE_2D, glTexture);

                    const sampler = samplers[textureAssignIndex];
                    gl.bindSampler(i, sampler);
                } else {
                    // If we have no binding for this texture, replace it with something harmless...
                    gl.bindTexture(gl.TEXTURE_2D, this.blankTexture);
                }
            }
        };
    }

    private translatePrimType(gl: WebGL2RenderingContext, primType: GX2PrimitiveType) {
        switch (primType) {
        case GX2PrimitiveType.TRIANGLES:
            return gl.TRIANGLES;
        default:
            throw new Error(`Unsupported primitive type ${primType}`);
        }
    }

    private translateIndexBuffer(gl: WebGL2RenderingContext, indexFormat: GX2IndexFormat, indexBufferData: ArrayBuffer) {
        const view = new DataView(indexBufferData);
        let out: ArrayBuffer;

        switch (indexFormat) {
        case GX2IndexFormat.U16_LE:
        case GX2IndexFormat.U32_LE:
            out = indexBufferData;
            break;
        case GX2IndexFormat.U16:
            out = be16toh(indexBufferData);
            break;
        case GX2IndexFormat.U32:
            out = be32toh(indexBufferData);
            break;
        }

        const glBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, glBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, out, gl.STATIC_DRAW);
        return glBuffer;
    }

    private translateIndexFormat(gl: WebGL2RenderingContext, indexFormat: GX2IndexFormat) {
        // Little-endian translation was done above.
        switch (indexFormat) {
        case GX2IndexFormat.U16:
        case GX2IndexFormat.U16_LE:
            return gl.UNSIGNED_SHORT;
        case GX2IndexFormat.U32:
        case GX2IndexFormat.U32_LE:
            return gl.UNSIGNED_INT;
        default:
            throw new Error(`Unsupported index format ${indexFormat}`);
        }
    }
 
    private translateFSHP(gl: WebGL2RenderingContext, fshp: BFRES.FSHP): RenderFunc {
        const glIndexBuffers: WebGLBuffer[] = [];
        for (const mesh of fshp.meshes) {
            assert(mesh.indexBufferData.stride === 0);
            const buffer = this.translateIndexBuffer(gl, mesh.indexFormat, mesh.indexBufferData.data);
            glIndexBuffers.push(buffer);
        }

        return (state: Viewer.RenderState) => {
            const lod = 0;
            const mesh = fshp.meshes[lod];
            const glIndexBuffer = glIndexBuffers[lod];
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, glIndexBuffer);

            for (const submesh of mesh.submeshes) {
                gl.drawElements(this.translatePrimType(gl, mesh.primType),
                    submesh.indexBufferCount,
                    this.translateIndexFormat(gl, mesh.indexFormat),
                    submesh.indexBufferOffset
                );
            }
        }
    }

    private translateModel(gl: WebGL2RenderingContext, model: BFRES.ModelEntry): RenderFunc {
        const fmdl = model.fmdl;
        const fvtxVaos: WebGLVertexArrayObject[] = fmdl.fvtx.map((fvtx) => this.translateFVTX(gl, fvtx));
        const fmatFuncs: RenderFunc[] = fmdl.fmat.map((fmat) => this.translateFMAT(gl, fmat));
        const fshpFuncs: RenderFunc[] = fmdl.fshp.map((fshp) => this.translateFSHP(gl, fshp));

        return (state: Viewer.RenderState) => {
            // _drcmap is the map used for the Gamepad. It does nothing but cause Z-fighting.
            if (model.entry.name.endsWith('_drcmap'))
                return;

            // "_DV" seems to be the skybox. There are additional models which are powered
            // by skeleton animation, which we don't quite support yet. Kill them for now.
            if (model.entry.name.indexOf('_DV_') !== -1)
                return;

            const gl = state.gl;
            for (let i = 0; i < fmdl.fshp.length; i++) {
                const fshp = fmdl.fshp[i];

                // XXX(jstpierre): Sun is dynamically moved by the game engine, I think...
                // ... unless it's SKL animation. For now, skip it.
                if (fshp.name === 'Sun__VRL_Sun')
                    continue;

                gl.bindVertexArray(fvtxVaos[fshp.fvtxIndex]);
                // Set up our material state.
                fmatFuncs[fshp.fmatIndex](state);
                // Draw our meshes.
                fshpFuncs[i](state);
            }
        };
    }

    private getCompressedFormat(gl: WebGL2RenderingContext, tex: GX2Texture.DecodedTextureBC) {
        switch (tex.type) {
        case 'BC4':
        case 'BC5':
            return null;
        }

        const ext_compressed_texture_s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
        const ext_compressed_texture_s3tc_srgb = gl.getExtension('WEBGL_compressed_texture_s3tc_srgb');

        if (tex.flag === 'SRGB' && ext_compressed_texture_s3tc_srgb) {
            switch (tex.type) {
            case 'BC1':
                return ext_compressed_texture_s3tc_srgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;
            case 'BC3':
                return ext_compressed_texture_s3tc_srgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT;
            }
        }

        // If we don't have sRGB samplers, fall back to HW decoding and just get the blending wrong,
        // since I don't have sRGB decoding in the SW decode fallback path either.
        if (ext_compressed_texture_s3tc) {
            switch (tex.type) {
            case 'BC1':
                return ext_compressed_texture_s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT;
            case 'BC3':
                return ext_compressed_texture_s3tc.COMPRESSED_RGBA_S3TC_DXT5_EXT;
            }
        }

        return null;
    }

    private translateTexture(gl: WebGL2RenderingContext, ftex: BFRES.TextureEntry): WebGLTexture {
        const glTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, glTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        const surface = ftex.texture.surface;

        // Kick off a decode...
        GX2Texture.decodeSurface(surface, ftex.texture.texData, ftex.texture.mipData).then((tex: GX2Texture.DecodedTexture) => {
            gl.bindTexture(gl.TEXTURE_2D, glTexture);

            // First check if we have to decompress compressed textures.
            switch (tex.type) {
            case "BC1":
            case "BC3":
            case "BC4":
            case "BC5":
                const compressedFormat = this.getCompressedFormat(gl, tex);
                if (compressedFormat === null)
                    tex = GX2Texture.decompressBC(tex);
                break;
            }

            switch (tex.type) {
            case "R": {
                const internalFormat = tex.flag === 'SNORM' ? gl.R8_SNORM : gl.R8;
                const type = tex.flag === 'SNORM' ? gl.BYTE : gl.UNSIGNED_BYTE;
                const data = tex.flag === 'SNORM' ? new Int8Array(tex.pixels) : new Uint8Array(tex.pixels);
                gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, tex.width, tex.height, 0, gl.RED, type, data);
                break;
            }
            case "RG": {
                const internalFormat = tex.flag === 'SNORM' ? gl.RG8_SNORM : gl.RG8;
                const type = tex.flag === 'SNORM' ? gl.BYTE : gl.UNSIGNED_BYTE;
                const data = tex.flag === 'SNORM' ? new Int8Array(tex.pixels) : new Uint8Array(tex.pixels);
                gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, tex.width, tex.height, 0, gl.RG, type, data);
                break;
            }
            case "BC1":
            case "BC3":
            case "BC4":
            case "BC5": {
                const compressedFormat = this.getCompressedFormat(gl, tex);
                assert(compressedFormat !== null);
                gl.compressedTexImage2D(gl.TEXTURE_2D, 0, compressedFormat, tex.width, tex.height, 0, new Uint8Array(tex.pixels));
                break;
            }
            case "RGBA": {
                const internalFormat = tex.flag === 'SRGB' ? gl.SRGB8_ALPHA8 : gl.RGBA8;
                gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, tex.width, tex.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(tex.pixels));
                break;
            }
            }
        });

        return glTexture;
    }

    private translateFRES(gl: WebGL2RenderingContext, fres: BFRES.FRES): RenderFunc[] {
        this.glTextures = fres.textures.map((ftex) => this.translateTexture(gl, ftex));
        return fres.models.map((modelEntry) => this.translateModel(gl, modelEntry));
    }

    public render(state: Viewer.RenderState) {
        this.modelFuncs.forEach((func) => {
            func(state);
        });
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

    public render(state: Viewer.RenderState) {
        const gl = state.viewport.gl;
        this.scenes.forEach((scene) => scene.render(state));
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

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.Scene> {
        // Reset any jobs we might have pending.
        // TODO(jstpierre): Explicit scene teardown.
        deswizzler.terminate();
        deswizzler.build();

        return Progressable.all([
            this._createSceneFromPath(gl, this.path, false),
            this._createSceneFromPath(gl, 'data/spl/VR_SkyDayCumulonimbus.szs', true),
        ]).then((scenes): Viewer.Scene => {
            return new MultiScene(scenes);
        });
    }

    private _createSceneFromPath(gl: WebGL2RenderingContext, path: string, isSkybox: boolean): Progressable<Scene> {
        return fetch(path).then((result: ArrayBuffer) => {
            const buf = Yaz0.decompress(result);
            const sarc = SARC.parse(buf);
            const file = sarc.files.find((file) => file.name === 'Output.bfres');
            const fres = BFRES.parse(file.buffer);
            const scene = new Scene(gl, fres, isSkybox);
            return scene;
        });
    }
}
