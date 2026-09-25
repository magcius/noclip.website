
// Harvest Moon: Another Wonderful Life - scene registration.

import { mat4, vec3 } from "gl-matrix";

import { Color, colorNewFromRGBA } from "../Color.js";

import * as GX from "../gx/gx_enum.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { setMatrixTranslation } from "../MathHelpers.js";
import { SceneContext, SceneDesc } from "../SceneBase.js";
import * as UI from "../ui.js";
import { SceneGfx, SceneGroup } from "../viewer.js";

import * as Act from "./Act.js";
import * as Cloud from "./Cloud.js";
import * as Crop from "./Crop.js";
import * as Env from "./Env.js";
import * as FarmSoil from "./FarmSoil.js";
import * as Gpl from "./Gpl.js";
import * as Grass from "./Grass.js";
import * as HousePart from "./HousePart.js";
import * as Lamp from "./Lamp.js";
import * as Leaf from "./Leaf.js";
import * as Lod from "./Lod.js";
import * as Material from "./Material.js";
import * as Oqt from "./Oqt.js";
import * as Ptcl from "./Ptcl.js";
import * as Room from "./Room.js";
import * as RoomCuration from "./RoomCuration.js";
import * as Rain from "./Rain.js";
import { Rng } from "./Rng.js";
import * as Snow from "./Snow.js";
import * as Season from "./Season.js";
import * as Moon from "./Moon.js";
import * as Stars from "./Stars.js";
import * as Sun from "./Sun.js";
import * as Tpl from "./Tpl.js";
import * as Txg from "./Txg.js";
import * as Shadow from "./Shadow.js";
import * as Sway from "./Sway.js";
import * as Tv from "./Tv.js";
import * as Water from "./Water.js";
import * as Weather from "./Weather.js";
import * as Wind from "./Wind.js";
import * as WildPlant from "./WildPlant.js";
import { BuiltModel, cloudQuadMesh, HarvestMoonAWLRenderer, LAMP_LIGHT_MAP_ATLAS, LAMP_LIT_ATLAS, leafQuadMesh, ModelData, ModelInstance, ParticleGroup, rainStreakMesh, starBatchMesh, StarBatchEntry, sunRayMesh, unitQuadMesh, waterTintPassC0 } from "./Render.js";

//#region UI widgets

// Multiple chapter (e.g chapter 2 and 3) layers can be active at a time
class ChapterLayer implements UI.Layer {
    public visible: boolean;
    constructor(public name: string, private instances: ModelInstance[], defaultVisible: boolean = true) {
        this.visible = defaultVisible;
        this.setVisible(defaultVisible);
    }
    public setVisible(v: boolean): void {
        this.visible = v;
        for (const inst of this.instances)
            inst.visible = v;
    }
}

// simple show/hide for geometry in this layer
class ExclusiveLayer implements UI.Layer {
    public visible: boolean;
    constructor(public name: string, private offInstances: ModelInstance[], private onInstances: ModelInstance[], defaultVisible: boolean, private onChange: ((v: boolean) => void) | null = null) {
        this.visible = defaultVisible;
        this.setVisible(defaultVisible);
    }
    public setVisible(v: boolean): void {
        this.visible = v;
        for (const inst of this.onInstances)
            inst.visible = v;
        for (const inst of this.offInstances)
            inst.visible = !v;
        if (this.onChange !== null)
            this.onChange(v);
    }
}

const pathBase = `HarvestMoonAWL`;
// A season is ten days, laid out as a 5x2 calendar grid
class DayCalendar implements UI.Widget {
    public elem: HTMLElement;
    public onselectday: ((day: number) => void) | null = null;

    private cells: HTMLElement[] = [];
    private selectedDay: number = -1;

    constructor(dayCount: number, columns: number = 5) {
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
        grid.style.gap = '4px';
        grid.style.padding = '4px 0';

        for (let i = 0; i < dayCount; i++) {
            const cell = document.createElement('div');
            cell.style.position = 'relative';
            cell.style.height = '34px';
            cell.style.border = '1px solid #666';
            cell.style.cursor = 'pointer';
            cell.style.userSelect = 'none';

            const number = document.createElement('div');
            number.style.position = 'absolute';
            number.style.right = '4px';
            number.style.bottom = '2px';
            number.style.fontWeight = 'bold';
            number.style.lineHeight = '16px';
            number.textContent = `${i + 1}`;
            cell.appendChild(number);

            cell.onclick = () => {
                this.setSelectedDay(i);
                if (this.onselectday !== null)
                    this.onselectday(i);
            };

            grid.appendChild(cell);
            this.cells.push(cell);
        }

        this.elem = grid;

        this.syncHighlight();
    }

    public setSelectedDay(day: number): void {
        if (this.selectedDay === day)
            return;
        this.selectedDay = day;
        this.syncHighlight();
    }

    private syncHighlight(): void {
        for (let i = 0; i < this.cells.length; i++)
            UI.setElementHighlighted(this.cells[i], i === this.selectedDay);
    }
}

//#endregion

//#region Atlas keys and seasons

const MAPOBJ_ATLAS = `mapobj`;
const GROUND_ATLAS = `ground`;
const WATER_ATLAS = `water`;

const WATER_BUMP_ATLAS = `water-bump`;
const WATER_FOAM_ATLAS = `water-foam`;

const SEASONS: { label: string }[] = [
    { label: "Spring" },
    { label: "Summer" },
    { label: "Autumn" },
    { label: "Winter" },
];

const LAMP_GLOW_ATLAS = `maplamp`;
const SUN_ATLAS = `sun`;
const SKY_ATLAS = `sky`;
const MOON_ATLAS = `moon`;
const STAR_ATLAS = `star`;
const CLOUD_ATLAS = `cloud`;

const SNOW_ATLAS = `snow`;
const MAPLEAF_ATLAS = `mapleaf`;
const WILDPLANT_ATLAS = `wildplant`;
const GRASS_ATLAS = `grass`;

//#endregion

//#region VFX Constants

const PTCL_ATLAS = `ptcl`;
const PTCL_UNPLACED_RECORD = 3;

//#endregion

//#region Placement Categories

const DIRECT_INDEX_CATEGORIES = ["p-plant", "p-other"];
const HOUSE_ID_BASE = 20000;

// Player's house grows across chapters by swapping act model. 
// map1's p-house.oqt only has the year-1 act, so the other three use this
const PLAYER_HOUSE_GROWTH_X = 169;
const PLAYER_HOUSE_GROWTH_Z = 116;
const PLAYER_HOUSE_GROWTH_ACTS = ["mapobj--0.act", "mapobj--25.act", "mapobj--26.act", "mapobj--27.act"];
// Player house doesn't change in chapter 5
const PLAYER_HOUSE_GROWTH_STAGE_BY_CHAPTER = [0, 1, 2, 3, 3];

//#endregion

//#region Dig Site

// The digsite expands outwards with certain chapters
const DIG_SITE_BBOX = { xMin: 255, xMax: 300, zMin: 195, zMax: 235 };
const DIG_SITE_TYPE_IDS: ReadonlySet<number> = new Set([128, 137, 138, 139, 140]); // fence, rocks, tarp
const DIG_SITE_STAGE_MAPS = ["map1", "map3", "map5"];
const DIG_SITE_STAGE_BY_CHAPTER = [0, 0, 1, 1, 2];

//#endregion

//#region Ground-cover Tiles and Pond

const GROUND_COVER_TILES = [
    "jimen-field3-0", "jimen-field3-1", "jimen-reservoir-0", "jimen-reservoir-1",
    "jimen-L-0-0-1", "jimen-L-0-0-2", "jimen-L-0-0-3",
    "jimen-L-1-0-0", "jimen-L-1-0-1", "jimen-L-1-0-2", "jimen-L-1-0-3",
    "jimen-L-2-0-0", "jimen-L-2-0-1", "jimen-L-2-0-2", "jimen-L-2-0-3",
    "jimen-L-3-0-0", "jimen-L-3-0-1", "jimen-L-3-0-2", "jimen-L-3-0-3",
    "jimen-bottom",
];

// Enabled/disabled by a layer
const POND_EMPTY_GROUND_TILE = "jimen-reservoir-0";
const POND_FULL_GROUND_TILE = "jimen-reservoir-1";
const POND_WATER_TYPE_ID = 40158; // mapwater_0007_id40158_x194_z135

//#endregion

//#region Layers

const MILKING_ROOM_HOUSE_CANONICAL = "house_mapobj--22_x174_z136";
const MILKING_ROOM_PLACEHOLDER_CANONICAL = "p-other_id217_x0_z0";

const FOOD_PROCESSING_ROOM_HOUSE_CANONICAL = "house_mapobj--24_x163_z133";

const EMPTY_SHED_CANONICAL = "house_mapobj--3_x206_z118";
const CHICKEN_YARD_PLACEHOLDER_CANONICAL = "p-other_id285_x0_z0";

const CALF_HUTCH_CANONICAL = "p-other_id90_x180_z148";

const UNKNOWN_BARN_MACHINE_CANONICAL = "p-other_id144_x176_z139";

const VANS_SHOP_CANONICAL_NAMES: ReadonlySet<string> = new Set([
    "p-obst_id283_x140_z105",
    "p-other_id283_x140_z105",
    "p-other_id141_x140_z105",
]);

const PLAYERS_SHOP_CANONICAL_NAMES: ReadonlySet<string> = new Set([
    "p-other_id142_x140_z105", // p-other_0194_id142_x140_z105
    "p-other_id284_x140_z105", // p-other_0195_id284_x140_z105
]);

// Appears to be a duplicate of the calf hutch
const PERMANENTLY_HIDDEN_CANONICAL_NAMES: ReadonlySet<string> = new Set([
    "p-other_id267_x180_z148",
]);

//#endregion

//#region Shadow show/hide
// Enable/disable certain shadows based on layers

const SHADOW_CASTER_PROXY_CANONICAL: ReadonlyMap<number, string> = new Map([
    [171, FOOD_PROCESSING_ROOM_HOUSE_CANONICAL],
    [172, MILKING_ROOM_HOUSE_CANONICAL],
    [216, EMPTY_SHED_CANONICAL],
]);

const PLAYER_HOUSE_GROWTH_CASTER_MAPS = ["map1", "map2", "map3", "map4"];

const MAP2_ONLY_HOUSE_ACTS = ["mapobj--8.act", "mapobj--16.act"];
const MAP2_ONLY_HOUSE_POSITIONS: [number, number][] = [[156.1, 73.9], [124.1, 218.0]];
const MAP2_ONLY_PROP_RADIUS = 15;

//#endregion

//#region Big Field
// Has foliage and a different ground cover when locked, regular field tiles when unlocked

const BIG_FIELD_LOCKED_GROUND_TILE = "jimen-field3-0";
const BIG_FIELD_UNLOCKED_GROUND_TILE = "jimen-field3-1";
const MAP_FIELD3_CATEGORY = "map-field3";

const FARM_GRIDS: { name: string; origin: [number, number, number]; rows: number; cols: number }[] = [
    { name: "A", origin: [172.0, 12.5, 112.0], rows: 7, cols: 5 },
    { name: "B", origin: [193.0, 12.5, 112.0], rows: 5, cols: 7 },
    { name: "C", origin: [217.0, 14.0, 114.0], rows: 10, cols: 14 },
];
const FARM_ATLAS = `farm`;

//#endregion

//#region Room layout

const ROOM_ATLAS = `room`;
// TV easter egg's atlas (Tv.ts)
const TV_ATLAS = `tv-console2`;

const ROOM_EYE_HEIGHT = 1.7;
const ROOM_CAMERA_INSET = 1.2;

// Midday
const ROOM_DEFAULT_TIME_SECONDS = 12 * 3600;

//#endregion

//#region Room object layers

interface RoomObjectLayer {
    objectId: number;
    name: string;
    defaultVisible: boolean;
    // Exists so we can prevent a layer from appearing in the UI
    // Specifically the storage room fridge base layer
    inPanel?: boolean;
}

// Four decor themes for chapter 2-4 house
const HOUSE_STYLES = ["poor", "mumu", "nami", "sepiria"];

const alarmClockLayer = (objectId: number, defaultVisible: boolean): RoomObjectLayer[] =>
    [{ objectId, name: "Alarm clock", defaultVisible }];

const CODY_STATUE_LIVING_ROOM = "Cody's Statue (Living Room)";
const CODY_STATUE_BEDROOM = "Cody's Statue (Bedroom)";
const BEDROOM_VASE = "Vase";

const idRange = (lo: number, hi: number): number[] => {
    const out: number[] = [];
    for (let id = lo; id <= hi; id++)
        out.push(id);
    return out;
};

const ISOLATION_FENCE = "Isolation Fence";
const BARN_ISOLATION_FENCE_OBJECTS = [110, 111, 112, 116];
const BARN_ARCHIVES = ["doubutsugoya.arc", "doubutsugoya1.arc"];

const SHIPPING_FRIDGE_STATES = [
    `empty`,
    `Less than 10 milk`,
    `10+ milk`,
    `Less than 10 eggs`,
    `10+ eggs`,
    `full`,
];

const SHIPPING_FRIDGE_LAYERS: RoomObjectLayer[] = Room.NAMED_VARIANT_GROUPS[0].map((objectId, i) => ({
    objectId, name: `Fridge: ${SHIPPING_FRIDGE_STATES[i]}`, defaultVisible: i === 0, inPanel: i > 0,
}));

const SHIPPING_FRIDGE_ARCHIVES = ["syokumotsuko.arc", "syokumotsuko1.arc"];

const BARN_FEED_BIN_LAYERS: RoomObjectLayer[] = idRange(0, 7).flatMap((stall) => [
    { objectId: 76 + stall, name: `Stall ${stall + 1} Double Feed Bin`, defaultVisible: false },
    { objectId: 84 + stall, name: `Stall ${stall + 1} Single Feed Bin`, defaultVisible: false },
]);

const ROOM_OBJECT_LAYERS: ReadonlyMap<string, RoomObjectLayer[]> = new Map([
    ["jitaku-living.arc", alarmClockLayer(1, false)],
    ...HOUSE_STYLES.flatMap((style): [string, RoomObjectLayer[]][] => [
        [`jitaku-living1_${style}.arc`, alarmClockLayer(1, true)],
        [`jitaku-living2_${style}.arc`, alarmClockLayer(1, true)],
        [`jitaku-living3_${style}.arc`, [
            ...alarmClockLayer(1, true),
            { objectId: 6, name: CODY_STATUE_LIVING_ROOM, defaultVisible: true },
        ]],
        [`jitaku-shinshitsu_${style}.arc`, [
            ...alarmClockLayer(42, true),
            { objectId: 46, name: BEDROOM_VASE, defaultVisible: true },
            { objectId: 47, name: CODY_STATUE_BEDROOM, defaultVisible: true },
        ]],
    ]),
    ...BARN_ARCHIVES.map((archiveName): [string, RoomObjectLayer[]] => [archiveName, [
        ...BARN_FEED_BIN_LAYERS,
        ...BARN_ISOLATION_FENCE_OBJECTS.map((objectId) => ({ objectId, name: ISOLATION_FENCE, defaultVisible: false })),
    ]]),
    ...SHIPPING_FRIDGE_ARCHIVES.map((archiveName): [string, RoomObjectLayer[]] => [archiveName, SHIPPING_FRIDGE_LAYERS]),
] as [string, RoomObjectLayer[]][]);

// Fodder drop indicators and the other isolation fences
const BARN_HIDDEN_OBJECTS: ReadonlySet<number> = new Set([
    ...idRange(52, 75),
    ...idRange(92, 109), 113, 114, 115, 119,
]);

const ROOM_HIDDEN_OBJECTS: ReadonlyMap<string, ReadonlySet<number>> = new Map(
    BARN_ARCHIVES.map((archiveName): [string, ReadonlySet<number>] => [archiveName, BARN_HIDDEN_OBJECTS]));

//#endregion

//#region Overworld Scene

// Manually placed outside the player's house
const OUTDOOR_CAMERA_EYE = vec3.fromValues(168.14, 15.14, 127.19);
const OUTDOOR_CAMERA_YAW = Math.PI;

class PopulatedSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string, private mapName: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const fetchOptional = (path: string) => dataFetcher.fetchData(`${pathBase}/${path}`, { allow404: true }).then((d) => (d.byteLength > 0 ? d : null), () => null);

        const defaultSheet = Season.sheetForDay(0, Season.DEFAULT_DAY);
        const [mapobjData, mapobjTplData, groundTplData] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/mapobj.gpl`),
            dataFetcher.fetchData(`${pathBase}/${Season.mapobjSheetFileName(defaultSheet)}`),
            dataFetcher.fetchData(`${pathBase}/${Season.groundSheetFileName(defaultSheet)}`),
        ]);

        const renderer = new HarvestMoonAWLRenderer(device);
        renderer.registerAtlas(MAPOBJ_ATLAS, Tpl.parse(mapobjTplData), Season.sheetVariantName(defaultSheet));
        renderer.registerAtlas(GROUND_ATLAS, Tpl.parse(groundTplData), Season.sheetVariantName(defaultSheet));

        const instancesByChapterLayer: ModelInstance[][] = [[], [], [], []];
        const pondEmptyInstances: ModelInstance[] = [];
        const pondFullInstances: ModelInstance[] = [];
        const milkingRoomPlaceholderInstances: ModelInstance[] = [];
        const milkingRoomHouseInstances: ModelInstance[] = [];
        const bigFieldLockedInstances: ModelInstance[] = [];
        const bigFieldUnlockedInstances: ModelInstance[] = [];
        const emptyShedInstances: ModelInstance[] = [];
        const chickenYardPlaceholderInstances: ModelInstance[] = [];
        const foodProcessingRoomInstances: ModelInstance[] = [];
        const calfHutchInstances: ModelInstance[] = [];
        const unknownBarnMachineInstances: ModelInstance[] = [];
        const vansShopInstances: ModelInstance[] = [];
        const playersShopInstances: ModelInstance[] = [];
        const directIndexCanonicalName = (cat: string, typeId: number, x: number, z: number): string =>
            `${cat}_id${typeId}_x${Math.round(x)}_z${Math.round(z)}`;
        const map1POtherCanonicalNames = new Set<string>();
        const playerHouseGrowthInstancesByStage: ModelInstance[][] = [[], [], [], []];
        const playerHouseGrowthCastersByStage: ModelInstance[][] = [[], [], [], []];
        const map1ObstCanonicalNames = new Set<string>();
        const digSiteInstancesByStage: ModelInstance[][] = [[], [], []];
        const inDigSiteBbox = (x: number, z: number): boolean =>
            x >= DIG_SITE_BBOX.xMin && x <= DIG_SITE_BBOX.xMax && z >= DIG_SITE_BBOX.zMin && z <= DIG_SITE_BBOX.zMax;

        const { blocks: mapobjBlocks } = Gpl.walkBlockTable(mapobjData);
        const blockByIndex = new Map<number, Gpl.GplBlock>();
        for (const b of mapobjBlocks)
            blockByIndex.set(b.index, b);

        const mapwaterOqtData = await fetchOptional(`mapwater.oqt`);

        const lodData = await fetchOptional(`mapobj.lod`);
        const lodTable = lodData !== null ? Lod.parse(lodData) : null;
        const meshCache = Gpl.loadAllMeshes(mapobjData);

        const mat = Material.staticMaterialForMapobj(mapobjData);

        const getOrCreateBlockModel = (blockIndex: number, cullBack: boolean = false) => renderer.modelCache.getOrCreate(`block${cullBack ? "-back" : ""}:${blockIndex}`, (): BuiltModel | null => {
            const mesh = meshCache.get(blockIndex);
            const block = blockByIndex.get(blockIndex);
            if (mesh === undefined || block === undefined)
                return null;
            const imageIndexByTriangle = Material.imageIndexByTriangle(mesh, block, mat);
            return { mesh, imageIndexByTriangle, atlasKey: MAPOBJ_ATLAS, materialKey: cullBack ? "opaque-back" : "opaque", litSwap: true };
        });

        //#region Direct-index categories

        for (const cat of DIRECT_INDEX_CATEGORIES) {
            const oqtData = await fetchOptional(`${this.mapName}-${cat}.oqt`);
            if (oqtData === null)
                continue;
            for (const inst of Oqt.allInstances(oqtData)) {
                const typeId = Oqt.oqtTypeId(inst);
                const canonicalName = directIndexCanonicalName(cat, typeId, inst.pos[0], inst.pos[2]);
                if (cat === "p-other")
                    map1POtherCanonicalNames.add(canonicalName);
                if (PERMANENTLY_HIDDEN_CANONICAL_NAMES.has(canonicalName))
                    continue;
                const modelData = getOrCreateBlockModel(typeId, cat === "p-other");
                if (modelData === null)
                    continue;
                const modelInst = new ModelInstance(modelData);
                Oqt.oqtRecordMatrix(modelInst.modelMatrix, inst);

                if (cat === "p-plant")
                    modelInst.swayMode = Sway.swayModeForBlock(typeId);
                if (lodTable !== null) {
                    const farTypeId = lodTable.resolve(typeId, true);
                    if (farTypeId !== typeId) {
                        modelInst.lodFar = getOrCreateBlockModel(farTypeId, cat === "p-other");
                        modelInst.lodFarSwayMode = cat === "p-plant" ? Sway.swayModeForBlock(farTypeId) : Sway.SwayMode.Static;
                    }
                }
                
                renderer.instances.push(modelInst);
                if (canonicalName === MILKING_ROOM_PLACEHOLDER_CANONICAL)
                    milkingRoomPlaceholderInstances.push(modelInst);
                else if (canonicalName === CALF_HUTCH_CANONICAL)
                    calfHutchInstances.push(modelInst);
                else if (canonicalName === UNKNOWN_BARN_MACHINE_CANONICAL)
                    unknownBarnMachineInstances.push(modelInst);
                else if (canonicalName === CHICKEN_YARD_PLACEHOLDER_CANONICAL)
                    chickenYardPlaceholderInstances.push(modelInst);
                else if (VANS_SHOP_CANONICAL_NAMES.has(canonicalName))
                    vansShopInstances.push(modelInst);
                else if (PLAYERS_SHOP_CANONICAL_NAMES.has(canonicalName))
                    playersShopInstances.push(modelInst);
                else if (cat === "p-other" && DIG_SITE_TYPE_IDS.has(typeId) && inDigSiteBbox(inst.pos[0], inst.pos[2]))
                    digSiteInstancesByStage[0].push(modelInst);
            }
        }

        //#endregion

        //#region Shadow Casters

        const houseActCasterRecords: { actName: string, inst: Oqt.OqtInstance }[] = [];

        const buildCaster = (typeId: number, inst: Oqt.OqtInstance, kind: Shadow.CasterKind): ModelInstance | null => {
            const modelData = kind === Shadow.CasterKind.Solid
                ? renderer.modelCache.getOrCreate(`shadow-caster:${typeId}`, (): BuiltModel | null => {
                    const mesh = meshCache.get(typeId);
                    if (mesh === undefined)
                        return null;
                    return { mesh, imageIndexByTriangle: mesh.triangles.map(() => 0), atlasKey: MAPOBJ_ATLAS, materialKey: "shadow-caster" };
                })
                : getOrCreateBlockModel(typeId);
            if (modelData === null)
                return null;
            const caster = new ModelInstance(modelData);
            Oqt.oqtRecordMatrix(caster.modelMatrix, inst);
            caster.shadowCaster = kind;
            renderer.shadowCasters.push(caster);
            return caster;
        };

        const routeCasterToLayer = (cat: string, typeId: number, inst: Oqt.OqtInstance, caster: ModelInstance): void => {
            const proxied = SHADOW_CASTER_PROXY_CANONICAL.get(typeId);
            const canonicalName = proxied !== undefined
                ? proxied
                : directIndexCanonicalName(cat, typeId, inst.pos[0], inst.pos[2]);
            if (canonicalName === MILKING_ROOM_HOUSE_CANONICAL)
                milkingRoomHouseInstances.push(caster);
            else if (canonicalName === FOOD_PROCESSING_ROOM_HOUSE_CANONICAL)
                foodProcessingRoomInstances.push(caster);
            else if (canonicalName === EMPTY_SHED_CANONICAL)
                emptyShedInstances.push(caster);
            else if (canonicalName === CALF_HUTCH_CANONICAL)
                calfHutchInstances.push(caster);
            else if (VANS_SHOP_CANONICAL_NAMES.has(canonicalName))
                vansShopInstances.push(caster);
            else if (PLAYERS_SHOP_CANONICAL_NAMES.has(canonicalName))
                playersShopInstances.push(caster);
        };

        for (const [cat, kind] of [["p-obst", Shadow.CasterKind.Solid], ["p-obstBB", Shadow.CasterKind.Billboard]] as const) {
            const oqtData = await fetchOptional(`${this.mapName}-${cat}.oqt`);
            if (oqtData === null)
                continue;
            for (const inst of Oqt.allInstances(oqtData)) {
                const typeId = Oqt.oqtTypeId(inst);
                if (cat === "p-obst")
                    map1ObstCanonicalNames.add(directIndexCanonicalName(cat, typeId, inst.pos[0], inst.pos[2]));
                
                // Windmills use a higher poly shadow model
                if (cat === "p-obst" && typeId >= HOUSE_ID_BASE) {
                    const catIdx = typeId - HOUSE_ID_BASE;
                    const actName = (catIdx < Act.HOUSE_CATALOG.length) ? Act.HOUSE_CATALOG[catIdx] : null;
                    if (actName !== null)
                        houseActCasterRecords.push({ actName, inst });
                    continue;
                }
                
                // Player house per-chapter check
                const isGrowthSlotCaster = cat === "p-obst"
                    && Math.round(inst.pos[0]) === PLAYER_HOUSE_GROWTH_X
                    && Math.round(inst.pos[2]) === PLAYER_HOUSE_GROWTH_Z;
                const caster = buildCaster(typeId, inst, kind);
                if (caster === null)
                    continue;
                if (isGrowthSlotCaster)
                    playerHouseGrowthCastersByStage[0].push(caster);
                else
                    routeCasterToLayer(cat, typeId, inst, caster);
            }
        }

        // Player House
        const growthStageObstData = await Promise.all(PLAYER_HOUSE_GROWTH_CASTER_MAPS.map((mapName, stage) =>
            stage === 0 ? Promise.resolve(null) : fetchOptional(`${mapName}-p-obst.oqt`)));
        for (let stage = 1; stage < PLAYER_HOUSE_GROWTH_CASTER_MAPS.length; stage++) {
            const stageObstData = growthStageObstData[stage];
            if (stageObstData === null)
                continue;
            for (const inst of Oqt.allInstances(stageObstData)) {
                if (Math.round(inst.pos[0]) !== PLAYER_HOUSE_GROWTH_X || Math.round(inst.pos[2]) !== PLAYER_HOUSE_GROWTH_Z)
                    continue;
                const caster = buildCaster(Oqt.oqtTypeId(inst), inst, Shadow.CasterKind.Solid);
                if (caster === null)
                    continue;
                caster.visible = false;
                playerHouseGrowthCastersByStage[stage].push(caster);
            }
        }

        // Chapter 2+ village buildings
        const map2ObstData = growthStageObstData[PLAYER_HOUSE_GROWTH_CASTER_MAPS.indexOf("map2")];
        if (map2ObstData !== null) {
            for (const inst of Oqt.allInstances(map2ObstData)) {
                const typeId = Oqt.oqtTypeId(inst);
                if (map1ObstCanonicalNames.has(directIndexCanonicalName("p-obst", typeId, inst.pos[0], inst.pos[2])))
                    continue;
                const nearHouse = MAP2_ONLY_HOUSE_POSITIONS.some(([hx, hz]) =>
                    Math.hypot(inst.pos[0] - hx, inst.pos[2] - hz) <= MAP2_ONLY_PROP_RADIUS);
                if (!nearHouse)
                    continue;
                const caster = buildCaster(typeId, inst, Shadow.CasterKind.Solid);
                if (caster === null)
                    continue;
                instancesByChapterLayer[0].push(caster);
            }
        }

        // Fences and planters around chapter 2+ buildings
        const map2OtherOqtData = await fetchOptional(`map2-p-other.oqt`);
        if (map2OtherOqtData !== null) {
            for (const inst of Oqt.allInstances(map2OtherOqtData)) {
                const typeId = Oqt.oqtTypeId(inst);
                const canonicalName = directIndexCanonicalName("p-other", typeId, inst.pos[0], inst.pos[2]);
                if (map1POtherCanonicalNames.has(canonicalName))
                    continue;
                const nearHouse = MAP2_ONLY_HOUSE_POSITIONS.some(([hx, hz]) =>
                    Math.hypot(inst.pos[0] - hx, inst.pos[2] - hz) <= MAP2_ONLY_PROP_RADIUS);
                if (!nearHouse)
                    continue;
                const modelData = getOrCreateBlockModel(typeId, true);
                if (modelData === null)
                    continue;
                const modelInst = new ModelInstance(modelData);
                Oqt.oqtRecordMatrix(modelInst.modelMatrix, inst);
                renderer.instances.push(modelInst);
                instancesByChapterLayer[0].push(modelInst);
            }
        }

        //#endregion

        //#region Dig Site

        for (let stage = 1; stage < DIG_SITE_STAGE_MAPS.length; stage++) {
            const stageOtherOqtData = await fetchOptional(`${DIG_SITE_STAGE_MAPS[stage]}-p-other.oqt`);
            if (stageOtherOqtData === null)
                continue;
            for (const inst of Oqt.allInstances(stageOtherOqtData)) {
                const typeId = Oqt.oqtTypeId(inst);
                if (!DIG_SITE_TYPE_IDS.has(typeId) || !inDigSiteBbox(inst.pos[0], inst.pos[2]))
                    continue;
                const modelData = getOrCreateBlockModel(typeId, true);
                if (modelData === null)
                    continue;
                const modelInst = new ModelInstance(modelData);
                Oqt.oqtRecordMatrix(modelInst.modelMatrix, inst);
                modelInst.visible = false;
                renderer.instances.push(modelInst);
                digSiteInstancesByStage[stage].push(modelInst);
            }
        }

        //#endregion

        //#region Big Field - Foliage

        const fieldOqtData = await fetchOptional(`${MAP_FIELD3_CATEGORY}.oqt`);
        if (fieldOqtData !== null) {
            for (const inst of Oqt.allInstances(fieldOqtData)) {
                const typeId = Oqt.oqtTypeId(inst);
                const modelData = getOrCreateBlockModel(typeId);
                if (modelData === null)
                    continue;
                const modelInst = new ModelInstance(modelData);
                Oqt.oqtRecordMatrix(modelInst.modelMatrix, inst);
                modelInst.swayMode = Sway.swayModeForBlock(typeId);
                renderer.instances.push(modelInst);
                bigFieldLockedInstances.push(modelInst);
            }
        }

        //#endregion

        //#region p-house

        const houseOqtData = await fetchOptional(`${this.mapName}-p-house.oqt`);
        if (houseOqtData !== null) {
            const actCache = new Map<string, Act.Act>();
            const partMatrixCache = new Map<string, mat4[]>();

            const loadHouseActInstances = async (actName: string, worldMatrix: mat4, casterKind: Shadow.CasterKind | null = null): Promise<ModelInstance[]> => {
                let house = actCache.get(actName);
                if (house === undefined) {
                    const actData = await fetchOptional(actName);
                    if (actData === null)
                        return [];
                    house = Act.loadAct(actData);
                    actCache.set(actName, house);
                }

                let partMatrices = partMatrixCache.get(actName);
                if (partMatrices === undefined) {
                    partMatrices = Act.partWorldMatrices(house);
                    partMatrixCache.set(actName, partMatrices);
                }
                const partMatricesForAct = partMatrices;
                const houseForAct = house;
                const spinPartIndex = HousePart.spinPartIndexForAct(actName);

                const doorsForInstance: { door: HousePart.Door, leaves: readonly HousePart.DoorLeaf[] }[] = [];
                if (casterKind === null) {
                    for (const leaves of HousePart.doorLeafSetsForAct(actName)) {
                        const door = new HousePart.Door();
                        renderer.doors.push(door);
                        doorsForInstance.push({ door, leaves });
                    }
                }

                const out: ModelInstance[] = [];
                for (const part of houseForAct.parts) {
                    if (part.partId === Act.NO_GEOMETRY)
                        continue;
                    const partMesh = meshCache.get(part.partId);
                    if (partMesh === undefined || partMesh.triangles.length === 0)
                        continue;

                    const partMatrix = partMatricesForAct[part.index];
                    const key = `house:${actName}:${part.index}`;
                    const modelData = renderer.modelCache.getOrCreate(key, (): BuiltModel | null => {
                        const block = blockByIndex.get(part.partId);
                        if (block === undefined)
                            return null;
                        const transformedMesh = Gpl.transformMesh(partMesh, partMatrix);
                        const imageIndexByTriangle = Material.imageIndexByTriangle(transformedMesh, block, mat);

                        return { mesh: transformedMesh, imageIndexByTriangle, atlasKey: MAPOBJ_ATLAS, materialKey: "opaque-back", litSwap: true };
                    });
                    if (modelData === null)
                        continue;

                    const modelInst = new ModelInstance(modelData);
                    mat4.copy(modelInst.modelMatrix, worldMatrix);
                    if (spinPartIndex !== null && part.index === spinPartIndex)
                        renderer.windmillRotors.push(HousePart.makeHinge(modelInst.modelMatrix, worldMatrix, partMatrix, HousePart.HingeAxis.X, HousePart.SPIN_TURN_DEG));
                    for (const { door, leaves } of doorsForInstance) {
                        const leaf = leaves.find((l) => l.partIndex === part.index);
                        if (leaf === undefined)
                            continue;
                        const hinge = HousePart.makeHinge(modelInst.modelMatrix, worldMatrix, partMatrix, HousePart.HingeAxis.Y, leaf.degrees);
                        door.hinges.push(hinge);
                        HousePart.growDoorBounds(door, hinge, modelData.boundsMin, modelData.boundsMax);
                        if (door.gate === null)
                            door.gate = modelInst;
                    }
                    if (casterKind !== null) {
                        modelInst.shadowCaster = casterKind;
                        renderer.shadowCasters.push(modelInst);
                    } else {
                        renderer.instances.push(modelInst);
                    }
                    out.push(modelInst);
                }
                return out;
            };

            for (const inst of Oqt.allInstances(houseOqtData)) {
                const catIdx = Oqt.oqtTypeId(inst) - HOUSE_ID_BASE;
                const actName = (catIdx >= 0 && catIdx < Act.HOUSE_CATALOG.length) ? Act.HOUSE_CATALOG[catIdx] : null;
                if (actName === null)
                    continue;
                const houseCanonicalName = `house_${actName.slice(0, -4)}_x${Math.round(inst.pos[0])}_z${Math.round(inst.pos[2])}`;

                const worldMatrix = mat4.create();
                Oqt.oqtRecordMatrix(worldMatrix, inst);
                const instances = await loadHouseActInstances(actName, worldMatrix);
                if (houseCanonicalName === MILKING_ROOM_HOUSE_CANONICAL)
                    milkingRoomHouseInstances.push(...instances);
                else if (houseCanonicalName === FOOD_PROCESSING_ROOM_HOUSE_CANONICAL)
                    foodProcessingRoomInstances.push(...instances);
                else if (houseCanonicalName === EMPTY_SHED_CANONICAL)
                    emptyShedInstances.push(...instances);

                if (actName === PLAYER_HOUSE_GROWTH_ACTS[0] &&
                    Math.round(inst.pos[0]) === PLAYER_HOUSE_GROWTH_X && Math.round(inst.pos[2]) === PLAYER_HOUSE_GROWTH_Z) {
                    playerHouseGrowthInstancesByStage[0] = instances;
                    for (let stage = 1; stage < PLAYER_HOUSE_GROWTH_ACTS.length; stage++) {
                        const stageInstances = await loadHouseActInstances(PLAYER_HOUSE_GROWTH_ACTS[stage], worldMatrix);
                        for (const modelInst of stageInstances)
                            modelInst.visible = false;
                        playerHouseGrowthInstancesByStage[stage] = stageInstances;
                    }
                }
            }

            const map2HouseOqtData = await fetchOptional(`map2-p-house.oqt`);
            if (map2HouseOqtData !== null) {
                for (const inst of Oqt.allInstances(map2HouseOqtData)) {
                    const catIdx = Oqt.oqtTypeId(inst) - HOUSE_ID_BASE;
                    const actName = (catIdx >= 0 && catIdx < Act.HOUSE_CATALOG.length) ? Act.HOUSE_CATALOG[catIdx] : null;
                    if (actName === null || !MAP2_ONLY_HOUSE_ACTS.includes(actName))
                        continue;
                    const worldMatrix = mat4.create();
                    Oqt.oqtRecordMatrix(worldMatrix, inst);
                    const instances = await loadHouseActInstances(actName, worldMatrix);
                    instancesByChapterLayer[0].push(...instances);
                }
            }

            for (const { actName, inst } of houseActCasterRecords) {
                const worldMatrix = mat4.create();
                Oqt.oqtRecordMatrix(worldMatrix, inst);
                await loadHouseActInstances(actName, worldMatrix, Shadow.CasterKind.Solid);
            }

        }

        //#endregion

        //#region mapwater

        const [mapwaterTplData, mapwaterBumpTplData] = await Promise.all([fetchOptional(`mapwater.tpl`), fetchOptional(`mapwater-bump.tpl`)]);
        if (mapwaterOqtData !== null && mapwaterTplData !== null && mapwaterBumpTplData !== null) {
            const mapwaterTpl = Tpl.parse(mapwaterTplData);
            renderer.registerAtlas(WATER_ATLAS, mapwaterTpl);
            renderer.registerAtlas(WATER_BUMP_ATLAS, Water.buildBumpSlopeMap(Tpl.parse(mapwaterBumpTplData)));
            renderer.registerAtlas(WATER_FOAM_ATLAS, Water.buildFoamTexture(mapwaterTpl));

            for (const inst of Oqt.allInstances(mapwaterOqtData)) {
                const rawTypeId = Oqt.oqtTypeId(inst);
                const blockIndex = rawTypeId % Room.WATER_ID_MOD;
                if (Water.isFoamOverlay(rawTypeId, Room.WATER_ID_MOD)) {
                    // Group 3 is the shoreline foam overlay
                    const foamData = renderer.modelCache.getOrCreate(`water-foam:${blockIndex}`, (): BuiltModel | null => {
                        const mesh = meshCache.get(blockIndex);
                        if (mesh === undefined)
                            return null;
                        return {
                            mesh,
                            imageIndexByTriangle: mesh.triangleOffsets.map(() => Water.FOAM_IMAGE_INDEX),
                            atlasKey: WATER_FOAM_ATLAS,
                            materialKey: `water-foam`,
                        };
                    });
                    if (foamData === null)
                        continue;
                    for (const phaseTicks of Water.FOAM_PHASE_TICKS) {
                        const foamInst = new ModelInstance(foamData);
                        Oqt.oqtRecordMatrix(foamInst.modelMatrix, inst);
                        foamInst.waterFoam = { phaseTicks, baseMatrix: mat4.clone(foamInst.modelMatrix) };
                        renderer.instances.push(foamInst);
                    }
                    continue;
                }

                const anim = Water.animForTypeId(rawTypeId, Room.WATER_ID_MOD);
                const materialKey = Water.texGenSrc(anim) === GX.TexGenSrc.POS ? "water" : "water-uv";

                if (Water.isTintPassGroup(rawTypeId, Room.WATER_ID_MOD)) {
                    const tintData = renderer.modelCache.getOrCreate(`water-tint:${blockIndex}`, (): BuiltModel | null => {
                        const mesh = meshCache.get(blockIndex);
                        if (mesh === undefined)
                            return null;
                        return {
                            mesh,
                            imageIndexByTriangle: mesh.triangleOffsets.map(() => Water.BASE_IMAGE_INDEX),
                            atlasKey: WATER_ATLAS,
                            materialKey: mesh.colors !== undefined ? "water-tint-vtx" : "water-tint",
                        };
                    });
                    if (tintData !== null) {
                        const tintInst = new ModelInstance(tintData);
                        Oqt.oqtRecordMatrix(tintInst.modelMatrix, inst);
                        tintInst.colorOverrideC0 = waterTintPassC0;
                        renderer.instances.push(tintInst);
                        if (rawTypeId === POND_WATER_TYPE_ID)
                            pondFullInstances.push(tintInst);
                    }
                }
                const modelData = renderer.modelCache.getOrCreate(`water:${blockIndex}:${materialKey}`, (): BuiltModel | null => {
                    const mesh = meshCache.get(blockIndex);
                    if (mesh === undefined)
                        return null;
                    return {
                        mesh,
                        imageIndexByTriangle: mesh.triangleOffsets.map(() => Water.BASE_IMAGE_INDEX),
                        atlasKey: WATER_ATLAS,
                        materialKey,
                    };
                });
                if (modelData === null)
                    continue;

                const modelInst = new ModelInstance(modelData);
                modelInst.waterAnim = anim;
                Oqt.oqtRecordMatrix(modelInst.modelMatrix, inst);
                renderer.instances.push(modelInst);
                if (rawTypeId === POND_WATER_TYPE_ID)
                    pondFullInstances.push(modelInst);
            }
        }

        //#endregion

        //#region Ground Cover Tiles

        const groundTileDatas = await Promise.all(GROUND_COVER_TILES.map((name) => fetchOptional(`${name}.gpl`)));
        for (let ti = 0; ti < GROUND_COVER_TILES.length; ti++) {
            const name = GROUND_COVER_TILES[ti];
            const tileData = groundTileDatas[ti];
            if (tileData === null)
                continue;

            const tileMeshes = Gpl.loadAllMeshes(tileData);
            const mesh = tileMeshes.get(0);
            if (mesh === undefined)
                continue;
            const tileMat = Material.staticMaterialForGroundTile(tileData);
            if (tileMat === null)
                continue;

            const modelData = renderer.modelCache.getOrCreate(`tile:${name}`, (): BuiltModel | null => {
                const imageIndexByTriangle = Material.imageIndexByTriangleForTile(mesh, tileMat);
                return {
                    mesh, imageIndexByTriangle, atlasKey: GROUND_ATLAS,
                    materialKey: mesh.colors !== undefined ? "ground-tint" : "ground",
                };
            });
            if (modelData === null)
                continue;

            const tileInst = new ModelInstance(modelData);
            renderer.instances.push(tileInst);
            if (name === POND_EMPTY_GROUND_TILE) {
                pondEmptyInstances.push(tileInst);
            } else if (name === POND_FULL_GROUND_TILE) {
                pondFullInstances.push(tileInst);
            } else if (name === BIG_FIELD_LOCKED_GROUND_TILE) {
                bigFieldLockedInstances.push(tileInst);
            } else if (name === BIG_FIELD_UNLOCKED_GROUND_TILE) {
                bigFieldUnlockedInstances.push(tileInst);
            }
        }

        //#endregion

        //#region Farm grids

        const farmSoilInstancesByGrid: ModelInstance[][] = FARM_GRIDS.map(() => []);
        const npcFieldSoilInstances: ModelInstance[] = [];

        let applyFarmSoil: (state: number, tintIndex: number) => void = () => {};
        const farmGplData = await fetchOptional(`farm.gpl`);
        const farmTplData = await fetchOptional(`farm.tpl`);
        if (farmGplData !== null && farmTplData !== null) {
            renderer.registerAtlas(FARM_ATLAS, Tpl.parse(farmTplData));

            const farmMeshes = Gpl.loadAllMeshes(farmGplData);

            const soilModel = (block: number, image: number): ModelData | null =>
                renderer.modelCache.getOrCreate(`farm:soil${block}:img${image}`, (): BuiltModel | null => {
                    const mesh = farmMeshes.get(block);
                    if (mesh === undefined)
                        return null;
                    return {
                        mesh,
                        imageIndexByTriangle: mesh.triangleOffsets.map(() => image),
                        atlasKey: FARM_ATLAS,
                    };
                });

            const untilledBlock = FarmSoil.soilBlockForState(FarmSoil.SoilState.Untilled);
            for (let gridIndex = 0; gridIndex < FARM_GRIDS.length; gridIndex++) {
                const grid = FARM_GRIDS[gridIndex];
                const untilled = soilModel(untilledBlock,
                    FarmSoil.imageForGridState(gridIndex, FarmSoil.SoilState.Untilled));
                if (untilled !== null) {
                    const [ox, oy, oz] = grid.origin;
                    for (let row = 0; row < grid.rows; row++) {
                        for (let col = 0; col < grid.cols; col++) {
                            const inst = new ModelInstance(untilled);
                            // Anti-seam edge bleed
                            const mask = FarmSoil.edgeMask(row, col, grid.rows, grid.cols);
                            mat4.fromScaling(inst.modelMatrix, FarmSoil.tileScale(mask));
                            const min = FarmSoil.tileMinCorner(ox + row, oy, oz + col, mask);
                            inst.modelMatrix[12] = min[0];
                            inst.modelMatrix[13] = min[1];
                            inst.modelMatrix[14] = min[2];
                            renderer.instances.push(inst);
                            farmSoilInstancesByGrid[gridIndex].push(inst);
                            if (grid.name === "C")
                                bigFieldUnlockedInstances.push(inst);
                        }
                    }
                }
            }

            applyFarmSoil = (state: number, tintIndex: number): void => {
                const block = FarmSoil.soilBlockForState(state);
                const rgba = FarmSoil.TINT_RGBA[tintIndex];
                const tint = tintIndex === 0 ? null
                    : colorNewFromRGBA(rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] / 255);
                for (let gridIndex = 0; gridIndex < farmSoilInstancesByGrid.length; gridIndex++) {
                    const data = soilModel(block, FarmSoil.imageForGridState(gridIndex, state));
                    for (const inst of farmSoilInstancesByGrid[gridIndex]) {
                        if (data !== null)
                            inst.data = data;
                        inst.matColorOverride = tint;
                    }
                }
            };

            const npcSoil = soilModel(FarmSoil.NPC_FIELD_BLOCK, FarmSoil.NPC_FIELD_IMAGE);
            if (npcSoil !== null) {
                const npcCellPos = vec3.create();
                const npcScale = FarmSoil.tileScale(0);
                for (const field of Crop.NPC_FIELDS) {
                    for (let i = 0; i < Crop.cellCount(field); i++) {
                        Crop.cellPosition(npcCellPos, field, i);
                        const inst = new ModelInstance(npcSoil);
                        mat4.fromScaling(inst.modelMatrix, npcScale);
                        const min = FarmSoil.tileMinCorner(npcCellPos[0] - 0.5, npcCellPos[1], npcCellPos[2] - 0.5, 0);
                        inst.modelMatrix[12] = min[0];
                        inst.modelMatrix[13] = min[1];
                        inst.modelMatrix[14] = min[2];
                        renderer.instances.push(inst);
                        npcFieldSoilInstances.push(inst);
                    }
                }
            }
        }

        //#endregion

        //#region mapdome (sky)

        const mapdomeGplData = await fetchOptional(`mapdome.gpl`);
        const mapdomeTplData = await fetchOptional(`mapdome-blend.tpl`);
        if (mapdomeGplData !== null && mapdomeTplData !== null) {
            renderer.registerAtlas(SKY_ATLAS, Tpl.parse(mapdomeTplData));

            const domeMeshes = Gpl.loadAllMeshes(mapdomeGplData);
            const domeMesh = domeMeshes.get(0);
            if (domeMesh !== undefined) {
                const modelData = renderer.modelCache.getOrCreate(`sky:mapdome`, (): BuiltModel => ({
                    mesh: domeMesh,
                    imageIndexByTriangle: domeMesh.triangleOffsets.map(() => Env.SKY_FRAME_DAY),
                    atlasKey: SKY_ATLAS,
                    materialKey: "sky",
                }));
                if (modelData !== null) {
                    const skyInst = new ModelInstance(modelData);
                    skyInst.followCameraGround = true;
                    renderer.instances.push(skyInst);
                    renderer.skyInstance = skyInst;
                }
            }
        }

        //#endregion

        //#region Sun and lens-flare

        const sunTplData = await fetchOptional(`sun.tpl`);
        if (sunTplData !== null) {
            const sunTpl = Tpl.parse(sunTplData);
            renderer.registerAtlas(SUN_ATLAS, sunTpl);

            const sunModelData = renderer.modelCache.getOrCreate(`sun:${Sun.SUN_IMAGE_INDEX}`, (): BuiltModel => ({
                mesh: unitQuadMesh(),
                imageIndexByTriangle: [Sun.SUN_IMAGE_INDEX, Sun.SUN_IMAGE_INDEX],
                atlasKey: SUN_ATLAS,
                materialKey: "sun",
                screenAlignedBillboard: true,
            }));
            if (sunModelData !== null) {
                const sunInst = new ModelInstance(sunModelData);
                sunInst.sunFollow = true;
                renderer.instances.push(sunInst);
            }

            for (const [imageIndex, t] of Sun.FLARE_TABLE) {
                const tex = sunTpl.textures[imageIndex];
                if (tex === undefined)
                    continue;
                const flareModelData = renderer.modelCache.getOrCreate(`sun:${imageIndex}`, (): BuiltModel => ({
                    mesh: unitQuadMesh(2),
                    imageIndexByTriangle: [imageIndex, imageIndex],
                    atlasKey: SUN_ATLAS,
                    materialKey: "sun-flare",
                    screenSpace: true,
                }));
                if (flareModelData !== null) {
                    renderer.sunFlares.push({
                        instance: new ModelInstance(flareModelData),
                        t,
                        halfWidthPixels: tex.width,
                        halfHeightPixels: tex.height,
                    });
                }
            }
        }

        //#endregion

        //#region Rray burst and screen flash

        const sunRayModelData = renderer.modelCache.getOrCreate(`sun:ray`, (): BuiltModel => ({
            mesh: sunRayMesh(),
            imageIndexByTriangle: [0, 0],
            atlasKey: MAPOBJ_ATLAS,
            materialKey: "sun-rays",
            screenSpace: true,
        }));
        if (sunRayModelData !== null) {
            for (const spoke of Sun.makeRaySpokes(new Rng(0x6ec5)))
                renderer.sunRays.push({ instance: new ModelInstance(sunRayModelData), spoke });
        }

        const sunFlashModelData = renderer.modelCache.getOrCreate(`sun:flash`, (): BuiltModel => ({
            mesh: unitQuadMesh(),
            imageIndexByTriangle: [0, 0],
            atlasKey: MAPOBJ_ATLAS,
            materialKey: "sun-flash",
            screenSpace: true,
        }));
        if (sunFlashModelData !== null)
            renderer.sunFlash = new ModelInstance(sunFlashModelData);

        //#endregion

        //#region Moon

        const moonTplData = await fetchOptional(`moon.tpl`);
        if (moonTplData !== null) {
            renderer.registerAtlas(MOON_ATLAS, Tpl.parse(moonTplData));

            const moonModelData = renderer.modelCache.getOrCreate(`moon:disc`, (): BuiltModel => ({
                mesh: unitQuadMesh(),
                imageIndexByTriangle: [0, 0],
                atlasKey: MOON_ATLAS,
                materialKey: "moon",
                screenAlignedBillboard: true,
            }));
            if (moonModelData !== null) {
                const moonInst = new ModelInstance(moonModelData);
                moonInst.moonFollow = true;
                renderer.instances.push(moonInst);
                renderer.moonInstance = moonInst;
            }

            const moonGlareModelData = renderer.modelCache.getOrCreate(`moon:glare`, (): BuiltModel => ({
                mesh: unitQuadMesh(),
                imageIndexByTriangle: [Moon.GLARE_IMAGE_INDEX, Moon.GLARE_IMAGE_INDEX],
                atlasKey: MOON_ATLAS,
                materialKey: "moon-glare",
                screenSpace: true,
            }));
            if (moonGlareModelData !== null) {
                renderer.moonGlare = {
                    instance: new ModelInstance(moonGlareModelData),
                    halfWidthPixels: Moon.GLARE_HALF_SIZE_PIXELS,
                    halfHeightPixels: Moon.GLARE_HALF_SIZE_PIXELS,
                };
            }
        }

        //#endregion

        //#region Outdoor lamps

        let lampPoolTex: Tpl.TplTexture | undefined = undefined;
        let lampPositions: [number, number, number][] = [];
        const maplampTplData = await fetchOptional(`maplamp.tpl`);
        const mapwindowTplData = await fetchOptional(`mapwindow.tpl`);
        const maplampOqtData = await fetchOptional(`maplamp.oqt`);
        if (maplampTplData !== null && mapwindowTplData !== null && maplampOqtData !== null) {
            const maplampTpl = Tpl.parse(maplampTplData);
            const mapwindowTpl = Tpl.parse(mapwindowTplData);
            renderer.registerAtlas(LAMP_GLOW_ATLAS, maplampTpl);
            const [litColorTpl, litAlphaTpl] = Lamp.litAtlasTpls(maplampTpl, mapwindowTpl);
            renderer.registerAtlas(LAMP_LIT_ATLAS, litColorTpl, "default", litAlphaTpl);

            const lampInstances = Oqt.allInstances(maplampOqtData);

            const lampWorldMatrix = mat4.create();
            const glowPos = vec3.create();
            for (const inst of lampInstances) {
                const glows = Lamp.GLOWS_BY_TYPE[Oqt.oqtTypeId(inst)];
                if (glows === undefined)
                    continue;
                Oqt.oqtRecordMatrix(lampWorldMatrix, inst);
                for (const glow of glows) {
                    const modelData = renderer.modelCache.getOrCreate(`lamp:glow:${glow.imageIndex}`, (): BuiltModel => ({
                        mesh: unitQuadMesh(),
                        imageIndexByTriangle: [glow.imageIndex, glow.imageIndex],
                        atlasKey: LAMP_GLOW_ATLAS,
                        materialKey: "lamp-glow",
                        screenAlignedBillboard: true,
                    }));
                    if (modelData === null)
                        continue;
                    vec3.transformMat4(glowPos, glow.offset as vec3, lampWorldMatrix);
                    const glowInst = new ModelInstance(modelData);
                    mat4.fromTranslation(glowInst.modelMatrix, glowPos);
                    mat4.scale(glowInst.modelMatrix, glowInst.modelMatrix, [Lamp.GLOW_HALF_SIZE, Lamp.GLOW_HALF_SIZE, 1]);
                    glowInst.visible = false;
                    renderer.instances.push(glowInst);
                    renderer.lampGlowInstances.push(glowInst);
                }
            }

            lampPoolTex = maplampTpl.textures[Lamp.POOL_IMAGE_INDEX];
            lampPositions = lampInstances.map((inst) => inst.pos);
        }

        const lightMap = Lamp.buildLightMap(lampPoolTex, lampPositions);
        renderer.registerAtlas(LAMP_LIGHT_MAP_ATLAS, lightMap.tpl);
        renderer.lampLightMapMtx = lightMap.worldToUv;

        //#endregion

        //#region Star Field

        const starTplData = await fetchOptional(`star.tpl`);
        const starBatchesBySeason: StarBatchEntry[][] = SEASONS.map(() => []);
        if (starTplData !== null) {
            const starTpl = Tpl.parse(starTplData);
            renderer.registerAtlas(STAR_ATLAS, starTpl);

            const starOqtDatas = new Map(await Promise.all([...Stars.LAYER_A_FILES, ...Stars.LAYER_B_FILES].map(
                async (fileName) => [fileName, await fetchOptional(`${fileName}.oqt`)] as const)));
            for (let seasonIndex = 0; seasonIndex < SEASONS.length; seasonIndex++) {
                const layers: [string, (inst: Oqt.OqtInstance) => number][] = [
                    [Stars.LAYER_A_FILES[seasonIndex], () => 0],
                    [Stars.LAYER_B_FILES[seasonIndex], Stars.layerBImageIndex],
                ];
                for (const [fileName, imageIndexOf] of layers) {
                    const starOqtData = starOqtDatas.get(fileName) ?? null;
                    if (starOqtData === null)
                        continue;
                    for (const batch of Stars.batchStars(Oqt.allInstances(starOqtData), imageIndexOf)) {
                        const tex = starTpl.textures[batch.imageIndex];
                        if (tex === undefined)
                            continue;
                        const pointSizePx = Stars.pointSizePixels(tex);
                        const modelData = renderer.modelCache.getOrCreate(`star:${fileName}:${batch.imageIndex}:${batch.twinkleSlot}`, (): BuiltModel => ({
                            mesh: starBatchMesh(batch, pointSizePx),
                            imageIndexByTriangle: new Array(batch.instances.length * 2).fill(batch.imageIndex),
                            atlasKey: STAR_ATLAS,
                            materialKey: "star",
                        }));
                        if (modelData === null)
                            continue;
                        const starInst = new ModelInstance(modelData);
                        starInst.followCameraGround = true;
                        starInst.visible = false;
                        renderer.instances.push(starInst);
                        starBatchesBySeason[seasonIndex].push({ instance: starInst, twinkleSlot: batch.twinkleSlot });
                    }
                }
            }
            renderer.starBatches = starBatchesBySeason[0];
        }

        //#endregion

        //#region Clouds

        const cloudTplData = await fetchOptional(`cloud.tpl`);
        if (cloudTplData !== null) {
            const cloudTpl = Tpl.parse(cloudTplData);
            renderer.registerAtlas(CLOUD_ATLAS, cloudTpl);

            const imageAspect = cloudTpl.textures.map((tex) => (tex.width > 0 ? tex.height / tex.width : 1));

            const cloudModelData = renderer.modelCache.getOrCreate(`cloud:card`, (): BuiltModel => ({
                mesh: cloudQuadMesh(),
                imageIndexByTriangle: [0, 0],
                atlasKey: CLOUD_ATLAS,
                materialKey: "cloud",
            }));
            if (cloudModelData !== null) {
                const instances: ModelInstance[] = [];
                const colorC0: Color[] = [];
                const colorC1: Color[] = [];
                for (let i = 0; i < Cloud.POOL_SIZE; i++) {
                    const inst = new ModelInstance(cloudModelData);
                    inst.visible = false;
                    renderer.instances.push(inst);
                    instances.push(inst);
                    colorC0.push(colorNewFromRGBA(1, 1, 1, 1));
                    colorC1.push(colorNewFromRGBA(1, 1, 1, 1));
                }
                renderer.cloudDeck = { instances, imageAspect, colorC0, colorC1 };
            }
        }

        //#endregion

        //#region Rain

        const rainModelData = renderer.modelCache.getOrCreate(`rain:streak`, (): BuiltModel => ({
            mesh: rainStreakMesh(),
            imageIndexByTriangle: [0, 0],
            atlasKey: MAPOBJ_ATLAS,
            materialKey: "rain",
            billboard: true,
        }));
        if (rainModelData !== null) {
            for (let i = 0; i < Rain.POOL_SIZE; i++) {
                const inst = new ModelInstance(rainModelData);
                inst.visible = false;
                renderer.instances.push(inst);
                renderer.rainStreaks.push(inst);
            }
        }

        //#endregion

        //#region Snow

        const snowTplData = await fetchOptional(`snow.tpl`);
        if (snowTplData !== null) {
            renderer.registerAtlas(SNOW_ATLAS, Tpl.parse(snowTplData));

            const snowModelData = renderer.modelCache.getOrCreate(`snow:flake`, (): BuiltModel => ({
                mesh: unitQuadMesh(),
                imageIndexByTriangle: [0, 0],
                atlasKey: SNOW_ATLAS,
                materialKey: "snow",
                screenAlignedBillboard: true,
            }));
            if (snowModelData !== null) {
                for (let i = 0; i < Snow.POOL_SIZE; i++) {
                    const inst = new ModelInstance(snowModelData);
                    inst.visible = false;
                    renderer.instances.push(inst);
                    renderer.snowFlakes.push(inst);
                }
            }
        }

        //#endregion

        //#region Falling Leaf

        const mapleafTplData = await fetchOptional(`mapleaf.tpl`);
        if (mapleafTplData !== null) {
            renderer.registerAtlas(MAPLEAF_ATLAS, Tpl.parse(mapleafTplData));

            const leafOqtData = await Promise.all(SEASONS.map((_, i) => fetchOptional(Leaf.seasonFileName(i))));
            for (let seasonIndex = 0; seasonIndex < SEASONS.length; seasonIndex++) {
                const data = leafOqtData[seasonIndex];
                if (data === null)
                    continue;
                renderer.leafAnchorsBySeason[seasonIndex] = Leaf.parseAnchors(Oqt.parse(data));
            }

            const leafModelData = renderer.modelCache.getOrCreate(`mapleaf:card`, (): BuiltModel => ({
                mesh: leafQuadMesh(),
                imageIndexByTriangle: [0, 0, 0, 0],
                atlasKey: MAPLEAF_ATLAS,
                materialKey: "leaf",
            }));
            if (leafModelData !== null) {
                for (let i = 0; i < Leaf.POOL_SIZE; i++) {
                    const inst = new ModelInstance(leafModelData);
                    inst.visible = false;
                    renderer.instances.push(inst);
                    renderer.leafInstances.push(inst);
                }
                const springAnchors = renderer.leafAnchorsBySeason[0];
                if (springAnchors !== null)
                    renderer.leafField.setAnchors(springAnchors);
            }
        }

        //#endregion

        //#region Forageables

        const wildPlantInstancesBySeason: ModelInstance[][] = SEASONS.map(() => []);
        const [wildPlantGplData, wildPlantTplData, wildPlantArcData] = await Promise.all([
            fetchOptional(`wildplant.gpl`), fetchOptional(`wildplant.tpl`), fetchOptional(`wildplant-oqt.arc`),
        ]);
        if (wildPlantGplData !== null && wildPlantTplData !== null && wildPlantArcData !== null) {
            renderer.registerAtlas(WILDPLANT_ATLAS, Tpl.parse(wildPlantTplData));

            const wildPlantMeshes = Gpl.loadAllMeshes(wildPlantGplData);
            const wildPlantBlocks = new Map<number, Gpl.GplBlock>();
            for (const b of Gpl.walkBlockTable(wildPlantGplData).blocks)
                wildPlantBlocks.set(b.index, b);
            const wildPlantMat = Material.staticMaterialForMapobj(wildPlantGplData);

            const placementsBySeason = WildPlant.parsePlacements(wildPlantArcData);
            for (let seasonIndex = 0; seasonIndex < SEASONS.length; seasonIndex++) {
                for (const { block, inst } of placementsBySeason[seasonIndex] ?? []) {
                    const cacheKey = `wildplant:${block}:${WildPlant.nameForBlock(block)}`;
                    const modelData = renderer.modelCache.getOrCreate(cacheKey, (): BuiltModel | null => {
                        const mesh = wildPlantMeshes.get(block);
                        const gplBlock = wildPlantBlocks.get(block);
                        if (mesh === undefined || gplBlock === undefined)
                            return null;
                        return {
                            mesh,
                            imageIndexByTriangle: Material.imageIndexByTriangle(mesh, gplBlock, wildPlantMat),
                            atlasKey: WILDPLANT_ATLAS,
                        };
                    });
                    if (modelData === null)
                        continue;
                    const plantInst = new ModelInstance(modelData);
                    Oqt.oqtRecordMatrix(plantInst.modelMatrix, inst);
                    plantInst.visible = seasonIndex === 0;
                    renderer.instances.push(plantInst);
                    wildPlantInstancesBySeason[seasonIndex].push(plantInst);
                }
            }
        }

        //#endregion

        //#region Pasture Grass

        const [grassGplData, grassTplData] = await Promise.all([
            fetchOptional(`grass.gpl`), fetchOptional(`grass.tpl`),
        ]);
        if (grassGplData !== null && grassTplData !== null) {
            renderer.registerAtlas(GRASS_ATLAS, Tpl.parse(grassTplData));

            const grassMeshes = Gpl.loadAllMeshes(grassGplData);
            const grassBlocks = new Map<number, Gpl.GplBlock>();
            for (const b of Gpl.walkBlockTable(grassGplData).blocks)
                grassBlocks.set(b.index, b);
            const grassMat = Material.staticMaterialForMapobj(grassGplData);
            const grassTilePos = vec3.create();

            for (let stage = 0; stage < Grass.STAGE_COUNT; stage++) {
                const modelData = renderer.modelCache.getOrCreate(`grass:stage${stage}`, (): BuiltModel | null => {
                    const mesh = grassMeshes.get(stage);
                    const gplBlock = grassBlocks.get(stage);
                    if (mesh === undefined || gplBlock === undefined)
                        return null;
                    return {
                        mesh,
                        imageIndexByTriangle: Material.imageIndexByTriangle(mesh, gplBlock, grassMat),
                        atlasKey: GRASS_ATLAS,
                    };
                });
                const group: ModelInstance[] = [];
                if (modelData !== null) {
                    for (let i = 0; i < Grass.TILE_COUNT; i++) {
                        const tileInst = new ModelInstance(modelData);
                        Grass.tilePosition(grassTilePos, i);
                        mat4.fromTranslation(tileInst.modelMatrix, grassTilePos);
                        tileInst.imageIndexOverride = Grass.imageIndex(stage, Grass.VARIANT_GREEN);
                        tileInst.grassSway = true;
                        tileInst.visible = false;
                        renderer.instances.push(tileInst);
                        group.push(tileInst);
                    }
                }
                renderer.grassInstancesByStage.push(group);
            }
        }

        //#endregion

        //#region NPC Crop Fields

        const cropModels = new Map<string, Crop.CropModel>();
        const cropHarvestModels = new Set<string>();
        const usedCrops = Crop.usedModels();
        const cropDatas = await Promise.all(usedCrops.map((baseCrop) => {
            const files = Crop.cropFileNames(baseCrop.model);
            return Promise.all([
                fetchOptional(files.gpl), fetchOptional(files.act),
                fetchOptional(files.skn), fetchOptional(files.anm), fetchOptional(files.tpl),
                fetchOptional(files.hGpl), fetchOptional(files.hTpl),
            ]);
        }));
        for (let ci = 0; ci < usedCrops.length; ci++) {
            const model = usedCrops[ci].model;
            const [gplData, actData, sknData, anmData, tplData, hGplData, hTplData] = cropDatas[ci];
            if (gplData === null || actData === null || sknData === null || anmData === null || tplData === null)
                continue;
            const block = Gpl.walkBlockTable(gplData).blocks.find((b) => b.index === Crop.CROP_BODY_BLOCK);
            if (block === undefined)
                continue;
            const meshes = Gpl.loadAllMeshes(gplData);
            const body = meshes.get(Crop.CROP_BODY_BLOCK);
            if (body === undefined)
                continue;
            renderer.registerAtlas(`crop:${model}`, Tpl.parse(tplData));
            const cropModel = new Crop.CropModel(model, body, actData, sknData, anmData);
            cropModels.set(model, cropModel);
            const imageIndex = Material.imageIndexByTriangle(body, block, Material.staticMaterialForMapobj(gplData));
            for (let pose = 0; pose < cropModel.stageCount; pose++) {
                renderer.modelCache.getOrCreate(`crop:${model}:pose${pose}`, (): BuiltModel | null => ({
                    mesh: cropModel.stageMesh(pose),
                    imageIndexByTriangle: imageIndex,
                    atlasKey: `crop:${model}`,
                }));
            }
            // Fruit/Vegetable Model
            if (hGplData !== null && hTplData !== null) {
                const hMeshes = Gpl.loadAllMeshes(hGplData);
                const hBody = hMeshes.get(Crop.CROP_H_BLOCK);
                if (hBody !== undefined) {
                    renderer.registerAtlas(`croph:${model}`, Tpl.parse(hTplData));
                    const hImages = hBody.triangles.map(() => Crop.CROP_H_IMAGE);
                    renderer.modelCache.getOrCreate(`croph:${model}`, (): BuiltModel | null => ({
                        mesh: hBody, imageIndexByTriangle: hImages, atlasKey: `croph:${model}`,
                    }));
                    cropHarvestModels.add(model);
                }
            }
        }

        const cropItemModels = new Set<number>();
        const [symbolGplData, symbolTplData] = await Promise.all([
            fetchOptional(Crop.SYMBOL_GPL), fetchOptional(Crop.SYMBOL_TPL),
        ]);
        if (symbolGplData !== null && symbolTplData !== null) {
            const symbolMeshes = Gpl.loadAllMeshes(symbolGplData);
            renderer.registerAtlas(`symbol`, Tpl.parse(symbolTplData));
            for (const [item, itemModel] of Crop.CROP_ITEM_MODELS) {
                const mesh = symbolMeshes.get(itemModel.block);
                if (mesh === undefined)
                    continue;
                const images = mesh.triangles.map(() => itemModel.image0);
                renderer.modelCache.getOrCreate(`item:${itemModel.block}`, (): BuiltModel | null => ({
                    mesh, imageIndexByTriangle: images, atlasKey: `symbol`,
                }));
                cropItemModels.add(item);
            }
        }

        const cropFieldInstances: ModelInstance[][] = [];
        const cropHarvestInstances: ModelInstance[][] = [];
        const cropCellMatrices: mat4[][] = [];
        if (cropModels.size > 0) {
            const cropCellPos = vec3.create();
            const seed = renderer.modelCache.getOrCreate(`crop:${[...cropModels.keys()][0]}:pose0`, () => null);
            for (const field of Crop.NPC_FIELDS) {
                const group: ModelInstance[] = [];
                const harvestGroup: ModelInstance[] = [];
                const matrices: mat4[] = [];
                if (seed !== null) {
                    for (let i = 0; i < Crop.cellCount(field); i++) {
                        Crop.cellPosition(cropCellPos, field, i);
                        const cell = mat4.fromTranslation(mat4.create(), cropCellPos);
                        mat4.rotateY(cell, cell, Crop.CROP_YAW_RADIANS);
                        matrices.push(cell);
                        for (const list of [group, harvestGroup]) {
                            const inst = new ModelInstance(seed);
                            mat4.copy(inst.modelMatrix, cell);
                            inst.visible = false;
                            renderer.instances.push(inst);
                            list.push(inst);
                        }
                    }
                }
                cropFieldInstances.push(group);
                cropHarvestInstances.push(harvestGroup);
                cropCellMatrices.push(matrices);
            }
        }
        const cropAnchorMatrices = new Map<string, mat4>();
        const cropAnchorMatrix = (model: string, pose: number): mat4 | null => {
            const key = `${model}:${pose}`;
            let m = cropAnchorMatrices.get(key);
            if (m === undefined) {
                const cropModel = cropModels.get(model);
                if (cropModel === undefined)
                    return null;
                m = cropModel.anchorMatrix(pose);
                cropAnchorMatrices.set(key, m);
            }
            return m;
        };
        const scratchCropMatrix = mat4.create();
        const scratchCropDrop = vec3.create();
        const updateCropFields = (season: number, day: number): void => {
            for (let f = 0; f < cropFieldInstances.length; f++) {
                const field = Crop.NPC_FIELDS[f];
                const crop = Crop.cropForFieldSeason(field.index, season);
                const stage = Crop.stageForDay(crop.kind, day);
                const sub = Crop.subForDay(crop.kind, day);
                const pose = Crop.poseForStage(crop.kind, stage);
                const data = stage === 0 || !cropModels.has(crop.model) ? null
                    : renderer.modelCache.getOrCreate(`crop:${crop.model}:pose${pose}`, () => null);
                const plantImage = Crop.plantImageIndex(stage, Crop.CROP_QUALITY);

                const attach = Crop.harvestAttachment(crop.kind, stage, sub);
                const itemModel = Crop.CROP_ITEM_MODELS.get(crop.item);
                let harvestData: ModelData | null = null;
                let tint: Color | null = null;
                let drop = 0.0;
                if (attach === `h` && cropHarvestModels.has(crop.model)) {
                    harvestData = renderer.modelCache.getOrCreate(`croph:${crop.model}`, () => null);
                } else if (attach === `item` && itemModel !== undefined && cropItemModels.has(crop.item)) {
                    harvestData = renderer.modelCache.getOrCreate(`item:${itemModel.block}`, () => null);
                    drop = itemModel.height;
                    const rgba = Crop.ITEM_TINT[sub];
                    if (rgba !== undefined && rgba !== null)
                        tint = colorNewFromRGBA(rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] / 255);
                }
                const anchor = harvestData !== null ? cropAnchorMatrix(crop.model, pose) : null;
                if (anchor === null)
                    harvestData = null;

                const cells = cropCellMatrices[f];
                for (let i = 0; i < cropFieldInstances[f].length; i++) {
                    const inst = cropFieldInstances[f][i];
                    if (data !== null)
                        inst.data = data;
                    inst.imageIndexOverride = plantImage;
                    inst.visible = renderer.cropFieldsVisible && data !== null;

                    const harvest = cropHarvestInstances[f][i];
                    if (harvestData !== null && data !== null && anchor !== null) {
                        harvest.data = harvestData;
                        mat4.multiply(harvest.modelMatrix, cells[i], anchor);
                        if (drop !== 0.0) {
                            vec3.set(scratchCropDrop, 0, -drop, 0);
                            mat4.fromTranslation(scratchCropMatrix, scratchCropDrop);
                            mat4.multiply(harvest.modelMatrix, harvest.modelMatrix, scratchCropMatrix);
                        }
                        harvest.matColorOverride = tint;
                    }
                    harvest.visible = renderer.cropFieldsVisible && data !== null && harvestData !== null;
                }
            }
        };

        //#endregion

        //#region VFX

        const ptclOqtData = await fetchOptional(`${this.mapName}-p-ptcl.oqt`);
        const ptlData = await fetchOptional(`map.ptl`);
        const txgData = await fetchOptional(`map.txg`);
        if (ptclOqtData !== null && ptlData !== null && txgData !== null) {
            const txg = Txg.parse(txgData, "map");
            renderer.registerAtlas(PTCL_ATLAS, txg);

            const ptlRecords = Ptcl.parse(ptlData);

            for (const inst of Oqt.allInstances(ptclOqtData)) {
                const typeIndex = Ptcl.ptclTypeIndex(Oqt.oqtTypeId(inst));
                const record = ptlRecords[typeIndex];
                if (record === undefined)
                    continue;

                const groupBase = txg.groupBase[record.texGroup];
                if (groupBase === undefined)
                    continue;

                const textureIndex = groupBase + Math.min(record.texturePose, txg.groupFrameCount[record.texGroup] - 1);

                if (typeIndex === PTCL_UNPLACED_RECORD || !record.cmdListValid)
                    continue;

                const materialKey = Ptcl.materialKeyForRecord(record);
                const modelData = renderer.modelCache.getOrCreate(`ptcl:${typeIndex}`, (): BuiltModel => ({
                    mesh: unitQuadMesh(),
                    imageIndexByTriangle: [textureIndex, textureIndex],
                    atlasKey: PTCL_ATLAS,
                    materialKey,
                    screenAlignedBillboard: true,
                }));
                if (modelData === null)
                    continue;

                const emitter = new Ptcl.ParticleEmitter({
                    record,
                    windDriven: typeIndex === Ptcl.WIND_DRIVEN_TYPE_INDEX,
                });
                Oqt.oqtRecordMatrix(emitter.worldMatrix, inst);

                const group = new ParticleGroup(emitter, modelData);
                renderer.particleGroups.push(group);
                for (const particleInst of group.instances)
                    renderer.instances.push(particleInst);
            }
        }

        //#endregion

        //#region Scenarios widget

        // hehe
        const sheetLoadPromises = new Map<number, Promise<void>>([[defaultSheet, Promise.resolve()]]);
        const ensureSheetLoaded = (sheet: number): Promise<void> => {
            let p = sheetLoadPromises.get(sheet);
            if (p === undefined) {
                p = Promise.all([
                    dataFetcher.fetchData(`${pathBase}/${Season.mapobjSheetFileName(sheet)}`),
                    dataFetcher.fetchData(`${pathBase}/${Season.groundSheetFileName(sheet)}`),
                ]).then(([sheetMapobjTpl, sheetGroundTpl]) => {
                    if (renderer.destroyed)
                        return;
                    renderer.registerAtlas(MAPOBJ_ATLAS, Tpl.parse(sheetMapobjTpl), Season.sheetVariantName(sheet));
                    renderer.registerAtlas(GROUND_ATLAS, Tpl.parse(sheetGroundTpl), Season.sheetVariantName(sheet));
                });
                p.catch(() => sheetLoadPromises.delete(sheet));
                sheetLoadPromises.set(sheet, p);
            }
            return p;
        };

        let seasonIndex = 0;
        let dayOfSeason = Season.DEFAULT_DAY;
        renderer.dayOfSeason = dayOfSeason;
        renderer.setAutoWeather(true);
        let farmSoilState: number = FarmSoil.SoilState.Untilled;
        let farmSoilTint = 0;
        updateCropFields(seasonIndex, dayOfSeason);

        let sheetRequestSerial = 0;
        const applySheet = (): void => {
            const sheet = Season.sheetForDay(seasonIndex, dayOfSeason);
            const serial = ++sheetRequestSerial;
            ensureSheetLoaded(sheet).then(() => {
                if (serial === sheetRequestSerial)
                    renderer.setAtlasVariant(Season.sheetVariantName(sheet));
            }, (e) => console.error(`season sheet ${sheet} failed to load`, e));
        };

        // Kept here so you can hide crops using the dev console if desired
        renderer.setCropFieldsVisible = (v: boolean): void => {
            renderer.cropFieldsVisible = v;
            for (const inst of npcFieldSoilInstances)
                inst.visible = v;
            updateCropFields(seasonIndex, dayOfSeason);
        };
        renderer.setFarmSoil = (state: number, tintIndex: number): void => {
            farmSoilState = state;
            farmSoilTint = tintIndex;
            applyFarmSoil(farmSoilState, farmSoilTint);
        };

        // Only used for the calendar label, so not generalized
        const sectionHeader = (title: string): HTMLElement => {
            const elem = document.createElement('div');
            elem.style.fontWeight = 'bold';
            elem.style.userSelect = 'none';
            elem.style.padding = '12px 0 2px 0';
            elem.textContent = title;
            return elem;
        };

        let seasonSelect: UI.SingleSelect | null = null;
        let dayCalendar: DayCalendar | null = null;

        const applySeason = (index: number): void => {
            seasonIndex = index;
            renderer.season = index;
            for (const batches of starBatchesBySeason)
                for (const batch of batches)
                    batch.instance.visible = false;
            renderer.starBatches = starBatchesBySeason[index];
            for (let i = 0; i < wildPlantInstancesBySeason.length; i++)
                for (const plantInst of wildPlantInstancesBySeason[i])
                    plantInst.visible = i === index;
            const leafAnchors = renderer.leafAnchorsBySeason[index];
            if (leafAnchors !== null)
                renderer.leafField.setAnchors(leafAnchors);
            renderer.grassField.season = index;

            updateCropFields(index, dayOfSeason);
            applySheet();

            if (seasonSelect !== null)
                seasonSelect.setHighlighted(index);
        };

        const applyDay = (day: number): void => {
            dayOfSeason = day;
            renderer.grassField.day = dayOfSeason;
            renderer.dayOfSeason = dayOfSeason;
            updateCropFields(seasonIndex, dayOfSeason);
            applySheet();
            if (dayCalendar !== null)
                dayCalendar.setSelectedDay(dayOfSeason);
        };

        renderer.onDateChanged = (): void => {
            if (renderer.season !== seasonIndex)
                applySeason(renderer.season);
            if (renderer.dayOfSeason !== dayOfSeason)
                applyDay(renderer.dayOfSeason);
        };

        renderer.createPanels = (): UI.Panel[] => {
            const panel = new UI.Panel();
            panel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
            panel.setTitle(UI.LAYER_ICON, 'Scenario');

            const select = new UI.SingleSelect();
            select.setStrings(SEASONS.map((s) => s.label));
            seasonSelect = select;
            select.onselectionchange = applySeason;
            select.selectItem(seasonIndex);

            panel.contents.appendChild(select.elem);

            //#region Day of season

            panel.contents.appendChild(sectionHeader('Calendar Date'));
            const calendar = new DayCalendar(Season.DAYS_PER_SEASON);
            dayCalendar = calendar;
            calendar.setSelectedDay(dayOfSeason);
            calendar.onselectday = applyDay;
            panel.contents.appendChild(calendar.elem);

            const advanceDayCheckbox = new UI.Checkbox('Advance Day at Midnight', renderer.advanceDayAtMidnight);
            advanceDayCheckbox.onchanged = () => {
                renderer.advanceDayAtMidnight = advanceDayCheckbox.checked;
            };
            panel.contents.appendChild(advanceDayCheckbox.elem);

            //#endregion

            //#region Pasture grass growth

            const grassSlider = new UI.Slider();
            grassSlider.setRange(0, Grass.STAGE_COUNT - 1, 1);
            grassSlider.setLabel(`Pasture grass height:  ${renderer.grassField.stage + 1} / ${Grass.STAGE_COUNT}`);
            grassSlider.setValue(renderer.grassField.stage);
            grassSlider.onvalue = (v: number) => {
                renderer.grassField.stage = v | 0;
                // Reset grass cut easter egg
                renderer.grassField.clearCuts();
                renderer.grassField.invalidate();
                grassSlider.setLabel(`Pasture grass height:  ${(v | 0) + 1} / ${Grass.STAGE_COUNT}`);
            };
            panel.contents.appendChild(grassSlider.elem);

            const chapterLayers = instancesByChapterLayer.map((insts, i) => new ChapterLayer(`Chapter ${i + 2}`, insts, false));

            const pondLayer = new ExclusiveLayer("Pond", pondEmptyInstances, pondFullInstances, false, (v) => {
                renderer.grassField.pondCutout = v;
            });

            const milkingRoomLayer = new ExclusiveLayer("Milking Room", milkingRoomPlaceholderInstances, milkingRoomHouseInstances, false);

            const foodProcessingRoomLayer = new ChapterLayer("Food Processing Room", foodProcessingRoomInstances, false);

            const calfHutchLayer = new ChapterLayer("Calf Hutch", calfHutchInstances, false);

            // Still no answer on what this is - titled unknown for now
            const unknownBarnMachineLayer = new ChapterLayer("Unknown Barn Machine", unknownBarnMachineInstances, false);
            
            // Toggled on by default, hope that more users will discover layers tab
            const vansShopLayer = new ChapterLayer("Van's Shop", vansShopInstances, true);

            const playersShopLayer = new ChapterLayer("Player's Shop", playersShopInstances, false);

            const bigFieldLayer = new ExclusiveLayer("Big Field", bigFieldLockedInstances, bigFieldUnlockedInstances, false);
            
            // Empty shed hidden, replaced with chicken yard
            const chickenYardLayer = new ExclusiveLayer("Chicken Yard", emptyShedInstances, chickenYardPlaceholderInstances, false);
            const layersPanel = new UI.LayerPanel([...chapterLayers, pondLayer, milkingRoomLayer, foodProcessingRoomLayer, calfHutchLayer, unknownBarnMachineLayer, bigFieldLayer, chickenYardLayer, vansShopLayer, playersShopLayer]);

            // Enforce chapters being sequential, e.g if you enable chapter 3, chapter 2 will be enabled.
            let lastChapterVisibility = chapterLayers.map((layer) => layer.visible);
            const enforceSequentialChapters = (): void => {
                const changedIndex = chapterLayers.findIndex((layer, i) => layer.visible !== lastChapterVisibility[i]);
                if (changedIndex !== -1) {
                    if (chapterLayers[changedIndex].visible) {
                        for (let i = 0; i < changedIndex; i++)
                            chapterLayers[i].setVisible(true);
                    } else {
                        for (let i = changedIndex + 1; i < chapterLayers.length; i++)
                            chapterLayers[i].setVisible(false);
                    }
                    layersPanel.syncLayerVisibility();
                }
                lastChapterVisibility = chapterLayers.map((layer) => layer.visible);
            };

            const updatePlayerHouseStage = (): void => {
                let activeStage = PLAYER_HOUSE_GROWTH_STAGE_BY_CHAPTER[0];
                for (let i = 0; i < chapterLayers.length; i++)
                    if (chapterLayers[i].visible)
                        activeStage = Math.max(activeStage, PLAYER_HOUSE_GROWTH_STAGE_BY_CHAPTER[i + 1]);
                for (let stage = 0; stage < playerHouseGrowthInstancesByStage.length; stage++)
                    for (const inst of playerHouseGrowthInstancesByStage[stage])
                        inst.visible = stage === activeStage;
                for (let stage = 0; stage < playerHouseGrowthCastersByStage.length; stage++)
                    for (const caster of playerHouseGrowthCastersByStage[stage])
                        caster.visible = stage === activeStage;
            };

            const updateDigSiteStage = (): void => {
                let activeStage = DIG_SITE_STAGE_BY_CHAPTER[0];
                for (let i = 0; i < chapterLayers.length; i++)
                    if (chapterLayers[i].visible)
                        activeStage = Math.max(activeStage, DIG_SITE_STAGE_BY_CHAPTER[i + 1]);
                for (let stage = 0; stage < digSiteInstancesByStage.length; stage++)
                    for (const inst of digSiteInstancesByStage[stage])
                        inst.visible = stage === activeStage;
            };
            layersPanel.onlayertoggled = (): void => {
                enforceSequentialChapters();
                updatePlayerHouseStage();
                updateDigSiteStage();
            };
            updatePlayerHouseStage();
            updateDigSiteStage();

            //#endregion

            //#region Time of Day

            const timePanel = new UI.Panel();
            timePanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
            timePanel.setTitle(UI.TIME_OF_DAY_ICON, 'Time of Day');

            const timeWheel = new UI.CircularTimeSlider();
            timeWheel.setLabelFormatter((t: number) => `Time  ${Env.formatClock(t * Env.DAY_SEC)}`);
            timeWheel.setValue(renderer.timeSeconds / Env.DAY_SEC);
            timeWheel.onvalue = (t: number) => {
                renderer.timeSeconds = t * Env.DAY_SEC;
            };
            timePanel.contents.appendChild(timeWheel.elem);

            const moonSlider = new UI.Slider();
            moonSlider.setRange(0, Moon.PHASE_COUNT - 1, 1);
            const syncMoonLabel = () => {
                const phase = Moon.phaseImageIndex(renderer.dayIndex, renderer.timeSeconds);
                moonSlider.setLabel(`Moon phase  ${phase + 1} / ${Moon.PHASE_COUNT}`);
            };
            moonSlider.setValue(renderer.dayIndex % Moon.PHASE_COUNT);
            syncMoonLabel();
            moonSlider.onvalue = (v: number) => {
                renderer.dayIndex = v | 0;
                syncMoonLabel();
            };
            timePanel.contents.appendChild(moonSlider.elem);

            const tickTimeSlider = () => {
                if (renderer.destroyed)
                    return;
                if (renderer.timeScale !== 0) {
                    timeWheel.setValue(renderer.timeSeconds / Env.DAY_SEC);
                    moonSlider.setValue(renderer.dayIndex % Moon.PHASE_COUNT);
                    syncMoonLabel();
                }
                requestAnimationFrame(tickTimeSlider);
            };
            requestAnimationFrame(tickTimeSlider);

            // Sun flash is always on in-game, but the camera only faces the sun if you enter FPV
            // In noclip, it's very easy to look at the sun, and the brightening effect is intense
            // Disable by default, allow user to enable
            const sunFlashCheckbox = new UI.Checkbox('Sun flash (bright!)', renderer.sunFlashEnabled);
            sunFlashCheckbox.onchanged = () => {
                renderer.sunFlashEnabled = sunFlashCheckbox.checked;
            };
            timePanel.contents.appendChild(sunFlashCheckbox.elem);

            //#endregion

            //#region Weather

            const weatherPanel = new UI.Panel();
            weatherPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
            weatherPanel.setTitle(UI.TIME_OF_DAY_ICON, 'Weather');

            //#endregion

            //#region Automatic Weather

            let autoCheckbox: UI.Checkbox;
            
            // Changing any weather param disables Auto mode
            const dropOutOfAuto = () => {
                if (!renderer.autoWeather)
                    return;
                renderer.setAutoWeather(false);
                autoCheckbox.setChecked(false);
            };

            const weatherButtons = new UI.RadioButtons(``, [...Weather.SHORT_WEATHER_LABELS]);
            weatherButtons.elem.style.gap = `4px`;

            let syncingWeatherButtons = false;
            const syncWeatherButtons = () => {
                syncingWeatherButtons = true;
                weatherButtons.setSelectedIndex(renderer.weather.target);
                syncingWeatherButtons = false;
            };
            weatherButtons.onselectedchange = () => {
                if (syncingWeatherButtons)
                    return;
                // Weather Cross Fade is potentially confusing - it takes 60 seconds to see
                // the weather change you make. Disable anytime we drop out of auto
                if (renderer.autoWeather) {
                    renderer.weatherCrossFade = false;
                    crossFadeCheckbox.setChecked(false);
                }
                dropOutOfAuto();
                renderer.setWeather(weatherButtons.selectedIndex);
            };
            syncWeatherButtons();
            weatherPanel.contents.appendChild(weatherButtons.elem);

            const crossFadeCheckbox = new UI.Checkbox(`Cross-Fade Changes (1 in-game hour)`, renderer.weatherCrossFade);
            crossFadeCheckbox.onchanged = () => {
                renderer.weatherCrossFade = crossFadeCheckbox.checked;
                if (!crossFadeCheckbox.checked)
                    dropOutOfAuto();
            };
            weatherPanel.contents.appendChild(crossFadeCheckbox.elem);

            const windDirSlider = new UI.Slider();
            windDirSlider.setRange(0, Cloud.WIND_DIRECTION_OCTANTS - 1, 1);
            const syncWindDirLabel = (rawOctant: number) => {
                const v = Wind.normalizeOctant(rawOctant);
                const exact = Number.isInteger(v) ? `${v}` : v.toFixed(1);
                windDirSlider.setLabel(`Wind direction:  ${exact} / ${Cloud.WIND_DIRECTION_OCTANTS}`);
            };
            windDirSlider.setValue(renderer.windOctant);
            syncWindDirLabel(renderer.windOctant);
            windDirSlider.onvalue = (v: number) => {
                dropOutOfAuto();
                renderer.windOctant = v | 0;
                syncWindDirLabel(v | 0);
            };
            weatherPanel.contents.appendChild(windDirSlider.elem);

            const windSpeedSlider = new UI.Slider();
            windSpeedSlider.setRange(0, Wind.MAX_SPEED_LEVEL, 1);
            const syncWindSpeedLabel = (v: number) => {
                if (v === 0) {
                    windSpeedSlider.setLabel(`Wind:  still`);
                    return;
                }
                const level = Number.isInteger(v) ? `level ${v}` : `level ${v.toFixed(1)}`;
                windSpeedSlider.setLabel(`Wind speed:  ${level}`);
            };
            windSpeedSlider.setValue(renderer.windSpeed);
            syncWindSpeedLabel(renderer.windSpeed);
            windSpeedSlider.onvalue = (v: number) => {
                dropOutOfAuto();
                renderer.windSpeed = v;
                syncWindSpeedLabel(v);
            };
            weatherPanel.contents.appendChild(windSpeedSlider.elem);

            renderer.onAutoWeatherChanged = () => {
                syncWeatherButtons();
                windDirSlider.setValue(Math.round(Wind.normalizeOctant(renderer.windOctant)) % Cloud.WIND_DIRECTION_OCTANTS);
                syncWindDirLabel(renderer.windOctant);
                windSpeedSlider.setValue(Math.round(renderer.windSpeed));
                syncWindSpeedLabel(renderer.windSpeed);
            };

            autoCheckbox = new UI.Checkbox(`Automatic`, renderer.autoWeather);
            autoCheckbox.onchanged = () => {
                renderer.setAutoWeather(autoCheckbox.checked);
                // Force cross-fade on for automatic mode
                if (autoCheckbox.checked)
                    crossFadeCheckbox.setChecked(renderer.weatherCrossFade);
                renderer.onAutoWeatherChanged!();
            };
            weatherPanel.contents.insertBefore(autoCheckbox.elem, weatherPanel.contents.firstChild);

            return [timePanel, weatherPanel, panel, layersPanel];

            //#endregion

        };

        //#endregion

        renderer.defaultWorldMatrix = mat4.fromYRotation(mat4.create(), OUTDOOR_CAMERA_YAW);
        setMatrixTranslation(renderer.defaultWorldMatrix, OUTDOOR_CAMERA_EYE);

        renderer.inputManager = context.inputManager;

        return renderer;
    }
}

//#endregion

//#region Indoor room scenes

interface RoomVariant {
    label: string;
    parts: RoomCuration.RoomPart[];
}

interface RoomEntry {
    inst: ModelInstance;
    variant: number;
    layer: RoomLayer | null;
}

class RoomLayer implements UI.Layer {
    constructor(public name: string, public visible: boolean, private onChange: () => void) {
    }
    public setVisible(v: boolean): void {
        this.visible = v;
        this.onChange();
    }
}

interface LoadedRoomPart {
    meshes: Map<number, Gpl.DecodedMesh>;
    instances: Room.RoomInstance[];
    min: vec3;
    max: vec3;
    offset: vec3;
}

class RoomSceneDesc implements SceneDesc {
    private variants: RoomVariant[];

    constructor(public id: string, public name: string, archive: string | RoomVariant[]) {
        this.variants = typeof archive === 'string' ? [{ label: name, parts: [{ archiveName: archive }] }] : archive;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const datas = await Promise.all(this.variants.map((v) => Promise.all(
            v.parts.map((p) => context.dataFetcher.fetchData(`${pathBase}/${p.archiveName}`)))));

        const roomsByPart = datas.map((variantDatas) => variantDatas.map((d) => Room.loadRoomArchive(d)));
        const lightingByPart: (Room.RoomLighting | null)[][] = roomsByPart.map((rooms) =>
            rooms.map((room) => Room.loadRoomLighting(room)));
        const allRigs = lightingByPart.flat().filter((l): l is Room.RoomLighting => l !== null);
        const litLightCount = Math.max(1, ...allRigs.map((l) => l.lights.length));

        const renderer = new HarvestMoonAWLRenderer(device, litLightCount);
        renderer.roomLightRigs = allRigs;

        // Finding a reasonable camera speed for the small room models
        renderer.cameraMoveSpeed = 3.5 / 3600;
        renderer.lightingEnabled = false;

        renderer.waterTintEnabled = false;
        renderer.timeSeconds = ROOM_DEFAULT_TIME_SECONDS;

        let activeVariant = 0;
        const entries: RoomEntry[] = [];

        // TV easter egg - one per channel
        const tvScreenByVariant: (Tv.TvScreen | null)[] = this.variants.map(() => null);
        const tvPlacements: { variant: number, matrix: mat4 }[] = [];

        let needsWaterAtlas = false;
        const applyVisibility = (): void => {
            for (const e of entries)
                e.inst.visible = e.variant === activeVariant && (e.layer === null || e.layer.visible);
            for (let v = 0; v < tvScreenByVariant.length; v++) {
                const tv = tvScreenByVariant[v];
                if (tv !== null)
                    tv.enabled = v === activeVariant;
            }
        };

        const layers: RoomLayer[] = [];
        const layerByName = new Map<string, RoomLayer>();
        const layer = (spec: RoomObjectLayer): RoomLayer => {
            let l = layerByName.get(spec.name);
            if (l === undefined) {
                l = new RoomLayer(spec.name, spec.defaultVisible, applyVisibility);
                layerByName.set(spec.name, l);
                if (spec.inPanel ?? true)
                    layers.push(l);
            }
            return l;
        };

        const objectLayerByArchive = new Map<string, Map<number, RoomLayer>>();
        for (const v of this.variants)
            for (const part of v.parts)
                if (!objectLayerByArchive.has(part.archiveName))
                    objectLayerByArchive.set(part.archiveName, new Map((ROOM_OBJECT_LAYERS.get(part.archiveName) ?? [])
                        .map((l) => [l.objectId, layer(l)] as [number, RoomLayer])));

        const exclusiveGroups: { members: RoomLayer[], fallback: RoomLayer, last: boolean[] }[] = [];
        for (const group of Room.NAMED_VARIANT_GROUPS) {
            const layerFor = (objectId: number): RoomLayer | undefined => {
                for (const byObject of objectLayerByArchive.values()) {
                    const l = byObject.get(objectId);
                    if (l !== undefined)
                        return l;
                }
                return undefined;
            };
            const fallback = layerFor(group[0]);
            const members = group.slice(1).map(layerFor).filter((l): l is RoomLayer => l !== undefined);
            if (fallback !== undefined && members.length > 0)
                exclusiveGroups.push({ members, fallback, last: members.map((l) => l.visible) });
        }
        const layoutBounds = (meshes: Map<number, Gpl.DecodedMesh>, instances: Room.RoomInstance[]): [vec3, vec3] => {
            const min = vec3.fromValues(Infinity, Infinity, Infinity);
            const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
            const p = vec3.create();
            for (const ri of instances) {
                const mesh = meshes.get(ri.blockIndex);
                if (mesh === undefined || mesh.triangles.length === 0)
                    continue;
                for (const pos of mesh.positions) {
                    vec3.set(p, pos[0], pos[1], pos[2]);
                    vec3.transformMat4(p, p, ri.matrix);
                    vec3.min(min, min, p);
                    vec3.max(max, max, p);
                }
            }
            return [min, max];
        };

        const scratchOffsetMatrix = mat4.create();
        let cameraMin: vec3 | null = null, cameraMax: vec3 | null = null;

        const loadedByVariant: LoadedRoomPart[][] = [];

        const layoutVariant = (v: number): void => {
            const loaded = loadedByVariant[v];
            const offsets = RoomCuration.layoutRoomParts(this.variants[v].parts, loaded.map((l): [vec3, vec3] => [l.min, l.max]));
            for (let p = 0; p < offsets.length; p++)
                vec3.copy(loaded[p].offset, offsets[p]);
        };

        for (let v = 0; v < this.variants.length; v++) {
            const parts = this.variants[v].parts;

            const loaded: LoadedRoomPart[] = parts.map((part, p) => {
                const room = roomsByPart[v][p];
                const meshes = Gpl.loadAllMeshes(room.gpl);
                if (room.tpl !== null)
                    renderer.registerAtlas(`${ROOM_ATLAS}:${part.archiveName}`, Tpl.parse(room.tpl));

                const hidden = ROOM_HIDDEN_OBJECTS.get(part.archiveName);
                const instances = Room.loadRoomInstances(room, part.archiveName, meshes, { includeUnselectedVariants: true })
                    .filter((ri) => hidden === undefined || ri.objectId === null || !hidden.has(ri.objectId));
                const [min, max] = layoutBounds(meshes, instances);
                return { meshes, instances, min, max, offset: vec3.create() };
            });

            // Lay the rooms out relative to each other
            loadedByVariant[v] = loaded;
            layoutVariant(v);

            for (let p = 0; p < parts.length; p++) {
                const archiveName = parts[p].archiveName;
                const { meshes, instances, offset } = loaded[p];

                const partLighting = lightingByPart[v][p];
                if (partLighting !== null)
                    vec3.copy(partLighting.offset, offset);
                const atlasKey = `${ROOM_ATLAS}:${archiveName}`;
                const objectLayers = objectLayerByArchive.get(archiveName)!;
                mat4.fromTranslation(scratchOffsetMatrix, offset);

                for (const ri of instances) {
                    const mesh = meshes.get(ri.blockIndex);
                    if (mesh === undefined)
                        continue;

                    const waterAnim = ri.drawKind === 'water' ? Water.animForTypeId(ri.typeId, Room.WATER_ID_MOD) : null;

                    const materialKey = waterAnim !== null ? (Water.texGenSrc(waterAnim) === GX.TexGenSrc.POS ? "water" : "water-uv")
                        : ri.drawKind === 'additive' ? "room-additive" : "opaque-back";
                    const modelData = renderer.modelCache.getOrCreate(`room:${archiveName}:${ri.blockIndex}:${ri.drawKind}:${materialKey}`, (): BuiltModel => (waterAnim !== null ? {

                        mesh, imageIndexByTriangle: mesh.triangleOffsets.map(() => Water.BASE_IMAGE_INDEX),
                        atlasKey: WATER_ATLAS, materialKey,
                    } : {
                        mesh, imageIndexByTriangle: Material.imageIndexByTriangleForRoom(mesh), atlasKey, materialKey,
                    }));
                    if (modelData === null)
                        continue;
                    const inst = new ModelInstance(modelData);
                    inst.lightRig = partLighting;
                    inst.waterAnim = waterAnim;
                    if (waterAnim !== null)
                        needsWaterAtlas = true;
                    mat4.mul(inst.modelMatrix, scratchOffsetMatrix, ri.matrix);
                    renderer.instances.push(inst);
                    if (Room.isPulseGlow(ri.objectId))
                        renderer.roomPulseGlows.push(inst);
                    else if (Room.isGlassPane(ri.objectId))
                        inst.matColorOverride = Room.GLASS_PANE_MAT_COLOR;
                    else if (ri.drawKind === 'additive')
                        renderer.roomLightShafts.push(inst);

                    const instLayer = ri.objectId !== null ? objectLayers.get(ri.objectId) ?? null : null;
                    entries.push({ inst, variant: v, layer: instLayer });

                    // Place TV sprite just in front of the actual screen
                    if (archiveName.startsWith(`jitaku-living`) && ri.blockIndex === Tv.SCREEN_BLOCK_INDEX)
                        tvPlacements.push({ variant: v, matrix: mat4.clone(inst.modelMatrix) });
                }
            }

            if (v === 0 && Number.isFinite(loaded[0].min[0])) {
                cameraMin = vec3.add(vec3.create(), loaded[0].min, loaded[0].offset);
                cameraMax = vec3.add(vec3.create(), loaded[0].max, loaded[0].offset);
            }
        }

        applyVisibility();

        //#region TV Easter Egg

        if (tvPlacements.length > 0) {
            const [agcData, tplData] = await Promise.all([
                context.dataFetcher.fetchData(`${pathBase}/tv-console2.agc`).catch(() => null),
                context.dataFetcher.fetchData(`${pathBase}/tv-console2.tpl`).catch(() => null),
            ]);
            if (agcData !== null && tplData !== null) {
                renderer.registerAtlas(TV_ATLAS, Tpl.parse(tplData));
                const animations = Tv.parseAgc(agcData);
                for (const placement of tvPlacements) {
                    const screen = Tv.buildScreenLayers(animations, (animIndex, stepIndex, layerSlot, step) => {
                        const modelData = renderer.modelCache.getOrCreate(`tv:${animIndex}:${stepIndex}:${layerSlot}`, (): BuiltModel => {
                            const built = Tv.buildStepMesh(step, layerSlot);
                            return { mesh: built.mesh, imageIndexByTriangle: built.imageIndexByTriangle, atlasKey: TV_ATLAS, materialKey: `tv-screen` };
                        })!;
                        const inst = new ModelInstance(modelData);
                        mat4.copy(inst.modelMatrix, placement.matrix);
                        renderer.instances.push(inst);
                        return inst;
                    });
                    screen.corners = Tv.screenCornersWorld(placement.matrix);
                    tvScreenByVariant[placement.variant] = screen;
                    renderer.tvScreens.push(screen);
                }
                renderer.inputManager = context.inputManager;
                applyVisibility();
            }
        }

        //#endregion

        // Indoor water handler (barn and chicken coop)
        if (needsWaterAtlas) {
            const fetchOptional = (path: string) => context.dataFetcher.fetchData(`${pathBase}/${path}`, { allow404: true }).then((d) => (d.byteLength > 0 ? d : null), () => null);
            const [mapwaterTplData, mapwaterBumpTplData] = await Promise.all([fetchOptional(`mapwater.tpl`), fetchOptional(`mapwater-bump.tpl`)]);
            if (mapwaterTplData !== null && mapwaterBumpTplData !== null) {
                renderer.registerAtlas(WATER_ATLAS, Tpl.parse(mapwaterTplData));
                renderer.registerAtlas(WATER_BUMP_ATLAS, Water.buildBumpSlopeMap(Tpl.parse(mapwaterBumpTplData)));
            }
        }

        if (cameraMin !== null && cameraMax !== null) {
            const eye = vec3.fromValues(
                (cameraMin[0] + cameraMax[0]) / 2,
                cameraMin[1] + ROOM_EYE_HEIGHT,
                Math.max(cameraMin[2], cameraMax[2] - ROOM_CAMERA_INSET),
            );
            renderer.defaultWorldMatrix = mat4.fromTranslation(mat4.create(), eye);
        }

        renderer.createPanels = (): UI.Panel[] => {
            const panels: UI.Panel[] = [];

            if (this.variants.length > 1) {
                const scenarioPanel = new UI.Panel();
                scenarioPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
                scenarioPanel.setTitle(UI.LAYER_ICON, 'Scenario');
                const select = new UI.SingleSelect();
                select.setStrings(this.variants.map((v) => v.label));
                select.onselectionchange = (index: number) => {
                    activeVariant = index;
                    applyVisibility();
                };
                select.selectItem(activeVariant);
                scenarioPanel.contents.appendChild(select.elem);
                panels.push(scenarioPanel);
            }

            const panel = new UI.Panel();
            panel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
            panel.setTitle(UI.TIME_OF_DAY_ICON, 'Time of Day');

            const timeWheel = new UI.CircularTimeSlider();
            timeWheel.setLabelFormatter((t: number) => `Time  ${Env.formatClock(t * Env.DAY_SEC)}`);
            timeWheel.setValue(renderer.timeSeconds / Env.DAY_SEC);
            timeWheel.onvalue = (t: number) => {
                renderer.timeSeconds = t * Env.DAY_SEC;
            };
            panel.contents.appendChild(timeWheel.elem);

            const owned = new Set(entries.map((e) => e.layer));
            const layersInUse = layers.filter((l) => owned.has(l));
            const layerPanel = new UI.LayerPanel(layersInUse);
            layerPanel.setVisible(layersInUse.length > 0);

            if (exclusiveGroups.length > 0) {
                const enforceExclusiveGroups = (): void => {
                    for (const group of exclusiveGroups) {
                        const justOn = group.members.findIndex((l, i) => l.visible && !group.last[i]);
                        if (justOn !== -1)
                            for (let i = 0; i < group.members.length; i++)
                                if (i !== justOn && group.members[i].visible)
                                    group.members[i].setVisible(false);
                        const anyOn = group.members.some((l) => l.visible);
                        if (group.fallback.visible === anyOn)
                            group.fallback.setVisible(!anyOn);
                        group.last = group.members.map((l) => l.visible);
                    }
                    layerPanel.syncLayerVisibility();
                };
                layerPanel.onlayertoggled = enforceExclusiveGroups;
                enforceExclusiveGroups();
            }

            panels.push(panel, layerPanel);
            return panels;
        };

        return renderer;
    }
}

//#endregion

//#region Scene List

const sceneDescs = [
    "Overworld",
    new PopulatedSceneDesc(`map1`, `Forget-Me-Not Valley`, `map1`),

    "Player's House",
    new RoomSceneDesc(`chapter1-house`, `Chapter 1 House`, `jitaku-living.arc`),
    // Four purchaseable themes for the player's house - using filenames from the ROM
    new RoomSceneDesc(`chapter2-house`, `Chapter 2 House`, HOUSE_STYLES.map((style) => ({
        label: style,
        parts: [
            { archiveName: `jitaku-living1_${style}.arc` },
            { archiveName: `jitaku-kitchen_${style}.arc`, attach: { relation: `north` as const, partner: 0, gap: RoomCuration.JITAKU_KITCHEN_GAP }, offset: [0.55, 0, 0] },
        ],
    }))),
    new RoomSceneDesc(`chapter3-house`, `Chapter 3 House`, HOUSE_STYLES.map((style) => ({
        label: style,
        parts: [
            { archiveName: `jitaku-living2_${style}.arc` },
            { archiveName: `jitaku-kitchen_${style}.arc`, attach: { relation: `north` as const, partner: 0, gap: RoomCuration.JITAKU_KITCHEN_GAP }, offset: [1.75, 0, 0] },
            { archiveName: `jitaku-childsroom_${style}.arc`, attach: { relation: `west` as const, partner: 0, gap: RoomCuration.JITAKU_CHILDSROOM_GAP }, offset: [0, 0, 1.1] },
        ],
    }))),
    new RoomSceneDesc(`chapter4-house`, `Chapter 4 House`, HOUSE_STYLES.map((style) => ({
        label: style,
        parts: [
            { archiveName: `jitaku-living3_${style}.arc` },
            { archiveName: `jitaku-kitchen1_${style}.arc`, attach: { relation: `north` as const, partner: 0 }, offset: [0.55, 0, 0] },
            { archiveName: `jitaku-childsroom1_${style}.arc`, attach: { relation: `west` as const, partner: 0, gap: RoomCuration.JITAKU_CHILDSROOM_GAP } },
            { archiveName: `jitaku-shinshitsu_${style}.arc`, attach: { relation: `north` as const, partner: 2 } },
        ],
    }))),

    "Farm Buildings",
    new RoomSceneDesc(`tool-shed`, `Tool Shed`, `dougugoya.arc`),
    new RoomSceneDesc(`chicken-coop`, `Chicken Coop`, `torigoya.arc`),
    new RoomSceneDesc(`milking-room`, `Milking Room`, `sakunyushitsu.arc`),
    new RoomSceneDesc(`barn`, `Barn`, [
        { label: `Default`, parts: [{ archiveName: `doubutsugoya.arc` }] },
        { label: `With Milking Room`, parts: [{ archiveName: `doubutsugoya1.arc` }] },
    ]),
    new RoomSceneDesc(`storage-shed`, `Storage Shed`, [
        { label: `Storage Shed`, parts: [{ archiveName: `syokumotsuko.arc` }] },
        {
            label: `Food Processing Room`,
            parts: [
                { archiveName: `syokumotsuko1.arc` },
                { archiveName: `kakoushitsu.arc`, attach: { relation: `west` as const, partner: 0, gap: RoomCuration.STORAGE_ROOM_GAP } },
            ],
        },
    ]),

    "Village Buildings",

    new RoomSceneDesc(`inn`, `Inn`, [{
        label: `Inn`,
        parts: [
            { archiveName: `yadoya-entrance.arc` },
            { archiveName: `yadoya-huuhu.arc`, attach: { relation: `north` as const, partner: 0, align: `min` as const, gap: RoomCuration.INN_HUUHU_GAP }, offset: [-0.2, 0, 0] },
            { archiveName: `yadoya-kitchen.arc`, attach: { relation: `east` as const, partner: 0, gap: RoomCuration.INN_KITCHEN_GAP }, offset: [0, 0, 0.4] },
            { archiveName: `yadoya-corridor.arc`, attach: { relation: `north` as const, partner: 1, gap: RoomCuration.INN_FLOOR_GAP }, offset: [0, RoomCuration.UPPER_FLOOR_LIFT, 0] },
            { archiveName: `yadoya-room1.arc`, attach: { relation: `west` as const, partner: 3, gap: RoomCuration.INN_ROOM_GAP }, offset: [0, RoomCuration.UPPER_FLOOR_LIFT, 0] },
            { archiveName: `yadoya-room2.arc`, attach: { relation: `east` as const, partner: 3, gap: RoomCuration.INN_ROOM_GAP }, offset: [0, RoomCuration.UPPER_FLOOR_LIFT, 0] },
        ],
    }]),

    new RoomSceneDesc(`villa`, `Villa`, [{
        label: `Villa`,
        parts: [
            { archiveName: `yashiki-entrance.arc` },
            { archiveName: `yashiki-room1.arc`, attach: { relation: `north` as const, partner: 0, gap: RoomCuration.VILLA_ROOM_GAP } },
            { archiveName: `yashiki-room2.arc`, attach: { relation: `west` as const, partner: 1, gap: RoomCuration.VILLA_ROOM_GAP } },
            { archiveName: `yashiki-room3.arc`, attach: { relation: `east` as const, partner: 1, gap: RoomCuration.VILLA_ROOM_GAP } },
            { archiveName: `yashiki-corridor.arc`, attach: { relation: `north` as const, partner: 1, gap: RoomCuration.VILLA_FLOOR_GAP }, offset: [0, RoomCuration.UPPER_FLOOR_LIFT, 0] },
            { archiveName: `yashiki-room4.arc`, attach: { relation: `north` as const, partner: 4, gap: RoomCuration.VILLA_ROOM_GAP }, offset: [0, RoomCuration.VILLA_ROOM4_LIFT, 0] },
        ],
    }]),

    new RoomSceneDesc(`takakura`, `Takakura's House`, [
        { label: `Chapter 1`, parts: [{ archiveName: `takakura.arc` }] },
        { label: `Chapter 2`, parts: [{ archiveName: `takakura1.arc` }] },
    ]),

    new RoomSceneDesc(`patrick-kassey-house`, `Patrick & Kassey's House`, `hanabi.arc`),
    new RoomSceneDesc(`codys-house`, `Cody's House`, `geizyutsuka.arc`),
    new RoomSceneDesc(`daryls-house`, `Daryl's House`, `kagakusya.arc`),
    new RoomSceneDesc(`gustafas-yurt`, `Gustafa's Yurt`, `shizin.arc`),

    new RoomSceneDesc(`blue-bar`, `Blue Bar`, [{
        label: `Blue Bar`,
        parts: [
            { archiveName: `sakaba-mise.arc` },
            { archiveName: `sakaba-living.arc`, attach: { relation: `east` as const, partner: 0, gap: RoomCuration.BAR_ROOM_GAP } },
        ],
    }]),

    new RoomSceneDesc(`galens-house`, `Galen's House`, `hakamori.arc`),
    new RoomSceneDesc(`galen-nina-house`, `Galen & Nina's House`, `minka3-1.arc`),
    new RoomSceneDesc(`hardys-house`, `Hardy's House`, `minka3-2.arc`),
    new RoomSceneDesc(`carter-flora-tent`, `Carter & Flora's Tent`, `tent.arc`),
    new RoomSceneDesc(`chris-wally-house`, `Chris and Wally's House`, [{
        label: `Chris and Wally's House`,
        parts: [
            { archiveName: `minka1-1.arc` },
            { archiveName: `minka1-2.arc`, attach: { relation: `north` as const, partner: 0, gap: RoomCuration.MINKA1_FLOOR_GAP }, offset: [0, RoomCuration.UPPER_FLOOR_LIFT, 0] },
        ],
    }]),

    new RoomSceneDesc(`grant-samantha-house`, `Grant & Samantha's House`, [{
        label: `Grant & Samantha's House`,
        parts: [
            { archiveName: `minka2-1.arc` },
            { archiveName: `minka2-2.arc`, attach: { relation: `north` as const, partner: 0, gap: RoomCuration.MINKA2_FLOOR_GAP }, offset: [0, RoomCuration.UPPER_FLOOR_LIFT, 0] },
        ],
    }]),

    new RoomSceneDesc(`dig-site`, `Dig Site`, [1, 2, 3, 4, 5, 6].map((chapter) => ({
        label: `Chapter ${chapter}`,
        parts: [{ archiveName: `hakkutsu${chapter}.arc` }],
    }))),

    new RoomSceneDesc(`harvest-sprites-tree`, `Harvest Sprites' Tree`, `koro.arc`),
    new RoomSceneDesc(`vesta-farm-shed`, `Vesta's Farm - Shed`, `nouka1a.arc`),
    new RoomSceneDesc(`vestas-farmhouse`, `Vesta's Farmhouse`, [{
        label: `Vesta's Farmhouse`,
        parts: [
            { archiveName: `nouka1b-1.arc` },
            { archiveName: `nouka1b-2.arc`, attach: { relation: `north` as const, partner: 0, gap: RoomCuration.NOUKA1B_FLOOR_GAP }, offset: [0, RoomCuration.UPPER_FLOOR_LIFT, 0] },
        ],
    }]),
];

const id = `HarvestMoonAWL`;
const name = "Harvest Moon: Another Wonderful Life";

export const sceneGroup: SceneGroup = { id, name, sceneDescs };

//#endregion
