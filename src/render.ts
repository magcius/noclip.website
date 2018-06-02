
import { mat4 } from 'gl-matrix';
import { assert, align, assertExists } from './util';
import ArrayBufferSlice from 'ArrayBufferSlice';
import Program, { BaseProgram, FullscreenProgram, ProgramCache } from 'Program';
import { Camera, computeViewMatrix, computeViewMatrixSkybox } from './Camera';

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

interface RenderFlagsResolved {
    depthWrite: boolean;
    depthTest: boolean;
    depthFunc: CompareMode;
    blendSrc: BlendFactor;
    blendDst: BlendFactor;
    blendMode: BlendMode;
    cullMode: CullMode;
    frontFace: FrontFaceMode;
}

export class RenderFlags {
    public depthWrite: boolean | undefined = undefined;
    public depthTest: boolean | undefined = undefined;
    public depthFunc: CompareMode | undefined = undefined;
    public blendSrc: BlendFactor | undefined = undefined;
    public blendDst: BlendFactor | undefined = undefined;
    public blendMode: BlendMode | undefined = undefined;
    public cullMode: CullMode | undefined = undefined;
    public frontFace: FrontFaceMode | undefined = undefined;

    static default: RenderFlags = new RenderFlags();

    static flatten(dst: RenderFlags, src: RenderFlags): RenderFlagsResolved {
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
        return <RenderFlagsResolved> dst;
    }

    static apply(gl: WebGL2RenderingContext, oldFlags: RenderFlags, newFlags: RenderFlagsResolved) {
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

export interface CoalescedBuffer {
    buffer: WebGLBuffer;
    offset: number;
}

export interface CoalescedBuffers {
    vertexBuffer: CoalescedBuffer;
    indexBuffer: CoalescedBuffer;
}

export function coalesceBuffer(gl: WebGL2RenderingContext, target: number, datas: ArrayBufferSlice[]): CoalescedBuffer[] {
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
        gl.bufferSubData(target, offset, data.createTypedArray(Uint8Array));
        offset += size;
        offset = align(offset, 4);
    }

    return coalescedBuffers;
}

export class BufferCoalescer {
    public coalescedBuffers: CoalescedBuffers[];
    private vertexBuffer: WebGLBuffer;
    private indexBuffer: WebGLBuffer;

    constructor(gl: WebGL2RenderingContext, vertexDatas: ArrayBufferSlice[], indexDatas: ArrayBufferSlice[]) {
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

class FullscreenCopyProgram extends FullscreenProgram {
    public frag: string = `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

void main() {
    vec4 color = texture(u_Texture, v_TexCoord);
    gl_FragColor = vec4(color.rgb, 1.0);
}
`;
}

const RENDER_SAMPLES = 4;

export class ColorTarget {
    public width: number;
    public height: number;
    public samples: number;

    public msaaColorRenderbuffer: WebGLRenderbuffer;

    // XXX(jstpierre): Should probably be not in here...
    public resolvedColorTexture: WebGLTexture;

    public destroy(gl: WebGL2RenderingContext) {
        if (this.msaaColorRenderbuffer)
            gl.deleteRenderbuffer(this.msaaColorRenderbuffer);
        if (this.resolvedColorTexture)
            gl.deleteTexture(this.resolvedColorTexture);
    }

    public setParameters(gl: WebGL2RenderingContext, width: number, height: number, samples: number = RENDER_SAMPLES) {
        if (this.width === width && this.height === height && this.samples === samples)
            return;

        this.destroy(gl);

        this.width = width;
        this.height = height;
        this.samples = samples;

        this.msaaColorRenderbuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaColorRenderbuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, this.width, this.height);

        this.resolvedColorTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.resolvedColorTexture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.width, this.height);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    public resolve(gl: WebGL2RenderingContext) {
        const readFramebuffer = gl.createFramebuffer();
        const resolveFramebuffer = gl.createFramebuffer();

        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFramebuffer);
        gl.framebufferRenderbuffer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msaaColorRenderbuffer);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolveFramebuffer);
        gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.resolvedColorTexture, 0);
        gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.LINEAR);

        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        gl.deleteFramebuffer(readFramebuffer);
        gl.deleteFramebuffer(resolveFramebuffer);

        return this.resolvedColorTexture;
    }
}

export class DepthTarget {
    public width: number;
    public height: number;
    public samples: number;

    public msaaDepthRenderbuffer: WebGLRenderbuffer;

    public destroy(gl: WebGL2RenderingContext) {
        if (this.msaaDepthRenderbuffer)
            gl.deleteRenderbuffer(this.msaaDepthRenderbuffer);
    }

    public setParameters(gl: WebGL2RenderingContext, width: number, height: number, samples: number = RENDER_SAMPLES) {
        if (this.width === width && this.height === height && this.samples === samples)
            return;

        this.destroy(gl);

        this.width = width;
        this.height = height;
        this.samples = samples;

        this.msaaDepthRenderbuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaDepthRenderbuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH24_STENCIL8, this.width, this.height);
    }
}

// XXX(jstpierre): This is becoming a lot more than just some render state.
// Rename to "SceneRenderer" at some point?
export class RenderState {
    private programCache: ProgramCache;

    // State.
    public currentProgram: BaseProgram | null = null;
    public currentFlags: RenderFlags = new RenderFlags();

    private currentColorTarget: ColorTarget | null = null;
    private currentDepthTarget: DepthTarget | null = null;

    // Parameters.
    public fov: number;
    public time: number;

    // TODO(jstpierre): Move projection matrix to Camera.
    public projection: mat4;
    public camera: Camera;

    public nearClipPlane: number;
    public farClipPlane: number;

    private scratchMatrix: mat4;

    public drawCallCount: number = 0;
    public frameStartTime: number = 0;

    public onscreenColorTarget: ColorTarget;
    public onscreenDepthTarget: DepthTarget;

    private fullscreenCopyProgram: FullscreenCopyProgram;
    private fullscreenFlags: RenderFlags;
    private msaaFramebuffer: WebGLFramebuffer;

    constructor(public gl: WebGL2RenderingContext) {
        this.programCache = new ProgramCache(this.gl);

        this.time = 0;
        this.fov = Math.PI / 4;

        this.projection = mat4.create();
        this.camera = new Camera();
        this.scratchMatrix = mat4.create();

        this.fullscreenCopyProgram = new FullscreenCopyProgram();
        this.fullscreenFlags = new RenderFlags();
        this.fullscreenFlags.depthTest = false;
        this.fullscreenFlags.blendMode = BlendMode.NONE;
        this.fullscreenFlags.cullMode = CullMode.NONE;

        this.msaaFramebuffer = assertExists(gl.createFramebuffer());
    }

    // TODO(jstpierre): Remove.
    public get view(): mat4 {
        return this.camera.viewMatrix;
    }

    public destroy() {
        const gl = this.gl;
        gl.deleteFramebuffer(this.msaaFramebuffer);
    }

    public reset() {
        this.drawCallCount = 0;
        this.frameStartTime = window.performance.now();
        this.useRenderTarget(this.onscreenColorTarget, this.onscreenDepthTarget);
        this.useFlags(RenderFlags.default);
    }

    // XXX(jstpierre): Design a better API than this.
    public runFullscreen(flags: RenderFlags | null = null): void {
        const gl = this.gl;
        this.useFlags(flags !== null ? flags : this.fullscreenFlags);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    private blitFullscreenTexture(colorTexture: WebGLTexture, flags: RenderFlags | null = null) {
        const gl = this.gl;
        this.useProgram(this.fullscreenCopyProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, colorTexture);
        gl.bindSampler(0, null);
        this.runFullscreen(flags);
    }

    public blitColorTarget(colorTarget: ColorTarget, flags: RenderFlags | null = null) {
        const gl = this.gl;
        const resolvedColorTexture = colorTarget.resolve(gl);
        // Make sure to re-bind our destination RT, since the resolve screws things up...
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.msaaFramebuffer);
        this.blitFullscreenTexture(resolvedColorTexture, flags);
    }

    public blitOnscreenToGL() {
        const gl = this.gl;
        const resolvedColorTexture = this.onscreenColorTarget.resolve(gl);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        this.blitFullscreenTexture(resolvedColorTexture);
    }

    public setOnscreenRenderTarget(colorTarget: ColorTarget, depthTarget: DepthTarget) {
        this.onscreenColorTarget = colorTarget;
        this.onscreenDepthTarget = depthTarget;
    }

    public useRenderTarget(colorTarget: ColorTarget, depthTarget: DepthTarget = this.onscreenDepthTarget) {
        const gl = this.gl;

        if (colorTarget !== null && depthTarget !== null) {
            // Assert our invariants.
            assert(colorTarget.width === depthTarget.width);
            assert(colorTarget.height === depthTarget.height);
            assert(colorTarget.samples === depthTarget.samples);
        }

        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.msaaFramebuffer);

        this.currentColorTarget = colorTarget;
        const colorRenderbuffer = this.currentColorTarget ? this.currentColorTarget.msaaColorRenderbuffer : null;
        gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, colorRenderbuffer);

        this.currentDepthTarget = depthTarget;
        const depthRenderbuffer = this.currentDepthTarget ? this.currentDepthTarget.msaaDepthRenderbuffer : null;
        gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRenderbuffer);

        this.bindViewport();
    }

    public bindViewport(): void {
        const gl = this.gl;
        const width = this.currentColorTarget.width, height = this.currentColorTarget.height;
        mat4.perspective(this.projection, this.fov, width / height, this.nearClipPlane, this.farClipPlane);
        gl.viewport(0, 0, width, height);
    }

    public setClipPlanes(near: number, far: number) {
        this.nearClipPlane = near;
        this.farClipPlane = far;
        if (this.currentColorTarget) {
            const width = this.currentColorTarget.width, height = this.currentColorTarget.height;
            mat4.perspective(this.projection, this.fov, width / height, this.nearClipPlane, this.farClipPlane);
        }
    }

    public compileProgram(prog: BaseProgram) {
        return prog.compile(this.gl, this.programCache);
    }

    public useProgram(prog: BaseProgram) {
        const gl = this.gl;
        this.currentProgram = prog;
        gl.useProgram(this.compileProgram(prog));
    }

    public updateModelView(isSkybox: boolean = false, model: mat4 | null = null): mat4 {
        const modelView = this.scratchMatrix;

        if (isSkybox) {
            computeViewMatrixSkybox(modelView, this.camera);
        } else {
            computeViewMatrix(modelView, this.camera);
        }

        if (model) {
            mat4.mul(modelView, modelView, model);
        }

        return modelView;
    }

    public bindModelView(isSkybox: boolean = false, model: mat4 | null = null) {
        // XXX(jstpierre): Remove this junk
        const gl = this.gl;
        const prog = <Program> this.currentProgram;
        const scratch = this.updateModelView(isSkybox, model);
        gl.uniformMatrix4fv(prog.projectionLocation, false, this.projection);
        gl.uniformMatrix4fv(prog.modelViewLocation, false, scratch);
    }

    public useFlags(flags: RenderFlags) {
        const gl = this.gl;
        const resolved = RenderFlags.flatten(flags, this.currentFlags);
        RenderFlags.apply(gl, this.currentFlags, resolved);
        this.currentFlags = resolved;
    }
}
