import * as BFRES from "../fres_nx/bfres.js";
import * as BNTX from '../fres_nx/bntx.js';
import { deswizzle_and_upload_bntx_textures } from "./bntx_helpers.js";
import { CameraController } from "../Camera.js";
import { colorNewFromRGBA } from '../Color.js';
import { drawWorldSpaceAABB, drawWorldSpacePoint, getDebugOverlayCanvas2D } from '../DebugJunk.js';
import { FMAA } from './bfres/fmaa.js';
import { FSKA } from "./bfres/fska.js";
import { AABB } from '../Geometry.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxDevice, GfxTexture} from "../gfx/platform/GfxPlatform.js";
import { gimmick } from "./gimmick.js";
import { vec3, mat4 } from "gl-matrix";
import { LightmapTexture } from './lightmap.js';
import { Light } from './lights.js';
import { MapLayout } from './maplayout.js';
import { fmdl_renderer } from "./render_fmdl.js";
import { fmdl_renderer_texture_replace, replacement_texture_group } from './render_fmdl_texture_replace.js';
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { level_model } from "./scenes.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { computeModelMatrixSRT } from '../MathHelpers.js';

export class TMSFEScene implements SceneGfx
{
    private renderHelper: GfxRenderHelper;
    private renderInstListOpaque = new GfxRenderInstList();
    private renderInstListTranslucent = new GfxRenderInstList();
    private renderInstListSkybox = new GfxRenderInstList();
    private fmdl_renderers: fmdl_renderer[] = [];
    private layout: MapLayout | undefined; // this level's MapLayout, containing coordinates and areas to spawn objects or trigger flags
    private common_gimmicks: gimmick[] = [];
    private map_gimmicks: gimmick[] = [];
    private lights: Light[] = [];

    /**
     * @param level_models array of level_model objects containing groups of FRES objects for a single model
     * @param special_skybox this level has a smaller skybox that follows the camera
     * @param replacement_textures for displaying dynamic posters, tvs, and advertisements in certain maps
     */
    constructor
    (
        device: GfxDevice,
        level_models: level_model[],
        special_skybox: boolean,
        replacement_texture_groups: replacement_texture_group[],
        layout: MapLayout | undefined,
        common_gimmicks: gimmick[],
        map_gimmicks: gimmick[],
        lights: Light[],
    )
    {
        this.renderHelper = new GfxRenderHelper(device);
        this.layout = layout;
        this.common_gimmicks = common_gimmicks;
        this.map_gimmicks = map_gimmicks;
        this.lights = lights;

        // create all fmdl renderers
        for(let level_models_index = 0; level_models_index < level_models.length; level_models_index++)
        {
            const model_fres = level_models[level_models_index].model_fres;
            const fmdl = model_fres.fmdl[0];
            let lightmaps: LightmapTexture[] | undefined = level_models[level_models_index].lightmaps;
            let special_skybox_model: boolean = special_skybox && fmdl.name == "sky";

            // initialize textures
            // textures are stored in an embedded .bntx file
            const bntx = BNTX.parse(model_fres.externalFiles[0].buffer);
            const gfx_texture_array: GfxTexture[] = deswizzle_and_upload_bntx_textures(bntx, device);
            const replacement_textures_group = replacement_texture_groups.find((f) => f.model_name === fmdl.name);
            
            // get animations
            let fska: BFRES.FSKA | undefined = undefined;
            let fmaa: BFRES.FMAA | undefined = undefined;
            const animation_fres = level_models[level_models_index].animation_fres;
            if (animation_fres != undefined)
            {
                if (animation_fres.fska.length > 0)
                {
                    fska = animation_fres.fska[0];
                }
                if (animation_fres.fmaa.length > 0)
                {
                    fmaa = animation_fres.fmaa[0];
                }
            }

            let renderer: fmdl_renderer;
            if (replacement_textures_group != undefined)
            {
                renderer = new fmdl_renderer_texture_replace
                (
                    fmdl,
                    bntx,
                    gfx_texture_array,
                    fska,
                    fmaa,
                    lightmaps,
                    vec3.fromValues(0.0, 0.0, 0.0),
                    vec3.fromValues(0.0, 0.0, 0.0),
                    vec3.fromValues(1.0, 1.0, 1.0),
                    special_skybox_model,
                    device,
                    this.renderHelper,
                    replacement_textures_group.replacement_textures,
                );
            }
            else
            {
                renderer = new fmdl_renderer
                (
                    fmdl,
                    bntx,
                    gfx_texture_array,
                    fska,
                    fmaa,
                    lightmaps,
                    vec3.fromValues(0.0, 0.0, 0.0),
                    vec3.fromValues(0.0, 0.0, 0.0),
                    vec3.fromValues(1.0, 1.0, 1.0),
                    special_skybox_model,
                    device,
                    this.renderHelper,
                );
            }

            this.fmdl_renderers.push(renderer);
        }
    }

    public adjustCameraController(c: CameraController)
    {
            c.setSceneMoveSpeedMult(2 / 60);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void
    {
        // this.debug_draw_layout_entries(viewerInput);
        // this.debug_draw_lights(viewerInput);

        // create draw calls for all the models
        for (let i = 0; i < this.fmdl_renderers.length; i++)
        {
            this.fmdl_renderers[i].render(this.renderHelper, viewerInput, this.renderInstListOpaque, this.renderInstListTranslucent, this.renderInstListSkybox);
        }

        for (let i = 0; i < this.common_gimmicks.length; i++)
        {
            this.common_gimmicks[i].fmdl_renderer.render(this.renderHelper, viewerInput, this.renderInstListOpaque, this.renderInstListTranslucent, this.renderInstListSkybox);
        }

        for (let i = 0; i < this.map_gimmicks.length; i++)
        {
            this.map_gimmicks[i].fmdl_renderer.render(this.renderHelper, viewerInput, this.renderInstListOpaque, this.renderInstListTranslucent, this.renderInstListSkybox);
        }

        this.renderHelper.prepareToRender();

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');

        // render skybox first, then clear the depth buffer and render everything else
        const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
        builder.pushPass
        (
            (pass) =>
            {
                pass.setDebugName('Skybox');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
                pass.exec
                (
                    (passRenderer) =>
                    {
                        this.renderInstListSkybox.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
                    }
                );
            }
        );
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass
        (
            (pass) =>
            {
                pass.setDebugName('Opaque');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
                pass.exec
                (
                    (passRenderer) =>
                    {
                        this.renderInstListOpaque.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
                    }
                );
            }
        );
        builder.pushPass
        (
            (pass) =>
            {
                pass.setDebugName('Translucent');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
                pass.exec
                (
                    (passRenderer) =>
                    {
                        this.renderInstListTranslucent.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
                    }
                );
            }
        );

        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListOpaque.reset();
        this.renderInstListTranslucent.reset();
        this.renderInstListSkybox.reset();
    }

    public destroy(device: GfxDevice): void
    {
        this.renderHelper.destroy();
        for (let i = 0; i < this.fmdl_renderers.length; i++)
        {
            this.fmdl_renderers[i].destroy(device);
        }
        for (let i = 0; i < this.common_gimmicks.length; i++)
        {
            this.common_gimmicks[i].destroy(device);
        }
        for (let i = 0; i < this.map_gimmicks.length; i++)
        {
            this.map_gimmicks[i].destroy(device);
        }
    }

    debug_draw_layout_entries(viewerInput: ViewerRenderInput)
    {
        if (this.layout != undefined)
        {
            const group = this.layout.entries;
            
            for (let i = 0; i < group.length; i++)
            {
                const entry = group[i];
                if (entry.group_index != 12)
                {
                    continue;
                }
                const box = new AABB();
                box.setFromCenterAndHalfExtents(vec3.fromValues(0.0, 0.0, 0.0), entry.half_extents);
                const transform_matrix = mat4.create();
                computeModelMatrixSRT
                (
                    transform_matrix,
                    1.0, 1.0, 1.0,
                    entry.rotation[0], entry.rotation[1], entry.rotation[2],
                    entry.position[0], entry.position[1], entry.position[2],
                );

                drawWorldSpaceAABB(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, box, transform_matrix);
            }
        }
    }

    debug_draw_lights(viewerInput: ViewerRenderInput)
    {
        if (this.lights != undefined)
        {
            for (let i = 0; i < this.lights.length; i++)
            {
                const light = this.lights[i];
                drawWorldSpacePoint(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix , light.position, light.color, 10);
            }
        }
    }
}
