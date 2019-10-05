import * as Viewer from "../viewer";
import * as rw from "librw";
// @ts-ignore
import { readFileSync } from "fs";
import { TextureHolder, LoadedTexture, TextureMapping, TextureBase } from "../TextureHolder";
import { GfxDevice, GfxFormat, GfxBufferUsage, GfxBuffer, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxInputLayout, GfxInputState, GfxVertexBufferDescriptor, GfxBindingLayoutDescriptor, GfxProgram, GfxHostAccessPass, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxTextureDimension, GfxRenderPass, GfxMegaStateDescriptor, GfxBlendMode, GfxBlendFactor } from "../gfx/platform/GfxPlatform";
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram } from "../Program";
import { convertToTriangleIndexBuffer, filterDegenerateTriangleIndexBuffer, GfxTopology } from "../gfx/helpers/TopologyHelpers";
import { fillMatrix4x3, fillMatrix4x4, fillColor } from "../gfx/helpers/UniformBufferHelpers";
import { mat4, quat } from "gl-matrix";
import { computeViewMatrix, Camera } from "../Camera";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { nArray, assertExists } from "../util";
import { BasicRenderTarget, makeClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { GfxRenderInstManager, GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderer";
import { ItemInstance, ObjectDefinition, ObjectFlags } from "./item";
import { Color, colorNew } from "../Color";

export class RWTexture implements TextureBase {
    private texture: rw.Texture;
    image: rw.Image | null;
    name: string;
    width: number;
    height: number;
    constructor(texture: rw.Texture) {
        this.texture = texture;
        this.image = texture.raster.toImage();
        this.image.unindex();
        this.name = this.texture.name.toLowerCase();
        this.width = this.image.width;
        this.height = this.image.height;
    }
    destroy() {
        if (this.image) this.image.delete();
    }
}

export class RWTextureHolder extends TextureHolder<RWTexture> {
    private textures: RWTexture[] = [];

    public findTexture(name: string): RWTexture {
        return assertExists(this.textures.find((t) => t.name === name));
    }

    public addTXD(device: GfxDevice, txd: rw.TexDictionary) {
        for (let lnk = txd.textures.begin; !lnk.is(txd.textures.end); lnk = lnk.next) {
            this.addTextures(device, [new RWTexture(rw.Texture.fromDict(lnk))]);
        }
    }

    public loadTexture(device: GfxDevice, texture: RWTexture): LoadedTexture | null {
        const image = assertExists(texture.image);
        if (image.depth < 24) {
            console.error("16-bit texture", texture.name);
            return null;
        }
        const surfaces: HTMLCanvasElement[] = [];

        const canvas = document.createElement('canvas');
        canvas.width = texture.width;
        canvas.height = texture.height;

        const ctx = canvas.getContext('2d')!;
        const buf = ctx.createImageData(texture.width, texture.height);
        let pixels = assertExists(image.pixels);
        if (image.depth === 32) {
            buf.data.set(pixels);
        } else {
            for (let i = 0, j = 0; i < buf.data.length;) {
                buf.data[i++] = pixels[j++];
                buf.data[i++] = pixels[j++];
                buf.data[i++] = pixels[j++];
                buf.data[i++] = 0xff;
            }
        }
        ctx.putImageData(buf, 0, 0);
        surfaces.push(canvas);

        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D,
            pixelFormat: (image.depth === 32) ? GfxFormat.U8_RGBA : GfxFormat.U8_RGB,
            width: texture.width, height: texture.height, depth: 1, numLevels: 1
        });
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [pixels]);
        device.submitPass(hostAccessPass);

        const extraInfo = new Map<string, string>();
        extraInfo.set('Colour depth', image.depth + ' bits');
        const viewerTexture: Viewer.Texture = { name: texture.name, surfaces, extraInfo };

        image.delete();
        texture.image = null;
        this.textures.push(texture);

        return { gfxTexture, viewerTexture };
    }
}

class GTA3Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_MeshFragParams = 1;

    private static program = readFileSync('src/GrandTheftAuto3/program.glsl', { encoding: 'utf8' });
    public both = GTA3Program.program;
}

class MeshFragData {
    private idxBuffer: GfxBuffer;
    public inputState: GfxInputState;
    public indexCount: number;

    public gfxSamplers: GfxSampler[] = [];
    public program: GTA3Program;
    public textureMapping = nArray(1, () => new TextureMapping());
    public baseColor: Color = colorNew(1,1,1,1);
    public transparent = false;

    constructor(device: GfxDevice, textureHolder: RWTextureHolder, header: rw.MeshHeader, mesh: rw.Mesh, public parent: MeshData) {
        const triIdxData = convertToTriangleIndexBuffer(header.tristrip ? GfxTopology.TRISTRIP : GfxTopology.TRIANGLES, assertExists(mesh.indices));
        const idxData = filterDegenerateTriangleIndexBuffer(triIdxData);
        this.idxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, idxData.buffer);
        this.indexCount = idxData.length;

        const idxBuffer: GfxVertexBufferDescriptor = { buffer: this.idxBuffer, byteStride: 0, byteOffset: 0 };
        this.inputState = device.createInputState(this.parent.inputLayout, this.parent.buffers, idxBuffer);

        this.program = new GTA3Program();

        const col = mesh.material.color;
        if (col) this.baseColor = colorNew(col[0]/0xff, col[1]/0xff, col[2]/0xff, col[3]/0xff);
        if (this.baseColor.a < 1) this.transparent = true;

        const texture = mesh.material.texture;
        if (texture) {
            const texName = texture.name.toLowerCase();
            if (!textureHolder.hasTexture(texName)) {
                console.warn('Missing texture', texName);
                return;
            }
            const textureMapping = this.textureMapping[0];
            textureHolder.fillTextureMapping(textureMapping, texName);

            if (rw.Raster.formatHasAlpha(texture.raster.format)) this.transparent = true;

            this.program.defines.set('USE_TEXTURE', '1');

            const addressConvMap = [GfxWrapMode.REPEAT, GfxWrapMode.MIRROR, GfxWrapMode.CLAMP, GfxWrapMode.CLAMP];
            const gfxSampler = device.createSampler({
                magFilter: GfxTexFilterMode.BILINEAR,
                minFilter: GfxTexFilterMode.BILINEAR,
                mipFilter: (texture.filter % 2) ? GfxMipFilterMode.NEAREST : GfxMipFilterMode.LINEAR,
                minLOD: 0,
                maxLOD: 1000,
                wrapS: addressConvMap[texture.addressU - 1],
                wrapT: addressConvMap[texture.addressV - 1],
            });
            this.gfxSamplers.push(gfxSampler);

            textureMapping.gfxSampler = gfxSampler;
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.idxBuffer);
        device.destroyInputState(this.inputState);
        for (let i = 0; i < this.gfxSamplers.length; i++)
            device.destroySampler(this.gfxSamplers[i]);
    }
}

class MeshData {
    private posBuffer: GfxBuffer;
    private colorBuffer: GfxBuffer | null;
    private uvBuffer: GfxBuffer | null;
    public inputLayout: GfxInputLayout;
    public buffers: (GfxVertexBufferDescriptor | null)[];
    public meshFragData: MeshFragData[] = [];

    constructor(device: GfxDevice, textureHolder: RWTextureHolder, atomic: rw.Atomic, public obj: ObjectDefinition) {
        let geom = atomic.geometry;

        let positions = assertExists(geom.morphTarget(0).vertices);
        this.posBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.VERTEX,
            new ArrayBufferSlice(positions.buffer, positions.byteOffset, positions.byteLength));

        let normals = geom.morphTarget(0).normals;
        if (normals) {
            // TODO
        }

        if (geom.numTexCoordSets) {
            let texCoords = geom.texCoords(0)!;
            this.uvBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.VERTEX,
                new ArrayBufferSlice(texCoords.buffer, texCoords.byteOffset, texCoords.byteLength));
        } else {
            this.uvBuffer = null;
        }

        let colors = geom.colors;
        if (colors) {
            this.colorBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.VERTEX,
                new ArrayBufferSlice(colors.buffer, colors.byteOffset, colors.byteLength));
        } else {
            this.colorBuffer = null;
        }

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: GTA3Program.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: GTA3Program.a_Color, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.U8_RGBA_NORM, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: GTA3Program.a_TexCoord, bufferIndex: 2, bufferByteOffset: 0, format: GfxFormat.F32_RG, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
        ];

        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });
        this.buffers = [
            { buffer: this.posBuffer, byteStride: 12, byteOffset: 0 },
            this.colorBuffer ? { buffer: this.colorBuffer, byteStride: 4, byteOffset: 0 } : null,
            this.uvBuffer    ? { buffer: this.uvBuffer, byteStride: 8, byteOffset: 0 } : null,
        ];

        let h = geom.meshHeader;
        for (let i = 0; i < h.numMeshes; i++) {
            const frag = new MeshFragData(device, textureHolder, h, h.mesh(i), this);
            if (atomic.geometry.colors !== null)
                frag.program.defines.set('USE_VERTEX_COLOR', '1');
            this.meshFragData.push(frag);
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.posBuffer);
        if (this.colorBuffer !== null)
            device.destroyBuffer(this.colorBuffer);
        if (this.uvBuffer !== null)
            device.destroyBuffer(this.uvBuffer);
        device.destroyInputLayout(this.inputLayout);
        for (let i = 0; i < this.meshFragData.length; i++)
            this.meshFragData[i].destroy(device);
    }
}

class DomainData {
    public meshData = new Map<string, MeshData>();

    public addModel(device: GfxDevice, textureHolder: RWTextureHolder, modelName: string, model: rw.Clump, obj: ObjectDefinition) {
        let node = null;
        for (let lnk = model.atomics.begin; !lnk.is(model.atomics.end); lnk = lnk.next) {
            const atomic = rw.Atomic.fromClump(lnk);
            const atomicName = atomic.frame.name.toLowerCase();
            if (node === null || atomicName.endsWith('_l0')) {
                // only use the unbroken variant of breakable objects
                node = atomic;
            }
        }
        this.meshData.set(modelName, new MeshData(device, textureHolder, assertExists(node), obj));
    }

    public destroy(device: GfxDevice): void {
        for (const meshData of this.meshData.values())
            meshData.destroy(device);
    }
}

const scratchMat4 = mat4.create();
class MeshFragInstance {
    private gfxProgram: GfxProgram | null = null;
    public megaStateFlags: Partial<GfxMegaStateDescriptor> = {
        blendMode: GfxBlendMode.ADD,
        blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
    };
    public layer = GfxRendererLayer.OPAQUE;

    constructor(public meshFragData: MeshFragData) {
        if (this.meshFragData.transparent) this.layer &= GfxRendererLayer.TRANSLUCENT;
    }

    private computeModelMatrix(camera: Camera, modelMatrix: mat4): mat4 {
        computeViewMatrix(scratchMat4, camera);
        mat4.mul(scratchMat4, scratchMat4, modelMatrix);
        return scratchMat4;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelMatrix: mat4, viewRenderer: Viewer.ViewerRenderInput) {
        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setInputLayoutAndState(this.meshFragData.parent.inputLayout, this.meshFragData.inputState);
        renderInst.drawIndexes(this.meshFragData.indexCount);

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.meshFragData.program);

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.setSamplerBindingsFromTextureMappings(this.meshFragData.textureMapping);
        renderInst.sortKey = makeSortKey(this.layer);

        let offs = renderInst.allocateUniformBuffer(GTA3Program.ub_MeshFragParams, 12 + 4);
        const mapped = renderInst.mapUniformBufferF32(GTA3Program.ub_MeshFragParams);
        offs += fillMatrix4x3(mapped, offs, this.computeModelMatrix(viewRenderer.camera, modelMatrix));
        offs += fillColor(mapped, offs, this.meshFragData.baseColor);
    }
}

class MeshInstance {
    private meshFragInstance: MeshFragInstance[] = [];
    public modelMatrix = mat4.create();

    constructor(public meshData: MeshData, public item: ItemInstance) {
        mat4.fromRotationTranslationScale(this.modelMatrix, this.item.rotation, this.item.translation, this.item.scale);
        mat4.fromQuat(scratchMat4, quat.fromValues(0.5, 0.5, 0.5, -0.5)); // convert Z-up to Y-up
        mat4.multiply(this.modelMatrix, scratchMat4, this.modelMatrix);
        for (let i = 0; i < this.meshData.meshFragData.length; i++) {
            const frag = new MeshFragInstance(this.meshData.meshFragData[i]);
            if (meshData.obj.flags & ObjectFlags.NO_ZBUFFER_WRITE) {
                frag.megaStateFlags.depthWrite = false;
                frag.layer += 1;
            } else if (meshData.obj.flags & ObjectFlags.DRAW_LAST) {
                frag.layer += 2;
            }
            this.meshFragInstance[i] = frag;
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.meshFragInstance.length; i++)
            this.meshFragInstance[i].prepareToRender(device, renderInstManager, this.modelMatrix, viewerInput);
    }
}

class DomainInstance {
    public meshInstance: MeshInstance[] = [];

    constructor(public domainData: DomainData) {}

    addItem(item: ItemInstance) {
        const model = this.domainData.meshData.get(item.modelName);
        this.meshInstance.push(new MeshInstance(assertExists(model), item));
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.meshInstance.length; i++)
            this.meshInstance[i].prepareToRender(device, renderInstManager, viewerInput);
    }
}

function fillSceneParamsData(d: Float32Array, camera: Camera, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1 },
];
export class SceneRenderer {
    private domainData = new DomainData();
    private domainInstance = new DomainInstance(this.domainData);

    public addModel(device: GfxDevice, textureHolder: RWTextureHolder, modelName: string, model: rw.Clump, obj: ObjectDefinition) {
        this.domainData.addModel(device, textureHolder, modelName, model, obj);
    }

    public addItem(item: ItemInstance) {
        this.domainInstance.addItem(item);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(GTA3Program.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(GTA3Program.ub_SceneParams);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, offs);

        this.domainInstance.prepareToRender(device, renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.domainData.destroy(device);
    }
}

export class GTA3Renderer {
    public renderTarget = new BasicRenderTarget();
    public clearRenderPassDescriptor = makeClearRenderPassDescriptor(true, colorNew(0.1, 0.1, 0.1, 0.0));

    public textureHolder = new RWTextureHolder();
    public sceneRenderers: SceneRenderer[] = [];

    private renderHelper: GfxRenderHelper;

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public addSceneRenderer(sceneRenderer: SceneRenderer): void {
        this.sceneRenderers.push(sceneRenderer);
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(1);
        this.renderHelper.pushTemplateRenderInst();
        for (let i = 0; i < this.sceneRenderers.length; i++)
            this.sceneRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        const finalPassRenderer = this.renderTarget.createRenderPass(device, this.clearRenderPassDescriptor);
        finalPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.renderHelper.renderInstManager.drawOnPassRenderer(device, finalPassRenderer);

        this.renderHelper.renderInstManager.resetRenderInsts();

        return finalPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
        this.textureHolder.destroy(device);
        for (let i = 0; i < this.sceneRenderers.length; i++)
            this.sceneRenderers[i].destroy(device);
    }
}
