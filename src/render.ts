
import { mat4 } from 'gl-matrix';

export const enum FrontFaceMode {
    CCW,
    CW
}

export const enum CullMode {
    NONE,
    FRONT,
    BACK,
    FRONT_AND_BACK
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

export class RenderFlags {
    depthWrite: boolean = undefined;
    depthTest: boolean = undefined;
    blend: boolean = undefined;
    cullMode: CullMode = undefined;
    frontFace: FrontFaceMode = undefined;

    static default: RenderFlags = new RenderFlags();

    static flatten(dst: RenderFlags, src: RenderFlags) {
        if (dst.depthWrite === undefined)
            dst.depthWrite = src.depthWrite;
        if (dst.depthTest === undefined)
            dst.depthTest = src.depthTest;
        if (dst.blend === undefined)
            dst.blend = src.blend;
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

        if (oldFlags.blend !== newFlags.blend) {
            if (newFlags.blend)
                gl.enable(gl.BLEND);
            else
                gl.disable(gl.BLEND);
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
            if (newFlags.frontFace === FrontFaceMode.CCW)
                gl.frontFace(gl.CCW);
            else if (newFlags.frontFace === FrontFaceMode.CW)
                gl.frontFace(gl.CW);
        }
    }
}

RenderFlags.default.blend = false;
RenderFlags.default.cullMode = CullMode.NONE;
RenderFlags.default.depthTest = false;
RenderFlags.default.depthWrite = true;
RenderFlags.default.frontFace = FrontFaceMode.CCW;

export interface Viewport {
    canvas: HTMLCanvasElement;
    gl: WebGL2RenderingContext;
}

export class RenderState {
    public gl: WebGL2RenderingContext;
    public viewport: Viewport;
    public currentProgram: Program = null;
    public currentFlags: RenderFlags = RenderFlags.default;
    public fov: number;
    public time: number;

    public projection: mat4;
    public modelView: mat4;

    constructor(viewport: Viewport) {
        this.viewport = viewport;
        this.gl = this.viewport.gl;
        this.time = 0;
        this.fov = Math.PI / 4;

        this.projection = mat4.create();
        this.modelView = mat4.create();
    }

    public checkResize() {
        // TODO(jstpierre): Make viewport explicit
        const canvas = this.viewport.canvas;
        const gl = this.gl;

        const width = canvas.width, height = canvas.height;
        // XXX(jstpierre): Make near / far plane configurable per-Scene?
        mat4.perspective(this.projection, this.fov, width / height, 0.2, 50000);

        gl.viewport(0, 0, canvas.width, canvas.height);
    }

    public useProgram(prog: Program) {
        const gl = this.gl;
        this.currentProgram = prog;
        gl.useProgram(prog.compile(gl));
        gl.uniformMatrix4fv(prog.projectionLocation, false, this.projection);
        gl.uniformMatrix4fv(prog.modelViewLocation, false, this.modelView);
    }

    public useFlags(flags: RenderFlags) {
        const gl = this.gl;
        // TODO(jstpierre): Move the flattening to a stack, possibly?
        RenderFlags.flatten(flags, this.currentFlags);
        RenderFlags.apply(gl, this.currentFlags, flags);
        this.currentFlags = flags;
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
