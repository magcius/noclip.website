import * as BNTX from "../fres_nx/bntx.js";
import * as BFRES from "../fres_nx/bfres.js";
import { decompress } from "fzstd";
import { Destroyable, SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { OrigamiModelData } from "./render_data.js";
import { OrigamiModelRenderer } from "./render.js";
import { OrigamiELFType, OrigamiItemInstance, OrigamiItemType, OrigamiMobjInstance, OrigamiSobjInstance, OrigamiMobjType, OrigamiModelDef, parseOrigamiELF, OrigamiNPCInstance, OrigamiNPCType } from "./bin_elf.js";
import { computeModelMatrixSRT, MathConstants } from "../MathHelpers.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { mat4 } from "gl-matrix";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { OrigamiTextureHolder } from "./texture.js";
import { getOrigamiLevelConfig, OrigamiLevelConfig } from "./level_config.js";
import { DataFetcher } from "../DataFetcher.js";
import { getOrigamiModelConfig } from "./model_config.js";
import { LayerPanel, Panel } from "../ui.js";

interface LevelObjectInstances {
    mobjInstances: OrigamiMobjInstance[];
    sobjInstances: OrigamiSobjInstance[];
    itemInstances: OrigamiItemInstance[];
    npcInstances: OrigamiNPCInstance[];
}

/**
 * Resource system for _Paper Mario: The Origami King_. Based on Odyssey's ResourceSystem class.
 */
export class OrigamiResources implements Destroyable {
    public textureHolder = new OrigamiTextureHolder();
    public modelData = new Map<string, OrigamiModelData>();
    private renderCache: GfxRenderCache;
    private loadedBFRESNames: string[] = [];
    private requestedCommonTextures: string[] = [];

    constructor(device: GfxDevice) {
        this.renderCache = new GfxRenderCache(device);
    }

    private loadBFRESTextures(device: GfxDevice, name: string, bfres: BFRES.FRES, search: string, whiteList?: string[]) {
        const embeddedTextureFile = bfres.externalFiles.find((f) => f.name.endsWith(search));
        if (embeddedTextureFile) {
            const bntx = BNTX.parse(embeddedTextureFile.buffer);
            for (const t of bntx.textures) {
                if (whiteList && !whiteList.includes(t.name)) {
                    continue;
                }
                if (!t.name.startsWith("Cmn_")) {
                    t.name = `${name}_${t.name}`;
                }
                this.textureHolder.addTexture(device, t);
            }
        }
    }

    /**
     * Load model and embedded textures from BFRES and records any common textures that are needed
     */
    public loadBFRES(device: GfxDevice, name: string, bfres: BFRES.FRES, configName?: string) {
        if (!this.loadedBFRESNames.includes(name)) {
            this.loadedBFRESNames.push(name);
            const referencedTextureNames: string[] = [];
            const model = bfres.fmdl[0];
            for (const material of model.fmat) {
                referencedTextureNames.push(...material.textureName);
            }

            const config = getOrigamiModelConfig(configName ? configName : name);
            const md = new OrigamiModelData(this.renderCache, bfres, config);

            if (md.texturePatternAnimation) {
                referencedTextureNames.push(...md.texturePatternAnimation.textureNames);
            }

            this.loadBFRESTextures(device, name, bfres, ".bntx", referencedTextureNames);
            this.loadBFRESTextures(device, name, bfres, ".en-US.bntx"); // some models have language-dependent textures

            this.modelData.set(model.name, md);

            for (const material of model.fmat) {
                for (const t of material.textureName) {
                    if (t.startsWith("Cmn_") && !this.requestedCommonTextures.includes(t)) {
                        this.requestedCommonTextures.push(t);
                    }
                }
            }
        }
    }

    /**
     * Call after loading all BFRES
     */
    public loadRequestedCommonTextures(device: GfxDevice, file: ArrayBufferSlice) {
        const bntx = BNTX.parse(file);
        for (const texture of bntx.textures) {
            if (this.requestedCommonTextures.includes(texture.name)) {
                this.textureHolder.addTexture(device, texture);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        this.renderCache.destroy();
        this.textureHolder.destroy(device);
        this.modelData.forEach((value) => { value.destroy(device) });
    }
}

class OrigamiRenderer implements SceneGfx {
    private renderInstListMain = new GfxRenderInstList();
    public renderHelper: GfxRenderHelper;
    public textureHolder: OrigamiTextureHolder;
    public modelRenderers: OrigamiModelRenderer[] = [];

    constructor(device: GfxDevice, public resources: OrigamiResources) {
        this.renderHelper = new GfxRenderHelper(device);
        this.textureHolder = resources.textureHolder;
    }

    public createPanels(): Panel[] {
        const layersPanel = new LayerPanel();
        layersPanel.setLayers(this.modelRenderers);
        return [layersPanel];
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);
        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        // this.renderHelper.debugDraw.pushPasses(builder, mainColorTargetID, mainDepthTargetID);
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);
        this.prepareToRender(device, viewerInput);
        builder.execute();
        this.renderInstListMain.reset();
    }

    private prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.renderHelper.pushTemplateRenderInst();
        // this.renderHelper.debugDraw.beginFrame(viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        // level states would be handled here with different sets of model renderers (list of indicies, not duplicate renderers being stored)
        for (const renderer of this.modelRenderers) {
            if (renderer.visible) {
                renderer.prepareToRender(this.renderHelper.renderInstManager, viewerInput);
            }
        }
        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.resources.destroy(device);
    }
}

function decompressZST(file: ArrayBufferSlice): ArrayBufferSlice {
    return ArrayBufferSlice.fromView(decompress(file.createTypedArray(Uint8Array)));
}

function patchLevelObjectRenderers(instances: LevelObjectInstances, renderer: OrigamiRenderer) {
    for (const instance of instances.mobjInstances) {
        const modelRenderer = renderer.modelRenderers.find(m => m.name === instance.resolvedModelName);
        if (!modelRenderer) {
            continue;
        }
        const m = mat4.create();
        computeModelMatrixSRT(m, 1, 1, 1,
            instance.rotation[0] * MathConstants.DEG_TO_RAD, instance.rotation[1] * MathConstants.DEG_TO_RAD, instance.rotation[2] * MathConstants.DEG_TO_RAD,
            instance.position[0], instance.position[1], instance.position[2]);
        modelRenderer.addInstanceMatrix(m);
    }

    for (const instance of instances.sobjInstances) {
        const modelRenderer = renderer.modelRenderers.find(m => m.name === instance.modelName);
        if (!modelRenderer) {
            continue;
        }
        const m = mat4.create();
        computeModelMatrixSRT(m, instance.scale[0], instance.scale[1], instance.scale[2],
            instance.rotation[0] * MathConstants.DEG_TO_RAD, instance.rotation[1] * MathConstants.DEG_TO_RAD, instance.rotation[2] * MathConstants.DEG_TO_RAD,
            instance.position[0], instance.position[1], instance.position[2]);
        modelRenderer.addInstanceMatrix(m);
    }

    for (const instance of instances.itemInstances) {
        const modelRenderer = renderer.modelRenderers.find(m => m.name === instance.resolvedModelName);
        if (!modelRenderer) {
            continue;
        }
        const m = mat4.create();
        computeModelMatrixSRT(m, 1, 1, 1, 0, 0, 0, instance.position[0], instance.position[1], instance.position[2]);
        modelRenderer.addInstanceMatrix(m);
    }

    for (const instance of instances.npcInstances) {
        const modelRenderer = renderer.modelRenderers.find(m => m.name === instance.resolvedModelName);
        if (!modelRenderer) {
            continue;
        }
        const m = mat4.create();
        computeModelMatrixSRT(m, 1, 1, 1,
            0, 0, /*instance.rotationDeg * MathConstants.DEG_TO_RAD,*/ 0,
            instance.position[0], instance.position[1], instance.position[2]
        );
        modelRenderer.addInstanceMatrix(m);
    }
}

async function getMobjInstances(id: string, config: OrigamiLevelConfig, resources: OrigamiResources, dataFetcher: DataFetcher, device: GfxDevice): Promise<OrigamiMobjInstance[]> {
    const instances: OrigamiMobjInstance[] = [];
    const worldId = id.substring(0, 2);
    const levelGroupId = id.substring(0, 4);

    const types: OrigamiMobjType[] = [];
    for (const s of ["data_mobj_Cmn", `data_mobj_${worldId}_Cmn`, `data_mobj_${levelGroupId}`]) {
        const file = await dataFetcher.fetchData(`${pathBase}/data/mobj/${s}.elf.zst`);
        types.push(...parseOrigamiELF(decompressZST(file), OrigamiELFType.MobjType) as OrigamiMobjType[]);
    }
    if (config.aobj) {
        const file = await dataFetcher.fetchData(`${pathBase}/data/mobj/data_aobj.elf.zst`);
        types.push(...parseOrigamiELF(decompressZST(file), OrigamiELFType.MobjType) as OrigamiMobjType[]);
    }

    const mobjModels: OrigamiModelDef[] = [];
    for (const s of ["data_mobj_model_Cmn", `data_mobj_model_${worldId}_Cmn`, `data_mobj_model_${levelGroupId}`]) {
        const file = await dataFetcher.fetchData(`${pathBase}/data/mobj_model/${s}.elf.zst`);
        mobjModels.push(...parseOrigamiELF(decompressZST(file), OrigamiELFType.MobjModel) as OrigamiModelDef[]);
    }

    for (const mobj of config.altMobj !== undefined ? config.altMobj : ["Mobj"]) {
        const file = await dataFetcher.fetchData(`${pathBase}/data/map/${id}/dispos_${mobj}.elf.zst`);
        instances.push(...parseOrigamiELF(decompressZST(file), OrigamiELFType.DisposMobj) as OrigamiMobjInstance[]);
    }
    if (config.aobj) {
        const file = await dataFetcher.fetchData(`${pathBase}/data/map/${id}/dispos_Aobj.elf.zst`);
        instances.push(...parseOrigamiELF(decompressZST(file), OrigamiELFType.DisposAobj) as OrigamiMobjInstance[]);
    }

    const uniqueTypes: string[] = [];
    for (const instance of instances) {
        if (!uniqueTypes.includes(instance.type)) {
            uniqueTypes.push(instance.type);
        }
    }

    // get location of each type's model file by traversing data ELF files (absurdly obtuse)
    for (const uniqueType of uniqueTypes) {
        const type = types.find(m => m.id === uniqueType)!;
        const assetGroup = mobjModels.find(m => m.id === type.modelId)!.assetGroups[0];
        for (const instance of instances) {
            if (instance.type === uniqueType) {
                // store model's name for later when patching its renderer with instance matrices
                instance.resolvedModelName = assetGroup.file;
            }
        }
        const file = await dataFetcher.fetchData(`${pathBase}/${assetGroup.directory}/${assetGroup.file}.bfres.zst`);
        resources.loadBFRES(device, assetGroup.file, BFRES.parse(decompressZST(file)));
    }

    return instances;
}

async function getSobjInstances(id: string, resources: OrigamiResources, dataFetcher: DataFetcher, device: GfxDevice): Promise<OrigamiSobjInstance[]> {
    const instances: OrigamiSobjInstance[] = [];
    const disposFile = await dataFetcher.fetchData(`${pathBase}/data/map/${id}/dispos_Sobj.elf.zst`);
    instances.push(...parseOrigamiELF(decompressZST(disposFile), OrigamiELFType.DisposSobj) as OrigamiSobjInstance[]);

    const uniqueModels: Map<string, string> = new Map();
    for (const instance of instances) {
        if (!uniqueModels.has(instance.modelName)) {
            uniqueModels.set(instance.modelName, instance.modelPath);
        }
    }

    for (const [modelName, modelPath] of uniqueModels.entries()) {
        const file = await dataFetcher.fetchData(`${pathBase}/${modelPath}/${modelName}.bfres.zst`);
        resources.loadBFRES(device, modelName, BFRES.parse(decompressZST(file)));
    }

    return instances;
}

async function getItemInstances(id: string, resources: OrigamiResources, dataFetcher: DataFetcher, device: GfxDevice): Promise<OrigamiItemInstance[]> {
    const instances: OrigamiItemInstance[] = [];

    const typesFile = await dataFetcher.fetchData(`${pathBase}/data/data_item.elf.zst`);
    const types = parseOrigamiELF(decompressZST(typesFile), OrigamiELFType.ItemType) as OrigamiItemType[];
    const modelsFile = await dataFetcher.fetchData(`${pathBase}/data/data_item_model.elf.zst`);
    const models = parseOrigamiELF(decompressZST(modelsFile), OrigamiELFType.ItemModel) as OrigamiModelDef[];
    const disposFile = await dataFetcher.fetchData(`${pathBase}/data/map/${id}/dispos_Item.elf.zst`)
    instances.push(...parseOrigamiELF(decompressZST(disposFile), OrigamiELFType.DisposItem) as OrigamiItemInstance[]);

    const uniqueTypes: string[] = [];
    for (const instance of instances) {
        if (!uniqueTypes.includes(instance.type)) {
            uniqueTypes.push(instance.type);
        }
    }

    // get location of each type's model file by traversing data ELF files (absurdly obtuse)
    for (const type of uniqueTypes) {
        const itemType = types.find(i => i.id === type)!;
        const assetGroup = models.find(i => i.id === itemType.modelId)!.assetGroups[0];
        for (const instance of instances) {
            if (instance.type === type) {
                // store model's name for later when patching its renderer with instance matrices
                instance.resolvedModelName = assetGroup.file;
            }
        }
        const file = await dataFetcher.fetchData(`${pathBase}/${assetGroup.directory}/${assetGroup.file}.bfres.zst`);
        resources.loadBFRES(device, assetGroup.file, BFRES.parse(decompressZST(file)));
    }

    return instances;
}

async function getNPCInstances(id: string, resources: OrigamiResources, dataFetcher: DataFetcher, device: GfxDevice): Promise<OrigamiNPCInstance[]> {
    const instances: OrigamiNPCInstance[] = [];

    const typesFile = await dataFetcher.fetchData(`${pathBase}/data/data_npc.elf.zst`);
    const npcTypes = parseOrigamiELF(decompressZST(typesFile), OrigamiELFType.NPCType) as OrigamiNPCType[];
    const modelsFile = await dataFetcher.fetchData(`${pathBase}/data/data_npc_model.elf.zst`);
    const npcModels = parseOrigamiELF(decompressZST(modelsFile), OrigamiELFType.NPCModel) as OrigamiModelDef[];
    const disposFile = await dataFetcher.fetchData(`${pathBase}/data/map/${id}/dispos_Npc.elf.zst`);
    instances.push(...parseOrigamiELF(decompressZST(disposFile), OrigamiELFType.DisposNPC) as OrigamiNPCInstance[]);

    const uniqueTypes: string[] = [];
    for (const instance of instances) {
        if (!uniqueTypes.includes(instance.type)) {
            uniqueTypes.push(instance.type);
        }
    }

    // get location of each type's model file by traversing data ELF files (absurdly obtuse)
    for (const uniqueType of uniqueTypes) {
        const type = npcTypes.find(i => i.id === uniqueType)!;
        const assetGroup = npcModels.find(i => i.id === type.modelId)!.assetGroups[0];
        for (const instance of instances) {
            if (instance.type === uniqueType) {
                // store model's name for later when patching its renderer with instance matrices
                instance.resolvedModelName = assetGroup.file;
            }
        }
        const file = await dataFetcher.fetchData(`${pathBase}/${assetGroup.directory}/${assetGroup.file}.bfres.zst`);
        resources.loadBFRES(device, assetGroup.file, BFRES.parse(decompressZST(file)));
        if (assetGroup.file.startsWith("P_") && assetGroup.file !== "P_KNPOLI_ITEM") {
            const texFile = await dataFetcher.fetchData(`${pathBase}/${assetGroup.directory}/${assetGroup.file}.Default.bntx.zst`);
            const textures = BNTX.parse(decompressZST(texFile)).textures;
            // only load in the textures referenced in the materials and texture pattern animation
            const model = resources.modelData.get(assetGroup.file)!;
            const materials = model.materials;
            for (const m of materials) {
                if (!m) {
                    continue;
                }
                for (const n of m.textureName) {
                    const t = textures.find((t) => model.name + "_" + t.name === n);
                    if (t) {
                        if (!t.name.startsWith("Cmn_")) {
                            t.name = `${assetGroup.file}_${t.name}`;
                        }
                        resources.textureHolder.addTexture(device, t);
                    }
                }
            }
            if (model.texturePatternAnimation) {
                for (const n of model.texturePatternAnimation.textureNames) {
                    const t = textures.find((t) => t.name === n); // use unpatched texture name
                    if (t) {
                        if (!t.name.startsWith("Cmn_")) {
                            t.name = `${assetGroup.file}_${t.name}`;
                        }
                        resources.textureHolder.addTexture(device, t);
                    }
                }
            }
        }
    }

    return instances;
}

async function loadLevelObjects(id: string, config: OrigamiLevelConfig, resources: OrigamiResources, dataFetcher: DataFetcher, device: GfxDevice): Promise<LevelObjectInstances> {
    let mobjInstances: OrigamiMobjInstance[] = [];
    if (config.mobj) {
        mobjInstances = await getMobjInstances(id, config, resources, dataFetcher, device);
    }

    let sobjInstances: OrigamiSobjInstance[] = [];
    if (config.sobj) {
        sobjInstances = await getSobjInstances(id, resources, dataFetcher, device);
    }

    let itemInstances: OrigamiItemInstance[] = [];
    if (config.item) {
        itemInstances = await getItemInstances(id, resources, dataFetcher, device);
    }

    let npcInstances: OrigamiNPCInstance[] = [];
    if (config.npc) {
        npcInstances = await getNPCInstances(id, resources, dataFetcher, device);
    }

    return { mobjInstances, sobjInstances, itemInstances, npcInstances };
}

async function patchAltTextures(levelId: string, altTextures: string, resources: OrigamiResources, dataFetcher: DataFetcher, device: GfxDevice) {
    const altBntx = await dataFetcher.fetchData(`${pathBase}/map/field/${altTextures}.bntx.zst`);
    const bntx = BNTX.parse(decompressZST(altBntx));
    const referencedTextureNames: string[] = [];
    const model = resources.modelData.get(levelId)!;

    // patch texture names with tpa (assumes tpa is static)
    if (model.texturePatternAnimation) {
        for (let i = 0; i < model.texturePatternAnimation.materialAnimations.length; i++) {
            const ma = model.texturePatternAnimation.materialAnimations[i];
            for (let j = 0; j < ma.texturePatternAnimations.length; j++) {
                const newTextureName = model.texturePatternFrames.get(i)!.get(j)!.get(0)!;
                const tpa = ma.texturePatternAnimations[j];
                const material = model.materials.find(m => m?.name === ma.name);
                if (material) {
                    material.textureName[material.samplerInfo.findIndex(s => s.name === tpa.samplerName)!] = newTextureName;
                }
            }
        }
    }
    // "turn off" tpa since it's not needed anymore, don't waste frame time on static tpa
    model.texturePatternAnimation = undefined;

    for (const material of model.materials) {
        if (material) {
            referencedTextureNames.push(...material.textureName);
        }
    }

    for (const t of bntx.textures) {
        const patchedName = `${levelId}_${t.name}`;
        if (!referencedTextureNames.includes(patchedName)) {
            continue;
        }
        if (!t.name.startsWith("Cmn_")) {
            t.name = patchedName;
        }
        resources.textureHolder.addTexture(device, t);
    }
}

/*
TODO

Fix UVs that are sometimes the wrong set (top of save block, sea tower walls, etc.)
Figure out level objects for battle stages
Add level variants that share the same base BFRES file (e.g. sensor lab offices and desert, seems to use .probe files)
Add level states (i.e. post-game, before or after story events, etc)
    Ability to hide specific objects from level (rather than blindly rendering all of them)
    Ability to change animation/texture set/etc of shown objects
    Use sets of model renderers by indices and switch with ui panel
Decide how to handle different mobj dispos files
Look in to how water works more, try to remove hardcoded color
Configure hardcoded water color by level
Figure out how "real" ice and lava works
Figure out gobj placement (models are just like other objs)
Figure out additional how additional spa keys map to texsrt values (only have translationT for now)
Add particle effects
Add bloom? Might be too expensive but most levels have enough head room
Remove invisibile bones/shapes with static fbvs's instead of constantly skipping over them
Figure out how phantom models should be loaded (magic circles, vellumental spots, etc.)
Investigate disfigured skeletons of collectible toad variants (messed up in Switch Toolbox too)
Add model color variants, both color pattern and NPC texture sets
Patch model bboxes on first frame of animations with SRT
Add texture whitelist/blacklist to model configs to speed up load times when decompression is required by low end devices
Investigate the .probe and .light files
Investigate instanced rendering (requires some re-work of vertex buffer building if same approach as Casper, otherwise might do uniform buffers instead)
Pre-compute fska SRT values by frame (like BVS/TPA/SPA)
Conditional NPC rotation, their type def has a rotation enum
Debug occasional "status access violation" and "status breakpoint" browser-level errors (not a memory leak, can happen when tabbing out)
Scene setup for kart road and bowser castle on rails segment
*/

const pathBase = "PaperMarioTOK";
class PMTOKScene implements SceneDesc {
    public id: string;
    private levelId: string;

    constructor(private path: string, public name: string, private altTextures?: string) {
        this.id = this.path.split("/").slice(-1)[0];
        this.levelId = this.id;
        if (this.altTextures) {
            this.id += "_" + this.altTextures.split(".")[1];
        }
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const resources = new OrigamiResources(device);
        const renderer = new OrigamiRenderer(device, resources);

        const bfres = await context.dataFetcher.fetchData(`${pathBase}/${this.path}.bfres.zst`);
        const commonBntx = await context.dataFetcher.fetchData(`${pathBase}/graphics/textures/common/default.bntx.zst`);

        if (this.altTextures) {
            resources.loadBFRES(device, this.levelId, BFRES.parse(decompressZST(bfres)), this.id);
        } else {
            resources.loadBFRES(device, this.levelId, BFRES.parse(decompressZST(bfres)));
        }

        // this is messy, will replace with more robust level state system eventually
        // only used for desert day/night variants as of now
        if (this.altTextures) {
            await patchAltTextures(this.levelId, this.altTextures, resources, context.dataFetcher, device);
        }

        // there's not an apparent way to detect if a level has mobj/sobjs etc, so that info is hardcoded as configs
        let config = getOrigamiLevelConfig(this.levelId);
        if (!config) {
            // battle levels don't have configs for now
            if (this.levelId.startsWith("W")) {
                console.warn("No level config found for", this.levelId);
            }
            config = { mobj: false, sobj: false, aobj: false, item: false, npc: false };
        }

        const levelObjects = await loadLevelObjects(this.levelId, config, resources, context.dataFetcher, device);

        resources.loadRequestedCommonTextures(device, decompressZST(commonBntx));

        for (const modelData of resources.modelData.values()) {
            renderer.modelRenderers.push(new OrigamiModelRenderer(renderer.renderHelper.renderCache, resources.textureHolder, modelData));
        }

        patchLevelObjectRenderers(levelObjects, renderer);

        // patch base model renderer
        for (const modelRenderer of renderer.modelRenderers) {
            if (modelRenderer.name.startsWith(this.levelId.slice(0, 4))) {
                modelRenderer.addInstanceMatrix(mat4.create());
                break;
            }
        }

        return renderer;
    }
}

const id = "PMTOK";
const name = "Paper Mario: The Origami King";
const sceneDescs = [
    "Peach's Castle",
    new PMTOKScene("map/field/W0C1_CastleGate", "Outside the Castle"),
    new PMTOKScene("map/field/W0C1_EntranceWay", "Entrance Hallway"),
    new PMTOKScene("map/field/W0C1_MainHall", "Main Room"),
    new PMTOKScene("map/field/W0C1_HelpOlivia", "Dungeon (Rescue Olivia)"),
    new PMTOKScene("map/field/W0C1_WallHole", "Dungeon (Main)"),
    new PMTOKScene("map/field/W0C1_FoldRoom", "Dungeon (Help Bowser)"),
    new PMTOKScene("map/field/W0C1_BasementWay", "Dungeon (Exit)"),
    new PMTOKScene("map/field/W0C1_SpiralStair", "Spiral Staircase"),
    new PMTOKScene("map/field/W0C2_VolcanoCastle", "Top of the Volcano"),
    new PMTOKScene("map/battle/Btl_W0C1_PeachcastleA", "Battle - Peach's Castle"),
    "Whispering Woods",
    new PMTOKScene("map/field/W1C1_WakeUp", "Starting Area"),
    new PMTOKScene("map/field/W1C1_CastleView", "Castle Overlook"),
    new PMTOKScene("map/field/W1C1_LostForest", "Whispering Woods"),
    new PMTOKScene("map/field/W1C1_BigStump", "Whispering Woods (Grandsappy)"),
    new PMTOKScene("map/field/W1C1_CampSite", "Camp Site"),
    new PMTOKScene("map/field/W1C1_LogHouse", "Log Cabin (Interior)"),
    new PMTOKScene("map/battle/Btl_W1C1_MountainA", "Battle - Whispering Woods"),
    "Toad Town",
    new PMTOKScene("map/field/W1G1_KinokoTown", "Toad Town"),
    new PMTOKScene("map/field/W1G1_KinokoTownEnding", "Toad Town (Ending)"),
    new PMTOKScene("map/field/W1G1_MuseumEntrance", "Museum (Entrance)"),
    new PMTOKScene("map/field/W1G1_ArtGallery", "Museum (Art Gallery)"),
    new PMTOKScene("map/field/W1G1_KinopioGallery", "Museum (Toad Gallery)"),
    new PMTOKScene("map/field/W1G1_CollectableGallery", "Museum (Collectible Gallery)"),
    new PMTOKScene("map/field/W1G1_EnemyGallery", "Museum (Enemy Gallery)"),
    new PMTOKScene("map/field/W1G1_SoundGallery", "Museum (Sound Gallery)"),
    new PMTOKScene("map/field/W1G1_HouseA", "House 1"),
    new PMTOKScene("map/field/W1G1_HouseB", "House 2"),
    new PMTOKScene("map/field/W1G1_HouseC", "House 3"),
    new PMTOKScene("map/field/W1G1_HouseD", "House 4"),
    new PMTOKScene("map/field/W1G1_HouseE", "House 5"),
    new PMTOKScene("map/field/W1G1_HouseF", "House 6"),
    new PMTOKScene("map/field/W1G1_HouseG", "House 7"),
    new PMTOKScene("map/field/W1G1_KinopioHouse", "Mushroom House"),
    // new PMTOKScene("map/field/W1G1_KartRoad", "Kart Road (Opening Cutscene)"), // disabled for now until scene setup is figured out
    new PMTOKScene("map/field/W1G1_DokanRoom", "Pipe Room"),
    new PMTOKScene("map/field/W1G1_Shop", "Item Shop"),
    new PMTOKScene("map/field/W1G1_BattleLab", "Battle Lab"),
    new PMTOKScene("map/field/W1G1_StoreRoom", "Storage (Main Room)"),
    new PMTOKScene("map/field/W1G1_BackRoom", "Storage (Back Room)"),
    new PMTOKScene("map/field/W1G1_CastleGate", "Peach's Castle Rubble"),
    new PMTOKScene("map/battle/Btl_W1G1_KinokoTownA", "Battle - Toad Town"),
    new PMTOKScene("map/battle/Btl_W1G1_KinokoTownB", "Battle - Toad Town Underground"),
    "Graffiti Underground",
    new PMTOKScene("map/field/W1C2_BasementFirst", "1st Floor"),
    new PMTOKScene("map/field/W1C2_BasementSecond", "2nd Floor"),
    new PMTOKScene("map/field/W1C2_BasementThird", "3rd Floor"),
    new PMTOKScene("map/field/W1C2_TurnValve", "Main Room"),
    new PMTOKScene("map/field/W1C2_HelpKinopio", "Side Room"),
    new PMTOKScene("map/battle/Btl_W1C2_WaterwayA", "Battle - Graffiti Underground"),
    "Picnic Road",
    new PMTOKScene("map/field/W1G2_Hill", "Picnic Road"),
    new PMTOKScene("map/field/W7C1_KinopioHouse", "Sensor Lab"),
    new PMTOKScene("map/battle/Btl_W1G2_HillA", "Battle - Picnic Road"),
    "Overlook Moutain",
    new PMTOKScene("map/field/W1G3_Observatory", "Overlook Mountain"),
    new PMTOKScene("map/field/W1G3_GondolaLift", "Gondola Lift"),
    new PMTOKScene("map/battle/Btl_W1G3_ObservatoryA", "Battle - Overlook Mountain"),
    "Earth Vellumental Temple",
    new PMTOKScene("map/field/W1C3_UpDownRock", "Temple Path"),
    new PMTOKScene("map/field/W1C3_BigTurtle", "Entrance"),
    new PMTOKScene("map/field/W1C3_PushRock", "Side Room 1"),
    new PMTOKScene("map/field/W1C3_RollingTurtle", "Side Room 2"),
    new PMTOKScene("map/field/W1C3_BossArea", "Boss Room"),
    new PMTOKScene("map/battle/Btl_W1C3_CaveA", "Battle - Earth Vellumental Temple"),
    new PMTOKScene("map/battle/Btl_W1C3_CaveBossA", "Battle - Earth Vellumental Temple (Boss)"),
    "Overlook Tower",
    new PMTOKScene("map/field/W1C4_FirstFloor", "1st Floor"),
    new PMTOKScene("map/field/W1C4_SecondFloor", "2nd Floor"),
    new PMTOKScene("map/field/W1C4_ThirdFloor", "3rd Floor"),
    new PMTOKScene("map/field/W1C4_FourthFloor", "4th Floor"),
    new PMTOKScene("map/field/W1C4_Elevator", "Elevator"),
    new PMTOKScene("map/field/W1C4_BossArea", "Top of the Tower"),
    new PMTOKScene("map/battle/Btl_W1C4_TenbouTowerA", "Battle - Overlook Tower"),
    new PMTOKScene("map/battle/Btl_W1C4_TenbouTowerBossA", "Battle - Overlook Tower (Boss)"),
    "Autumn Mountain",
    new PMTOKScene("map/field/W2G1_MomijiMountain", "Autumn Mountain"),
    new PMTOKScene("map/field/W2C1_IgaguriValley", "Chestnut Valley"),
    new PMTOKScene("map/field/W2C3_DownRiver", "Eddy River"),
    new PMTOKScene("map/battle/Btl_W2G1_MomijiMountainA", "Battle - Autumn Mountain"),
    "Water Vellumental Shrine",
    new PMTOKScene("map/field/W2C2_EntranceDragon", "Main Room"),
    new PMTOKScene("map/field/W2C2_CrabIntro", "Crab Room"),
    new PMTOKScene("map/field/W2C2_BoxMaze", "Box Maze"),
    new PMTOKScene("map/field/W2C2_CryDragon", "Water Wheels"),
    new PMTOKScene("map/field/W2C2_PuzzleEasy", "Slide Puzzle (Easy)"),
    new PMTOKScene("map/field/W2C2_PuzzleHard", "Slide Puzzle (Hard)"),
    new PMTOKScene("map/field/W2C2_LoopWay", "Interstitial Room"),
    new PMTOKScene("map/field/W2C2_PanelGetA", "Secret Room 1"),
    new PMTOKScene("map/field/W2C2_PanelGetB", "Secret Room 2"),
    new PMTOKScene("map/field/W2C2_BossArea", "Boss Room"),
    new PMTOKScene("map/battle/Btl_W2C2_WaterCaveA", "Battle - Water Vellumental Shrine"),
    new PMTOKScene("map/battle/Btl_W2C2_WaterCaveBossA", "Battle - Water Vellumental Shrine (Boss)"),
    "Shogun Studios",
    new PMTOKScene("map/field/W2G2_CastlePark", "Shogun Studios"),
    new PMTOKScene("map/field/W2G2_HouseA", "House 1"),
    new PMTOKScene("map/field/W2G2_HouseE", "House 2"),
    new PMTOKScene("map/field/W2G2_HouseF", "House 3"),
    new PMTOKScene("map/field/W2G2_HouseH", "House 4"),
    new PMTOKScene("map/field/W2G2_LongHouseA", "Long House 1"),
    new PMTOKScene("map/field/W2G2_LongHouseB", "Long House 2"),
    new PMTOKScene("map/field/W2G2_HitTarget", "Shuriken Minigame"),
    new PMTOKScene("map/field/W2G2_PhotoStudio", "Photo Studio"),
    new PMTOKScene("map/field/W2G2_Shop", "Shop"),
    new PMTOKScene("map/field/W2G2_ShopUpstairs", "Shop (Upstairs)"),
    new PMTOKScene("map/field/W2G2_StaffRoom", "Staff Room"),
    new PMTOKScene("map/field/W2G2_TeaRoom", "Tea Building"),
    new PMTOKScene("map/battle/Btl_W2G2_CastleParkA", "Battle - Shogun Studios"),
    "Ninja Attraction",
    new PMTOKScene("map/field/W2C4_StartGoal", "Outside"),
    new PMTOKScene("map/field/W2C4_EntranceWay", "Entrance Room"),
    new PMTOKScene("map/field/W2C4_HangingScroll", "Hanging Scroll Room"),
    new PMTOKScene("map/field/W2C4_TatamiFlip", "Panel Flip Room"),
    new PMTOKScene("map/field/W2C4_TeaHouse", "Tea House"),
    new PMTOKScene("map/field/W2C4_StaffRoom", "Staff Room"),
    new PMTOKScene("map/field/W2C4_MaintenanceRoom", "Maintenance Room"),
    new PMTOKScene("map/field/W2C4_SpearTrap", "Spear Trap"),
    new PMTOKScene("map/field/W2C4_CabinetStair", "File Cabinet Room"),
    new PMTOKScene("map/field/W2C4_PressWall", "Thwomp Wall Room"),
    new PMTOKScene("map/field/W2C4_GoalRoom", "Goal Room"),
    new PMTOKScene("map/battle/Btl_W2C4_NinjyayashikiA", "Battle - Ninja Attraction"),
    "Big Sho' Theater",
    new PMTOKScene("map/field/W2C5_EntranceGate", "Outside"),
    new PMTOKScene("map/field/W2C5_Lobby", "Lobby"),
    new PMTOKScene("map/field/W2C5_FirstTheater", "Stage 1"),
    new PMTOKScene("map/field/W2C5_SecondTheater", "Stage 2"),
    new PMTOKScene("map/field/W2C5_ThirdTheater", "Stage 3"),
    new PMTOKScene("map/field/W2C5_FourthTheater", "Stage 4"),
    new PMTOKScene("map/battle/Btl_W2C5_GekijouBossA", "Battle - Big Sho' Theater"),
    "The Princess Peach",
    new PMTOKScene("map/field/W4C1_ShipDeck", "The Princess Peach"),
    new PMTOKScene("map/field/W4C1_ControlRoom", "Bridge"),
    new PMTOKScene("map/field/W4C1_EngineRoom", "Engine Room"),
    new PMTOKScene("map/field/W4C1_GuestPassage", "Guest Area Hallway"),
    new PMTOKScene("map/field/W4C1_GuestAreaFirst", "Guest Area (1st Floor)"),
    new PMTOKScene("map/field/W4C1_GuestAreaSecond", "Guest Area (2nd Floor)"),
    new PMTOKScene("map/field/W4C1_Lounge", "Lounge"),
    new PMTOKScene("map/field/W4C1_StaffPassage", "Staff Hallway"),
    new PMTOKScene("map/field/W4C1_StaffAreaFirst", "Staff Area (1st Floor)"),
    new PMTOKScene("map/field/W4C1_StaffAreaSecond", "Staff Area (2nd Floor)"),
    new PMTOKScene("map/field/W4C1_StoreRoom", "Storage Room"),
    new PMTOKScene("map/field/W4C1_VIPRoom", "VIP Room"),
    new PMTOKScene("map/field/W4C1_GessoArea", "Gooper Blooper Arena"),
    new PMTOKScene("map/battle/Btl_W4C1_PeachShipA", "Battle - The Princess Peach"),
    "Sweetpaper Valley",
    new PMTOKScene("map/field/W3G1_Canyon", "Sweetpaper Valley"),
    "Breezy Tunnel",
    new PMTOKScene("map/field/W3C1_Tunnel", "Breezy Tunnel"),
    new PMTOKScene("map/field/W3C1_LeftPassage", "Side Room 1"),
    new PMTOKScene("map/field/W3C1_RoomA", "Side Room 2"),
    new PMTOKScene("map/field/W3C1_FindOlivia", "Cheer Up Olivia"),
    new PMTOKScene("map/field/W3C1_TunnelExit", "Breezy Tunnel Exit"),
    new PMTOKScene("map/battle/Btl_W3C1_TunnelA", "Battle - Breezy Tunnel"),
    "Scorching Sandpaper Desert",
    new PMTOKScene("map/field/W3G2_Desert", "Scorching Sandpaper Desert (Night)", "W3G2_Desert.0001"),
    new PMTOKScene("map/field/W3G2_Desert", "Scorching Sandpaper Desert (Day)", "W3G2_Desert.0002"),
    new PMTOKScene("map/field/W3G2_DesertRuin", "Desert Ruin"),
    new PMTOKScene("map/field/W3G2_IceKinopio", "Rescue Captain T. Ode"),
    new PMTOKScene("map/field/W3G2_KinopioTop", "Tower Top"),
    new PMTOKScene("map/field/W3G2_KinopioTopRe", "Tower Top Reversed"),
    new PMTOKScene("map/field/W3G2_OasisLeft", "West of Shroom City"),
    new PMTOKScene("map/field/W3G2_OasisRight", "East of Shroom City"),
    new PMTOKScene("map/field/W3G2_RuinLeft", "Ruin (West)"),
    new PMTOKScene("map/field/W3G2_RuinRight", "Ruin (East)"),
    new PMTOKScene("map/field/W3G2_SamboArea", "Giant Pokey Arena"),
    new PMTOKScene("map/battle/Btl_W3G2_DesertA", "Battle - Scorching Sandpaper Desert"),
    "Shroom City",
    new PMTOKScene("map/field/W3G3_Oasis", "Shroom City"),
    new PMTOKScene("map/field/W3G3_HotelLobby", "Hotel Lobby"),
    new PMTOKScene("map/field/W3G3_HotelPool", "Hotel Pool"),
    new PMTOKScene("map/field/W3G3_LeftPassage", "Hotel Hallway (Left)"),
    new PMTOKScene("map/field/W3G3_RightPassage", "Hotel Hallway (Right)"),
    new PMTOKScene("map/field/W3G3_LeftRoomL", "Hotel Room (Left)"),
    new PMTOKScene("map/field/W3G3_LeftRoomR", "Hotel Room (Right)"),
    new PMTOKScene("map/field/W3G3_SuiteRoom", "Hotel Suite"),
    new PMTOKScene("map/field/W3G3_HouseA", "House 1"),
    new PMTOKScene("map/field/W3G3_HouseB", "House 2"),
    new PMTOKScene("map/field/W3G3_HouseC", "House 3"),
    new PMTOKScene("map/field/W3G3_HouseD", "House 4"),
    new PMTOKScene("map/field/W3G3_HouseE", "House 5"),
    "Fire Vellumental Cave",
    new PMTOKScene("map/field/W3C3_EntranceWay", "Entrance"),
    new PMTOKScene("map/field/W3C3_LightMemory", "Memory Puzzle"),
    new PMTOKScene("map/field/W3C3_FireBucketA", "Oil Bucket Room"),
    new PMTOKScene("map/field/W3C3_FireJump", "Platforming Room"),
    new PMTOKScene("map/field/W3C3_FallBird", "Falling Statues Room"),
    new PMTOKScene("map/field/W3C3_BossArea", "Boss Room"),
    new PMTOKScene("map/battle/Btl_W3C3_FirecaveA", "Battle - Fire Vellumental Cave"),
    new PMTOKScene("map/battle/Btl_W3C3_FirecaveBossA", "Battle - Fire Vellumental Cave (Boss)"),
    "Temple of Shrooms",
    new PMTOKScene("map/field/W3C4_Desert", "Desert Activation Area"),
    new PMTOKScene("map/field/W3C4_Outside", "Outside Entrance"),
    new PMTOKScene("map/field/W3C4_EntranceWay", "Entrance Hallway"),
    new PMTOKScene("map/field/W3C4_TwoKinopio", "Twin Statues Room"),
    new PMTOKScene("map/field/W3C4_HorrorWay", "Horror Hallway"),
    new PMTOKScene("map/field/W3C4_MummyKuriboArea", "Mummy Goomba Room"),
    new PMTOKScene("map/field/W3C4_FourSwitch", "Four Switches Puzzle"),
    new PMTOKScene("map/field/W3C4_TreasureRoom", "Treasure Chest Room"),
    new PMTOKScene("map/field/W3C4_MoveStatue", "Statue Hallway"),
    new PMTOKScene("map/field/W3C4_KanokeHall", "Coffin Puzzle"),
    new PMTOKScene("map/field/W3C4_FallStatue", "Falling Statue Hallway"),
    new PMTOKScene("map/field/W3C4_PilePuzzle", "Star Puzzle"),
    new PMTOKScene("map/field/W3C4_DiscoEntrance", "Disco Hall Entrance"),
    new PMTOKScene("map/field/W3C4_DiscoHall", "Disco Hall"),
    new PMTOKScene("map/field/W3C4_SpiderNest", "Spider Nest"),
    new PMTOKScene("map/field/W3C4_FavoriteCD", "CD Room"),
    new PMTOKScene("map/battle/Btl_W3C4_RuinB", "Battle - Temple of Shrooms"),
    new PMTOKScene("map/battle/Btl_W3C4_RuinA", "Battle - Temple of Shrooms (Disco Hall)"),
    new PMTOKScene("map/battle/Btl_W3C4_RuinBossA", "Battle - Temple of Shrooms (Boss)"),
    "The Great Sea",
    new PMTOKScene("map/field/W4G1_Ocean", "The Great Sea"),
    new PMTOKScene("map/field/W4G1_Ship", "Boat at Sea"),
    new PMTOKScene("map/field/W4G1_UnderSeaA", "Underwater"),
    new PMTOKScene("map/field/W4G1_DokuroIsland", "Bonehead Island"),
    new PMTOKScene("map/field/W4G1_DokuroFirst", "Bonehead Island (Interior 1)"),
    new PMTOKScene("map/field/W4G1_DokuroSecond", "Bonehead Island (Interior 2)"),
    new PMTOKScene("map/field/W4G1_HeartIsland", "Heart Island"),
    new PMTOKScene("map/field/W4G1_KinokoIsland", "Mushroom Island"),
    new PMTOKScene("map/field/W4G1_KinopioHouse", "Mushroom Island (House)"),
    new PMTOKScene("map/field/W4G1_BasementStair", "Mushroom Island (Basement Stairs)"),
    new PMTOKScene("map/field/W4G1_OrigamiStudio", "Mushroom Island (Origami Studio)"),
    new PMTOKScene("map/field/W4G1_HammerIsland", "Hammer Island"),
    new PMTOKScene("map/field/W4G1_HatenaIsland", "? Island"),
    new PMTOKScene("map/field/W4G1_CloverIsland", "Club Island"),
    new PMTOKScene("map/field/W4G1_MoonIsland", "Full Moon Island"),
    new PMTOKScene("map/field/W4G1_UnderSeaMoonIsland", "Full Moon Island (Underwater)"),
    new PMTOKScene("map/field/W4G1_SpadeIsland", "Spade Island"),
    new PMTOKScene("map/field/W4G1_RingIsland", "Scuffle Island"),
    new PMTOKScene("map/battle/Btl_W4G1_OceanA", "Battle - The Great Sea"),
    "Diamond Island",
    new PMTOKScene("map/field/W4G2_OrbIsland", "Diamond Island"),
    new PMTOKScene("map/field/W4G1_UnderSeaOrb", "Diamond Island (Underwater)"),
    new PMTOKScene("map/field/W4G2_CourageEntrance", "Trial Entrance"),
    new PMTOKScene("map/field/W4G2_CourageLevel1", "Courage Trial"),
    new PMTOKScene("map/field/W4G2_WisdomLevel1", "Wisdom Trial"),
    new PMTOKScene("map/field/W4G2_CourageOrb", "Trial Reward Room"),
    "Ice Vellumental Mountain",
    new PMTOKScene("map/field/W4C2_IceEntrance", "Entrance"),
    new PMTOKScene("map/field/W4C2_JumpStart", "Jump Start"),
    new PMTOKScene("map/field/W4C2_BigJump", "Big Jump"),
    new PMTOKScene("map/field/W4C2_IceSlide", "Ice Slide"),
    new PMTOKScene("map/field/W4C2_PuzzleTutorial", "Slide Puzzle (Tutorial)"),
    new PMTOKScene("map/field/W4C2_PuzzleEasy", "Slide Puzzle (Easy)"),
    new PMTOKScene("map/field/W4C2_PuzzleHard", "Slide Puzzle (Hard)"),
    new PMTOKScene("map/field/W4C2_PuzzleResetA", "Puzzle Reset Room"),
    new PMTOKScene("map/field/W4C2_SpiralStair", "Spiral Staircase"),
    new PMTOKScene("map/field/W4C2_BossArea", "Boss Room"),
    new PMTOKScene("map/battle/Btl_W4C2_IceMountainA", "Battle - Ice Vellumental Mountain"),
    new PMTOKScene("map/battle/Btl_W4C2_IceMountainBossA", "Battle - Ice Vellumental Mountain (Boss)"),
    "Sea Tower",
    new PMTOKScene("map/field/W4C3_OrbTower", "Sea Tower"),
    new PMTOKScene("map/field/W4C3_OutSideA", "Outside (Lower)"),
    new PMTOKScene("map/field/W4C3_OutSideB", "Outside (Upper)"),
    new PMTOKScene("map/field/W4C3_EarthArea", "Earth Room"),
    new PMTOKScene("map/field/W4C3_WaterArea", "Water Room"),
    new PMTOKScene("map/field/W4C3_EarthWater", "Earth/Water Room"),
    new PMTOKScene("map/field/W4C3_FireArea", "Fire Room"),
    new PMTOKScene("map/field/W4C3_FireIce", "Fire/Ice Room"),
    new PMTOKScene("map/field/W4C3_PuzzleReset", "Puzzle Reset Room"),
    new PMTOKScene("map/field/W4C3_FourGod", "Four Vellumentals Room"),
    new PMTOKScene("map/field/W4C3_BossArea", "Top of Sea Tower"),
    new PMTOKScene("map/battle/Btl_W4C3_OrbTowerA", "Battle - Sea Tower"),
    new PMTOKScene("map/battle/Btl_W4C3_OrbTowerBossA", "Battle - Sea Tower (Boss)"),
    "Shangri-Spa",
    new PMTOKScene("map/field/W5G1_SkySpa", "Shangri-Spa"),
    new PMTOKScene("map/field/W5G1_SpaEntrance", "Spa Entrance"),
    new PMTOKScene("map/field/W5G1_SpaRoom", "Spa Room"),
    new PMTOKScene("map/field/W5G1_DokanRoom", "Pipe Room"),
    new PMTOKScene("map/battle/Btl_W5G1_SkySpaA", "Battle - Shangri-Spa"),
    new PMTOKScene("map/battle/Btl_W5G1_SkySpaBossA", "Battle - Shangri-Spa (Boss)"),
    "Spring of Jungle Mist",
    new PMTOKScene("map/field/W5C2_BreakBridge", "Entrance"),
    new PMTOKScene("map/field/W5C2_JungleSpa", "Spring of Jungle Mist"),
    new PMTOKScene("map/field/W5C2_BigTreeFirst", "Big Tree (1st Level)"),
    new PMTOKScene("map/field/W5C2_BigTreeSecond", "Big Tree (2nd Level)"),
    new PMTOKScene("map/field/W5C2_BigTreeThird", "Big Tree (3rd Level)"),
    new PMTOKScene("map/field/W5C2_DeepJungle", "Deep Jungle"),
    new PMTOKScene("map/field/W5C2_DeadEnd", "Dead End 1"),
    new PMTOKScene("map/field/W5C2_DeadEndB", "Dead End 2"),
    new PMTOKScene("map/field/W5C2_LeafMemory", "Leaf Memory Puzzle"),
    new PMTOKScene("map/battle/Btl_W5C2_JungleA", "Battle - Spring of Jungle Mist"),
    "Spring of Rainbows",
    new PMTOKScene("map/field/W5C1_CliffWay", "Cliff Way"),
    new PMTOKScene("map/field/W5C1_QuizRoom", "Quiz Room"),
    new PMTOKScene("map/field/W5C1_RaceQuiz", "Quiz Race"),
    new PMTOKScene("map/field/W5C1_SecretSpa", "Spring of Rainbows"),
    new PMTOKScene("map/field/W5C1_SteamFirst", "Steam Area"),
    new PMTOKScene("map/battle/Btl_W5C1_QuizA", "Battle - Spring of Rainbows"),
    "Bowser's Castle",
    new PMTOKScene("map/field/W5C3_EntranceWay", "Entrance Hallway"),
    new PMTOKScene("map/field/W5C3_MainHall", "Main Room"),
    new PMTOKScene("map/field/W5C3_MetStatue", "Buzzy Beetle Statue Puzzle"),
    new PMTOKScene("map/field/W5C3_BlackHandAreaSide", "Black Hand Hallway"),
    new PMTOKScene("map/field/W5C3_PillarPassage", "Broken Pillars Room"),
    new PMTOKScene("map/field/W5C3_ResidenceFloor", "Guest Rooms"),
    new PMTOKScene("map/field/W5C3_RoomA", "Guest Room (Window Peek)"),
    new PMTOKScene("map/field/W5C3_SavePoint", "Save Room"),
    // new PMTOKScene("map/field/W5C3_Shooting", "Shooting Gallery 1"), // disabled for now, need to figure out dynamic placement of objects, scene setup
    // new PMTOKScene("map/field/W5C3_ShootingDemoAfter", "Shooting Gallery 2"),
    // new PMTOKScene("map/field/W5C3_ShootingDemoBefore", "Shooting Gallery 3"),
    new PMTOKScene("map/field/W5C3_ThroneRoom", "Throne Room"),
    new PMTOKScene("map/field/W5C3_Dockyard", "Dockyard"),
    new PMTOKScene("map/battle/Btl_W5C3_KoopaCastleA", "Battle - Bowser's Castle"),
    new PMTOKScene("map/battle/Btl_W5C3_KoopaCastleBossA", "Battle - Bowser's Castle (Boss 1)"),
    new PMTOKScene("map/battle/Btl_W5C3_KoopaCastleBossB", "Battle - Bowser's Castle (Boss 2)"),
    "Volcano",
    new PMTOKScene("map/field/W6C1_Volcano", "Inside the Volcano"),
    new PMTOKScene("map/field/W6C2_CollapsedWall", "Peach's Castle Broken Wall"),
    new PMTOKScene("map/field/W6C2_CastleGate", "Top of the Volcano (Peach's Castle)"),
    new PMTOKScene("map/field/W6C2_OrigamiCastle", "Top of the Volcano (Origami Castle)"),
    new PMTOKScene("map/battle/Btl_W6C2_OrigamiCastleA", "Battle - Top of the Volcano (Origami Castle)"),
    "Origami Castle",
    new PMTOKScene("map/field/W6C2_EnemyRush", "Entrance Hall"),
    new PMTOKScene("map/field/W6C2_FirstFloor", "First Floor"),
    new PMTOKScene("map/field/W6C2_SecondFloor", "Second Floor"),
    new PMTOKScene("map/field/W6C2_ThirdFloor", "Third Floor"),
    new PMTOKScene("map/field/W6C2_GrowRoom", "Grow Room"),
    new PMTOKScene("map/field/W6C2_LateralLift", "Side Room"),
    new PMTOKScene("map/field/W6C2_PopUpBox", "Pop-Up Box Room"),
    new PMTOKScene("map/field/W6C2_InsideBox", "Pop-Up Box Room (Interior)"),
    new PMTOKScene("map/field/W6C2_StairRoomA", "Stairway 1"),
    new PMTOKScene("map/field/W6C2_StairRoomC", "Stairway 2"),
    new PMTOKScene("map/field/W6C2_ThroneRoom", "Throne Room"),
    new PMTOKScene("map/field/W6C2_LastBossArea", "Final Boss Arena"),
    new PMTOKScene("map/battle/Btl_W6C2_OrigamiCastleB", "Battle - Origami Castle"),
    new PMTOKScene("map/battle/Btl_W6C2_OrigamiCastleBossA", "Battle - Origami Castle (Boss)"),
    "Other",
    new PMTOKScene("map/field/W7C1_KinokoRoomA", "Sensor Lab Office"),
    new PMTOKScene("map/field/W7C1_RadarTutorialA", "Sensor Lab Interior"),
    new PMTOKScene("map/field/W7C2_CafeRoomA", "Cafe Room")
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
