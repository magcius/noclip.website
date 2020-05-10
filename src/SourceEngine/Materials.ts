
import { DeviceProgram } from "../Program";
import { VMT, parseVMT } from "./VMT";
import { TextureMapping } from "../TextureHolder";
import { GfxRenderInst } from "../gfx/render/GfxRenderer";
import { nArray, assert, assertExists } from "../util";
import { GfxDevice, GfxProgram } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4 } from "gl-matrix";
import { fillMatrix4x3 } from "../gfx/helpers/UniformBufferHelpers";
import { VTF } from "./VTF";
import { SourceFileSystem } from "./Scenes_HalfLife2";

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
};

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
    gl_FragColor.rgb = texture(SAMPLER_2D(u_Texture[0], v_TexCoord.xy)).rgb;
}
#endif
`;
}

const zup = mat4.fromValues(
    -1, 0,  0, 0,
    0,  0, -1, 0,
    0,  1,  0, 0,
    0,  0,  0, 1,
);

const scratchMatrix = mat4.create();
export class MaterialInstance {
    public program: BaseMaterialProgram;
    public gfxProgram: GfxProgram;
    public shaderType: string;
    public textureMapping: TextureMapping[] = nArray(2, () => new TextureMapping());
    public visible = true;

    constructor(device: GfxDevice, cache: GfxRenderCache, materialCache: MaterialCache, public vmt: VMT) {
        this.shaderType = vmt._Root.toLowerCase();
        this.program = new BaseMaterialProgram();
        this.gfxProgram = cache.createProgram(device, this.program);

        // Hacks for now.
        if (vmt['%compilesky'] || vmt['%compiletrigger']) {
            this.visible = false;
        }

        // TODO(jstpierre): Material system.
        if (vmt.$basetexture !== undefined)
            materialCache.fillTextureMapping(this.textureMapping[0], assertExists(vmt.$basetexture));
    }

    public isMaterialLoaded(): boolean {
        if (this.textureMapping[0].gfxTexture === null)
            return false;

        return true;
    }

    public setOnRenderInst(renderInst: GfxRenderInst, viewMatrix: mat4): void {
        let offs = renderInst.allocateUniformBuffer(BaseMaterialProgram.ub_ObjectParams, 4*3);
        const d = renderInst.mapUniformBufferF32(BaseMaterialProgram.ub_ObjectParams);
        mat4.mul(scratchMatrix, viewMatrix, zup);
        offs += fillMatrix4x3(d, offs, scratchMatrix);

        assert(this.isMaterialLoaded());
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
    }

    public destroy(device: GfxDevice): void {
    }
}

export class MaterialCache {
    private textureCache = new Map<string, VTF>();
    private texturePromiseCache = new Map<string, Promise<VTF>>();
    private materialPromiseCache = new Map<string, Promise<VMT>>();

    constructor(private device: GfxDevice, private cache: GfxRenderCache, private filesystem: SourceFileSystem) {
        this.textureCache.set('_rt_Camera', new VTF(device, null));
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

    public async createMaterialInstance(path: string): Promise<MaterialInstance> {
        const vmt = await this.fetchMaterialData(path);
        return new MaterialInstance(this.device, this.cache, this, vmt);
    }

    private async fetchTextureInternal(name: string): Promise<VTF> {
        const path = this.resolvePath(name, '.vtf');
        const data = assertExists(await this.filesystem.fetchFileData(path));
        const vtf = new VTF(this.device, data);
        this.textureCache.set(path, vtf);
        return vtf;
    }

    public fillTextureMapping(m: TextureMapping, name: string): void {
        if (this.textureCache.has(name)) {
            this.textureCache.get(name)!.fillTextureMapping(m);
            return;
        }

        if (!this.texturePromiseCache.has(name))
            this.texturePromiseCache.set(name, this.fetchTextureInternal(name));

        this.texturePromiseCache.get(name)!.then((vtf) => { vtf.fillTextureMapping(m); });
    }

    public destroy(device: GfxDevice): void {
        for (const vtf of this.textureCache.values())
            vtf.destroy(device);
    }
}
