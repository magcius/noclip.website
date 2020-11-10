
import { GfxSwapChain } from "./gfx/platform/GfxPlatform";
import { assertExists } from "./util";

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
    public xrViewSpace: XRReferenceSpace;
    public xrLocalSpace: XRReferenceSpace;

    public views: XRView[];

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
        const navigator = window.navigator as any;
        const xr = assertExists(navigator.xr);

        this.xrSession = await xr.requestSession('immersive-vr', {
            requiredFeatures: [],
            optionalFeatures: ['viewer', 'local']
        });

        // TODO(jstpierre): I think we should just error here instead?
        if (!this.xrSession)
            return;

        this.xrViewSpace = await this.xrSession.requestReferenceSpace('viewer');
        this.xrLocalSpace = await this.xrSession.requestReferenceSpace('local');

        const glLayer = this.swapChain.createWebXRLayer(this.xrSession);
        this.xrSession.updateRenderState({ baseLayer: glLayer, depthNear: 5, depthFar: 1000000.0 });

        if (this.onstart !== null)
            this.onstart();

        this.xrSession.requestAnimationFrame(this._onRequestAnimationFrame);
    }

    public end() {
        if (this.xrSession)
            this.xrSession.end();
        this.xrSession = null;

        if (this.onend !== null)
            this.onend();
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
