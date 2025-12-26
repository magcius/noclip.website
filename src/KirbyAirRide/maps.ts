import { HSD_AnimJointRoot, HSD_AObjLoadAnimJoint, HSD_AObjLoadMatAnimJoint, HSD_Archive, HSD_Archive__ResolvePtr, HSD_ArchiveParse, HSD_JObjLoadJoint, HSD_JObjRoot, HSD_LoadContext, HSD_LoadContext__ResolvePtr, HSD_MatAnimJointRoot } from "../SYSDOLPHIN/SYSDOLPHIN.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assertExists } from "../util.js";
import { SceneContext, SceneDesc } from "../SceneBase.js";
import { pathBase } from "./scenes.js";
import { SceneGfx } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { MeleeRenderer } from "../SuperSmashBrosMelee/Scenes_SuperSmashBrosMelee.js";
import { HSD_JObjRoot_Instance } from "../SYSDOLPHIN/SYSDOLPHIN_Render.js";

class KirbyMapDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const modelArchive = HSD_ArchiveParse(await dataFetcher.fetchData(`${pathBase}/${this.id}Model.dat`));
        const renderer = new KirbyMapRenderer(device, modelArchive);
        return renderer;
    }
}

class KirbyMapRenderer extends MeleeRenderer {

    constructor(device: GfxDevice, public modelArchive: HSD_Archive) {
        super(device);
        const ctx = new HSD_LoadContext(modelArchive);

        const modelRootNode = HSD_Archive_Find_Model(ctx.archive);
        const map = Kirby_Load_grModel(ctx, assertExists(modelRootNode));


        if (map.skyboxModel) {
            this.jobjRoots.push(new HSD_JObjRoot_Instance(this.modelCache.loadJObjRoot(map.skyboxModel)));
        }

        const mainRoot = new HSD_JObjRoot_Instance(this.modelCache.loadJObjRoot(assertExists(map.mainModel)));
        this.jobjRoots.push(mainRoot);

        const grModelMotion = HSD_Archive_Find_ModelMotion(ctx.archive);
        if (grModelMotion) {
            const modelMotion = Kirby_Load_grModelMotion(ctx, assertExists(grModelMotion));
            mainRoot.addAnimAll(
                modelMotion.animJoint,
                modelMotion.matAnimJoint,
                null,
            )
        }
    }
}

interface KirbyMapGrModel {
    mainModel: HSD_JObjRoot,
    skyboxModel: HSD_JObjRoot | null,
}

function Kirby_Load_grModel(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): KirbyMapGrModel {
    let view = buffer.createDataView();
    const grMainModel = HSD_LoadContext__ResolvePtr(ctx, view.getUint32(0x00), 0x14);
    const grMainModelObjRoot = assertExists(HSD_JObjLoadJoint(ctx, HSD_LoadContext__ResolvePtr(ctx, grMainModel.createDataView().getUint32(0x00), 0x40)));

    const grSkyboxOffset = view.getUint32(0x04);
    if (grSkyboxOffset == 0) {
        return {
            mainModel: grMainModelObjRoot,
            skyboxModel: null,
        };
    } else {
        const grSkyboxModel = HSD_LoadContext__ResolvePtr(ctx, grSkyboxOffset, 0x14);
        const grSkyboxModelObjRoot = assertExists(HSD_JObjLoadJoint(ctx, HSD_LoadContext__ResolvePtr(ctx, grSkyboxModel.createDataView().getUint32(0x00), 0x40)));

        return {
            mainModel: grMainModelObjRoot,
            skyboxModel: grSkyboxModelObjRoot,
        };
    }
}

interface KirbyMapGrModelMotion {
    animJoint: HSD_AnimJointRoot | null,
    matAnimJoint: HSD_MatAnimJointRoot | null,
}

function Kirby_Load_grModelMotion(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): KirbyMapGrModelMotion {
    const view = buffer.createDataView();
    const animJointPtr = view.getUint32(0x00);
    const animJoint = animJointPtr != 0 ? HSD_AObjLoadAnimJoint(ctx, HSD_LoadContext__ResolvePtr(ctx, animJointPtr)) : null;

    const matAnimJointPtr = view.getUint32(0x04);
    const matAnimJoint = matAnimJointPtr != 0 ? HSD_AObjLoadMatAnimJoint(ctx, HSD_LoadContext__ResolvePtr(ctx, matAnimJointPtr)) : null;

    return {
        animJoint,
        matAnimJoint,
    }
}

function HSD_Archive_Find_Model(arc: HSD_Archive): ArrayBufferSlice | null {
    const obj = arc.publics.find((sym) => sym.name.startsWith("grModel") && !sym.name.startsWith("grModelMotion"));
    if (obj !== undefined)
        return HSD_Archive__ResolvePtr(arc, obj.offset);
    else
        return null;
}

function HSD_Archive_Find_ModelMotion(arc: HSD_Archive): ArrayBufferSlice | null {
    const obj = arc.publics.find((sym) => sym.name.startsWith("grModelMotion"));
    if (obj !== undefined)
        return HSD_Archive__ResolvePtr(arc, obj.offset);
    else
        return null;
}

export const maps = [
    "Air Ride",
    new KirbyMapDesc("GrPlants1", "Fantasy Meadows"),
    new KirbyMapDesc("GrValley2", "Celestial Valley"),
    new KirbyMapDesc("GrDesert1", "Sky Sands"),
    new KirbyMapDesc("GrIce1", "Frozen Hillside"),
    new KirbyMapDesc("GrHeat2", "Magma Flows"),
    new KirbyMapDesc("GrSky2", "Beanstalk Park"),
    new KirbyMapDesc("GrMachine2", "Machine Passage"),
    new KirbyMapDesc("GrCheck2", "Checker Knights"),
    new KirbyMapDesc("GrSpace2", "Nebula Belt"),

    "City Trial",
    new KirbyMapDesc("GrCity1", "City Trial"),

    "City Trial Stadiums",
    new KirbyMapDesc("GrJump1", "High Jump"),
    new KirbyMapDesc("GrJump2", "Target Flight"),
    new KirbyMapDesc("GrJump3", "Air Glider"),

    new KirbyMapDesc("GrZeroyon5", "Drag Race 1"),
    new KirbyMapDesc("GrZeroyon3", "Drag Race 2"),
    new KirbyMapDesc("GrZeroyon1", "Drag Race 3"),
    new KirbyMapDesc("GrZeroyon4", "Drag Race 4"),

    new KirbyMapDesc("GrColosseum1", "Dustup Derby 1"),
    new KirbyMapDesc("GrColosseum3", "Dustup Derby 2"),

    new KirbyMapDesc("GrPasture1", "Kirby Melee 1"),
    new KirbyMapDesc("GrColosseum5", "Kirby Melee 2"),

    new KirbyMapDesc("GrDedede1", "VS. King Dedede"),

    "Test",
    new KirbyMapDesc("GrTest6", "Test6Model"),
    new KirbyMapDesc("GrTest7", "Test7Model"),
    new KirbyMapDesc("GrTest", "TestModel"),
    new KirbyMapDesc("GrSimple2", "Simple2Model"),
    new KirbyMapDesc("GrSimple", "SimpleModel"),
]