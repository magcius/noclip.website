
import { GfxSwapChain } from "./gfx/platform/GfxPlatform.js";
import { mat4, vec3 } from "gl-matrix";

// TODO WebXR: Known issues
    // Should have the option to not render to the main view if in WebXR. This can be a simple check box
    // Typescript complains about missing types on compile
    // Sprites and billboards assume axis aligned view, so will rotate with your head. (e.g trees in Mario 64 DS)
    // View based effects like lens flare should be based on view space, as one lens may be affected by lens flare and one might not be, based on positional differences (e.g. Wind Waker lens flare, wind waker stars)
    // Large scale is jittery (floating point precision issues?)
    // WebXR should use its own buffer
    // Reprojection and motion vector frame interpolation is distorted due to not submitting depth
    // Objects clipped in middle of view (e.g. wind waker actors)
    // Time does not pass if the original tab is unfocused, resulting in frozen animations
    // Render state of main view should be based on the session visibility state
    // Rapidly toggling XR will cause the UI / main renderer to get into a bad state
    // Billboard backgrounds do not render correctly (e.g. paper mario skyboxes)
        // Probably due to backbuffer width / height now encompassing two views, so the aspect is incorrectly calculated
        // These calculations need to take into account the current viewport size
    // Scaling up and going close causes cross eye. Probably need to move the near plane out

export class WebXRContext {
    public xrSession: XRSession | null = null;
    public xrViewerSpace: XRReferenceSpace;
    public xrLocalSpace: XRReferenceSpace;

    public views: readonly XRView[];

    public onframe: ((time: number) => void) | null = null;
    public onsupportedchanged: (() => void) | null = null;
    public onstart: (() => void) | null = null;
    public onend: (() => void) | null = null;

    public currentFrame: XRFrame;

    public isSupported = false;

    constructor(private swapChain: GfxSwapChain) {
        this.checkIsSupported();
    }

    private async checkIsSupported() {
        const navigator = window.navigator as any;
        if (navigator.xr === undefined)
            return;
        const isSupported = await navigator.xr.isSessionSupported('immersive-vr');
        if (this.isSupported !== isSupported) {
            this.isSupported = isSupported;
            if (this.onsupportedchanged !== null)
                this.onsupportedchanged();
        }
    }

    public async start() {
        const xr = window.navigator.xr!;

        this.xrSession = await xr.requestSession('immersive-vr', {
            requiredFeatures: [],
            optionalFeatures: ['viewer', 'local'],
        });

        this.xrSession.onend = () => { this.sessionEnded(); };
        [this.xrViewerSpace, this.xrLocalSpace] = await Promise.all([
            this.xrSession.requestReferenceSpace('viewer'),
            this.xrSession.requestReferenceSpace('local'),
        ]);

        const layer = await this.swapChain.createWebXRLayer(this.xrSession);
        this.xrSession.updateRenderState({ baseLayer: layer, depthNear: 5, depthFar: 1000000.0 });

        if (this.onstart !== null)
            this.onstart();

        this.xrSession.requestAnimationFrame(this._onRequestAnimationFrame);
    }

    private sessionEnded(): void {
        this.xrSession = null;

        if (this.onend !== null)
            this.onend();
    }

    public end() {
        if (this.xrSession !== null)
            this.xrSession.end();
    }

    private _onRequestAnimationFrame = (time: number, frame: XRFrame): void => {
        const session = frame.session;
        const pose = frame.getViewerPose(this.xrLocalSpace);

        this.currentFrame = frame;

        if (pose)
            this.views = pose.views;

        if (this.onframe !== null)
            this.onframe(time);

        session.requestAnimationFrame(this._onRequestAnimationFrame);
    }
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();

/* An analog for [InputManager], but for WebXR sessions. */
export class WebXRInputManager {
    private keyMovement: vec3 = vec3.create();
    private previousFrameSelectPose: XRPose | null = null

    public afterFrame(webXRContext: WebXRContext) {
        this.handleInputSources(webXRContext);
    }

    /* Calculate [getTranslationDelta()] based on the available inputSources in the WebXR session. */
    private handleInputSources(webXRContext: WebXRContext) {
        const xrSession = webXRContext.xrSession;
        if (!xrSession) return;
        vec3.zero(this.keyMovement)

        let inputHandled = false;
        const inputSources = xrSession.inputSources;
        for (const inputSource of inputSources) {
            const gamepad = inputSource.gamepad;
            if (!gamepad) continue;

            if (inputSource.profiles.includes("generic-hand-select")) {
                // https://github.com/immersive-web/webxr-input-profiles/blob/main/packages/registry/profiles/generic/generic-hand-select.json
                if (gamepad.buttons[0].pressed) {
                    this.handle6DofDrag(webXRContext, inputSource)
                    inputHandled = true;
                }
            } else if (inputSource.profiles.includes("generic-trigger-squeeze-thumbstick")) {
                // https://github.com/immersive-web/webxr-input-profiles/blob/main/packages/registry/profiles/generic/generic-trigger-squeeze-thumbstick.json
                this.handleGenericController(gamepad);
                inputHandled = true;
            }
        }
        if (!inputHandled) {
            this.previousFrameSelectPose = null;
        }
    }

    private handle6DofDrag(webXRContext: WebXRContext, inputSource: XRInputSource) {
        const ray = inputSource.targetRaySpace;
        const rayPose = webXRContext.currentFrame.getPose(ray, webXRContext.xrLocalSpace) || null;
        if (!rayPose) return;

        // calculate delta
        if (this.previousFrameSelectPose) {
            const currentTransform = scratchVec3a;
            mat4.getTranslation(currentTransform, rayPose.transform.matrix);

            const lastDragTransform = scratchVec3b;
            mat4.getTranslation(lastDragTransform, this.previousFrameSelectPose.transform.matrix)
            vec3.sub(this.keyMovement, lastDragTransform, currentTransform);
            // this factor attempts to mimic the amount of movement you'll get off a similar feeling axis movement with a gamepad
            vec3.scale(this.keyMovement, this.keyMovement, 30);
        }

        this.previousFrameSelectPose = rayPose;
    }

    private handleGenericController(gamepad: Gamepad) {
        // https://github.com/immersive-web/webxr-input-profiles/blob/main/packages/registry/profiles/generic/generic-trigger-squeeze-thumbstick.json
        this.keyMovement[0] = gamepad.axes[2];
        this.keyMovement[1] = gamepad.buttons[0].value - gamepad.buttons[1].value;
        this.keyMovement[2] = gamepad.axes[3];
    }

    /* Returns the calculated delta of translation since the last time [handleInputSources] was called. */
    public getTranslationDelta(): vec3 {
        return this.keyMovement;
    }
}