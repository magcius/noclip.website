
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
import { computeViewSpaceDepthFromWorldSpaceAABB, FPSCameraController } from "../Camera";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { assert } from "../util";
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { GfxRenderInstManager, GfxRendererLayer, makeSortKey, setSortKeyDepth, GfxRenderInst } from "../gfx/render/GfxRenderer";
import { ItemInstance, ObjectDefinition, ObjectFlags } from "./item";
import { colorNew, White, colorNewCopy, colorMult, Color } from "../Color";
import { ColorSet, emptyColorSet, lerpColorSet } from "./time";
import { AABB } from "../Geometry";

const TIME_FACTOR = 2500; // one day cycle per minute

export class Texture implements TextureBase {
    public name: string;
    public format: number;
    public width: number;
    public height: number;
    public pixels: Uint8Array;
    public pixelFormat: GfxFormat;

    constructor(texture: rw.Texture, txdName: string, useDXT = true) {
        this.name = txdName + '/' + texture.name.toLowerCase();
        this.format = texture.raster.format;
        if (useDXT && texture.raster.platform === rw.Platform.PLATFORM_D3D8) {
            const r = texture.raster.toD3dRaster();
            if (r.customFormat) {
                switch(r.format) {
                    case rw.Raster.Format.D3DFMT_DXT1:
                        this.pixelFormat = GfxFormat.BC1;
                        break;
                    case rw.Raster.Format.D3DFMT_DXT2:
                    case rw.Raster.Format.D3DFMT_DXT3:
                        this.pixelFormat = GfxFormat.BC2;
                        break;
                    case rw.Raster.Format.D3DFMT_DXT4:
                    case rw.Raster.Format.D3DFMT_DXT5:
                        this.pixelFormat = GfxFormat.BC3;
                        break;
                    default:
                        throw new Error('unrecognised custom texture format');
                }
                assert(r.texture.length > 0);
                const level = r.texture.level(0);
                this.width  = level.width;
                this.height = level.height;
                this.pixels = level.data!.slice();
            }
        }
        if (this.pixels === undefined) {
            const image = texture.raster.toImage();
            image.unindex();
            this.width  = image.width;
            this.height = image.height;
            this.pixels = image.pixels!.slice();
            this.pixelFormat = (image.depth === 32) ? GfxFormat.U8_RGBA : GfxFormat.U8_RGB;
            image.delete();
        }
    }
}

function mod(a: number, b: number) {
    return (a % b + b) % b;
}

function halve(pixels: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
    const w = Math.max((width / 2) | 0, 1);
    const h = Math.max((height / 2) | 0, 1);
    const UNPACK_ALIGNMENT = 4;
    const rowSize = bpp * width + mod(-(bpp * width), UNPACK_ALIGNMENT);
    const halvedRowSize = bpp * w + mod(-(bpp * w), UNPACK_ALIGNMENT);
    const halved = new Uint8Array(halvedRowSize * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            for (let i = 0; i < bpp; i++) {
                halved[bpp * x + halvedRowSize * y + i] =
                    ( pixels[bpp * (2*x+0) + rowSize * (2*y+0) + i]
                    + pixels[bpp * (2*x+1) + rowSize * (2*y+0) + i]
                    + pixels[bpp * (2*x+0) + rowSize * (2*y+1) + i]
                    + pixels[bpp * (2*x+1) + rowSize * (2*y+1) + i] ) / 4;
            }
        }
    }
    return halved;
}

export class TextureArray extends TextureMapping {
    public subimages = new Map<string, number>();

    constructor(device: GfxDevice, textures: Texture[]) {
        super();
        assert(textures.length > 0);
        const width = textures[0].width;
        const height = textures[0].height;
        const size = textures[0].pixels.byteLength;
        const pixelFormat = textures[0].pixelFormat;
        for (let i = 0; i < textures.length; i++) {
            const texture = textures[i];
            assert(texture.width === width && texture.height === height && texture.pixelFormat === pixelFormat && texture.pixels.byteLength === size);
            this.subimages.set(texture.name, i);
        }

        let bpp = 0;
        let mipFilter = GfxMipFilterMode.LINEAR;
        if (pixelFormat === GfxFormat.U8_RGBA) {
            bpp = 4;
        } else if (pixelFormat === GfxFormat.U8_RGB) {
            bpp = 3;
        } else {
            mipFilter = GfxMipFilterMode.NO_MIP;
        }

        const pixels = new Uint8Array(size * textures.length);
        for (let i = 0; i < textures.length; i++)
            pixels.set(textures[i].pixels, i * size);

        const mipmaps = [pixels];
        if (mipFilter !== GfxMipFilterMode.NO_MIP) {
            let mip = pixels;
            let w = width;
            let h = height;
            while (w > 1 && h > 1) {
                mip = halve(mip, w, h * textures.length, bpp);
                mipmaps.push(mip);
                w = Math.max((w / 2) | 0, 1);
                h = Math.max((h / 2) | 0, 1);
            }
        }

        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D_ARRAY, pixelFormat,
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
            mipFilter,
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

interface GTA3ProgramDef {
    ALPHA_TEST?: string;
    SKY?: string;
    WATER?: string;
}

class GTA3Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;

    private static program = readFileSync('src/GrandTheftAuto3/program.glsl', { encoding: 'utf8' });
    public both = GTA3Program.program;

    constructor(def: GTA3ProgramDef = {}) {
        super();
        if (def.ALPHA_TEST !== undefined)
            this.defines.set('ALPHA_TEST', def.ALPHA_TEST);
        if (def.SKY !== undefined)
            this.defines.set('SKY', def.SKY);
        if (def.WATER !== undefined)
            this.defines.set('WATER', def.WATER);
    }
}

const opaqueProgram = new GTA3Program();
const dualPassCoreProgram = new GTA3Program({ ALPHA_TEST: '< 0.9' });
const dualPassEdgeProgram = new GTA3Program({ ALPHA_TEST: '>= 0.9' });
const waterProgram = new GTA3Program({ WATER: '1' });
const skyProgram = new GTA3Program({ SKY: '1' });

class Renderer {
    protected vertexBuffer: GfxBuffer;
    protected indexBuffer: GfxBuffer;
    protected inputLayout: GfxInputLayout;
    protected inputState: GfxInputState;
    protected megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    protected gfxProgram?: GfxProgram;

    protected indices: number;

    constructor(protected program: DeviceProgram, protected atlas?: TextureArray) {}

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, colorSet: ColorSet): GfxRenderInst | undefined {
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
    constructor(device: GfxDevice, atlas: TextureArray) {
        super(skyProgram, atlas);
        // fullscreen quad
        const vbuf = new Float32Array([
            -1, -1, 1,
            -1,  1, 1,
             1,  1, 1,
             1, -1, 1,
        ]);
        const ibuf = new Uint32Array([0,1,2,0,2,3]);
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vbuf.buffer);
        this.indexBuffer  = makeStaticDataBuffer(device, GfxBufferUsage.INDEX,  ibuf.buffer);
        this.indices = ibuf.length;
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: GTA3Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
        ];
        this.inputLayout = device.createInputLayout({ indexBufferFormat: GfxFormat.U32_R, vertexAttributeDescriptors });
        const buffers = [{ buffer: this.vertexBuffer, byteOffset: 0, byteStride: 3 * 0x04}];
        const indexBuffer = { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, indexBuffer);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, colorSet: ColorSet): undefined {
        if (viewerInput.camera.isOrthographic) return;
        const renderInst = super.prepareToRender(device, renderInstManager, viewerInput, colorSet)!;
        renderInst.sortKey = makeSortKey(GfxRendererLayer.BACKGROUND);
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
    public modelName?: string;
    public drawDistance?: number;
    public timeOn?: number;
    public timeOff?: number;
    public water: boolean;
    public additive: boolean;

    constructor(obj: ObjectDefinition, public zone: string) {
        if (obj.flags & ObjectFlags.DRAW_LAST) {
            this.renderLayer = GfxRendererLayer.TRANSLUCENT;
            this.modelName = obj.modelName;
        }
        if (obj.drawDistance < 99 && !(obj.flags & ObjectFlags.IGNORE_DRAW_DISTANCE))
            this.drawDistance = 99;
        if (obj.tobj) {
            this.timeOn = obj.timeOn;
            this.timeOff = obj.timeOff;
        }
        this.water = (obj.modelName === 'water');
        this.additive = !!(obj.flags & ObjectFlags.ADDITIVE);
    }
}

export class SceneRenderer extends Renderer {
    public bbox = new AABB();

    private sortKey: number;

    private static programFor(key: DrawKey, dual: boolean) {
        if (key.water) return waterProgram;

        // PS2 alpha test emulation, see http://skygfx.rockstarvision.com/skygfx.html
        if (dual) return dualPassEdgeProgram;
        if (!!(key.renderLayer & GfxRendererLayer.TRANSLUCENT)) return dualPassCoreProgram;

        return opaqueProgram;
    }

    private static keepFrag(frag: MeshFragData, atlas?: TextureArray) {
        if (frag.texName !== undefined && atlas !== undefined) {
            return atlas.subimages.has(frag.texName);
        } else { // only draw untextured objects once (i.e. only when no atlas provided)
            return (frag.texName === undefined && atlas === undefined);
        }
    }

    public static applicable(meshes: MeshInstance[], atlas?: TextureArray) {
        for (const inst of meshes) {
            for (const frag of inst.frags) {
                if (SceneRenderer.keepFrag(frag, atlas)) return true;
            }
        }
        return false;
    }

    constructor(device: GfxDevice, public key: DrawKey, meshes: MeshInstance[], sealevel: number, atlas?: TextureArray, dual = false) {
        super(SceneRenderer.programFor(key, dual), atlas);

        let vertices = 0;
        this.indices = 0;
        for (const inst of meshes) {
            for (const frag of inst.frags) {
                if (!SceneRenderer.keepFrag(frag, atlas)) continue;
                vertices += frag.vertices;
                this.indices += frag.indices.length;
            }
        }
        assert(this.indices > 0);

        const points = [] as vec3[];
        const vbuf = new Float32Array(vertices * 10);
        const ibuf = new Uint32Array(this.indices);
        let voffs = 0;
        let ioffs = 0;
        let lastIndex = 0;
        for (const inst of meshes) {
            for (const frag of inst.frags) {
                if (!SceneRenderer.keepFrag(frag, atlas)) continue;
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
                    assert(index + lastIndex < vertices);
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
            blendDstFactor: this.key.additive ? GfxBlendFactor.ONE : GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            depthWrite: !dual,
        };

        if (this.key.water) {
            this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + 1);
        } else if (this.key.renderLayer === GfxRendererLayer.TRANSLUCENT && this.bbox.minY >= sealevel) {
            this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + 2);
        } else {
            this.sortKey = makeSortKey(this.key.renderLayer);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, colorSet: ColorSet, dual = false): undefined {
        const hour = Math.floor(viewerInput.time / TIME_FACTOR) % 24;
        const { timeOn, timeOff } = this.key;
        if (timeOn !== undefined && timeOff !== undefined) {
            if (timeOn < timeOff && (hour < timeOn || timeOff < hour)) return;
            if (timeOff < timeOn && (hour < timeOn && timeOff < hour)) return;
        }

        if (!viewerInput.camera.frustum.contains(this.bbox))
            return;

        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, this.bbox);
        if (this.key.drawDistance !== undefined && depth > this.bbox.boundingSphereRadius() + 3 * this.key.drawDistance)
            return;

        const renderInst = super.prepareToRender(device, renderInstManager, viewerInput, colorSet)!;
        renderInst.sortKey = setSortKeyDepth(this.sortKey, depth);
        return;
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 1, numSamplers: 1 },
];

export class GTA3Renderer implements Viewer.SceneGfx {
    public sceneRenderers: Renderer[] = [];
    public onstatechanged!: () => void;

    private renderTarget = new BasicRenderTarget();
    private clearRenderPassDescriptor = standardFullClearRenderPassDescriptor;
    private currentColors = emptyColorSet();
    private renderHelper: GfxRenderHelper;
    private weather = 0;
    private scenarioSelect: UI.SingleSelect;

    constructor(device: GfxDevice, private colorSets: ColorSet[], private weatherTypes: string[], private waterOrigin: vec3) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public createCameraController() {
        const controller = new FPSCameraController();
        controller.sceneKeySpeedMult = 0.5;
        return controller;
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const t = viewerInput.time / TIME_FACTOR;
        const cs1 = this.colorSets[Math.floor(t)   % 24 + 24 * this.weather];
        const cs2 = this.colorSets[Math.floor(t+1) % 24 + 24 * this.weather];
        lerpColorSet(this.currentColors, cs1, cs2, t % 1);

        viewerInput.camera.setClipPlanes(1);
        this.renderHelper.pushTemplateRenderInst();
        const template = this.renderHelper.renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(GTA3Program.ub_SceneParams, 16 + 2 * 12 + 6 * 4);
        const mapped = template.mapUniformBufferF32(GTA3Program.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(mapped, offs, viewerInput.camera.viewMatrix);
        offs += fillMatrix4x3(mapped, offs, viewerInput.camera.worldMatrix);
        mapped[offs++] = viewerInput.camera.frustum.right;
        mapped[offs++] = viewerInput.camera.frustum.top;
        mapped[offs++] = viewerInput.camera.frustum.near;
        mapped[offs++] = viewerInput.camera.frustum.far;
        offs += fillColor(mapped, offs, this.currentColors.amb);
        offs += fillColor(mapped, offs, this.currentColors.skyTop);
        offs += fillColor(mapped, offs, this.currentColors.skyBot);
        offs += fillColor(mapped, offs, this.currentColors.water);
        // rotate axes from Z-up to Y-up
        mapped[offs++] = this.waterOrigin[1];
        mapped[offs++] = this.waterOrigin[2];
        mapped[offs++] = this.waterOrigin[0];
        mapped[offs++] = 0;

        for (let i = 0; i < this.sceneRenderers.length; i++) {
            const sceneRenderer = this.sceneRenderers[i];
            sceneRenderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput, this.currentColors);
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

        const scenarioNames = this.weatherTypes;

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
