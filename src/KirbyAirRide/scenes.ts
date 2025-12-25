import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { HSD_JObjRoot_Instance } from "../SYSDOLPHIN/SYSDOLPHIN_Render";
import { SceneGfx, SceneGroup } from "../viewer.js";
import { SceneContext, SceneDesc } from "../SceneBase.js";
import { HSD_Archive, HSD_Archive__ResolvePtr, HSD_ArchiveParse, HSD_JObjLoadJoint, HSD_JObjRoot, HSD_LoadContext, HSD_LoadContext__ResolvePtr } from "../SYSDOLPHIN/SYSDOLPHIN";
import { assertExists } from "../util.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { MeleeRenderer } from "../SuperSmashBrosMelee/Scenes_SuperSmashBrosMelee.js";

const pathBase = `KirbyAirRide`;

class KirbyMapDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const arc = HSD_ArchiveParse(await dataFetcher.fetchData(`${pathBase}/${this.id}`));
        const ctx = new HSD_LoadContext(arc);
        const modelRootNode = HSD_Archive_Find_Model(arc);
        const map = Kirby_Load_Map_Definition(ctx, assertExists(modelRootNode));

        const scene = new MeleeRenderer(device);

        scene.jobjRoots.push(new HSD_JObjRoot_Instance(scene.modelCache.loadJObjRoot(assertExists(map.mainModel))));
        scene.jobjRoots.push(new HSD_JObjRoot_Instance(scene.modelCache.loadJObjRoot(assertExists(map.skyboxModel))));

        return scene;
    }
}

interface KirbyMapGrModel {
    mainModel: HSD_JObjRoot,
    skyboxModel: HSD_JObjRoot,
}

function Kirby_Load_Map_Definition(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): KirbyMapGrModel {
    let view = buffer.createDataView();
    const grMainModel = HSD_LoadContext__ResolvePtr(ctx, view.getUint32(0x00), 0x14);
    const grSkyboxModel = HSD_LoadContext__ResolvePtr(ctx, view.getUint32(0x04), 0x14);

    return {
        mainModel: assertExists(HSD_JObjLoadJoint(ctx, HSD_LoadContext__ResolvePtr(ctx, grMainModel.createDataView().getUint32(0x00), 0x40))),
        skyboxModel: assertExists(HSD_JObjLoadJoint(ctx, HSD_LoadContext__ResolvePtr(ctx, grSkyboxModel.createDataView().getUint32(0x00), 0x40))),
    };
}
function HSD_Archive_Find_Model(arc: HSD_Archive): ArrayBufferSlice | null {
    const obj = arc.publics.find((sym) => sym.name.startsWith("grModel") && !sym.name.startsWith("grModelMotion"));
    if (obj !== undefined)
        return HSD_Archive__ResolvePtr(arc, obj.offset);
    else
        return null;
}

// Stages organized by @PuffyPuffyPuffP
const sceneDescs = [
    "Air Ride",
    new KirbyMapDesc("GrCheck2Model.dat", "Checker Knights"),
    new KirbyMapDesc("GrDesert1Model.dat", "Sky Sands"),
    new KirbyMapDesc("GrHeat2Model.dat", "Magma Flows"),
    new KirbyMapDesc("GrIce1Model.dat", "Frozen Hillside"),
    new KirbyMapDesc("GrPlants1Model.dat", "Fantasy Meadows"),
    new KirbyMapDesc("GrSky2Model.dat", "Beanstalk Park"),
    new KirbyMapDesc("GrSpace2Model.dat", "Nebula Belt"),

    new KirbyMapDesc("GrValley2Model.dat", "Celestial Valley"),
    new KirbyMapDesc("GrMachine2Model.dat", "Machine Passage"),

    // "Top Ride",
    // ???

    "City Trial",
    new KirbyMapDesc("GrCity1Model.dat", "City Trial"),

    "City Trial Stadiums",
    new KirbyMapDesc("GrJump1Model.dat"),
    new KirbyMapDesc("GrJump2Model.dat"),
    new KirbyMapDesc("GrJump3Model.dat"),

    new KirbyMapDesc("GrZeroyon1Model.dat"),
    new KirbyMapDesc("GrZeroyon3Model.dat"),
    new KirbyMapDesc("GrZeroyon4Model.dat"),
    new KirbyMapDesc("GrZeroyon5Model.dat"),

    new KirbyMapDesc("GrColosseum1Model.dat"),
    new KirbyMapDesc("GrColosseum3Model.dat"),
    new KirbyMapDesc("GrColosseum5Model.dat"),

    new KirbyMapDesc("GrDedede1Model.dat"),

    new KirbyMapDesc("GrPasture1Model.dat"),

    "Test",
    new KirbyMapDesc("GrTest6Model.dat"),
    new KirbyMapDesc("GrTest7Model.dat"),
    new KirbyMapDesc("GrTestModel.dat"),
    new KirbyMapDesc("GrSimple2Model.dat"),
    new KirbyMapDesc("GrSimpleModel.dat"),
];

const id = `KirbyAirRide`;
const name = "Kirby Air Ride";

export const sceneGroup: SceneGroup = {
    id, name, sceneDescs,
};
