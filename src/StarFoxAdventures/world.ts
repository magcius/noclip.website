import { mat4, vec3 } from 'gl-matrix';
import * as UI from '../ui';
import { DataFetcher } from '../DataFetcher';
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { GfxrGraphBuilder, GfxrPass, GfxrPassScope, GfxrRenderTargetID } from '../gfx/render/GfxRenderGraph';
import { SceneContext } from '../SceneBase';
import * as GX_Material from '../gx/gx_material';
import { fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { getDebugOverlayCanvas2D, drawWorldSpaceText } from "../DebugJunk";
import { colorCopy, colorNewFromRGBA } from '../Color';

import { SFA_GAME_INFO, GameInfo } from './scenes';
import { loadRes, ResourceCollection } from './resource';
import { ObjectManager, ObjectInstance, ObjectUpdateContext } from './objects';
import { EnvfxManager } from './envfx';
import { SFARenderer, SceneRenderContext, SFARenderLists } from './render';
import { MapInstance, loadMap } from './maps';
import { dataSubarray, mat4SetTranslation, readVec3 } from './util';
import { ModelRenderContext } from './models';
import { MaterialFactory } from './materials';
import { SFAAnimationController } from './animation';
import { SFABlockFetcher } from './blocks';
import { Sky } from './Sky';
import { LightType, WorldLights } from './WorldLights';
import { SFATextureFetcher } from './textures';
import { SphereMapManager } from './SphereMaps';
import { computeViewMatrix } from '../Camera';
import { nArray } from '../util';
import { transformVec3Mat4w0, transformVec3Mat4w1 } from '../MathHelpers';

const scratchVec0 = vec3.create();
const scratchMtx0 = mat4.create();
const scratchMtx1 = mat4.create();
const scratchColor0 = colorNewFromRGBA(1, 1, 1, 1);

export class World {
    public animController: SFAAnimationController;
    public envfxMan: EnvfxManager;
    public blockFetcher: SFABlockFetcher;
    public mapInstance: MapInstance | null = null;
    public objectMan: ObjectManager;
    public resColl: ResourceCollection;
    public objectInstances: ObjectInstance[] = [];
    public worldLights: WorldLights = new WorldLights();

    private constructor(public device: GfxDevice, public gameInfo: GameInfo, public subdirs: string[], private materialFactory: MaterialFactory) {
    }

    private async init(dataFetcher: DataFetcher) {
        this.animController = new SFAAnimationController();
        this.envfxMan = await EnvfxManager.create(this.device, this, dataFetcher);
        
        const resCollPromise = ResourceCollection.create(this.device, this.gameInfo, dataFetcher, this.subdirs, this.materialFactory, this.animController);
        const texFetcherPromise = async () => {
            return (await resCollPromise).texFetcher;
        };

        const [resColl, blockFetcher, objectMan] = await Promise.all([
            resCollPromise,
            SFABlockFetcher.create(this.gameInfo, dataFetcher, this.device, this.materialFactory, this.animController, texFetcherPromise()),
            ObjectManager.create(this, dataFetcher, false),
        ]);
        this.resColl = resColl;
        this.blockFetcher = blockFetcher;
        this.objectMan = objectMan;
    }

    public static async create(device: GfxDevice, gameInfo: GameInfo, dataFetcher: DataFetcher, subdirs: string[], materialFactory: MaterialFactory): Promise<World> {
        const self = new World(device, gameInfo, subdirs, materialFactory);
        await self.init(dataFetcher);
        return self;
    }

    public setMapInstance(mapInstance: MapInstance | null) {
        this.mapInstance = mapInstance;
    }

    public spawnObject(objParams: DataView, parent: ObjectInstance | null = null, mapObjectOrigin: vec3): ObjectInstance | null {
        const typeNum = objParams.getUint16(0x0);
        const pos = readVec3(objParams, 0x8);

        const posInMap = vec3.clone(pos);
        vec3.add(posInMap, posInMap, mapObjectOrigin);

        const obj = this.objectMan.createObjectInstance(typeNum, objParams, posInMap);
        obj.setParent(parent);
        this.objectInstances.push(obj);

        try {
            obj.mount();
        } catch (e) {
            console.warn("Mounting object failed with exception:");
            console.error(e);
            this.objectInstances.pop();
            return null;
        }

        return obj;
    }

    public spawnObjectsFromRomlist(romlist: DataView, parent: ObjectInstance | null = null) {
        const mapObjectOrigin = vec3.create();
        if (this.mapInstance !== null)
            vec3.set(mapObjectOrigin, 640 * this.mapInstance.info.getOrigin()[0], 0, 640 * this.mapInstance.info.getOrigin()[1]);

        let offs = 0;
        let i = 0;
        while (offs < romlist.byteLength) {
            const entrySize = 4 * romlist.getUint8(offs + 0x2);
            const objParams = dataSubarray(romlist, offs, entrySize);

            const obj = this.spawnObject(objParams, parent, mapObjectOrigin);
            if (obj !== null)
                console.log(`Object #${i}: ${obj.getName()} (type ${obj.getType().typeNum} romlist-type 0x${obj.commonObjectParams.objType.toString(16)} class ${obj.getType().objClass} id 0x${obj.commonObjectParams.id.toString(16)})`);

            offs += entrySize;
            i++;
        }
    }
    
    public setupLightsForObject(lights: GX_Material.Light[], obj: ObjectInstance | undefined, sceneCtx: SceneRenderContext, typeMask: LightType) {
        const probedLights = obj !== undefined ? this.worldLights.probeLightsOnObject(obj, sceneCtx, typeMask, 8) : this.worldLights.lights;
        let i = 0;

        const worldView = scratchMtx0;
        computeViewMatrix(worldView, sceneCtx.viewerInput.camera);
        const worldViewSR = scratchMtx1;
        mat4.copy(worldViewSR, worldView);
        mat4SetTranslation(worldViewSR, 0, 0, 0);

        for (let light of probedLights) {
            if (light.type & typeMask) {
                lights[i].reset();
                if (light.type === LightType.DIRECTIONAL) {
                    vec3.scale(lights[i].Position, light.direction, -100000.0);
                    transformVec3Mat4w0(lights[i].Position, worldViewSR, lights[i].Position);
                    colorCopy(lights[i].Color, light.color);
                    vec3.set(lights[i].CosAtten, 1.0, 0.0, 0.0);
                    vec3.set(lights[i].DistAtten, 1.0, 0.0, 0.0);
                } else { // LightType.POINT
                    light.getPosition(scratchVec0);
                    transformVec3Mat4w1(lights[i].Position, worldView, scratchVec0);
                    // drawWorldSpacePoint(getDebugOverlayCanvas2D(), sceneCtx.viewerInput.camera.clipFromWorldMatrix, light.position);
                    // TODO: use correct parameters
                    colorCopy(lights[i].Color, light.color);
                    vec3.set(lights[i].CosAtten, 1.0, 0.0, 0.0); // TODO
                    vec3.copy(lights[i].DistAtten, light.distAtten);
                }

                i++;
                if (i >= 8)
                    break;
            }
        }

        for (; i < 8; i++)
            lights[i].reset();
    }

    public destroy(device: GfxDevice) {
        for (let obj of this.objectInstances)
            obj.destroy(device);
        this.envfxMan.destroy(device);
        this.mapInstance?.destroy(device);
        this.resColl.destroy(device);
        this.blockFetcher.destroy(device);
    }
}

class WorldRenderer extends SFARenderer {
    public textureHolder: UI.TextureListHolder;
    private timeSelect: UI.Slider;
    private enableAmbient: boolean = true;
    private enableFog: boolean = true;
    private layerSelect: UI.Slider;
    private showObjects: boolean = true;
    private showDevGeometry: boolean = false;
    private showDevObjects: boolean = false;
    private enableLights: boolean = true;
    private sky: Sky; // TODO: move to World?
    private sphereMapMan: SphereMapManager;

    constructor(protected override world: World, materialFactory: MaterialFactory) {
        super(world.device, world.animController, materialFactory);
        if (this.world.resColl.texFetcher instanceof SFATextureFetcher)
            this.textureHolder = this.world.resColl.texFetcher.textureHolder;
        this.sky = new Sky(this.world);
        this.sphereMapMan = new SphereMapManager(this.world, materialFactory);
    }

    public createPanels(): UI.Panel[] {
        const timePanel = new UI.Panel();
        timePanel.setTitle(UI.TIME_OF_DAY_ICON, 'Time');

        this.timeSelect = new UI.Slider();
        this.timeSelect.setLabel('Time');
        this.timeSelect.setRange(0, 7, 1);
        this.timeSelect.setValue(4);
        timePanel.contents.append(this.timeSelect.elem);

        const disableAmbient = new UI.Checkbox("Disable ambient lighting", false);
        disableAmbient.onchanged = () => {
            this.enableAmbient = !disableAmbient.checked;
        };
        timePanel.contents.append(disableAmbient.elem);

        const disableFog = new UI.Checkbox("Disable fog", false);
        disableFog.onchanged = () => {
            this.enableFog = !disableFog.checked;
        };
        timePanel.contents.append(disableFog.elem);

        const layerPanel = new UI.Panel();
        layerPanel.setTitle(UI.LAYER_ICON, 'Layers');

        const hideObjects = new UI.Checkbox("Hide objects", false);
        hideObjects.onchanged = () => {
            this.showObjects = !hideObjects.checked;
        };
        layerPanel.contents.append(hideObjects.elem);

        this.layerSelect = new UI.Slider();
        this.layerSelect.setLabel('Layer');
        this.layerSelect.setRange(0, 16, 1);
        this.layerSelect.setValue(1);
        layerPanel.contents.append(this.layerSelect.elem);

        const showDevObjects = new UI.Checkbox("Show developer objects", false);
        showDevObjects.onchanged = () => {
            this.showDevObjects = showDevObjects.checked;
        };
        layerPanel.contents.append(showDevObjects.elem);

        const showDevGeometry = new UI.Checkbox("Show developer map shapes", false);
        showDevGeometry.onchanged = () => {
            this.showDevGeometry = showDevGeometry.checked;
        };
        layerPanel.contents.append(showDevGeometry.elem);

        const disableLights = new UI.Checkbox("Disable lights", false);
        disableLights.onchanged = () => {
            this.enableLights = !disableLights.checked;
        }
        layerPanel.contents.append(disableLights.elem);
        
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');

        const showDebugThumbnails = new UI.Checkbox('Show Debug Thumbnails', false);
        showDebugThumbnails.onchanged = () => {
            const v = showDebugThumbnails.checked;
            this.renderHelper.debugThumbnails.enabled = v;
        };
        renderHacksPanel.contents.appendChild(showDebugThumbnails.elem);

        return [timePanel, layerPanel, renderHacksPanel];
    }

    public setEnvfx(envfxactNum: number) {
        this.world.envfxMan.loadEnvfx(envfxactNum);
    }

    // XXX: for testing
    public enableFineAnims(enable: boolean = true) {
        this.animController.enableFineSkinAnims = enable;
    }

    // XXX: for testing
    public loadTexture(id: number, useTex1: boolean = false) {
        const texture = this.world.resColl.texFetcher.getTexture(this.world.device, id, useTex1);
        if (texture !== null && texture.viewerTexture !== undefined)
            console.log(`Loaded texture "${texture.viewerTexture.name}"`);
        else
            console.log(`Failed to load texture`);
    }

    protected override update(viewerInput: Viewer.ViewerRenderInput) {
        super.update(viewerInput);

        this.materialFactory.update(this.animController);

        this.world.envfxMan.setTimeOfDay(this.timeSelect.getValue()|0);
        this.world.envfxMan.enableAmbientLighting = this.enableAmbient;
        this.world.envfxMan.enableFog = this.enableFog;
        this.world.envfxMan.update(this.world.device, { viewerInput });
        
        const updateCtx: ObjectUpdateContext = {
            viewerInput,
        };

        for (let i = 0; i < this.world.objectInstances.length; i++) {
            const obj = this.world.objectInstances[i];

            // FIXME: Is it really true that objects are updated regardless of layer?
            // This is required for TrigPlns to work.
            obj.update(updateCtx);
        }
    }
    
    protected override addSkyRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, sceneCtx: SceneRenderContext) {
        this.sky.addSkyRenderInsts(device, renderInstManager, renderLists, sceneCtx);
    }

    protected override addSkyRenderPasses(device: GfxDevice, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, mainColorTargetID: GfxrRenderTargetID, sceneCtx: SceneRenderContext) {
        this.sky.addSkyRenderPasses(device, this.renderHelper, builder, renderInstManager, renderLists, mainColorTargetID, this.mainDepthDesc, sceneCtx);
    }

    public setupLightsForObject(lights: GX_Material.Light[], obj: ObjectInstance, sceneCtx: SceneRenderContext, typeMask: LightType) {
        if (this.enableLights) {
            this.world.setupLightsForObject(lights, obj, sceneCtx, typeMask);
        } else {
            for (let i = 0; i < 8; i++)
                lights[i].reset();
        }
    }

    protected override addWorldRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, sceneCtx: SceneRenderContext) {
        renderInstManager.setCurrentRenderInstList(renderLists.world[0]);

        const template = renderInstManager.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, sceneCtx.viewerInput);

        this.world.envfxMan.getAmbientColor(scratchColor0, 0); // Always use ambience #0 when rendering map (FIXME: really?)
        const modelCtx: ModelRenderContext = {
            sceneCtx,
            showDevGeometry: this.showDevGeometry,
            ambienceIdx: 0,
            outdoorAmbientColor: scratchColor0,
            setupLights: undefined!,
        };

        const lights = nArray(8, () => new GX_Material.Light());

        if (this.showObjects) {
            for (let i = 0; i < this.world.objectInstances.length; i++) {
                const obj = this.world.objectInstances[i];
    
                if (obj.getType().isDevObject && !this.showDevObjects)
                    continue;
    
                if (obj.isInLayer(this.layerSelect.getValue())) {
                    modelCtx.setupLights = (lights: GX_Material.Light[], typeMask: LightType) => {
                        this.setupLightsForObject(lights, obj, sceneCtx, typeMask);
                    };

                    obj.addRenderInsts(device, renderInstManager, renderLists, modelCtx);

                    const drawLabels = false;
                    if (drawLabels) {
                        obj.getPosition(scratchVec0);
                        drawWorldSpaceText(getDebugOverlayCanvas2D(), sceneCtx.viewerInput.camera.clipFromWorldMatrix, scratchVec0, obj.getName(), undefined, undefined, {outline: 2});
                    }
                }
            }
        }

        modelCtx.setupLights = () => {};
        if (this.world.mapInstance !== null)
            this.world.mapInstance.addRenderInsts(device, renderInstManager, renderLists, modelCtx);

        renderInstManager.popTemplateRenderInst();
    }

    protected override addWorldRenderPassesInner(device: GfxDevice, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, sceneCtx: SceneRenderContext) {
        this.sphereMapMan.renderMaps(device, builder, this.renderHelper, renderInstManager, sceneCtx);
    }

    protected override attachResolveTexturesForWorldOpaques(builder: GfxrGraphBuilder, pass: GfxrPass) {
        this.sphereMapMan.attachResolveTextures(builder, pass);
    }

    protected override resolveLateSamplerBindingsForWorldOpaques(renderList: GfxRenderInstList, scope: GfxrPassScope) {
        this.sphereMapMan.resolveLateSamplerBindings(renderList, scope, this.renderHelper.getCache());
    }

    public override destroy(device: GfxDevice) {
        super.destroy(device);
        this.world.destroy(device);
        this.sky.destroy(device);
    }
}

export class SFAWorldSceneDesc implements Viewer.SceneDesc {
    public id: string;
    private subdirs: string[];

    constructor(public id_: string | string[], subdir_: string | string[], private mapNum: number | null, public name: string, private gameInfo: GameInfo = SFA_GAME_INFO) {
        if (Array.isArray(id_))
            this.id = id_[0];
        else
            this.id = id_;

        if (Array.isArray(subdir_))
            this.subdirs = subdir_;
        else
            this.subdirs = [subdir_];
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        console.log(`Creating scene for world ${this.name} (ID ${this.id}) ...`);

        const pathBase = this.gameInfo.pathBase;
        const dataFetcher = context.dataFetcher;
        const materialFactory = new MaterialFactory(device);
        const world = await World.create(device, this.gameInfo, dataFetcher, this.subdirs, materialFactory);
        
        let mapInstance: MapInstance | null = null;
        if (this.mapNum !== null) {
            const mapSceneInfo = await loadMap(this.gameInfo, dataFetcher, this.mapNum);
            mapInstance = new MapInstance(mapSceneInfo, world.blockFetcher, world);
            await mapInstance.reloadBlocks(dataFetcher);

            // Translate map for SFA world coordinates
            const objectOrigin = vec3.fromValues(640 * mapSceneInfo.getOrigin()[0], 0, 640 * mapSceneInfo.getOrigin()[1]);
            const mapMatrix = mat4.create();
            const mapTrans = vec3.clone(objectOrigin);
            vec3.negate(mapTrans, mapTrans);
            mat4.fromTranslation(mapMatrix, mapTrans);
            mapInstance.setMatrix(mapMatrix);

            world.setMapInstance(mapInstance);
        }

        const romlistNames: string[] = Array.isArray(this.id_) ? this.id_ : [this.id_];
        let parentObj: ObjectInstance | null = null;
        for (let name of romlistNames) {
            console.log(`Loading romlist ${name}.romlist.zlb...`);

            const [romlistFile] = await Promise.all([
                dataFetcher.fetchData(`${pathBase}/${name}.romlist.zlb`),
            ]);
            const romlist = loadRes(romlistFile).createDataView();
    
            world.spawnObjectsFromRomlist(romlist, parentObj);

            // XXX: In the Ship Battle scene, attach galleonship objects to the ship.
            if (name === 'frontend') {
                parentObj = world.objectInstances[2];
                console.log(`parentObj is ${parentObj.objType.name}`);
            }
        }
        
        (window.main as any).lookupObject = (objType: number, skipObjindex: boolean = false) => {
            const obj = world.objectMan.getObjectType(objType, skipObjindex);
            console.log(`Object ${objType}: ${obj.name} (type ${obj.typeNum} class ${obj.objClass})`);
        };

        const renderer = new WorldRenderer(world, materialFactory);
        return renderer;
    }
}