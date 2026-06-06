
// Dynamic Draw
// A helper for all those times that Galaxy just writes triangles raw.

import * as GX from './gx_enum.js';
import { GX_VtxDesc, compileLoadedVertexLayout, LoadedVertexLayout } from './gx_displaylist.js';
import { assert, assertExists, align } from '../util.js';
import { GfxRenderInstManager, GfxRenderInst } from '../gfx/render/GfxRenderInstManager.js';
import { GfxDevice, GfxInputLayout, GfxIndexBufferDescriptor, GfxVertexBufferDescriptor, GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint } from '../gfx/platform/GfxPlatform.js';
import { createInputLayout } from './gx_render.js';
import { getTriangleIndexCountForTopologyIndexCount, GfxTopology, convertToTrianglesRange } from '../gfx/helpers/TopologyHelpers.js';
import { getSystemEndianness, Endianness } from '../endian.js';
import { ReadonlyVec2, ReadonlyVec3 } from 'gl-matrix';
import { Color, colorToRGBA8 } from '../Color.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';

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
        throw new Error("whoops");
}

abstract class TDDrawBase {
    protected vcd: GX_VtxDesc[] = [];
    protected useNBT = false;
    protected loadedVertexLayout: LoadedVertexLayout | null = null;
    protected inputLayout: GfxInputLayout | null = null;

    // Global information
    protected currentVertex: number;
    protected currentIndex: number;
    protected indexData: Uint16Array;
    protected vertexData: DataView;

    // Current primitive information
    protected currentPrimVertex: number;
    protected currentPrim: GX.Command;

    constructor(protected name: string) {
        for (let i = GX.Attr.POS; i <= GX.Attr.TEX7; i++) {
            this.vcd[i] = { type: GX.AttrType.NONE };
        }
    }

    public setVtxDesc(attr: GX.Attr, enabled: boolean): void {
        assert(this.loadedVertexLayout === null);

        if (attr === GX.Attr._NBT) {
            attr = GX.Attr.NRM;
            this.useNBT = enabled;
        }

        const vcd = assertExists(this.vcd[attr]);
        vcd.type = enabled ? GX.AttrType.DIRECT : GX.AttrType.NONE;
    }

    protected abstract ensureIndexBufferData(newSize: number): void;
    protected abstract ensureVertexBufferData(newSize: number): void;

    private allocVertices(numVertex: number): void {
        const vertexCount = this.currentVertex + 1 + numVertex;
        const stride = this.loadedVertexLayout!.vertexBufferStrides[0];
        this.ensureVertexBufferData(vertexCount * stride);
    }

    public allocPrimitives(type: GX.Command, numVertex: number): void {
        const vertexCount = this.currentVertex + 1 + numVertex;
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

    public begin(type: GX.Command, numVertex: number | null = null): void {
        this.currentPrim = type;
        this.currentPrimVertex = -1;

        if (numVertex !== null)
            this.allocPrimitives(type, numVertex);
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
    private startIndex: number;
    private vertexBufferDescriptor: GfxVertexBufferDescriptor | null = null;
    private indexBufferDescriptor: GfxIndexBufferDescriptor | null = null;

    constructor(name: string = '') {
        super(name);
        this.vertexData = new DataView(new ArrayBuffer(0x400));
        this.indexData = new Uint16Array(0x100);
    }

    protected ensureVertexBufferData(newByteSize: number): void {
        if (newByteSize > this.vertexData.byteLength) {
            assert(this.startIndex === 0);
            const newByteSizeAligned = align(newByteSize, this.vertexData.byteLength);
            const newBuffer = (this.vertexData.buffer as ArrayBuffer).transfer(newByteSizeAligned);
            this.vertexData = new DataView(newBuffer);
        }
    }

    protected ensureIndexBufferData(newSize: number): void {
        if (newSize > this.indexData.length) {
            assert(this.startIndex === 0);
            const newSizeAligned = align(newSize, this.indexData.length);
            const newBuffer = (this.indexData.buffer as ArrayBuffer).transfer(newSizeAligned * 2);
            this.indexData = new Uint16Array(newBuffer);
        }
    }

    public beginDraw(cache: GfxRenderCache): void {
        if (this.loadedVertexLayout === null)
            this.loadedVertexLayout = compileLoadedVertexLayout(this.vcd, this.useNBT);

        if (this.inputLayout === null)
            this.inputLayout = createInputLayout(cache, this.loadedVertexLayout);

        this.currentVertex = -1;
        this.currentIndex = 0;
        this.startIndex = 0;

        this.vertexBufferDescriptor = null;
        this.indexBufferDescriptor = null;
    }

    private flushDeviceObjects(cache: GfxRenderCache): void {
        if (this.vertexBufferDescriptor === null)
            this.vertexBufferDescriptor = cache.dynamicBufferCache.allocateSize(GfxBufferUsage.Vertex, this.vertexData.byteLength);
        if (this.indexBufferDescriptor === null)
            this.indexBufferDescriptor = cache.dynamicBufferCache.allocateSize(GfxBufferUsage.Index, this.indexData.byteLength);
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.setVertexInput(this.inputLayout, [this.vertexBufferDescriptor], this.indexBufferDescriptor);
        renderInst.setDrawCount(this.currentIndex - this.startIndex, this.startIndex);
    }

    public hasIndicesToDraw(): boolean {
        return this.currentIndex > this.startIndex;
    }

    public makeRenderInst(renderInstManager: GfxRenderInstManager): GfxRenderInst {
        this.flushDeviceObjects(renderInstManager.gfxRenderCache);
        const renderInst = renderInstManager.newRenderInst();
        this.setOnRenderInst(renderInst);
        this.startIndex = this.currentIndex;
        return renderInst;
    }

    public endDraw(renderInstManager: GfxRenderInstManager): void {
        const cache = renderInstManager.gfxRenderCache, device = cache.device;
        this.flushDeviceObjects(renderInstManager.gfxRenderCache);
        device.uploadBufferData(this.vertexBufferDescriptor!.buffer, this.vertexBufferDescriptor!.byteOffset!, new Uint8Array(this.vertexData.buffer));
        device.uploadBufferData(this.indexBufferDescriptor!.buffer, this.indexBufferDescriptor!.byteOffset!, new Uint8Array(this.indexData.buffer));
    }

    public endDrawAndMakeRenderInst(renderInstManager: GfxRenderInstManager): GfxRenderInst {
        this.endDraw(renderInstManager);
        return this.makeRenderInst(renderInstManager);
    }

    public destroy(device: GfxDevice): void {
    }
}

// Static Draw helper for places where we might want to make TDDraw into a buffer
// that does not change very much.
export class TSDraw extends TDDrawBase {
    private vertexBuffer: GfxBuffer | null = null;
    private indexBuffer: GfxBuffer | null = null;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [];
    private indexBufferDescriptor: GfxIndexBufferDescriptor;

    constructor(name: string = '') {
        super(name);
        this.vertexData = new DataView(new ArrayBuffer(0x400));
        this.indexData = new Uint16Array(0x100);
    }

    protected ensureVertexBufferData(newByteSize: number): void {
        if (newByteSize > this.vertexData.byteLength) {
            const newByteSizeAligned = align(newByteSize, this.vertexData.byteLength);
            const newBuffer = (this.vertexData.buffer as ArrayBuffer).transfer(newByteSizeAligned);
            this.vertexData = new DataView(newBuffer);
        }
    }

    protected ensureIndexBufferData(newSize: number): void {
        if (newSize > this.indexData.length) {
            const newSizeAligned = align(newSize, this.indexData.byteLength);
            const newBuffer = (this.indexData.buffer as ArrayBuffer).transfer(newSizeAligned * 2);
            this.indexData = new Uint16Array(newBuffer);
        }
    }

    public beginDraw(cache: GfxRenderCache): void {
        assert(this.vertexBuffer === null);
        assert(this.indexBuffer === null);
        assert(this.loadedVertexLayout === null);
        this.loadedVertexLayout = compileLoadedVertexLayout(this.vcd, this.useNBT);
        this.inputLayout = createInputLayout(cache, this.loadedVertexLayout!);

        this.currentVertex = -1;
        this.currentIndex = 0;
    }

    private flushDeviceObjects(cache: GfxRenderCache): void {
        const device = cache.device;
        this.vertexBuffer = device.createBuffer(this.vertexData.byteLength, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static);
        device.setResourceName(this.vertexBuffer, `TSDraw ${this.name}`);
        this.vertexBufferDescriptors[0] = { buffer: this.vertexBuffer };
        this.indexBuffer = device.createBuffer(this.indexData.byteLength, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static);
        device.setResourceName(this.indexBuffer, `TSDraw ${this.name} (IB)`);
        this.indexBufferDescriptor = { buffer: this.indexBuffer };
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        renderInst.setDrawCount(this.currentIndex);
    }

    public endDraw(cache: GfxRenderCache): void {
        const device = cache.device;
        this.flushDeviceObjects(cache);
        device.uploadBufferData(this.vertexBuffer!, 0, new Uint8Array(this.vertexData.buffer));
        device.uploadBufferData(this.indexBuffer!, 0, new Uint8Array(this.indexData.buffer));
    }

    public destroy(device: GfxDevice): void {
        if (this.indexBuffer !== null)
            device.destroyBuffer(this.indexBuffer);
        if (this.vertexBuffer !== null)
            device.destroyBuffer(this.vertexBuffer);
    }
}
