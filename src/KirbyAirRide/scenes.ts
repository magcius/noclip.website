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

const sceneDescs = [
    "Air Ride",
    new KirbyMapDesc("GrPlants1Model.dat", "Fantasy Meadows"),
    new KirbyMapDesc("GrValley2Model.dat", "Celestial Valley"),
    new KirbyMapDesc("GrDesert1Model.dat", "Sky Sands"),
    new KirbyMapDesc("GrIce1Model.dat", "Frozen Hillside"),
    new KirbyMapDesc("GrHeat2Model.dat", "Magma Flows"),
    new KirbyMapDesc("GrSky2Model.dat", "Beanstalk Park"),
    new KirbyMapDesc("GrMachine2Model.dat", "Machine Passage"),
    new KirbyMapDesc("GrCheck2Model.dat", "Checker Knights"),
    new KirbyMapDesc("GrSpace2Model.dat", "Nebula Belt"),

    // "Top Ride",
    // ???

    "City Trial",
    new KirbyMapDesc("GrCity1Model.dat", "City Trial"),

    "City Trial Stadiums",
    new KirbyMapDesc("GrJump1Model.dat", "High Jump"),
    new KirbyMapDesc("GrJump2Model.dat", "Target Flight"),
    new KirbyMapDesc("GrJump3Model.dat", "Air Glider"),

    new KirbyMapDesc("GrZeroyon5Model.dat", "Drag Race 1"),
    new KirbyMapDesc("GrZeroyon3Model.dat", "Drag Race 2"),
    new KirbyMapDesc("GrZeroyon1Model.dat", "Drag Race 3"),
    new KirbyMapDesc("GrZeroyon4Model.dat", "Drag Race 4"),

    new KirbyMapDesc("GrColosseum1Model.dat", "Dustup Derby 1"),
    new KirbyMapDesc("GrColosseum3Model.dat", "Dustup Derby 2"),

    new KirbyMapDesc("GrPasture1Model.dat", "Kirby Melee 1"),
    new KirbyMapDesc("GrColosseum5Model.dat", "Kirby Melee 2"),

    new KirbyMapDesc("GrDedede1Model.dat", "VS. King Dedede"),

    "Test",
    new KirbyMapDesc("GrTest6Model.dat", "Test6Model"),
    new KirbyMapDesc("GrTest7Model.dat", "Test7Model"),
    new KirbyMapDesc("GrTestModel.dat", "TestModel"),
    new KirbyMapDesc("GrSimple2Model.dat", "Simple2Model"),
    new KirbyMapDesc("GrSimpleModel.dat", "SimpleModel"),
];

const id = `KirbyAirRide`;
const name = "Kirby Air Ride";

export const sceneGroup: SceneGroup = {
    id, name, sceneDescs,
};
