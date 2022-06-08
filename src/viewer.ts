
import * as UI from './ui';

import InputManager from './InputManager';
import { SceneDesc, SceneGroup } from "./SceneBase";
import { CameraController, Camera, XRCameraController, CameraUpdateResult } from './Camera';
import { GfxDevice, GfxSwapChain, GfxDebugGroup, GfxTexture, makeTextureDescriptor2D, GfxFormat } from './gfx/platform/GfxPlatform';
import { createSwapChainForWebGL2, gfxDeviceGetImpl_GL, GfxPlatformWebGL2Config } from './gfx/platform/GfxPlatformWebGL2';
import { createSwapChainForWebGPU } from './gfx/platform/GfxPlatformWebGPU';
import { downloadFrontBufferToCanvas } from './Screenshot';
import { RenderStatistics, RenderStatisticsTracker } from './RenderStatistics';
import { AntialiasingMode } from './gfx/helpers/RenderGraphHelpers';
import { WebXRContext } from './WebXR';
import { MathConstants } from './MathHelpers';
import { IS_DEVELOPMENT } from './BuildVersion';
import { GlobalSaveManager } from './SaveManager';
import { mat4 } from 'gl-matrix';

export interface ViewerUpdateInfo {
    time: number;
    webXRContext: WebXRContext | null;
}

export interface Texture {
    name: string;
    surfaces: HTMLCanvasElement[];
    extraInfo?: Map<string, string> | null;
    activate?: () => Promise<void>;
}

interface MouseLocation {
    mouseX: number;
    mouseY: number;
}

export interface DebugConsole {
    addInfoLine(line: string): void;
}

export interface ViewerRenderInput {
    camera: Camera;
    time: number;
    deltaTime: number;
    backbufferWidth: number;
    backbufferHeight: number;
    onscreenTexture: GfxTexture;
    antialiasingMode: AntialiasingMode;
    mouseLocation: MouseLocation;
    debugConsole: DebugConsole;
}

export interface SceneGfx {
    textureHolder?: UI.TextureListHolder;
    createPanels?(): UI.Panel[];
    createCameraController?(): CameraController;
    adjustCameraController?(c: CameraController): void;
    getDefaultWorldMatrix?(dst: mat4): void;
    serializeSaveState?(dst: ArrayBuffer, offs: number): number;
    deserializeSaveState?(src: ArrayBuffer, offs: number, byteLength: number): number;
    onstatechanged?: () => void;
    render(device: GfxDevice, renderInput: ViewerRenderInput): void;
    destroy(device: GfxDevice): void;
}

export type Listener = (viewer: Viewer) => void;

function resetGfxDebugGroup(group: GfxDebugGroup): void {
    group.bufferUploadCount = 0;
    group.drawCallCount = 0;
    group.textureBindCount = 0;
    group.triangleCount = 0;
}

export function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number, devicePixelRatio: number): void {
    const nw = width * devicePixelRatio;
    const nh = height * devicePixelRatio;
    if (canvas.width === nw && canvas.height === nh)
        return;

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = nw;
    canvas.height = nh;
}

export class Viewer {
    public inputManager: InputManager;
    public cameraController: CameraController | null = null;
    public xrCameraController: XRCameraController = new XRCameraController();

    public camera = new Camera();

    static readonly FOV_Y_DEFAULT: number = MathConstants.TAU / 6;
    public fovY: number = Viewer.FOV_Y_DEFAULT;
    // Scene time. Can be paused / scaled / rewound / whatever.
    public sceneTime: number = 0;
    // requestAnimationFrame time. Used to calculate dt from the new time.
    public rafTime: number = 0;
    public sceneTimeScale: number = 1;

    public gfxDevice: GfxDevice;
    public viewerRenderInput: ViewerRenderInput;
    public renderStatisticsTracker = new RenderStatisticsTracker();

    public scene: SceneGfx | null = null;

    public oncamerachanged: (force: boolean) => void = (() => {});
    public onstatistics: (statistics: RenderStatistics) => void = (() => {});

    private keyMoveSpeedListeners: Listener[] = [];
    private debugGroup: GfxDebugGroup = { name: 'Scene Rendering', drawCallCount: 0, bufferUploadCount: 0, textureBindCount: 0, triangleCount: 0 };

    constructor(public gfxSwapChain: GfxSwapChain, public canvas: HTMLCanvasElement) {
        this.inputManager = new InputManager(this.canvas);
        this.rafTime = window.performance.now();

        // GfxDevice.
        this.gfxDevice = this.gfxSwapChain.getDevice();
        this.viewerRenderInput = {
            camera: this.camera,
            time: this.sceneTime,
            deltaTime: 0,
            backbufferWidth: 0,
            backbufferHeight: 0,
            onscreenTexture: null!,
            antialiasingMode: AntialiasingMode.None,
            mouseLocation: this.inputManager,
            debugConsole: this.renderStatisticsTracker,
        };

        GlobalSaveManager.addSettingListener('AntialiasingMode', (saveManager, key) => {
            const antialiasingMode = saveManager.loadSetting<AntialiasingMode>(key, AntialiasingMode.FXAA);
            this.viewerRenderInput.antialiasingMode = antialiasingMode;
        });
    }

    private onKeyMoveSpeed(): void {
        for (let i = 0; i < this.keyMoveSpeedListeners.length; i++)
            this.keyMoveSpeedListeners[i](this);
    }

    public setKeyMoveSpeed(n: number): void {
        if (this.cameraController === null)
            return;
        this.cameraController.setKeyMoveSpeed(n);
        this.onKeyMoveSpeed();
    }

    public addKeyMoveSpeedListener(listener: Listener): void {
        this.keyMoveSpeedListeners.push(listener);
    }

    private renderViewport(): void {
        if (this.scene !== null)
            this.scene.render(this.gfxDevice, this.viewerRenderInput);
    }

    private render(): void {
        this.viewerRenderInput.camera = this.camera;
        this.viewerRenderInput.time = this.sceneTime;
        this.viewerRenderInput.backbufferWidth = this.canvas.width;
        this.viewerRenderInput.backbufferHeight = this.canvas.height;
        this.gfxSwapChain.configureSwapChain(this.canvas.width, this.canvas.height);
        this.viewerRenderInput.onscreenTexture = this.gfxSwapChain.getOnscreenTexture();

        this.gfxDevice.beginFrame();
        this.renderStatisticsTracker.beginFrame();

        resetGfxDebugGroup(this.debugGroup);
        this.gfxDevice.pushDebugGroup(this.debugGroup);

        this.renderViewport();

        this.gfxDevice.popDebugGroup();
        this.gfxDevice.endFrame();

        const renderStatistics = this.renderStatisticsTracker.endFrame();
        this.finishRenderStatistics(renderStatistics, this.debugGroup);
        this.onstatistics(renderStatistics);
    }

    private xrTempRT: GfxTexture | null = null;
    private xrTempWidth: number = -1;
    private xrTempHeight: number = -1;

    private getXRTempRT(width: number, height: number): GfxTexture {
        if (this.xrTempWidth !== width || this.xrTempHeight !== height) {
            if (this.xrTempRT !== null)
                this.gfxDevice.destroyTexture(this.xrTempRT);

            this.xrTempRT = this.gfxDevice.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_RT, width, height, 1));
            this.xrTempWidth = width;
            this.xrTempHeight = height;
        }

        return this.xrTempRT!;
    }

    private renderWebXR(webXRContext: WebXRContext) {
        if (webXRContext.xrSession === null)
            return;

        const baseLayer = webXRContext.xrSession.renderState.baseLayer;
        if (baseLayer === undefined)
            return;

        this.viewerRenderInput.time = this.sceneTime;
        this.gfxSwapChain.configureSwapChain(baseLayer.framebufferWidth, baseLayer.framebufferHeight, baseLayer.framebuffer);
        const swapChainTex = this.gfxSwapChain.getOnscreenTexture();

        this.gfxDevice.beginFrame();
        this.renderStatisticsTracker.beginFrame();

        resetGfxDebugGroup(this.debugGroup);
        this.gfxDevice.pushDebugGroup(this.debugGroup);

        for (let i = 0; i < webXRContext.views.length; i++) {
            this.viewerRenderInput.camera = this.xrCameraController.cameras[i];
            const xrView: XRView = webXRContext.views[i];
            const viewport: XRViewport = baseLayer.getViewport(xrView);
            if (!viewport)
                continue;

            // Render the viewport to our temp RT.
            this.viewerRenderInput.backbufferWidth = viewport.width;
            this.viewerRenderInput.backbufferHeight = viewport.height;
            const tempRT = this.getXRTempRT(viewport.width, viewport.height);
            this.viewerRenderInput.onscreenTexture = tempRT;
            this.renderViewport();

            // Now composite into the backbuffer.
            this.gfxDevice.copySubTexture2D(swapChainTex, viewport.x, viewport.y, tempRT, 0, 0);

            // Reset the delta time so we don't advance time next render.
            this.viewerRenderInput.deltaTime = 0;
        }

        this.gfxDevice.popDebugGroup();
        this.gfxDevice.endFrame();
        const renderStatistics = this.renderStatisticsTracker.endFrame();
        this.finishRenderStatistics(renderStatistics, this.debugGroup);
        this.onstatistics(renderStatistics);
    }

    private finishRenderStatistics(statistics: RenderStatistics, debugGroup: GfxDebugGroup): void {
        if (debugGroup.drawCallCount)
            statistics.lines.push(`Draw Calls: ${debugGroup.drawCallCount}`);
        if (debugGroup.triangleCount)
            statistics.lines.push(`Drawn Triangles: ${debugGroup.triangleCount}`);
        if (debugGroup.textureBindCount)
            statistics.lines.push(`Texture Binds: ${debugGroup.textureBindCount}`);
        if (debugGroup.bufferUploadCount)
            statistics.lines.push(`Buffer Uploads: ${debugGroup.bufferUploadCount}`);

        const worldMatrix = this.camera.worldMatrix;
        const camPositionX = worldMatrix[12].toFixed(2), camPositionY = worldMatrix[13].toFixed(2), camPositionZ = worldMatrix[14].toFixed(2);
        statistics.lines.push(`Camera Position: ${camPositionX} ${camPositionY} ${camPositionZ}`);

        const vendorInfo = this.gfxDevice.queryVendorInfo();
        statistics.lines.push(`Platform: ${vendorInfo.platformString}`);

        if (vendorInfo.platformString === 'WebGL2') {
            const impl = gfxDeviceGetImpl_GL(this.gfxDevice);
            const w = impl.gl.drawingBufferWidth, h = impl.gl.drawingBufferHeight;
            statistics.lines.push(`Drawing Buffer Size: ${w}x${h}`);
        }
    }

    public setCameraController(cameraController: CameraController) {
        this.cameraController = cameraController;

        if (this.scene !== null && this.scene.adjustCameraController !== undefined)
            this.scene.adjustCameraController(cameraController);

        this.cameraController.camera = this.camera;
        this.cameraController.forceUpdate = true;
    }

    public setScene(scene: SceneGfx | null): void {
        this.scene = scene;
        this.cameraController = null;
    }

    public update(updateInfo: ViewerUpdateInfo): void {
        const dt = updateInfo.time - this.rafTime;
        this.updateDT(dt, updateInfo);
    }

    public updateDT(dt: number, updateInfo: ViewerUpdateInfo): void {
        if (dt < 0)
            return;
        this.rafTime += dt;

        const camera = this.camera;

        camera.clipSpaceNearZ = this.gfxDevice.queryVendorInfo().clipSpaceNearZ;

        camera.newFrame();
        const aspect = this.canvas.width / this.canvas.height;
        camera.fovY = this.fovY;
        camera.aspect = aspect;
        camera.setClipPlanes(5);

        if (this.cameraController) {
            const result = this.cameraController.update(this.inputManager, dt, this.sceneTimeScale);
            if (result !== CameraUpdateResult.Unchanged)
                this.oncamerachanged(result === CameraUpdateResult.ImportantChange);
        }

        const deltaTime = dt * this.sceneTimeScale;
        this.viewerRenderInput.deltaTime += deltaTime;
        this.sceneTime += deltaTime;

        if (updateInfo.webXRContext !== null && updateInfo.webXRContext.views && updateInfo.webXRContext.xrSession) {
            this.xrCameraController.update(updateInfo.webXRContext);
            this.renderWebXR(updateInfo.webXRContext);
        } else {
            this.render();
        }

        // TODO(jstpierre): Move this to main
        this.inputManager.afterFrame();

        // Reset the delta for next frame.
        this.viewerRenderInput.deltaTime = 0;
    }

    public takeScreenshotToCanvas(opaque: boolean): HTMLCanvasElement {
        const canvas = document.createElement('canvas');

        // TODO(jstpierre)
        // Reading the resolved color texture gives us fringes, because the standard box filter will
        // add the clear color just like the standard texture sample fringes... in order to get a
        // nice-looking screenshot, we'd need to do a custom resolve of the MSAA render target.

        if (this.scene !== null) {
            // TODO(jstpierre): Implement in Gfx somehow.
            const gl = gfxDeviceGetImpl_GL(this.gfxDevice).gl;
            const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
            downloadFrontBufferToCanvas(gl, width, height, canvas, opaque);
        }

        return canvas;
    }
}

export type { SceneDesc, SceneGroup };

interface ViewerOut {
    viewer: Viewer;
}

export const enum InitErrorCode {
    SUCCESS,
    NO_WEBGL2_GENERIC,
    NO_WEBGL2_SAFARI,
    GARBAGE_WEBGL2_GENERIC,
    GARBAGE_WEBGL2_SWIFTSHADER,
    MISSING_MISC_WEB_APIS,
}

async function initializeViewerWebGL2(out: ViewerOut, canvas: HTMLCanvasElement): Promise<InitErrorCode> {
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false });
    // For debugging purposes, add a hook for this.
    (window as any).gl = gl;
    if (!gl) {
        if (navigator.vendor.includes('Apple'))
            return InitErrorCode.NO_WEBGL2_SAFARI;
        else
            return InitErrorCode.NO_WEBGL2_GENERIC;
    }

    // SwiftShader is slow, and gives a poor experience.
    const WEBGL_debug_renderer_info = gl.getExtension('WEBGL_debug_renderer_info');
    if (WEBGL_debug_renderer_info && gl.getParameter(WEBGL_debug_renderer_info.UNMASKED_RENDERER_WEBGL).includes('SwiftShader'))
        return InitErrorCode.GARBAGE_WEBGL2_SWIFTSHADER;

    const config = new GfxPlatformWebGL2Config();
    config.trackResources = IS_DEVELOPMENT;
    config.shaderDebug = IS_DEVELOPMENT;

    const gfxSwapChain = createSwapChainForWebGL2(gl, config);
    out.viewer = new Viewer(gfxSwapChain, canvas);

    return InitErrorCode.SUCCESS;
}

async function initializeViewerWebGPU(out: ViewerOut, canvas: HTMLCanvasElement): Promise<InitErrorCode> {
    const gfxSwapChain = await createSwapChainForWebGPU(canvas);
    if (gfxSwapChain === null)
        return InitErrorCode.MISSING_MISC_WEB_APIS;

    out.viewer = new Viewer(gfxSwapChain, canvas);
    return InitErrorCode.SUCCESS;
}

export async function initializeViewer(out: ViewerOut, canvas: HTMLCanvasElement): Promise<InitErrorCode> {
    const useWebGPU = window.localStorage.getItem('webgpu');
    if (useWebGPU)
        return initializeViewerWebGPU(out, canvas);
    else
        return initializeViewerWebGL2(out, canvas);
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
<p>If <a href="http://webglreport.com/?v=2">WebGL Report</a> says your browser supports WebGL 2, please open a <a href="https://github.com/magcius/noclip.website/issues/new?template=tech_support.md">GitHub issue</a> with as much as information as possible.
<p style="text-align: right">Thanks, Jasper.
`);
    else if (errorCode === InitErrorCode.GARBAGE_WEBGL2_SWIFTSHADER)
        return makeErrorMessageUI(`
<p>This application requires hardware acceleration to be enabled.
<p>Please enable hardware acceleration in your's browser settings.
<p>If you have enabled hardware acceleration and are still getting this error message, try restarting your browser and computer.
<p style="text-align: right">Thanks, Jasper.
`);
    else if (errorCode === InitErrorCode.GARBAGE_WEBGL2_GENERIC)
        return makeErrorMessageUI(`
<p>This browser has a non-functioning version of WebGL 2 that I have not seen before.
<p>If <a href="http://webglreport.com/?v=2">WebGL Report</a> says your browser supports WebGL 2, please open a <a href="https://github.com/magcius/noclip.website/issues/new?template=tech_support.md">GitHub issue</a> with as much as information as possible.
<p style="text-align: right">Thanks, Jasper.
`);
    else if (errorCode === InitErrorCode.MISSING_MISC_WEB_APIS)
        return makeErrorMessageUI(`
<p>Your browser is too old and is missing support for web APIs that I rely on.
<p>Please try to update your browser to a more recent version.
`);
    else
        throw "whoops";
}
