
import { mat4, ReadonlyMat4 } from "gl-matrix";
import { GfxSampler, GfxDevice, GfxTexture, GfxBindingLayoutDescriptor, GfxProgram, GfxInputLayout, GfxBuffer, GfxSamplerFormatKind, GfxBlendMode, GfxBlendFactor } from "../platform/GfxPlatform";
import type { GfxRenderCache } from "../render/GfxRenderCache";
import type { GfxRenderInst, GfxRenderInstManager } from "../render/GfxRenderInstManager";
import { colorNewCopy, OpaqueBlack, White } from "../../Color";
import { projectionMatrixForCuboid } from "../../MathHelpers";
import { DeviceProgram } from "../../Program";
import { GfxBufferFrequencyHint, GfxBufferUsage, GfxClipSpaceNearZ, GfxFormat, GfxMipFilterMode, GfxTexFilterMode, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferFrequency, GfxWrapMode } from "../platform/GfxPlatform";
import { projectionMatrixConvertClipSpaceNearZ } from "./ProjectionHelpers";
import { fillColor, fillMatrix4x4 } from "./UniformBufferHelpers";
import { createBufferFromData } from "./BufferHelpers";
import { GfxTopology, makeTriangleIndexBuffer } from "./TopologyHelpers";
import { GfxShaderLibrary } from "./GfxShaderLibrary";
import { assert, nArray } from "../platform/GfxPlatformUtil";
import { setAttachmentStateSimple } from "./GfxMegaStateDescriptorHelpers";
import { assertExists } from "../../util";

const scratchMat4 = nArray(2, () => mat4.create());

class FontTexture {
    private readonly characters: string = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
    public readonly characterAdvanceX: number[] = [];
    public readonly gfxTexture: GfxTexture;
    public readonly cellWidth: number;
    public readonly cellHeight: number;

    constructor(device: GfxDevice, public readonly font: string = '32px sans-serif', public readonly strokeWidth: number = 5) {
        // TODO(jstpierre): Would be nice if we had DataShare in here so we wouldn't have to keep remaking this over and over...
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        ctx.font = this.font;
        ctx.textAlign = `left`;
        ctx.textBaseline = `top`;

        let cellWidth = 0;
        let cellHeight = 0;
        for (let i = 0; i < this.characters.length; i++) {
            const c = this.characters[i];
            const measure = ctx.measureText(c);
            this.characterAdvanceX[i] = measure.width;
            const w = Math.ceil(measure.actualBoundingBoxRight + measure.actualBoundingBoxLeft);
            const h = Math.ceil(measure.actualBoundingBoxDescent + measure.actualBoundingBoxAscent);
            cellWidth = Math.max(cellWidth, w);
            cellHeight = Math.max(cellHeight, h);
        }

        this.cellWidth = cellWidth;
        this.cellHeight = cellHeight;

        // Padding
        const extra = this.strokeWidth * 0.5;
        cellWidth += extra * 2;
        cellHeight += extra * 2;

        canvas.width = cellWidth;
        canvas.height = cellHeight;

        this.gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2DArray,
            width: cellWidth,
            height: cellHeight,
            depthOrArrayLayers: this.characters.length,
            pixelFormat: GfxFormat.U8_R_NORM,
            numLevels: 1,
            usage: GfxTextureUsage.Sampled | GfxTextureUsage.RenderTarget,
        });
        device.setResourceName(this.gfxTexture, `FontTexture ${this.font}`);

        ctx.font = this.font;
        ctx.textAlign = `left`;
        ctx.textBaseline = `top`;

        ctx.strokeStyle = `rgba(255, 255, 255, 0.5)`;
        ctx.lineWidth = this.strokeWidth;
        for (let i = 0; i < this.characters.length; i++) {
            ctx.fillStyle = `black`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const char = this.characters[i];
            ctx.fillStyle = `rgba(255, 255, 255, 1.0)`;
            ctx.strokeText(char, extra, extra);
            ctx.fillText(char, extra, extra);

            device.copyCanvasToTexture(this.gfxTexture, i, canvas);
        }
    }

    public getCharacterIndex(c: string): number {
        return this.characters.indexOf(c);
    }

    public getCharacterAdvanceX(index: number): number {
        return this.characterAdvanceX[index];
    }

    public getLineAdvanceY() {
        return this.cellHeight;
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numSamplers: 1, numUniformBuffers: 1, samplerEntries: [
        { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
    ] },
];

class FontProgram extends DeviceProgram {
    public override both = `
precision mediump float;
precision mediump sampler2DArray;

${GfxShaderLibrary.MatrixLibrary}

uniform sampler2DArray u_FontTexture;

layout(std140) uniform ub_FontParams {
    Mat4x4 u_ClipFromLocalMatrix;
    vec4 u_FillColor;
    vec4 u_OutlineColor;
};

#if defined VERT
layout(location = 0) in vec3 a_Position;

out vec3 v_TexCoord;

void main() {
    gl_Position = UnpackMatrix(u_ClipFromLocalMatrix) * vec4(a_Position.xy, 1.0f, 1.0f);
    // TL, TR, BR, BL
    int t_VertexID = int(gl_VertexID & 3);
    v_TexCoord.x = (t_VertexID == 1 || t_VertexID == 2) ? 1.0f : 0.0f;
    v_TexCoord.y = (t_VertexID >= 2) ? 1.0f : 0.0f;
    // a_Position.z contains CharIndex
    v_TexCoord.z = a_Position.z;
}
#endif

#if defined FRAG
in vec3 v_TexCoord;

void main() {
    float t_Coverage = texture(SAMPLER_2DArray(u_FontTexture), v_TexCoord).r;
    // Map range 0.0f - 0.5f to outline color, and 0.5f - 1.0f to fill color.
    if (t_Coverage >= 0.5f) {
        gl_FragColor = mix(u_OutlineColor, u_FillColor, (t_Coverage - 0.5f) * 2.0f);
    } else {
        gl_FragColor = mix(vec4(0.0f), u_OutlineColor, t_Coverage * 2.0f);
    }
    gl_FragColor.rgb *= gl_FragColor.a;
}
#endif
`;
}

export class DebugTextDrawer2 {
    private fontTexture: FontTexture | null = null;
    private gfxSampler: GfxSampler;
    private gfxProgram: GfxProgram;
    private inputLayout: GfxInputLayout;
    private indexBuffer: GfxBuffer;
    private maxQuadsPerDraw = 1024;
    private fontScale = 1.0;
    public textColor = colorNewCopy(White);

    constructor(cache: GfxRenderCache) {
        this.gfxSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            wrapQ: GfxWrapMode.Clamp,
            magFilter: GfxTexFilterMode.Bilinear,
            minFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
        });
        this.gfxProgram = cache.createProgram(new FontProgram());

        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors: [{ location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 }],
            vertexBufferDescriptors: [{ byteStride: 0x0C, frequency: GfxVertexBufferFrequency.PerVertex, }],
        });

        this.indexBuffer = createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, makeTriangleIndexBuffer(GfxTopology.Quads, 0, this.maxQuadsPerDraw).buffer);
    }

    private iterStringInternal(str: string, cb: (charIdx: number, x: number, y: number, advanceX: number) => void): void {
        assert(this.fontTexture !== null);

        let x = 0, y = 0;
        for (let i = 0; i < str.length; i++) {
            const c = str.charAt(i);
            let charIdx = this.fontTexture.getCharacterIndex(c);
            if (charIdx < 0)
                continue;

            const advanceX = this.fontTexture.getCharacterAdvanceX(charIdx) * this.fontScale;
            cb(charIdx, x, y, advanceX);
            x += advanceX;
        }
    }

    private fillParams(renderInst: GfxRenderInst, clipFromLocalMatrix: ReadonlyMat4): void {
        let offs = renderInst.allocateUniformBuffer(0, 24);
        const d = renderInst.mapUniformBufferF32(0);
        offs += fillMatrix4x4(d, offs, clipFromLocalMatrix);
        offs += fillColor(d, offs, this.textColor); // FillColor
        offs += fillColor(d, offs, OpaqueBlack); // OutlineColor
    }

    public drawString2(renderInstManager: GfxRenderInstManager, clipFromLocalMatrix: ReadonlyMat4, str: string): void {
        const cache = renderInstManager.gfxRenderCache;
        assert(this.fontTexture !== null);

        // Calculate the width of the string.
        let strWidth = 0;
        let charCount = 0;
        this.iterStringInternal(str, (charIdx, x, y, advanceX) => {
            strWidth = Math.max(strWidth, x + advanceX);
            charCount++;
        });

        // TODO(jstpierre): Split the string into multiple draws in this case.
        assert(charCount < this.maxQuadsPerDraw);

        // Center align
        let baseX = -strWidth / 2;

        const vertexData = new Float32Array(charCount * 3 * 4);

        let vertexOffs = 0;
        this.iterStringInternal(str, (charIdx, cx, cy, advanceX) => {
            assert(this.fontTexture !== null);

            // TL, TR, BL, BR
            cx += baseX;

            vertexData[vertexOffs++] = cx;
            vertexData[vertexOffs++] = cy;
            vertexData[vertexOffs++] = charIdx;

            vertexData[vertexOffs++] = cx + this.fontTexture.cellWidth * this.fontScale;
            vertexData[vertexOffs++] = cy;
            vertexData[vertexOffs++] = charIdx;

            vertexData[vertexOffs++] = cx + this.fontTexture.cellWidth * this.fontScale;
            vertexData[vertexOffs++] = cy + this.fontTexture.cellHeight * this.fontScale;
            vertexData[vertexOffs++] = charIdx;

            vertexData[vertexOffs++] = cx;
            vertexData[vertexOffs++] = cy + this.fontTexture.cellHeight * this.fontScale;
            vertexData[vertexOffs++] = charIdx;
        });

        const vertexBufferBinding = cache.dynamicBufferCache.allocateData(GfxBufferUsage.Vertex, new Uint8Array(vertexData.buffer));

        const renderInst = renderInstManager.newRenderInst();
        renderInst.debugMarker = `DebugTextDrawer2: ${str}`;
        renderInst.setBindingLayouts(bindingLayouts);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setVertexInput(this.inputLayout, [vertexBufferBinding], { buffer: this.indexBuffer });
        renderInst.setSamplerBindings(0, [{ gfxTexture: this.fontTexture.gfxTexture, gfxSampler: this.gfxSampler, lateBinding: null }]);
        renderInst.setMegaStateFlags({ depthWrite: false });
        setAttachmentStateSimple(renderInst.getMegaStateFlags(), { blendSrcFactor: GfxBlendFactor.One, blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha });
        renderInst.setDrawCount(charCount * 6);
        this.fillParams(renderInst, clipFromLocalMatrix);
        renderInstManager.submitRenderInst(renderInst);
    }

    public drawString(renderInstManager: GfxRenderInstManager, vw: number, vh: number, str: string, x: number, y: number): void {
        const cache = renderInstManager.gfxRenderCache;
        const clipSpaceNearZ = cache.device.queryVendorInfo().clipSpaceNearZ;
        projectionMatrixForCuboid(scratchMat4[0], 0, vw, vh, 0, -10000.0, 10000.0);
        projectionMatrixConvertClipSpaceNearZ(scratchMat4[0], clipSpaceNearZ, GfxClipSpaceNearZ.NegativeOne);
        scratchMat4[1][12] = x;
        scratchMat4[1][13] = y;
        mat4.mul(scratchMat4[0], scratchMat4[0], scratchMat4[1]);
        this.drawString2(renderInstManager, scratchMat4[0], str);
    }

    public setFontScale(v: number): void {
        this.fontScale = v;
    }

    public getScaledLineHeight(): number {
        assert(this.fontTexture !== null); // XXX(jstpierre): This isn't great.
        return this.fontTexture.getLineAdvanceY() * this.fontScale;
    }

    public beginDraw(renderInstManager: GfxRenderInstManager): void {
        const cache = renderInstManager.gfxRenderCache;
        if (this.fontTexture === null)
            this.fontTexture = new FontTexture(cache.device);
    }

    public endDraw(renderInstManager: GfxRenderInstManager): void {
    }
    
    public reserveString(numChars: number, strokeNum?: number): void {
    }

    public destroy(device: GfxDevice): void {
        if (this.fontTexture !== null)
            this.fontTexture.destroy(device);
        device.destroyBuffer(this.indexBuffer);
    }
}
