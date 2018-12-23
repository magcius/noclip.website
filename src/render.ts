
// Old GL render infrastructure.

import { mat4 } from 'gl-matrix';
import { assert, assertExists } from './util';
import { BaseProgram, FullscreenProgram, ProgramCache, SimpleProgram } from './Program';
import { Camera, computeViewMatrix, computeViewMatrixSkybox } from './Camera';
import { createTransitionDeviceForWebGL2, applyMegaState } from './gfx/platform/GfxPlatformWebGL2';
import { GfxCompareMode, GfxMegaStateDescriptor, GfxDebugGroup } from './gfx/platform/GfxPlatform';
import { defaultFlags, RenderFlags } from './gfx/helpers/RenderFlagsHelpers';

export { RenderFlags };

export class FullscreenCopyProgram extends FullscreenProgram {
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

function getNumSamplesForFormat(gl: WebGL2RenderingContext, format: GLenum, preferredSamples: number): number {
    const possibleSamples: number[] = gl.getInternalformatParameter(gl.RENDERBUFFER, format, gl.SAMPLES);
    const samples = possibleSamples.find((n) => n <= preferredSamples);
    if (samples === undefined)
        return 0;
    return samples;
}

function getNumSamples(gl: WebGL2RenderingContext, preferredSamples: number): number {
    // We check depth format of this because on some GPUs (*cough* Haswell) there's no multisampling support for
    // depth buffer, but there is for color format. We could check RGBA8, but I don't think it's likely that we'll
    // see higher sample counts for depth over color.
    return getNumSamplesForFormat(gl, gl.DEPTH24_STENCIL8, preferredSamples);
}

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
        samples = getNumSamples(gl, samples);

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
        samples = getNumSamples(gl, samples);

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

export const depthClearFlags = new RenderFlags();
depthClearFlags.depthWrite = true;

export interface RenderStatistics {
    frameStartCPUTime: number;
    drawCallCount: number;
    textureBindCount: number;
    bufferUploadCount: number;
    frameCPUTime: number;
    fps: number;
}

class RenderStatisticsTracker {
    public drawCallCount: number = 0;
    public textureBindCount: number = 0;
    public bufferUploadCount: number = 0;
    public frameStartCPUTime: number = 0;
    public frameCPUTime: number = 0;
    public fps: number = 0;

    public beginFrame(): void {
        this.frameStartCPUTime = window.performance.now();
        this.drawCallCount = 0;
        this.textureBindCount = 0;
        this.bufferUploadCount = 0;
        this.frameCPUTime = 0;
        this.fps = 0;
    }

    public endFrame(): RenderStatistics {
        this.frameCPUTime = window.performance.now() - this.frameStartCPUTime;
        this.fps = 1000 / this.frameCPUTime;
        return this;
    }

    public applyDebugGroup(debugGroup: GfxDebugGroup): void {
        this.drawCallCount += debugGroup.drawCallCount;
        this.textureBindCount += debugGroup.textureBindCount;
        this.bufferUploadCount += debugGroup.bufferUploadCount;
    }
}

export const fullscreenFlags = new RenderFlags();
fullscreenFlags.set({ depthCompare: GfxCompareMode.ALWAYS, depthWrite: false });

// The legacy render system. Mostly replaced by Gfx.
// TODO(jstpierre): Remove.
export class RenderState {
    public programCache: ProgramCache;

    // State.
    public currentProgram: BaseProgram | null = null;
    private currentMegaState: GfxMegaStateDescriptor = new RenderFlags(defaultFlags).resolveMegaState();

    private currentColorTarget: ColorTarget | null = null;
    private currentDepthTarget: DepthTarget | null = null;

    // Parameters.
    public time: number;
    public camera: Camera;

    // TODO(jstpierre): Move to Camera? Some are game-specific though...
    public fov: number;
    public nearClipPlane: number;
    public farClipPlane: number;

    public onscreenColorTarget: ColorTarget;
    public onscreenDepthTarget: DepthTarget;

    public renderStatisticsTracker = new RenderStatisticsTracker();
    public forceDisableCulling: boolean = false;

    private fullscreenCopyProgram: FullscreenCopyProgram;
    private msaaFramebuffer: WebGLFramebuffer;
    private scratchMatrix = mat4.create();

    constructor(public gl: WebGL2RenderingContext) {
        this.currentMegaState.depthCompare = GfxCompareMode.ALWAYS;

        this.programCache = new ProgramCache(this.gl);

        // Create the program cache immediately.
        createTransitionDeviceForWebGL2(this.gl, this);

        this.time = 0;
        this.fov = Math.PI / 4;

        this.camera = new Camera();

        this.fullscreenCopyProgram = new FullscreenCopyProgram();

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
        this.useRenderTarget(this.onscreenColorTarget, this.onscreenDepthTarget);
        this.useFlags(defaultFlags);
        this.camera.newFrame();
    }

    // XXX(jstpierre): Design a better API than this.
    public runFullscreen(flags: RenderFlags | null = null): void {
        const gl = this.gl;
        this.useFlags(flags !== null ? flags : fullscreenFlags);
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

    public getAspect(): number {
        const width = this.currentColorTarget.width, height = this.currentColorTarget.height;
        return width / height;
    }

    public updateProjection(): void {
        this.camera.setPerspective(this.fov, this.getAspect(), this.nearClipPlane, this.farClipPlane);
    }

    public bindViewport(): void {
        this.updateProjection();
        const gl = this.gl;
        const width = this.currentColorTarget.width, height = this.currentColorTarget.height;
        gl.viewport(0, 0, width, height);
    }

    public setClipPlanes(near: number, far: number) {
        this.nearClipPlane = near;
        this.farClipPlane = far;
        if (this.currentColorTarget) {
            this.updateProjection();
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
        const prog = this.currentProgram as SimpleProgram;
        const scratch = this.updateModelView(isSkybox, model);
        gl.uniformMatrix4fv(prog.projectionLocation, false, this.camera.projectionMatrix);
        gl.uniformMatrix4fv(prog.modelViewLocation, false, scratch);
    }

    public useFlags(flags: RenderFlags) {
        const gl = this.gl;
        applyMegaState(gl, this.currentMegaState, flags.resolveMegaState());
    }
}
