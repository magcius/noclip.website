import { GfxDevice, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxInputLayoutBufferDescriptor,
         GfxVertexBufferFrequency, GfxInputLayout, GfxFormat, GfxProgram, GfxBufferFrequencyHint,
         GfxBufferUsage, GfxBindingLayoutDescriptor, GfxCullMode } from "../gfx/platform/GfxPlatform.js";
import { SceneGfx, SceneGroup, ViewerRenderInput } from "../viewer.js";
import { SceneContext, SceneDesc } from "../SceneBase.js";
// import * as BFRES from "./bfres_wiiu.js";
import * as BFRES from "./bfres_switch.js";
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { DeviceProgram } from '../Program.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';
import { GfxRenderInstList, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { createBufferFromData, createBufferFromSlice } from "../gfx/helpers/BufferHelpers.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { fillColor, fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';

class TMSFEProgram extends DeviceProgram {
    public static a_Position = 0;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat3x4 u_ModelView;
};

#ifdef VERT
layout(location = ${TMSFEProgram.a_Position}) attribute vec3 a_Position;

void mainVS()
{
    vec3 t_PositionWorld = UnpackMatrix(u_ModelView) * vec4(a_Position, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_PositionWorld, 1.0);
}
#endif

#ifdef FRAG
void mainPS()
{
    gl_FragColor = u_Color + vec4(0.0, 0.0, 1.0, 0.0);
}
#endif
`;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] =
[
    { numUniformBuffers: 1, numSamplers: 0 },
];

class TMSFEScene implements SceneGfx
{
    private renderHelper: GfxRenderHelper;
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private vertexBufferDescriptors: (GfxVertexBufferDescriptor | null)[];
    private renderInstListMain = new GfxRenderInstList();

    constructor(device: GfxDevice, fmdl: BFRES.FMDL)
    {
        console.log(fmdl)
        
        this.renderHelper = new GfxRenderHelper(device);
        this.program = this.renderHelper.renderCache.createProgram(new TMSFEProgram());

        const fvtx = fmdl.fvtx[0];
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] =
        [
            { location: 0, format: fvtx.vertexAttributes[0].format, bufferIndex: fvtx.vertexAttributes[0].bufferIndex, bufferByteOffset: fvtx.vertexAttributes[0].bufferOffset},
        ];
        console.log(vertexAttributeDescriptors);

        const inputLayoutBufferDescriptors: GfxInputLayoutBufferDescriptor[] =
        [
            { byteStride: fvtx.vertexBuffers[0].stride, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        console.log(inputLayoutBufferDescriptors);

        const indexBufferFormat: GfxFormat | null = null;
        const cache = this.renderHelper.renderCache;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors: inputLayoutBufferDescriptors, indexBufferFormat });

        
        const gfx_buffer = createBufferFromSlice(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, fvtx.vertexBuffers[0].data);
        this.vertexBufferDescriptors =
        [
            { buffer: gfx_buffer },
        ];

    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void
    {
        const renderInst = this.renderHelper.renderInstManager.newRenderInst();
        renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, null);
        renderInst.setDrawCount(3022);
        renderInst.setBindingLayouts(bindingLayouts);
        renderInst.setGfxProgram(this.program);
        renderInst.setMegaStateFlags({ cullMode: GfxCullMode.Back });

        let offs = renderInst.allocateUniformBuffer(TMSFEProgram.ub_SceneParams, 32);
        const mapped = renderInst.mapUniformBufferF32(TMSFEProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(mapped, offs, viewerInput.camera.viewMatrix);

        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);

        this.renderHelper.renderInstManager.submitRenderInst(renderInst);
        
        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

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
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void
    {
        this.renderHelper.destroy();
    }
}

class TMSFESceneDesc implements SceneDesc
{
    constructor(public id: string, public name: string) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx>
    {
        // Load the map file
        const dataFetcher = context.dataFetcher;
        // const apak = dataFetcher.fetchData(`TokyoMirageSessionsSharpFE/maps/${this.id}/model.apak`);
        // const bfres = BFRES.parse(await dataFetcher.fetchData("TokyoMirageSessionsSharpFE/d008_01.bfres"));
        const bfres = BFRES.parse(await dataFetcher.fetchData("TokyoMirageSessionsSharpFE/b016_01.bfres"));
        let renderer = new TMSFEScene(device, bfres.fmdl[0]);
        return renderer;
    }
}

const id = `TokyoMirageSessionsSharpFE`;
const name = "MOVE THIS LATER Tokyo Mirage Sessions ♯FE";
const sceneDescs =
[
    "Illusory Daitama",
    new TMSFESceneDesc("d002_01", "Illusory Daitama"),
    new TMSFESceneDesc("d002_02", "Blue Observatory"),
    new TMSFESceneDesc("d002_03", "Red Observatory"),
    "Illusory 106",
    new TMSFESceneDesc("d003_01", "1F to 3F"),
    new TMSFESceneDesc("d003_04", "4F"),
    new TMSFESceneDesc("d003_02", "5F to 7F"),
    new TMSFESceneDesc("d003_06", "Outside"),
    new TMSFESceneDesc("d003_03", "B1 to B3"),
    new TMSFESceneDesc("d003_07", "B4F"),
    new TMSFESceneDesc("d003_08", "Outside 2"),
    "Illusory Shibuya",
    new TMSFESceneDesc("d004_01", "Block 1"),
    new TMSFESceneDesc("d004_02", "Block 2"),
    new TMSFESceneDesc("d004_03", "Block 3"),
    new TMSFESceneDesc("d004_04", "Circular Square"),
    new TMSFESceneDesc("d004_05", "Central Square"),
    new TMSFESceneDesc("d004_06", "Central Square 2"),
    "Illusory Daitou TV",
    new TMSFESceneDesc("d005_01", "Film Set A: Outdoors"),
    new TMSFESceneDesc("d005_03", "Film Set A: Indoors"),
    new TMSFESceneDesc("d005_02", "Film Set B: Outdoors"),
    new TMSFESceneDesc("d005_04", "Film Set B: Indoors"),
    new TMSFESceneDesc("d005_05", "Main Stage 1"),
    new TMSFESceneDesc("d005_06", "Main Stage 2"),
    new TMSFESceneDesc("d005_07", "Main Stage 3"),
    "Illusory Daiba Studio",
    new TMSFESceneDesc("d006_10", "Entrance"),
    new TMSFESceneDesc("d006_01", "Monitor Room"),
    new TMSFESceneDesc("d006_02", "Main Hallway"),
    new TMSFESceneDesc("d006_03", "LCD Panels"),
    new TMSFESceneDesc("d006_04", "Back Monitor Room"),
    new TMSFESceneDesc("d006_05", "Back Alley"),
    new TMSFESceneDesc("d006_06", "Film Location A"),
    new TMSFESceneDesc("d006_07", "Film Location B"),
    new TMSFESceneDesc("d006_08", "Film Location C"),
    new TMSFESceneDesc("d006_09", "Film Location D"),
    "Illusory Area of Memories",
    new TMSFESceneDesc("d010_01", "Great Corridor"),
    new TMSFESceneDesc("d010_02", "Warrior's Hall"),
    new TMSFESceneDesc("d010_03", "Leader's Hall"),
    new TMSFESceneDesc("d010_04", "Hero's Hall"),
    "Illusory Dolhr",
    new TMSFESceneDesc("d007_01", "Altitude 48m to Altitude 54m"),
    new TMSFESceneDesc("d007_05", "Altitude 88m"),
    new TMSFESceneDesc("d007_02", "Altitude 122m to Altitude 146m "),
    new TMSFESceneDesc("d007_06", "Altitude 180m"),
    new TMSFESceneDesc("d007_03", "Altitude 232m to Altitude 238m"),
    new TMSFESceneDesc("d007_07", "Altitude 333m"),
    new TMSFESceneDesc("d007_04", "Altitude 428m to Altitude 434m"),
    new TMSFESceneDesc("d007_08", "Altitude 525m"),
    new TMSFESceneDesc("d007_09", "Altitude 634m"),
    new TMSFESceneDesc("d007_10", "Shadow Stage"),
    "Illusory Urahara",
    new TMSFESceneDesc("d008_01", "Arena"),
    "Illusory Area of Aspirations",
    new TMSFESceneDesc("d018_01", "1F to 2F"),
    new TMSFESceneDesc("d018_02", "3F"),
    new TMSFESceneDesc("d018_03", "4F to 5F"),
    new TMSFESceneDesc("d018_04", "The Nexus"),
    "Training Area",
    new TMSFESceneDesc("d015_01", "Training Area"),
    new TMSFESceneDesc("d015_02", "Fighter's Hall"),
    "Battle Maps",
    new TMSFESceneDesc("b001_01", "b001_01"),
    new TMSFESceneDesc("b002_01", "b002_01"),
    new TMSFESceneDesc("b003_01", "b003_01"),
    new TMSFESceneDesc("b004_01", "b004_01"),
    new TMSFESceneDesc("b005_01", "b005_01"),
    new TMSFESceneDesc("b006_01", "b006_01"),
    new TMSFESceneDesc("b007_01", "b007_01"),
    new TMSFESceneDesc("b008_01", "b008_01"),
    new TMSFESceneDesc("b009_01", "b009_01"),
    new TMSFESceneDesc("b010_01", "b010_01"),
    new TMSFESceneDesc("b011_01", "b011_01"),
    new TMSFESceneDesc("b012_01", "b012_01"),
    new TMSFESceneDesc("b013_01", "b013_01"),
    new TMSFESceneDesc("b014_01", "b014_01"),
    new TMSFESceneDesc("b015_01", "b015_01"),
    new TMSFESceneDesc("b016_01", "b016_01"),
    "Tokyo",
    new TMSFESceneDesc("f003_02", "Fortuna Office"),
    new TMSFESceneDesc("f003_03", "Bloom Palace"),
    new TMSFESceneDesc("f001_01", "Shibuya 1"),
    new TMSFESceneDesc("f001_02", "Shibuya 2"),
    new TMSFESceneDesc("f001_03", "Shibuya 3"),
    new TMSFESceneDesc("f001_04", "Shibuya 4"),
    new TMSFESceneDesc("f001_05", "Shibuya 5"),
    new TMSFESceneDesc("f001_06", "Shibuya 6"),
    new TMSFESceneDesc("f001_07", "Shibuya 7"),
    new TMSFESceneDesc("f003_01", "Hee Ho Mart 1"),
    new TMSFESceneDesc("f003_09", "Hee Ho Mart 2"),
    new TMSFESceneDesc("f003_10", "Hee Ho Mart 3"),
    new TMSFESceneDesc("f003_04", "Carabia"),
    new TMSFESceneDesc("f003_05", "Uzume Lesson Studio"),
    new TMSFESceneDesc("f003_06", "Café Seiren"),
    new TMSFESceneDesc("f003_07", "???"),
    new TMSFESceneDesc("f003_08", "Anzu"),
    new TMSFESceneDesc("f005_01", "Daiba Studio"),
    new TMSFESceneDesc("f005_02", "Daiba Studio 2"),
    new TMSFESceneDesc("f002_01", "Daitama Observatory 1"),
    new TMSFESceneDesc("f002_02", "Daitama Observatory 2"),
    new TMSFESceneDesc("f002_03", "Daitama Observatory 3"),
    new TMSFESceneDesc("f004_01", "Daitou TV 1"),
    new TMSFESceneDesc("f004_02", "Daitou TV 2"),
    new TMSFESceneDesc("f006_01", "Cosmic Egg 1"),
    new TMSFESceneDesc("f006_02", "Cosmic Egg 2"),
    new TMSFESceneDesc("f010_01", "Toubu Rooftop"),
    new TMSFESceneDesc("f010_02", "Classroom Film Set"),
    new TMSFESceneDesc("f007_01", "Harajuku"),
    new TMSFESceneDesc("f007_02", "????"),
    new TMSFESceneDesc("f010_03", "Masqueraider Raiga"),
    new TMSFESceneDesc("f010_04", "Hot Spring"),
    new TMSFESceneDesc("f010_05", "Microwavin' with Mamorin Set"),
    new TMSFESceneDesc("f010_06", "Dressing Room"),
    new TMSFESceneDesc("f010_07", "Fashion Show Runway"),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
