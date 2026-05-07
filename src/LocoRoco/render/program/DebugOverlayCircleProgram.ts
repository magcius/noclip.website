/*
 * AI written shader for the debug overlay circles (e.g. soundpoint)
 *
 * petton-svn, 2026.
 */

import { GfxShaderLibrary } from "../../../gfx/helpers/GfxShaderLibrary.js";
import { DeviceProgram } from "../../../Program.js";

// Debug overlay circle shader - renders a circle with border and centered text
export class DebugOverlayCircleProgram extends DeviceProgram {
  public static ub_Params = 0;

  public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_Params {
    Mat4x4 u_Projection;
    Mat4x4 u_WorldMatrix;
    // x: world width (diameter), y: world height (diameter), z: actual text width in pixels, w: unused
    vec4 u_OverlayParams;
    // rgba color for the overlay
    vec4 u_Color;
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
    v_WorldPos = a_TexCoord * u_OverlayParams.xy;
}
`;

  public override frag = `
in vec2 v_TexCoord;
in vec2 v_WorldPos;

void main() {
    float worldWidth = u_OverlayParams.x;
    float worldHeight = u_OverlayParams.y;
    float radius = worldWidth * 0.5;

    // Distance from center of the quad
    float cx = worldWidth * 0.5;
    float cy = worldHeight * 0.5;
    float dx = v_WorldPos.x - cx;
    float dy = v_WorldPos.y - cy;
    float dist = sqrt(dx * dx + dy * dy);

    // Discard outside circle
    if (dist > radius) discard;

    // Mask mode: u_OverlayParams.w > 0.5 means output solid white (used for selection silhouette).
    if (u_OverlayParams.w > 0.5) {
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
        return;
    }

    // Screen-space pixel size calculation
    float worldUnitsPerPixel = min(length(dFdx(v_WorldPos)), length(dFdy(v_WorldPos)));
    float pixelsPerWorldUnit = 1.0 / max(worldUnitsPerPixel, 0.0001);

    // Distance from circle edge in pixels
    float distFromEdgePx = (radius - dist) / max(worldUnitsPerPixel, 0.0001);

    float borderWidthPx = 2.0;
    float innerBorderPx = 5.0;
    float totalBorderPx = borderWidthPx + innerBorderPx;

    float fullBorderPx = totalBorderPx + borderWidthPx;

    vec4 color;
    if (distFromEdgePx < borderWidthPx) {
        // Outer black outline
        color = vec4(0.0, 0.0, 0.0, 0.8);
    } else if (distFromEdgePx < totalBorderPx) {
        // Colored border
        color = vec4(u_Color.rgb, 1.0);
    } else if (distFromEdgePx < fullBorderPx) {
        // Inner black outline
        color = vec4(0.0, 0.0, 0.0, 0.8);
    } else {
        // Interior - semi-transparent fill
        float baseAlpha = u_Color.a * 0.25;
        float stripeAlpha = u_Color.a * 0.5;
        color = vec4(u_Color.rgb, baseAlpha + stripeAlpha * 0.5);
    }

    // Texture is sized exactly to the text content (textWidthPx x textHeightPx).
    ivec2 texDims = textureSize(SAMPLER_2D(u_Texture), 0);
    float textWidthPx = float(texDims.x);
    float textHeightPx = float(texDims.y);

    // Per-axis world-to-pixel conversion
    float worldUnitsPerPixelX = length(vec2(dFdx(v_WorldPos.x), dFdy(v_WorldPos.x)));
    float worldUnitsPerPixelY = length(vec2(dFdx(v_WorldPos.y), dFdy(v_WorldPos.y)));
    float pixelsPerWorldUnitX = 1.0 / max(worldUnitsPerPixelX, 0.0001);
    float pixelsPerWorldUnitY = 1.0 / max(worldUnitsPerPixelY, 0.0001);
    float textHeightWorld = textHeightPx / pixelsPerWorldUnitY;
    float textWidthWorld = textWidthPx / pixelsPerWorldUnitX;

    // Top-center: horizontally centered, below the circle border with padding.
    // If the text is too wide to fit at that Y, move it down until it fits (stop at center).
    float totalBorderWorld = fullBorderPx / max(pixelsPerWorldUnit, 0.0001);
    float paddingWorld = 8.0 / max(pixelsPerWorldUnit, 0.0001);
    float textStartX = (worldWidth - textWidthWorld) * 0.5;

    float preferredY = worldHeight - totalBorderWorld - paddingWorld - textHeightWorld;
    float centeredY = (worldHeight - textHeightWorld) * 0.5;

    // The text top corners are at (cx ± textWidthWorld/2, textStartY + textHeightWorld).
    // For those to be inside the circle: (textWidthWorld/2)^2 + (topY - cy)^2 <= radius^2
    float halfTextW = textWidthWorld * 0.5;
    float discriminant = radius * radius - halfTextW * halfTextW;
    float maxFitY = discriminant > 0.0
        ? radius + sqrt(discriminant) - textHeightWorld
        : centeredY;

    // Ease the transition: compute a 0-1 parameter for how far we are between
    // centeredY (0) and preferredY (1), then apply smoothstep so it decelerates
    // as it approaches the center rather than slamming into it.
    float rawY = min(preferredY, maxFitY);
    float range = preferredY - centeredY;
    float t = range > 0.0001 ? clamp((rawY - centeredY) / range, 0.0, 1.0) : 0.0;
    float easedT = smoothstep(0.0, 1.0, t);
    float textStartY = centeredY + easedT * range;

    if (v_WorldPos.x >= textStartX && v_WorldPos.x < textStartX + textWidthWorld &&
        v_WorldPos.y >= textStartY && v_WorldPos.y < textStartY + textHeightWorld) {

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
