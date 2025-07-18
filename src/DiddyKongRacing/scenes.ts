import * as Viewer from '../viewer.js';

import { CameraController } from '../Camera.js';
import { colorNewFromRGBA } from "../Color.js";
import { SceneContext } from '../SceneBase.js';
import { makeAttachmentClearDescriptor, makeBackbufferDescSimple } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxBindingLayoutDescriptor, GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { COOL_BLUE_COLOR, Checkbox, Panel, SingleSelect, Slider } from '../ui.js';
import { DataManager } from './DataManager.js';
import { DkrControlGlobals } from './DkrControlGlobals.js';
import { DkrLevel } from './DkrLevel.js';
import { DkrSprites } from './DkrSprites.js';
import { DkrTextureCache } from './DkrTextureCache.js';
import { trackParams } from './scenes_TrackParams.js';

const pathBase = `DiddyKongRacing`;
const dkrVersion = 'us_1.0';

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1, },
];

class DKRRenderer implements Viewer.SceneGfx {
    public renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private hasStarted = false;

    private level: DkrLevel | null = null;

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(30/60);
    }

    public setLevel(level: DkrLevel) {
        this.level = level;
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        const renderInstManager = this.renderHelper.renderInstManager;
        renderInstManager.setCurrentList(this.renderInstListMain);

        if(!!this.level) {
            this.level.prepareToRender(device, renderInstManager, viewerInput);
        }

        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        if(!this.hasStarted) {
            // Disable mirroring manually, since mirroring the rotation is annoying to deal with.
            (DkrControlGlobals.ADV2_MIRROR.elem as Checkbox).setChecked(false);
            DkrControlGlobals.ADV2_MIRROR.on = false;
            this.hasStarted = true;
        }

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        let clearColor = colorNewFromRGBA(0.8, 0.8, 0.8);
        if(!!this.level) {
            clearColor = this.level.getClearColor();
        }

        const renderPassDescriptor = makeAttachmentClearDescriptor(clearColor);
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, renderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, renderPassDescriptor);
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

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        if(!!this.level) {
            this.level.destroy(device);
        }
    }

    private panelAddCheckbox(panel: Panel, elem: any): void {
        const checkbox = new Checkbox();
        checkbox.setLabel(elem.label);
        checkbox.setChecked(elem.on);
        checkbox.onchanged = () => {
            elem.on = checkbox.checked;
        };
        elem.elem = checkbox;
        //elem.checkbox = checkbox;
        panel.contents.appendChild(checkbox.elem);
    }

    private panelAddSlider(panel: Panel, elem: any): void {
        const slider = new Slider();
        slider.setRange(elem.min, elem.max, elem.step);
        slider.setValue(elem.defaultValue);
        slider.onvalue = (value: number) => {
            elem.newValueCallback();
        };
        elem.elem = slider;
        panel.contents.appendChild(slider.elem);
        slider.onvalue!(elem.defaultValue);
    }

    private panelAddSingleSelect(panel: Panel, elem: any): void {
        const singleSelect = new SingleSelect();
        singleSelect.onselectionchange = (index: number) => {
            elem.selectedIndex = index;
            elem.selectedIndexUpdated();
        };
        singleSelect.setHeight(''); // This seems to fix unused space.
        elem.elem = singleSelect;
        panel.contents.appendChild(singleSelect.elem);
    }

    private createPanel(panelInfo: any): Panel {
        const panel = new Panel();
        panel.customHeaderBackgroundColor = COOL_BLUE_COLOR;
        panel.setTitle(panelInfo.icon, panelInfo.label);

        for(const elem of panelInfo.elements) {
            switch(elem.type) {
                case 'checkbox':
                    this.panelAddCheckbox(panel, elem);
                    break;
                case 'slider':
                    this.panelAddSlider(panel, elem);
                    break;
                case 'singleSelect':
                    this.panelAddSingleSelect(panel, elem);
                    break;
                case 'html':
                    panel.contents.appendChild(document.createElement(elem.tag));
                    break;
            }
        }
        panelInfo.elem = panel;
        return panel;
    }

    public createPanels(): Panel[] {
        const renderOptions = this.createPanel(DkrControlGlobals.PANEL_RENDER_OPTIONS);
        const animCamera = this.createPanel(DkrControlGlobals.PANEL_ANIM_CAMERA);
        animCamera.setVisible(this.level!.hasCameraAnimation);
        return [renderOptions, animCamera];
    }
}

class DKRSceneDesc implements Viewer.SceneDesc {
    private dataManager: DataManager;
    private renderer: DKRRenderer;
    private textureCache: DkrTextureCache;
    private sprites: DkrSprites;

    constructor(public id: string, public name: string, public trackParams : any | null) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        if(this.trackParams.animTracks !== null) {
            DkrControlGlobals.ANIM_TRACK_SELECT.trackSelectOptions = this.trackParams.animTracks;
            DkrControlGlobals.ANIM_TRACK_SELECT.trackSelectOptionKeys = Object.keys(this.trackParams.animTracks);
        } else {
            DkrControlGlobals.ANIM_TRACK_SELECT.trackSelectOptions = {};
            DkrControlGlobals.ANIM_TRACK_SELECT.trackSelectOptionKeys = Object.keys({});
        }
        DkrControlGlobals.ANIM_TRACK_SELECT.selectableChannels = null;
        DkrControlGlobals.ANIM_TRACK_SELECT.selectedIndex = -1;
        DkrControlGlobals.ANIM_TRACK_SELECT.selectedIndexUpdated();
        this.renderer = new DKRRenderer(device);

        const renderCache = this.renderer.renderHelper.renderCache;

        this.dataManager = new DataManager(context, pathBase, dkrVersion);
        await this.dataManager.fetchData();

        this.textureCache = new DkrTextureCache(device, renderCache, this.dataManager);
        this.sprites = new DkrSprites(device, renderCache, this.dataManager);

        const level = new DkrLevel(device, this.renderer.renderHelper, this.textureCache, this.id, this.dataManager, this.sprites);
        this.renderer.setLevel(level);

        return this.renderer;
    }
}

const id = 'DiddyKongRacing';
const name = "Diddy Kong Racing";
const sceneDescs = [
    'Central Area',
    new DKRSceneDesc('0', 'Central Area (Hub)', trackParams.CENTRAL_AREA),
    new DKRSceneDesc('37', 'Wizpig', trackParams.WIZPIG_1),
    'Dino Domain',
    new DKRSceneDesc('12', 'Dino Domain (Hub)', trackParams.DINO_DOMAIN),
    new DKRSceneDesc('5', 'Ancient Lake', trackParams.ANCIENT_LAKE),
    new DKRSceneDesc('3', 'Fossil Canyon', trackParams.FOSSIL_CANYON),
    new DKRSceneDesc('29', 'Jungle Falls', trackParams.JUNGLE_FALLS),
    new DKRSceneDesc('7', 'Hot Top Volcano', trackParams.HOT_TOP_VOLCANO),
    new DKRSceneDesc('11', 'Fire Mountain', trackParams.FIRE_MOUNTAIN),
    new DKRSceneDesc('38', 'Trickytops (Dino Boss)', trackParams.TRICKYTOPS_1),
    new DKRSceneDesc('46', 'Trickytops 2 (Dino Boss)', trackParams.TRICKYTOPS_2),
    'Snowflake Mountain',
    new DKRSceneDesc('24', 'Snowflake Mountain (Hub)', trackParams.SNOWFLAKE_MOUNTAIN),
    new DKRSceneDesc('13', 'Everfrost Peak', trackParams.EVERFROST_PEAK),
    new DKRSceneDesc('9', 'Snowball Valley', trackParams.SNOWBALL_VALLEY),
    new DKRSceneDesc('6', 'Walrus Cove', trackParams.WALRUS_COVE),
    new DKRSceneDesc('28', 'Frosty Village', trackParams.FROSTY_VILLAGE),
    new DKRSceneDesc('27', 'Icicle Pyramid', trackParams.ICICLE_PYRAMID),
    new DKRSceneDesc('1', 'Bluey (Walrus Boss)', trackParams.BLUEY_1),
    new DKRSceneDesc('52', 'Bluey 2 (Walrus Boss)', trackParams.BLUEY_2),
    'Sherbet Island',
    new DKRSceneDesc('14', 'Sherbet Island (Hub)', trackParams.SHERBET_ISLAND),
    new DKRSceneDesc('8', 'Whale Bay', trackParams.WHALE_BAY),
    new DKRSceneDesc('4', 'Pirate Lagoon', trackParams.PIRATE_LAGOON),
    new DKRSceneDesc('10', 'Crescent Island', trackParams.CRESCENT_ISLAND),
    new DKRSceneDesc('30', 'Treasure Caves', trackParams.TRASURE_CAVES),
    new DKRSceneDesc('26', 'Darkwater Beach', trackParams.DARKWATER_BEACH),
    new DKRSceneDesc('40', 'Bubbler (Octo Boss)', trackParams.BUBBLER_1),
    new DKRSceneDesc('53', 'Bubbler 2 (Octo Boss)', trackParams.BUBBLER_2),
    'Dragon Forest',
    new DKRSceneDesc('2', 'Dragon Forest (Hub)', trackParams.DRAGON_FOREST),
    new DKRSceneDesc('20', 'Windmill Plains', trackParams.WINDMILL_PLAINS),
    new DKRSceneDesc('18', 'Greenwood Village', trackParams.GREENWOOD_VILLAGE),
    new DKRSceneDesc('19', 'Boulder Canyon', trackParams.BOULDER_CANYON),
    new DKRSceneDesc('31', 'Haunted Woods', trackParams.HAUNTED_WOODS),
    new DKRSceneDesc('25', 'Smokey Castle', trackParams.SMOKEY_CASTLE),
    new DKRSceneDesc('41', 'Smokey (Dragon Boss)', trackParams.SMOKEY_1),
    new DKRSceneDesc('54', 'Smokey 2 (Dragon Boss)', trackParams.SMOKEY_2),
    'Future Fun Land',
    new DKRSceneDesc('35', 'Future Fun Land (Hub)', trackParams.FUTURE_FUN_LAND),
    new DKRSceneDesc('17', 'Spacedust Alley', trackParams.SPADEDUST_ALLEY),
    new DKRSceneDesc('32', 'Darkmoon Caverns', trackParams.DARKMOON_CAVERNS),
    new DKRSceneDesc('15', 'Spaceport Alpha', trackParams.SPACEPORT_ALPHA),
    new DKRSceneDesc('33', 'Star City', trackParams.STAR_CITY),
    new DKRSceneDesc('55', 'Wizpig 2', trackParams.WIZPIG_2),
    /* // Uncomment when cutscenes get properly implemented
    'Trophy Sequences',
    new DKRSceneDesc('47', 'Dino Domain Trophy Sequence', {0x0: 'Bronze Trophy Cutscene', 0x1: 'Silver Trophy Cutscene', 
    0x2: 'Gold Trophy Cutscene', 0x5: 'Challenge Door Unlock Cutscene'}),
    new DKRSceneDesc('48', 'Snowflake Mountain Trophy Sequence', {0x0: 'Bronze Trophy Cutscene', 0x1: 'Silver Trophy Cutscene', 
    0x2: 'Gold Trophy Cutscene', 0x5: 'Challenge Door Unlock Cutscene'}),
    new DKRSceneDesc('49', 'Sherbet Island Trophy Sequence', {0x0: 'Bronze Trophy Cutscene', 0x1: 'Silver Trophy Cutscene', 
    0x2: 'Gold Trophy Cutscene', 0x5: 'Challenge Door Unlock Cutscene'}),
    new DKRSceneDesc('50', 'Dragon Forest Trophy Sequence', {0x0: 'Bronze Trophy Cutscene', 0x1: 'Silver Trophy Cutscene', 
    0x2: 'Gold Trophy Cutscene', 0x5: 'Challenge Door Unlock Cutscene'}),
    new DKRSceneDesc('51', 'Future Fun Land Trophy Sequence', {0x0: 'Bronze Trophy Cutscene', 0x1: 'Silver Trophy Cutscene', 
    0x2: 'Gold Trophy Cutscene'}),
    'Boss Sequences',
    new DKRSceneDesc('57', 'Trickytops (Dino Boss) Sequence'),
    new DKRSceneDesc('59', 'Bluey (Walrus Boss) Sequence'),
    new DKRSceneDesc('61', 'Bubbler (Octo Boss) Sequence'),
    new DKRSceneDesc('58', 'Smokey (Dragon Boss) Sequence'),
    new DKRSceneDesc('60', 'Wizpig 1 Sequence', {0x00: "You Can't Beat Me!", 0x01: 'Player Won', 0x02: 'Player Lost'}),
    new DKRSceneDesc('62', 'Wizpig 2 Sequence'),
    'Other',
    new DKRSceneDesc('21', 'Front End'),
    new DKRSceneDesc('22', 'Character Select'),
    new DKRSceneDesc('23', 'Title Screen'),
    new DKRSceneDesc('34', 'Trophy Race'),
    new DKRSceneDesc('36', 'Opening Sequence'),
    new DKRSceneDesc('39', 'Options Background'),
    new DKRSceneDesc('42', 'Wizpig Mouth Sequence'),
    new DKRSceneDesc('43', 'Wizpig Amulet Sequence'),
    new DKRSceneDesc('44', 'T.T. Amulet Sequence'),
    new DKRSceneDesc('45', 'Rocket Sequence'),
    new DKRSceneDesc('63', 'Last Bit (Ending part 1)'),
    new DKRSceneDesc('64', 'Last Bit B (Ending part 2)'),
    */
    'Unused tracks',
    new DKRSceneDesc('16', 'Horseshoe Gulch', trackParams.HORSESHOE_GULCH),
    new DKRSceneDesc('model:10', 'Unnamed Temple Track (Model only)', trackParams.UNUSED_TEMPLE_TRACK),
    new DKRSceneDesc('model:43', 'Unnamed Ocean Track (Model only)', trackParams.UNUSED_OCEAN_TRACK),
    new DKRSceneDesc('model:44', 'Unnamed Volcano Track (Model only)', trackParams.UNUSED_VOLCANO_TRACK),
    new DKRSceneDesc('model:45', 'Unnamed Snow Mountain Track (Model only)', trackParams.UNUSED_SNOW_MOUNTAIN_TRACK),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
