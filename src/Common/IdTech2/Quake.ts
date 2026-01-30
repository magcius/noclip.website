import { GfxDevice, GfxFormat, GfxTexture, makeTextureDescriptor2D } from "../../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../../gfx/helpers/GfxShaderLibrary.js";
import { DeviceProgram } from "../../Program.js";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { getMipTexName } from "./Render.js";

// Quake sky textures are 256x128, with:
// - left half being alpha (foreground clouds)
// - right half being solid (background)
export class QuakeSkyTextureData {
    public solidTexture: GfxTexture;
    public alphaTexture: GfxTexture;
    public name: string;

    constructor(device: GfxDevice, buffer: ArrayBufferSlice, palette: Uint8Array) {
        const view = buffer.createDataView();
        this.name = getMipTexName(buffer);
        const width = view.getUint32(0x10, true);
        const height = view.getUint32(0x14, true);

        const halfWidth = width >>> 1;
        const mipOffset = view.getUint32(0x18, true);

        this.solidTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, halfWidth, height, 1));
        this.alphaTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, halfWidth, height, 1));
        device.setResourceName(this.solidTexture, `${this.name}_solid`);
        device.setResourceName(this.alphaTexture, `${this.name}_alpha`);

        const solidData = new Uint8Array(halfWidth * height * 4);
        const alphaData = new Uint8Array(halfWidth * height * 4);

        // Extract right half (solid/background layer)
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < halfWidth; x++) {
                const srcIdx = mipOffset + y * width + halfWidth + x;
                const dstIdx = (y * halfWidth + x) * 4;
                const palIdx = view.getUint8(srcIdx);

                solidData[dstIdx + 0] = palette[palIdx * 3 + 0];
                solidData[dstIdx + 1] = palette[palIdx * 3 + 1];
                solidData[dstIdx + 2] = palette[palIdx * 3 + 2];
                solidData[dstIdx + 3] = 0xFF;
            }
        }

        // Extract left half (alpha/foreground layer)
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < halfWidth; x++) {
                const alphaSrcIdx = mipOffset + y * width + x;
                const solidSrcIdx = mipOffset + y * width + halfWidth + x;
                const dstIdx = (y * halfWidth + x) * 4;
                const palIdx = view.getUint8(alphaSrcIdx);

                if (palIdx === 0) {
                    const solidPalIdx = view.getUint8(solidSrcIdx);
                    alphaData[dstIdx + 0] = palette[solidPalIdx * 3 + 0];
                    alphaData[dstIdx + 1] = palette[solidPalIdx * 3 + 1];
                    alphaData[dstIdx + 2] = palette[solidPalIdx * 3 + 2];
                    alphaData[dstIdx + 3] = 0x00;
                } else {
                    alphaData[dstIdx + 0] = palette[palIdx * 3 + 0];
                    alphaData[dstIdx + 1] = palette[palIdx * 3 + 1];
                    alphaData[dstIdx + 2] = palette[palIdx * 3 + 2];
                    alphaData[dstIdx + 3] = 0xFF;
                }
            }
        }

        device.uploadTextureData(this.solidTexture, 0, [solidData]);
        device.uploadTextureData(this.alphaTexture, 0, [alphaData]);
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.solidTexture);
        device.destroyTexture(this.alphaTexture);
    }
}

export class QuakeSkyProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    public static a_Position = 0;
    public static a_TexCoord = 1;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_EyePosTime;
};

#define u_EyePosition (u_EyePosTime.xyz)
#define u_Time (u_EyePosTime.w)

layout(std140) uniform ub_ModelParams {
    Mat4x4 u_ModelMatrix;
};

uniform sampler2D u_TextureSolid;
uniform sampler2D u_TextureAlpha;
`;

    public override vert = `
layout(location = ${QuakeSkyProgram.a_Position}) in vec3 a_Position;
layout(location = ${QuakeSkyProgram.a_TexCoord}) in vec4 a_TexCoord;

out vec3 v_SkyDir;

void main() {
    vec4 t_PositionWorld = UnpackMatrix(u_ModelMatrix) * vec4(a_Position, 1.0);
    gl_Position = UnpackMatrix(u_ProjectionView) * t_PositionWorld;

    vec3 dir = t_PositionWorld.xyz - u_EyePosition;

    // Compresses the sky vertically before normalization, causing
    // the texture to stretch when looking up, making the sky
    // appear as a flattened dome rather than a sphere
    dir.z *= 3.0;

    v_SkyDir = dir;
}
`;

    public override frag = `
in vec3 v_SkyDir;

// Sky texture is 256x128, split into two 128x128 halves (SKYSIZE = 128).
// UV scale derived from original Quake: 6 * (SKYSIZE/2 - 1) / SKYSIZE = 378/128 = 189/64
#define SKY_UV_SCALE (189.0 / 64.0)

// Scroll speeds create parallax: foreground clouds move 2x faster than background
#define SKY_SCROLL_SOLID 16.0
#define SKY_SCROLL_ALPHA 8.0

void main() {
    vec2 uv = normalize(v_SkyDir).xy * SKY_UV_SCALE;

    vec2 solidUV = uv + u_Time / SKY_SCROLL_SOLID;
    vec4 solidColor = texture(SAMPLER_2D(u_TextureSolid), solidUV);

    vec2 alphaUV = uv + u_Time / SKY_SCROLL_ALPHA;
    vec4 alphaColor = texture(SAMPLER_2D(u_TextureAlpha), alphaUV);

    vec3 color = solidColor.rgb * (1.0 - alphaColor.a) + alphaColor.rgb * alphaColor.a;

    color = color * 1.4;  // Contrast
    color = pow(color, vec3(0.9));  // Gamma

    gl_FragColor = vec4(color, 1.0);
}
`;
}
