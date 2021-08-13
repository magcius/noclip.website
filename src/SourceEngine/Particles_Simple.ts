
// The "simple", legacy particle system as used by env_steam and such.

import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { GfxBuffer, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderInst } from "../gfx/render/GfxRenderInstManager";
import { MaterialProgramBase } from "./Materials";

export class ParticleStaticResource {
    private vertexBufferQuad: GfxBuffer;
    private indexBufferQuad: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputStateQuad: GfxInputState;

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: MaterialProgramBase.a_Position, bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: MaterialProgramBase.a_TexCoord, bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RG, },
            { location: MaterialProgramBase.a_Color,    bufferIndex: 0, bufferByteOffset: 5*0x04, format: GfxFormat.F32_RGBA, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+2+4)*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        const n0 = -1, n1 = 1;
        this.vertexBufferQuad = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, new Float32Array([
            0, n0, n0, 1, 0, 1, 1, 1, 1,
            0, n0, n1, 1, 1, 1, 1, 1, 1,
            0, n1, n0, 0, 0, 1, 1, 1, 1,
            0, n1, n1, 0, 1, 1, 1, 1, 1,
        ]).buffer);
        this.indexBufferQuad = makeStaticDataBuffer(device, GfxBufferUsage.Index, new Uint16Array([
            0, 1, 2, 2, 1, 3,
        ]).buffer);

        this.inputStateQuad = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBufferQuad, byteOffset: 0 },
        ], { buffer: this.indexBufferQuad, byteOffset: 0 });
    }

    public setQuadOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputStateQuad);
        renderInst.drawIndexes(6);
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputState(this.inputStateQuad);
        device.destroyBuffer(this.vertexBufferQuad);
        device.destroyBuffer(this.indexBufferQuad);
    }
}
