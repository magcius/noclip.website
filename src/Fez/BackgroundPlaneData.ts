
import { GfxTexture, GfxDevice, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxFormat, GfxVertexBufferFrequency, GfxBuffer, GfxBufferUsage, GfxSampler, GfxInputLayoutBufferDescriptor } from "../gfx/platform/GfxPlatform";
import { makeTextureFromImageData } from "./Texture";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { vec2, mat4 } from "gl-matrix";
import { assert } from "../util";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";

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

    constructor(device: GfxDevice, public name: string, texImageData: ImageData, private animatedTexture: Document | null) {
        this.texture = makeTextureFromImageData(device, texImageData);

        if (animatedTexture !== null) {
            const animatedTexturePC = animatedTexture.querySelector('AnimatedTexturePC')!;
            this.dimensions[0] = Number(animatedTexturePC.getAttribute('actualWidth')!);
            this.dimensions[1] = Number(animatedTexturePC.getAttribute('actualHeight')!);

            const framePCs = animatedTexture.querySelectorAll('Frames FramePC');
            assert(framePCs.length > 0);

            let time = 0;
            for (let i = 0; i < framePCs.length; i++) {
                const framePC = framePCs[i];
                const duration = timeSpanToSeconds(Number(framePC.getAttribute('duration')));
                const rectangle = framePC.querySelector('Rectangle')!;
                const x = Number(rectangle.getAttribute('x')!);
                const y = Number(rectangle.getAttribute('y')!);
                const w = Number(rectangle.getAttribute('w')!);
                const h = Number(rectangle.getAttribute('h')!);

                const texMatrix = mat4.create();
                texMatrix[0] = w / texImageData.width;
                texMatrix[5] = h / texImageData.height;
                texMatrix[12] = x / texImageData.width;
                texMatrix[13] = y / texImageData.height;

                this.frames.push({ time, texMatrix });
                time += duration;
            }

            this.duration = time;
        } else {
            this.dimensions[0] = texImageData.width;
            this.dimensions[1] = texImageData.height;

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
