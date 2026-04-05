/*
 * AI written shader for the debug overlay lines
 *
 * petton-svn, 2026.
 */

import { GfxShaderLibrary } from "../../../gfx/helpers/GfxShaderLibrary.js";
import { DeviceProgram } from "../../../Program.js";

// Line shader for collision geometry - renders thick lines with rounded caps using SDF.
// The quad is expanded in *screen space* inside the vertex shader so the result is
// independent of the camera projection (works under oblique / perspective views).
export class DebugOverlayLineProgram extends DeviceProgram {
  public static ub_Params = 0;

  public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_Params {
    Mat4x4 u_Projection;
    vec4 u_Color;
    vec4 u_Viewport; // x: width, y: height, z: lineWidthPixels, w: maskMode flag (>0.5 = mask)
};
`;

  // Vertex attributes: corner (xy), line start (xy), line end (xy) = 6 floats.
  // corner.x ∈ {0, 1}  picks start (0) or end (1) as the base endpoint.
  // corner.y ∈ {-1, 1} picks which perpendicular side to expand toward.
  public override vert = `
layout(location = 0) in vec2 a_Corner;
layout(location = 1) in vec2 a_LineStart;
layout(location = 2) in vec2 a_LineEnd;

out vec2 v_ScreenPos;
flat out vec2 v_LineStartScreen;
flat out vec2 v_LineEndScreen;

void main() {
    mat4 proj = UnpackMatrix(u_Projection);
    vec4 startClip = proj * vec4(a_LineStart, 0.0, 1.0);
    vec4 endClip   = proj * vec4(a_LineEnd,   0.0, 1.0);

    // Homogeneous near-plane clip. Any endpoint with clip-space w <= 0 is at
    // or behind the eye plane; the perspective divide below would produce
    // flipped / infinite screen coordinates for it, smearing the quad across
    // the whole screen whenever a line straddles the camera (perspective
    // mode, oblique angles, lines leaving the frustum behind the view).
    //
    // Fix: clip the segment against w = W_CLIP in homogeneous space *before*
    // dividing, so both endpoints end up safely in front of the camera. If
    // the whole segment is behind, emit an off-screen degenerate vertex.
    const float W_CLIP = 1e-4;
    bool startBehind = startClip.w < W_CLIP;
    bool endBehind   = endClip.w   < W_CLIP;
    if (startBehind && endBehind) {
        gl_Position       = vec4(2.0, 2.0, 2.0, 1.0); // outside NDC → clipped
        v_ScreenPos       = vec2(0.0);
        v_LineStartScreen = vec2(0.0);
        v_LineEndScreen   = vec2(0.0);
        return;
    }
    if (startBehind) {
        float t = (W_CLIP - startClip.w) / (endClip.w - startClip.w);
        startClip = mix(startClip, endClip, t);
    } else if (endBehind) {
        float t = (W_CLIP - endClip.w) / (startClip.w - endClip.w);
        endClip = mix(endClip, startClip, t);
    }

    // Screen-space (pixel) coordinates for the (possibly clipped) endpoints.
    vec2 startNDC = startClip.xy / startClip.w;
    vec2 endNDC   = endClip.xy   / endClip.w;
    vec2 startScreen = (startNDC * 0.5 + 0.5) * u_Viewport.xy;
    vec2 endScreen   = (endNDC   * 0.5 + 0.5) * u_Viewport.xy;

    // Screen-space direction and perpendicular.
    vec2 dir = endScreen - startScreen;
    float len = length(dir);
    vec2 dirN = len > 0.0001 ? dir / len : vec2(1.0, 0.0);
    vec2 perp = vec2(-dirN.y, dirN.x);

    // Pick the base endpoint for this corner.
    float tPick = a_Corner.x;            // 0 = start, 1 = end
    float sPick = a_Corner.y;            // -1 / +1 perpendicular side
    vec2 basePointScreen = mix(startScreen, endScreen, tPick);
    float baseZ_NDC      = mix(startClip.z / startClip.w, endClip.z / endClip.w, tPick);

    // Expand in screen space. The "along" offset is a small extra cushion so
    // the smoothstep edge + rounded caps aren't clipped by the quad edge.
    float halfWidth = u_Viewport.z * 0.5 + 2.0;
    float alongSign = tPick * 2.0 - 1.0; // -1 at start, +1 at end
    vec2 offsetScreen = basePointScreen
                      + dirN * alongSign * halfWidth
                      + perp * sPick * halfWidth;

    // Emit the quad directly in NDC with w = 1. This is critical: if w varies
    // across the four corners (e.g. under perspective, or any time the line's
    // two endpoints end up at different eye-space depths due to the node's
    // world matrix), perspective-correct interpolation of v_ScreenPos no
    // longer matches the fragment's actual screen-space position and the
    // fragment's distToSegment mask produces garbage. Forcing w = 1 collapses
    // perspective-correct interpolation to plain screen-space linear, which
    // is exactly what we want for a 2D overlay. Depth is preserved since
    // clip.z / clip.w = baseZ_NDC / 1 = baseZ_NDC, matching what the divided
    // depth would have been.
    vec2 offsetNDC = offsetScreen / u_Viewport.xy * 2.0 - 1.0;
    gl_Position = vec4(offsetNDC, baseZ_NDC, 1.0);

    v_ScreenPos       = offsetScreen;
    v_LineStartScreen = startScreen;
    v_LineEndScreen   = endScreen;
}
`;

  public override frag = `
in vec2 v_ScreenPos;
flat in vec2 v_LineStartScreen;
flat in vec2 v_LineEndScreen;

// Distance from point p to line segment ab
float distToSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

void main() {
    float lineRadius = u_Viewport.z * 0.5; // Half width for radius
    float dist = distToSegment(v_ScreenPos, v_LineStartScreen, v_LineEndScreen);

    if (dist > lineRadius) {
        discard;
    }

    // Mask mode: u_Viewport.w > 0.5 means output solid white (used for selection silhouette).
    if (u_Viewport.w > 0.5) {
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
        return;
    }

    // Slight anti-aliasing at edges
    float alpha = 1.0 - smoothstep(lineRadius - 1.0, lineRadius, dist);
    gl_FragColor = vec4(u_Color.rgb, u_Color.a * alpha);
}
`;
}
