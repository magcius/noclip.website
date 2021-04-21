import * as Viewer from '../viewer';
import * as AVLZ from './AVLZ';
import * as COLI from  './FZEROGX/coliScene';
import * as BG from  './FZEROGX/backGround';

import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { CameraController } from '../Camera';
import { AmusementVisionSceneDesc, AmusementVisionSceneRenderer } from './scenes_AmusementVision';
import { mat4 } from 'gl-matrix';

export class FZEROGXSceneRenderer extends AmusementVisionSceneRenderer {
    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(8/60);
    }
}

const pathBase = `FZEROGX`;
class FZEROGXSceneDesc extends AmusementVisionSceneDesc {

    // Coli Scene
    public createSceneFromColiScene(sceneRender: FZEROGXSceneRenderer, coliscene: COLI.ColiScene, id: string) {
        const modelChace = sceneRender.modelCache;

        // Apper "Course Objects"
        const gameObjects = coliscene.gameObjects
        for (let i = 0; i < gameObjects.length; i++){
            gameObjects[i].collisionBinding.referenceBindings.forEach(collisionBinding => {
                const name = collisionBinding.name;
                if (modelChace.gcmfChace.has(name) == true){
                    // Apper
                    const modelinstance = super.instanceModel(sceneRender, name);
                    const matrix = gameObjects[i].matrix === null ? mat4.create() : gameObjects[i].matrix;
                    modelinstance.modelMatrix = matrix;
                }
            });
        }   
        
        // Apper "Course Map"
        const mapName = `C${id}_MAP`;
        if (modelChace.gcmfChace.has(mapName) == true){
            // Apper
            const map = super.instanceModel(sceneRender, mapName);
        }
        
    }
    
    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const sceneRender = new FZEROGXSceneRenderer(device);
        
        const dataFetcher = context.dataFetcher;

        //load stage Model
        const checkJP = this.id.substring(this.id.length-3);
        const stageID = checkJP === `_jp` ? this.id.substring(0, this.id.length-3) : this.id;
        let prefix = 0;
        const stageModel = await super.loadGMA(dataFetcher, `${pathBase}/stage/st${stageID}`, prefix, AVLZ.AVLZ_Type.FZGX);
        sceneRender.modelCache.registGcmf(device, sceneRender, stageModel, prefix++);

        const stageIdx =  parseInt(stageID);
        const backGroundName = BG.backGroundMap[stageIdx];

        //load stage BackGround Model
        const path = checkJP === `_jp` ? `${pathBase}/jp/bg/bg_${backGroundName}` : `${pathBase}/bg/bg_${backGroundName}`;
        const backGroundModel = await super.loadGMA(dataFetcher, path, prefix, AVLZ.AVLZ_Type.FZGX);
        sceneRender.modelCache.registGcmf(device, sceneRender, backGroundModel, prefix++);
        
        //load race Model
        const commonModel = await super.loadGMA(dataFetcher, `${pathBase}/init/race`, prefix);
        sceneRender.modelCache.registGcmf(device, sceneRender, commonModel, prefix++);
        
        //load COLI_COURSE (named "ColiScene")
        const coliSceneData = await dataFetcher.fetchData(`${pathBase}/stage/COLI_COURSE${stageID}.lz`);
        const colisSceneRawData = AVLZ.decompressLZSS(coliSceneData, AVLZ.AVLZ_Type.FZGX);
        const coliScene = COLI.parse(colisSceneRawData.slice(0x00));
        this.createSceneFromColiScene(sceneRender, coliScene, stageID);

        return sceneRender;
    }
}

const id = 'fzgx';
const name = 'F-ZERO GX';
const sceneDescs = [
    "Rudy Cup",
    new FZEROGXSceneDesc("01", "Mute City - Twist Road"),
    new FZEROGXSceneDesc("16", "Casino Palace - Split Oval"),
    new FZEROGXSceneDesc("26", "Sand Ocean - Surface Slide"), // NBT, Skin Model
    new FZEROGXSceneDesc("08", "Lightning - Loop Cross"),
    new FZEROGXSceneDesc("05", "Aeropolis - Multiplex"),
    new FZEROGXSceneDesc("01_jp", "[JP] Mute City - Twist Road"),
    new FZEROGXSceneDesc("05_jp", "[JP] Aeropolis - Multiplex"),
    "Sapphire Cup",
    new FZEROGXSceneDesc("14", "Big Blue - Drift Highway"),
    new FZEROGXSceneDesc("13", "Port Town - Long Pipe"),
    new FZEROGXSceneDesc("11", "Green Plant - Mobious Ring"), // NBT
    new FZEROGXSceneDesc("07", "Port Town - Aerodive"),
    new FZEROGXSceneDesc("03", "Mute City - Serial Gaps"),
    new FZEROGXSceneDesc("03_jp", "[JP] Mute City - Serial Gaps"),
    "Emerald Cup",
    new FZEROGXSceneDesc("15", "Fire Field - Cylinder Knot"),
    new FZEROGXSceneDesc("10", "Green Plant - Intersection"), // NBT
    new FZEROGXSceneDesc("29", "Casino Palace - Double Branches"),
    new FZEROGXSceneDesc("09", "Lightning - Half-Pipe"),
    new FZEROGXSceneDesc("27", "Big Blue - Ordeal"),
    new FZEROGXSceneDesc("15_jp", "[JP] Fire Field Cylinder Knot"),
    "Diamond Cup",
    new FZEROGXSceneDesc("24", "Cosmo Termial - Trident"),
    new FZEROGXSceneDesc("25", "Sand Ocean - Lateral Shift"), // NBT
    new FZEROGXSceneDesc("17", "Fire Field - Undulation"),
    new FZEROGXSceneDesc("21", "Aeropolis - Dragon Slope"),
    new FZEROGXSceneDesc("28", "Phantom Road - Slim-Line Slits"),
    new FZEROGXSceneDesc("21_jp", "[JP] Aeropolis - Dragon Slope"),
    new FZEROGXSceneDesc("17_jp", "[JP] Fire Field - Undulation"),
    "AX Cup",
    new FZEROGXSceneDesc("31", "Aeropolis - Screw Drive"),
    new FZEROGXSceneDesc("32", "Outer Space - Meteor Stream"), // NBT
    new FZEROGXSceneDesc("33", "Port Town - Cylinder Wave"),
    new FZEROGXSceneDesc("34", "Lightning - Thunder Road"),
    new FZEROGXSceneDesc("35", "Green Plant - Spiral"), //
    new FZEROGXSceneDesc("36", "Mute City - Sonic Oval"),
    new FZEROGXSceneDesc("31_jp", "[JP] Aeropolis - Screw Drive"),
    new FZEROGXSceneDesc("36_jp", "[JP] Mute City - Sonic Oval"),
    "Story Mode",
    new FZEROGXSceneDesc("37", "Chapter 1"),
    new FZEROGXSceneDesc("38", "Chapter 2"), // NBT
    new FZEROGXSceneDesc("39","Chapter 3"),
    new FZEROGXSceneDesc("40", "Chapter 4"),
    new FZEROGXSceneDesc("41", "Chapter 5"),
    new FZEROGXSceneDesc("42", "Chapter 6"),
    new FZEROGXSceneDesc("43", "Chapter 7"), // NBT
    new FZEROGXSceneDesc("44", "Chapter 8"),
    new FZEROGXSceneDesc("45", "Chapter 9"),
    new FZEROGXSceneDesc("37_jp", "[JP] Chapter 1"),
    new FZEROGXSceneDesc("43_jp", "[JP] Chapter 7"),
    "MISC",
    new FZEROGXSceneDesc("49", "Interview"),
    new FZEROGXSceneDesc("50", "Victory Lap"),
    new FZEROGXSceneDesc("50_jp", "[JP] Victory Lap"),
    new AmusementVisionSceneDesc(`${pathBase}/stage/st00`, "st00", AVLZ.AVLZ_Type.FZGX),
    new AmusementVisionSceneDesc(`${pathBase}/init/common`, "Unused Model(Official GMA)"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };