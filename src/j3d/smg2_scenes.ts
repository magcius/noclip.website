
import * as Viewer from '../viewer';
import { SMGSceneDescBase } from "./smg_scenes";

class SMG2SceneDesc extends SMGSceneDescBase {
    protected pathBase: string = `j3d/smg2`;
    protected getZoneMapFilename(zoneName: string): string {
        return `${this.pathBase}/StageData/${zoneName}/${zoneName}Map.arc`;
    }
}

const id = "smg2";
const name = "Super Mario Galaxy 2";

const sceneDescs: Viewer.SceneDesc[] = [
    "Other Maps",
    new SMG2SceneDesc("Mushroom Kingdom", "PeachCastleGalaxy"),
    new SMG2SceneDesc("Mario's Faceship", "MarioFaceShipGalaxy"),
    new SMG2SceneDesc("Credits", "StaffRollGalaxy"),
    new SMG2SceneDesc("Library", "ChildRoomGalaxy"),
    "World One",
    new SMG2SceneDesc("World One Map", "WorldMap01Galaxy"),
    new SMG2SceneDesc("Sky Station Galaxy", "IslandFleetGalaxy"),
    new SMG2SceneDesc("Yoshi Star Galaxy", "YosshiHomeGalaxy"),
    new SMG2SceneDesc("Spin-Dig Galaxy", "DigMineGalaxy"),
    new SMG2SceneDesc("Fluffy Bluff Galaxy", "MokumokuValleyGalaxy"),
    new SMG2SceneDesc("Flip-Swap Galaxy", "RedBlueExGalaxy"),
    new SMG2SceneDesc("Rightside-Down Galaxy", "AbekobeGalaxy"),
    new SMG2SceneDesc("Bowser Jr.'s Fiery Flotilla", "VsKoopaJrLv1Galaxy"),
    "World Two",
    new SMG2SceneDesc("World Two Map", "WorldMap02Galaxy"),
    new SMG2SceneDesc("Puzzle Plank Galaxy", "HomeCenterGalaxy"),
    new SMG2SceneDesc("Hightail Falls Galaxy", "BigWaterFallGalaxy"),
    new SMG2SceneDesc("Boulder Bowl Galaxy", "GoroRockGalaxy"),
    new SMG2SceneDesc("Cosmic Cove Galaxy", "StarCreekGalaxy"),
    new SMG2SceneDesc("Wild Glide Galaxy", "JungleGliderGalaxy"),
    new SMG2SceneDesc("Honeybloom Galaxy", "FlowerHighlandGalaxy"),
    new SMG2SceneDesc("Bowser's Lava Lair", "VsKoopaLv1Galaxy"),
    "World Three",
    new SMG2SceneDesc("World Three Map", "WorldMap03Galaxy"),
    new SMG2SceneDesc("Tall Trunk Galaxy", "BigTree2Galaxy"),
    new SMG2SceneDesc("Cloudy Court Galaxy", "CloudGardenGalaxy"),
    new SMG2SceneDesc("Haunty Halls Galaxy", "GhostConveyorGalaxy"),
    new SMG2SceneDesc("Freezy Flake Galaxy", "WhiteSnowGalaxy"),
    new SMG2SceneDesc("Rolling Masterpiece Galaxy", "TamakoroPlanetGalaxy"),
    new SMG2SceneDesc("Beat Block Galaxy", "TimerSwitchingPlatformGalaxy"),
    new SMG2SceneDesc("Bowser Jr.'s Fearsome Fleet", "KoopaJrLv2Galaxy"),
    "World Four",
    new SMG2SceneDesc("World Four Map", "WorldMap04Galaxy"),
    new SMG2SceneDesc("Supermassive Galaxy", "BigGalaxy"),
    new SMG2SceneDesc("Flipsville Galaxy", "OmoteuLandGalaxy"),
    new SMG2SceneDesc("Starshine Beach Galaxy", "TropicalResortGalaxy"),
    new SMG2SceneDesc("Chompworks Galaxy", "WanwanFactoryGalaxy"),
    new SMG2SceneDesc("Sweet Mystery Galaxy", "MysteryCandyGalaxy"),
    new SMG2SceneDesc("Honeyhop Galaxy", "HoneyBeeVillageGalaxy"),
    new SMG2SceneDesc("Bowser's Gravity Gauntlet", "VsKoopaGravityGalaxy"),
    "World Five",
    new SMG2SceneDesc("World Five Map", "WorldMap05Galaxy"),
    new SMG2SceneDesc("Space Storm Galaxy", "ThunderFleetGalaxy"),
    new SMG2SceneDesc("Slipsand Galaxy", "QuicksandGalaxy"),
    new SMG2SceneDesc("Shiverburn Galaxy", "KachikochiLavaGalaxy"),
    new SMG2SceneDesc("Boo Moon Galaxy", "TeresaLabyrinthGalaxy"),
    new SMG2SceneDesc("Upside Dizzy Galaxy", "ChaosGravityGalaxy"),
    new SMG2SceneDesc("Fleet Glide Galaxy", "ChallengeGliderGalaxy"),
    new SMG2SceneDesc("Bowser Jr.'s Boom Bunker", "VsKoopaJrLv3Galaxy"),
    "World Six",
    new SMG2SceneDesc("World Six Map", "WorldMap06Galaxy"),
    new SMG2SceneDesc("Melty Monster Galaxy", "TwisterTowerGalaxy"),
    new SMG2SceneDesc("Clockwork Ruins Galaxy", "AncientExcavationGalaxy"),
    new SMG2SceneDesc("Throwback Galaxy", "LongForCastleGalaxy"),
    new SMG2SceneDesc("Battle Belt Galaxy", "MagicGalaxy"),
    new SMG2SceneDesc("Flash Black Galaxy", "MemoryRoadGalaxy"),
    new SMG2SceneDesc("Slimy Spring Galaxy", "UnderGroundDangeonGalaxy"),
    new SMG2SceneDesc("Bowser's Galaxy Generator", "VsKoopaLv3Galaxy"),
    "World S",
    new SMG2SceneDesc("World S Map", "WorldMap07Galaxy"),
    new SMG2SceneDesc("Mario Squared Galaxy", "MarioOnMarioGalaxy"),
    new SMG2SceneDesc("Rolling Coaster Galaxy", "TamakoroSliderGalaxy"),
    new SMG2SceneDesc("Twisty Trials Galaxy", "SecretAthleticGalaxy"),
    new SMG2SceneDesc("Stone Cyclone Galaxy", "MadnessOnimasuGalaxy"),
    new SMG2SceneDesc("Flip-Out Galaxy", "SwitchMoveBlockGalaxy"),
    new SMG2SceneDesc("Grandmaster Galaxy", "DimensionBigCastleGalaxy"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
