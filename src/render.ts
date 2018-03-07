
import { mat4 } from 'gl-matrix';
import { assert, align } from './util';

export const enum RenderPass {
    CLEAR,
    DEPTH_PREPASS,
    OPAQUE,
    TRANSPARENT,
    COUNT,
}

export enum CompareMode {
    NEVER   = WebGLRenderingContext.NEVER,
    LESS    = WebGLRenderingContext.LESS,
    EQUAL   = WebGLRenderingContext.EQUAL,
    LEQUAL  = WebGLRenderingContext.LEQUAL,
    GREATER = WebGLRenderingContext.GREATER,
    NEQUAL  = WebGLRenderingContext.NOTEQUAL,
    GEQUAL  = WebGLRenderingContext.GEQUAL,
    ALWAYS  = WebGLRenderingContext.ALWAYS,
}

export enum FrontFaceMode {
    CCW = WebGLRenderingContext.CCW,
    CW  = WebGLRenderingContext.CW,
}

export enum CullMode {
    NONE,
    FRONT,
    BACK,
    FRONT_AND_BACK,
}

export enum BlendFactor {
    ZERO                = WebGLRenderingContext.ZERO,
    ONE                 = WebGLRenderingContext.ONE,
    SRC_COLOR           = WebGLRenderingContext.SRC_COLOR,
    ONE_MINUS_SRC_COLOR = WebGLRenderingContext.ONE_MINUS_SRC_COLOR,
    DST_COLOR           = WebGLRenderingContext.DST_COLOR,
    ONE_MINUS_DST_COLOR = WebGLRenderingContext.ONE_MINUS_DST_COLOR,
    SRC_ALPHA           = WebGLRenderingContext.SRC_ALPHA,
    ONE_MINUS_SRC_ALPHA = WebGLRenderingContext.ONE_MINUS_SRC_ALPHA,
    DST_ALPHA           = WebGLRenderingContext.DST_ALPHA,
    ONE_MINUS_DST_ALPHA = WebGLRenderingContext.ONE_MINUS_DST_ALPHA,
}

export enum BlendMode {
    NONE             = 0,
    ADD              = WebGLRenderingContext.FUNC_ADD,
    SUBTRACT         = WebGLRenderingContext.FUNC_SUBTRACT,
    REVERSE_SUBTRACT = WebGLRenderingContext.FUNC_REVERSE_SUBTRACT,
}

export class RenderFlags {
    public depthWrite: boolean = undefined;
    public depthTest: boolean = undefined;
    public depthFunc: CompareMode = undefined;
    public blendSrc: BlendFactor = undefined;
    public blendDst: BlendFactor = undefined;
    public blendMode: BlendMode = undefined;
    public cullMode: CullMode = undefined;
    public frontFace: FrontFaceMode = undefined;

    static default: RenderFlags = new RenderFlags();

    static flatten(dst: RenderFlags, src: RenderFlags) {
        if (dst.depthWrite === undefined)
            dst.depthWrite = src.depthWrite;
        if (dst.depthTest === undefined)
            dst.depthTest = src.depthTest;
        if (dst.depthFunc === undefined)
            dst.depthFunc = src.depthFunc;
        if (dst.blendMode === undefined)
            dst.blendMode = src.blendMode;
        if (dst.blendSrc === undefined)
            dst.blendSrc = src.blendSrc;
        if (dst.blendDst === undefined)
            dst.blendDst = src.blendDst;
        if (dst.cullMode === undefined)
            dst.cullMode = src.cullMode;
        if (dst.frontFace === undefined)
            dst.frontFace = src.frontFace;
    }

    static apply(gl: WebGL2RenderingContext, oldFlags: RenderFlags, newFlags: RenderFlags) {
        if (oldFlags.depthWrite !== newFlags.depthWrite) {
            gl.depthMask(newFlags.depthWrite);
        }

        if (oldFlags.depthTest !== newFlags.depthTest) {
            if (newFlags.depthTest)
                gl.enable(gl.DEPTH_TEST);
            else
                gl.disable(gl.DEPTH_TEST);
        }

        if (oldFlags.blendMode !== newFlags.blendMode) {
            if (newFlags.blendMode !== BlendMode.NONE) {
                gl.enable(gl.BLEND);
                gl.blendEquation(newFlags.blendMode);
            } else {
                gl.disable(gl.BLEND);
            }
        }

        if (oldFlags.blendSrc !== newFlags.blendSrc || oldFlags.blendDst !== newFlags.blendDst) {
            gl.blendFunc(newFlags.blendSrc, newFlags.blendDst);
        }

        if (oldFlags.depthFunc !== newFlags.depthFunc) {
            gl.depthFunc(newFlags.depthFunc);
        }

        if (oldFlags.cullMode !== newFlags.cullMode) {
            if (oldFlags.cullMode === CullMode.NONE)
                gl.enable(gl.CULL_FACE);
            else if (newFlags.cullMode === CullMode.NONE)
                gl.disable(gl.CULL_FACE);

            if (newFlags.cullMode === CullMode.BACK)
                gl.cullFace(gl.BACK);
            else if (newFlags.cullMode === CullMode.FRONT)
                gl.cullFace(gl.FRONT);
            else if (newFlags.cullMode === CullMode.FRONT_AND_BACK)
                gl.cullFace(gl.FRONT_AND_BACK);
        }

        if (oldFlags.frontFace !== newFlags.frontFace) {
            gl.frontFace(newFlags.frontFace);
        }
    }
}

RenderFlags.default.blendMode = BlendMode.NONE;
RenderFlags.default.blendSrc = BlendFactor.SRC_ALPHA;
RenderFlags.default.blendDst = BlendFactor.ONE_MINUS_SRC_ALPHA;
RenderFlags.default.cullMode = CullMode.NONE;
RenderFlags.default.depthTest = false;
RenderFlags.default.depthWrite = true;
RenderFlags.default.depthFunc = CompareMode.LEQUAL;
RenderFlags.default.frontFace = FrontFaceMode.CCW;

export interface Viewport {
    canvas: HTMLCanvasElement;
    gl: WebGL2RenderingContext;
}

export class RenderState {
    public gl: WebGL2RenderingContext;
    public viewport: Viewport;

    // State.
    public currentProgram: Program = null;
    public currentFlags: RenderFlags = new RenderFlags();
    public currentPass: RenderPass;

    // Parameters.
    public fov: number;
    public time: number;

    public projection: mat4;
    public view: mat4;

    public nearClipPlane: number;
    public farClipPlane: number;

    private scratchMatrix: mat4;

    public drawCallCount: number;
    public frameStartTime: number;

    constructor(viewport: Viewport) {
        this.viewport = viewport;
        this.gl = this.viewport.gl;
        this.time = 0;
        this.fov = Math.PI / 4;

        this.projection = mat4.create();
        this.view = mat4.create();
        this.scratchMatrix = mat4.create();
    }

    public setView(m: mat4) {
        mat4.copy(this.view, m);
    }

    public checkResize() {
        // TODO(jstpierre): Make viewport explicit
        const canvas = this.viewport.canvas;
        const gl = this.gl;

        const width = canvas.width, height = canvas.height;
        mat4.perspective(this.projection, this.fov, width / height, this.nearClipPlane, this.farClipPlane);

        gl.viewport(0, 0, canvas.width, canvas.height);

        // XXX(jstpierre): move into reset
        this.drawCallCount = 0;
        this.frameStartTime = window.performance.now();
    }

    public setClipPlanes(near: number, far: number) {
        this.nearClipPlane = near;
        this.farClipPlane = far;
    }

    public useProgram(prog: Program) {
        const gl = this.gl;
        this.currentProgram = prog;
        gl.useProgram(prog.compile(gl));
        gl.uniformMatrix4fv(prog.projectionLocation, false, this.projection);
    }

    public bindModelView(isSkybox: boolean = false, model: mat4 = null) {
        const gl = this.gl;
        const prog = this.currentProgram;

        const scratch = this.scratchMatrix;

        mat4.copy(scratch, this.view);
        if (isSkybox) {
            scratch[12] = 0;
            scratch[13] = 0;
            scratch[14] = 0;
        }

        if (model)
            mat4.mul(scratch, model, scratch);

        gl.uniformMatrix4fv(prog.modelViewLocation, false, scratch);
    }

    public useFlags(flags: RenderFlags) {
        const gl = this.gl;
        // TODO(jstpierre): Move the flattening to a stack, possibly?
        RenderFlags.flatten(flags, this.currentFlags);
        RenderFlags.apply(gl, this.currentFlags, flags);
        this.currentFlags = flags;
    }
}

function compileShader(gl: WebGL2RenderingContext, str: string, type: number) {
    const shader: WebGLShader = gl.createShader(type);

    gl.shaderSource(shader, str);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(str);
        if (gl.getExtension('WEBGL_debug_shaders'))
            console.error(gl.getExtension('WEBGL_debug_shaders').getTranslatedShaderSource(shader));
        console.error(gl.getShaderInfoLog(shader));
        throw new Error();
    }

    return shader;
}

export class Program {
    public vert: string;
    public frag: string;

    public projectionLocation: WebGLUniformLocation;
    public modelViewLocation: WebGLUniformLocation;

    private glProg: WebGLProgram;

    public compile(gl: WebGL2RenderingContext) {
        if (this.glProg)
            return this.glProg;

        const vert = this.preprocessShader(gl, this.vert, "vert");
        const frag = this.preprocessShader(gl, this.frag, "frag");
        const vertShader = compileShader(gl, vert, gl.VERTEX_SHADER);
        const fragShader = compileShader(gl, frag, gl.FRAGMENT_SHADER);
        const prog = gl.createProgram();
        gl.attachShader(prog, vertShader);
        gl.attachShader(prog, fragShader);
        gl.linkProgram(prog);
        gl.deleteShader(vertShader);
        gl.deleteShader(fragShader);
        this.glProg = prog;
        this.bind(gl, prog);
        return this.glProg;
    }

    protected preprocessShader(gl: WebGL2RenderingContext, source: string, type: "vert" | "frag") {
        // Garbage WebGL2 compatibility until I get something better down the line...
        const lines = source.split('\n');
        const precision = lines.find((line) => line.startsWith('precision')) || 'precision mediump float;';
        const extensionLines = lines.filter((line) => line.startsWith('#extension'));
        const extensions = extensionLines.filter((line) =>
            line.indexOf('GL_EXT_frag_depth') === -1 ||
            line.indexOf('GL_OES_standard_derivatives') === -1
        ).join('\n');
        const rest = lines.filter((line) => !line.startsWith('precision') && !line.startsWith('#extension')).join('\n');

        const extensionDefines = gl.getSupportedExtensions().map((s) => {
            return `#define HAS_${s}`;
        }).join('\n');
        return `
#version 300 es
#define attribute in
#define varying ${type === 'vert' ? 'out' : 'in'}
${extensionDefines}
#define gl_FragColor o_color
#define gl_FragDepthEXT gl_FragDepth
#define texture2D texture
${extensions}
${precision}
out vec4 o_color;
${rest}
`.trim();
    }

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        this.modelViewLocation = gl.getUniformLocation(prog, "u_modelView");
        this.projectionLocation = gl.getUniformLocation(prog, "u_projection");
    }

    public track(arena: RenderArena) {
        arena.programs.push(this.glProg);
    }

    public destroy(gl: WebGL2RenderingContext) {
        gl.deleteProgram(this.glProg);
    }
}

function pushAndReturn<T>(a: T[], v: T) {
    a.push(v);
    return v;
}

// Optional helper providing a lazy attempt at arena-style garbage collection.
export class RenderArena {
    public textures: WebGLTexture[] = [];
    public samplers: WebGLSampler[] = [];
    public buffers: WebGLBuffer[] = [];
    public vaos: WebGLVertexArrayObject[] = [];
    public programs: WebGLProgram[] = [];

    public createTexture(gl: WebGL2RenderingContext) {
        return pushAndReturn(this.textures, gl.createTexture());
    }
    public createSampler(gl: WebGL2RenderingContext) {
        return pushAndReturn(this.samplers, gl.createSampler());
    }
    public createBuffer(gl: WebGL2RenderingContext) {
        return pushAndReturn(this.buffers, gl.createBuffer());
    }
    public createVertexArray(gl: WebGL2RenderingContext) {
        return pushAndReturn(this.vaos, gl.createVertexArray());
    }
    public trackProgram(program: Program) {
        program.track(this);
    }

    public destroy(gl: WebGL2RenderingContext) {
        for (const texture of this.textures)
            gl.deleteTexture(texture);
        this.textures = [];
        for (const sampler of this.samplers)
            gl.deleteSampler(sampler);
        this.samplers = [];
        for (const buffer of this.buffers)
            gl.deleteBuffer(buffer);
        this.buffers = [];
        for (const vao of this.vaos)
            gl.deleteVertexArray(vao);
        this.vaos = [];
        for (const program of this.programs)
            gl.deleteProgram(program);
        this.programs = [];
    }
}

export interface CoalescedBuffer {
    buffer: WebGLBuffer;
    offset: number;
}

export interface CoalescedBuffers {
    vertexBuffer: CoalescedBuffer;
    indexBuffer: CoalescedBuffer;
}

export function coalesceBuffer(gl: WebGL2RenderingContext, target: number, datas: ArrayBuffer[]): CoalescedBuffer[] {
    let dataLength = 0;
    for (const data of datas) {
        dataLength += data.byteLength;
        dataLength = align(dataLength, 4);
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, dataLength, gl.STATIC_DRAW);

    const coalescedBuffers: CoalescedBuffer[] = [];

    let offset = 0;
    for (const data of datas) {
        const size = data.byteLength;
        coalescedBuffers.push({ buffer, offset });
        gl.bufferSubData(target, offset, data);
        offset += size;
        offset = align(offset, 4);
    }

    return coalescedBuffers;
}

export class BufferCoalescer {
    public coalescedBuffers: CoalescedBuffers[];
    private vertexBuffer: WebGLBuffer;
    private indexBuffer: WebGLBuffer;

    constructor(gl: WebGL2RenderingContext, vertexDatas: ArrayBuffer[], indexDatas: ArrayBuffer[]) {
        assert(vertexDatas.length === indexDatas.length);
        const vertexCoalescedBuffers = coalesceBuffer(gl, gl.ARRAY_BUFFER, vertexDatas);
        const indexCoalescedBuffers = coalesceBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, indexDatas);
    
        const coalescedBuffers = [];
        for (let i = 0; i < vertexCoalescedBuffers.length; i++) {
            const vertexBuffer = vertexCoalescedBuffers[i];
            const indexBuffer = indexCoalescedBuffers[i];
            coalescedBuffers.push({ vertexBuffer, indexBuffer });
        }

        this.coalescedBuffers = coalescedBuffers;
        this.vertexBuffer = this.coalescedBuffers[0].vertexBuffer.buffer;
        this.indexBuffer = this.coalescedBuffers[0].indexBuffer.buffer;
    }

    public destroy(gl: WebGL2RenderingContext): void {
        gl.deleteBuffer(this.vertexBuffer);
        gl.deleteBuffer(this.indexBuffer);
    }
}
