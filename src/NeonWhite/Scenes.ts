
import * as Viewer from '../viewer.js';
import { SceneContext } from '../SceneBase.js';
import { fillMatrix4x4, fillVec4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxDevice, GfxProgram } from '../gfx/platform/GfxPlatform.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { UnityRuntime, MeshRenderer as UnityMeshRenderer, UnityMaterialFactory, UnityMaterialInstance, createUnityRuntime, UnityShaderProgramBase } from '../Common/Unity/GameObject.js';
import { UnityMaterialData } from '../Common/Unity/AssetManager.js';
import { GfxRenderInst, GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { nArray } from '../util.js';
import { TextureMapping } from '../TextureHolder.js';
import { CameraController } from '../Camera.js';
import { UnityVersion } from '../../rust/pkg/noclip_support.js';

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
    vec4 t_Color = texture(u_Texture, v_TexCoord0);

    if (t_Color.a < u_AlphaCutoff)
        discard;

    float t_LightIntensity = gl_FrontFacing ? v_LightIntensity.x : v_LightIntensity.y;
    float t_LightTint = 0.5 + 0.5 * t_LightIntensity;
    vec4 t_FinalColor = t_Color * vec4(t_LightTint, t_LightTint, t_LightTint, 0.0);
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

        if (!this.materialData.fillTextureMapping(this.textureMapping[0], '_MainTex'))
        if (!this.materialData.fillTextureMapping(this.textureMapping[0], '_AlbedoRoughnessA'))
        if (!this.materialData.fillTextureMapping(this.textureMapping[0], '_Albedo'))
        if (!this.materialData.fillTextureMapping(this.textureMapping[0], '_Texture'))
            undefined;

        this.gfxProgram = runtime.assetSystem.renderCache.createProgram(this.program);
    }

    public prepareToRender(renderInst: GfxRenderInst): void {
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        let offs = renderInst.allocateUniformBuffer(TempMaterialProgram.ub_MaterialParams, 12);
        const d = renderInst.mapUniformBufferF32(TempMaterialProgram.ub_MaterialParams);

        offs += this.materialData.fillColor(d, offs, '_AlbedoColorTint');
        offs += this.materialData.fillTexEnvScaleBias(d, offs, '_MainTex');
        offs += fillVec4(d, offs, this.alphaCutoff);

        renderInst.setGfxProgram(this.gfxProgram);
    }
}

class NeonWhiteMaterialFactory extends UnityMaterialFactory {
    public createMaterialInstance(runtime: UnityRuntime, materialData: UnityMaterialData): UnityMaterialInstance {
        return new TempMaterial(runtime, materialData);
    }
}

const bindingLayouts = [
    { numUniformBuffers: 3, numSamplers: 6, },
];

class UnityRenderer implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();

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

        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);

        const meshRenderers = this.runtime.getComponents(UnityMeshRenderer);
        for (let i = 0; i < meshRenderers.length; i++)
            meshRenderers[i].prepareToRender(this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public adjustCameraController(c: CameraController): void {
        c.setSceneMoveSpeedMult(1/60);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        viewerInput.camera.setClipPlanes(1);

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
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice) {
        this.runtime.destroy(device);
        this.renderHelper.destroy();
    }
}

class NeonWhiteSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const runtime = await createUnityRuntime(context, `NeonWhite`, UnityVersion.V2020_3_16f1);
        runtime.materialFactory = new NeonWhiteMaterialFactory();
        await runtime.loadLevel(this.id);

        const renderer = new UnityRenderer(runtime);
        return renderer;
    }
}

const id = 'NeonWhite';
const name = 'Neon White';

const sceneDescs = [
    new NeonWhiteSceneDesc("level0", "IntroCards/IntroCards.unity"),
    new NeonWhiteSceneDesc("level1", "Levels/Grid/GRID_PAGODA.unity"),
    new NeonWhiteSceneDesc("level2", "Levels/Skyworld/LowerHeaven_Environment_Base.unity"),
    new NeonWhiteSceneDesc("level3", "Levels/Grid/TUT_SHOOTINGRANGE.unity"),
    new NeonWhiteSceneDesc("level4", "Levels/Skyworld/GlassPort_Environment_Base.unity"),
    new NeonWhiteSceneDesc("level5", "Levels/Grid/HUB_HEAVEN.unity"),
    new NeonWhiteSceneDesc("level6", "Levels/Grid/Heaven_Environment.unity"),
    new NeonWhiteSceneDesc("level7", "Levels/Grid/TUT_MOVEMENT.unity"),
    new NeonWhiteSceneDesc("level8", "Levels/Skyworld/Origin_Environment_Base.unity"),
    new NeonWhiteSceneDesc("level9", "Scenes/EmptyScene.unity"),
    new NeonWhiteSceneDesc("level10", "Levels/Skyworld/Origin_Environment_Underwater_Cutscene.unity"),
    new NeonWhiteSceneDesc("level11", "Levels/Grid/GRID_BOSS_RAPTURE.unity"),
    new NeonWhiteSceneDesc("level12", "Levels/Skyworld/HandOfGod_Environment_Base_LOOKDEV.unity"),
    new NeonWhiteSceneDesc("level13", "Levels/Grid/TUT_ORIGIN.unity"),
    new NeonWhiteSceneDesc("level14", "Levels/Grid/GRID_GODTEMPLE_ENTRY.unity"),
    new NeonWhiteSceneDesc("level15", "Levels/Skyworld/GodTemple_Environment_Base.unity"),
    new NeonWhiteSceneDesc("level16", "Levels/Grid/GRID_BOSS_GODSDEATHTEMPLE.unity"),
    new NeonWhiteSceneDesc("level17", "Art/TEST/GodTemple_InteriorLighting_Test.unity"),
    new NeonWhiteSceneDesc("level18", "Levels/Grid/TUT_FROG.unity"),
    new NeonWhiteSceneDesc("level19", "Levels/Grid/TUT_BOMB2.unity"),
    new NeonWhiteSceneDesc("level20", "Levels/Grid/GRID_PORT.unity"),
    new NeonWhiteSceneDesc("level21", "Levels/Grid/GRID_FAST_BALLOON.unity"),
    new NeonWhiteSceneDesc("level22", "Levels/Grid/GRID_DASHDANCE.unity"),
    new NeonWhiteSceneDesc("level23", "Levels/Grid/TUT_GUARDIAN.unity"),
    new NeonWhiteSceneDesc("level24", "Levels/Skyworld/LowerHeavenCloudy_Environment_Base.unity"),
    new NeonWhiteSceneDesc("level25", "Levels/Grid/GRID_STAMPEROUT.unity"),
    new NeonWhiteSceneDesc("level26", "Levels/Grid/GRID_SUPERKINETIC.unity"),
    new NeonWhiteSceneDesc("level27", "Levels/Grid/GRID_ARRIVAL.unity"),
    new NeonWhiteSceneDesc("level28", "Levels/Skyworld/OldCity_Environment_Base.unity"),
    new NeonWhiteSceneDesc("level29", "Levels/Grid/FLOATING.unity"),
    new NeonWhiteSceneDesc("level30", "Levels/Grid/GRID_HOPHOP.unity"),
    new NeonWhiteSceneDesc("level31", "Levels/Skyworld/LowerHeavenOvercast_Environment_Base.unity"),
    new NeonWhiteSceneDesc("level32", "Levels/Grid/GRID_SNAKE_IN_MY_BOOT.unity"),
    new NeonWhiteSceneDesc("level33", "Levels/Grid/GRID_APARTMENT.unity"),
    new NeonWhiteSceneDesc("level34", "Levels/Grid/TUT_TRIPWIRE.unity"),
    new NeonWhiteSceneDesc("level35", "Levels/Skyworld/HangingGarden_Environment_Base.unity"),
    new NeonWhiteSceneDesc("level36", "Levels/Grid/TUT_SHOCKER2.unity"),
    new NeonWhiteSceneDesc("level37", "Levels/Grid/GRID_RACE.unity"),
    new NeonWhiteSceneDesc("level38", "Levels/Grid/TUT_FORCEFIELD2.unity"),
    new NeonWhiteSceneDesc("level39", "Levels/Skyworld/HangingGarden_Bleak_Environment_Base.unity"),
    new NeonWhiteSceneDesc("level40", "Levels/Grid/TUT_MIMIC.unity"),
    new NeonWhiteSceneDesc("level41", "Levels/Grid/GRID_TRAPS2.unity"),
    new NeonWhiteSceneDesc("level42", "Levels/Grid/TUT_ROCKETJUMP.unity"),
    new NeonWhiteSceneDesc("level43", "Levels/Skyworld/HeavensEdge_Environment_Base.unity"),
    new NeonWhiteSceneDesc("level44", "Levels/Grid/GRID_ESCALATE.unity"),
    new NeonWhiteSceneDesc("level45", "Levels/Grid/GRID_DESTRUCTION.unity"),
    new NeonWhiteSceneDesc("level46", "Levels/Grid/GRID_HEAT.unity"),
    new NeonWhiteSceneDesc("level47", "Levels/Skyworld/HeavensEdgeTwilight_Environment_Base.unity"),
    new NeonWhiteSceneDesc("level48", "Levels/Grid/GRID_BARRAGE.unity"),
    new NeonWhiteSceneDesc("level49", "Levels/Grid/GRID_FORTRESS.unity"),
    new NeonWhiteSceneDesc("level50", "Levels/Grid/GRID_EXTERMINATOR.unity"),
    new NeonWhiteSceneDesc("level51", "Levels/Skyworld/Apocalypse_Environment_Base.unity"),
    new NeonWhiteSceneDesc("level52", "Levels/Grid/GRID_ZIPRAP.unity"),
    new NeonWhiteSceneDesc("level53", "Levels/Grid/GRID_SKIP.unity"),
    new NeonWhiteSceneDesc("level54", "Levels/Grid/GRID_BOSS_YELLOW.unity"),
    new NeonWhiteSceneDesc("level55", "Levels/Skyworld/Holy_Environment_Base.unity"),
    new NeonWhiteSceneDesc("level56", "Scenes/Audio.unity"),
    new NeonWhiteSceneDesc("level57", "Scenes/Menu.unity"),
    new NeonWhiteSceneDesc("level58", "Scenes/MenuHolder.unity"),
    new NeonWhiteSceneDesc("level59", "Scenes/MissionCompleteScene.unity"),
    new NeonWhiteSceneDesc("level60", "Scenes/DialogueScene.unity"),
    new NeonWhiteSceneDesc("level61", "Scenes/Enemies.unity"),
    new NeonWhiteSceneDesc("level62", "Scenes/Player.unity"),
    new NeonWhiteSceneDesc("level63", "Levels/Grid/SLUGGER_Backup.unity"),
    new NeonWhiteSceneDesc("level64", "Levels/Grid/GRID_TUT_JUMP.unity"),
    new NeonWhiteSceneDesc("level65", "Levels/Grid/GRID_TUT_BALLOON.unity"),
    new NeonWhiteSceneDesc("level66", "Levels/Grid/TUT_BOMBJUMP.unity"),
    new NeonWhiteSceneDesc("level67", "Levels/Grid/TUT_FASTTRACK.unity"),
    new NeonWhiteSceneDesc("level68", "Levels/Grid/TUT_RIFLE.unity"),
    new NeonWhiteSceneDesc("level69", "Levels/Grid/TUT_RIFLEJOCK.unity"),
    new NeonWhiteSceneDesc("level70", "Levels/Grid/TUT_DASHENEMY.unity"),
    new NeonWhiteSceneDesc("level71", "Levels/Grid/GRID_JUMPDASH.unity"),
    new NeonWhiteSceneDesc("level72", "Levels/Grid/GRID_SMACKDOWN.unity"),
    new NeonWhiteSceneDesc("level73", "Levels/Grid/GRID_MEATY_BALLOONS.unity"),
    new NeonWhiteSceneDesc("level74", "Levels/Grid/GRID_DRAGON2.unity"),
    new NeonWhiteSceneDesc("level75", "Levels/Grid/TUT_UZI.unity"),
    new NeonWhiteSceneDesc("level76", "Levels/Grid/TUT_JUMPER.unity"),
    new NeonWhiteSceneDesc("level77", "Levels/Grid/GRID_TUT_BOMB.unity"),
    new NeonWhiteSceneDesc("level78", "Levels/Grid/GRID_DESCEND.unity"),
    new NeonWhiteSceneDesc("level79", "Levels/Grid/GRID_CRUISE.unity"),
    new NeonWhiteSceneDesc("level80", "Levels/Grid/GRID_SPRINT.unity"),
    new NeonWhiteSceneDesc("level81", "Levels/Grid/GRID_MOUNTAIN.unity"),
    new NeonWhiteSceneDesc("level82", "Levels/Grid/GRID_RINGER_TUTORIAL.unity"),
    new NeonWhiteSceneDesc("level83", "Levels/Grid/GRID_RINGER_EXPLORATION.unity"),
    new NeonWhiteSceneDesc("level84", "Levels/Grid/GRID_HOPSCOTCH.unity"),
    new NeonWhiteSceneDesc("level85", "Levels/Grid/GRID_BOOM.unity"),
    new NeonWhiteSceneDesc("level86", "Levels/Grid/GRID_FLOCK.unity"),
    new NeonWhiteSceneDesc("level87", "Levels/Grid/GRID_BOMBS_AHOY.unity"),
    new NeonWhiteSceneDesc("level88", "Levels/Grid/GRID_ARCS.unity"),
    new NeonWhiteSceneDesc("level89", "Levels/Grid/GRID_TANGLED.unity"),
    new NeonWhiteSceneDesc("level90", "Levels/Grid/GRID_HUNT.unity"),
    new NeonWhiteSceneDesc("level91", "Levels/Grid/GRID_CANNONS.unity"),
    new NeonWhiteSceneDesc("level92", "Levels/Grid/GRID_FALLING.unity"),
    new NeonWhiteSceneDesc("level93", "Levels/Grid/TUT_SHOCKER.unity"),
    new NeonWhiteSceneDesc("level94", "Levels/Grid/GRID_PREPARE.unity"),
    new NeonWhiteSceneDesc("level95", "Levels/Grid/GRID_TRIPMAZE.unity"),
    new NeonWhiteSceneDesc("level96", "Levels/Grid/GRID_SHIELD.unity"),
    new NeonWhiteSceneDesc("level97", "Levels/Grid/SA L VAGE2.unity"),
    new NeonWhiteSceneDesc("level98", "Levels/Grid/GRID_VERTICAL.unity"),
    new NeonWhiteSceneDesc("level99", "Levels/Grid/GRID_MINEFIELD.unity"),
    new NeonWhiteSceneDesc("level100", "Levels/Grid/GRID_MIMICPOP.unity"),
    new NeonWhiteSceneDesc("level101", "Levels/Grid/GRID_SWARM.unity"),
    new NeonWhiteSceneDesc("level102", "Levels/Grid/GRID_SWITCH.unity"),
    new NeonWhiteSceneDesc("level103", "Levels/Grid/TUT_ZIPLINE.unity"),
    new NeonWhiteSceneDesc("level104", "Levels/Grid/GRID_CLIMBANG.unity"),
    new NeonWhiteSceneDesc("level105", "Levels/Grid/GRID_ROCKETUZI.unity"),
    new NeonWhiteSceneDesc("level106", "Levels/Grid/GRID_CRASHLAND.unity"),
    new NeonWhiteSceneDesc("level107", "Levels/Grid/GRID_SPIDERCLAUS.unity"),
    new NeonWhiteSceneDesc("level108", "Levels/Grid/GRID_FIRECRACKER_2.unity"),
    new NeonWhiteSceneDesc("level109", "Levels/Grid/GRID_SPIDERMAN.unity"),
    new NeonWhiteSceneDesc("level110", "Levels/Grid/GRID_BOLT.unity"),
    new NeonWhiteSceneDesc("level111", "Levels/Grid/GRID_PON.unity"),
    new NeonWhiteSceneDesc("level112", "Levels/Grid/GRID_CHARGE.unity"),
    new NeonWhiteSceneDesc("level113", "Levels/Grid/GRID_MIMICFINALE.unity"),
    new NeonWhiteSceneDesc("level114", "Levels/Grid/GRID_1GUN.unity"),
    new NeonWhiteSceneDesc("level115", "Levels/Grid/GRID_HECK.unity"),
    new NeonWhiteSceneDesc("level116", "Levels/Grid/GRID_ANTFARM.unity"),
    new NeonWhiteSceneDesc("level117", "Levels/Grid/GRID_FEVER.unity"),
    new NeonWhiteSceneDesc("level118", "Levels/Grid/GRID_SKIPSLIDE.unity"),
    new NeonWhiteSceneDesc("level119", "Levels/Grid/GRID_CLOSER.unity"),
    new NeonWhiteSceneDesc("level120", "Levels/Grid/GRID_HIKE.unity"),
    new NeonWhiteSceneDesc("level121", "Levels/Grid/GRID_CEILING.unity"),
    new NeonWhiteSceneDesc("level122", "Levels/Grid/GRID_BOOP.unity"),
    new NeonWhiteSceneDesc("level123", "Levels/Grid/GRID_TRIPRAP.unity"),
    new NeonWhiteSceneDesc("level124", "Levels/Afterlife/Afterlife_Environment_Red.unity"),
    new NeonWhiteSceneDesc("level125", "Levels/Grid/SIDEQUEST_OBSTACLE_PISTOL.unity"),
    new NeonWhiteSceneDesc("level126", "Levels/Grid/SIDEQUEST_OBSTACLE_PISTOL_SHOOT.unity"),
    new NeonWhiteSceneDesc("level127", "Levels/Grid/SIDEQUEST_OBSTACLE_MACHINEGUN.unity"),
    new NeonWhiteSceneDesc("level128", "Levels/Grid/SIDEQUEST_OBSTACLE_RIFLE_2.unity"),
    new NeonWhiteSceneDesc("level129", "Levels/Grid/SIDEQUEST_OBSTACLE_UZI2.unity"),
    new NeonWhiteSceneDesc("level130", "Levels/Grid/SIDEQUEST_OBSTACLE_SHOTGUN.unity"),
    new NeonWhiteSceneDesc("level131", "Levels/Grid/SIDEQUEST_OBSTACLE_ROCKETLAUNCHER.unity"),
    new NeonWhiteSceneDesc("level132", "Levels/Grid/SIDEQUEST_RAPTURE_QUEST.unity"),
    new NeonWhiteSceneDesc("level133", "Levels/Afterlife/Afterlife_Environment_Yellow.unity"),
    new NeonWhiteSceneDesc("level134", "Levels/Grid/SIDEQUEST_SUNSET_FLIP_POWERBOMB.unity"),
    new NeonWhiteSceneDesc("level135", "Levels/Grid/GRID_BALLOONLAIR.unity"),
    new NeonWhiteSceneDesc("level136", "Levels/Grid/SIDEQUEST_BARREL_CLIMB.unity"),
    new NeonWhiteSceneDesc("level137", "Levels/Grid/SIDEQUEST_FISHERMAN_SUPLEX.unity"),
    new NeonWhiteSceneDesc("level138", "Levels/Grid/SIDEQUEST_STF.unity"),
    new NeonWhiteSceneDesc("level139", "Levels/Grid/SIDEQUEST_ARENASIXNINE.unity"),
    new NeonWhiteSceneDesc("level140", "Levels/Grid/SIDEQUEST_ATTITUDE_ADJUSTMENT.unity"),
    new NeonWhiteSceneDesc("level141", "Levels/Grid/SIDEQUEST_ROCKETGODZ.unity"),
    new NeonWhiteSceneDesc("level142", "Levels/Afterlife/Afterlife_Environment_Violet.unity"),
    new NeonWhiteSceneDesc("level143", "Levels/Grid/SIDEQUEST_DODGER.unity"),
    new NeonWhiteSceneDesc("level144", "Levels/Grid/GRID_GLASSPATH.unity"),
    new NeonWhiteSceneDesc("level145", "Levels/Grid/GRID_GLASSPATH2.unity"),
    new NeonWhiteSceneDesc("level146", "Levels/Grid/GRID_HELLVATOR.unity"),
    new NeonWhiteSceneDesc("level147", "Levels/Grid/GRID_GLASSPATH3.unity"),
    new NeonWhiteSceneDesc("level148", "Levels/Grid/SIDEQUEST_ALL_SEEING_EYE.unity"),
    new NeonWhiteSceneDesc("level149", "Levels/Grid/SIDEQUEST_RESIDENTSAWB.unity"),
    new NeonWhiteSceneDesc("level150", "Levels/Grid/SIDEQUEST_RESIDENTSAW.unity"),
    new NeonWhiteSceneDesc("level151", "Levels/Afterlife/Afterlife_Environment_Green.unity"),
    new NeonWhiteSceneDesc("level152", "Levels/Grid/SIDEQUEST_GREEN_MEMORY.unity"),
    new NeonWhiteSceneDesc("level153", "Levels/Grid/SIDEQUEST_GREEN_MEMORY_2.unity"),
    new NeonWhiteSceneDesc("level154", "Levels/Grid/SIDEQUEST_GREEN_MEMORY_3.unity"),
    new NeonWhiteSceneDesc("level155", "Levels/Grid/SIDEQUEST_GREEN_MEMORY_4.unity"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, hidden: true };
