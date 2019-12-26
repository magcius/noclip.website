
import { GfxTexture, GfxDevice, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxFormat, GfxVertexBufferFrequency, GfxBuffer, GfxBufferUsage, GfxSampler, GfxInputLayoutBufferDescriptor } from "../gfx/platform/GfxPlatform";
import { makeTextureFromXNA_Texture2D } from "./Texture";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { vec2, mat4 } from "gl-matrix";
import { assert } from "../util";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { XNA_Texture2D } from "./XNB";
import { Fez_AnimatedTexture } from "./XNB_Fez";

interface Frame {
    time: number;
    texMatrix: mat4;
}

function timeSpanToSeconds(n: number): number {
    return n / 10000000;
}

export class BackgroundPlaneData {
    public texture: GfxTexture;
    public sampler: GfxSampler;
    public dimensions = vec2.create();
    public frames: Frame[] = [];
    public duration: number = 0;

    constructor(device: GfxDevice, public name: string, texture: XNA_Texture2D, animatedTexture: Fez_AnimatedTexture | null) {
        this.texture = makeTextureFromXNA_Texture2D(device, texture);

        if (animatedTexture !== null) {
            this.dimensions[0] = animatedTexture.actualWidth;
            this.dimensions[1] = animatedTexture.actualHeight;

            let time = 0;
            for (let i = 0; i < animatedTexture.frames.length; i++) {
                const framePC = animatedTexture.frames[i];
                const duration = timeSpanToSeconds(framePC.duration);
                const [x, y, w, h] = framePC.rectangle;

                const texMatrix = mat4.create();
                texMatrix[0] =  w / texture.width;
                texMatrix[5] =  h / texture.height;
                texMatrix[12] = x / texture.width;
                texMatrix[13] = y / texture.height;

                this.frames.push({ time, texMatrix });
                time += duration;
            }

            this.duration = time;
        } else {
            this.dimensions[0] = texture.width;
            this.dimensions[1] = texture.height;

            const texMatrix = mat4.create();
            this.frames.push({ time: 0, texMatrix });
            this.duration = 0;
        }
    }

    public calcTexMatrix(dst: mat4, timeInSeconds: number): void {
        if (this.frames.length === 1) {
            mat4.copy(dst, this.frames[0].texMatrix);
        } else {
            const time = timeInSeconds % this.duration;
            // Find the first frame to the right of this.
            let i = 0;
            for (; i < this.frames.length; i++)
                if (this.frames[i].time > time)
                    break;
            assert(i > 0);
            mat4.copy(dst, this.frames[i - 1].texMatrix);
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.texture);
    }
}

export class BackgroundPlaneStaticData {
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public indexCount = 6;
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        const vertexData = Float32Array.from([
            // position     normal    texcoord
            -0.5,  0.5, 0,  0, 0, 1,  0, 0,
             0.5,  0.5, 0,  0, 0, 1,  1, 0,
             0.5, -0.5, 0,  0, 0, 1,  1, 1,
            -0.5, -0.5, 0,  0, 0, 1,  0, 1,
        ]);

        const indexData = Uint16Array.from([
            0, 1, 2, 2, 3, 0,
        ]);
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0*0x04, }, // Position
            { location: 1, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 3*0x04, }, // Position
            { location: 2, bufferIndex: 0, format: GfxFormat.F32_RG,  bufferByteOffset: 6*0x04, }, // TexCoord
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 8*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        this.inputLayout = cache.createInputLayout(device, {
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });
        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
    }
}
