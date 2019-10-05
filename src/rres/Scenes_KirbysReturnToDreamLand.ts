
// Kirby's Return to Dreamland

import * as Viewer from '../viewer';
import * as BRRES from './brres';
import * as CX from '../Common/Compression/CX';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { BasicRRESRenderer } from './scenes';
import { SceneContext } from '../SceneBase';

class RTDLSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;

        return dataFetcher.fetchData(`rtdl/${this.id}.brres`).then((buffer: ArrayBufferSlice) => {
            return CX.decompress(buffer);
        }).then((buffer: ArrayBufferSlice): Viewer.SceneGfx => {
            const courseRRES = BRRES.parse(buffer);
            return new BasicRRESRenderer(device, [courseRRES]);
        });
    }
}

// Stages added/named/organized by Matthew @TanukiMatthew <3
const id = 'rtdl';
const name = "Kirby's Return to Dreamland";
const sceneDescs = [
    "World Maps",
    new RTDLSceneDesc('popstarBg', "Planet Popstar"),
    new RTDLSceneDesc('halcandoraBg', "Halcandra"),
    "Level Maps",
    new RTDLSceneDesc('levelmap1Bg', "Level 1 Map"),
    new RTDLSceneDesc('levelmap2Bg', "Level 2 Map"),
    new RTDLSceneDesc('levelmap3Bg', "Level 3 Map"),
    new RTDLSceneDesc('levelmap4Bg', "Level 4 Map"),
    new RTDLSceneDesc('levelmap5Bg', "Level 5 Map"),
    new RTDLSceneDesc('levelmap6Bg', "Level 6 Map"),
    new RTDLSceneDesc('levelmap7Bg', "Level 7 Map"),
    "Cookie Country",
    new RTDLSceneDesc('grassBg', "Grass Field"),    
    new RTDLSceneDesc('popstarstageBg', "Grass Field (Short Lor Version)"),
    new RTDLSceneDesc('caveBg', "Cave 1"),
    new RTDLSceneDesc('cavenormalBg', "Cave 2"),   
    new RTDLSceneDesc('logBg', "Whispy Woods"),
    "Raisin Road",
    new RTDLSceneDesc('desertBg', "Desert"),
    new RTDLSceneDesc('oasisBg', "Oasis"),
    new RTDLSceneDesc('pyramidBg', "Pyramid"),
    "Onion Ocean",
    new RTDLSceneDesc('gckbeachBg', "Beach"),
    new RTDLSceneDesc('seaBg', "Sea Floor"),
    new RTDLSceneDesc('seatempleBg', "Sea Temple 1"),
    new RTDLSceneDesc('seatemple2Bg', "Sea Temple 2"),
    "White Wafers",
    new RTDLSceneDesc('snowBg', "Snow Field"),
    new RTDLSceneDesc('gcksnowmtBg', "Snow Mountain"),
    new RTDLSceneDesc('icebldgBg', "Ice Field"),
    new RTDLSceneDesc('icecaveBg', "Ice Cave"),
    "Nutty Noon",
    new RTDLSceneDesc('airislandBg', "Daytime Tower"),
    new RTDLSceneDesc('airfortBg', "Sunset Tower"),
    new RTDLSceneDesc('airtempleBg', "Space Tower"),
    "Egg Engines",
    new RTDLSceneDesc('bridgeBg', "Bridge"),
    new RTDLSceneDesc('factoryBg', "Factory"),
    new RTDLSceneDesc('subwayBg', "Subway"),
    "Dangerous Dinner",
    new RTDLSceneDesc('lavaBg', "Lava Cave"),
    new RTDLSceneDesc('volcanoBg', "Volcano"),
    new RTDLSceneDesc('landiaBg', "Landia Battle"),
    new RTDLSceneDesc('halcandraBg', "Halcandra Stage"),
    "Ability Challenge Backdrops",
    new RTDLSceneDesc('challenge1Bg', "Challenge 1"),
    new RTDLSceneDesc('challenge2Bg', "Challenge 2"),
    new RTDLSceneDesc('challenge3Bg', "Challenge 3"),
    new RTDLSceneDesc('challenge4Bg', "Challenge 4"),
    new RTDLSceneDesc('challenge5Bg', "Challenge 5"),
    new RTDLSceneDesc('challenge6Bg', "Challenge 6"),
    new RTDLSceneDesc('challenge7Bg', "Challenge 7"),
    "Another Dimension",
    new RTDLSceneDesc('lowper2Bg', "Another Dimension"),    
    new RTDLSceneDesc('shootingBg', "Lor Starcutter Shooter"),
    new RTDLSceneDesc('finalBg', "Final Battle"),
    "Arena",
    new RTDLSceneDesc('gckcanyonBg', "Boss Rush Canyon"),
    new RTDLSceneDesc('gckcanyon2Bg', "True Arena Rest Point 1"),
    new RTDLSceneDesc('lowperBg', "True Arena Rest Point 2"),    
    new RTDLSceneDesc('sunBg', "Galacta Knight Battle"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
