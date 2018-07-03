
import { GX2AttribFormat, GX2TexClamp, GX2TexXYFilterType, GX2TexMipFilterType, GX2FrontFaceMode, GX2CompareFunction, GX2PrimitiveType, GX2IndexFormat } from './gx2_enum';
import { deswizzler } from './gx2_swizzle';
import * as GX2Texture from './gx2_texture';
import * as BFRES from './bfres';

import * as Viewer from '../viewer';

import { RenderState, RenderFlags, FrontFaceMode, CompareMode, CullMode } from '../render';
import Program from '../Program';
import RenderArena from '../RenderArena';
import { assert } from '../util';
import ArrayBufferSlice from 'ArrayBufferSlice';
import { Endianness } from '../endian';
import { CoalescedBuffer, coalesceBuffer } from '../BufferCoalescer';

type RenderFunc = (renderState: RenderState) => void;

class ProgramGambit_UBER extends Program {
    public s_a0: WebGLUniformLocation;
    public s_e0: WebGLUniformLocation;
    public s_n0: WebGLUniformLocation;
    public s_s0: WebGLUniformLocation;
    public u_view: WebGLUniformLocation;

    public static attribLocations: { [name: string]: number } = {
        _p0: 0, // Position
        _n0: 1, // Normal
        _t0: 2, // Tangent
        _u0: 3, // UV of albedo map 0
        _u1: 4, // UV of albedo map 1
    };

    private $a = ProgramGambit_UBER.attribLocations;
    public vert = `
uniform mat4 u_modelView;
uniform mat4 u_projection;
uniform mat4 u_view;
layout(location = ${this.$a._p0}) in vec3 a_p0;
layout(location = ${this.$a._n0}) in vec3 a_n0;
layout(location = ${this.$a._t0}) in vec4 a_t0;
layout(location = ${this.$a._u0}) in vec2 a_u0;
layout(location = ${this.$a._u1}) in vec2 a_u1;

out vec3 v_PositionWorld;
out vec2 v_TexCoord0;
out vec3 v_NormalWorld;
out vec4 v_TangentWorld;

out vec3 v_CameraWorld;

void main() {
    gl_Position = u_projection * u_modelView * vec4(a_p0, 1.0);
    v_PositionWorld = a_p0.xyz;
    v_TexCoord0 = a_u0;
    v_NormalWorld = a_n0;
    v_TangentWorld = a_t0;
    // TODO(jstpierre): Don't be dumb.
    v_CameraWorld = inverse(u_view)[3].xyz;
}
`;

    public frag = `
uniform mat4 u_view;

uniform sampler2D s_a0;
uniform sampler2D s_n0;
uniform sampler2D s_e0;
uniform sampler2D s_s0;

in vec3 v_PositionWorld;
in vec2 v_TexCoord0;
in vec3 v_NormalWorld;
in vec4 v_TangentWorld;

in vec3 v_CameraWorld;

vec4 textureSRGB(sampler2D s, vec2 uv) {
    vec4 srgba = texture(s, uv);
    vec3 srgb = srgba.rgb;
    // XXX(jstpierre): Turn sRGB texturing back on at some point...
#ifndef NOPE_HAS_WEBGL_compressed_texture_s3tc_srgb
    vec3 rgb = srgb;
#else
    // http://chilliant.blogspot.com/2012/08/srgb-approximations-for-hlsl.html
    vec3 rgb = srgb * (srgb * (srgb * 0.305306011 + 0.682171111) + 0.012522878);
#endif
    return vec4(rgb, srgba.a);
}

void main() {
    vec4 tx_albedo0  = textureSRGB(s_a0, v_TexCoord0);
    vec4 tx_emissive = textureSRGB(s_e0, v_TexCoord0);
    vec4 tx_normal   = textureSRGB(s_n0, v_TexCoord0);
    vec4 tx_specular = textureSRGB(s_s0, v_TexCoord0);

    // Perturb normal with map.
    vec3 nrm = v_NormalWorld.xyz;
    vec3 tan = normalize(v_TangentWorld.xyz);
    vec3 btn = cross(nrm, tan) * v_TangentWorld.w;

    vec3 local_nrm = vec3(tx_normal.xy, 0);
    float len2 = 1.0 - local_nrm.x*local_nrm.x - local_nrm.y*local_nrm.y;
    local_nrm.z = sqrt(clamp(len2, 0.0, 1.0));
    vec3 normal_dir = (local_nrm.x * tan + local_nrm.y * btn + local_nrm.z * nrm);

    vec3 view_dir = normalize(v_PositionWorld.xyz - v_CameraWorld);
    vec3 refl_dir = reflect(-view_dir, normal_dir);

    // Calulate incident light.
    float diffuse = 0.0;
    float specular = 0.0;

    // Basic directional lighting.
    vec3 d_light_dir = normalize(vec3(-u_view[2].x, 0.0, u_view[2].z));
    // Sky-ish color. If we were better we would use a cubemap...
    const vec3 d_light_col = vec3(0.9, 0.9, 1.4);
    const float spec_power = 35.0;

    diffuse += clamp(dot(normal_dir, d_light_dir), 0.0, 1.0);
    specular += pow(clamp(dot(refl_dir, d_light_dir), 0.0, 1.0), spec_power);

    // Dumb constant ambient.
    diffuse += 0.6;
    specular += 0.012;

    vec3 diffuse_light = d_light_col * diffuse;
    vec3 specular_light = d_light_col * specular * tx_specular.x;

    vec4 albedo = tx_albedo0;
    // TODO(jstpierre): Multitex?

    o_color = vec4(0, 0, 0, 0);
    o_color.rgb += albedo.rgb * diffuse_light;
    o_color.rgb += specular_light;
    o_color.a = albedo.a;

    // TODO(jstpierre): Configurable alpha test
    if (o_color.a < 0.5)
        discard;

    o_color.rgb += tx_emissive.rgb;

    // Gamma correction.
    o_color.rgb = pow(o_color.rgb, vec3(1.0 / 2.2));
}
`;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);
        this.u_view = gl.getUniformLocation(prog, "u_view");
        this.s_a0 = gl.getUniformLocation(prog, "s_a0");
        this.s_e0 = gl.getUniformLocation(prog, "s_e0");
        this.s_n0 = gl.getUniformLocation(prog, "s_n0");
        this.s_s0 = gl.getUniformLocation(prog, "s_s0");
    }

    public getTextureUniformLocation(name: string): WebGLUniformLocation | null {
        if (name === "_a0")
            return this.s_a0;
        else if (name === "_e0")
            return this.s_e0;
        else if (name === "_n0")
            return this.s_n0;
        else if (name === "_s0")
            return this.s_s0;
        else
            return null;
    }
}

interface GX2AttribFormatInfo {
    compCount: number;
    elemSize: 1 | 2 | 4;
    type: number;
    normalized: boolean;
}

function getAttribFormatInfo(format: GX2AttribFormat): GX2AttribFormatInfo {
    switch (format) {
    case GX2AttribFormat._8_SINT:
        return { compCount: 1, elemSize: 1, type: WebGL2RenderingContext.BYTE, normalized: false };
    case GX2AttribFormat._8_SNORM:
        return { compCount: 1, elemSize: 1, type: WebGL2RenderingContext.BYTE, normalized: true };
    case GX2AttribFormat._8_UINT:
        return { compCount: 1, elemSize: 1, type: WebGL2RenderingContext.UNSIGNED_BYTE, normalized: false };
    case GX2AttribFormat._8_UNORM:
        return { compCount: 1, elemSize: 1, type: WebGL2RenderingContext.UNSIGNED_BYTE, normalized: true };
    case GX2AttribFormat._8_8_UNORM:
        return { compCount: 2, elemSize: 1, type: WebGL2RenderingContext.UNSIGNED_BYTE, normalized: true };
    case GX2AttribFormat._8_8_SNORM:
        return { compCount: 2, elemSize: 1, type: WebGL2RenderingContext.UNSIGNED_BYTE, normalized: true };
    case GX2AttribFormat._8_8_8_8_UNORM:
        return { compCount: 4, elemSize: 1, type: WebGL2RenderingContext.UNSIGNED_BYTE, normalized: true };
    case GX2AttribFormat._8_8_8_8_SNORM:
        return { compCount: 4, elemSize: 1, type: WebGL2RenderingContext.UNSIGNED_BYTE, normalized: true };
    case GX2AttribFormat._16_16_UNORM:
        return { compCount: 2, elemSize: 2, type: WebGL2RenderingContext.UNSIGNED_SHORT, normalized: true };
    case GX2AttribFormat._16_16_SNORM:
        return { compCount: 2, elemSize: 2, type: WebGL2RenderingContext.SHORT, normalized: true };
    case GX2AttribFormat._16_16_FLOAT:
        return { compCount: 2, elemSize: 2, type: WebGL2RenderingContext.HALF_FLOAT, normalized: false };
    case GX2AttribFormat._16_16_16_16_FLOAT:
        return { compCount: 4, elemSize: 2, type: WebGL2RenderingContext.HALF_FLOAT, normalized: false };
    case GX2AttribFormat._16_16_16_16_UNORM:
        return { compCount: 4, elemSize: 2, type: WebGL2RenderingContext.UNSIGNED_SHORT, normalized: true };
    case GX2AttribFormat._16_16_16_16_SNORM:
        return { compCount: 4, elemSize: 2, type: WebGL2RenderingContext.SHORT, normalized: true };
    case GX2AttribFormat._32_32_FLOAT:
        return { compCount: 2, elemSize: 4, type: WebGL2RenderingContext.FLOAT, normalized: false };
    case GX2AttribFormat._32_32_32_FLOAT:
        return { compCount: 4, elemSize: 4, type: WebGL2RenderingContext.FLOAT, normalized: false };
    case GX2AttribFormat._10_10_10_2_UNORM:
    case GX2AttribFormat._10_10_10_2_SNORM:
        // Should be handled during the buffer load case.
        return null;
    default:
        throw new Error(`Unsupported attribute format ${format}`);
    }
}

function convertVertexBufferCopy(buffer: BFRES.BufferData, attrib: BFRES.VtxAttrib, vtxCount: number): ArrayBufferSlice {
    const stride = buffer.stride;
    assert(stride !== 0);

    const formatInfo = getAttribFormatInfo(attrib.format);
    assert(formatInfo !== null);

    const numValues = vtxCount * formatInfo.compCount;

    function getOutputBuffer() {
        if (formatInfo.elemSize === 1)
            return new Uint8Array(numValues);
        else if (formatInfo.elemSize === 2)
            return new Uint16Array(numValues);
        else if (formatInfo.elemSize === 4)
            return new Uint32Array(numValues);
        else
            throw new Error();
    }

    const dataView = buffer.data.createDataView();
    const out = getOutputBuffer();

    let offs = attrib.bufferStart;
    let dst = 0;
    for (let i = 0; i < vtxCount; i++) {
        for (let j = 0; j < formatInfo.compCount; j++) {
            let srcOffs = offs + j * formatInfo.elemSize;
            if (formatInfo.elemSize === 1)
                out[dst] = dataView.getUint8(srcOffs);
            else if (formatInfo.elemSize === 2)
                out[dst] = dataView.getUint16(srcOffs);
            else if (formatInfo.elemSize === 4)
                out[dst] = dataView.getUint32(srcOffs);
            dst++;
        }
        offs += stride;
    }
    return new ArrayBufferSlice(out.buffer);
}

function convertVertexBuffer_10_10_10_2(buffer: BFRES.BufferData, attrib: BFRES.VtxAttrib, vtxCount: number): ArrayBufferSlice {
    assert(buffer.stride !== 0);

    const elemSize = 4;
    const compCount = 4;

    const numValues = vtxCount * compCount;

    let signed: boolean;
    function getOutputBuffer() {
        if (attrib.format === GX2AttribFormat._10_10_10_2_SNORM) {
            attrib.format = GX2AttribFormat._16_16_16_16_SNORM;
            signed = true;
            return new Int16Array(numValues);
        } else if (attrib.format === GX2AttribFormat._10_10_10_2_UNORM) {
            attrib.format = GX2AttribFormat._16_16_16_16_UNORM;
            signed = false;
            return new Uint16Array(numValues);
        } else {
            throw new Error("whoops");
        }
    }

    const view = buffer.data.createDataView();
    const out = getOutputBuffer();

    function signExtend10(n: number): number {
        if (signed)
            return (n << 22) >> 22;
        else
            return n;
    }

    let offs = attrib.bufferStart;
    let dst = 0;
    for (let i = 0; i < vtxCount; i++) {
        const n = view.getUint32(offs, false);
        out[dst++] = signExtend10((n >>>  0) & 0x3FF) << 4;
        out[dst++] = signExtend10((n >>> 10) & 0x3FF) << 4;
        out[dst++] = signExtend10((n >>> 20) & 0x3FF) << 4;
        out[dst++] = ((n >>> 30) & 0x03) << 14;
        offs += buffer.stride;
    }

    return new ArrayBufferSlice(out.buffer);
}

function convertVertexBuffer(buffer: BFRES.BufferData, attrib: BFRES.VtxAttrib, vtxCount: number): ArrayBufferSlice {
    const formatInfo = getAttribFormatInfo(attrib.format);

    if (formatInfo !== null) {
        const byteSize = formatInfo.compCount * formatInfo.elemSize;
        if (buffer.stride <= byteSize && attrib.bufferStart === 0) {
            // Fastest path -- just endian swap.
            return buffer.data.convertFromEndianness(Endianness.BIG_ENDIAN, formatInfo.elemSize);
        } else {
            // Has a native WebGL equivalent, just requires us to convert strides.
            return convertVertexBufferCopy(buffer, attrib, vtxCount);
        }
    } else {
        // No native WebGL equivalent. Let's see what we can do...
        switch (attrib.format) {
        case GX2AttribFormat._10_10_10_2_SNORM:
        case GX2AttribFormat._10_10_10_2_UNORM:
            return convertVertexBuffer_10_10_10_2(buffer, attrib, vtxCount);
        }
    }

    throw new Error("whoops");
}

export class Scene implements Viewer.Scene {
    public textures: Viewer.Texture[];

    private modelFuncs: RenderFunc[];
    private glTextures: WebGLTexture[];
    private blankTexture: WebGLTexture;
    private arena: RenderArena;

    private prog: ProgramGambit_UBER = new ProgramGambit_UBER();

    constructor(gl: WebGL2RenderingContext, private fres: BFRES.FRES, private isSkybox: boolean) {
        this.fres = fres;

        this.arena = new RenderArena();

        this.blankTexture = this.arena.createTexture(gl);
        gl.bindTexture(gl.TEXTURE_2D, this.blankTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

        this.textures = [];
        this.modelFuncs = this.translateFRES(gl, this.fres);
    }

    private translateFVTXBuffers(fvtx: BFRES.FVTX, vertexDatas: ArrayBufferSlice[]) {
        for (let i = 0; i < fvtx.attribs.length; i++) {
            const attrib = fvtx.attribs[i];
            const location = ProgramGambit_UBER.attribLocations[attrib.name];

            if (location === undefined)
                continue;

            const buffer = fvtx.buffers[attrib.bufferIndex];
            // Convert the vertex buffer data into a loadable format... might edit "attrib"
            // if it has to load a non-WebGL-native format...
            const vertexData = convertVertexBuffer(buffer, attrib, fvtx.vtxCount);
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
            gl.vertexAttribPointer(location, formatInfo.compCount, formatInfo.type, formatInfo.normalized, 0, buffer.offset);
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
        const attribNames = ['_a0', '_e0', '_n0', '_s0'];
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

        // const prog = new ProgramGambit_UBER();
        // this.arena.trackProgram(prog);
        const prog = this.prog;

        const renderFlags = this.translateRenderState(fmat.renderState);

        return (state: RenderState) => {
            state.useProgram(prog);
            state.bindModelView(this.isSkybox);
            gl.uniformMatrix4fv(prog.u_view, false, state.view);

            state.useFlags(renderFlags);

            // Textures.
            for (let i = 0; i < attribNames.length; i++) {
                const attribName = attribNames[i];

                gl.activeTexture(gl.TEXTURE0 + i);

                const uniformLocation = prog.getTextureUniformLocation(attribName)
                gl.uniform1i(uniformLocation, i);

                const textureAssignIndex = textureAssigns.findIndex((textureAssign) => textureAssign.attribName === attribName);
                let bound = false;
                if (textureAssignIndex >= 0) {
                    const textureAssign = textureAssigns[textureAssignIndex];

                    const ftexIndex = this.fres.textures.findIndex((textureEntry) => textureEntry.entry.offs === textureAssign.ftexOffs);
                    if (ftexIndex >= 0) {
                        const ftex = this.fres.textures[ftexIndex];
                        assert(ftex.entry.name === textureAssign.textureName);

                        const glTexture = this.glTextures[ftexIndex];
                        gl.bindTexture(gl.TEXTURE_2D, glTexture);

                        const sampler = samplers[textureAssignIndex];
                        gl.bindSampler(i, sampler);
                        bound = true;
                    }
                }

                if (!bound) {
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
            return indexBufferData.convertFromEndianness(Endianness.BIG_ENDIAN, 2);
        case GX2IndexFormat.U32:
            return indexBufferData.convertFromEndianness(Endianness.BIG_ENDIAN, 4);
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

    private getCompressedFormat(gl: WebGL2RenderingContext, tex: GX2Texture.DecodedSurfaceBC): number  {
        switch (tex.type) {
        case 'BC4':
        case 'BC5':
            return null;
        }

        const ext_compressed_texture_s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
        // const ext_compressed_texture_s3tc_srgb = gl.getExtension('WEBGL_compressed_texture_s3tc_srgb');

        // XXX(jstpierre): Don't use sRGB for now since we sometimes fall back to SW decode.
        /*
        if (tex.flag === 'SRGB' && ext_compressed_texture_s3tc_srgb) {
            switch (tex.type) {
            case 'BC1':
                return ext_compressed_texture_s3tc_srgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;
            case 'BC3':
                return ext_compressed_texture_s3tc_srgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT;
            }
        }
        */

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

    private translateTexture(gl: WebGL2RenderingContext, textureEntry: BFRES.TextureEntry): WebGLTexture {
        const glTexture = this.arena.createTexture(gl);
        gl.bindTexture(gl.TEXTURE_2D, glTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        const texture = textureEntry.texture;
        const surface = texture.surface;

        const canvases: HTMLCanvasElement[] = [];

        for (let i = 0; i < surface.numMips; i++) {
            const mipLevel = i;

            const canvas = document.createElement('canvas');
            canvas.width = 0;
            canvas.height = 0;
            canvases.push(canvas);

            GX2Texture.decodeSurface(surface, texture.texData, texture.mipData, mipLevel).then((decodedSurface: GX2Texture.DecodedSurface) => {
                // Sometimes the surfaces appear to have garbage sizes.
                if (decodedSurface.width === 0 || decodedSurface.height === 0)
                    return;

                gl.bindTexture(gl.TEXTURE_2D, glTexture);
                // Decodes should show up in order, thanks to priority. Change this if we ever
                // change the logic, because it is indeed sketchy...
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, mipLevel);

                // XXX(jstpierre): Sometimes Splatoon uses non-block-sized textures. OpenGL does
                // not like this one bit. If this is the case, decompress in software.
                const isBlockSized = !!(texture.surface.width & 0x03) || !!(texture.surface.height & 0x03);

                // First check if we have to decompress compressed textures.
                switch (decodedSurface.type) {
                case "BC1":
                case "BC3":
                case "BC4":
                case "BC5":
                    const compressedFormat = this.getCompressedFormat(gl, decodedSurface);
                    if (compressedFormat === null || !isBlockSized)
                        decodedSurface = GX2Texture.decompressBC(decodedSurface);
                    break;
                }

                const pixels = decodedSurface.pixels;
                const width = decodedSurface.width;
                const height = decodedSurface.height;
                assert(pixels.byteLength > 0);

                switch (decodedSurface.type) {
                case "RGBA": {
                    const internalFormat = decodedSurface.flag === 'SRGB' ? gl.SRGB8_ALPHA8 : decodedSurface.flag === 'SNORM' ? gl.RGBA8_SNORM : gl.RGBA8;
                    const type = decodedSurface.flag === 'SNORM' ? gl.BYTE : gl.UNSIGNED_BYTE;
                    const data = decodedSurface.flag === 'SNORM' ? new Int8Array(pixels) : new Uint8Array(pixels);
                    gl.texImage2D(gl.TEXTURE_2D, mipLevel, internalFormat, width, height, 0, gl.RGBA, type, data);
                    break;
                }
                case "BC1":
                case "BC3":
                case "BC4":
                case "BC5": {
                    const compressedFormat = this.getCompressedFormat(gl, decodedSurface);
                    assert(compressedFormat !== null);
                    gl.compressedTexImage2D(gl.TEXTURE_2D, mipLevel, compressedFormat, width, height, 0, new Uint8Array(pixels));
                    break;
                }
                }

                // XXX(jstpierre): Do this on a worker as well?
                const canvas = canvases[mipLevel];
                const decompressedSurface = GX2Texture.decompressSurface(decodedSurface);
                canvas.width = decompressedSurface.width;
                canvas.height = decompressedSurface.height;
                canvas.title = `${textureEntry.entry.name} ${surface.format} (${surface.width}x${surface.height})`;
                GX2Texture.surfaceToCanvas(canvas, decompressedSurface);
            });
        }

        this.textures.push({ name: textureEntry.entry.name, surfaces: canvases });

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
