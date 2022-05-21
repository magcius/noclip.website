
// Dynamic Draw
// A helper for all those times that Galaxy just writes triangles raw.

import * as GX from '../gx/gx_enum';
import { GX_VtxDesc, compileLoadedVertexLayout, LoadedVertexLayout } from '../gx/gx_displaylist';
import { assert, assertExists, align } from '../util';
import { GfxRenderInstManager, GfxRenderInst } from '../gfx/render/GfxRenderInstManager';
import { GfxDevice, GfxInputLayout, GfxInputState, GfxIndexBufferDescriptor, GfxVertexBufferDescriptor, GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint } from '../gfx/platform/GfxPlatform';
import { createInputLayout } from '../gx/gx_render';
import { getTriangleIndexCountForTopologyIndexCount, GfxTopology, convertToTrianglesRange } from '../gfx/helpers/TopologyHelpers';
import { getSystemEndianness, Endianness } from '../endian';
import { ReadonlyVec2, ReadonlyVec3 } from 'gl-matrix';
import { Color, colorToRGBA8 } from '../Color';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';

function getGfxToplogyFromCommand(cmd: GX.Command): GfxTopology {
    if (cmd === GX.Command.DRAW_QUADS)
        return GfxTopology.Quads;
    else if (cmd === GX.Command.DRAW_TRIANGLE_STRIP)
        return GfxTopology.TriStrips;
    else if (cmd === GX.Command.DRAW_TRIANGLES)
        return GfxTopology.Triangles;
    else if (cmd === GX.Command.DRAW_TRIANGLE_FAN)
        return GfxTopology.TriFans;
    else
        throw "whoops";
}

abstract class TDDrawBase {
    private vcd: GX_VtxDesc[] = [];
    private useNBT = false;
    protected loadedVertexLayout: LoadedVertexLayout | null = null;
    protected inputLayout: GfxInputLayout | null = null;
    protected inputState: GfxInputState | null = null;
    protected vertexBuffer: GfxBuffer | null = null;
    protected indexBuffer: GfxBuffer | null = null; null = null;

    // Global information
    protected currentVertex: number;
    protected currentIndex: number;
    protected indexData: Uint16Array;
    protected vertexData: DataView;

    // Current primitive information
    protected currentPrimVertex: number;
    protected currentPrim: GX.Command;

    constructor() {
        for (let i = GX.Attr.POS; i <= GX.Attr.TEX7; i++) {
            this.vcd[i] = { type: GX.AttrType.NONE };
        }
    }

    public setVtxDesc(attr: GX.Attr, enabled: boolean): void {
        if (attr === GX.Attr._NBT) {
            attr = GX.Attr.NRM;
            this.useNBT = enabled;
        }

        const vcd = assertExists(this.vcd[attr]);

        const type = enabled ? GX.AttrType.DIRECT : GX.AttrType.NONE;
        if (vcd.type !== type) {
            vcd.type = type;
            this.dirtyInputLayout();
        }
    }

    private dirtyInputLayout(): void {
        this.loadedVertexLayout = null;
        this.inputLayout = null;
    }

    protected createLoadedVertexLayout(): void {
        if (this.loadedVertexLayout === null)
            this.loadedVertexLayout = compileLoadedVertexLayout(this.vcd, this.useNBT);
    }

    protected createInputLayoutInternal(cache: GfxRenderCache): boolean {
        if (this.inputLayout === null) {
            this.inputLayout = createInputLayout(cache, this.loadedVertexLayout!);
            return true;
        } else {
            return false;
        }
    }

    public createInputLayout(cache: GfxRenderCache): void {
        this.createLoadedVertexLayout();
        this.createInputLayoutInternal(cache);
    }

    protected abstract ensureIndexBufferData(newSize: number): void;
    protected abstract ensureVertexBufferData(newSize: number): void;

    public allocVertices(num: number): void {
        const vertexCount = this.currentVertex + 1 + num;
        const stride = this.loadedVertexLayout!.vertexBufferStrides[0];
        this.ensureVertexBufferData(vertexCount * stride);
    }

    public allocPrimitives(type: GX.Command, num: number): void {
        const vertexCount = this.currentVertex + 1 + num;
        const topology = getGfxToplogyFromCommand(type);
        const stride = this.loadedVertexLayout!.vertexBufferStrides[0];
        this.ensureVertexBufferData(vertexCount * stride);
        this.ensureIndexBufferData(getTriangleIndexCountForTopologyIndexCount(topology, vertexCount));
    }

    private getOffs(v: number, attr: GX.Attr): number {
        const stride = this.loadedVertexLayout!.vertexBufferStrides[0];
        return v*stride + this.loadedVertexLayout!.vertexAttributeOffsets[attr];
    }

    private writeFloat32(offs: number, v: number): void {
        const e = (getSystemEndianness() === Endianness.LITTLE_ENDIAN);
        this.vertexData.setFloat32(offs, v, e);
    }

    public position3f32(x: number, y: number, z: number): void {
        ++this.currentVertex;
        ++this.currentPrimVertex;
        this.allocVertices(0);

        const offs = this.getOffs(this.currentVertex, GX.Attr.POS);
        this.writeFloat32(offs + 0x00, x);
        this.writeFloat32(offs + 0x04, y);
        this.writeFloat32(offs + 0x08, z);
    }

    public position3vec3(v: ReadonlyVec3): void {
        this.position3f32(v[0], v[1], v[2]);
    }

    public normal3f32(x: number, y: number, z: number): void {
        const offs = this.getOffs(this.currentVertex, GX.Attr.NRM);
        this.writeFloat32(offs + 0x00, x);
        this.writeFloat32(offs + 0x04, y);
        this.writeFloat32(offs + 0x08, z);
    }

    public normal3vec3(v: ReadonlyVec3): void {
        this.normal3f32(v[0], v[1], v[2]);
    }

    public texCoord2f32(attr: GX.Attr, s: number, t: number): void {
        const offs = this.getOffs(this.currentVertex, attr);
        this.writeFloat32(offs + 0x00, s);
        this.writeFloat32(offs + 0x04, t);
    }

    public texCoord2vec2(attr: GX.Attr, v: ReadonlyVec2): void {
        this.texCoord2f32(attr, v[0], v[1]);
    }

    public color4rgba8(attr: GX.Attr, r: number, g: number, b: number, a: number): void {
        const offs = this.getOffs(this.currentVertex, attr);
        // Always big-endian (R8G8B8A8)
        this.vertexData.setUint32(offs + 0x00, (r << 24) | (g << 16) | (b << 8) | a, false);
    }

    public color4color(attr: GX.Attr, c: Color): void {
        const offs = this.getOffs(this.currentVertex, attr);
        // Always big-endian (R8G8B8A8)
        this.vertexData.setUint32(offs + 0x00, colorToRGBA8(c), false);
    }

    public begin(type: GX.Command, num: number | null = null): void {
        this.currentPrim = type;
        this.currentPrimVertex = -1;

        if (num !== null)
            this.allocPrimitives(type, num);
    }

    public end(): void {
        const gfxTopo = getGfxToplogyFromCommand(this.currentPrim);
        const numIndices = getTriangleIndexCountForTopologyIndexCount(gfxTopo, this.currentPrimVertex + 1);
        this.ensureIndexBufferData(this.currentIndex + numIndices);
        const baseVertex = this.currentVertex - this.currentPrimVertex;
        const numVertices = this.currentPrimVertex + 1;
        convertToTrianglesRange(this.indexData, this.currentIndex, gfxTopo, baseVertex, numVertices);
        this.currentIndex += numIndices;
    }
}

export class TDDraw extends TDDrawBase {
    private frequencyHint = GfxBufferFrequencyHint.Dynamic;

    private recreateVertexBuffer: boolean = true;
    private recreateIndexBuffer: boolean = true;

    private startIndex: number;

    constructor() {
        super();
        this.vertexData = new DataView(new ArrayBuffer(0x400));
        this.indexData = new Uint16Array(0x100);
    }

    protected ensureVertexBufferData(newByteSize: number): void {
        if (newByteSize > this.vertexData.byteLength) {
            const newByteSizeAligned = align(newByteSize, this.vertexData.byteLength);
            const newData = new Uint8Array(newByteSizeAligned);
            newData.set(new Uint8Array(this.vertexData.buffer));
            this.vertexData = new DataView(newData.buffer);
            this.recreateVertexBuffer = true;
        }
    }

    protected ensureIndexBufferData(newSize: number): void {
        if (newSize > this.indexData.length) {
            const newSizeAligned = align(newSize, this.indexData.byteLength);
            const newData = new Uint16Array(newSizeAligned);
            newData.set(this.indexData);
            this.indexData = newData;
            this.recreateIndexBuffer = true;
        }
    }

    public beginDraw(): void {
        this.createLoadedVertexLayout();

        this.currentVertex = -1;
        this.currentIndex = 0;
        this.startIndex = 0;
    }

    private flushDeviceObjects(cache: GfxRenderCache): void {
        const device = cache.device;
        let recreateInputState = false;

        if (this.createInputLayoutInternal(cache))
            recreateInputState = true;
        if (this.inputState === null)
            recreateInputState = true;

        if ((this.recreateVertexBuffer || this.recreateIndexBuffer) && this.startIndex > 0) {
            console.warn(`DDraw: Recreating buffers when render insts already made. This will cause illegal warnings. Use allocatePrimitives() to prevent this.`);
            // debugger;
        }

        if (this.recreateVertexBuffer) {
            if (this.vertexBuffer !== null)
                device.destroyBuffer(this.vertexBuffer);
            this.vertexBuffer = device.createBuffer((this.vertexData.byteLength + 3) >>> 2, GfxBufferUsage.Vertex, this.frequencyHint);
            this.recreateVertexBuffer = false;
            recreateInputState = true;
        }

        if (this.recreateIndexBuffer) {
            if (this.indexBuffer !== null)
                device.destroyBuffer(this.indexBuffer);
            this.indexBuffer = device.createBuffer((this.indexData.byteLength + 3) >>> 2, GfxBufferUsage.Index, this.frequencyHint);
            this.recreateIndexBuffer = false;
            recreateInputState = true;
        }

        if (recreateInputState) {
            if (this.inputState !== null)
                device.destroyInputState(this.inputState);

            const buffers: GfxVertexBufferDescriptor[] = [{
                buffer: this.vertexBuffer!,
                byteOffset: 0,
            }];
            const indexBuffer: GfxIndexBufferDescriptor = {
                buffer: this.indexBuffer!,
                byteOffset: 0,
            };

            this.inputState = device.createInputState(this.inputLayout!, buffers, indexBuffer);
        }
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(this.currentIndex - this.startIndex, this.startIndex);
    }

    public canMakeRenderInst(): boolean {
        return this.currentIndex > this.startIndex;
    }

    public next(): void {
        this.startIndex = this.currentIndex;
    }

    public makeRenderInst(renderInstManager: GfxRenderInstManager): GfxRenderInst {
        this.flushDeviceObjects(renderInstManager.gfxRenderCache);
        const renderInst = renderInstManager.newRenderInst();
        this.setOnRenderInst(renderInst);
        this.next();
        return renderInst;
    }

    private endAndUploadCache(cache: GfxRenderCache): void {
        const device = cache.device;
        this.flushDeviceObjects(cache);
        device.uploadBufferData(this.vertexBuffer!, 0, new Uint8Array(this.vertexData.buffer));
        device.uploadBufferData(this.indexBuffer!, 0, new Uint8Array(this.indexData.buffer));
    }

    public endAndUpload(renderInstManager: GfxRenderInstManager): void {
        return this.endAndUploadCache(renderInstManager.gfxRenderCache);
    }

    public endDraw(renderInstManager: GfxRenderInstManager): GfxRenderInst {
        this.endAndUpload(renderInstManager);
        return this.makeRenderInst(renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        if (this.inputState !== null) {
            device.destroyInputState(this.inputState);
            this.inputState = null;
        }

        if (this.indexBuffer !== null) {
            device.destroyBuffer(this.indexBuffer);
            this.indexBuffer = null;
            this.recreateIndexBuffer = true;
        }

        if (this.vertexBuffer !== null) {
            device.destroyBuffer(this.vertexBuffer);
            this.vertexBuffer = null;
            this.recreateVertexBuffer = true;
        }
    }
}

// Static Draw helper for places where we might want to make TDDraw into a buffer
// that does not change very much.
export class TSDraw extends TDDrawBase {
    private frequencyHint = GfxBufferFrequencyHint.Static;

    constructor() {
        super();
        this.vertexData = new DataView(new ArrayBuffer(0x400));
        this.indexData = new Uint16Array(0x100);
    }

    protected ensureVertexBufferData(newByteSize: number): void {
        if (newByteSize > this.vertexData.byteLength) {
            const newByteSizeAligned = align(newByteSize, this.vertexData.byteLength);
            const newData = new Uint8Array(newByteSizeAligned);
            newData.set(new Uint8Array(this.vertexData.buffer));
            this.vertexData = new DataView(newData.buffer);
        }
    }

    protected ensureIndexBufferData(newSize: number): void {
        if (newSize > this.indexData.length) {
            const newSizeAligned = align(newSize, this.indexData.byteLength);
            const newData = new Uint16Array(newSizeAligned);
            newData.set(this.indexData);
            this.indexData = newData;
        }
    }

    public beginDraw(): void {
        assert(this.vertexBuffer === null);
        assert(this.indexBuffer === null);
        this.createLoadedVertexLayout();

        this.currentVertex = -1;
        this.currentIndex = 0;
    }

    private flushDeviceObjects(cache: GfxRenderCache): void {
        assert(this.inputState === null);

        const device = cache.device;
        this.createInputLayoutInternal(cache);
        this.vertexBuffer = device.createBuffer((this.vertexData.byteLength + 3) >>> 2, GfxBufferUsage.Vertex, this.frequencyHint);
        this.indexBuffer = device.createBuffer((this.indexData.byteLength + 3) >>> 2, GfxBufferUsage.Index, this.frequencyHint);

        const buffers: GfxVertexBufferDescriptor[] = [{
            buffer: this.vertexBuffer!,
            byteOffset: 0,
        }];
        const indexBuffer: GfxIndexBufferDescriptor = {
            buffer: this.indexBuffer!,
            byteOffset: 0,
        };

        this.inputState = device.createInputState(this.inputLayout!, buffers, indexBuffer);
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        assert(this.inputState !== null);
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(this.currentIndex);
    }

    public endDraw(cache: GfxRenderCache): void {
        const device = cache.device;
        this.flushDeviceObjects(cache);
        device.uploadBufferData(this.vertexBuffer!, 0, new Uint8Array(this.vertexData.buffer));
        device.uploadBufferData(this.indexBuffer!, 0, new Uint8Array(this.indexData.buffer));
    }

    public destroy(device: GfxDevice): void {
        if (this.inputState !== null)
            device.destroyInputState(this.inputState);
        if (this.indexBuffer !== null)
            device.destroyBuffer(this.indexBuffer);
        if (this.vertexBuffer !== null)
            device.destroyBuffer(this.vertexBuffer);
    }
}
