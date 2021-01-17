import { mat4, vec3 } from "gl-matrix";
import * as BRRES from "../rres/brres";
import AnimationController from "../AnimationController";
import { GfxDevice, GfxHostAccessPass } from "../gfx/platform/GfxPlatform";
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate } from "../gx/gx_render";
import { EggLightManager } from "../rres/Egg";
import { MDL0ModelInstance, RRESTextureHolder } from "../rres/render";
import { SceneContext } from "../SceneBase";
import * as Viewer from "../viewer";
import { PMP, PMPObject } from "./PMP";
import { ResourceSystem } from "./ResouceSystem";
import { assert, assertExists } from "../util";
import { colorNewFromRGBA } from "../Color";

class WiiSportsRenderer extends BasicGXRendererHelper {
    public animationController = new AnimationController();
    public modelInstances: MDL0ModelInstance[] = [];
    public textureHolder = new RRESTextureHolder();
    public scn0Animator: BRRES.SCN0Animator | null = null;
    public lightSetting: BRRES.LightSetting = new BRRES.LightSetting();
    //public eggLightManager: EggLightManager;
    //public pmpObjects: PMPObject[] = [];
    //public debugObjects = false;

    constructor(device: GfxDevice, private resourceSystem: ResourceSystem) {
        super(device);
    }

    public loadSCN0(scn0: BRRES.SCN0): void {
        this.scn0Animator = new BRRES.SCN0Animator(this.animationController, scn0);
    }


    public mountRRES(device: GfxDevice, rresName: string): BRRES.RRES {
        return this.resourceSystem.mountRRES(device, this.textureHolder, rresName);
    }
    public spawnModel(device: GfxDevice, rres: BRRES.RRES, modelName: string): MDL0ModelInstance {
        const mdl0Data = this.resourceSystem.mountMDL0(device, this.getCache(), rres, modelName);
        const instance = new MDL0ModelInstance(this.textureHolder, mdl0Data);
        //instance.bindRRESAnimations(this.animationController, rres);
        //instance.bindLightSetting(this.eggLightManager.lightSetting);
        this.modelInstances.push(instance);

        return instance;
    }

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        if (this.scn0Animator !== null) {
            this.scn0Animator.calcCameraClipPlanes(viewerInput.camera, 0);
            this.scn0Animator.calcLightSetting(this.lightSetting);
        }

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.textureHolder.destroy(device);
        this.resourceSystem.destroy(device);

        for (let i = 0; i < this.modelInstances.length; i++) {
            this.modelInstances[i].destroy(device);
        }
    }
}

class TennisSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const d = context.dataFetcher;

        const tennisName = `tns_Field_${this.id}`;

        const resourceSystem = new ResourceSystem();

        await resourceSystem.fetchAndMount(d, [
            `${dataPath}/Common/RPTnsScene/common.carc`,
            `${dataPath}/Stage/RPTnsScene/${tennisName}.carc`
        ]);

        const renderer = new WiiSportsRenderer(device, resourceSystem);
        
        // Load main model
        const fieldBRRES = renderer.mountRRES(device, `G3D/${tennisName}.brres`);
        renderer.spawnModel(device, fieldBRRES, tennisName);

        // Load net
        const netBRRES = renderer.mountRRES(device, `G3D/tns_net_a.brres`);
        renderer.spawnModel(device, netBRRES, 'tns_net_a');

        return renderer;
    }
}

class BaseballSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const d = context.dataFetcher;

        const resourceSystem = new ResourceSystem();

        await resourceSystem.fetchAndMount(d, [
            `${dataPath}/Common/RPBsbScene/common.carc`,
            `${dataPath}/Stage/RPBsbScene/ballpark00.carc`
        ]);

        const renderer = new WiiSportsRenderer(device, resourceSystem);
        
        // Load main model
        const fieldBRRES = renderer.mountRRES(device, `G3D/bbl_Field_a.brres`);
        renderer.spawnModel(device, fieldBRRES, "bbl_Field_a");
        
        // Load screen
        const screenBRRES = renderer.mountRRES(device, `G3D/bbl_Field_Screen.brres`);
        renderer.spawnModel(device, screenBRRES, "bbl_Field_Screen");

        return renderer;
    }
}

class BowlingSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const d = context.dataFetcher;

        const resourceSystem = new ResourceSystem();

        await resourceSystem.fetchAndMount(d, [
            `${dataPath}/Common/RPBowScene/common.carc`
        ]);

        const renderer = new WiiSportsRenderer(device, resourceSystem);
        
        // Load main model
        const stageBRRES = renderer.mountRRES(device, `G3D/${this.id}.brres`);

        for (let mdl0 of stageBRRES.mdl0) {
            renderer.spawnModel(device, stageBRRES, mdl0.name);
        }

        return renderer;
    }
}

class GolfSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id) {}

    private spawnObject(object: PMPObject, device: GfxDevice, renderer: WiiSportsRenderer): void {
        switch (object.objectId) {
            case 0x00010000: {
                // Start position
                break;
            }
            case 0x00010001: {
                // Golf hole
                const brres = renderer.mountRRES(device, 'G3D/glf_pin1.brres');
                const instance = renderer.spawnModel(device, brres, 'glf_pin1');
                mat4.copy(instance.modelMatrix, object.modelMatrix);                
                break;
            }
            case 0x00010002: {
                // Tree 1
                const brres = renderer.mountRRES(device, 'G3D/glf_tree1.brres');
                const instance = renderer.spawnModel(device, brres, 'glf_tree1');
                //const instanceShadow = renderer.spawnModel(device, brres, 'glf_tree1_sh');
                mat4.copy(instance.modelMatrix, object.modelMatrix);
                //mat4.copy(instanceShadow.modelMatrix, object.modelMatrix);
                break;
            }
            case 0x00010003: {
                // Tree 2
                const brres = renderer.mountRRES(device, 'G3D/glf_tree2.brres');
                const instance = renderer.spawnModel(device, brres, 'glf_tree2');
                //const instanceShadow = renderer.spawnModel(device, brres, 'glf_tree2_sh');
                mat4.copy(instance.modelMatrix, object.modelMatrix);
                //mat4.copy(instanceShadow.modelMatrix, object.modelMatrix);
                break;
            }
            case 0x00010004: {
                // Tree 1 (mirrored)
                const brres = renderer.mountRRES(device, 'G3D/glf_tree1.brres');
                const instance = renderer.spawnModel(device, brres, 'glf_tree1_env');
                mat4.copy(instance.modelMatrix, object.modelMatrix);
                break;
            }
            case 0x00010005: {
                // Tree 2 (mirrored)
                const brres = renderer.mountRRES(device, 'G3D/glf_tree2.brres');
                const instance = renderer.spawnModel(device, brres, 'glf_tree2_env');
                mat4.copy(instance.modelMatrix, object.modelMatrix);
                break;
            }
            case 0x00010008: {
                // Sky
                const brres = renderer.mountRRES(device, 'G3D/glf_sky.brres');
                const instance = renderer.spawnModel(device, brres, 'glf_sky');
                mat4.copy(instance.modelMatrix, object.modelMatrix);
                break;
            }
            case 0x0001000A: {
                // Tee object
                const brres = renderer.mountRRES(device, 'G3D/glf_teeOBJ.brres');
                const instance = renderer.spawnModel(device, brres, 'glf_teeOBJ');
                mat4.copy(instance.modelMatrix, object.modelMatrix);
                break;
            }
        }
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const d = context.dataFetcher;

        const golfName = `glf_course_${this.id}`;
        const sceneName = `glf_scene_${this.id}`

        const resourceSystem = new ResourceSystem();

        await resourceSystem.fetchAndMount(d, [
            `${dataPath}/Common/RPGolScene/common.carc`,
            `${dataPath}/Stage/RPGolScene/${golfName}.carc`
        ]);

        const renderer = new WiiSportsRenderer(device, resourceSystem);
        
        // Load main model
        const courseBRRES = renderer.mountRRES(device, `G3D/${golfName}.brres`);
        const courseMDL0 = renderer.spawnModel(device, courseBRRES, golfName);     

        renderer.loadSCN0(assertExists(courseBRRES.scn0.find(x => x.name == sceneName)));
        courseMDL0.bindLightSetting(renderer.lightSetting);

        // Hide the height map and show the normal texture for the green
        const greenMaterial = assertExists(courseMDL0.materialInstances.find(x => x.materialData.material.name == "M_Green"));
        greenMaterial.materialData.material.colorConstants[2] = colorNewFromRGBA(1, 1, 1, 1);
        
        // TODO: we need to create a new camera for the projection of the green texture
        // Right now it uses the main camera, but should presumably use camera1Green_siba

        // Load PMP
        const pmp = PMP.parse(assertExists(resourceSystem.findFileData(`${golfName}.pmp`)));

        for (let object of pmp.objects) {
            this.spawnObject(object, device, renderer);
        }

        return renderer;
    }
}

class BoxingSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const d = context.dataFetcher;

        const resourceSystem = new ResourceSystem();

        await resourceSystem.fetchAndMount(d, [
            `${dataPath}/Common/RPBoxScene/common.carc`,
            `${dataPath}/Stage/RPBoxScene/MainGame.carc`
        ]);

        const renderer = new WiiSportsRenderer(device, resourceSystem);
        
        // Load main model
        const stageBRRES = renderer.mountRRES(device, `G3D/${this.id}.brres`);
        renderer.loadSCN0(assertExists(stageBRRES.scn0.find(x => x.name == this.id)));

        for (let mdl0 of stageBRRES.mdl0) {
            const instance = renderer.spawnModel(device, stageBRRES, mdl0.name);
            instance.bindLightSetting(renderer.lightSetting);
        }        

        return renderer;
    }
}

const dataPath = "WiiSports"
const id = 'WiiSports';
const name = "Wii Sports";

const sceneDescs = [
    "Tennis",
    new TennisSceneDesc("a", "Field"),
    new TennisSceneDesc("b", "Training Field"),
    "Baseball",
    new BaseballSceneDesc("", "Stage"),
    "Bowling",
    new BowlingSceneDesc("bwg_field", "Stage"),
    new BowlingSceneDesc("bwg_field_91", "Training Stage"),
    "Golf",
    new GolfSceneDesc("fc1", "Hole 1"),
    new GolfSceneDesc("fc3", "Hole 2"),
    new GolfSceneDesc("fc8", "Hole 3"),
    new GolfSceneDesc("fc14", "Hole 4"),
    new GolfSceneDesc("fc5", "Hole 5"),
    new GolfSceneDesc("fc16", "Hole 6"),
    new GolfSceneDesc("fc12", "Hole 7"),
    new GolfSceneDesc("fc9", "Hole 8"),
    new GolfSceneDesc("fc13", "Hole 9"),
    "Boxing",
    new BoxingSceneDesc("box_ring", "Ring"),
    new BoxingSceneDesc("box_gym", "Gym")
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };