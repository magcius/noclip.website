
import * as UI from "../ui";
import * as Viewer from "../viewer";
import * as rw from "librw";
// @ts-ignore
import { readFileSync } from "fs";
import { TextureMapping, TextureBase } from "../TextureHolder";
import { GfxDevice, GfxFormat, GfxBufferUsage, GfxBuffer, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxInputLayout, GfxInputState, GfxProgram, GfxHostAccessPass, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxTextureDimension, GfxRenderPass, GfxMegaStateDescriptor, GfxBlendMode, GfxBlendFactor, GfxBindingLayoutDescriptor } from "../gfx/platform/GfxPlatform";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram } from "../Program";
import { convertToTriangleIndexBuffer, filterDegenerateTriangleIndexBuffer, GfxTopology } from "../gfx/helpers/TopologyHelpers";
import { fillMatrix4x3, fillMatrix4x4, fillColor } from "../gfx/helpers/UniformBufferHelpers";
import { mat4, quat, vec3, vec2 } from "gl-matrix";
import { computeViewSpaceDepthFromWorldSpaceAABB } from "../Camera";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { assert } from "../util";
import { BasicRenderTarget, makeClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { GfxRenderInstManager, GfxRendererLayer, makeSortKey, setSortKeyDepth, GfxRenderInst } from "../gfx/render/GfxRenderer";
import { ItemInstance, ObjectDefinition } from "./item";
import { colorNew, White, colorNewCopy, colorLerp, colorMult, Color } from "../Color";
import { ColorSet } from "./time";
import { AABB } from "../Geometry";

const TIME_FACTOR = 2500; // one day cycle per minute

export class Texture implements TextureBase {
    public name: string;
    public format: number;
    public width: number;
    public height: number;
    public depth: number;
    public pixels: Uint8Array;

    constructor(texture: rw.Texture, txdName: string) {
        this.name = txdName + '/' + texture.name.toLowerCase();
        this.format = texture.raster.format;
        const image = texture.raster.toImage();
        image.unindex();
        this.width = image.width;
        this.height = image.height;
        this.depth = image.depth;
        this.pixels = image.pixels!.slice();
        image.delete();
    }
}

function halve(pixels: Uint8Array, width: number, height: number): Uint8Array {
    const halved = new Uint8Array(width * height);
    for (let y = 0; y < height/2; y++) {
        for (let x = 0; x < width/2; x++) {
            for (let i = 0; i < 4; i++) {
                halved[4 * (x + y * width/2) + i] =
                    ( pixels[4 * ((2*x+0) + (2*y+0) * width) + i]
                    + pixels[4 * ((2*x+1) + (2*y+0) * width) + i]
                    + pixels[4 * ((2*x+0) + (2*y+1) * width) + i]
                    + pixels[4 * ((2*x+1) + (2*y+1) * width) + i] ) / 4;
            }
        }
    }
    return halved;
}

export class TextureAtlas extends TextureMapping {
    public subimages = new Map<string, number>();

    constructor(device: GfxDevice, textures: Texture[]) {
        super();
        assert(textures.length > 0);
        const width = textures[0].width;
        const height = textures[0].height;
        for (let i = 0; i < textures.length; i++) {
            const texture = textures[i];
            assert(texture.width === width && texture.height === height);
            this.subimages.set(texture.name, i);
        }

        const pixels = new Uint8Array(4 * width * height * textures.length);
        let offs = 0;
        for (const texture of textures) {
            let srcOffs = 0;
            for (let y = 0; y < texture.height; y++) {
                for (let x = 0; x < texture.width; x++) {
                    pixels[offs++] = texture.pixels[srcOffs++];
                    pixels[offs++] = texture.pixels[srcOffs++];
                    pixels[offs++] = texture.pixels[srcOffs++];
                    if (texture.depth === 32) {
                        pixels[offs++] = texture.pixels[srcOffs++];
                    } else {
                        pixels[offs++] = 0xFF;
                    }
                }
            }
        }

        const mipmaps = [pixels];
        let mip = pixels;
        let w = width;
        let h = height;
        while (w > 1) {
            mip = halve(mip, w, h * textures.length);
            mipmaps.push(mip);
            w = Math.max((w / 2) | 0, 1);
            h = Math.max((h / 2) | 0, 1);
        }

        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D_ARRAY, pixelFormat: GfxFormat.U8_RGBA,
            width, height, depth: textures.length, numLevels: mipmaps.length
        });
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, mipmaps);
        device.submitPass(hostAccessPass);

        this.gfxTexture = gfxTexture;
        this.width = width;
        this.height = height;
        this.flipY = false;

        this.gfxSampler = device.createSampler({
            magFilter: GfxTexFilterMode.BILINEAR,
            minFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.LINEAR,
            minLOD: 0,
            maxLOD: 1000,
            wrapS: GfxWrapMode.REPEAT,
            wrapT: GfxWrapMode.REPEAT,
        });
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxSampler !== null)
            device.destroySampler(this.gfxSampler);
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

const mainProgram = new GTA3Program();
const skyProgram = new GTA3Program();
skyProgram.defines.set('SKY', '1');

class Renderer {
    protected vertexBuffer: GfxBuffer;
    protected indexBuffer: GfxBuffer;
    protected inputLayout: GfxInputLayout;
    protected inputState: GfxInputState;
    protected megaStateFlags: Partial<GfxMegaStateDescriptor>;
    protected gfxProgram?: GfxProgram;

    protected indices: number;

    constructor(protected program: DeviceProgram, protected atlas?: TextureAtlas) {}

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): GfxRenderInst | undefined {
        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(this.indices);

        if (this.gfxProgram === undefined)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        if (this.atlas !== undefined)
            renderInst.setSamplerBindingsFromTextureMappings([this.atlas]);
        return renderInst;
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        if (this.gfxProgram !== undefined)
            device.destroyProgram(this.gfxProgram);
        if (this.atlas !== undefined)
            this.atlas.destroy(device);
    }
}

export class SkyRenderer extends Renderer {
    constructor(device: GfxDevice, atlas?: TextureAtlas) {
        super(skyProgram, atlas);
        // fullscreen quad
        const vbuf = new Float32Array([
            -1, -1, 1,
            -1,  1, 1,
             1,  1, 1,
             1, -1, 1,
        ]);
        const ibuf = new Uint16Array([0,1,2,0,2,3]);
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vbuf.buffer);
        this.indexBuffer  = makeStaticDataBuffer(device, GfxBufferUsage.INDEX,  ibuf.buffer);
        this.indices = ibuf.length;
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: GTA3Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 * 0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
        ];
        this.inputLayout = device.createInputLayout({ indexBufferFormat: GfxFormat.U16_R, vertexAttributeDescriptors });
        const buffers = [{ buffer: this.vertexBuffer, byteOffset: 0, byteStride: 3 * 0x04}];
        const indexBuffer = { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, indexBuffer);
        this.megaStateFlags = { depthWrite: false };
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): undefined {
        if (viewerInput.camera.isOrthographic) return;
        const renderInst = super.prepareToRender(device, renderInstManager, viewerInput)!;
        renderInst.sortKey = makeSortKey(GfxRendererLayer.BACKGROUND);
        let offs = renderInst.allocateUniformBuffer(GTA3Program.ub_MeshFragParams, 12 + 12 + 4);
        const mapped = renderInst.mapUniformBufferF32(GTA3Program.ub_MeshFragParams);
        offs += fillMatrix4x3(mapped, offs, viewerInput.camera.viewMatrix);
        offs += fillMatrix4x3(mapped, offs, viewerInput.camera.worldMatrix);
        mapped[offs++] = viewerInput.camera.frustum.right;
        mapped[offs++] = viewerInput.camera.frustum.top;
        mapped[offs++] = viewerInput.camera.frustum.near;
        mapped[offs++] = viewerInput.camera.frustum.far;
        return;
    }
}

export interface MeshFragData {
    indices: Uint16Array;
    vertices: number;
    texName?: string;
    position(vertex: number): vec3;
    color(vertex: number): Color;
    texCoord(vertex: number): vec2;
}

class RWMeshFragData implements MeshFragData {
    public indices: Uint16Array;
    public texName?: string;

    private baseColor = colorNewCopy(White);
    private indexMap: number[];

    constructor(mesh: rw.Mesh, tristrip: boolean, txdName: string,
                private positions: Float32Array, private texCoords: Float32Array | null, private colors: Uint8Array | null) {
        const texture = mesh.material.texture;
        if (texture)
            this.texName = txdName + '/' + texture.name.toLowerCase();

        const col = mesh.material.color;
        if (col)
            this.baseColor = colorNew(col[0] / 0xFF, col[1] / 0xFF, col[2] / 0xFF, col[3] / 0xFF);

        this.indexMap = Array.from(new Set(mesh.indices)).sort();

        this.indices = filterDegenerateTriangleIndexBuffer(convertToTriangleIndexBuffer(
            tristrip ? GfxTopology.TRISTRIP : GfxTopology.TRIANGLES,
            mesh.indices!.map(index => this.indexMap.indexOf(index))));
    }

    public get vertices() {
        return this.indexMap.length;
    }

    public position(index: number) {
        const i = this.indexMap[index];
        return vec3.fromValues(this.positions[3*i+0], this.positions[3*i+1], this.positions[3*i+2]);
    }

    public color(index: number) {
        const i = this.indexMap[index];
        const color = colorNewCopy(this.baseColor);
        if (this.colors !== null)
            colorMult(color, color, colorNew(this.colors[4*i+0]/0xFF, this.colors[4*i+1]/0xFF, this.colors[4*i+2]/0xFF, this.colors[4*i+3]/0xFF));
        return color;
    }

    public texCoord(index: number) {
        const i = this.indexMap[index];
        const texCoord = vec2.create();
        if (this.texCoords !== null) {
            texCoord[0] = this.texCoords[2*i+0]
            texCoord[1] = this.texCoords[2*i+1];
        }
        return texCoord;
    }
}

export class ModelCache {
    public meshData = new Map<string, MeshFragData[]>();

    private addAtomic(atomic: rw.Atomic, obj: ObjectDefinition) {
        const geom = atomic.geometry;
        const positions = geom.morphTarget(0).vertices!.slice();
        const texCoords = (geom.numTexCoordSets > 0) ? geom.texCoords(0)!.slice() : null;
        const colors = (geom.colors !== null) ? geom.colors.slice() : null;
        const h = geom.meshHeader;
        const frags: MeshFragData[] = [];
        for (let i = 0; i < h.numMeshes; i++) {
            const frag = new RWMeshFragData(h.mesh(i), h.tristrip, obj.txdName, positions, texCoords, colors);
            frags.push(frag);
        }
        this.meshData.set(obj.modelName, frags);
    }

    public addModel(model: rw.Clump, obj: ObjectDefinition) {
        let node: rw.Atomic | null = null;
        for (let lnk = model.atomics.begin; !lnk.is(model.atomics.end); lnk = lnk.next) {
            const atomic = rw.Atomic.fromClump(lnk);
            const atomicName = atomic.frame.name.toLowerCase();
            if (node === null || atomicName.endsWith('_l0')) {
                // only use the unbroken variant of breakable objects
                node = atomic;
            }
        }
        if (node !== null)
            this.addAtomic(node, obj);
    }
}

export class MeshInstance {
    public modelMatrix = mat4.create();

    constructor(public frags: MeshFragData[], public item: ItemInstance) {
        mat4.fromRotationTranslationScale(this.modelMatrix, this.item.rotation, this.item.translation, this.item.scale);
        // convert Z-up to Y-up
        mat4.multiply(this.modelMatrix, mat4.fromQuat(mat4.create(), quat.fromValues(0.5, 0.5, 0.5, -0.5)), this.modelMatrix);
    }
}

export class DrawKey {
    public renderLayer: GfxRendererLayer = GfxRendererLayer.OPAQUE;
    public drawDistance?: number;
    public timeOn?: number;
    public timeOff?: number;

    constructor(obj: ObjectDefinition, public zone: string) {
        if (obj.drawDistance < 99) {
            this.drawDistance = 99;
        }
        if (obj.tobj) {
            this.timeOn = obj.timeOn;
            this.timeOff = obj.timeOff;
        }
    }
}

export class SceneRenderer extends Renderer {
    public bbox = new AABB();

    constructor(device: GfxDevice, public key: DrawKey, meshes: MeshInstance[], atlas?: TextureAtlas) {
        super(mainProgram, atlas);
        const skipFrag = (frag: MeshFragData) =>
            atlas !== undefined && frag.texName !== undefined && !atlas.subimages.has(frag.texName);

        let vertices = 0;
        this.indices = 0;
        for (const inst of meshes) {
            for (const frag of inst.frags) {
                if (skipFrag(frag)) continue;
                vertices += frag.vertices;
                this.indices += frag.indices.length;
            }
        }

        const points = [] as vec3[];
        const vbuf = new Float32Array(vertices * 10);
        const ibuf = new Uint32Array(this.indices);
        let voffs = 0;
        let ioffs = 0;
        let lastIndex = 0;
        for (const inst of meshes) {
            for (const frag of inst.frags) {
                if (skipFrag(frag)) continue;
                const n = frag.vertices;
                const texLayer = (frag.texName === undefined || atlas === undefined) ? undefined : atlas.subimages.get(frag.texName);
                for (let i = 0; i < n; i++) {
                    const pos = vec3.transformMat4(vec3.create(), frag.position(i), inst.modelMatrix);
                    points.push(pos);
                    vbuf[voffs++] = pos[0];
                    vbuf[voffs++] = pos[1];
                    vbuf[voffs++] = pos[2];
                    voffs += fillColor(vbuf, voffs, frag.color(i));
                    const texCoord = frag.texCoord(i);
                    vbuf[voffs++] = texCoord[0];
                    vbuf[voffs++] = texCoord[1];
                    if (texLayer === undefined) {
                        vbuf[voffs++] = -1;
                    } else {
                        vbuf[voffs++] = texLayer;
                    }
                }
                for (const index of frag.indices) {
                    ibuf[ioffs++] = index + lastIndex;
                }
                lastIndex += n;
            }
        }

        this.bbox.set(points);
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vbuf.buffer);
        this.indexBuffer  = makeStaticDataBuffer(device, GfxBufferUsage.INDEX,  ibuf.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: GTA3Program.a_Position,    bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset: 0 * 0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: GTA3Program.a_Color,       bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 3 * 0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: GTA3Program.a_TexCoord,    bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset: 7 * 0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
        ];
        this.inputLayout = device.createInputLayout({ indexBufferFormat: GfxFormat.U32_R, vertexAttributeDescriptors });
        const buffers = [{ buffer: this.vertexBuffer, byteOffset: 0, byteStride: 10 * 0x04}];
        const indexBuffer = { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, indexBuffer);
        this.megaStateFlags = {
            blendMode: GfxBlendMode.ADD,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
        };
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, dual = false): undefined {
        const hour = Math.floor(viewerInput.time / TIME_FACTOR) % 24;
        const { timeOn, timeOff } = this.key;
        let renderLayer = this.key.renderLayer;
        if (timeOn !== undefined && timeOff !== undefined) {
            if (timeOn < timeOff && (hour < timeOn || timeOff < hour)) return;
            if (timeOff < timeOn && (hour < timeOn && timeOff < hour)) return;
            renderLayer += 1;
        }

        if (!viewerInput.camera.frustum.contains(this.bbox))
            return;

        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, this.bbox);
        if (this.key.drawDistance !== undefined && depth > this.bbox.boundingSphereRadius() + 3 * this.key.drawDistance)
            return;

        const renderInst = super.prepareToRender(device, renderInstManager, viewerInput)!;
        renderInst.sortKey = setSortKeyDepth(makeSortKey(renderLayer), depth);

        let offs = renderInst.allocateUniformBuffer(GTA3Program.ub_MeshFragParams, 12 + 4);
        const mapped = renderInst.mapUniformBufferF32(GTA3Program.ub_MeshFragParams);
        offs += fillMatrix4x3(mapped, offs, viewerInput.camera.viewMatrix);
        mapped[offs++] = !(renderLayer & GfxRendererLayer.TRANSLUCENT) ? 0.01 : dual ? -0.9 : 0.9;

        // PS2 alpha test emulation, see http://skygfx.rockstarvision.com/skygfx.html
        if (dual) {
            renderInst.setMegaStateFlags({ depthWrite: false });
        } else if (!!(this.key.renderLayer & GfxRendererLayer.TRANSLUCENT)) {
            this.prepareToRender(device, renderInstManager, viewerInput, true);
        }
        return;
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1 },
];

export class GTA3Renderer implements Viewer.SceneGfx {
    public sceneRenderers: Renderer[] = [];
    public onstatechanged!: () => void;

    private renderTarget = new BasicRenderTarget();
    private clearRenderPassDescriptor = makeClearRenderPassDescriptor(true, colorNewCopy(White));
    private ambient = colorNewCopy(White);
    private renderHelper: GfxRenderHelper;
    private weather = 0;
    private scenarioSelect: UI.SingleSelect;

    constructor(device: GfxDevice, private colorSets: ColorSet[]) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const t = viewerInput.time / TIME_FACTOR;
        const cs1 = this.colorSets[Math.floor(t)   % 24 + 24 * this.weather];
        const cs2 = this.colorSets[Math.floor(t+1) % 24 + 24 * this.weather];
        const skyTop = colorNewCopy(White);
        const skyBot = colorNewCopy(White);
        colorLerp(this.ambient, cs1.amb, cs2.amb, t % 1);
        colorLerp(skyTop, cs1.skyTop, cs2.skyTop, t % 1);
        colorLerp(skyBot, cs1.skyBot, cs2.skyBot, t % 1);
        colorLerp(this.clearRenderPassDescriptor.colorClearColor, skyTop, skyBot, 0.67); // fog

        viewerInput.camera.setClipPlanes(1);
        this.renderHelper.pushTemplateRenderInst();
        const template = this.renderHelper.renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(GTA3Program.ub_SceneParams, 16 + 4);
        const sceneParamsMapped = template.mapUniformBufferF32(GTA3Program.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);
        offs += fillColor(sceneParamsMapped, offs, this.ambient);

        for (let i = 0; i < this.sceneRenderers.length; i++) {
            const sceneRenderer = this.sceneRenderers[i];
            sceneRenderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        }

        this.renderHelper.renderInstManager.popTemplateRenderInst();
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

    public createPanels(): UI.Panel[] {
        const scenarioPanel = new UI.Panel();
        scenarioPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        scenarioPanel.setTitle(UI.TIME_OF_DAY_ICON, 'Weather');

        const scenarioNames = ['Sunny', 'Cloudy', 'Rainy', 'Foggy'];

        this.scenarioSelect = new UI.SingleSelect();
        this.scenarioSelect.setStrings(scenarioNames);
        this.scenarioSelect.onselectionchange = (index: number) => {
            if (this.weather === index) return;
            this.weather = index;
            this.onstatechanged();
            this.scenarioSelect.selectItem(index);
        };
        this.scenarioSelect.selectItem(0);
        scenarioPanel.contents.appendChild(this.scenarioSelect.elem);

        scenarioPanel.setVisible(scenarioNames.length > 0);

        return [scenarioPanel];
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
        for (const sceneRenderer of this.sceneRenderers)
            sceneRenderer.destroy(device);
    }
}
