
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { SceneContext } from '../SceneBase.js';
import * as Viewer from '../viewer.js';

export class SMG1SceneDesc implements Viewer.SceneDesc {
    public id: string;
    public pathBase: string;

    constructor(public name: string, public galaxyName: string, public scenarioOverride: number | null = null, id: string | null = null) {
        if (id !== null) {
            this.id = id;
        } else {
            if (this.scenarioOverride !== null)
                this.id = `${this.galaxyName}${this.scenarioOverride}`;
            else
                this.id = this.galaxyName;
        }
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<Viewer.SceneGfx> {
        const main = await import("./Main");
        const loader = new main.SMG1SceneLoader(this);
        return await loader.createScene(device, sceneContext);
    }
}

const id = "smg";
const name = "Super Mario Galaxy";

const sceneDescs = [
    "Observatory",
    new SMG1SceneDesc("Comet Observatory", "AstroGalaxy"),
    new SMG1SceneDesc("Library", "LibraryRoom"),
    new SMG1SceneDesc("Peach's Castle Gardens", "PeachCastleGardenGalaxy"),
    new SMG1SceneDesc("Gateway Galaxy", "HeavensDoorGalaxy"),
    new SMG1SceneDesc("Boo's Boneyard Galaxy", "TeresaMario2DGalaxy"),
    "Terrace",
    new SMG1SceneDesc("Terrace", "AstroDome", 0),
    new SMG1SceneDesc("Good Egg Galaxy", "EggStarGalaxy"),
    new SMG1SceneDesc("Honeyhive Galaxy", "HoneyBeeKingdomGalaxy"),
    new SMG1SceneDesc("Loopdeeloop Galaxy", "SurfingLv1Galaxy"),
    new SMG1SceneDesc("Flipswitch Galaxy", "FlipPanelExGalaxy"),
    new SMG1SceneDesc("Sweet Sweet Galaxy", "BeltConveyerExGalaxy"),
    new SMG1SceneDesc("Bowser Jr.'s Robot Reactor", "TriLegLv1Galaxy"),
    "Fountain",
    new SMG1SceneDesc("Fountain", "AstroDome", 1),
    new SMG1SceneDesc("Space Junk Galaxy", "StarDustGalaxy"),
    new SMG1SceneDesc("Battlerock Galaxy", "BattleShipGalaxy"),
    new SMG1SceneDesc("Rolling Green Galaxy", "TamakoroExLv1Galaxy"),
    new SMG1SceneDesc("Hurry-Scurry Galaxy", "BreakDownPlanetGalaxy"),
    new SMG1SceneDesc("Sling Pod Galaxy", "CocoonExGalaxy"),
    new SMG1SceneDesc("Bowser's Star Reactor", "KoopaBattleVs1Galaxy"),
    "Kitchen",
    new SMG1SceneDesc("Kitchen", "AstroDome", 2),
    new SMG1SceneDesc("Beach Bowl Galaxy", "HeavenlyBeachGalaxy"),
    new SMG1SceneDesc("Ghostly Galaxy", "PhantomGalaxy"),
    new SMG1SceneDesc("Bubble Breeze Galaxy", "CubeBubbleExLv1Galaxy"),
    new SMG1SceneDesc("Buoy Base Galaxy", "OceanFloaterLandGalaxy"),
    new SMG1SceneDesc("Drip Drop Galaxy", "TearDropGalaxy"),
    new SMG1SceneDesc("Bowser Jr.'s Airship Armada", "KoopaJrShipLv1Galaxy"),
    "Bedroom",
    new SMG1SceneDesc("Bedroom", "AstroDome", 3),
    new SMG1SceneDesc("Gusty Garden Galaxy", "CosmosGardenGalaxy"),
    new SMG1SceneDesc("Freezeflame Galaxy", "IceVolcanoGalaxy"),
    new SMG1SceneDesc("Dusty Dune Galaxy", "SandClockGalaxy"),
    new SMG1SceneDesc("Honeyclimb Galaxy", "HoneyBeeExGalaxy"),
    new SMG1SceneDesc("Bigmouth Galaxy", "FishTunnelGalaxy"),
    new SMG1SceneDesc("Bowser's Dark Matter Plant", "KoopaBattleVs2Galaxy"),
    "Engine Room",
    new SMG1SceneDesc("Engine Room", "AstroDome", 4),
    new SMG1SceneDesc("Gold Leaf Galaxy", "ReverseKingdomGalaxy"),
    new SMG1SceneDesc("Sea Slide Galaxy", "OceanRingGalaxy"),
    new SMG1SceneDesc("Toy Time Galaxy", "FactoryGalaxy"),
    new SMG1SceneDesc("Bonefin Galaxy", "SkullSharkGalaxy"),
    new SMG1SceneDesc("Sand Spiral Galaxy", "TransformationExGalaxy"),
    new SMG1SceneDesc("Bowser Jr.'s Lava Reactor", "FloaterOtaKingGalaxy"),
    "Garden",
    new SMG1SceneDesc("Garden", "AstroDome", 5),
    new SMG1SceneDesc("Deep Dark Galaxy", "OceanPhantomCaveGalaxy"),
    new SMG1SceneDesc("Dreadnought Galaxy", "CannonFleetGalaxy"),
    new SMG1SceneDesc("Melty Molten Galaxy", "HellProminenceGalaxy"),
    new SMG1SceneDesc("Matter Splatter Galaxy", "DarkRoomGalaxy"),
    new SMG1SceneDesc("Snow Cap Galaxy", "SnowCapsuleGalaxy"),
    "Center of the Universe",
    new SMG1SceneDesc("Bowser's Galaxy Reactor", "KoopaBattleVs3Galaxy"),
    "Planet of Trials",
    new SMG1SceneDesc("Rolling Gizmo Galaxy", "TamakoroExLv2Galaxy"),
    new SMG1SceneDesc("Bubble Blast Galaxy", "CubeBubbleExLv2Galaxy"),
    new SMG1SceneDesc("Loopdeeswoop Galaxy", "SurfingLv2Galaxy"),
    new SMG1SceneDesc("Grand Finale Galaxy", "PeachCastleFinalGalaxy"),
    "?",
    new SMG1SceneDesc("Day in the Life of a Luma", "AstroGalaxy", null, "DayInTheLifeOfALuma"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
