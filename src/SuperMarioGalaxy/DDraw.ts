
// Dynamic Draw
// A helper for all those times that Galaxy just writes triangles raw.

import * as GX from '../gx/gx_enum';
import { GX_VtxDesc, GX_VtxAttrFmt, compileLoadedVertexLayout, LoadedVertexLayout } from '../gx/gx_displaylist';
import { assert, assertExists } from '../util';
import { GfxRenderInstManager, GfxRenderInst } from '../gfx/render/GfxRenderer';
import { GfxDevice, GfxInputLayout, GfxInputState, GfxIndexBufferDescriptor, GfxVertexBufferDescriptor, GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint } from '../gfx/platform/GfxPlatform';
import { createInputLayout } from '../gx/gx_render';
import { getTriangleIndexCountForTopologyIndexCount, GfxTopology, convertToTrianglesRange } from '../gfx/helpers/TopologyHelpers';
import { getSystemEndianness, Endianness } from '../endian';
import { vec3 } from 'gl-matrix';
import { Color } from '../Color';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';

function getGfxToplogyFromCommand(cmd: GX.Command): GfxTopology {
    if (cmd === GX.Command.DRAW_QUADS)
        return GfxTopology.QUADS;
    else if (cmd === GX.Command.DRAW_TRIANGLE_STRIP)
        return GfxTopology.TRISTRIP;
    else
        throw "whoops";
}

export class TDDrawVtxSpec {
    private vcd: GX_VtxDesc[] = [];
    private vat: GX_VtxAttrFmt[][] = [[]];
    protected loadedVertexLayout: LoadedVertexLayout | null = null;
    protected inputLayout: GfxInputLayout | null = null;

    constructor() {
        for (let i = GX.Attr.POS; i <= GX.Attr.TEX7; i++) {
            this.vcd[i] = { type: GX.AttrType.NONE };
            this.vat[0][i] = { compType: GX.CompType.F32, compShift: 0 } as GX_VtxAttrFmt;
        }
    }

    public setVtxDesc(attr: GX.Attr, enabled: boolean): void {
        const vcd = assertExists(this.vcd[attr]);

        const type = enabled ? GX.AttrType.DIRECT : GX.AttrType.NONE;
        if (vcd.type !== type) {
            vcd.type = type;
            this.dirtyInputLayout();
        }
    }

    public setVtxAttrFmt(fmt: GX.VtxFmt, attr: GX.Attr, cnt: GX.CompCnt): void {
        assert(fmt === 0);
        const vf = assertExists(this.vat[fmt][attr]);

        if (vf.compCnt !== cnt) {
            vf.compCnt = cnt;
            this.dirtyInputLayout();
        }
    }

    private dirtyInputLayout(): void {
        this.loadedVertexLayout = null;
        this.inputLayout = null;
    }

    protected createLoadedVertexLayout(): void {
        if (this.loadedVertexLayout === null)
            this.loadedVertexLayout = compileLoadedVertexLayout(this.vat, this.vcd);
    }

    protected createInputLayoutInternal(device: GfxDevice, cache: GfxRenderCache): boolean {
        if (this.inputLayout === null) {
            this.inputLayout = createInputLayout(device, cache, this.loadedVertexLayout!, false);
            return true;
        } else {
            return false;
        }
    }

    public createInputLayout(device: GfxDevice, cache: GfxRenderCache): void {
        this.createLoadedVertexLayout();
        this.createInputLayoutInternal(device, cache);
    }
}

export class TDDraw extends TDDrawVtxSpec {
    private inputState: GfxInputState | null = null;
    private vertexBuffer: GfxBuffer | null = null;
    private indexBuffer: GfxBuffer | null = null;
    private recreateVertexBuffer: boolean = true;
    private recreateIndexBuffer: boolean = true;

    // Global information
    private currentVertex: number;
    private currentIndex: number;
    private startIndex: number;
    private indexData: Uint16Array;
    private vertexData: DataView;

    // Current primitive information
    private currentPrimVertex: number;
    private currentPrim: GX.Command;

    constructor() {
        super();
        this.vertexData = new DataView(new ArrayBuffer(0x400));
        this.indexData = new Uint16Array(0x100);
    }

    private ensureVertexBufferData(newByteSize: number): void {
        if (newByteSize > this.vertexData.byteLength) {
            const newBuffer = new Uint8Array(this.vertexData.byteLength * 2);
            newBuffer.set(new Uint8Array(this.vertexData.buffer));
            this.vertexData = new DataView(newBuffer.buffer);
        }
    }

    private ensureIndexBufferData(newSize: number): void {
        if (newSize > this.indexData.length) {
            const newData = new Uint16Array(this.indexData.length * 2);
            newData.set(this.indexData);
            this.indexData = newData;
        }
    }

    private getOffs(v: number, attr: GX.Attr): number {
        const stride = this.loadedVertexLayout!.vertexBufferStrides[0];
        for (let i = 0; i < this.loadedVertexLayout!.vertexAttributeLayouts.length; i++)
            if (this.loadedVertexLayout!.vertexAttributeLayouts[i].vtxAttrib === attr)
                return v*stride + this.loadedVertexLayout!.vertexAttributeLayouts[i].bufferOffset;
        throw "whoops";
    }

    private writeUint8(offs: number, v: number): void {
        this.vertexData.setUint8(offs, v);
    }

    private writeFloat32(offs: number, v: number): void {
        const e = (getSystemEndianness() === Endianness.LITTLE_ENDIAN);
        this.vertexData.setFloat32(offs, v, e);
    }

    public beginDraw(): void {
        this.createLoadedVertexLayout();

        this.currentVertex = -1;
        this.currentIndex = 0;
        this.startIndex = 0;
    }

    public allocVertices(num: number): void {
        const vertexCount = this.currentVertex + 1 + num;
        const stride = this.loadedVertexLayout!.vertexBufferStrides[0];
        this.ensureVertexBufferData(vertexCount * stride);
    }

    public begin(type: GX.Command): void {
        this.currentPrim = type;
        this.currentPrimVertex = -1;
    }

    public position3f32(x: number, y: number, z: number): void {
        // TODO(jstpierre): Verify

        ++this.currentVertex;
        ++this.currentPrimVertex;
        this.allocVertices(0);

        const offs = this.getOffs(this.currentVertex, GX.Attr.POS);
        this.writeFloat32(offs + 0x00, x);
        this.writeFloat32(offs + 0x04, y);
        this.writeFloat32(offs + 0x08, z);
    }

    public position3vec3(v: vec3): void {
        this.position3f32(v[0], v[1], v[2]);
    }

    public texCoord2f32(attr: GX.Attr, s: number, t: number): void {
        const offs = this.getOffs(this.currentVertex, attr);
        this.writeFloat32(offs + 0x00, s);
        this.writeFloat32(offs + 0x04, t);
    }

    public color4rgba8(attr: GX.Attr, r: number, g: number, b: number, a: number): void {
        const offs = this.getOffs(this.currentVertex, attr);
        this.writeUint8(offs + 0x00, r);
        this.writeUint8(offs + 0x01, g);
        this.writeUint8(offs + 0x02, b);
        this.writeUint8(offs + 0x03, a);
    }

    public color4color(attr: GX.Attr, c: Color): void {
        this.color4rgba8(attr, c.r * 0xFF, c.g * 0xFF, c.b * 0xFF, c.a * 0xFF);
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

    private flushDeviceObjects(device: GfxDevice, cache: GfxRenderCache): void {
        let recreateInputState = false;

        if (this.createInputLayoutInternal(device, cache)) {
            recreateInputState = true;
        }

        if (this.recreateVertexBuffer) {
            if (this.vertexBuffer !== null)
                device.destroyBuffer(this.vertexBuffer);
            this.vertexBuffer = device.createBuffer((this.vertexData.byteLength + 3) >>> 2, GfxBufferUsage.VERTEX, GfxBufferFrequencyHint.DYNAMIC);
            this.recreateVertexBuffer = false;
            recreateInputState = true;
        }

        if (this.recreateIndexBuffer) {
            if (this.indexBuffer !== null)
                device.destroyBuffer(this.indexBuffer);
            this.indexBuffer = device.createBuffer((this.indexData.byteLength + 3) >>> 2, GfxBufferUsage.INDEX, GfxBufferFrequencyHint.DYNAMIC);
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

    public makeRenderInst(device: GfxDevice, renderInstManager: GfxRenderInstManager): GfxRenderInst {
        this.flushDeviceObjects(device, renderInstManager.gfxRenderCache);
        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(this.currentIndex - this.startIndex, this.startIndex);
        this.startIndex = this.currentIndex;
        return renderInst;
    }

    public endAndUpload(device: GfxDevice, renderInstManager: GfxRenderInstManager): void {
        this.flushDeviceObjects(device, renderInstManager.gfxRenderCache);
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadBufferData(this.vertexBuffer!, 0, new Uint8Array(this.vertexData.buffer));
        hostAccessPass.uploadBufferData(this.indexBuffer!, 0, new Uint8Array(this.indexData.buffer));
        device.submitPass(hostAccessPass);
    }

    public endDraw(device: GfxDevice, renderInstManager: GfxRenderInstManager): GfxRenderInst {
        this.endAndUpload(device, renderInstManager);
        return this.makeRenderInst(device, renderInstManager);
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
