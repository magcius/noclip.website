import { APAK } from "./apak.js";
import { FRES, parseBFRES } from "./bfres/bfres_switch.js";
import * as BNTX from '../fres_nx/bntx.js';
import { deswizzle_and_upload_bntx_textures } from "./bntx_helpers.js";
import { CameraController } from "../Camera.js";
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxDevice, GfxTexture} from "../gfx/platform/GfxPlatform.js";
import { get_level_bfres_names } from "./levels.js";
import { fshp_renderer } from "./render_fshp.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { SceneGfx, ViewerRenderInput } from "../viewer.js";

export class TMSFEScene implements SceneGfx
{
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private fshp_renderers: fshp_renderer[] = [];

    constructor(device: GfxDevice, level_id: string, apak: APAK)
    {
        // get bfres files
        const fres_files: FRES[] = [];
        const level_file_names = get_level_bfres_names(level_id);
        for (let i = 0; i < level_file_names.length; i++)
        {
            const file_name = `${level_file_names[i]}.bfres`
            const file = apak.files.find((f) => f.name === file_name);
            if (file !== undefined)
            {
                fres_files.push(parseBFRES(file.data));
            }
            else
            {
                console.error(`file ${file_name} not found (level_id ${level_id})`);
                throw("whoops");
            }
        }
        // const bfres_buffers = get_files_of_type(apak, "bfres");
        // for (let i = 0; i < bfres_buffers.length; i++)
        // {
        //     fres_files.push(parseBFRES(bfres_buffers[i]));
        // }

        for(let i = 0; i < fres_files.length; i++)
        {
            const fres = fres_files[i];
            this.renderHelper = new GfxRenderHelper(device);

            //initialize textures
            const bntx = BNTX.parse(fres.embedded_files[0].buffer);
            const gfx_texture_array: GfxTexture[] = deswizzle_and_upload_bntx_textures(bntx, device);

            // create all fshp_renderers
            const fmdl = fres.fmdl[0];
            console.log(fmdl);
            const shapes = fmdl.fshp;
            for (let i = 0; i < shapes.length; i++)
            {
                const renderer = new fshp_renderer(device, this.renderHelper, fmdl, i, bntx, gfx_texture_array);
                this.fshp_renderers.push(renderer);
            }
        }
    }

    public adjustCameraController(c: CameraController)
    {
            c.setSceneMoveSpeedMult(2 / 60);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void
    {
        for (let i = 0; i < this.fshp_renderers.length; i++)
        {
            this.fshp_renderers[i].render(this.renderHelper, viewerInput, this.renderInstListMain);
        }

        this.renderHelper.prepareToRender();

        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass
        (
            (pass) =>
            {
                pass.setDebugName('Main');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
                pass.exec
                (
                    (passRenderer) =>
                    {
                        this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
                    }
                );
            }
        );
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void
    {
        this.renderHelper.destroy();
        for (let i = 0; i < this.fshp_renderers.length; i++)
        {
            this.fshp_renderers[i].destroy(device);
        }
    }
}
