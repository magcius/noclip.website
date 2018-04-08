
import { mat4 } from 'gl-matrix';

import { GX2AttribFormat, GX2TexClamp, GX2TexXYFilterType, GX2TexMipFilterType, GX2FrontFaceMode, GX2CompareFunction, GX2PrimitiveType, GX2IndexFormat } from './gx2_enum';
import { deswizzler } from './gx2_swizzle';
import * as GX2Texture from './gx2_texture';
import * as BFRES from './bfres';
import * as SARC from './sarc';

import * as Viewer from '../viewer';
import * as Yaz0 from '../yaz0';

import Progressable from 'Progressable';
import { RenderState, Program, RenderArena, RenderFlags, FrontFaceMode, CompareMode, CullMode, coalesceBuffer, CoalescedBuffer } from '../render';
import { betoh } from '../endian';
import { assert, fetch } from '../util';
import ArrayBufferSlice from 'ArrayBufferSlice';

type RenderFunc = (renderState: RenderState) => void;

class ProgramGambit_UBER extends Program {
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
    o_color.rgb += textureSRGB(_e0, a_u0).rgb;
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
    elemSize: 1 | 2 | 4;
    type: number;
    normalized: boolean;
}

function getAttribFormatInfo(format: GX2AttribFormat): GX2AttribFormatInfo {
    switch (format) {
    case GX2AttribFormat._8_SINT:
        return { size: 1, elemSize: 1, type: WebGL2RenderingContext.BYTE, normalized: false };
    case GX2AttribFormat._8_SNORM:
        return { size: 1, elemSize: 1, type: WebGL2RenderingContext.BYTE, normalized: true };
    case GX2AttribFormat._8_UINT:
        return { size: 1, elemSize: 1, type: WebGL2RenderingContext.UNSIGNED_BYTE, normalized: false };
    case GX2AttribFormat._8_UNORM:
        return { size: 1, elemSize: 1, type: WebGL2RenderingContext.UNSIGNED_BYTE, normalized: true };
    case GX2AttribFormat._8_8_UNORM:
        return { size: 2, elemSize: 1, type: WebGL2RenderingContext.UNSIGNED_BYTE, normalized: true };
    case GX2AttribFormat._8_8_SNORM:
        return { size: 2, elemSize: 1, type: WebGL2RenderingContext.UNSIGNED_BYTE, normalized: true };
    case GX2AttribFormat._16_16_UNORM:
        return { size: 2, elemSize: 2, type: WebGL2RenderingContext.UNSIGNED_SHORT, normalized: true };
    case GX2AttribFormat._16_16_SNORM:
        return { size: 2, elemSize: 2, type: WebGL2RenderingContext.SHORT, normalized: true };
    case GX2AttribFormat._16_16_FLOAT:
        return { size: 2, elemSize: 2, type: WebGL2RenderingContext.HALF_FLOAT, normalized: false };
    case GX2AttribFormat._16_16_16_16_FLOAT:
        return { size: 4, elemSize: 2, type: WebGL2RenderingContext.HALF_FLOAT, normalized: false };
    case GX2AttribFormat._32_32_FLOAT:
        return { size: 2, elemSize: 4, type: WebGL2RenderingContext.FLOAT, normalized: false };
    case GX2AttribFormat._32_32_32_FLOAT:
        return { size: 4, elemSize: 4, type: WebGL2RenderingContext.FLOAT, normalized: false };
    default:
        const m_: never = format;
        throw new Error(`Unsupported attribute format ${format}`);
    }
}

export class Scene implements Viewer.Scene {
    public textures: Viewer.Texture[];

    private modelFuncs: RenderFunc[];
    private glTextures: WebGLTexture[];
    private blankTexture: WebGLTexture;
    private arena: RenderArena;

    constructor(gl: WebGL2RenderingContext, private fres: BFRES.FRES, private isSkybox: boolean) {
        this.fres = fres;

        this.arena = new RenderArena();

        this.blankTexture = this.arena.createTexture(gl);
        gl.bindTexture(gl.TEXTURE_2D, this.blankTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

        this.modelFuncs = this.translateFRES(gl, this.fres);

        this.textures = this.fres.textures.map((textureEntry) => {
            const tex = textureEntry.texture;
            const surface = tex.surface;
            const canvases: HTMLCanvasElement[] = [];
            for (let i = 0; i < tex.surface.numMips; i++) {
                const canvas = document.createElement('canvas');
                canvas.width = 0;
                canvas.height = 0;
                canvases.push(canvas);
            }
            GX2Texture.decodeTexture(tex.surface, tex.texData, tex.mipData).then((decodedTexture) => {
                const decompressedTexture = GX2Texture.decompressTexture(decodedTexture);
                decompressedTexture.surfaces.forEach((decompressedSurface, i) => {
                    const canvas = canvases[i];
                    canvas.width = decompressedSurface.width;
                    canvas.height = decompressedSurface.height;
                    canvas.title = `${textureEntry.entry.name} ${surface.format} (${surface.width}x${surface.height})`;
                    GX2Texture.surfaceToCanvas(canvas, decompressedTexture, decompressedSurface);
                });
            });
            return { name: textureEntry.entry.name, surfaces: canvases };
        });
    }

    private translateFVTXBuffers(fvtx: BFRES.FVTX, vertexDatas: ArrayBufferSlice[]) {
        for (let i = 0; i < fvtx.attribs.length; i++) {
            const attrib = fvtx.attribs[i];
            const location = ProgramGambit_UBER.attribLocations[attrib.name];

            if (location === undefined)
                continue;

            const buffer = fvtx.buffers[attrib.bufferIndex];
            assert(buffer.stride === 0);
            assert(attrib.bufferStart === 0);
            const vertexData = betoh(buffer.data, getAttribFormatInfo(attrib.format).elemSize);
            vertexDatas.push(vertexData);
        }
    }

    private translateFVTX(gl: WebGL2RenderingContext, fvtx: BFRES.FVTX, coalescedVertex: CoalescedBuffer[]): WebGLVertexArrayObject {
        const vao = this.arena.createVertexArray(gl);
        gl.bindVertexArray(vao);

        for (let i = 0; i < fvtx.attribs.length; i++) {
            const attrib = fvtx.attribs[i];
            const location = ProgramGambit_UBER.attribLocations[attrib.name];

            if (location === undefined)
                continue;

            const formatInfo = getAttribFormatInfo(attrib.format);
            const buffer = coalescedVertex.shift();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer.buffer);
            gl.vertexAttribPointer(location, formatInfo.size, formatInfo.type, formatInfo.normalized, 0, buffer.offset);
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

    private translateFrontFaceMode(frontFaceMode: GX2FrontFaceMode): FrontFaceMode {
        switch (frontFaceMode) {
        case GX2FrontFaceMode.CCW:
            return FrontFaceMode.CCW;
        case GX2FrontFaceMode.CW:
            return FrontFaceMode.CW;
        }
    }

    private translateCompareFunction(compareFunc: GX2CompareFunction): CompareMode {
        switch (compareFunc) {
        case GX2CompareFunction.NEVER:
            return CompareMode.NEVER;
        case GX2CompareFunction.LESS:
            return CompareMode.LESS;
        case GX2CompareFunction.EQUAL:
            return CompareMode.EQUAL;
        case GX2CompareFunction.LEQUAL:
            return CompareMode.LEQUAL;
        case GX2CompareFunction.GREATER:
            return CompareMode.GREATER;
        case GX2CompareFunction.NOTEQUAL:
            return CompareMode.NEQUAL;
        case GX2CompareFunction.GEQUAL:
            return CompareMode.GEQUAL;
        case GX2CompareFunction.ALWAYS:
            return CompareMode.ALWAYS;
        }
    }

    private translateCullMode(cullFront: boolean, cullBack: boolean): CullMode {
        if (cullFront && cullBack)
            return CullMode.FRONT_AND_BACK;
        else if (cullFront)
            return CullMode.FRONT;
        else if (cullBack)
            return CullMode.BACK;
        else
            return CullMode.NONE;
    }

    private translateRenderState(renderState: BFRES.RenderState): RenderFlags {
        const renderFlags = new RenderFlags();
        renderFlags.frontFace = this.translateFrontFaceMode(renderState.frontFaceMode);
        renderFlags.depthTest = renderState.depthTest;
        renderFlags.depthFunc = this.translateCompareFunction(renderState.depthCompareFunc);
        renderFlags.depthWrite = renderState.depthWrite;
        renderFlags.cullMode = this.translateCullMode(renderState.cullFront, renderState.cullBack);
        return renderFlags;
    }

    private translateFMAT(gl: WebGL2RenderingContext, fmat: BFRES.FMAT): RenderFunc {
        // We only support the albedo/emissive texture.
        const attribNames = ['_a0', '_e0'];
        const textureAssigns = fmat.textureAssigns.filter((textureAssign) => {
            return attribNames.includes(textureAssign.attribName);
        });

        const samplers: WebGLSampler[] = [];
        for (const textureAssign of textureAssigns) {
            const sampler = this.arena.createSampler(gl);
            gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, this.translateTexClamp(gl, textureAssign.texClampU));
            gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, this.translateTexClamp(gl, textureAssign.texClampV));
            // XXX(jstpierre): Introduce this when we start decoding mipmaps.
            const texFilterMip = GX2TexMipFilterType.NO_MIP;
            gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, this.translateTexFilter(gl, textureAssign.texFilterMag, texFilterMip));
            gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, this.translateTexFilter(gl, textureAssign.texFilterMin, texFilterMip));
            samplers.push(sampler);
        }

        const prog = new ProgramGambit_UBER();
        this.arena.trackProgram(prog);

        const renderFlags = this.translateRenderState(fmat.renderState);

        return (state: RenderState) => {
            state.useProgram(prog);
            state.bindModelView(this.isSkybox);

            state.useFlags(renderFlags);

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

    private translateIndexBuffer( indexFormat: GX2IndexFormat, indexBufferData: ArrayBufferSlice): ArrayBufferSlice {
        switch (indexFormat) {
        case GX2IndexFormat.U16_LE:
        case GX2IndexFormat.U32_LE:
            return indexBufferData;
        case GX2IndexFormat.U16:
            return betoh(indexBufferData, 2);
        case GX2IndexFormat.U32:
            return betoh(indexBufferData, 4);
        }
    }

    private translateFSHPBuffers(fshp: BFRES.FSHP, indexDatas: ArrayBufferSlice[]) {
        for (const mesh of fshp.meshes) {
            assert(mesh.indexBufferData.stride === 0);
            const indexData = this.translateIndexBuffer(mesh.indexFormat, mesh.indexBufferData.data);
            indexDatas.push(indexData);
        }
    }

    private translateIndexFormat(gl: WebGL2RenderingContext, indexFormat: GX2IndexFormat): GLenum {
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
 
    private translatePrimType(gl: WebGL2RenderingContext, primType: GX2PrimitiveType) {
        switch (primType) {
        case GX2PrimitiveType.TRIANGLES:
            return gl.TRIANGLES;
        default:
            throw new Error(`Unsupported primitive type ${primType}`);
        }
    }

    private translateFSHP(gl: WebGL2RenderingContext, fshp: BFRES.FSHP, coalescedIndex: CoalescedBuffer[]): RenderFunc {
        const glIndexBuffers: CoalescedBuffer[] = [];
        for (const mesh of fshp.meshes) {
            glIndexBuffers.push(coalescedIndex.shift());
        }

        return (state: RenderState) => {
            const lod = 0;
            const mesh = fshp.meshes[lod];
            const glIndexBuffer = glIndexBuffers[lod];
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, glIndexBuffer.buffer);

            for (const submesh of mesh.submeshes) {
                gl.drawElements(this.translatePrimType(gl, mesh.primType),
                    submesh.indexBufferCount,
                    this.translateIndexFormat(gl, mesh.indexFormat),
                    glIndexBuffer.offset + submesh.indexBufferOffset,
                );
            }
        }
    }

    private translateModel(gl: WebGL2RenderingContext, model: BFRES.ModelEntry, coalescedVertex: CoalescedBuffer[], coalescedIndex: CoalescedBuffer[]): RenderFunc {
        const fmdl = model.fmdl;
        const fvtxVaos: WebGLVertexArrayObject[] = fmdl.fvtx.map((fvtx) => this.translateFVTX(gl, fvtx, coalescedVertex));
        const fmatFuncs: RenderFunc[] = fmdl.fmat.map((fmat) => this.translateFMAT(gl, fmat));
        const fshpFuncs: RenderFunc[] = fmdl.fshp.map((fshp) => this.translateFSHP(gl, fshp, coalescedIndex));

        return (state: RenderState) => {
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
        const glTexture = this.arena.createTexture(gl);
        gl.bindTexture(gl.TEXTURE_2D, glTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        const surface = ftex.texture.surface;

        // Kick off a decode...
        GX2Texture.decodeTexture(surface, ftex.texture.texData, ftex.texture.mipData).then((tex: GX2Texture.DecodedTexture) => {
            gl.bindTexture(gl.TEXTURE_2D, glTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, tex.surfaces.length - 1);

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

            tex.surfaces.forEach((decodedSurface, i) => {
                const level = i;
                const pixels = decodedSurface.pixels;
                const width = decodedSurface.width;
                const height = decodedSurface.height;
                assert(pixels.byteLength > 0);

                switch (tex.type) {
                case "RGBA": {
                    const internalFormat = tex.flag === 'SRGB' ? gl.SRGB8_ALPHA8 : tex.flag === 'SNORM' ? gl.RGBA8I : gl.RGBA8;
                    const data = new Uint8Array(pixels);
                    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
                    break;
                }
                case "BC1":
                case "BC3":
                case "BC4":
                case "BC5": {
                    const compressedFormat = this.getCompressedFormat(gl, tex);
                    assert(compressedFormat !== null);
                    gl.compressedTexImage2D(gl.TEXTURE_2D, level, compressedFormat, width, height, 0, new Uint8Array(pixels));
                    break;
                }
                }
            });
        });

        return glTexture;
    }

    private translateModelBuffers(modelEntry: BFRES.ModelEntry, vertexDatas: ArrayBufferSlice[], indexDatas: ArrayBufferSlice[]) {
        // Translate vertex data.
        modelEntry.fmdl.fvtx.forEach((fvtx) => this.translateFVTXBuffers(fvtx, vertexDatas));
        modelEntry.fmdl.fshp.forEach((fshp) => this.translateFSHPBuffers(fshp, indexDatas));
    }

    private translateFRES(gl: WebGL2RenderingContext, fres: BFRES.FRES): RenderFunc[] {
        this.glTextures = fres.textures.map((ftex) => this.translateTexture(gl, ftex));

        // Gather buffers.
        const vertexDatas: ArrayBufferSlice[] = [];
        const indexDatas: ArrayBufferSlice[] = [];
        fres.models.forEach((modelEntry) => {
            this.translateModelBuffers(modelEntry, vertexDatas, indexDatas);
        });

        const coalescedVertex = coalesceBuffer(gl, gl.ARRAY_BUFFER, vertexDatas);
        const coalescedIndex = coalesceBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, indexDatas);
        this.arena.buffers.push(coalescedVertex[0].buffer);
        this.arena.buffers.push(coalescedIndex[0].buffer);

        return fres.models.map((modelEntry) => this.translateModel(gl, modelEntry, coalescedVertex, coalescedIndex));
    }

    public render(state: RenderState) {
        this.modelFuncs.forEach((func) => {
            func(state);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        // Tear down the deswizzle workers.
        deswizzler.terminate();
        this.arena.destroy(gl);
    }
}
