import { mat4, vec3 } from 'gl-matrix';
import * as UI from '../ui';
import { DataFetcher } from '../DataFetcher';
import * as Viewer from '../viewer';
import { GfxDevice, GfxSampler, GfxMipFilterMode, GfxTexFilterMode, GfxWrapMode } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { GfxrGraphBuilder, GfxrPass, GfxrPassScope, GfxrRenderGraph, GfxrRenderTargetID, GfxrResolveTextureID } from '../gfx/render/GfxRenderGraph';
import { SceneContext } from '../SceneBase';
import * as GX_Material from '../gx/gx_material';
import { fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { getDebugOverlayCanvas2D, drawWorldSpaceText, drawWorldSpacePoint, drawWorldSpaceLine } from "../DebugJunk";
import { colorNewFromRGBA, Color, colorCopy, White } from '../Color';

import { SFA_GAME_INFO, GameInfo } from './scenes';
import { loadRes, ResourceCollection } from './resource';
import { ObjectManager, ObjectInstance, ObjectUpdateContext } from './objects';
import { EnvfxManager } from './envfx';
import { SFARenderer, SceneRenderContext, SFARenderLists } from './render';
import { MapInstance, loadMap } from './maps';
import { dataSubarray, readVec3 } from './util';
import { ModelRenderContext } from './models';
import { MaterialFactory } from './materials';
import { SFAAnimationController } from './animation';
import { SFABlockFetcher } from './blocks';
import { Sky } from './Sky';
import { WorldLights } from './WorldLights';
import { SFATextureFetcher } from './textures';
import { AmbientProbe } from './AmbientProbe';
import { TextureMapping } from '../TextureHolder';

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
        this.envfxMan = await EnvfxManager.create(this, dataFetcher);
        
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

    public destroy(device: GfxDevice) {
        for (let obj of this.objectInstances)
            obj.destroy(device);
        this.envfxMan.destroy(device);
        this.mapInstance?.destroy(device);
        this.resColl.destroy(device);
        this.blockFetcher.destroy(device);
    }
}

const scratchMtx0 = mat4.create();
const scratchColor0 = colorNewFromRGBA(1, 1, 1, 1);

class WorldRenderer extends SFARenderer {
    public textureHolder: UI.TextureListHolder;
    private timeSelect: UI.Slider;
    private enableAmbient: boolean = true;
    private layerSelect: UI.Slider;
    private showObjects: boolean = true;
    private showDevGeometry: boolean = false;
    private showDevObjects: boolean = false;
    private enableLights: boolean = true;
    private sky: Sky; // TODO: move to World?
    private ambientProbe: AmbientProbe;

    constructor(private world: World, materialFactory: MaterialFactory) {
        super(world.device, world.animController, materialFactory);
        if (this.world.resColl.texFetcher instanceof SFATextureFetcher)
            this.textureHolder = this.world.resColl.texFetcher.textureHolder;
        this.sky = new Sky(this.world);
        this.ambientProbe = new AmbientProbe(this.world, materialFactory);
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

    protected update(viewerInput: Viewer.ViewerRenderInput) {
        super.update(viewerInput);

        this.materialFactory.update(this.animController);

        this.world.envfxMan.setTimeOfDay(this.timeSelect.getValue()|0);
        if (!this.enableAmbient)
            this.world.envfxMan.setOverrideOutdoorAmbientColor(White);
        else
            this.world.envfxMan.setOverrideOutdoorAmbientColor(null);

        this.sky.update();
        
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
    
    protected addSkyRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, sceneCtx: SceneRenderContext) {
        this.sky.addSkyRenderInsts(device, renderInstManager, renderLists, sceneCtx);
    }

    protected addSkyRenderPasses(device: GfxDevice, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, mainColorTargetID: GfxrRenderTargetID, sceneCtx: SceneRenderContext) {
        this.sky.addSkyRenderPasses(device, this.renderHelper, builder, renderInstManager, renderLists, mainColorTargetID, this.mainDepthDesc, sceneCtx);
    }

    private setupLights(lights: GX_Material.Light[], modelCtx: ModelRenderContext) {
        if (this.enableLights) {
            this.world.worldLights.setupLights(lights, modelCtx);
        } else {
            for (let i = 0; i < 8; i++)
                lights[i].reset();
        }
    }

    protected addWorldRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, sceneCtx: SceneRenderContext) {
        renderInstManager.setCurrentRenderInstList(renderLists.world[0]);

        const template = renderInstManager.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, sceneCtx.viewerInput);

        this.world.envfxMan.getAmbientColor(scratchColor0, 0); // Always use ambience #0 when rendering map
        const modelCtx: ModelRenderContext = {
            sceneCtx,
            showDevGeometry: this.showDevGeometry,
            outdoorAmbientColor: scratchColor0,
            setupLights: this.setupLights.bind(this),
        };

        if (this.showObjects) {
            for (let i = 0; i < this.world.objectInstances.length; i++) {
                const obj = this.world.objectInstances[i];
    
                if (obj.getType().isDevObject && !this.showDevObjects)
                    continue;
    
                if (obj.isInLayer(this.layerSelect.getValue())) {
                    obj.addRenderInsts(device, renderInstManager, renderLists, modelCtx);
        
                    const drawLabels = false;
                    if (drawLabels)
                        drawWorldSpaceText(getDebugOverlayCanvas2D(), sceneCtx.viewerInput.camera.clipFromWorldMatrix, obj.getPosition(), obj.getName(), undefined, undefined, {outline: 2});
                }
            }
        }
        
        if (this.world.mapInstance !== null)
            this.world.mapInstance.addRenderInsts(device, renderInstManager, renderLists, modelCtx);

        renderInstManager.popTemplateRenderInst();
    }

    private ambientProbeTextureMapping = new TextureMapping();
    private ambientProbeSampler?: GfxSampler;
    private ambientProbeTargetID: GfxrRenderTargetID;
    private ambientProbeResolveID: GfxrResolveTextureID;

    protected addWorldRenderPassesInner(device: GfxDevice, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, sceneCtx: SceneRenderContext) {
        this.ambientProbeTargetID = this.ambientProbe.render(device, builder, this.renderHelper, renderInstManager, sceneCtx);
    }

    protected attachResolveTexturesForWorldOpaques(builder: GfxrGraphBuilder, pass: GfxrPass) {
        this.ambientProbeResolveID = builder.resolveRenderTarget(this.ambientProbeTargetID);
        pass.attachResolveTexture(this.ambientProbeResolveID);
    }

    protected resolveLateSamplerBindingsForWorldOpaques(renderList: GfxRenderInstList, scope: GfxrPassScope) {
        this.ambientProbeTextureMapping.gfxTexture = scope.getResolveTextureForID(this.ambientProbeResolveID);
        if (this.ambientProbeSampler === undefined) {
            this.ambientProbeSampler = this.renderHelper.getCache().createSampler({
                wrapS: GfxWrapMode.Clamp,
                wrapT: GfxWrapMode.Clamp,
                minFilter: GfxTexFilterMode.Bilinear,
                magFilter: GfxTexFilterMode.Bilinear,
                mipFilter: GfxMipFilterMode.NoMip,
                minLOD: 0,
                maxLOD: 100,
            })
        }
        this.ambientProbeTextureMapping.gfxSampler = this.ambientProbeSampler;
        renderList.resolveLateSamplerBinding('ambient-probe', this.ambientProbeTextureMapping);
    }

    public destroy(device: GfxDevice) {
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
            mapInstance = new MapInstance(mapSceneInfo, world.blockFetcher);
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