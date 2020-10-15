import * as BIN from "./bin";
import * as Viewer from '../viewer';
import { BasicRenderTarget, makeClearRenderPassDescriptor, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxBindingLayoutDescriptor, GfxDevice, GfxHostAccessPass, GfxRenderPass, GfxTexture } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { SceneContext } from '../SceneBase';
import { FakeTextureHolder } from '../TextureHolder';
import { assertExists, hexzero } from '../util';
import { FFXProgram, findTextureIndex, LevelModelData, LevelPartInstance, TextureData } from "./render";
import { CameraController } from "../Camera";
import { mat4 } from "gl-matrix";
import AnimationController from "../AnimationController";

const pathBase = `ffx`;

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 2, numSamplers: 1 }];

class FFXRenderer implements Viewer.SceneGfx {
    public renderTarget = new BasicRenderTarget();
    public renderHelper: GfxRenderHelper;
    public textureHolder = new FakeTextureHolder([]);

    public partRenderers: LevelPartInstance[] = [];
    public modelData: LevelModelData[] = [];
    public textureData: TextureData[] = [];
    public animatedTextures: BIN.AnimatedTexture[] = [];
    public textureRemaps: GfxTexture[] = [];

    public lightDirection = mat4.create();
    public clearPass = standardFullClearRenderPassDescriptor;

    private animationController = new AnimationController(60);

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

        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, this.clearPass);

        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();

        return passRenderer;
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(.1);
        this.animationController.setTimeFromViewerInput(viewerInput);

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        let offs = template.allocateUniformBuffer(FFXProgram.ub_SceneParams, 16 + 12);
        const sceneParamsMapped = template.mapUniformBufferF32(FFXProgram.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);
        fillMatrix4x3(sceneParamsMapped, offs, this.lightDirection);

        for (let i = 0; i < this.animatedTextures.length; i++) {
            if (this.animatedTextures[i].effect === null)
                continue;
            const currIndex = findTextureIndex(this.animationController.getTimeInFrames(), this.animatedTextures[i].effect);
            for (let j = 0; j < this.animatedTextures[i].textureIndices.length; j++) {
                const baseIndex = this.animatedTextures[i].textureIndices[j][0];
                const newIndex = this.animatedTextures[i].textureIndices[j][currIndex];
                this.textureRemaps[baseIndex] = this.textureData[newIndex].gfxTexture;
            }
        }

        for (let i = 0; i < this.partRenderers.length; i++)
            this.partRenderers[i].prepareToRender(this.renderHelper.renderInstManager, viewerInput, this.textureRemaps);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
        for (let i = 0; i < this.textureData.length; i++)
            this.textureData[i].destroy(device);
    }
}



class FFXLevelSceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(private index: number, public name: string) {
        this.id = hexzero(index, 3);
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const textureData = await context.dataFetcher.fetchData(`${pathBase}/13/${hexzero(2 * this.index, 4)}.bin`);
        const geometryData = await context.dataFetcher.fetchData(`${pathBase}/13/${hexzero(2 * this.index + 1, 4)}.bin`);

        const renderer = new FFXRenderer(device);
        const textures = BIN.parseLevelTextures(textureData);
        const level = BIN.parseLevelGeometry(geometryData, textures);
        const cache = renderer.renderHelper.getCache();

        renderer.clearPass = makeClearRenderPassDescriptor(true, level.clearColor);
        mat4.copy(renderer.lightDirection, level.lightDirection);

        for (let tex of level.textures) {
            const data = new TextureData(device, tex);
            renderer.textureData.push(data);
            renderer.textureHolder.viewerTextures.push(data.viewerTexture);
        }
        renderer.textureHolder.viewerTextures.sort((a, b) => a.name.localeCompare(b.name))

        for (let p of level.parts) {
            const modelData: LevelModelData[] = [];
            for (let m of p.models) {
                const data = new LevelModelData(device, cache, m);
                renderer.modelData.push(data);
                modelData.push(data);
            }
            const partRenderer = new LevelPartInstance(device, cache, p, modelData, renderer.textureData);
            for (let index of p.effectIndices)
                partRenderer.effects.push(assertExists(level.effects[index]));
            renderer.partRenderers.push(partRenderer);
        }

        renderer.animatedTextures = level.animatedTextures;
        for (let tex of level.animatedTextures)
            for (let list of tex.textureIndices)
                renderer.textureRemaps[list[0]] = renderer.textureData[list[0]].gfxTexture;

        return renderer;
    }
}

const id = 'ffx';
const name = 'Final Fantasy X';

const sceneDescs = [
    "Intro",
    new FFXLevelSceneDesc(0x10, 'Zanarkand Ruins'),
    "Zanarkand (past)",
    new FFXLevelSceneDesc(17, 'Zanarkand - Harbor (night)'),
    new FFXLevelSceneDesc(15, 'Boathouse - Cabin'),
    new FFXLevelSceneDesc(24, 'Zanarkand - Overpass'),
    new FFXLevelSceneDesc(14, 'Zanarkand - Harbor'),
    new FFXLevelSceneDesc(13, 'Zanarkand - Harbor (dream)'),
    new FFXLevelSceneDesc(20, 'Zanarkand - Harbor (night)'),
    new FFXLevelSceneDesc(18, 'Zanarkand - Overpass (boss)'),
    new FFXLevelSceneDesc(19, 'Zanarkand - Overpass (destroyed)'),
    // new FFXLevelSceneDesc(22, 'Zanarkand Stadium'),
    // new FFXLevelSceneDesc(23, 'Zanarkand Stadium'),
    "Ruins",
    new FFXLevelSceneDesc(30, "Submerged Ruins"),
    new FFXLevelSceneDesc(32, "Ruins - Underwater Hall"),
    new FFXLevelSceneDesc(33, "Ruins - Corridor"),
    new FFXLevelSceneDesc(34, "Ruins - Hall"),
    new FFXLevelSceneDesc(35, "Ruins - Hall (past)"),
    new FFXLevelSceneDesc(36, "Ruins - Stairs"),
    new FFXLevelSceneDesc(37, "Ruins - Small Room"),
    "Baaj",
    new FFXLevelSceneDesc(38, "Ruins - Underwater Passage"),
    new FFXLevelSceneDesc(40, "Ruins - Antechamber"),
    new FFXLevelSceneDesc(42, "Ruins - Fayth"),
    'Salvage Ship',
    new FFXLevelSceneDesc(50, "Salvage Ship - Deck"),
    new FFXLevelSceneDesc(51, "Salvage Ship - Underwater"),
    new FFXLevelSceneDesc(52, "Salvage Ship"),
    new FFXLevelSceneDesc(57, "Underwater Ruins (interior)"),
    new FFXLevelSceneDesc(58, "Underwater Ruins (exterior)"),
    'Besaid',
    new FFXLevelSceneDesc(65, "Besaid - Port"),
    new FFXLevelSceneDesc(66, "Besaid - Port (with boat)"),
    new FFXLevelSceneDesc(67, "Besaid - Crossroads"),
    new FFXLevelSceneDesc(68, "Besaid - Valley"),
    new FFXLevelSceneDesc(69, "Besaid - Ancient Road"),
    new FFXLevelSceneDesc(70, "Besaid - Waterfall Way"),
    new FFXLevelSceneDesc(71, "Besaid - Promontory"),
    new FFXLevelSceneDesc(72, "Besaid - Village Slope"),
    new FFXLevelSceneDesc(75, "Besaid Village"),
    new FFXLevelSceneDesc(76, "Besaid Village (night)"),
    new FFXLevelSceneDesc(77, "Besaid - Crusaders Lodge"),
    new FFXLevelSceneDesc(78, "Besaid - Crusaders Lodge (night)"),
    // new FFXLevelSceneDesc(79, "Besaid - House"),
    // new FFXLevelSceneDesc(80, "Besaid - House"),
    // new FFXLevelSceneDesc(81, "Besaid - Shop"),
    // new FFXLevelSceneDesc(82, "Besaid - House"),
    // new FFXLevelSceneDesc(83, "83"),
    // new FFXLevelSceneDesc(84, "84"),
    new FFXLevelSceneDesc(85, "Besaid - Great Hall"),
    new FFXLevelSceneDesc(86, "Besaid - Trials"),
    // new FFXLevelSceneDesc(87, "Besaid - Monks' Chamber"),
    // new FFXLevelSceneDesc(88, "Besaid - Nuns' Chamber"),
    new FFXLevelSceneDesc(89, "Besaid - Antechamber"),
    new FFXLevelSceneDesc(90, "Besaid - Fayth"),

    "S.S. Liki",
    new FFXLevelSceneDesc(95, "S.S. Liki - Deck"),
    // new FFXLevelSceneDesc(97, "S.S. Liki - Deck"), identical?
    new FFXLevelSceneDesc(98, "S.S. Liki - Bridge"),
    new FFXLevelSceneDesc(99, "S.S. Liki - Corridor"),
    new FFXLevelSceneDesc(102, "S.S. Liki - Cabin"),
    new FFXLevelSceneDesc(103, "S.S. Liki - Engine Room"),
    new FFXLevelSceneDesc(105, "S.S. Liki - Deck (sunset)"),
    new FFXLevelSceneDesc(106, "Kilika - Offshore"),
    "Kilika",
    new FFXLevelSceneDesc(115, "Kilika Port"),
    new FFXLevelSceneDesc(116, "Kilika - Dock (sunset)"),
    new FFXLevelSceneDesc(122, "Kilika - Dock"),
    // new FFXLevelSceneDesc(124, "Kilika - Tavern"),
    new FFXLevelSceneDesc(125, "Kilika - Ruined Square"),
    // new FFXLevelSceneDesc(126, "Kilika - Residential Area"),
    // new FFXLevelSceneDesc(127, "Kilika - Inn"),
    // new FFXLevelSceneDesc(128, "Kilika - Residential Area"),
    // new FFXLevelSceneDesc(129, "Kilika - House"),
    // new FFXLevelSceneDesc(130, "Kilika - House"),
    new FFXLevelSceneDesc(131, "Kilika Forest"), // missing name?
    new FFXLevelSceneDesc(132, "Kilika - Pilgrimage Road"),
    "Kilika Temple",
    // new FFXLevelSceneDesc(133, "Kilika Temple"),
    new FFXLevelSceneDesc(134, "Kilika Temple"),
    new FFXLevelSceneDesc(135, "Kilika - Great Hall"),
    // new FFXLevelSceneDesc(136, "Kilika - Monks' Chambers"),
    // new FFXLevelSceneDesc(137, "Kilika - Monks' Chambers"),
    new FFXLevelSceneDesc(138, "Kilika - Lift"),
    new FFXLevelSceneDesc(139, "Kilika - Trials"),
    new FFXLevelSceneDesc(140, "Kilika - Antechamber"),
    new FFXLevelSceneDesc(141, "Kilika - Fayth"),
    "S.S. Winno",
    new FFXLevelSceneDesc(145, "S.S. Winno - Deck"),
    new FFXLevelSceneDesc(147, "S.S. Winno - Deck (night)"),
    new FFXLevelSceneDesc(148, "S.S. Winno - Bridge"),
    new FFXLevelSceneDesc(149, "S.S. Winno - Corridor"),
    new FFXLevelSceneDesc(152, "S.S. Winno - Cabin"),
    new FFXLevelSceneDesc(153, "S.S. Winno - Engine Room"),
    new FFXLevelSceneDesc(154, "S.S. Winno - Bridge"),
    "Luca Docks",
    new FFXLevelSceneDesc(165, "Luca Stadium - Main Gate"),
    new FFXLevelSceneDesc(166, "Luca - Number 1 Dock"),
    new FFXLevelSceneDesc(167, "Luca - Number 2 Dock"),
    new FFXLevelSceneDesc(168, "Luca - Number 3 Dock"),
    new FFXLevelSceneDesc(169, "Luca - Number 4 Dock"),
    new FFXLevelSceneDesc(180, "Luca - Number 4 Dock (airship)"),
    new FFXLevelSceneDesc(170, "Luca - Number 5 Dock"),
    "Luca Stadium",
    new FFXLevelSceneDesc(171, "Stadium - Stands"),
    new FFXLevelSceneDesc(172, "Stadium - VIP Seats"),
    new FFXLevelSceneDesc(173, "Stadium - Pool"),
    new FFXLevelSceneDesc(174, "Theater"),
    new FFXLevelSceneDesc(178, "Stadium - Locker Room"), // also Basement A
    new FFXLevelSceneDesc(179, "Stadium - Basement B"),
    "Luca",
    new FFXLevelSceneDesc(183, "Luca - Bridge"),
    new FFXLevelSceneDesc(186, "Luca - Square"),
    new FFXLevelSceneDesc(189, "Luca - Cafe"),
    new FFXLevelSceneDesc(191, "Luca - City Limits"),
    new FFXLevelSceneDesc(193, "Luca - Cafe"),
    new FFXLevelSceneDesc(175, "Theater - Entrance"),
    // new FFXLevelSceneDesc(176, "Theater - Reception"),
    new FFXLevelSceneDesc(177, "Theater - Main Hall"),
    "Mi'ihen highroad",
    new FFXLevelSceneDesc(210, "Highroad - South End"),
    new FFXLevelSceneDesc(217, "Highroad - South"),
    new FFXLevelSceneDesc(218, "Highroad - Central"),
    new FFXLevelSceneDesc(216, "Highroad - North End"),
    new FFXLevelSceneDesc(211, "Highroad - Agency, Front (sunset)"),
    new FFXLevelSceneDesc(212, "Highroad - Agency, Front"),
    // new FFXLevelSceneDesc(213, "Highroad - Agency"),
    new FFXLevelSceneDesc(214, "Highroad - Newroad, South"),
    new FFXLevelSceneDesc(215, "Highroad - Newroad, North"),
    "Mushroom Rock",
    new FFXLevelSceneDesc(220, "Mushroom Rock - Plateau"),
    new FFXLevelSceneDesc(221, "Mushroom Rock - Valley"),
    new FFXLevelSceneDesc(225, "Mushroom Rock - Precipice"),
    new FFXLevelSceneDesc(222, "Mushroom Rock - Ridge"),
    new FFXLevelSceneDesc(223, "Mushroom Rock - Ridge (boss)"),
    new FFXLevelSceneDesc(226, "Underwater - Chasing Sin"),
    new FFXLevelSceneDesc(227, "Mushroom Rock - Aftermath"),
    new FFXLevelSceneDesc(228, "Mushroom Rock - Beach"),
    new FFXLevelSceneDesc(229, "Mushroom Rock - Beach"),
    "Djose",
    new FFXLevelSceneDesc(224, "Djose Highroad"),
    new FFXLevelSceneDesc(230, "Djose - Pilgrimage Road"),
    new FFXLevelSceneDesc(231, "Djose Temple"),
    // new FFXLevelSceneDesc(232, "Djose - Inn"),
    new FFXLevelSceneDesc(233, "Djose - Great Hall"),
    // new FFXLevelSceneDesc(234, "Djose - Monks' Chamber"),
    // new FFXLevelSceneDesc(235, "Djose - Nuns' Chamber"),
    new FFXLevelSceneDesc(236, "Djose - Trials"),
    new FFXLevelSceneDesc(237, "Djose - Antechamber (storm)"),
    new FFXLevelSceneDesc(238, "Djose - Antechamber"),
    new FFXLevelSceneDesc(239, "Djose - Fayth"),
    "Moonflow",
    new FFXLevelSceneDesc(245, "Moonflow - South Bank Road"),
    new FFXLevelSceneDesc(246, "Moonflow - South Bank"),
    new FFXLevelSceneDesc(247, "Moonflow - South Wharf"),
    // new FFXLevelSceneDesc(249, "Moonflow - South Wharf"), // identical, for now?
    // new FFXLevelSceneDesc(250, "Moonflow - South Wharf"),
    // new FFXLevelSceneDesc(251, "Moonflow - South Wharf"),
    new FFXLevelSceneDesc(254, "Moonflow"),
    new FFXLevelSceneDesc(255, "Riding the Shoopuf"),
    new FFXLevelSceneDesc(256, "Moonflow - North Wharf"),
    // new FFXLevelSceneDesc(257, "Moonflow - North Wharf"),
    // new FFXLevelSceneDesc(258, "Moonflow - North Wharf"),
    new FFXLevelSceneDesc(260, "Moonflow - North Bank"),
    new FFXLevelSceneDesc(261, "Moonflow - North Bank Road"),
    "Guadosalam",
    new FFXLevelSceneDesc(265, "Guadosalam"),
    // new FFXLevelSceneDesc(266, "Guadosalam - Inn"),
    // new FFXLevelSceneDesc(267, "Guadosalam - Shop"),
    // new FFXLevelSceneDesc(268, "Guadosalam - House"),
    // new FFXLevelSceneDesc(269, "Guadosalam - House"),
    new FFXLevelSceneDesc(270, "Mansion - Entrance"),
    new FFXLevelSceneDesc(271, "Mansion - Great Hall"),
    new FFXLevelSceneDesc(272, "Zanarkand - Yunalesca"),
    // new FFXLevelSceneDesc(275, "Road to Farplane"),
    // new FFXLevelSceneDesc(276, "Farplane Gates"),
    new FFXLevelSceneDesc(281, "The Farplane"),
    // new FFXLevelSceneDesc(282, '282'),
    new FFXLevelSceneDesc(283, "The Farplane"),
    "Thunder Plains",
    new FFXLevelSceneDesc(300, "Thunder Plains - South"),
    // new FFXLevelSceneDesc(301, "Thunder Plains - Agency"),
    new FFXLevelSceneDesc(302, "Thunder Plains - Agency Room"),
    new FFXLevelSceneDesc(303, "Thunder Plains - North"),
    new FFXLevelSceneDesc(304, "Thunder Plains - Agency Front"),
    // new FFXLevelSceneDesc(308, '308'),
    "Macalania Woods",
    new FFXLevelSceneDesc(310, "Macalania Woods - South"),
    new FFXLevelSceneDesc(311, "Macalania Woods - Central"),
    new FFXLevelSceneDesc(312, "Macalania Woods - North"),
    new FFXLevelSceneDesc(313, "Macalania Woods - Spring"),
    new FFXLevelSceneDesc(314, "Macalania Woods - Lake Road"),
    // new FFXLevelSceneDesc(315, "Macalania Woods - To Bevelle"),
    // new FFXLevelSceneDesc(316, "Macalania Woods - To Bevelle"),
    // new FFXLevelSceneDesc(317, "Macalania Woods - To Thunder"),
    // new FFXLevelSceneDesc(318, "Macalania Woods - To Thunder"),
    // new FFXLevelSceneDesc(319, "Macalania Woods - Campsite"),
    // new FFXLevelSceneDesc(321, "Macalania Woods - Campsite"),
    new FFXLevelSceneDesc(322, "Macalania Woods - Spring"),
    new FFXLevelSceneDesc(323, "Macalania Woods - Spring"),
    new FFXLevelSceneDesc(324, "Macalania Woods - North"),
    "Lake Macalania",
    new FFXLevelSceneDesc(330, "Lake Macalania - Agency Front"),
    // new FFXLevelSceneDesc(331, "Lake Macalania - Agency"),
    new FFXLevelSceneDesc(332, "Lake Macalania"),
    new FFXLevelSceneDesc(333, "Lake Macalania - Crevasse"),
    new FFXLevelSceneDesc(335, "Lake Macalania - Crevasse (end)"), // official name is "None"?
    new FFXLevelSceneDesc(334, "Lake Macalania - Lake Bottom"),
    "Macalania Temple",
    new FFXLevelSceneDesc(340, "Macalania - Road"),
    new FFXLevelSceneDesc(341, "Macalania - Hall"),
    // new FFXLevelSceneDesc(342, "Macalania - Monks' Chamber"),
    // new FFXLevelSceneDesc(343, "Macalania - Nuns' Chamber"),
    new FFXLevelSceneDesc(344, "Macalania - Trials"),
    new FFXLevelSceneDesc(345, "Macalania - Antechamber"),
    new FFXLevelSceneDesc(346, "Macalania - Fayth"),
    "Sanubia Desert",
    new FFXLevelSceneDesc(350, "Oasis"),
    new FFXLevelSceneDesc(351, "Sanubia Desert - East"),
    new FFXLevelSceneDesc(352, "Sanubia Desert - Central"),
    new FFXLevelSceneDesc(353, "Sanubia Desert - West"),
    "Al Bhed Home",
    // new FFXLevelSceneDesc(354, "Home"),
    new FFXLevelSceneDesc(360, "Home - Entrance"),
    new FFXLevelSceneDesc(363, "Home - Main Corridor"),
    new FFXLevelSceneDesc(364, "Home - Environment Controls"),
    // new FFXLevelSceneDesc(365, "Home - Airship Dock"),
    // new FFXLevelSceneDesc(366, "Home - Living Quarters"),
    // new FFXLevelSceneDesc(367, "Home - Living Quarters"),
    // new FFXLevelSceneDesc(368, '368'),
    "Airship",
    // new FFXLevelSceneDesc(382, "Airship - Corridor"),
    // new FFXLevelSceneDesc(385, "Airship - Corridor"),
    new FFXLevelSceneDesc(388, "Airship - Bridge"),
    // new FFXLevelSceneDesc(392, '392'),
    new FFXLevelSceneDesc(395, "Airship - Deck"),
    // new FFXLevelSceneDesc(396, "Airship - Bridge"), // white background
    // new FFXLevelSceneDesc(397, '397'),
    new FFXLevelSceneDesc(399, "Airship - Bridge (sunset)"),
    new FFXLevelSceneDesc(380, "Airship - Cabin"),
    new FFXLevelSceneDesc(400, "Airship - Cabin"),
    new FFXLevelSceneDesc(401, "Airship Map"), // labelled Airship - Bridge, maybe this is for the background?
    // these all seem identical to 401
    // new FFXLevelSceneDesc(460, '460'),
    // new FFXLevelSceneDesc(461, '461'),
    // new FFXLevelSceneDesc(462, '462'),
    // new FFXLevelSceneDesc(463, '463'),
    // new FFXLevelSceneDesc(464, '464'),
    // new FFXLevelSceneDesc(465, '465'),
    "Bevelle",
    new FFXLevelSceneDesc(406, "Bevelle - Main Gate"),
    // new FFXLevelSceneDesc(409, '409'),
    new FFXLevelSceneDesc(410, "Bevelle - Tower of Light"),
    // new FFXLevelSceneDesc(411, "Bevelle - Passage of Cleansing"),
    // new FFXLevelSceneDesc(412, "Bevelle - Priests' Passage"),
    // new FFXLevelSceneDesc(413, "Bevelle - Priests' Passage"),
    // new FFXLevelSceneDesc(414, "Bevelle - Priests' Passage"),
    new FFXLevelSceneDesc(415, "Bevelle - The Inquisition"),
    // new FFXLevelSceneDesc(416, "Bevelle - Dungeons"),
    new FFXLevelSceneDesc(419, "Bevelle - Via Purifico"),
    new FFXLevelSceneDesc(405, "Bevelle - Via Purifico (boss)"),
    new FFXLevelSceneDesc(420, "Bevelle - The Two Fates"),
    new FFXLevelSceneDesc(421, "Bevelle - Trials"),
    new FFXLevelSceneDesc(422, "Bevelle - Antechamber"),
    new FFXLevelSceneDesc(423, "Bevelle - Fayth"),
    "Calm Lands",
    new FFXLevelSceneDesc(425, "Calm Lands"),
    new FFXLevelSceneDesc(426, "Calm Lands - Near Bridge"),
    new FFXLevelSceneDesc(429, "Calm Lands - Gorge Bottom"),
    new FFXLevelSceneDesc(430, "Cavern of the Stolen Fayth"),
    new FFXLevelSceneDesc(431, "Chamber of the Stolen Fayth"),
    // new FFXLevelSceneDesc(432, "Calm Lands - Arena"),
    "Remiem Temple",
    new FFXLevelSceneDesc(445, "Remiem Temple"),
    new FFXLevelSceneDesc(446, "Remiem - Great Hall"),
    new FFXLevelSceneDesc(447, "Remiem - Fayth"),
    // new FFXLevelSceneDesc(450, '450'),
    // new FFXLevelSceneDesc(452, '452'),
    // new FFXLevelSceneDesc(453, '453'),
    // new FFXLevelSceneDesc(454, '454'),
    // new FFXLevelSceneDesc(455, '455'),
    // new FFXLevelSceneDesc(456, '456'),
    // new FFXLevelSceneDesc(457, '457'),
    // new FFXLevelSceneDesc(458, '458'),
    "Mount Gagazet",
    new FFXLevelSceneDesc(485, "Gagazet - Mountain Gate"),
    new FFXLevelSceneDesc(486, "Gagazet - Mountain Trail"),
    new FFXLevelSceneDesc(487, "Gagazet - Prominence"),
    new FFXLevelSceneDesc(488, "Gagazet - Fayth Cluster"),
    new FFXLevelSceneDesc(491, "Gagazet - Mountain Cave"),
    new FFXLevelSceneDesc(492, "Gagazet - Submerged Passage"),
    new FFXLevelSceneDesc(493, "Gagazet - Summit Region"),
    new FFXLevelSceneDesc(495, "Gagazet - Summit Region (night)"),
    "Zanarkand Ruins",
    new FFXLevelSceneDesc(494, "Road to the Zanarkand Ruins"),
    new FFXLevelSceneDesc(496, "Road to the Zanarkand Ruins (night)"),
    new FFXLevelSceneDesc(500, "Zanarkand Ruins (campfire)"),
    new FFXLevelSceneDesc(501, "Zanarkand Ruins"),
    new FFXLevelSceneDesc(502, "Zanarkand Ruins - Overpass"),
    "Zanarkand Dome",
    new FFXLevelSceneDesc(503, "Dome"),
    // new FFXLevelSceneDesc(506, "Dome - Front"),
    new FFXLevelSceneDesc(515, "Dome - Interior"),
    new FFXLevelSceneDesc(516, "Dome - Corridor"),
    new FFXLevelSceneDesc(517, "Dome - Cloister of Trials"),
    new FFXLevelSceneDesc(518, "Dome - Chamber of the Fayth"),
    new FFXLevelSceneDesc(519, "Dome - Great Hall"),
    new FFXLevelSceneDesc(520, "Dome - Great Hall (ruins)"),
    new FFXLevelSceneDesc(521, "Dome - The Beyond"),
    new FFXLevelSceneDesc(522, "Dome - Trials"),
    "Fighting Sin",
    new FFXLevelSceneDesc(565, "Airship - Deck"),
    // new FFXLevelSceneDesc(566, "Airship - Deck"), identical
    new FFXLevelSceneDesc(567, "Fighting Sin"), // official name is still "Airship - Deck"
    new FFXLevelSceneDesc(568, "Airship - Deck (sunset)"),
    new FFXLevelSceneDesc(8, 'Airship - Bridge'), // unofficial name
    "Inside Sin",
    // new FFXLevelSceneDesc(580, "Sin - Near Airship"),
    new FFXLevelSceneDesc(582, "Sin - Sea of Sorrow"),
    new FFXLevelSceneDesc(583, "Sin - Garden of Pain"),
    new FFXLevelSceneDesc(584, "Sin - City of Dying Dreams"),
    new FFXLevelSceneDesc(585, "Sin - The Nucleus"),
    new FFXLevelSceneDesc(586, "Sin - Dream's End"),
    new FFXLevelSceneDesc(587, "Sin - Dream's End"),
    new FFXLevelSceneDesc(589, "Sin - Tower of the Dead"),
    "Omega Ruins",
    new FFXLevelSceneDesc(590, "Omega Ruins (caverns)"),
    new FFXLevelSceneDesc(591, "Omega Ruins"),
    "Unused/Test?",
    // new FFXLevelSceneDesc(5, 'airship exterior'), bad palette?
    // new FFXLevelSceneDesc(6, '6'),
    // new FFXLevelSceneDesc(7, '7'),
    // new FFXLevelSceneDesc(10, '10'),
    new FFXLevelSceneDesc(1, 'grid'),
    new FFXLevelSceneDesc(2, 'effect test'),
    new FFXLevelSceneDesc(3, 'blitzball test'),
    new FFXLevelSceneDesc(4, 'unused blitzball stadium'),
    // new FFXLevelSceneDesc(600, '600'),
    new FFXLevelSceneDesc(604, 'labelled grid'),
    new FFXLevelSceneDesc(620, 'besaid (no water)'),
    // new FFXLevelSceneDesc(621, '621'),
    new FFXLevelSceneDesc(650, 'via purifico '),
    // new FFXLevelSceneDesc(680, '680'),
    // new FFXLevelSceneDesc(690, '690'), // last three named "None"
    // new FFXLevelSceneDesc(691, '691'),
    // new FFXLevelSceneDesc(692, '692'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, altName: "ffx" };
