/*
 * AI written shader for the debug overlays
 *
 * petton-svn, 2026.
 */

import { GfxShaderLibrary } from "../../../gfx/helpers/GfxShaderLibrary.js";
import { DeviceProgram } from "../../../Program.js";

// Debug overlay shader - renders borders and text at fixed screen-space sizes
export class DebugOverlayProgram extends DeviceProgram {
  public static ub_Params = 0;

  public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_Params {
    Mat4x4 u_Projection;
    Mat4x4 u_WorldMatrix;
    // x: world width, y: world height, z: pixels per world unit, w: time in seconds
    vec4 u_OverlayParams;
    // rgba color for the overlay
    vec4 u_Color;
    // x: arrow angle in radians (NaN or > 100 means no arrows), y-w: unused
    vec4 u_ArrowParams;
};

uniform sampler2D u_Texture;
`;

  public override vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec2 a_TexCoord;
layout(location = 2) in vec4 a_Color;

out vec2 v_TexCoord;
out vec2 v_WorldPos; // Position within the quad (0 to worldSize)

void main() {
    gl_Position = UnpackMatrix(u_Projection) * UnpackMatrix(u_WorldMatrix) * vec4(a_Position, 1.0);
    v_TexCoord = a_TexCoord;
    // Calculate position within quad in world units
    v_WorldPos = a_TexCoord * u_OverlayParams.xy;
}
`;

  public override frag = `
in vec2 v_TexCoord;
in vec2 v_WorldPos;

void main() {
    float worldWidth = u_OverlayParams.x;
    float worldHeight = u_OverlayParams.y;

    // Calculate per-axis world-to-pixel conversion to handle non-uniform scaling.
    float worldUnitsPerPixelX = length(vec2(dFdx(v_WorldPos.x), dFdy(v_WorldPos.x)));
    float worldUnitsPerPixelY = length(vec2(dFdx(v_WorldPos.y), dFdy(v_WorldPos.y)));

    float borderWidthPx = 2.0;
    float innerBorderPx = 5.0;
    float totalBorderPx = borderWidthPx + innerBorderPx;
    float cornerRadiusPx = 16.0;

    // Rounded rectangle SDF in screen-pixel space.
    float distFromLeftPx = v_WorldPos.x / max(worldUnitsPerPixelX, 0.0001);
    float distFromRightPx = (worldWidth - v_WorldPos.x) / max(worldUnitsPerPixelX, 0.0001);
    float distFromBottomPx = v_WorldPos.y / max(worldUnitsPerPixelY, 0.0001);
    float distFromTopPx = (worldHeight - v_WorldPos.y) / max(worldUnitsPerPixelY, 0.0001);

    // In corner regions, use distance from the corner circle instead of min-edge.
    float dx = max(cornerRadiusPx - distFromLeftPx, cornerRadiusPx - distFromRightPx);
    float dy = max(cornerRadiusPx - distFromBottomPx, cornerRadiusPx - distFromTopPx);
    float minDistPx;
    if (dx > 0.0 && dy > 0.0) {
        minDistPx = cornerRadiusPx - length(vec2(dx, dy));
    } else {
        minDistPx = min(min(distFromLeftPx, distFromRightPx), min(distFromBottomPx, distFromTopPx));
    }

    // Discard outside the rounded rect
    if (minDistPx < 0.0) discard;

    // Mask mode: output solid white for selection silhouette.
    if (u_ArrowParams.y > 0.5) {
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
        return;
    }

    float time = u_OverlayParams.w;
    float arrowAngle = u_ArrowParams.x;
    bool hasArrows = abs(arrowAngle) < 100.0;

    // Also compute a general pixelsPerWorldUnit for features that don't need per-axis accuracy
    float worldUnitsPerPixel = min(length(dFdx(v_WorldPos)), length(dFdy(v_WorldPos)));
    float pixelsPerWorldUnit = 1.0 / max(worldUnitsPerPixel, 0.0001);
    float fullBorderPx = totalBorderPx + borderWidthPx;
    float totalBorderWorld = fullBorderPx / pixelsPerWorldUnit;

    vec4 color;
    if (minDistPx < borderWidthPx) {
        // Outer black outline
        color = vec4(0.0, 0.0, 0.0, 0.8);
    } else if (minDistPx < totalBorderPx) {
        // Colored border
        color = vec4(u_Color.rgb, 1.0);
    } else if (minDistPx < fullBorderPx) {
        // Inner black outline
        color = vec4(0.0, 0.0, 0.0, 0.8);
    } else {
        // Interior - semi-transparent fill with animated arrow stripes
        float baseAlpha = u_Color.a * 0.25; // Low alpha for gaps
        float stripeAlpha = u_Color.a * 0.5; // Medium alpha for stripes

        if (hasArrows) {
            // Rotate coordinates by arrow angle to support any direction
            // Arrow angle is in radians, 0 = pointing up (+Y), positive = clockwise
            float cosA = cos(arrowAngle);
            float sinA = sin(arrowAngle);

            // Center of the box
            float cx = worldWidth * 0.5;
            float cy = worldHeight * 0.5;

            // Translate to center, rotate, then work in rotated space
            float localX = v_WorldPos.x - cx;
            float localY = v_WorldPos.y - cy;
            float rotX = localX * cosA - localY * sinA;
            float rotY = localX * sinA + localY * cosA;

            // In rotated space, create ^ pattern pointing in +Y direction
            // relX is distance from center axis, relY is position along arrow direction
            float relX = abs(rotX);
            float relY = rotY;

            // Pattern: relX + relY creates diagonal stripes that meet at center
            // forming ^ shapes pointing up in the rotated space
            float pattern = relX + relY;

            // Animation: scroll stripes in arrow direction
            float stripeWidth = min(worldWidth, worldHeight) * 0.15;
            float scrollSpeed = stripeWidth * 2.0; // Speed in world units per second
            pattern -= time * scrollSpeed;

            // Create stripe pattern with smooth edges
            float stripePhase = mod(pattern / stripeWidth, 1.0);
            // Smooth stripe: 0.0-0.4 = gap, 0.4-0.6 = transition, 0.6-1.0 = stripe
            float stripe = smoothstep(0.3, 0.5, stripePhase);

            float alpha = mix(baseAlpha, stripeAlpha, stripe);
            color = vec4(u_Color.rgb, alpha);
        } else {
            color = vec4(u_Color.rgb, baseAlpha + stripeAlpha * 0.5);
        }
    }

    // Texture is sized exactly to the text content (textWidthPx x textHeightPx).
    // Get texture dimensions via textureSize().
    ivec2 texDims = textureSize(SAMPLER_2D(u_Texture), 0);
    float textWidthPx = float(texDims.x);
    float textHeightPx = float(texDims.y);

    // Text is rendered at 1:1 pixel ratio (texture pixels = screen pixels)
    float pixelsPerWorldUnitX = 1.0 / max(worldUnitsPerPixelX, 0.0001);
    float pixelsPerWorldUnitY = 1.0 / max(worldUnitsPerPixelY, 0.0001);
    float textHeightWorld = textHeightPx / pixelsPerWorldUnitY;
    float textWidthWorld = textWidthPx / pixelsPerWorldUnitX;

    // Text region on screen: top-left corner (low X, high Y in world space)
    float textStartX = totalBorderWorld;
    float textEndY = worldHeight - totalBorderWorld;
    float textStartY = textEndY - textHeightWorld;

    if (v_WorldPos.x >= textStartX && v_WorldPos.x < textStartX + textWidthWorld &&
        v_WorldPos.y >= textStartY && v_WorldPos.y < textEndY) {

        float localX = (v_WorldPos.x - textStartX) / textWidthWorld;
        float localY = (v_WorldPos.y - textStartY) / textHeightWorld;

        vec2 texSampleUV = vec2(localX, 1.0 - localY);

        vec4 textColor = texture(SAMPLER_2D(u_Texture), texSampleUV);
        if (textColor.a > 0.5) {
            color = textColor;
        }
    }

    gl_FragColor = color;
}
`;
}
