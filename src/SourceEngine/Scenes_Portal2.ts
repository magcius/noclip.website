
import { mat4, vec3 } from "gl-matrix";
import { DataFetcher } from "../DataFetcher";
import { drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../DebugJunk";
import { AABB } from "../Geometry";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { getMatrixTranslation, scaleMatrix, Vec3NegX } from "../MathHelpers";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { EmptyScene } from "../Scenes_Test";
import { HIGHLIGHT_COLOR, ScrollSelectItem, ScrollSelectItemType, SEARCH_ICON, SingleSelect, TextEntry } from "../ui";
import { decodeString } from "../util";
import { SceneGfx } from "../viewer";
import { BSPEntity } from "./BSPFile";
import { BaseEntity, EntityFactoryRegistry, EntityOutput, EntitySystem, trigger_multiple } from "./EntitySystem";
import { BSPRenderer, LooseMount, SourceFileSystem, SourceLoadContext, SourceRenderContext } from "./Main";
import { BaseMaterial } from "./Materials";
import { createScene } from "./Scenes";

class trigger_portal_button extends trigger_multiple {
    public static override classname = `trigger_portal_button`;
    public button: BaseFloorButton | null = null;

    protected override onStartTouch(entitySystem: EntitySystem): void {
        super.onStartTouch(entitySystem);
        this.button!.press(entitySystem);
    }

    protected override onEndTouch(entitySystem: EntitySystem): void {
        super.onEndTouch(entitySystem);
        this.button!.unpress(entitySystem);
    }
}

class prop_button extends BaseEntity {
    public static classname = 'prop_button';

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        if (entity.model === undefined)
            entity.model = 'models/props/switch001.mdl';
        super(entitySystem, renderContext, bspRenderer, entity);
    }
}

const enum BaseFloorButtonSkin {
    Up = 0, Down = 1,
}

class BaseFloorButton extends BaseEntity {
    private output_onPressed = new EntityOutput();
    private output_onUnPressed = new EntityOutput();

    public pressed = false;
    protected trigger: trigger_portal_button;

    protected upSequence = 'up';
    protected downSequence = 'down';

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.output_onPressed.parse(this.entity.onpressed);
        this.output_onUnPressed.parse(this.entity.onunpressed);
        this.registerInput('pressin', this.input_pressin.bind(this));
        this.registerInput('pressout', this.input_pressout.bind(this));

        this.createTriggers(entitySystem);
    }

    private createTriggers(entitySystem: EntitySystem): void {
        const origin = vec3.create();
        const size = vec3.create();
        this.getAbsOriginAndAngles(origin, size);

        this.trigger = entitySystem.createEntity({ classname: `trigger_portal_button` }) as trigger_portal_button;
        this.trigger.setAbsOriginAndAngles(origin, size);
        this.trigger.button = this;
    }

    public press(entitySystem: EntitySystem): void {
        this.resetSequence(this.downSequence);
        this.pressed = true;
        this.modelStudio!.setSkin(entitySystem.renderContext, BaseFloorButtonSkin.Down);
        this.output_onPressed.fire(entitySystem, this);
    }

    public unpress(entitySystem: EntitySystem): void {
        this.resetSequence(this.upSequence);
        this.pressed = false;
        this.modelStudio!.setSkin(entitySystem.renderContext, BaseFloorButtonSkin.Up);
        this.output_onUnPressed.fire(entitySystem, this);
    }

    private input_pressin(entitySystem: EntitySystem): void {
        this.press(entitySystem);
    }

    private input_pressout(entitySystem: EntitySystem): void {
        this.unpress(entitySystem);
    }
}

class prop_floor_button extends BaseFloorButton {
    public static classname = 'prop_floor_button';

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        if (entity.model === undefined)
            entity.model = 'models/props/portal_button.mdl';
        super(entitySystem, renderContext, bspRenderer, entity);
        this.trigger.setSize(new AABB(-20, -20, 0, 20, 20, 14));
    }
}

class prop_floor_cube_button extends BaseFloorButton {
    public static classname = 'prop_floor_cube_button';

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        if (entity.model === undefined)
            entity.model = 'models/props/box_socket.mdl';
        super(entitySystem, renderContext, bspRenderer, entity);
        this.trigger.setSize(new AABB(-20, -20, 0, 20, 20, 14));
    }
}

class prop_floor_ball_button extends BaseFloorButton {
    public static classname = 'prop_floor_ball_button';

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        if (entity.model === undefined)
            entity.model = 'models/props/ball_button.mdl';
        super(entitySystem, renderContext, bspRenderer, entity);
        this.trigger.setSize(new AABB(-5, -5, 0, 5, 5, 14));
    }
}

class prop_under_button extends BaseEntity {
    public static classname = 'prop_under_button';

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        if (entity.model === undefined)
            entity.model = 'models/props_underground/underground_testchamber_button.mdl';
        super(entitySystem, renderContext, bspRenderer, entity);
    }
}

class prop_under_floor_button extends BaseFloorButton {
    public static classname = 'prop_under_floor_button';

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        if (entity.model === undefined)
            entity.model = 'models/props_underground/underground_floor_button.mdl';
        super(entitySystem, renderContext, bspRenderer, entity);
        this.upSequence = 'release';
        this.downSequence = 'press';
        this.trigger.setSize(new AABB(-30, -30, 0, 30, 30, 17));
    }
}

class prop_testchamber_door extends BaseEntity {
    public static classname = 'prop_testchamber_door';

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        if (entity.model === undefined)
            entity.model = 'models/props/portal_door_combined.mdl';
        super(entitySystem, renderContext, bspRenderer, entity);
    }
}

const scratchVec3a = vec3.create();
const scratchMat4a = mat4.create();
class prop_indicator_panel extends BaseEntity {
    public static classname = `prop_indicator_panel`;
    public materialInstance: BaseMaterial | null = null;

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);

        this.setMaterial(renderContext, `vgui/signage/vgui_indicator_unchecked.vmt`);

        this.registerInput('check', this.input_check.bind(this));
        this.registerInput('uncheck', this.input_uncheck.bind(this));
    }

    public async setMaterial(renderContext: SourceRenderContext, materialName: string) {
        const materialInstance = await renderContext.materialCache.createMaterialInstance(materialName);
        materialInstance.entityParams = this.ensureMaterialParams();
        await materialInstance.init(renderContext);
        this.materialInstance = materialInstance;
    }

    private setIndicatorLights(entitySystem: EntitySystem, valueNum: number): void {
        if (this.entity.indicatorlights === undefined)
            return;

        for (let i = 0; i < entitySystem.entities.length; i++) {
            const entity = entitySystem.entities[i];
            if (!entitySystem.entityMatchesTargetName(entity, this.entity.indicatorlights))
                continue;

            const materialParams = entity.materialParams;
            if (materialParams !== null)
                materialParams.textureFrameIndex = valueNum;
        }
    }

    private input_check(entitySystem: EntitySystem): void {
        this.setIndicatorLights(entitySystem, 1);
        this.setMaterial(entitySystem.renderContext, `vgui/signage/vgui_indicator_checked.vmt`);
    }

    private input_uncheck(entitySystem: EntitySystem): void {
        this.setIndicatorLights(entitySystem, 0);
        this.setMaterial(entitySystem.renderContext, `vgui/signage/vgui_indicator_unchecked.vmt`);
    }

    public override prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager): void {
        if (!this.shouldDraw())
            return;

        if (this.materialInstance === null)
            return;

        const view = renderContext.currentView;
        const modelMatrix = this.updateModelMatrix();
        getMatrixTranslation(scratchVec3a, modelMatrix);
        if (!view.frustum.containsSphere(scratchVec3a, 16))
            return;

        const renderInst = renderInstManager.newRenderInst();
        renderContext.materialCache.staticResources.staticQuad.setQuadOnRenderInst(renderInst);

        mat4.translate(scratchMat4a, modelMatrix, Vec3NegX);
        scaleMatrix(scratchMat4a, scratchMat4a, 16);
        this.materialInstance.setOnRenderInstModelMatrix(renderInst, scratchMat4a);
        this.materialInstance.setOnRenderInst(renderContext, renderInst);

        this.materialInstance.getRenderInstListForView(view).submitRenderInst(renderInst);
    }
}

async function createPortal2SourceLoadContext(context: SceneContext): Promise<SourceLoadContext> {
    function registerEntityFactories(registry: EntityFactoryRegistry): void {
        registry.registerFactory(trigger_portal_button);
        registry.registerFactory(prop_button);
        registry.registerFactory(prop_floor_button);
        registry.registerFactory(prop_floor_cube_button);
        registry.registerFactory(prop_floor_ball_button);
        registry.registerFactory(prop_under_button);
        registry.registerFactory(prop_under_floor_button);
        registry.registerFactory(prop_testchamber_door);
        registry.registerFactory(prop_indicator_panel);
    }

    const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
        const filesystem = new SourceFileSystem(context.dataFetcher);
        await Promise.all([
            filesystem.createZipMount(`${pathBase}/platform.zip`),
            filesystem.createVPKMount(`${pathBase}/portal2/pak01`),
            filesystem.createVPKMount(`${pathBase}/portal2_dlc1/pak01`),
            filesystem.createVPKMount(`${pathBase}/portal2_dlc2/pak01`),
        ]);

        filesystem.loose.push(new LooseMount(`${pathBase}/portal2`, [
            'particles/particles_manifest.txt',
        ]));

        return filesystem;
    });

    const loadContext = new SourceLoadContext(filesystem);
    registerEntityFactories(loadContext.entityFactoryRegistry);
    return loadContext;
}

class Portal2SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const loadContext = await createPortal2SourceLoadContext(context);
        return createScene(context, loadContext, this.id, `${pathBase}/portal2/maps/${this.id}.bsp`, false);
    }
}

interface SteamAPIResult_QueryFilesFile {
    publishedfileid: string;
    file_url: string;
    preview_url: string;
    filename: string;
    title: string;
    tags: { tag: string, display_name: string }[];
}

interface SteamAPIResult_QueryFiles {
    next_cursor: string;
    total: number;
    publishedfiledetails: SteamAPIResult_QueryFilesFile[];
}

class WorkshopAPI {
    private STEAM_API_KEY = `DC399146B3FEF89B7373F367EDA99309`;

    constructor(private dataFetcher: DataFetcher) {
    }

    private getCORSBridgeURL(url: string): string {
        return `https://api.allorigins.win/raw?url=` + encodeURIComponent(url);
    }

    public async queryFiles(searchText: string = '', cursor = '*'): Promise<SteamAPIResult_QueryFiles> {
        const input_json = JSON.stringify({
            appid: 620, // Portal 2
            return_metadata: true,
            numperpage: 50,
            cursor,
            search_text: searchText,
        });

        const data = await this.dataFetcher.fetchURL(this.getCORSBridgeURL(`https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?key=${this.STEAM_API_KEY}&input_json=${input_json}`), { });
        return JSON.parse(decodeString(data)).response as SteamAPIResult_QueryFiles;
    }

    public getFileURL(file: SteamAPIResult_QueryFilesFile): string {
        return this.getCORSBridgeURL(`${file.file_url}`);
    }
}

class Portal2WorkshopSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string, public url: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const loadContext = await createPortal2SourceLoadContext(context);
        return createScene(context, loadContext, this.id, this.url, false);
    }
}

class Portal2WorkshopBrowseSceneDesc implements SceneDesc {
    public id = `Workshop`;
    public name = `Workshop`;

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        const workshopAPI = new WorkshopAPI(sceneContext.dataFetcher);
        
        const panel = window.main.ui.debugFloaterHolder.makeFloatingPanel('Portal 2 Workshop');
        panel.setWidth('80vw');
        panel.contents.style.maxHeight = '';
        panel.closeButton.style.display = 'none';

        const searchBox = new TextEntry();
        searchBox.setIcon(SEARCH_ICON);
        panel.contents.appendChild(searchBox.elem);

        let currentSearchResponse: SteamAPIResult_QueryFiles | null = null;

        const doSearch = async () => {
            const r = await workshopAPI.queryFiles(searchBox.textfield.getValue());
            currentSearchResponse = r;
            levelList.setItems(r.publishedfiledetails.map((file) => {
                const h = document.createElement('div');
                h.style.display = 'flex';
                h.style.gap = '8px';
                h.style.padding = '8px 0';

                const img = document.createElement('img');
                img.src = file.preview_url;
                img.style.width = '120px';
                img.style.objectFit = 'contain';
                h.appendChild(img);

                const header = document.createElement('div');

                const title = document.createElement('div');
                title.textContent = file.title;
                title.style.fontSize = 'larger';
                title.style.fontWeight = 'bold';
                header.appendChild(title);

                const tags = document.createElement('div');
                if (file.tags) {
                    file.tags.forEach((v) => {
                        const tag = document.createElement('span');
                        tag.style.margin = '0px 8px';
                        tag.style.padding = '4px';
                        tag.style.fontSize = 'smaller';
                        tag.style.color = 'white';
                        tag.style.textShadow = `0 0 8px black`;
                        tag.style.backgroundColor = HIGHLIGHT_COLOR;
                        tag.textContent = v.display_name;
                        tags.appendChild(tag);
                    });
                }
                header.appendChild(tags);

                h.appendChild(header);

                const item: ScrollSelectItem = {
                    type: ScrollSelectItemType.Selectable,
                    visible: true,
                    html: h,
                };
                return item;
            }));
        };

        searchBox.textfield.elem.addEventListener('keyup', (e) => {
            if (e.key === 'Enter')
                doSearch();
        });

        const levelList = new SingleSelect();
        levelList.setHeight('70vh');
        levelList.onselectionchange = (index: number) => {
            if (currentSearchResponse === null)
                return;

            const file = currentSearchResponse.publishedfiledetails[index];

            // Load the new scene.
            const file_url = workshopAPI.getFileURL(file);
            const sceneDesc = new Portal2WorkshopSceneDesc(file.publishedfileid, file.title, file_url);
            (window.main as any)._loadSceneDesc(sceneGroup, sceneDesc);
        };
        panel.contents.appendChild(levelList.elem);

        return new EmptyScene();
    }
}

const pathBase = `Portal2`;

const id = 'Portal2';
const name = 'Portal 2';
const sceneDescs = [
    "Single Player - Chapter 1",
    new Portal2SceneDesc("sp_a1_intro1", "Container Ride"),
    new Portal2SceneDesc("sp_a1_intro2", "Portal Carousel"),
    new Portal2SceneDesc("sp_a1_intro3", "Portal Gun"),
    new Portal2SceneDesc("sp_a1_intro4", "Smooth Jazz"),
    new Portal2SceneDesc("sp_a1_intro5", "Cube Momentum"),
    new Portal2SceneDesc("sp_a1_intro6", "Future Starter"),
    new Portal2SceneDesc("sp_a1_intro7", "Secret Panel"),
    new Portal2SceneDesc("sp_a1_wakeup", "Wakeup"),
    new Portal2SceneDesc("sp_a2_intro", "Incinerator"),

    "Single Player - Chapter 2",
    new Portal2SceneDesc("sp_a2_laser_intro", "Laser Intro"),
    new Portal2SceneDesc("sp_a2_laser_stairs", "Laser Stairs"),
    new Portal2SceneDesc("sp_a2_dual_lasers", "Dual Lasers"),
    new Portal2SceneDesc("sp_a2_laser_over_goo", "Laser Over Goo"),
    new Portal2SceneDesc("sp_a2_catapult_intro", "Catapult Intro"),
    new Portal2SceneDesc("sp_a2_trust_fling", "Trust Fling"),
    new Portal2SceneDesc("sp_a2_pit_flings", "Pit Flings"),
    new Portal2SceneDesc("sp_a2_fizzler_intro", "Fizzler Intro"),

    "Single Player - Chapter 3",
    new Portal2SceneDesc("sp_a2_sphere_peek", "Ceiling Catapult"),
    new Portal2SceneDesc("sp_a2_ricochet", "Ricochet"),
    new Portal2SceneDesc("sp_a2_bridge_intro", "Bridge Intro"),
    new Portal2SceneDesc("sp_a2_bridge_the_gap", "Bridge the Gap"),
    new Portal2SceneDesc("sp_a2_turret_intro", "Turret Intro"),
    new Portal2SceneDesc("sp_a2_laser_relays", "Laser Relays"),
    new Portal2SceneDesc("sp_a2_turret_blocker", "Turret Blocker"),
    new Portal2SceneDesc("sp_a2_laser_vs_turret", "Laser vs. Turret"),
    new Portal2SceneDesc("sp_a2_pull_the_rug", "Pull the Rug"),

    "Single Player - Chapter 4",
    new Portal2SceneDesc("sp_a2_column_blocker", "Column Blocker"),
    new Portal2SceneDesc("sp_a2_laser_chaining", "Laser Chaining"),
    new Portal2SceneDesc("sp_a2_triple_laser", "Triple Laser"),
    new Portal2SceneDesc("sp_a2_bts1", "Jail Break"),
    new Portal2SceneDesc("sp_a2_bts2", "Escape"),

    "Single Player - Chapter 5",
    new Portal2SceneDesc("sp_a2_bts3", "Turret Factory"),
    new Portal2SceneDesc("sp_a2_bts4", "Turret Sabotage"),
    new Portal2SceneDesc("sp_a2_bts5", "Neurotoxin Sabotage"),
    new Portal2SceneDesc("sp_a2_bts6", "Tube Ride"),
    new Portal2SceneDesc("sp_a2_core", "Core"),

    "Single Player - Chapter 6",
    new Portal2SceneDesc("sp_a3_00", "Long Fall"),
    new Portal2SceneDesc("sp_a3_01", "Underground"),
    new Portal2SceneDesc("sp_a3_03", "Cave Johnson"),
    new Portal2SceneDesc("sp_a3_jump_intro", "Repulsion Intro"),
    new Portal2SceneDesc("sp_a3_bomb_flings", "Bomb Flings"),
    new Portal2SceneDesc("sp_a3_crazy_box", "Crazy Box"),
    new Portal2SceneDesc("sp_a3_transition01", "PotatOS"),

    "Single Player - Chapter 7",
    new Portal2SceneDesc("sp_a3_speed_ramp", "Propulsion Intro"),
    new Portal2SceneDesc("sp_a3_speed_flings", "Propulsion Flings"),
    new Portal2SceneDesc("sp_a3_portal_intro", "Conversion Intro"),
    new Portal2SceneDesc("sp_a3_end", "Three Gels"),

    "Single Player - Chapter 8",
    new Portal2SceneDesc("sp_a4_intro", "Test"),
    new Portal2SceneDesc("sp_a4_tb_intro", "Funnel Intro"),
    new Portal2SceneDesc("sp_a4_tb_trust_drop", "Ceiling Button"),
    new Portal2SceneDesc("sp_a4_tb_wall_button", "Wall Button"),
    new Portal2SceneDesc("sp_a4_tb_polarity", "Polarity"),
    new Portal2SceneDesc("sp_a4_tb_catch", "Funnel Catch"),
    new Portal2SceneDesc("sp_a4_stop_the_box", "Stop the Box"),
    new Portal2SceneDesc("sp_a4_laser_catapult", "Laser Catapult"),
    new Portal2SceneDesc("sp_a4_laser_platform", "Laser Platform"),
    new Portal2SceneDesc("sp_a4_speed_tb_catch", "Propulsion Catch"),
    new Portal2SceneDesc("sp_a4_jump_polarity", "Repulsion Polarity"),

    "Single Player - Chapter 9",
    new Portal2SceneDesc("sp_a4_finale1", "Finale 1"),
    new Portal2SceneDesc("sp_a4_finale2", "Finale 2"),
    new Portal2SceneDesc("sp_a4_finale3", "Finale 3"),
    new Portal2SceneDesc("sp_a4_finale4", "Finale 4"),
    new Portal2SceneDesc("sp_a5_credits", "Credits"),

    "Multi-Player",
    new Portal2SceneDesc("mp_coop_start", "Start"),
    new Portal2SceneDesc("mp_coop_lobby_2", "Lobby"),
    new Portal2SceneDesc("mp_coop_credits", "Credits"),

    "Multi-Player - Trial 1",
    new Portal2SceneDesc("mp_coop_doors", "01 Doors"),
    new Portal2SceneDesc("mp_coop_race_2", "02 Buttons"),
    new Portal2SceneDesc("mp_coop_laser_2", "03 Lasers"),
    new Portal2SceneDesc("mp_coop_rat_maze", "04 Rat Maze"),
    new Portal2SceneDesc("mp_coop_laser_crusher", "05 Laser Crusher"),
    new Portal2SceneDesc("mp_coop_teambts", "06 Behind the Scenes"),

    "Multi-Player - Trial 2",
    new Portal2SceneDesc("mp_coop_fling_3", "01 Flings"),
    new Portal2SceneDesc("mp_coop_infinifling_train", "02 Infinifling"),
    new Portal2SceneDesc("mp_coop_come_along", "03 Team Retrieval"),
    new Portal2SceneDesc("mp_coop_fling_1", "04 Vertical Flings"),
    new Portal2SceneDesc("mp_coop_catapult_1", "05 Catapults"),
    new Portal2SceneDesc("mp_coop_multifling_1", "06 Multifling"),
    new Portal2SceneDesc("mp_coop_fling_crushers", "07 Fling Crushers"),
    new Portal2SceneDesc("mp_coop_fan", "08 Industrial Fan"),

    "Multi-Player - Trial 3",
    new Portal2SceneDesc("mp_coop_wall_intro", "01 Cooperative Bridges"),
    new Portal2SceneDesc("mp_coop_wall_2", "02 Bridge Swap"),
    new Portal2SceneDesc("mp_coop_catapult_wall_intro", "03 Fling Block"),
    new Portal2SceneDesc("mp_coop_wall_block", "04 Catapult Block"),
    new Portal2SceneDesc("mp_coop_catapult_2", "05 Bridge Fling"),
    new Portal2SceneDesc("mp_coop_turret_walls", "06 Turret Walls"),
    new Portal2SceneDesc("mp_coop_turret_ball", "07 Turret Assassin"),
    new Portal2SceneDesc("mp_coop_wall_5", "08 Bridge Testing"),

    "Multi-Player - Trial 4",
    new Portal2SceneDesc("mp_coop_tbeam_redirect", "01 Cooperative Funnels"),
    new Portal2SceneDesc("mp_coop_tbeam_drill", "02 Funnel Drill"),
    new Portal2SceneDesc("mp_coop_tbeam_catch_grind_1", "03 Funnel Catch"),
    new Portal2SceneDesc("mp_coop_tbeam_laser_1", "04 Funnel Laser"),
    new Portal2SceneDesc("mp_coop_tbeam_polarity", "05 Cooperative Polarity"),
    new Portal2SceneDesc("mp_coop_tbeam_polarity2", "06 Funnel Hop"),
    new Portal2SceneDesc("mp_coop_tbeam_polarity3", "07 Advanced Polarity"),
    new Portal2SceneDesc("mp_coop_tbeam_maze", "08 Funnel Maze"),
    new Portal2SceneDesc("mp_coop_tbeam_end", "09 Turret Warehouse"),

    "Multi-Player - Trial 5",
    new Portal2SceneDesc("mp_coop_paint_come_along", "01 Repulsion Jumps"),
    new Portal2SceneDesc("mp_coop_paint_redirect", "02 Double Bounce"),
    new Portal2SceneDesc("mp_coop_paint_bridge", "03 Bridge Repulsion"),
    new Portal2SceneDesc("mp_coop_paint_walljumps", "04 Wall Repulsion"),
    new Portal2SceneDesc("mp_coop_paint_speed_fling", "05 Propulsion Crushers"),
    new Portal2SceneDesc("mp_coop_paint_red_racer", "06 Turret Ninja"),
    new Portal2SceneDesc("mp_coop_paint_speed_catch", "07 Propulsion Retrieval"),
    new Portal2SceneDesc("mp_coop_paint_longjump_intro", "08 Vault Entrance"),

    "Super 8 Teaser",
    new Portal2SceneDesc("e1912"),
    "Workshop",
    new Portal2WorkshopBrowseSceneDesc(),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
