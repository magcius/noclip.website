import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { TGRRenderer } from "./render.js";
import { parseTGRTrack } from "./data.js";

const pathBase = "TopGearRally";

class TopGearRallySceneDesc implements SceneDesc {
    public constructor(
        public id: string,
        public name: string,
        private readonly trackIndex: number,
        private readonly mirrored = false,
    ) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const { dataFetcher } = context;
        const trackData = await dataFetcher.fetchData(`${pathBase}/track_${this.trackIndex}.bin`);
        const track = parseTGRTrack(trackData);
        return new TGRRenderer(device, track, this.mirrored, this.trackIndex);
    }
}

const sceneDescs = [
    "Tracks",
    new TopGearRallySceneDesc("coastline", "Coastline", 2),
    new TopGearRallySceneDesc("jungle", "Jungle", 4),
    new TopGearRallySceneDesc("desert", "Desert", 0),
    new TopGearRallySceneDesc("mountain", "Mountain", 1),
    new TopGearRallySceneDesc("stripmine", "Strip Mine", 3),
    "Mirrored",
    new TopGearRallySceneDesc("coastline_m", "Coastline", 2, true),
    new TopGearRallySceneDesc("jungle_m", "Jungle", 4, true),
    new TopGearRallySceneDesc("desert_m", "Desert", 0, true),
    new TopGearRallySceneDesc("mountain_m", "Mountain", 1, true),
    new TopGearRallySceneDesc("stripmine_m", "Strip Mine", 3, true),
    "Other",
    new TopGearRallySceneDesc("season_winner", "Season Winner", 10),
];

/** Unique identifier for the Top Gear Rally scene group. */
export const id = "TopGearRally";
/** Display name for the Top Gear Rally scene group. */
export const name = "Top Gear Rally";
/** Scene group definition containing all Top Gear Rally track scenes. */
export const sceneGroup: SceneGroup = { id, name, sceneDescs };
