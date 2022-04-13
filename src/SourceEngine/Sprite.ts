
import { mat4, vec3 } from "gl-matrix";
import { computeViewSpaceDepthFromWorldSpacePoint } from "../Camera";
import { GfxRenderInstManager, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { getMatrixAxisZ, saturate, scaleMatrix, setMatrixTranslation, Vec3Zero } from "../MathHelpers";
import { SourceEngineView, SourceRenderContext } from "./Main";
import { BaseMaterial, RenderMode } from "./Materials";
import { computeMatrixForForwardDir } from "./StaticDetailObject";

const scratchVec3a = vec3.create();
const scratchMat4a = mat4.create();

function calcSpriteOrientation(dst: mat4, orientation: string, view: SourceEngineView): void {
    if (orientation === 'vp_parallel') {
        // TODO(jstpierre): Compute actual VP here (include roll)
        getMatrixAxisZ(scratchVec3a, view.worldFromViewMatrix);
        computeMatrixForForwardDir(dst, scratchVec3a, Vec3Zero);
    } else {
        // Unimplemented.
        getMatrixAxisZ(scratchVec3a, view.worldFromViewMatrix);
        computeMatrixForForwardDir(dst, scratchVec3a, Vec3Zero);
    }
}

export class SpriteInstance {
    public origin = vec3.create();
    public angles = vec3.create();
    public scale: number = 1;

    constructor(renderContext: SourceRenderContext, public materialInstance: BaseMaterial) {
    }

    public movement(renderContext: SourceRenderContext): void {
        this.materialInstance.movement(renderContext);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager): void {
        const spriteOrientation = this.materialInstance.paramGetString('$spriteorientation');
        const spriteOrigin = this.materialInstance.paramGetVector('$spriteorigin');
        const renderMode: RenderMode = this.materialInstance.paramGetInt('$rendermode');

        let distAlpha = 1.0, distScale = 1.0;

        if (renderMode === RenderMode.Glow || renderMode === RenderMode.WorldGlow) {
            const dist = vec3.distance(renderContext.currentView.cameraPos, this.origin);

            distAlpha = saturate(1200**2 / dist**2);

            if (renderMode !== RenderMode.WorldGlow)
                distScale = dist / 200;
        }

        if (distScale <= 0.0 || distAlpha <= 0.0)
            return;

        const tex = this.materialInstance.representativeTexture!;
        const scale = distScale * this.scale;
        const scaleX = scale * tex.width * 0.5, scaleY = scale * tex.height * 0.5;
        const maxScale = Math.max(scaleX, scaleY);

        if (!renderContext.currentView.frustum.containsSphere(this.origin, maxScale))
            return;

        // Set up model matrix for sprite.
        const renderInst = renderInstManager.newRenderInst();
        renderContext.materialCache.staticResources.staticQuad.setQuadOnRenderInst(renderInst);

        this.materialInstance.paramSetNumber('$alpha', distAlpha);
        this.materialInstance.setOnRenderInst(renderContext, renderInst);

        const view = renderContext.currentView;

        calcSpriteOrientation(scratchMat4a, spriteOrientation, view);
        setMatrixTranslation(scratchMat4a, this.origin);

        scaleMatrix(scratchMat4a, scratchMat4a, scaleX, scaleY);

        // TODO(jstpierre): $spriteorigin

        this.materialInstance.setOnRenderInstModelMatrix(renderInst, scratchMat4a);

        const depth = computeViewSpaceDepthFromWorldSpacePoint(view.viewFromWorldMatrix, this.origin);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);

        this.materialInstance.getRenderInstListForView(view).submitRenderInst(renderInst);
    }
}
