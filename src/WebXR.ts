export function IsWebXRSupported() {
    return !!window.navigator.xr && navigator.xr.isSessionSupported('immersive-vr');
}

// TODO WebXR: Known issues
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
    public xrSession: XrSession;
    public xrViewSpace: XrReferenceSpace;
    public xrLocalSpace: XrReferenceSpace;

    public views: XrView[];

    public onSessionStarted: ()=>void = ()=>{};
    public onFrame: (time: number)=>void = ()=>{};

    public currentFrame: XrFrame;

    constructor(private renderingContext: WebGLRenderingContext) {}

    public async start() {
        this.xrSession = await navigator.xr.requestSession('immersive-vr', {
            requiredFeatures: [],
            optionalFeatures: ['viewer', 'local']
        });

        this.xrViewSpace = await this.xrSession.requestReferenceSpace('viewer');
        this.xrLocalSpace = await this.xrSession.requestReferenceSpace('local');

        let glLayer = new XRWebGLLayer(this.xrSession, this.renderingContext);
        this.xrSession.updateRenderState({ baseLayer: glLayer, depthNear: 5, depthFar: 1000000.0 });

        this.onSessionStarted();
        this.xrSession.requestAnimationFrame(this.onXRFrame.bind(this));
    }

    public end() {
        if (this.xrSession) {
            this.xrSession.end();
        }
        this.xrSession = null;
    }

    private onXRFrame(time: number, frame: XrFrame) {
        let session = frame.session;
        let pose = frame.getViewerPose(this.xrLocalSpace);

        this.currentFrame = frame;

        if (pose) {
            this.views = pose.views;
        }

        this.onFrame(time);

        session.requestAnimationFrame(this.onXRFrame.bind(this));
    }
}