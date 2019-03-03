
import * as UI from './ui';

import Progressable from './Progressable';
import InputManager from './InputManager';
import { CameraController, Camera, CameraControllerClass } from './Camera';
import { TextureHolder } from './TextureHolder';
import { GfxDevice, GfxSwapChain, GfxRenderPass, GfxDebugGroup } from './gfx/platform/GfxPlatform';
import { createSwapChainForWebGL2, gfxDeviceGetImpl, getPlatformTexture } from './gfx/platform/GfxPlatformWebGL2';
import { downloadTextureToCanvas } from './Screenshot';
import { RenderStatistics, RenderStatisticsTracker } from './RenderStatistics';

export interface Texture {
    name: string;
    surfaces: HTMLCanvasElement[];
    extraInfo?: Map<string, string>;
}

export interface ViewerRenderInput {
    camera: Camera;
    time: number;
    viewportWidth: number;
    viewportHeight: number;
}

export interface SceneGfx {
    defaultCameraController?: CameraControllerClass;
    textureHolder?: TextureHolder<any>;
    createPanels?(): UI.Panel[];
    serializeSaveState?(dst: ArrayBuffer, offs: number): number;
    deserializeSaveState?(dst: ArrayBuffer, offs: number, byteLength: number): number;
    onstatechanged?: () => void;
    render(device: GfxDevice, renderInput: ViewerRenderInput): GfxRenderPass;
    destroy(device: GfxDevice): void;
}

export const enum InitErrorCode {
    SUCCESS,
    NO_WEBGL2_GENERIC,
    NO_WEBGL2_SAFARI,
    GARBAGE_WEBGL2_GENERIC,
    GARBAGE_WEBGL2_SWIFTSHADER,
}

export class Viewer {
    public inputManager: InputManager;
    public cameraController: CameraController | null = null;

    public camera = new Camera();
    public fovY: number = Math.PI / 4;
    // Scene time. Can be paused / scaled / rewound / whatever.
    public sceneTime: number = 0;
    // requestAnimationFrame time. Used to calculate dt from the new time.
    public rafTime: number = 0;

    public gfxDevice: GfxDevice;
    public viewerRenderInput: ViewerRenderInput;
    public isSceneTimeRunning = true;
    public renderStatisticsTracker = new RenderStatisticsTracker();

    public scene: SceneGfx | null = null;

    public oncamerachanged: () => void = (() => {});
    public onstatistics: (statistics: RenderStatistics) => void = (() => {});

    constructor(private gfxSwapChain: GfxSwapChain, public canvas: HTMLCanvasElement) {
        this.inputManager = new InputManager(this.canvas);

        // GfxDevice.
        this.gfxDevice = this.gfxSwapChain.getDevice();
        this.viewerRenderInput = {
            camera: this.camera,
            time: this.sceneTime,
            viewportWidth: 0,
            viewportHeight: 0,
        };
    }

    private renderGfxPlatform(): void {
        const camera = this.camera;

        // Hack in projection for now until we have that unfolded from RenderState.
        camera.newFrame();
        camera.setClipPlanes(10, 50000);
        const aspect = this.canvas.width / this.canvas.height;
        camera.setPerspective(this.fovY, aspect, 10, 50000);

        this.viewerRenderInput.time = this.sceneTime;
        this.viewerRenderInput.viewportWidth = this.canvas.width;
        this.viewerRenderInput.viewportHeight = this.canvas.height;
        this.gfxSwapChain.configureSwapChain(this.canvas.width, this.canvas.height);

        // TODO(jstpierre): Move RenderStatisticsTracker outside of RenderSTate
        this.renderStatisticsTracker.beginFrame();

        // TODO(jstpierre): Allocations.
        const debugGroup: GfxDebugGroup = { name: 'Scene Rendering', drawCallCount: 0, bufferUploadCount: 0, textureBindCount: 0, triangleCount: 0 };
        this.gfxDevice.pushDebugGroup(debugGroup);

        const renderPass = this.scene.render(this.gfxDevice, this.viewerRenderInput);
        const onscreenTexture = this.gfxSwapChain.getOnscreenTexture();
        renderPass.endPass(onscreenTexture);
        this.gfxDevice.submitPass(renderPass);
        this.gfxSwapChain.present();

        this.gfxDevice.popDebugGroup();
        this.renderStatisticsTracker.endFrame();

        this.renderStatisticsTracker.applyDebugGroup(debugGroup);
        this.onstatistics(this.renderStatisticsTracker);
    }

    private render(): void {
        if (this.scene) {
            this.renderGfxPlatform();
        } else {
            // TODO(jstpierre): Rewrite in GfxPlatform.
            const gl = gfxDeviceGetImpl(this.gfxDevice).gl;
            // Render black.
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            return;
        }
    }

    public setCameraController(cameraController: CameraController) {
        this.cameraController = cameraController;
        this.cameraController.camera = this.camera;
        this.cameraController.forceUpdate = true;
    }

    private destroyScenes(): void {
        if (this.scene) {
            this.scene.destroy(this.gfxDevice);
            this.scene = null;
        }

        this.cameraController = null;
    }

    public setScene(scene: SceneGfx | null): void {
        this.destroyScenes();
        this.scene = scene;
    }

    public update(nt: number): void {
        const dt = nt - this.rafTime;
        this.rafTime = nt;

        if (this.cameraController) {
            const updated = this.cameraController.update(this.inputManager, dt);
            if (updated)
                this.oncamerachanged();
        }

        // TODO(jstpierre): Move this to main
        this.inputManager.afterFrame();

        if (this.isSceneTimeRunning)
            this.sceneTime += dt;

        this.render();
    }

    public takeScreenshotToCanvas(): HTMLCanvasElement {
        const canvas = document.createElement('canvas');

        // TODO(jstpierre)
        // Reading the resolved color texture gives us fringes, because the standard box filter will
        // add the clear color just like the standard texture sample fringes... in order to get a
        // nice-looking screenshot, we'd need to do a custom resolve of the MSAA render target.

        if (this.scene !== null) {
            // TODO(jstpierre): Implement in Gfx somehow.
            const gl = gfxDeviceGetImpl(this.gfxDevice).gl;
            const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
            downloadTextureToCanvas(gl, getPlatformTexture(this.gfxSwapChain.getOnscreenTexture()), width, height, canvas);
        }

        return canvas;
    }

    public getCurrentTextureHolder(): TextureHolder<any> | null {
        if (this.scene !== null)
            return this.scene.textureHolder;
        return null;
    }
}

export interface SceneDesc {
    id: string;
    name: string;
    createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<SceneGfx> | null;
}

export interface SceneGroup {
    id: string;
    name: string;
    sceneDescs: (string | SceneDesc)[];
    sceneIdMap?: Map<string, string>;
}

export function getSceneDescs(sceneGroup: SceneGroup): SceneDesc[] {
    return sceneGroup.sceneDescs.filter((g) => typeof g !== 'string') as SceneDesc[];
}

interface ViewerOut {
    viewer: Viewer;
}

export function initializeViewer(out: ViewerOut, canvas: HTMLCanvasElement): InitErrorCode {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
    if (!gl) {
        if (navigator.vendor.includes('Apple'))
            return InitErrorCode.NO_WEBGL2_SAFARI;
        else
            return InitErrorCode.NO_WEBGL2_GENERIC;
    }

    // Test for no MS depthbuffer support (as seen in SwiftShader).
    const samplesArray = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES);
    if (samplesArray === null || samplesArray.length === 0) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL).includes('SwiftShader'))
            return InitErrorCode.GARBAGE_WEBGL2_SWIFTSHADER;
        else
            return InitErrorCode.GARBAGE_WEBGL2_GENERIC;
    }

    const gfxSwapChain = createSwapChainForWebGL2(gl);
    out.viewer = new Viewer(gfxSwapChain, canvas);
    return InitErrorCode.SUCCESS;
}

export function makeErrorMessageUI(message: string): DocumentFragment {
    const errorMessage = UI.createDOMFromString(`
<div style="display: flex; background-color: #220000; flex-direction: column; position: absolute; top: 0; bottom: 0; left: 0; right: 0; justify-content: center;">
<div style="display: flex; background-color: #aa2233; justify-content: center; box-shadow: 0 0 32px black;">
<div style="max-width: 1000px; font: 16pt sans-serif; color: white; text-align: justify;">
<style>
a:link, a:visited { color: #ccc; transition: .5s color; }
a:hover { color: #fff; }
</style>
${message}
`);

    return errorMessage;
}

export function makeErrorUI(errorCode: InitErrorCode): DocumentFragment {
    if (errorCode === InitErrorCode.NO_WEBGL2_SAFARI)
        return makeErrorMessageUI(`
<p>This application requires WebGL 2. Unfortunately, that means Safari and iOS are currently not supported. The plan is to support <a href="https://github.com/gpuweb/gpuweb">WebGPU</a> once this arrives.
`);
    else if (errorCode === InitErrorCode.NO_WEBGL2_GENERIC)
        return makeErrorMessageUI(`
<p>Your browser does not appear to have WebGL 2 support.
<p>If <a href="http://webglreport.com/?v=2">WebGL Report</a> says your browser supports WebGL 2, please open a <a href="https://github.com/magcius/noclip.website/issues/new?template=tech_support">GitHub issue</a> with as much as information as possible.
<p style="text-align: right">Thanks, Jasper.
`);
    else if (errorCode === InitErrorCode.GARBAGE_WEBGL2_SWIFTSHADER)
        return makeErrorMessageUI(`
<p>This application requires hardware acceleration to be enabled.
<p>Please enable hardware acceleration in your's browser settings.
<p>If you have enabled hardware acceleration and are still getting this error message, please open a <a href="https://github.com/magcius/noclip.website/issues/new?template=tech_support">GitHub issue</a> with as much as information as possible.
<p style="text-align: right">Thanks, Jasper.
`);
    else if (errorCode === InitErrorCode.GARBAGE_WEBGL2_GENERIC)
        return makeErrorMessageUI(`
<p>This browser has a non-functioning version of WebGL 2 that I have not seen before.
<p>If <a href="http://webglreport.com/?v=2">WebGL Report</a> says your browser supports WebGL 2, please open a <a href="https://github.com/magcius/noclip.website/issues/new?template=tech_support">GitHub issue</a> with as much as information as possible.
<p style="text-align: right">Thanks, Jasper.
`);
    else
        throw "whoops";
}
