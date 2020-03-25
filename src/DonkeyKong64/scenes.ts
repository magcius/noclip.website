import * as Viewer from '../viewer';
import { GfxDevice, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { SceneRenderer } from '../kh/render';
import { TexMtxProjection } from '../Common/JSYSTEM/J3D/J3DLoader';
//import * as UI from '../ui';
//import * as BYML from '../byml';


//import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
//import { FakeTextureHolder, TextureHolder } from '../TextureHolder';
//import { mat4, vec3, vec4 } from 'gl-matrix';
import { transparentBlackFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, BasicRenderTarget } from '../gfx/helpers/RenderTargetHelpers';
//import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
//import { executeOnPass, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderer';
//import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
//import ArrayBufferSlice from '../ArrayBufferSlice';
//import { assert, hexzero, assertExists, hexdump } from '../util';
//import { DataFetcher } from '../DataFetcher';
//import { MathConstants } from '../MathHelpers';
//import { CameraController } from '../Camera';
import { ROMHandler } from './tools/extractor';

const pathBase = `DonkeyKong64`;

class DK64Renderer implements Viewer.SceneGfx {

    public renderTarget = new BasicRenderTarget();

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void{
        this.renderTarget.destroy(device);
    }
}


class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx>{
        let romHandler = new ROMHandler(context);
        const sceneRenderer = new DK64Renderer();
        return sceneRenderer;
    }

}

// Names taken from ScriptHawk
const id = `dk64`;
const name = "Donkey Kong 64";
const sceneDescs = [
    "Jungle Japes",
    new SceneDesc(`07`, "Jungle Japes"),
    new SceneDesc(`04`, "Mountain"),
    new SceneDesc(`06`, "Minecart"),
    new SceneDesc(`08`, "Army Dillo"),
    new SceneDesc(`0C`, "Shell"),
    new SceneDesc(`0D`, "Lanky's Cave"),
    new SceneDesc(`21`, "Chunky's Cave"),
    new SceneDesc(`25`, "Barrel Blast"),

    "Angry Aztec",
    new SceneDesc(`26`, "Angry Aztec"),
    new SceneDesc(`0E`, "Beetle Race"),
    new SceneDesc(`10`, "Tiny's Temple"),
    new SceneDesc(`13`, "Five Door Temple (DK)"),
    new SceneDesc(`14`, "Llama Temple"),
    new SceneDesc(`15`, "Five Door Temple (Diddy)"),
    new SceneDesc(`16`, "Five Door Temple (Tiny)"),
    new SceneDesc(`17`, "Five Door Temple (Lanky)"),
    new SceneDesc(`18`, "Five Door Temple (Chunky)"),
    new SceneDesc(`29`, "Barrel Blast"),
    new SceneDesc(`C5`, "Dogadon"),

    "Frantic Factory",
    new SceneDesc(`1A`, "Frantic Factory"),
    new SceneDesc(`1B`, "Car Race"),
    new SceneDesc(`1D`, "Power Shed"),
    new SceneDesc(`24`, "Crusher Room"),
    new SceneDesc(`6E`, "Barrel Blast"),
    new SceneDesc(`9A`, "Mad Jack"),

    "Gloomy Galleon",
    new SceneDesc(`1E`, "Gloomy Galleon"),
    new SceneDesc(`1F`, "K. Rool's Ship"),
    new SceneDesc(`27`, "Seal Race"),
    new SceneDesc(`2B`, "Shipwreck (Diddy, Lanky, Chunky)"),
    new SceneDesc(`2C`, "Treasure Chest"),
    new SceneDesc(`2D`, "Mermaid"),
    new SceneDesc(`2E`, "Shipwreck (DK, Tiny)"),
    new SceneDesc(`2F`, "Shipwreck (Lanky, Tiny)"),
    new SceneDesc(`31`, "Lighthouse"),
    new SceneDesc(`33`, "Mechanical Fish"),
    new SceneDesc(`36`, "Barrel Blast"),
    new SceneDesc(`6F`, "Pufftoss"),
    new SceneDesc(`B3`, "Submarine"),

    "Fungi Forest",
    new SceneDesc(`30`, "Fungi Forest"),
    new SceneDesc(`34`, "Ant Hill"),
    new SceneDesc(`37`, "Minecart"),
    new SceneDesc(`38`, "Diddy's Barn"),
    new SceneDesc(`39`, "Diddy's Attic"),
    new SceneDesc(`3A`, "Lanky's Attic"),
    new SceneDesc(`3B`, "DK's Barn"),
    new SceneDesc(`3C`, "Spider"),
    new SceneDesc(`3D`, "Front Part of Mill"),
    new SceneDesc(`3E`, "Rear Part of Mill"),
    new SceneDesc(`3F`, "Mushroom Puzzle"),
    new SceneDesc(`40`, "Giant Mushroom"),
    new SceneDesc(`46`, "Mushroom Leap"),
    new SceneDesc(`47`, "Shooting Game"),
    new SceneDesc(`53`, "Dogadon"),
    new SceneDesc(`BC`, "Barrel Blast"),

    "Crystal Caves",
    new SceneDesc(`48`, "Crystal Caves"),
    new SceneDesc(`52`, "Beetle Race"),
    new SceneDesc(`54`, "Igloo (Tiny)"),
    new SceneDesc(`55`, "Igloo (Lanky)"),
    new SceneDesc(`56`, "Igloo (DK)"),
    new SceneDesc(`59`, "Rotating Room"),
    new SceneDesc(`5A`, "Shack (Chunky)"),
    new SceneDesc(`5B`, "Shack (DK)"),
    new SceneDesc(`5C`, "Shack (Diddy, middle part)"),
    new SceneDesc(`5D`, "Shack (Tiny)"),
    new SceneDesc(`5E`, "Lanky's Hut"),
    new SceneDesc(`5F`, "Igloo (Chunky)"),
    new SceneDesc(`62`, "Ice Castle"),
    new SceneDesc(`64`, "Igloo (Diddy)"),
    new SceneDesc(`BA`, "Barrel Blast"),
    new SceneDesc(`C4`, "Army Dillo"),
    new SceneDesc(`C8`, "Shack (Diddy, upper part)"),

    "Creepy Castle",
    new SceneDesc(`57`, "Creepy Castle"),
    new SceneDesc(`58`, "Ballroom"),
    new SceneDesc(`69`, "Tower"),
    new SceneDesc(`6A`, "Minecart"),
    new SceneDesc(`6C`, "Crypt (Lanky, Tiny)"),
    new SceneDesc(`70`, "Crypt (DK, Diddy, Chunky)"),
    new SceneDesc(`71`, "Museum"),
    new SceneDesc(`72`, "Library"),
    new SceneDesc(`97`, "Dungeon"),
    new SceneDesc(`A3`, "Basement"),
    new SceneDesc(`A4`, "Tree"),
    new SceneDesc(`A6`, "Chunky's Toolshed"),
    new SceneDesc(`A7`, "Trash Can"),
    new SceneDesc(`A8`, "Greenhouse"),
    new SceneDesc(`B7`, "Crypt"),
    new SceneDesc(`B9`, "Car Race"),
    new SceneDesc(`BB`, "Barrel Blast"),
    new SceneDesc(`C7`, "King Kut Out"),

    "Hideout Helm",
    new SceneDesc(`11`, "Hideout Helm"),
    new SceneDesc(`03`, "K. Rool Barrel: Lanky's Maze"),
    new SceneDesc(`23`, "K. Rool Barrel: DK's Target Game"),
    new SceneDesc(`32`, "K. Rool Barrel: Tiny's Mushroom Game"),
    new SceneDesc(`A5`, "K. Rool Barrel: Diddy's Kremling Game"),
    new SceneDesc(`C9`, "K. Rool Barrel: Diddy's Rocketbarrel Game"),
    new SceneDesc(`CA`, "K. Rool Barrel: Lanky's Shooting Game"),
    new SceneDesc(`D1`, "K. Rool Barrel: Chunky's Hidden Kremling Game"),
    new SceneDesc(`D2`, "K. Rool Barrel: Tiny's Pony Tail Twirl Game"),
    new SceneDesc(`D3`, "K. Rool Barrel: Chunky's Shooting Game"),
    new SceneDesc(`D4`, "K. Rool Barrel: DK's Rambi Game"),

    "DK Isles",
    new SceneDesc(`22`, "DK Isles Overworld"),
    new SceneDesc(`61`, "K. Lumsy"),
    new SceneDesc(`A9`, "Jungle Japes Lobby"),
    new SceneDesc(`AA`, "Hideout Helm Lobby"),
    new SceneDesc(`AB`, "DK's House"),
    new SceneDesc(`AD`, "Angry Aztec Lobby"),
    new SceneDesc(`AE`, "Gloomy Galleon Lobby"),
    new SceneDesc(`AF`, "Frantic Factory Lobby"),
    new SceneDesc(`B0`, "Training Grounds"),
    new SceneDesc(`B1`, "Dive Barrel"),
    new SceneDesc(`B4`, "Orange Barrel"),
    new SceneDesc(`B5`, "Barrel Barrel"),
    new SceneDesc(`B6`, "Vine Barrel"),
    new SceneDesc(`B2`, "Fungi Forest Lobby"),
    new SceneDesc(`BD`, "Fairy Island"),
    new SceneDesc(`C1`, "Creepy Castle Lobby"),
    new SceneDesc(`C2`, "Crystal Caves Lobby"),
    new SceneDesc(`C3`, "DK Isles: Snide's Room"),

    "K. Rool",
    new SceneDesc(`CB`, "DK Phase"),
    new SceneDesc(`CC`, "Diddy Phase"),
    new SceneDesc(`CD`, "Lanky Phase"),
    new SceneDesc(`CE`, "Tiny Phase"),
    new SceneDesc(`CF`, "Chunky Phase"),
    new SceneDesc(`D6`, "K. Rool's Shoe"),
    new SceneDesc(`D7`, "K. Rool's Arena"),

    "Cutscene",
    new SceneDesc(`1C`, "Hideout Helm (Level Intros, Game Over)"),
    new SceneDesc(`28`, "Nintendo Logo"),
    new SceneDesc(`4C`, "DK Rap"),
    new SceneDesc(`51`, "Title Screen (Not For Resale Version)"),
    new SceneDesc(`98`, "Hideout Helm (Intro Story)"),
    new SceneDesc(`99`, "DK Isles (DK Theatre)"),
    new SceneDesc(`AC`, "Rock (Intro Story)"),
    new SceneDesc(`C6`, "Training Grounds (End Sequence)"),
    new SceneDesc(`D0`, "Bloopers Ending"),
    new SceneDesc(`D5`, "K. Lumsy Ending"),

    "Bonus Barrels",
    new SceneDesc(`0A`, "Kremling Kosh! (very easy)"),
    new SceneDesc(`0B`, "Stealthy Snoop! (normal, no logo)"),
    new SceneDesc(`12`, "Teetering Turtle Trouble! (very easy)"),
    new SceneDesc(`20`, "Batty Barrel Bandit! (easy)"),
    new SceneDesc(`41`, "Stealthy Snoop! (normal)"),
    new SceneDesc(`42`, "Mad Maze Maul! (hard)"),
    new SceneDesc(`43`, "Stash Snatch! (normal)"),
    new SceneDesc(`44`, "Mad Maze Maul! (easy)"),
    new SceneDesc(`45`, "Mad Maze Maul! (normal)"),
    new SceneDesc(`4A`, "Stash Snatch! (easy)"),
    new SceneDesc(`4B`, "Stash Snatch! (hard)"),
    new SceneDesc(`4D`, "Minecart Mayhem! (easy)"),
    new SceneDesc(`4E`, "Busy Barrel Barrage! (easy)"),
    new SceneDesc(`4F`, "Busy Barrel Barrage! (normal)"),
    new SceneDesc(`60`, "Splish-Splash Salvage! (normal)"),
    new SceneDesc(`63`, "Speedy Swing Sortie! (easy)"),
    new SceneDesc(`65`, "Krazy Kong Klamour! (easy)"),
    new SceneDesc(`66`, "Big Bug Bash! (very easy)"),
    new SceneDesc(`67`, "Searchlight Seek! (very easy)"),
    new SceneDesc(`68`, "Beaver Bother! (easy)"),
    new SceneDesc(`73`, "Kremling Kosh! (easy)"),
    new SceneDesc(`74`, "Kremling Kosh! (normal)"),
    new SceneDesc(`75`, "Kremling Kosh! (hard)"),
    new SceneDesc(`76`, "Teetering Turtle Trouble! (easy)"),
    new SceneDesc(`77`, "Teetering Turtle Trouble! (normal)"),
    new SceneDesc(`78`, "Teetering Turtle Trouble! (hard)"),
    new SceneDesc(`79`, "Batty Barrel Bandit! (easy)"),
    new SceneDesc(`7A`, "Batty Barrel Bandit! (normal)"),
    new SceneDesc(`7B`, "Batty Barrel Bandit! (hard)"),
    new SceneDesc(`7C`, "Mad Maze Maul! (insane)"),
    new SceneDesc(`7D`, "Stash Snatch! (insane)"),
    new SceneDesc(`7E`, "Stealthy Snoop! (very easy)"),
    new SceneDesc(`7F`, "Stealthy Snoop! (easy)"),
    new SceneDesc(`80`, "Stealthy Snoop! (hard)"),
    new SceneDesc(`81`, "Minecart Mayhem! (normal)"),
    new SceneDesc(`82`, "Minecart Mayhem! (hard)"),
    new SceneDesc(`83`, "Busy Barrel Barrage! (hard)"),
    new SceneDesc(`84`, "Splish-Splash Salvage! (hard)"),
    new SceneDesc(`85`, "Splish-Splash Salvage! (easy)"),
    new SceneDesc(`86`, "Speedy Swing Sortie! (normal)"),
    new SceneDesc(`87`, "Speedy Swing Sortie! (hard)"),
    new SceneDesc(`88`, "Beaver Bother! (normal)"),
    new SceneDesc(`89`, "Beaver Bother! (hard)"),
    new SceneDesc(`8A`, "Searchlight Seek! (easy)"),
    new SceneDesc(`8B`, "Searchlight Seek! (normal)"),
    new SceneDesc(`8C`, "Searchlight Seek! (hard)"),
    new SceneDesc(`8D`, "Krazy Kong Klamour! (normal)"),
    new SceneDesc(`8E`, "Krazy Kong Klamour! (hard)"),
    new SceneDesc(`8F`, "Krazy Kong Klamour! (insane)"),
    new SceneDesc(`90`, "Peril Path Panic! (very easy)"),
    new SceneDesc(`91`, "Peril Path Panic! (easy)"),
    new SceneDesc(`92`, "Peril Path Panic! (normal)"),
    new SceneDesc(`93`, "Peril Path Panic! (hard)"),
    new SceneDesc(`94`, "Big Bug Bash! (easy)"),
    new SceneDesc(`95`, "Big Bug Bash! (normal)"),
    new SceneDesc(`96`, "Big Bug Bash! (hard)"),

    "Battle Arenas",
    new SceneDesc(`35`, "Beaver Brawl!"),
    new SceneDesc(`49`, "Kritter Karnage!"),
    new SceneDesc(`9B`, "Arena Ambush!"),
    new SceneDesc(`9C`, "More Kritter Karnage!"),
    new SceneDesc(`9D`, "Forest Fracas!"),
    new SceneDesc(`9E`, "Bish Bash Brawl!"),
    new SceneDesc(`9F`, "Kamikaze Kremlings!"),
    new SceneDesc(`A0`, "Plinth Panic!"),
    new SceneDesc(`A1`, "Pinnacle Palaver!"),
    new SceneDesc(`A2`, "Shockwave Showdown!"),

    "Kong Battle",
    new SceneDesc(`6B`, "Battle Arena"),
    new SceneDesc(`6D`, "Arena 1"),
    new SceneDesc(`BE`, "Arena 2"),
    new SceneDesc(`C0`, "Arena 3"),

    "Other",
    new SceneDesc(`00`, "Test Map"),
    new SceneDesc(`01`, "Funky's Store"),
    new SceneDesc(`02`, "DK Arcade"),
    new SceneDesc(`05`, "Cranky's Lab"),
    new SceneDesc(`09`, "Jetpac"),
    new SceneDesc(`0F`, "Snide's H.Q."),
    new SceneDesc(`19`, "Candy's Music Shop"),
    new SceneDesc(`2A`, "Troff 'n' Scoff"),
    new SceneDesc(`50`, "Main Menu"),
    new SceneDesc(`B8`, "Enguarde Arena"),
    new SceneDesc(`BF`, "Rambi Arena"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };