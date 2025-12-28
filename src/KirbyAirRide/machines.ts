import { SceneContext, SceneDesc } from "../SceneBase.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneGfx } from "../viewer.js";
import { HSD_AObj, HSD_AObjFlags, HSD_AObjLoadMatAnimJoint, HSD_ArchiveParse, HSD_FObj, HSD_JObjLoadJoint, HSD_JObjRoot, HSD_LoadContext, HSD_LoadContext__ResolvePtr, HSD_LoadContext__ResolvePtrNullable, HSD_LoadContext__ResolveSymbol, HSD_MatAnimJointRoot } from "../SYSDOLPHIN/SYSDOLPHIN.js";
import { pathBase } from "./scenes.js";
import { assert, assertExists } from "../util.js";
import { BindFigATree, MeleeRenderer } from "../SuperSmashBrosMelee/Scenes_SuperSmashBrosMelee.js";
import { HSD_JObjRoot_Data, HSD_JObjRoot_Instance } from "../SYSDOLPHIN/SYSDOLPHIN_Render.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { figatree, Melee_figatree_Track_Load } from "../SuperSmashBrosMelee/Melee_ft.js";
import * as UI from "../ui.js";
import { OrbitCameraController } from "../Camera.js";

class KirbyVehicleDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const arc = HSD_ArchiveParse(await dataFetcher.fetchData(`${pathBase}/${this.id}`));
        const ctx = new HSD_LoadContext(arc);
        const scene = new KirbyVehicleRenderer(device, HSD_Parse_VehicleDataStar(ctx));

        return scene;
    }
}

/* Shim MeleeRenderer to add some panels */
class KirbyVehicleRenderer extends MeleeRenderer {
    public mainJobj: HSD_JObjRoot_Data;

    constructor(device: GfxDevice, public data: KirbyVehicleDataStar) {
        super(device);
        this.mainJobj = this.modelCache.loadJObjRoot(assertExists(this.data.modelData.mainModelRoot));
        const instance = this.resetInstance();
        this.addAnimations(instance, animationItems[0].animations(data.animationBank))
    }

    createPanels(): UI.Panel[] {
        const animationPanel = new UI.Panel();
        animationPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;

        animationPanel.setTitle(UI.SAND_CLOCK_ICON, "Animations")
        const x = new UI.MultiSelect();
        x.setStrings(animationItems.map(x => x.title));
        x.onitemchanged = () => {
            const instance = this.resetInstance();
            for (let i = 0; i < animationItems.length; i++) {
                if (x.itemIsOn[i]) {
                    this.addAnimations(instance, animationItems[i].animations(this.data.animationBank))
                }
            }
        }
        x.setItemsSelected(animationItems.map((x, i) => i === 0));

        animationPanel.contents.appendChild(x.elem);

        return [
            animationPanel,
        ]
    }

    resetInstance() {
        const instance = new HSD_JObjRoot_Instance(this.mainJobj);
        this.jobjRoots = [instance];
        return instance;
    }

    addAnimations(instance: HSD_JObjRoot_Instance, animations: VehicleAnimations) {
        instance.addAnimAll(null, animations.matAnim, null)
        if (animations.anim) {
            BindFigATree(instance, animations.anim);
        }
    }

    public createCameraController() {
        const orbit = new OrbitCameraController();
        orbit.z = orbit.zTarget = 0;
        return orbit;
    }
}

interface VehicleAnimations {
    anim: figatree | null,
    matAnim: HSD_MatAnimJointRoot | null,
}

interface AnimationItem {
    title: string;
    animations: (animationBank: KirbyVehicleAnimationStar) => VehicleAnimations
}

const animationItems: AnimationItem[] = [
    {title: "Moving", animations: (a) => ({anim: a.movingAnim, matAnim: a.movingMatAnim})},
    {title: "Charge", animations: (a) => ({anim: a.chargeAnim, matAnim: a.chargeMatAnim})},
    {title: "Boost", animations: (a) => ({anim: a.boostAnim, matAnim: a.boostMatAnim})},
    {title: "Stop", animations: (a) => ({anim: a.stopAnim, matAnim: a.stopMatAnim})},
    {title: "Unknown 1", animations: (a) => ({anim: a.unk1Anim, matAnim: a.unk1MatAnim})},
    {title: "Unknown 2", animations: (a) => ({anim: a.unk2Anim, matAnim: a.unk2MatAnim})},
]

interface KirbyVehicleDataStar {
    modelData: KirbyVehicleModelData;
    animationBank: KirbyVehicleAnimationStar;
}

function HSD_Parse_VehicleDataStar(ctx: HSD_LoadContext): KirbyVehicleDataStar {
    const buf = HSD_LoadContext__ResolveSymbol(ctx, ctx.archive.publics[0]);
    const view = buf.createDataView()

    return {
        modelData: HSD_Parse_KirbyVehicleModelData(ctx, HSD_LoadContext__ResolvePtr(ctx, view.getUint32(0x4))),
        animationBank: HSD_Parse_KirbyVehicleAnimationStar(ctx, HSD_LoadContext__ResolvePtr(ctx, view.getUint32(0x18))),
    }
}

interface KirbyVehicleModelData {
    mainModelRoot: HSD_JObjRoot;
    shadowModelRoot: HSD_JObjRoot | null;
}

function HSD_Parse_KirbyVehicleModelData(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): KirbyVehicleModelData {
    const view = buffer.createDataView()
    const shadowPtr = HSD_LoadContext__ResolvePtrNullable(ctx, view.getUint32(0x28));
    return {
        mainModelRoot: assertExists(HSD_JObjLoadJoint(ctx, HSD_LoadContext__ResolvePtr(ctx, view.getUint32(0x0)))),
        shadowModelRoot: shadowPtr ? HSD_JObjLoadJoint(ctx, shadowPtr) : null,
    }
}

interface KirbyVehicleAnimationStar {
    movingAnim: figatree | null;
    movingMatAnim: HSD_MatAnimJointRoot | null;
    unk1Anim: figatree | null;
    unk1MatAnim: HSD_MatAnimJointRoot | null;
    unk2Anim: figatree | null;
    unk2MatAnim: HSD_MatAnimJointRoot | null;
    boostAnim: figatree | null;
    boostMatAnim: HSD_MatAnimJointRoot | null;
    chargeAnim: figatree | null;
    chargeMatAnim: HSD_MatAnimJointRoot | null;
    stopAnim: figatree | null;
    stopMatAnim: HSD_MatAnimJointRoot | null;
}

function HSD_Parse_KirbyVehicleAnimationStar(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): KirbyVehicleAnimationStar {
    const view = buffer.createDataView()

    function loadMatAnim(offset: number): HSD_MatAnimJointRoot | null {
        const ptr = HSD_LoadContext__ResolvePtrNullable(ctx, view.getUint32(offset));
        if (!ptr) return null;
        return HSD_AObjLoadMatAnimJoint(ctx, ptr);
    }

    function loadFigaTree(offset: number, name: string): figatree | null {
        const ptr = HSD_LoadContext__ResolvePtrNullable(ctx, view.getUint32(offset));
        if (!ptr) return null;
        return Kirby_figatree_Load(ctx, ptr, name);
    }

    return {
        movingAnim: loadFigaTree(0x00, "movingAnim"),
        movingMatAnim: loadMatAnim(0x04),
        unk1Anim: loadFigaTree(0x08, "unk1Anim"),
        unk1MatAnim: loadMatAnim(0x0c),
        unk2Anim: loadFigaTree(0x10, "unk2Anim"),
        unk2MatAnim: loadMatAnim(0x14),
        boostAnim: loadFigaTree(0x18, "boostAnim"),
        boostMatAnim: loadMatAnim(0x1c),
        chargeAnim: loadFigaTree(0x20, "chargeAnim"),
        chargeMatAnim: loadMatAnim(0x24),
        stopAnim: loadFigaTree(0x28, "stopAnim"),
        stopMatAnim: loadMatAnim(0x2c),
    } as any as KirbyVehicleAnimationStar;
}

export function Kirby_figatree_Load(ctx: HSD_LoadContext, buffer: ArrayBufferSlice, name: string): figatree {
    const view = buffer.createDataView();

    const type = view.getInt32(0x00);
    assert(type === 0x01);

    const endFrame = view.getFloat32(0x08);

    const nodeTrackCountTableOffs = view.getUint32(0x0C);
    const nodeTrackCountTableBuffer = HSD_LoadContext__ResolvePtr(ctx, nodeTrackCountTableOffs);
    const nodeTrackCountTableView = nodeTrackCountTableBuffer.createDataView();

    const trackTableOffs = view.getUint32(0x10);
    const trackTableBuffer = HSD_LoadContext__ResolvePtr(ctx, trackTableOffs);

    const aobj: HSD_AObj[] = [];

    let trackTableIdx = 0;
    for (let i = 0; ; i++) {
        const nodeTrackCount = nodeTrackCountTableView.getUint8(i);

        // End.
        if (nodeTrackCount === 0xFF)
            break;

        const fobj: HSD_FObj[] = [];
        for (let j = 0; j < nodeTrackCount; j++) {
            fobj.push(Melee_figatree_Track_Load(ctx, trackTableBuffer.subarray(trackTableIdx, 0x0C)));
            trackTableIdx += 0x0C;
        }

        const flags = HSD_AObjFlags.ANIM_LOOP;
        aobj.push({flags, endFrame, fobj, objID: 0});
    }

    return {kind: 'Anim', name, endFrame, aobj};
}

export const machines = [
    "Stars",
    // new KirbyVehicleDesc("VcStar.dat"), // no model
    new KirbyVehicleDesc("VcStarNormal.dat", "Warp Star"),
    new KirbyVehicleDesc("VcStarFlight.dat", "Flight Warp Star"),
    new KirbyVehicleDesc("VcStarLight.dat", "Compact Star"),
    new KirbyVehicleDesc("VcStarWagon.dat", "Wagon Star"),
    new KirbyVehicleDesc("VcStarRuins.dat", "Swerve Star"),
    new KirbyVehicleDesc("VcStarWing.dat", "Winged Star"),
    new KirbyVehicleDesc("VcStarDevil.dat", "Shadow Star"),
    new KirbyVehicleDesc("VcStarHeavy.dat", "Bulk Star"),
    new KirbyVehicleDesc("VcStarRocket.dat", "Rocket Star"),
    new KirbyVehicleDesc("VcStarJet.dat", "Jet Star"),
    new KirbyVehicleDesc("VcStarTurbo.dat", "Turbo Star"),
    new KirbyVehicleDesc("VcStarSlick.dat", "Slick Star"),
    new KirbyVehicleDesc("VcStarFormula.dat", "Formula Star"),
    new KirbyVehicleDesc("VcStarHydra.dat", "Hydra"),
    new KirbyVehicleDesc("VcStarDragoon.dat", "Dragoon"),

    "Wheels",
    // new KirbyVehicleDesc("VcWheel.dat"), // no model
    new KirbyVehicleDesc("VcWheelWheelie.dat", "Wheelie Bike"),
    new KirbyVehicleDesc("VcWheelScooter.dat", "Wheelie Scooter"),
    new KirbyVehicleDesc("VcWheelRex.dat", "Rex Wheelie"),

    new KirbyVehicleDesc("VcWheelDedede.dat", "Dedede's Wheelie"),
    new KirbyVehicleDesc("VcWheelVsDedede.dat", "Dedede's Wheelie (VS. Dedede)"),
    new KirbyVehicleDesc("VcWheelKirby.dat", "Kirby (Wheel Ability)"),
    new KirbyVehicleDesc("VcWheelNormal.dat"),

    "Top Ride",
    new KirbyVehicleDesc("VcStarFree.dat", "Free Star"),
    new KirbyVehicleDesc("VcStarHandle.dat", "Steer Star"),
    // new KirbyVehicleDesc("VcWingKirby.dat"), // looks empty, probably Kirby Wing Ability
    // new KirbyVehicleDesc("VcWingMetaKnight.dat"), // just empty
];