
import { RenderState, ColorTarget, DepthTarget, RenderStatistics } from './render';
import * as UI from './ui';

import Progressable from './Progressable';
import InputManager from './InputManager';
import { CameraController, Camera, CameraControllerClass } from './Camera';
import { TextureHolder } from './TextureHolder';
import { GfxDevice, GfxSwapChain, GfxRenderPass, GfxDebugGroup } from './gfx/platform/GfxPlatform';
import { createSwapChainForWebGL2, gfxDeviceGetImpl } from './gfx/platform/GfxPlatformWebGL2';
import { downloadTextureToCanvas } from './Screenshot';

export interface Texture {
    name: string;
    surfaces: HTMLCanvasElement[];
    extraInfo?: Map<string, string>;
}

export interface Scene {
    render(state: RenderState): void;
    destroy(gl: WebGL2RenderingContext): void;
}

export interface MainScene extends Scene {
    textures?: Texture[];
    textureHolder?: TextureHolder<any>;
    resetCamera?(camera: Camera): void;
    createPanels?(): UI.Panel[];
}

export interface ViewerRenderInput {
    camera: Camera;
    time: number;
    viewportWidth: number;
    viewportHeight: number;
}

export interface Scene_Device {
    render(device: GfxDevice, renderInput: ViewerRenderInput): GfxRenderPass;
    destroy(device: GfxDevice): void;
    createPanels?(): UI.Panel[];
    textureHolder?: TextureHolder<any>;
}

export class Viewer {
    public inputManager: InputManager;
    public cameraController: CameraController;

    // GL method.
    public renderState: RenderState;
    private onscreenColorTarget: ColorTarget = new ColorTarget();
    private onscreenDepthTarget: DepthTarget = new DepthTarget();

    // GfxPlatform method.
    public gfxDevice: GfxDevice;
    private gfxSwapChain: GfxSwapChain;
    private viewerRenderInput: ViewerRenderInput;
    private t: number = 0;

    public scene: MainScene;
    public scene_device: Scene_Device;

    public oncamerachanged: () => void = (() => {});
    public onstatistics: (statistics: RenderStatistics) => void = (() => {});

    public static make(canvas: HTMLCanvasElement): Viewer | null {
        const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
        if (!gl)
            return null;
        return new Viewer(gl, canvas);
    }

    private constructor(gl: WebGL2RenderingContext, public canvas: HTMLCanvasElement) {
        this.inputManager = new InputManager(this.canvas);
        this.cameraController = null;

        // GL
        this.renderState = new RenderState(gl);

        // GfxDevice.
        this.gfxSwapChain = createSwapChainForWebGL2(gl);
        this.gfxDevice = this.gfxSwapChain.getDevice();
        this.viewerRenderInput = {
            camera: this.renderState.camera,
            time: 0,
            viewportWidth: 0,
            viewportHeight: 0,
        }
    }

    public reset() {
        const gl = this.renderState.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.clearColor(0.88, 0.88, 0.88, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    private renderGL() {
        const gl = this.renderState.gl;

        this.renderState.renderStatisticsTracker.beginFrame();

        this.onscreenColorTarget.setParameters(gl, this.canvas.width, this.canvas.height);
        this.onscreenDepthTarget.setParameters(gl, this.canvas.width, this.canvas.height);
        this.renderState.setOnscreenRenderTarget(this.onscreenColorTarget, this.onscreenDepthTarget);
        this.renderState.reset();
        this.renderState.setClipPlanes(10, 50000);

        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Main scene. This renders to the onscreen target.
        this.scene.render(this.renderState);

        // Blit to the screen.
        this.renderState.blitOnscreenToGL();

        this.renderState.renderStatisticsTracker.endFrame();
        this.onstatistics(this.renderState.renderStatisticsTracker);
    }

    private renderGfxPlatform(): void {
        // Hack in projection for now until we have that unfolded from RenderState.
        this.viewerRenderInput.camera.newFrame();
        const aspect = this.canvas.width / this.canvas.height;
        this.viewerRenderInput.camera.setPerspective(this.renderState.fov, aspect, 10, 50000);

        this.viewerRenderInput.time = this.renderState.time;
        this.viewerRenderInput.viewportWidth = this.canvas.width;
        this.viewerRenderInput.viewportHeight = this.canvas.height;
        this.gfxSwapChain.configureSwapChain(this.canvas.width, this.canvas.height);

        // TODO(jstpierre): Move RenderStatisticsTracker outside of RenderSTate
        this.renderState.renderStatisticsTracker.beginFrame();

        // TODO(jstpierre): Allocations.
        const debugGroup: GfxDebugGroup = { name: 'Scene Rendering', drawCallCount: 0, bufferUploadCount: 0, textureBindCount: 0 };
        this.gfxDevice.pushDebugGroup(debugGroup);

        const renderPass = this.scene_device.render(this.gfxDevice, this.viewerRenderInput);
        const onscreenTexture = this.gfxSwapChain.getOnscreenTexture();
        renderPass.endPass(onscreenTexture);
        this.gfxDevice.submitPass(renderPass);
        this.gfxSwapChain.present();

        this.gfxDevice.popDebugGroup();
        this.renderState.renderStatisticsTracker.endFrame();

        this.renderState.renderStatisticsTracker.applyDebugGroup(debugGroup);
        this.onstatistics(this.renderState.renderStatisticsTracker);
    }

    private render(): void {
        if (this.scene) {
            this.renderGL();
        } else if (this.scene_device) {
            this.renderGfxPlatform();
        } else {
            const gl = this.renderState.gl;
            // Render black.
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            return;
        }
    }

    public setCameraController(cameraController: CameraController) {
        this.cameraController = cameraController;
        this.cameraController.camera = this.renderState.camera;
        this.cameraController.forceUpdate = true;
    }

    private destroyScenes(): void {
        if (this.scene) {
            this.scene.destroy(this.renderState.gl);
            this.scene = null;
        }

        if (this.scene_device) {
            this.scene_device.destroy(this.gfxDevice);
            this.scene_device = null;
        }
    }

    public setScene(scene: MainScene): void {
        this.reset();
        this.destroyScenes();
        this.scene = scene;
    }

    public setSceneDevice(scene_device: Scene_Device): void {
        this.reset();
        this.destroyScenes();
        this.scene_device = scene_device;
    }

    public update(nt: number): void {
        const dt = nt - this.t;
        this.t = nt;

        if (this.cameraController) {
            const updated = this.cameraController.update(this.inputManager, dt);
            if (updated)
                this.oncamerachanged();
        }

        // TODO(jstpierre): Move this to main
        this.inputManager.afterFrame();

        this.renderState.time += dt;
        this.render();
    }

    public takeScreenshotToCanvas(): HTMLCanvasElement {
        const canvas = document.createElement('canvas');

        // TODO(jstpierre)
        // Reading the resolved color texture gives us fringes, because the standard box filter will
        // add the clear color just like the standard texture sample fringes... in order to get a
        // nice-looking screenshot, we'd need to do a custom resolve of the MSAA render target.

        if (this.scene !== null) {
            // RenderState GL.
            const gl = this.renderState.gl;
            const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
            const texture = this.renderState.onscreenColorTarget.resolvedColorTexture;
            downloadTextureToCanvas(gl, texture, width, height, canvas);
        } else if (this.scene_device !== null) {
            const gl = gfxDeviceGetImpl(this.gfxDevice).gl;
            const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
            downloadTextureToCanvas(gl, this.gfxSwapChain.getOnscreenTexture(), width, height, canvas);
        }

        return canvas;
    }

    public getCurrentTextureHolder(): TextureHolder<any> | null {
        if (this.scene_device !== null)
            return this.scene_device.textureHolder;
        if (this.scene !== null)
            return this.scene.textureHolder;
        return null;
    }
}

export interface SceneDesc {
    id: string;
    name: string;
    createScene?(gl: WebGL2RenderingContext): Progressable<MainScene> | null;
    createScene_Device?(device: GfxDevice): Progressable<Scene_Device> | null;
    defaultCameraController?: CameraControllerClass;
}

export interface SceneGroup {
    id: string;
    name: string;
    sceneDescs: SceneDesc[];
}
