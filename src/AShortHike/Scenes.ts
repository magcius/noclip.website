
import * as Viewer from '../viewer.js';
import { SceneContext } from '../SceneBase.js';
import { fillMatrix4x4, fillVec4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxDevice, GfxProgram } from '../gfx/platform/GfxPlatform.js';
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { UnityRuntime, MeshRenderer as UnityMeshRenderer, UnityMaterialFactory, UnityMaterialInstance, createUnityRuntime, UnityShaderProgramBase } from '../Common/Unity/GameObject.js';
import { UnityMaterialData } from '../Common/Unity/AssetManager.js';
import { GfxRenderInst } from '../gfx/render/GfxRenderInstManager.js';
import { fallback, nArray } from '../util.js';
import { TextureMapping } from '../TextureHolder.js';

class TempMaterialProgram extends UnityShaderProgramBase {
    public static ub_MaterialParams = 2;

    public override both = `
${UnityShaderProgramBase.Common}

layout(std140) uniform ub_MaterialParams {
    vec4 u_Color;
    vec4 u_MainTexST;
    vec4 u_Misc[1];
};

#define u_AlphaCutoff (u_Misc[0].x)

varying vec2 v_LightIntensity;
varying vec2 v_TexCoord0;

#ifdef VERT
void mainVS() {
    Mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = Mul(t_WorldFromLocalMatrix, vec4(a_Position, 1.0));
    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    vec3 normal = MulNormalMatrix(t_WorldFromLocalMatrix, normalize(a_Normal));
    float t_LightIntensityF = dot(-normal, t_LightDirection);
    float t_LightIntensityB = dot( normal, t_LightDirection);

    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));
    v_LightIntensity = vec2(t_LightIntensityF, t_LightIntensityB);
    v_TexCoord0 = CalcScaleBias(a_TexCoord0, u_MainTexST);
}
#endif

#ifdef FRAG
uniform sampler2D u_Texture;

void mainPS() {
    vec4 t_Color = u_Color * texture(u_Texture, v_TexCoord0);

    if (t_Color.a < u_AlphaCutoff)
        discard;

    float t_LightIntensity = gl_FrontFacing ? v_LightIntensity.x : v_LightIntensity.y;
    float t_LightTint = 0.2 * t_LightIntensity;
    vec4 t_FinalColor = t_Color + vec4(t_LightTint, t_LightTint, t_LightTint, 0.0);
    t_FinalColor.rgb = pow(t_FinalColor.rgb, vec3(1.0 / 2.2));
    gl_FragColor = t_FinalColor;
}
#endif
`;
}

class TempMaterial extends UnityMaterialInstance {
    public textureMapping = nArray(1, () => new TextureMapping());
    public program = new TempMaterialProgram();
    public gfxProgram: GfxProgram;
    public alphaCutoff: number = 0.0;

    constructor(runtime: UnityRuntime, private materialData: UnityMaterialData) {
        super();

        this.materialData.fillTextureMapping(this.textureMapping[0], '_MainTex');
        this.alphaCutoff = fallback(this.materialData.getFloat('_Cutoff'), 0.0);

        if (this.materialData.name.includes('Terrain'))
            this.alphaCutoff = 0.0;

        this.gfxProgram = runtime.assetSystem.renderCache.createProgram(this.program);
    }

    public prepareToRender(renderInst: GfxRenderInst): void {
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        let offs = renderInst.allocateUniformBuffer(TempMaterialProgram.ub_MaterialParams, 12);
        const d = renderInst.mapUniformBufferF32(TempMaterialProgram.ub_MaterialParams);

        offs += this.materialData.fillColor(d, offs, '_Color');
        offs += this.materialData.fillTexEnvScaleBias(d, offs, '_MainTex');
        offs += fillVec4(d, offs, this.alphaCutoff);

        renderInst.setGfxProgram(this.gfxProgram);
    }
}

class TerrainMaterialProgram extends UnityShaderProgramBase {
    public static ub_MaterialParams = 2;

    public override both = `
${UnityShaderProgramBase.Common}

layout(std140) uniform ub_MaterialParams {
    vec4 u_Color;
    vec4 u_TexST[6];
    vec4 u_Misc[1];
};

varying vec2 v_LightIntensity;
varying vec2 v_TexCoord[6];

uniform sampler2D u_SideTex;
uniform sampler2D u_Control1;
uniform sampler2D u_Splat0;
uniform sampler2D u_Splat1;
uniform sampler2D u_Splat2;
uniform sampler2D u_Splat3;

#ifdef VERT
void mainVS() {
    Mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = Mul(t_WorldFromLocalMatrix, vec4(a_Position, 1.0));
    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    vec3 normal = MulNormalMatrix(t_WorldFromLocalMatrix, normalize(a_Normal));
    float t_LightIntensityF = dot(-normal, t_LightDirection);
    float t_LightIntensityB = dot( normal, t_LightDirection);

    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));
    v_LightIntensity = vec2(t_LightIntensityF, t_LightIntensityB);

    for (int i = 0; i < 6; i++)
        v_TexCoord[i] = CalcScaleBias(a_TexCoord0, u_TexST[i]);
}
#endif

#ifdef FRAG
void mainPS() {
    vec4 t_BaseColor = texture(u_SideTex, v_TexCoord[0]);
    vec4 t_Control = texture(u_Control1, v_TexCoord[1]);

    vec4 t_Color = vec4(0.0);
    t_Color += texture(u_Splat0, v_TexCoord[2]) * t_Control.r;
    t_Color += texture(u_Splat1, v_TexCoord[3]) * t_Control.g;
    t_Color += texture(u_Splat2, v_TexCoord[4]) * t_Control.b;
    t_Color += texture(u_Splat3, v_TexCoord[5]) * t_Control.a;

    float t_AllWeight = dot(t_Control, vec4(1.0));
    t_Color += (1.0 - t_AllWeight) * t_BaseColor;

    float t_LightIntensity = gl_FrontFacing ? v_LightIntensity.x : v_LightIntensity.y;
    float t_LightTint = 0.2 * t_LightIntensity;
    vec4 t_FinalColor = t_Color + vec4(t_LightTint, t_LightTint, t_LightTint, 0.0);

    t_FinalColor.rgb = pow(t_FinalColor.rgb, vec3(1.0 / 2.2));
    gl_FragColor = t_FinalColor;
}
#endif
`;
}

class TerrainMaterial extends UnityMaterialInstance {
    public textureMapping = nArray(6, () => new TextureMapping());
    public program = new TerrainMaterialProgram();
    public gfxProgram: GfxProgram;
    public alphaCutoff: number = 0.0;

    constructor(runtime: UnityRuntime, private materialData: UnityMaterialData) {
        super();

        this.materialData.fillTextureMapping(this.textureMapping[0], '_SideTex');
        this.materialData.fillTextureMapping(this.textureMapping[1], '_Control1');
        this.materialData.fillTextureMapping(this.textureMapping[2], '_Splat0');
        this.materialData.fillTextureMapping(this.textureMapping[3], '_Splat1');
        this.materialData.fillTextureMapping(this.textureMapping[4], '_Splat2');
        this.materialData.fillTextureMapping(this.textureMapping[5], '_Splat3');

        this.alphaCutoff = fallback(this.materialData.getFloat('_Cutoff'), 0.0);

        this.gfxProgram = runtime.assetSystem.renderCache.createProgram(this.program);
    }

    public prepareToRender(renderInst: GfxRenderInst): void {
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        let offs = renderInst.allocateUniformBuffer(TempMaterialProgram.ub_MaterialParams, 64);
        const d = renderInst.mapUniformBufferF32(TempMaterialProgram.ub_MaterialParams);

        offs += this.materialData.fillColor(d, offs, '_Color');
        offs += this.materialData.fillTexEnvScaleBias(d, offs, '_SideTex');
        offs += this.materialData.fillTexEnvScaleBias(d, offs, '_Control1');
        offs += this.materialData.fillTexEnvScaleBias(d, offs, '_Splat0');
        offs += this.materialData.fillTexEnvScaleBias(d, offs, '_Splat1');
        offs += this.materialData.fillTexEnvScaleBias(d, offs, '_Splat2');
        offs += this.materialData.fillTexEnvScaleBias(d, offs, '_Splat3');
        offs += fillVec4(d, offs, 0.0);

        renderInst.setGfxProgram(this.gfxProgram);
    }
}

class AShortHikeMaterialFactory extends UnityMaterialFactory {
    public createMaterialInstance(runtime: UnityRuntime, materialData: UnityMaterialData): UnityMaterialInstance {
        debugger;
        // TODO(jstpierre): Pull out serialized shader data
        if (materialData.texEnvName.includes('_Splat3'))
            return new TerrainMaterial(runtime, materialData);
        else
            return new TempMaterial(runtime, materialData);
    }
}

const bindingLayouts = [
    { numUniformBuffers: 3, numSamplers: 6, },
];

class UnityRenderer implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;

    constructor(private runtime: UnityRuntime) {
        this.renderHelper = new GfxRenderHelper(this.runtime.context.device, this.runtime.context);
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.runtime.update();

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(0, 32);
        const mapped = template.mapUniformBufferF32(0);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.clipFromWorldMatrix);

        const meshRenderers = this.runtime.getComponents(UnityMeshRenderer);
        for (let i = 0; i < meshRenderers.length; i++)
            meshRenderers[i].prepareToRender(this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice) {
        this.runtime.destroy(device);
        this.renderHelper.destroy();
    }
}

class AShortHikeSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const runtime = await createUnityRuntime(context, `AShortHike`);
        runtime.materialFactory = new AShortHikeMaterialFactory();
        await runtime.loadLevel(this.id);

        const renderer = new UnityRenderer(runtime);
        return renderer;
    }

}

const id = 'AShortHike';
const name = 'A Short Hike';

const sceneDescs = [
    new AShortHikeSceneDesc(`level2`, "The Island"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, hidden: true };
