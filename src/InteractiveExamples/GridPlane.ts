
import { mat4 } from "gl-matrix";
import { White, colorNewCopy } from "../Color.js";
import { DeviceProgram } from "../Program.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { IS_DEPTH_REVERSED } from "../gfx/helpers/ReversedDepthHelpers.js";
import { fillColor, fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxDevice, GfxProgram } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";

class GridPlaneProgram extends DeviceProgram {
    public static a_Position = 0;
    public static ub_SceneParams = 0;

    public override both = `
layout(std140) uniform ub_Params {
    Mat4x4 u_WorldFromClip;
    Mat4x4 u_ClipFromWorld;
    vec4 u_GridColor;
    vec4 u_Misc[1];
};

#define u_Scale (u_Misc[0].x)
#define u_LineWidth (u_Misc[0].y)
`;

    public override vert = `
out vec2 v_TexCoord;

void main() {
    v_TexCoord.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    v_TexCoord.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = v_TexCoord * vec2(2) - vec2(1);
    gl_Position.zw = vec2(1.0, 1.0);

#if GFX_CLIPSPACE_NEAR_ZERO()
    gl_Position.z = (gl_Position.z + gl_Position.w) * 0.5;
#endif

#if GFX_VIEWPORT_ORIGIN_TL()
    v_TexCoord.y = 1.0 - v_TexCoord.y;
#endif
}
`;

    public override frag = `
in vec2 v_TexCoord;

${GfxShaderLibrary.saturate}
${GfxShaderLibrary.invlerp}

vec3 CalcWorldPos(in vec2 t_ClipXY, in float t_ClipZ) {
    vec4 t_World = Mul(u_WorldFromClip, vec4(t_ClipXY, t_ClipZ, 1.0));
    return t_World.xyz / t_World.www;
}

vec3 IntersectPlane(in vec2 t_ClipXY, out float t_RayT, out vec3 t_Near, out vec3 t_Far) {
    float t_ClipNearZ = GFX_CLIPSPACE_NEAR_Z();
    float t_ClipFarZ = 1.0;

    if (${IS_DEPTH_REVERSED}) {
        t_ClipFarZ = t_ClipNearZ;
        t_ClipNearZ = 1.0;
    }

    // With an infinite far plane, just choose halfway there instead of the full way there.
    t_ClipFarZ = mix(t_ClipNearZ, t_ClipFarZ, 0.5);

    t_Near = CalcWorldPos(t_ClipXY, t_ClipNearZ);
    t_Far = CalcWorldPos(t_ClipXY, t_ClipFarZ);
    t_RayT = t_Near.y / (t_Near.y - t_Far.y);
    return mix(t_Near, t_Far, t_RayT);
}

vec3 IntersectPlane(in vec2 t_ClipXY) {
    float t_RayT;
    vec3 t_Near, t_Far;
    return IntersectPlane(t_ClipXY, t_RayT, t_Near, t_Far);
}

void main() {
    gl_FragColor = vec4(u_GridColor);

    vec2 t_ClipXY = v_TexCoord.xy * vec2(2.0) - vec2(1.0);

    float t_FragWorldT;
    vec3 t_FragWorldNear, t_FragWorldFar;
    vec3 t_FragWorldPos = IntersectPlane(t_ClipXY, t_FragWorldT, t_FragWorldNear, t_FragWorldFar);

    if (t_FragWorldT > 0.0) {
        if (t_FragWorldFar.y > t_FragWorldNear.y)
            gl_FragColor.a *= 0.2;

        vec4 t_PlaneClipPos = Mul(u_ClipFromWorld, vec4(t_FragWorldPos.xyz, 1.0));
        t_PlaneClipPos.xyz /= t_PlaneClipPos.www;

        float t_PlaneClipZ = t_PlaneClipPos.z;
#if !GFX_CLIPSPACE_NEAR_ZERO()
        t_PlaneClipZ = t_PlaneClipZ * 0.5 + 0.5;
#endif

        float t_LineScale = u_LineWidth * t_PlaneClipZ;
        float t_LineWidth = max(t_LineScale, 1.0);
        float t_Scale = u_Scale;
        vec2 t_Coord = t_FragWorldPos.xz * vec2(t_Scale);
        vec2 t_LineSize = fwidth(t_Coord) * t_LineWidth;
        vec2 t_Thresh = abs(fract(t_Coord - vec2(0.5)) - vec2(0.5));
        float t_Signal = max(t_LineSize.x - t_Thresh.x, t_LineSize.y - t_Thresh.y);
        float t_Zone = fwidth(t_Signal) * 0.5;
        gl_FragColor.a *= saturate(t_Signal / t_Zone) * min(t_LineScale * 3.0, 1.0);

        gl_FragDepth = t_PlaneClipPos.z;
    } else {
        gl_FragColor.a = 0.0;
    }
}
`;
}

const bindingLayout: GfxBindingLayoutDescriptor[] = [
    { numSamplers: 0, numUniformBuffers: 1 },
];

const scratchMatrix = mat4.create();
export class GridPlane {
    public gfxProgram: GfxProgram;
    private modelMatrix = mat4.create();
    public color = colorNewCopy(White, 0.5);
    public scale: number = 0.05;
    public lineWidth: number = 10;

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        const program = new GridPlaneProgram();
        this.gfxProgram = cache.createProgram(program);

        this.setSize(500);
    }

    public setSize(n: number): void {
        mat4.fromScaling(this.modelMatrix, [n, n, n]);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setBindingLayouts(bindingLayout);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setVertexInput(null, null, null);
        const megaState = renderInst.setMegaStateFlags({
            depthWrite: false,
        });
        setAttachmentStateSimple(megaState, {
            blendMode: GfxBlendMode.Add,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
        });
        renderInst.setDrawCount(3);

        let offs = renderInst.allocateUniformBuffer(GridPlaneProgram.a_Position, 4*4 + 4*4 + 4 + 4);
        const d = renderInst.mapUniformBufferF32(GridPlaneProgram.a_Position);
        mat4.invert(scratchMatrix, viewerInput.camera.clipFromWorldMatrix);
        offs += fillMatrix4x4(d, offs, scratchMatrix);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.clipFromWorldMatrix);
        offs += fillColor(d, offs, this.color);
        offs += fillVec4(d, offs, this.scale, this.lineWidth);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice) {
        device.destroyProgram(this.gfxProgram);
    }
}
