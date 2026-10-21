import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { TGRRenderer } from "./render.js";
import { parseTGRTrack } from "./data.js";
import { SPLASH_MODEL_OFFSETS, TGRSplashRenderer } from "./splash.js";
import { TextAssets } from "./text.js";
import { MAIN_MENU_ITEMS, MENU_TEXTURES, TGRMenuRenderer } from "./menu.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { TGRRaceDriver } from "./racescene.js";
import { GAME_MODE_AFTER_SEASON, WEATHER_SUNNY } from "./sim/globals.js";
import {
    GAME_MODE_CHAMPIONSHIP,
    GAME_MODE_DEMO,
    RACE_SESSION_ATTRACT,
    RACE_SESSION_CREDIT_CAPTIONS,
    RACE_SESSION_SCROLLING_CREDITS,
    ROM_CREDITS_RECORDING,
    ROM_ENDING_RECORDING,
    ROM_GHOST_RECORDING,
    recordingTrack,
} from "./sim/race.js";

const pathBase = "TopGearRally";
const CAR_MODEL_OFFSETS = [0xaee40, 0xb2be0, 0xb6d40, 0xbaef0, 0xbebb0, 0xc2dc0, 0xc6900, 0xca3e0, 0xcdf60, 0xd1810, 0xd4a80, 0xd8490, 0xd9160];

const MIRRORED_TRACK_OFFSET = 5;

class TopGearRallySceneDesc implements SceneDesc {
    public constructor(
        public id: string,
        public name: string,
        private readonly gameMode: number,
        private readonly gameTrackId: number,
        private readonly sessionType = RACE_SESSION_ATTRACT,
        private readonly recordingRom = 0,
    ) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const { dataFetcher } = context;
        const recording = this.recordingRom !== 0 ? (await dataFetcher.fetchData(modelPath(this.recordingRom))).createTypedArray(Uint8Array) : undefined;
        const recordedTrack = recording !== undefined ? recordingTrack(recording) : this.gameTrackId;
        const mirrored = recordedTrack >= MIRRORED_TRACK_OFFSET && recordedTrack < MIRRORED_TRACK_OFFSET * 2;
        const trackIndex = mirrored ? recordedTrack - MIRRORED_TRACK_OFFSET : recordedTrack;
        const canMirror = recording === undefined && this.gameMode === GAME_MODE_CHAMPIONSHIP;
        const [text, dashboards, startLights] = await Promise.all([
            fetchTextAssets(context),
            dataFetcher.fetchData(`${pathBase}/dashboards.bin`),
            dataFetcher.fetchData(`${pathBase}/start_lights.bin`),
        ]);
        const [trackData, particle, dataSegment, sections, ...models] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/track_${trackIndex}.tgr`),
            dataFetcher.fetchData(`${pathBase}/particle.i8`),
            dataFetcher.fetchData(`${pathBase}/data_segment.bin`),
            dataFetcher.fetchData(`${pathBase}/sections_${trackIndex}.bin`),
            ...CAR_MODEL_OFFSETS.map((offset) => dataFetcher.fetchData(modelPath(offset))),
        ]);
        const track = parseTGRTrack(trackData);
        const carModels = new Map(CAR_MODEL_OFFSETS.map((offset, i) => [offset, models[i]]));
        const driver = new TGRRaceDriver(track, { dataSegment, sections, carModels }, {
            gameMode: this.gameMode,
            sessionType: this.sessionType,
            recording,
            trackIndex,
            gameTrackId: trackIndex,
            mirrored,
            weather: WEATHER_SUNNY,
            canMirror,
        });
        const renderer = new TGRRenderer(device, track, mirrored, trackIndex, particle.createTypedArray(Uint8Array), canMirror);
        renderer.raceDriver = driver;
        renderer.gameCamera = recording !== undefined || this.gameMode === GAME_MODE_AFTER_SEASON;
        renderer.attachHud(device, { text, dashboards, dataSegment });
        renderer.attachStartLights(startLights);
        renderer.attachEffects(device, particle, dataSegment);
        renderer.weather = driver.session.weather;
        return renderer;
    }
}

async function fetchTextAssets(context: SceneContext): Promise<TextAssets> {
    const [large, small, tables, gradients] = await Promise.all(
        ["font_large.ia8", "font_small.ia8", "font_tables.bin", "font_gradients.bin"].map((f) => context.dataFetcher.fetchData(`${pathBase}/${f}`)),
    );
    return { large, small, tables, gradients };
}

function modelPath(offset: number): string {
    return `${pathBase}/asset_${offset.toString(16).padStart(6, "0")}.bin`;
}

class TopGearRallySplashSceneDesc implements SceneDesc {
    public id = "intro";
    public name = "Intro";

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const names = Object.keys(SPLASH_MODEL_OFFSETS) as (keyof typeof SPLASH_MODEL_OFFSETS)[];
        const [models, text] = await Promise.all([
            Promise.all(names.map((n) => context.dataFetcher.fetchData(modelPath(SPLASH_MODEL_OFFSETS[n])))),
            fetchTextAssets(context),
        ]);
        const data = {} as Record<keyof typeof SPLASH_MODEL_OFFSETS, ArrayBufferSlice>;
        names.forEach((n, i) => {
            data[n] = models[i];
        });
        return new TGRSplashRenderer(device, data, text);
    }
}

class TopGearRallyMenuSceneDesc implements SceneDesc {
    public id = "main_menu";
    public name = "Main Menu";

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const fetch = (path: string) => context.dataFetcher.fetchData(path);
        const textureNames = Object.keys(MENU_TEXTURES) as (keyof typeof MENU_TEXTURES)[];
        const [models, textures, dataSegment, text] = await Promise.all([
            Promise.all(MAIN_MENU_ITEMS.map((item) => fetch(modelPath(item.offset)))),
            Promise.all(textureNames.map((n) => fetch(modelPath(MENU_TEXTURES[n].offset)))),
            fetch(`${pathBase}/data_segment.bin`),
            fetchTextAssets(context),
        ]);
        const textureData = {} as Record<keyof typeof MENU_TEXTURES, ArrayBufferSlice>;
        textureNames.forEach((n, i) => {
            textureData[n] = textures[i];
        });
        return new TGRMenuRenderer(device, { models, textures: textureData, dataSegment, text });
    }
}

const sceneDescs = [
    new TopGearRallySplashSceneDesc(),
    new TopGearRallyMenuSceneDesc(),
    new TopGearRallySceneDesc("attract", "Attract Demo", GAME_MODE_DEMO, 0, RACE_SESSION_ATTRACT, ROM_GHOST_RECORDING),
    new TopGearRallySceneDesc("credits", "Credits", GAME_MODE_DEMO, 0, RACE_SESSION_CREDIT_CAPTIONS, ROM_CREDITS_RECORDING),
    new TopGearRallySceneDesc("ending", "Ending Credits", GAME_MODE_DEMO, 0, RACE_SESSION_SCROLLING_CREDITS, ROM_ENDING_RECORDING),
    new TopGearRallySceneDesc("season_winner", "Season Winner", GAME_MODE_AFTER_SEASON, 10),
    "Tracks",
    new TopGearRallySceneDesc("coastline", "Coastline", GAME_MODE_CHAMPIONSHIP, 2),
    new TopGearRallySceneDesc("jungle", "Jungle", GAME_MODE_CHAMPIONSHIP, 4),
    new TopGearRallySceneDesc("desert", "Desert", GAME_MODE_CHAMPIONSHIP, 0),
    new TopGearRallySceneDesc("mountain", "Mountain", GAME_MODE_CHAMPIONSHIP, 1),
    new TopGearRallySceneDesc("stripmine", "Strip Mine", GAME_MODE_CHAMPIONSHIP, 3),
];

/** Unique identifier for the Top Gear Rally scene group. */
export const id = "TopGearRally";
/** Display name for the Top Gear Rally scene group. */
export const name = "Top Gear Rally";
/** Scene group definition containing all Top Gear Rally track scenes. */
export const sceneGroup: SceneGroup = { id, name, sceneDescs };
