import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { combinePerfectDarkLevels, parsePerfectDarkLevel } from "./data.js";
import { parsePerfectDarkManifest, PERFECT_DARK_DATASET_VERSION } from "./manifest.js";
import { PerfectDarkCameraStart, PerfectDarkRenderer } from "./render.js";
import { parsePerfectDarkTextureBank } from "./texture.js";

const pathBase = "PerfectDark";
const dataPath = (filename: string): string => `${pathBase}/${filename}?cache_bust=${PERFECT_DARK_DATASET_VERSION}`;

class PerfectDarkSceneDesc implements SceneDesc {
    public constructor(public id: string, public name: string, private readonly bgFileId: number, private readonly cameraStart: PerfectDarkCameraStart | null) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const filename = this.bgFileId.toString(16).padStart(2, "0");
        const fetchSceneData = () => Promise.all([
            context.dataFetcher.fetchData(dataPath(`${filename}.pdb1`)),
            context.dataFetcher.fetchData(dataPath(`${this.id}.pdp1`), { allow404: true }),
            context.dataFetcher.fetchData(dataPath("textures.pdt1")),
            context.dataFetcher.fetchData(dataPath("manifest.json")),
        ]);
        let [data, props, textures, manifestData] = await fetchSceneData();
        let manifest;
        try {
            manifest = parsePerfectDarkManifest(manifestData);
        } catch {
            await context.dataFetcher.clearCache(`${pathBase}/`);
            [data, props, textures, manifestData] = await fetchSceneData();
            manifest = parsePerfectDarkManifest(manifestData);
        }
        const manifestStage = manifest.stages.find((stage) => stage.id === this.id);
        if (manifestStage === undefined || manifestStage.backgroundFileId !== this.bgFileId)
            throw new Error(`Perfect Dark data manifest does not match scene ${this.id}`);
        if (manifestStage.hasObjectArchive !== (props.byteLength > 0))
            throw new Error(`Perfect Dark object archive availability does not match the data manifest for ${this.id}`);
        const levels = [parsePerfectDarkLevel(data)];
        if (props.byteLength > 0)
            levels.push(parsePerfectDarkLevel(props));
        const textureBank = parsePerfectDarkTextureBank(textures);
        if (textureBank.size !== manifest.textureCount)
            throw new Error(`Perfect Dark texture bank contains ${textureBank.size} textures; expected ${manifest.textureCount}`);
        return new PerfectDarkRenderer(device, combinePerfectDarkLevels(levels), textureBank, this.cameraStart);
    }
}

const level = (id: string, name: string, bgFileId: number, position: [number, number, number] | null = null, look: [number, number, number] = [0, 0, -1], eyeHeight?: number): PerfectDarkSceneDesc =>
    new PerfectDarkSceneDesc(id, name, bgFileId, position === null ? null : { position, look, eyeHeight });

const sceneDescs = [
    "Campaign",
    level("defection", "dataDyne Central: Defection", 0x1c, [-4, 47, -4], [1, 0, 0]),
    level("investigation", "dataDyne Research: Investigation", 0x1f, [2136, 47, 1772]),
    level("extraction", "dataDyne Central: Extraction", 0x1c, [-1588, -8492, 51], [-0.707107, 0, 0.707107]),
    level("villa", "Carrington Villa: Hostage One", 0x18, [-8016, 1123, -3842], [1, 0, 0]),
    level("chicago", "Chicago: Stealth", 0x0a, [528, 77, 3494]),
    level("g5-building", "G5 Building: Reconnaissance", 0x0b, [2605, 35, -1243], [0, 0, 1]),
    level("infiltration", "Area 51: Infiltration", 0x1b, [-3726, 102, 2291], [0.707107, 0, 0.707107]),
    level("rescue", "Area 51: Rescue", 0x1b, [2187, -1750, -5058]),
    level("escape", "Area 51: Escape", 0x1b, [-1477, -395, -21797]),
    level("air-base", "Air Base: Espionage", 0x14, [-1270, 35, -1665], [0, 0, 1]),
    level("air-force-one", "Air Force One: Antiterrorism", 0x1d, [-741, -303, -8264]),
    level("crash-site", "Crash Site: Confrontation", 0x09, [5405, -336, -998], [0.866025, 0, -0.5]),
    level("pelagic-ii", "Pelagic II: Exploration", 0x0e, [-5804, 225, -928], [1, 0, 0]),
    level("deep-sea", "Deep Sea: Nullify Threat", 0x24, [6085, -578, -9387]),
    level("ci-defense", "Carrington Institute: Defense", 0x13, [1692, 49, -703]),
    level("attack-ship", "Attack Ship: Covert Assault", 0x20, [3590, -320, 4033]),
    level("skedar-ruins", "Skedar Ruins: Battle Shrine", 0x17, [-2586, 62, -471]),

    "Special Assignments",
    level("mr-blonde", "Mr. Blonde's Revenge", 0x1c, [836, -8492, 16]),
    level("maian-sos", "Maian SOS", 0x1b, [-1277, -395, -21185], [0, 0, 1]),
    level("war", "War!", 0x17, [-5369, -112, -5868], [1, 0, 0]),
    level("duel", "The Duel", 0x13, [-1900, 49, 235], [-0.866025, 0, -0.5]),
    level("carrington-institute", "Carrington Institute", 0x13, [637, 360, 923], [-1, 0, 0]),

    "Combat Simulator",
    level("mp-skedar", "Skedar", 0x1e, [633, -98, 3344]),
    level("mp-area-52", "Area 52", 0x2b, [1344, 50, -6944], [-1, 0, 0]),
    level("mp-base", "Base", 0x29, [2587, 763, -1004], [-0.866025, 0, 0.5]),
    level("mp-complex", "Complex", 0x0c, [-3817, 53, 349]),
    level("mp-villa", "Villa", 0x35, [1010, -506, -1546], [-0.718885, 0, 0.695129]),
    level("mp-grid", "Grid", 0x37, [-695, 73, 1295], [0.718885, 0, -0.695129]),
    level("mp-ravine", "Ravine", 0x04, [1581, -222, 6202]),
    level("mp-temple", "Temple", 0x12, [-743, 96, 1638], [-0.016798, 0, 0.999859]),
    level("mp-g5-building", "G5 Building", 0x0d, [-734, 299, -707], [0, 0, 1]),
    level("mp-pipes", "Pipes", 0x16, [-780, 300, -799], [-1, 0, 0]),
    level("mp-felicity", "Felicity", 0x33, [-1055, -50, -1035], [0, 0, 1]),
    level("mp-fortress", "Fortress", 0x34, [-8088, 811, 3870], [1, 0, 0]),
    level("mp-ruins", "Ruins", 0x31, [-988, 90, 765], [-0.5, 0, -0.866025]),
    level("mp-car-park", "Car Park", 0x2d, [1336, 1699, -6742], [-0.866025, 0, 0.5]),
    level("mp-warehouse", "Warehouse", 0x2c, [497, 600, 1463]),
    level("mp-sewers", "Sewers", 0x32, [-2069, -415, 1297], [-1, 0, 0]),

    "Extras",
    level("unused-title-sequence", "Unused Title Sequence", 0x26, [-20.899, 20.516, -109.602], [0.1800229, 0, 0.9836624], 0),
    level("dev-test-arch", "Character Gallery (Test Arch)", 0x05, [0, 500, 6500], [0, -0.25, -1], 0),
    level("dev-prop-gallery", "Prop Gallery (Test Arch)", 0x05, [0, 500, 6200], [0, -0.25, -1], 0),
    level("dev-door-gallery", "Door Gallery (Test Arch)", 0x05, [0, 500, 6200], [0, -0.25, -1], 0),
    level("dev-item-gallery", "Item Gallery (Test Arch)", 0x05, [0, 500, 6200], [0, -0.25, -1], 0),
];

export const sceneGroup: SceneGroup = {
    id: "PerfectDark",
    name: "Perfect Dark",
    sceneDescs,
};
