
import { DeviceProgram } from "../Program";
import { VMT, parseVMT } from "./VMT";
import { TextureMapping } from "../TextureHolder";
import { GfxRenderInst, makeSortKey, GfxRendererLayer, setSortKeyProgramKey } from "../gfx/render/GfxRenderer";
import { nArray, assert, assertExists } from "../util";
import { GfxDevice, GfxProgram, GfxMegaStateDescriptor, GfxFrontFaceMode, GfxBlendMode, GfxBlendFactor } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4, vec3 } from "gl-matrix";
import { fillMatrix4x3, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { VTF } from "./VTF";
import { SourceFileSystem } from "./Scenes_HalfLife2";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { computeViewSpaceDepthFromWorldSpacePointAndViewMatrix } from "../Camera";

class BaseMaterialProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public both = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_ObjectParams {
    Mat4x3 u_ModelView;
    vec4 u_Misc[1];
};

#define u_AlphaTestReference (u_Misc[0].x)

varying vec4 v_TexCoord;
uniform sampler2D u_Texture[2];

#ifdef VERT
layout(location = ${BaseMaterialProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${BaseMaterialProgram.a_TexCoord}) attribute vec4 a_TexCoord;

void mainVS() {
    gl_Position = Mul(u_Projection, vec4(Mul(u_ModelView, vec4(a_Position, 1.0)), 1.0));
    v_TexCoord = a_TexCoord;
}
#endif

#ifdef FRAG
void mainPS() {
    gl_FragColor.rgba = texture(SAMPLER_2D(u_Texture[0], v_TexCoord.xy)).rgba;

#ifdef USE_ALPHATEST
    if (gl_FragColor.a < u_AlphaTestReference)
        discard;
#endif
}
#endif
`;
}

const zup = mat4.fromValues(
    1, 0,  0, 0,
    0, 0, -1, 0,
    0, 1,  0, 0,
    0, 0,  0, 1,
);

const scratchMatrix = mat4.create();
export class BaseMaterial {
    public visible = true;
    public program: BaseMaterialProgram;
    public gfxProgram: GfxProgram;
    public megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    public sortKeyBase: number = 0;

    // Texture parameters.
    private baseTexture: VTF | null = null;
    public textureMapping: TextureMapping[] = nArray(2, () => new TextureMapping());

    // Material parameters.
    // TODO(jstpierre): This doesn't seem to be in the files? Not sure.
    private alphatestreference: number = 0.4;

    constructor(public vmt: VMT) {
    }

    public async init(device: GfxDevice, cache: GfxRenderCache, materialCache: MaterialCache) {
        await this.fetchResources(materialCache);
        this.initSync();

        this.gfxProgram = cache.createProgram(device, this.program);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    protected async fetchResources(materialCache: MaterialCache) {
        const vmt = this.vmt;

        // Base textures.
        if (vmt.$basetexture !== undefined)
            this.baseTexture = await materialCache.fetchVTF(assertExists(vmt.$basetexture));
    }

    protected initSync() {
        const vmt = this.vmt;

        this.program = new BaseMaterialProgram();
        this.megaStateFlags.frontFace = GfxFrontFaceMode.CW;

        if (this.baseTexture !== null)
            this.baseTexture.fillTextureMapping(this.textureMapping[0]);

        if (vmt.$alphatest) {
            this.program.defines.set('USE_ALPHATEST', '1');
            if (vmt.$alphatestreference)
                this.alphatestreference = Number(vmt.$alphatestreference);
        } else {
            // Set translucency. There's a matvar for it, but the real behavior appears to come
            // from the texture's flags.
            let isTranslucent = false;

            if (this.baseTexture !== null && this.baseTexture.isTranslucent())
                isTranslucent = true;

            if (isTranslucent && vmt.$additive) {
                // BLENDADD
                setAttachmentStateSimple(this.megaStateFlags, {
                    blendMode: GfxBlendMode.ADD,
                    blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                    blendDstFactor: GfxBlendFactor.ONE,
                });
            } else if (isTranslucent) {
                // BLEND
                setAttachmentStateSimple(this.megaStateFlags, {
                    blendMode: GfxBlendMode.ADD,
                    blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                    blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
                });
            } else if (vmt.$additive) {
                // ADD
                setAttachmentStateSimple(this.megaStateFlags, {
                    blendMode: GfxBlendMode.ADD,
                    blendSrcFactor: GfxBlendFactor.ONE,
                    blendDstFactor: GfxBlendFactor.ONE,
                });
            }

            let sortLayer: GfxRendererLayer;
            if (isTranslucent || vmt.$additive) {
                this.megaStateFlags.depthWrite = false;
                sortLayer = GfxRendererLayer.TRANSLUCENT;
            } else {
                sortLayer = GfxRendererLayer.OPAQUE;
            }

            this.sortKeyBase = makeSortKey(sortLayer);
        }
    }

    public isMaterialLoaded(): boolean {
        if (this.textureMapping[0].gfxTexture === null)
            return false;

        return true;
    }

    public setOnRenderInst(renderInst: GfxRenderInst, viewMatrix: mat4): void {
        let offs = renderInst.allocateUniformBuffer(BaseMaterialProgram.ub_ObjectParams, 4*3+4);
        const d = renderInst.mapUniformBufferF32(BaseMaterialProgram.ub_ObjectParams);
        mat4.mul(scratchMatrix, viewMatrix, zup);
        offs += fillMatrix4x3(d, offs, scratchMatrix);
        offs += fillVec4(d, offs, this.alphatestreference);

        assert(this.isMaterialLoaded());
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }

    public computeViewSpaceDepth(center: vec3, viewMatrix: mat4): number {
        mat4.mul(scratchMatrix, viewMatrix, zup);
        return computeViewSpaceDepthFromWorldSpacePointAndViewMatrix(scratchMatrix, center);
    }

    public destroy(device: GfxDevice): void {
    }
}

class HiddenMaterial extends BaseMaterial {
    protected initSync() {
        super.initSync();
        this.visible = false;
    }
}

export class MaterialCache {
    private textureCache = new Map<string, VTF>();
    private texturePromiseCache = new Map<string, Promise<VTF>>();
    private materialPromiseCache = new Map<string, Promise<VMT>>();

    constructor(private device: GfxDevice, private cache: GfxRenderCache, private filesystem: SourceFileSystem) {
        this.textureCache.set('_rt_Camera', new VTF(device, cache, null));
    }

    private resolvePath(path: string, ext: string): string {
        return this.filesystem.resolvePath(`materials/${path}${ext}`);
    }

    private async fetchMaterialDataInternal(name: string): Promise<VMT> {
        const path = this.resolvePath(name, '.vmt');
        return parseVMT(this.filesystem, path);
    }

    private fetchMaterialData(path: string): Promise<VMT> {
        if (!this.materialPromiseCache.has(path))
            this.materialPromiseCache.set(path, this.fetchMaterialDataInternal(path));
        return this.materialPromiseCache.get(path)!;
    }

    private createMaterialInstanceInternal(vmt: VMT): BaseMaterial {
        // Hacks for now. I believe these are normally hidden by not actually being in the BSP tree.
        if (vmt['%compilesky'] || vmt['%compiletrigger']) {
            return new HiddenMaterial(vmt);
        }

        // const shaderType = vmt._Root.toLowerCase();

        // Dispatch based on shader type.
        return new BaseMaterial(vmt);
    }

    public async createMaterialInstance(path: string): Promise<BaseMaterial> {
        const vmt = await this.fetchMaterialData(path);
        const materialInstance = this.createMaterialInstanceInternal(vmt);
        await materialInstance.init(this.device, this.cache, this);
        return materialInstance;
    }

    private async fetchVTFInternal(name: string): Promise<VTF> {
        const path = this.resolvePath(name, '.vtf');
        const data = assertExists(await this.filesystem.fetchFileData(path));
        const vtf = new VTF(this.device, this.cache, data);
        this.textureCache.set(name, vtf);
        return vtf;
    }

    public fetchVTF(name: string): Promise<VTF> {
        if (this.textureCache.has(name))
            return Promise.resolve(this.textureCache.get(name)!);

        if (!this.texturePromiseCache.has(name))
            this.texturePromiseCache.set(name, this.fetchVTFInternal(name));
        return this.texturePromiseCache.get(name)!;
    }

    public destroy(device: GfxDevice): void {
        for (const vtf of this.textureCache.values())
            vtf.destroy(device);
    }
}
