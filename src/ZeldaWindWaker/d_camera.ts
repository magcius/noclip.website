import { mat4, vec3, vec4 } from "gl-matrix";
import { dProcName_e } from "./d_procname.js";
import { cPhs__Status, fopDwTg_ToDrawQ, leafdraw_class } from "./framework.js";
import { GfxClipSpaceNearZ, GfxRenderPass } from "../gfx/platform/GfxPlatform.js";
import { Frustum } from "../Geometry.js";
import { clamp, getMatrixAxisZ, getMatrixTranslation, lerp, MathConstants, projectionMatrixForFrustum } from "../MathHelpers.js";
import { Camera } from "../Camera.js";
import { dGlobals } from "./Main.js";
import { EDemoCamFlags } from "./d_demo.js";
import { projectionMatrixReverseDepth } from "../gfx/helpers/ReversedDepthHelpers.js";
import { projectionMatrixConvertClipSpaceNearZ } from "../gfx/helpers/ProjectionHelpers.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { calcLODBias, fillSceneParamsData, SceneParams, ub_SceneParamsBufferSize } from "../gx/gx_render.js";
import { GX_Program } from "../gx/gx_material.js";
import { ViewerRenderInput } from "../viewer.js";

const scratchVec3a = vec3.create();
const sceneParams = new SceneParams();

const enum CameraMode {
    Default,
    Cinematic
}

export class dCamera_c extends leafdraw_class {
    public static PROCESS_NAME = dProcName_e.d_camera;

    public viewFromWorldMatrix = mat4.create(); // aka viewMatrix
    public worldFromViewMatrix = mat4.create(); // aka worldMatrix
    public clipFromWorldMatrix = mat4.create();
    public clipFromViewMatrix = mat4.create(); // aka projectionMatrix

    public clipSpaceNearZ: GfxClipSpaceNearZ;

    // Frustum is stored in Wind Waker engine world space.
    public frustum = new Frustum();
    public aspect = 1.0;
    public fovY = 0.0;
    public near = 0.0;
    public far = 0.0;

    // The current camera position, in Wind Waker engine world space.
    public cameraPos = vec3.create();
    public cameraFwd = vec3.create();
    public cameraTarget = vec3.create();
    public cameraUp = vec3.fromValues(0, 1, 0);
    public roll = 0.0;

    // For people to play around with.
    public frozen = false;
    public enableLetterboxing = true;

    private cameraMode: CameraMode = CameraMode.Default;
    private cameraModeBlendVal = 0;
    private demoFov = 0;
    private demoRoll = 0;
    private trimHeight = 0;
    private scissor = vec4.create();

    private static trimHeightCinematic = 65.0;

    public finishSetup(): void {
        mat4.invert(this.viewFromWorldMatrix, this.worldFromViewMatrix);
        mat4.mul(this.clipFromWorldMatrix, this.clipFromViewMatrix, this.viewFromWorldMatrix);
        getMatrixTranslation(this.cameraPos, this.worldFromViewMatrix);
        getMatrixAxisZ(this.cameraFwd, this.worldFromViewMatrix);
        vec3.negate(this.cameraFwd, this.cameraFwd);
        this.frustum.updateClipFrustum(this.clipFromWorldMatrix, this.clipSpaceNearZ);
    }

    public setupFromCamera(camera: Camera): void {
        this.clipSpaceNearZ = camera.clipSpaceNearZ;
        this.aspect = camera.aspect;
        this.fovY = camera.fovY;
        this.roll = 0;

        getMatrixTranslation(this.cameraPos, camera.worldMatrix);
        getMatrixAxisZ(this.cameraFwd, camera.worldMatrix);
        vec3.negate(this.cameraFwd, this.cameraFwd);
        this.cameraTarget = vec3.scaleAndAdd(scratchVec3a, this.cameraPos, this.cameraFwd, 1000);

        mat4.copy(this.worldFromViewMatrix, camera.worldMatrix);
        mat4.copy(this.clipFromViewMatrix, camera.projectionMatrix);
        this.finishSetup();
    }

    public snapToCinematic(): void {
        this.cameraMode = CameraMode.Cinematic;
        this.cameraModeBlendVal = 1.0;
    }

    public override load(globals: dGlobals, userData: any): cPhs__Status {
        globals.camera = this;
        fopDwTg_ToDrawQ(globals.frameworkGlobals, this, this.drawPriority);
        return cPhs__Status.Next;
    }

    // Executes after the demo manager and other systems that can modify the camera 
    public override execute(globals: dGlobals, deltaTimeFrames: number): void {
        this.setupFromCamera(globals.sceneContext.viewerInput.camera);

        // Near/far planes are decided by the stage data.
        const stag = globals.dStage_dt.stag;

        // Pull in the near plane to decrease Z-fighting, some stages set it far too close...
        this.near = Math.max(stag.nearPlane, 5);
        this.far = stag.farPlane;

        // noclip modification: if this is the sea map, push our far plane out a bit.
        if (globals.stageName === 'sea')
            this.far *= 2;

        // noclip modification: if we're paused, allow noclip camera control during demos
        const isPaused = globals.sceneContext.viewerInput.deltaTime === 0;

        // dCamera_c::Store() sets the camera params if the demo camera is active
        const demoCam = globals.scnPlay.demo.getSystem().getCamera();
        if (demoCam && !isPaused) {
            if (demoCam.flags & EDemoCamFlags.HasTargetPos) { vec3.copy(this.cameraTarget, demoCam.targetPosition); }
            if (demoCam.flags & EDemoCamFlags.HasEyePos) { vec3.copy(this.cameraPos, demoCam.viewPosition); }
            if (demoCam.flags & EDemoCamFlags.HasUpVec) { vec3.copy(this.cameraUp, demoCam.upVector); }
            if (demoCam.flags & EDemoCamFlags.HasFovY) { this.demoFov = demoCam.fovY * MathConstants.DEG_TO_RAD; }
            if (demoCam.flags & EDemoCamFlags.HasRoll) { this.demoRoll = demoCam.roll; }
            if (demoCam.flags & EDemoCamFlags.HasAspect) { debugger; /* Untested. Remove once confirmed working */ }
            if (demoCam.flags & EDemoCamFlags.HasNearZ) { this.near = demoCam.projNear; }
            if (demoCam.flags & EDemoCamFlags.HasFarZ) { this.far = demoCam.projFar; }

            this.cameraMode = CameraMode.Cinematic;
            globals.sceneContext.inputManager.isMouseEnabled = false;
        } else {
            this.cameraMode = CameraMode.Default;
            globals.sceneContext.inputManager.isMouseEnabled = true;
        }

        // Adapted from dCamera_c::CalcTrimSize()
        // When switching between Cinematic and Regular camera modes (e.g. when pausing a cutscene), 
        // blend the camera parameters smoothly. This accounts for deltaTime, but still works when paused. 
        deltaTimeFrames = clamp(deltaTimeFrames, 0.5, 1);
        this.cameraModeBlendVal += (this.cameraMode - this.cameraModeBlendVal) * 0.25 * deltaTimeFrames;
        this.trimHeight = lerp(0, dCamera_c.trimHeightCinematic, this.cameraModeBlendVal);
        this.fovY = lerp(this.fovY, this.demoFov, this.cameraModeBlendVal);
        this.roll = lerp(this.roll, this.demoRoll, this.cameraModeBlendVal);

        mat4.targetTo(this.worldFromViewMatrix, this.cameraPos, this.cameraTarget, this.cameraUp);
        mat4.rotateZ(this.worldFromViewMatrix, this.worldFromViewMatrix, this.roll * MathConstants.DEG_TO_RAD);

        // Keep noclip and demo cameras in sync. Ensures that when the user pauses, the camera doesn't snap to an old location
        mat4.copy(globals.sceneContext.viewerInput.camera.worldMatrix, this.worldFromViewMatrix);
        globals.sceneContext.viewerInput.camera.worldMatrixUpdated();

        // Compute updated projection matrix
        const nearY = Math.tan(this.fovY * 0.5) * this.near;
        const nearX = nearY * this.aspect;
        projectionMatrixForFrustum(this.clipFromViewMatrix, -nearX, nearX, -nearY, nearY, this.near, this.far);
        projectionMatrixReverseDepth(this.clipFromViewMatrix);
        projectionMatrixConvertClipSpaceNearZ(this.clipFromViewMatrix, this.clipSpaceNearZ, GfxClipSpaceNearZ.NegativeOne);

        // Scissor setup
        const trimPx = (this.trimHeight / 480) * globals.sceneContext.viewerInput.backbufferHeight;
        vec4.set(this.scissor, 0, trimPx, globals.sceneContext.viewerInput.backbufferWidth, globals.sceneContext.viewerInput.backbufferHeight - 2 * trimPx);

        this.finishSetup();

        if (!this.frozen) {
            // Update the "player position" from the camera.
            vec3.copy(globals.playerPosition, this.cameraPos);
        }
    }

    // Executes before any other draw in other systems 
    override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const template = renderInstManager.pushTemplate();

        mat4.copy(sceneParams.u_Projection, globals.camera.clipFromViewMatrix);
        sceneParams.u_SceneTextureLODBias = calcLODBias(viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        const d = template.allocateUniformBufferF32(GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
        fillSceneParamsData(d, 0, sceneParams);
    }

    public applyScissor(pass: GfxRenderPass) {
        if (this.enableLetterboxing) {
            pass.setScissor(this.scissor[0], this.scissor[1], this.scissor[2], this.scissor[3]);
        }
    }
}
