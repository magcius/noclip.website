import * as BIN from "./bin";
import * as Viewer from '../viewer';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxBindingLayoutDescriptor, GfxDevice, GfxHostAccessPass, GfxRenderPass } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { SceneContext } from '../SceneBase';
import { FakeTextureHolder } from '../TextureHolder';
import { hexzero } from '../util';
import { FFXProgram, LevelModelInstance, LevelPartData } from "./render";
import { gsMemoryMapNew } from "../Common/PS2/GS";
import { CameraController } from "../Camera";
import { computeModelMatrixR, setMatrixTranslation } from "../MathHelpers";

const pathBase = `ffx`;

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 2, numSamplers: 1 }];

class FFXRenderer implements Viewer.SceneGfx {
    public renderTarget = new BasicRenderTarget();
    public renderHelper: GfxRenderHelper;
    public textureHolder = new FakeTextureHolder([]);

    public models: LevelModelInstance[] = [];
    public partData: LevelPartData[] = [];

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(.003);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const renderInstManager = this.renderHelper.renderInstManager;

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor);

        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();

        return passRenderer;
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(.1);

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        const offs = template.allocateUniformBuffer(FFXProgram.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(FFXProgram.ub_SceneParams);
        fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.models.length; i++)
            this.models[i].prepareToRender(this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.partData.length; i++)
            this.partData[i].destroy(device);
    }
}



class FFXLevelSceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(private index: number, public name: string) {
        this.id = hexzero(index, 3);
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        // const textureData = await context.dataFetcher.fetchData(`${pathBase}/13/${hexzero(2*this.index, 4)}.bin`);
        const geometryData = await context.dataFetcher.fetchData(`${pathBase}/13/${hexzero(2 * this.index + 1, 4)}.bin`);


        const renderer = new FFXRenderer(device);
        const gsMap = gsMemoryMapNew();
        const parts = BIN.parseLevelGeometry(geometryData, gsMap, this.id);
        console.log(parts)
        const cache = renderer.renderHelper.getCache();
        for (let p of parts) {
            const data = new LevelPartData(device, cache, p);
            renderer.partData.push(data);
            for (let i = 0; i < p.models.length; i++) {
                const model = new LevelModelInstance(device, cache, data.modelData[i]);
                computeModelMatrixR(model.modelMatrix, p.euler[0], p.euler[1], p.euler[2]);
                setMatrixTranslation(model.modelMatrix, p.position)
                renderer.models.push(model);
            }
        }

        return renderer;
    }
}

const id = 'ffx';
const name = 'Final Fantasy X';

const sceneDescs = [
    "Intro",
    new FFXLevelSceneDesc(0x10, 'intro (present zanarkand)'),
    "Zanarkand (past)",
    new FFXLevelSceneDesc(0xd, 'd'),
    new FFXLevelSceneDesc(0xe, 'e'),
    new FFXLevelSceneDesc(0xf, 'Tidus house (interior)'),
    new FFXLevelSceneDesc(0x11, 'Tidus house (exterior)'),
    new FFXLevelSceneDesc(0x12, 'zanarkand road (destroyed)'),
    new FFXLevelSceneDesc(0x13, 'short zanarkand road (destroyed)'),
    new FFXLevelSceneDesc(0x14, 'Tidus house (exterior)'),
    // new FFXLevelSceneDesc(0x16, '16'),
    // new FFXLevelSceneDesc(0x17, '17'),
    new FFXLevelSceneDesc(0x18, 'zanarkand road'),
    "Submerged Ruins",
    new FFXLevelSceneDesc(30, 'Submerged Ruins'),
    new FFXLevelSceneDesc(32, 'fish boss area'),
    new FFXLevelSceneDesc(33, 'entryway'),
    new FFXLevelSceneDesc(34, 'center'),
    new FFXLevelSceneDesc(35, 'center (repaired)'),
    new FFXLevelSceneDesc(36, 'staircase'),
    new FFXLevelSceneDesc(37, 'flint room'),
    "Baaj Temple",
    new FFXLevelSceneDesc(38, 'flooded hallway'),
    new FFXLevelSceneDesc(40, 'baaj temple'),
    new FFXLevelSceneDesc(42, 'anima chamber'),
    'Al Bhed Diving',
    new FFXLevelSceneDesc(50, 'boat, night'),
    new FFXLevelSceneDesc(51, 'under boat'),
    new FFXLevelSceneDesc(52, 'boat, day'),
    new FFXLevelSceneDesc(57, 'sunken airship interior'),
    new FFXLevelSceneDesc(58, 'sunken airship'),
    'Besaid',
    new FFXLevelSceneDesc(65, 'beach (no boat)'),
    new FFXLevelSceneDesc(66, 'beach (boat)'),
    new FFXLevelSceneDesc(67, 'fork'),
    new FFXLevelSceneDesc(68, 'pool'),
    new FFXLevelSceneDesc(69, 'ruins path'),
    new FFXLevelSceneDesc(70, 'long path'),
    new FFXLevelSceneDesc(71, 'overlook'),
    new FFXLevelSceneDesc(72, 'village path'),
    new FFXLevelSceneDesc(75, 'village'),
    new FFXLevelSceneDesc(76, 'village (night)'),
    new FFXLevelSceneDesc(77, 'crusaders hut'),
    new FFXLevelSceneDesc(78, 'crusaders hut (night)'),
    // new FFXLevelSceneDesc(79, '79'),
    // new FFXLevelSceneDesc(80, '80'),
    // new FFXLevelSceneDesc(81, '81'),
    // new FFXLevelSceneDesc(82, '82'),
    // new FFXLevelSceneDesc(83, '83'),
    // new FFXLevelSceneDesc(84, '84'),
    new FFXLevelSceneDesc(85, 'temple'),
    new FFXLevelSceneDesc(86, 'cloister of trials'),
    // new FFXLevelSceneDesc(87, '87'),
    // new FFXLevelSceneDesc(88, '88'),
    new FFXLevelSceneDesc(89, 'valefor chamber (exterior)'),
    new FFXLevelSceneDesc(90, 'valefor chamber'),
    "Boat to Kilika",
    new FFXLevelSceneDesc(95, 'boat'),
    new FFXLevelSceneDesc(97, 'boat 2'),
    new FFXLevelSceneDesc(98, 'wheel?'),
    new FFXLevelSceneDesc(99, '99'),
    new FFXLevelSceneDesc(102, '102'),
    new FFXLevelSceneDesc(103, 'big wheel'),
    new FFXLevelSceneDesc(105, 'boat (sunset)'),
    new FFXLevelSceneDesc(106, 'under boat'),
    "Kilika",
    new FFXLevelSceneDesc(115, 'Kilika (destroyed)'),
    new FFXLevelSceneDesc(116, 'Kilika (partially repaired)'),
    new FFXLevelSceneDesc(117, 'Kilika'),
    new FFXLevelSceneDesc(122, 'Kilika (airship)'),
    // new FFXLevelSceneDesc(124, '124'),
    new FFXLevelSceneDesc(125, 'Kilika (sending)'),
    // new FFXLevelSceneDesc(126, '126'),
    // new FFXLevelSceneDesc(127, '127'),
    // new FFXLevelSceneDesc(128, '128'),
    // new FFXLevelSceneDesc(129, '129'),
    // new FFXLevelSceneDesc(130, '130'),
    new FFXLevelSceneDesc(131, 'Forest'),
    new FFXLevelSceneDesc(132, 'Temple Steps'),
    // new FFXLevelSceneDesc(133, '133'),
    "Kilika Temple",
    new FFXLevelSceneDesc(134, 'Temple (exterior)'),
    new FFXLevelSceneDesc(135, 'Temple (interior)'),
    // new FFXLevelSceneDesc(136, '136'),
    // new FFXLevelSceneDesc(137, '137'),
    new FFXLevelSceneDesc(138, 'elevator'),
    new FFXLevelSceneDesc(139, 'Cloister of Trials'),
    new FFXLevelSceneDesc(140, 'ifrit chamber (exterior)'),
    new FFXLevelSceneDesc(141, 'ifrit chamber (interior)'),
    "S.S. Liki",
    new FFXLevelSceneDesc(145, 'boat'),
    new FFXLevelSceneDesc(147, 'boat (night)'),
    new FFXLevelSceneDesc(148, 'boat wheel'),
    new FFXLevelSceneDesc(149, '149'),
    new FFXLevelSceneDesc(152, '152'),
    new FFXLevelSceneDesc(153, '153'),
    new FFXLevelSceneDesc(154, '154'),
    "Luca",
    new FFXLevelSceneDesc(165, 'information'),
    new FFXLevelSceneDesc(166, 'airship dock'),
    new FFXLevelSceneDesc(167, 'boat dock'),
    new FFXLevelSceneDesc(168, 'double boat dock'),
    new FFXLevelSceneDesc(169, 'empty dock'),
    new FFXLevelSceneDesc(170, 'cargo dock'),
    new FFXLevelSceneDesc(171, 'blitzball stadium (entry)'),
    new FFXLevelSceneDesc(172, 'blitzball stadium (stands)'),
    new FFXLevelSceneDesc(173, 'blitzball stadium (playing)'),
    new FFXLevelSceneDesc(174, '174'),
    new FFXLevelSceneDesc(175, '175'),
    // new FFXLevelSceneDesc(176, '176'),
    new FFXLevelSceneDesc(177, '177'),
    new FFXLevelSceneDesc(178, 'locker room'),
    new FFXLevelSceneDesc(179, 'locker room hallway'),
    new FFXLevelSceneDesc(180, 'airship again'),
    new FFXLevelSceneDesc(183, 'promenade'),
    new FFXLevelSceneDesc(186, 'shops'),
    new FFXLevelSceneDesc(189, '189'),
    new FFXLevelSceneDesc(191, 'ha ha ha'),
    new FFXLevelSceneDesc(193, '193'),
    "Mi'ihen highroad",
    new FFXLevelSceneDesc(210, "Mi\'ihen highroad"),
    new FFXLevelSceneDesc(211, 'inn (night)'),
    new FFXLevelSceneDesc(212, 'inn (day)'),
    // new FFXLevelSceneDesc(213, '213'),
    new FFXLevelSceneDesc(214, 'chocobo road'),
    new FFXLevelSceneDesc(215, 'chocobo road 2'),
    new FFXLevelSceneDesc(217, 'highroad again'),
    new FFXLevelSceneDesc(218, 'highroad again'),
    "Operation Mi'ihen",
    new FFXLevelSceneDesc(216, 'camp'),
    new FFXLevelSceneDesc(220, 'road'),
    new FFXLevelSceneDesc(221, 'more road'),
    new FFXLevelSceneDesc(222, 'battle area'),
    new FFXLevelSceneDesc(223, 'battle area again'),
    "Mushroom Rock Road",
    new FFXLevelSceneDesc(224, 'mushroomy road'),
    new FFXLevelSceneDesc(225, 'elevator'),
    new FFXLevelSceneDesc(226, '226'),
    new FFXLevelSceneDesc(227, 'post battle'),
    new FFXLevelSceneDesc(228, '228'),
    new FFXLevelSceneDesc(229, 'beach with casualties'),
    "Moonflow",
    new FFXLevelSceneDesc(245, 'entry path'),
    new FFXLevelSceneDesc(246, 'near side'),
    new FFXLevelSceneDesc(247, 'crane'),
    new FFXLevelSceneDesc(249, '249'),
    new FFXLevelSceneDesc(250, '250'),
    new FFXLevelSceneDesc(251, '251'),
    new FFXLevelSceneDesc(254, '254'),
    new FFXLevelSceneDesc(255, 'on shoopuf'),
    new FFXLevelSceneDesc(256, '256'),
    new FFXLevelSceneDesc(257, '257'),
    new FFXLevelSceneDesc(258, '258'),
    new FFXLevelSceneDesc(260, 'far side'),
    "Guadosalam",
    new FFXLevelSceneDesc(261, 'entrance'),
    new FFXLevelSceneDesc(265, 'Guadosalam'),
    // new FFXLevelSceneDesc(266, '266'),
    // new FFXLevelSceneDesc(267, '267'),
    // new FFXLevelSceneDesc(268, '268'),
    // new FFXLevelSceneDesc(269, '269'),
    new FFXLevelSceneDesc(270, 'Seymour atrium'),
    new FFXLevelSceneDesc(271, 'Seymour banquet'),
    new FFXLevelSceneDesc(272, 'Yunalesca chamber'),
    // new FFXLevelSceneDesc(275, '275'),
    // new FFXLevelSceneDesc(276, '276'),
    new FFXLevelSceneDesc(281, 'Farplane'),
    // new FFXLevelSceneDesc(282, '282'),
    new FFXLevelSceneDesc(283, 'Farplane again'),
    "Thunderplains",
    new FFXLevelSceneDesc(300, 'Thunderplains'),
    // new FFXLevelSceneDesc(301, '301'),
    new FFXLevelSceneDesc(302, '302'),
    new FFXLevelSceneDesc(303, 'Thunderplains 2'),
    new FFXLevelSceneDesc(304, '304'),
    // new FFXLevelSceneDesc(308, '308'),
    "Macalania Woods",
    new FFXLevelSceneDesc(310, 'entrance'),
    new FFXLevelSceneDesc(311, 'tree path'),
    new FFXLevelSceneDesc(312, 'more tree path'),
    new FFXLevelSceneDesc(313, 'pool'),
    new FFXLevelSceneDesc(314, 'exit'),
    // new FFXLevelSceneDesc(315, '315'),
    // new FFXLevelSceneDesc(316, '316'),
    // new FFXLevelSceneDesc(317, '317'),
    // new FFXLevelSceneDesc(318, '318'),
    // new FFXLevelSceneDesc(319, '319'),

    // new FFXLevelSceneDesc(321, '321'),
    new FFXLevelSceneDesc(322, 'big pool'),
    new FFXLevelSceneDesc(323, 'big pool again'),
    new FFXLevelSceneDesc(324, 'trees'),
    // new FFXLevelSceneDesc(321, '321'),
    new FFXLevelSceneDesc(322, 'big pool again'),
    new FFXLevelSceneDesc(323, 'big pool agaaaaain'),
    new FFXLevelSceneDesc(324, 'trees with path'),
    "Macalania",
    new FFXLevelSceneDesc(330, 'inn'),
    // new FFXLevelSceneDesc(331, '331'),
    new FFXLevelSceneDesc(332, 'ice battle'),
    new FFXLevelSceneDesc(333, 'snow road'),
    new FFXLevelSceneDesc(335, 'temple entrance'),
    "Macalania Temple",
    new FFXLevelSceneDesc(334, 'under temple'),
    new FFXLevelSceneDesc(340, 'temple exterior'),
    new FFXLevelSceneDesc(341, 'temple (interior)'),
    // new FFXLevelSceneDesc(342, '342'),
    // new FFXLevelSceneDesc(343, '343'),
    new FFXLevelSceneDesc(344, 'cloister of trials entrance'),
    new FFXLevelSceneDesc(345, 'shiva chamber entrace'),
    new FFXLevelSceneDesc(346, 'shiva chamber'),
    "Bikanel Desert",
    new FFXLevelSceneDesc(350, 'oasis'),
    new FFXLevelSceneDesc(351, 'first tent'),
    new FFXLevelSceneDesc(352, 'desert'),
    new FFXLevelSceneDesc(353, 'cacti'),
    // new FFXLevelSceneDesc(354, '354'),
    new FFXLevelSceneDesc(360, 'scrap metal'),
    "Al Bhed Home",
    new FFXLevelSceneDesc(363, '363'),
    new FFXLevelSceneDesc(364, 'home'),
    // new FFXLevelSceneDesc(365, '365'),
    // new FFXLevelSceneDesc(366, '366'),
    // new FFXLevelSceneDesc(367, '367'),
    // new FFXLevelSceneDesc(368, '368'),

    new FFXLevelSceneDesc(380, 'hidden object'),
    // new FFXLevelSceneDesc(382, '382'),
    // new FFXLevelSceneDesc(385, '385'),
    new FFXLevelSceneDesc(388, 'airship cabin and hallway'),
    // new FFXLevelSceneDesc(392, '392'),
    new FFXLevelSceneDesc(395, 'airship exterior'),
    new FFXLevelSceneDesc(396, 'airship cabin'),
    // new FFXLevelSceneDesc(397, '397'),
    new FFXLevelSceneDesc(398, 'airship cabin again'),
    new FFXLevelSceneDesc(399, 'airship cabin again'),
    new FFXLevelSceneDesc(400, 'hidden object again ??'),
    new FFXLevelSceneDesc(401, '401'),
    "Bevelle",
    new FFXLevelSceneDesc(405, 'elevators'),
    new FFXLevelSceneDesc(406, 'entry hallway'),
    // new FFXLevelSceneDesc(409, '409'),
    new FFXLevelSceneDesc(410, 'wedding'),
    // new FFXLevelSceneDesc(411, '411'),
    // new FFXLevelSceneDesc(412, '412'),
    // new FFXLevelSceneDesc(413, '413'),
    // new FFXLevelSceneDesc(414, '414'),
    new FFXLevelSceneDesc(415, 'court'),
    // new FFXLevelSceneDesc(416, '416'),
    new FFXLevelSceneDesc(419, 'via purifico'),
    new FFXLevelSceneDesc(420, 'via purifico exit'),
    new FFXLevelSceneDesc(421, 'cloister of trials'),
    new FFXLevelSceneDesc(422, 'bahamut chamber exterior'),
    new FFXLevelSceneDesc(423, 'bahamut chamber'),
    "Calm Lands",
    new FFXLevelSceneDesc(425, 'Calm Lands'),
    new FFXLevelSceneDesc(426, 'bridge'),
    new FFXLevelSceneDesc(429, 'yojimbo entrance'),
    new FFXLevelSceneDesc(430, 'Cavern of the Stolen Fayth'),
    new FFXLevelSceneDesc(431, 'Yojimbo chamber'),
    // new FFXLevelSceneDesc(432, '432'),
    new FFXLevelSceneDesc(445, 'Remiem Temple (Exterior)'),
    new FFXLevelSceneDesc(446, 'Remiem Temple (Interior)'),
    new FFXLevelSceneDesc(447, 'magus sister chamber'),
    // new FFXLevelSceneDesc(450, '450'),
    // new FFXLevelSceneDesc(452, '452'),
    // new FFXLevelSceneDesc(453, '453'),
    // new FFXLevelSceneDesc(454, '454'),
    // new FFXLevelSceneDesc(455, '455'),
    // new FFXLevelSceneDesc(456, '456'),
    // new FFXLevelSceneDesc(457, '457'),
    // new FFXLevelSceneDesc(458, '458'),
    "Weird plane things?",
    new FFXLevelSceneDesc(460, '460'),
    new FFXLevelSceneDesc(461, '461'),
    new FFXLevelSceneDesc(462, '462'),
    new FFXLevelSceneDesc(463, '463'),
    new FFXLevelSceneDesc(464, '464'),
    new FFXLevelSceneDesc(465, '465'),
    "Mount Gagazet",
    new FFXLevelSceneDesc(485, 'entrance'),
    new FFXLevelSceneDesc(486, 'grave'),
    new FFXLevelSceneDesc(487, 'pillars'),
    new FFXLevelSceneDesc(488, '488'),
    new FFXLevelSceneDesc(491, 'mountain cave'),
    new FFXLevelSceneDesc(492, 'mountain cave 2'),
    new FFXLevelSceneDesc(493, 'mountain cave exit'),
    new FFXLevelSceneDesc(494, 'zanarkand panorama'),
    new FFXLevelSceneDesc(495, 'mountain cave exit again'),
    new FFXLevelSceneDesc(496, 'zanarkand panorama again'),
    "Road to Zanarkand",
    new FFXLevelSceneDesc(500, 'campsite'),
    new FFXLevelSceneDesc(501, 'campsite again'),
    new FFXLevelSceneDesc(502, 'road'),
    new FFXLevelSceneDesc(503, 'airship ?'),
    // new FFXLevelSceneDesc(506, '506'),
    "Zanarkand",
    new FFXLevelSceneDesc(515, 'entrance'),
    new FFXLevelSceneDesc(516, 'hallway'),
    new FFXLevelSceneDesc(517, 'islands??'),
    new FFXLevelSceneDesc(518, 'final aeon chamber'),
    new FFXLevelSceneDesc(519, 'yunalesca chamber'),
    new FFXLevelSceneDesc(520, 'temple room?'),
    new FFXLevelSceneDesc(521, 'yunalesca fight'),
    new FFXLevelSceneDesc(522, 'chamber of trials'),
    "Fighting Sin",
    new FFXLevelSceneDesc(565, 'airship exterior'),
    new FFXLevelSceneDesc(566, 'airship exterior again'),
    new FFXLevelSceneDesc(567, 'sin listening'),
    new FFXLevelSceneDesc(568, 'airship exterior again'),
    // new FFXLevelSceneDesc(580, '580'),
    "Inside Sin",
    new FFXLevelSceneDesc(582, 'staircase ???'),
    new FFXLevelSceneDesc(583, 'seymour fight'),
    new FFXLevelSceneDesc(584, 'weird block city'),
    new FFXLevelSceneDesc(585, 'macalania area'),
    new FFXLevelSceneDesc(586, 'jecht fight'),
    new FFXLevelSceneDesc(587, 'jecht sword?'),
    new FFXLevelSceneDesc(589, 'blocky pillar'),
    new FFXLevelSceneDesc(591, '591'),
    new FFXLevelSceneDesc(590, 'Omega Ruins'),
    "Airship",
    new FFXLevelSceneDesc(0x5, 'airship exterior'),
    // new FFXLevelSceneDesc(0x6, '6'),
    // new FFXLevelSceneDesc(0x7, '7'),
    new FFXLevelSceneDesc(0x8, 'airship cabin'),
    // new FFXLevelSceneDesc(0xa, 'a'),
    "Miscellaneous",
    new FFXLevelSceneDesc(0x1, '1'),
    new FFXLevelSceneDesc(0x2, '2'),
    new FFXLevelSceneDesc(0x3, '3'),
    new FFXLevelSceneDesc(0x4, 'blitzball'),
    // new FFXLevelSceneDesc(600, '600'),
    new FFXLevelSceneDesc(604, '604'),
    new FFXLevelSceneDesc(620, 'besaid'),
    // new FFXLevelSceneDesc(621, '621'),
    new FFXLevelSceneDesc(650, 'via purifico '),
    // new FFXLevelSceneDesc(680, '680'),
    // new FFXLevelSceneDesc(690, '690'),
    // new FFXLevelSceneDesc(691, '691'),
    // new FFXLevelSceneDesc(692, '692'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, altName: "ffx" };
