import * as BNTX from "../fres_nx/bntx.js";
import * as BFRES from "../fres_nx/bfres.js";
import { decompress } from "fzstd";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { ModelData } from "./render_data.js";
import { OrigamiModelRenderer } from "./render.js";
import { ELFType, ItemInstance, ItemType, MObjInstance, SObjInstance, MObjType, ModelDef, parseELF, NPCInstance } from "./bin_elf.js";
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

interface OrigamiLevelObjects {
    mobjInstances: MObjInstance[];
    sobjInstances: SObjInstance[];
    itemInstances: ItemInstance[];
    npcInstances: NPCInstance[];
}

export class OrigamiResources {
    // Adapated from Odyssey's ResourceSystem class
    public textureHolder = new OrigamiTextureHolder();
    public modelData = new Map<string, ModelData>();
    private renderCache: GfxRenderCache;
    private loadedBFRESNames: string[] = [];
    private requestedCommonTextures: string[] = [];

    constructor(device: GfxDevice) {
        this.renderCache = new GfxRenderCache(device);
    }

    private loadBFRESTextures(device: GfxDevice, name: string, bfres: BFRES.FRES, search: string) {
        const embeddedTextureFile = bfres.externalFiles.find((f) => f.name.endsWith(search));
        if (embeddedTextureFile) {
            const bntx = BNTX.parse(embeddedTextureFile.buffer);
            for (const t of bntx.textures) {
                if (!t.name.startsWith("Cmn_")) {
                    t.name = `${name}_${t.name}`;
                }
                this.textureHolder.addTexture(device, t);
            }
        }
    }

    public loadBFRES(device: GfxDevice, name: string, bfres: BFRES.FRES) {
        if (!this.loadedBFRESNames.includes(name)) {
            this.loadedBFRESNames.push(name);
            this.loadBFRESTextures(device, name, bfres, ".bntx");
            // load default language texture set if it exists
            this.loadBFRESTextures(device, name, bfres, ".en-US.bntx");
            const model = bfres.fmdl[0];
            const config = getOrigamiModelConfig(model.name);
            this.modelData.set(model.name, new ModelData(this.renderCache, bfres, config));
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
    private resources: OrigamiResources;
    public renderHelper: GfxRenderHelper;
    public textureHolder: OrigamiTextureHolder;
    public modelRenderers: OrigamiModelRenderer[] = [];

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public setResources(res: OrigamiResources) {
        this.resources = res;
        this.textureHolder = res.textureHolder;
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
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);
        this.prepareToRender(device, viewerInput);
        builder.execute();
        this.renderInstListMain.reset();
    }

    private prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.renderHelper.pushTemplateRenderInst();
        for (const renderer of this.modelRenderers) {
            renderer.prepareToRender(device, renderInstManager, viewerInput);
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

async function loadLevelObjects(id: string, config: OrigamiLevelConfig, resources: OrigamiResources, dataFetcher: DataFetcher, device: GfxDevice): Promise<OrigamiLevelObjects> {
    const mobjInstances = [];
    if (config.mobj) {
        const worldId = id.substring(0, 2);
        const levelGroupId = id.substring(0, 4);

        const mobjTypes: MObjType[] = [];
        for (const s of ["data_mobj_Cmn", `data_mobj_${worldId}_Cmn`, `data_mobj_${levelGroupId}`]) {
            const file = await dataFetcher.fetchData(`${pathBase}/data/mobj/${s}.elf.zst`);
            mobjTypes.push(...parseELF(decompressZST(file), ELFType.MobjType) as MObjType[]);
        }
        if (config.aobj) {
            const file = await dataFetcher.fetchData(`${pathBase}/data/mobj/data_aobj.elf.zst`);
            mobjTypes.push(...parseELF(decompressZST(file), ELFType.MobjType) as MObjType[]);
        }

        const mobjModels: ModelDef[] = [];
        for (const s of ["data_mobj_model_Cmn", `data_mobj_model_${worldId}_Cmn`, `data_mobj_model_${levelGroupId}`]) {
            const file = await dataFetcher.fetchData(`${pathBase}/data/mobj_model/${s}.elf.zst`);
            mobjModels.push(...parseELF(decompressZST(file), ELFType.MobjModel) as ModelDef[]);
        }

        for (const mobj of config.altMobj !== undefined ? config.altMobj : ["Mobj"]) {
            const file = await dataFetcher.fetchData(`${pathBase}/data/map/${id}/dispos_${mobj}.elf.zst`);
            mobjInstances.push(...parseELF(decompressZST(file), ELFType.DisposMobj) as MObjInstance[]);
        }
        if (config.aobj) {
            const file = await dataFetcher.fetchData(`${pathBase}/data/map/${id}/dispos_Aobj.elf.zst`);
            mobjInstances.push(...parseELF(decompressZST(file), ELFType.DisposAobj) as MObjInstance[]);
        }

        const types: string[] = [];
        for (const instance of mobjInstances) {
            if (!types.includes(instance.type)) {
                types.push(instance.type);
            }
        }

        // get location of each type's model file by traversing data ELF files (absurdly obtuse)
        for (const type of types) {
            const mobjType = mobjTypes.find(m => m.id === type)!;
            const assetGroup = mobjModels.find(m => m.id === mobjType.modelId)!.assetGroups[0];
            for (const instance of mobjInstances) {
                if (instance.type === type) {
                    // store model's name for later when patching its renderer with instance matrices
                    instance.resolvedModelName = assetGroup.file;
                }
            }
            const file = await dataFetcher.fetchData(`${pathBase}/${assetGroup.directory}/${assetGroup.file}.bfres.zst`);
            resources.loadBFRES(device, assetGroup.file, BFRES.parse(decompressZST(file)));
        }
    }

    const sobjInstances: SObjInstance[] = [];
    // if (config.sobj) {
    //     const disposFile = await dataFetcher.fetchData(`${pathBase}/data/map/${id}/dispos_Sobj.elf.zst`);
    //     sobjInstances.push(...parseELF(decompressZST(disposFile), ELFType.DisposSobj) as SObjInstance[]);

    //     const uniqueModels: Map<string, string> = new Map();
    //     for (const instance of sobjInstances) {
    //         if (!uniqueModels.has(instance.modelName)) {
    //             uniqueModels.set(instance.modelName, instance.modelPath);
    //         }
    //     }

    //     for (const [modelName, modelPath] of uniqueModels.entries()) {
    //         const file = await dataFetcher.fetchData(`${pathBase}/${modelPath}/${modelName}.bfres.zst`);
    //         resources.loadBFRES(device, modelName, BFRES.parse(decompressZST(file)));
    //     }
    // }

    const itemInstances: ItemInstance[] = [];
    if (config.item) {
        const typesFile = await dataFetcher.fetchData(`${pathBase}/data/data_item.elf.zst`);
        const itemTypes = parseELF(decompressZST(typesFile), ELFType.ItemType) as ItemType[];
        const modelsFile = await dataFetcher.fetchData(`${pathBase}/data/data_item_model.elf.zst`);
        const itemModels = parseELF(decompressZST(modelsFile), ELFType.ItemModel) as ModelDef[];
        const disposFile = await dataFetcher.fetchData(`${pathBase}/data/map/${id}/dispos_Item.elf.zst`)
        itemInstances.push(...parseELF(decompressZST(disposFile), ELFType.DisposItem) as ItemInstance[]);

        const types: string[] = [];
        for (const instance of itemInstances) {
            if (!types.includes(instance.type)) {
                types.push(instance.type);
            }
        }

        // get location of each type's model file by traversing data ELF files (absurdly obtuse)
        for (const type of types) {
            const itemType = itemTypes.find(i => i.id === type)!;
            const assetGroup = itemModels.find(i => i.id === itemType.modelId)!.assetGroups[0];
            for (const instance of itemInstances) {
                if (instance.type === type) {
                    // store model's name for later when patching its renderer with instance matrices
                    instance.resolvedModelName = assetGroup.file;
                }
            }
            const file = await dataFetcher.fetchData(`${pathBase}/${assetGroup.directory}/${assetGroup.file}.bfres.zst`);
            resources.loadBFRES(device, assetGroup.file, BFRES.parse(decompressZST(file)));
        }
    }

    const npcInstances: NPCInstance[] = [];
    // if (config.npc) {
    //     const typesFile = await dataFetcher.fetchData(`${pathBase}/data/data_npc.elf.zst`);
    //     const npcTypes = parseELF(decompressZST(typesFile), ELFType.NPCType) as NPCType[];
    //     const modelsFile = await dataFetcher.fetchData(`${pathBase}/data/data_npc_model.elf.zst`);
    //     const npcModels = parseELF(decompressZST(modelsFile), ELFType.NPCModel) as ModelDef[];
    //     const disposFile = await dataFetcher.fetchData(`${pathBase}/data/map/${id}/dispos_Npc.elf.zst`);
    //     npcInstances.push(...parseELF(decompressZST(disposFile), ELFType.DisposNPC) as NPCInstance[]);

    //     const types: string[] = [];
    //     for (const instance of npcInstances) {
    //         if (!types.includes(instance.type)) {
    //             types.push(instance.type);
    //         }
    //     }

    //     // get location of each type's model file by traversing data ELF files (absurdly obtuse)
    //     for (const type of types) {
    //         const npcType = npcTypes.find(i => i.id === type)!;
    //         const assetGroup = npcModels.find(i => i.id === npcType.modelId)!.assetGroups[0];
    //         for (const instance of npcInstances) {
    //             if (instance.type === type) {
    //                 // store model's name for later when patching its renderer with instance matrices
    //                 instance.resolvedModelName = assetGroup.file;
    //             }
    //         }
    //         const file = await dataFetcher.fetchData(`${pathBase}/${assetGroup.directory}/${assetGroup.file}.bfres.zst`);
    //         resources.loadBFRES(device, assetGroup.file, BFRES.parse(decompressZST(file)));
    //         if (assetGroup.file.startsWith("P_")) {
    //             const texFile = await dataFetcher.fetchData(`${pathBase}/${assetGroup.directory}/${assetGroup.file}.Default.bntx.zst`);
    //             const textures = BNTX.parse(decompressZST(texFile)).textures;
    //             // only load in the textures referenced in the materials
    //             const materials = resources.modelData.get(assetGroup.file)!.model.fmat;
    //             for (const m of materials) {
    //                 for (const n of m.textureName) {
    //                     const t = textures.find((t) => t.name === n);
    //                     if (t) {
    //                         if (!t.name.startsWith("Cmn_")) {
    //                             t.name = `${assetGroup.file}_${t.name}`;
    //                         }
    //                         if (!resources.textureHolder.textureNames.includes(t.name)) {
    //                             resources.textureHolder.addTexture(device, t);
    //                         }
    //                     }
    //                 }
    //             }
    //         }
    //     }
    // }

    return { mobjInstances, sobjInstances, itemInstances, npcInstances };
}

/*
TODO

Fix UVs that are sometimes the wrong set
Fix objects with only albedo showing (seems to be different SRTs used)
Fix some sobjs not being in the right place (might just be animations)
Figure out NPC rotation degree logic (probably just one axis)
Add level variants that share the same base BFRES file (e.g. sensor lab offices and desert, seems to use .probe files)
Add level states (i.e. post-game, before or after story events, etc)
    Ability to hide specific objects from level (rather than blindly rendering all of them)
    Ability to change animation/texture set/etc of shown objects
Add toggleable render layers by model name
Decide how to handle different mobj dispos files
Add back sobjs and npcs
Fix transparency on certain textures
Figure out how water works (bone user data for mask, have to hardcode the color?)
Figure out how "real" ice and lava works
Add bone visiblity animations
Add material/texture/shader param animations
Add configurable animation speed (seems to vary, hardcoding to 60 FPS makes some too fast)
Add save states
Add particle effects
Add bloom if base renderering can be made more efficient, otherwise not worth the cost
*/

const pathBase = "PMTOK";
class PMTOKScene implements SceneDesc {
    public id: string;

    constructor(private path: string, public name: string) {
        this.id = this.path.split("/").slice(-1)[0];
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const resources = new OrigamiResources(device);
        const renderer = new OrigamiRenderer(device);

        const bfres = await context.dataFetcher.fetchData(`${pathBase}/${this.path}.bfres.zst`);
        resources.loadBFRES(device, this.id, BFRES.parse(decompressZST(bfres)));

        // there's not an apparent way to detect if a level has mobj/sobjs etc, so that info is hardcoded as configs
        let config = getOrigamiLevelConfig(this.id);
        if (!config) {
            // battle levels don't have configs for now
            if (this.id.startsWith("W")) {
                console.warn("No level config found for", this.id);
            }
            config = { mobj: false, sobj: false, aobj: false, item: false, npc: false };
        }

        const { mobjInstances, itemInstances } = await loadLevelObjects(this.id, config, resources, context.dataFetcher, device);

        const commonBntx = await context.dataFetcher.fetchData(`${pathBase}/graphics/textures/common/default.bntx.zst`);
        resources.loadRequestedCommonTextures(device, decompressZST(commonBntx));
        renderer.setResources(resources);

        for (const modelData of resources.modelData.values()) {
            renderer.modelRenderers.push(new OrigamiModelRenderer(renderer.renderHelper.renderCache, resources.textureHolder, modelData));
        }

        // patch each mobj renderer with instance matrices
        for (const instance of mobjInstances) {
            const modelRenderer = renderer.modelRenderers.find(m => m.name === instance.resolvedModelName)!;
            if (!modelRenderer) {
                continue;
            }
            const m = mat4.create();
            computeModelMatrixSRT(m, 1, 1, 1,
                instance.rotation[0] * MathConstants.DEG_TO_RAD, instance.rotation[1] * MathConstants.DEG_TO_RAD, instance.rotation[2] * MathConstants.DEG_TO_RAD,
                instance.position[0], instance.position[1], instance.position[2]);
            modelRenderer.shiftMatrices.push(m);
        }

        // patch each sobj renderer with instance matrices
        // for (const instance of sobjInstances) {
        //     const modelRenderer = renderer.modelRenderers.find(m => m.name === instance.modelName)!;
        //     if (!modelRenderer) {
        //         continue;
        //     }
        //     const m = mat4.create();
        //     computeModelMatrixSRT(m, instance.scale[0], instance.scale[1], instance.scale[2],
        //         instance.rotation[0] * MathConstants.DEG_TO_RAD, instance.rotation[1] * MathConstants.DEG_TO_RAD, instance.rotation[2] * MathConstants.DEG_TO_RAD,
        //         instance.position[0], instance.position[1], instance.position[2]);
        //     modelRenderer.shiftMatrices.push(m);
        // }

        // patch each item renderer with instance matrices
        for (const instance of itemInstances) {
            const modelRenderer = renderer.modelRenderers.find(m => m.name === instance.resolvedModelName)!;
            if (!modelRenderer) {
                continue;
            }
            const m = mat4.create();
            computeModelMatrixSRT(m, 1, 1, 1, 0, 0, 0, instance.position[0], instance.position[1], instance.position[2]);
            modelRenderer.shiftMatrices.push(m);
        }

        // patch each npc renderer with instance matrices
        // for (const instance of npcInstances) {
        //     const modelRenderer = renderer.modelRenderers.find(m => m.name === instance.resolvedModelName)!;
        //     if (!modelRenderer) {
        //         continue;
        //     }
        //     const m = mat4.create();
        //     computeModelMatrixSRT(m, 1, 1, 1, 0, 0, 0, instance.position[0], instance.position[1], instance.position[2]);
        //     modelRenderer.shiftMatrices.push(m);
        // }

        // patch level's base model renderer with identity shift matrix
        for (const modelRenderer of renderer.modelRenderers) {
            if (modelRenderer.name.startsWith(this.id.slice(0, 4))) {
                modelRenderer.shiftMatrices = [mat4.create()];
                break; // should only be one, usually the first one anyway
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
    new PMTOKScene("map/field/W0C1_EntranceWay", "Entrance Hall"),
    new PMTOKScene("map/field/W0C1_MainHall", "Main Hall"),
    new PMTOKScene("map/field/W0C1_HelpOlivia", "Dungeon (Rescue Olivia)"),
    new PMTOKScene("map/field/W0C1_WallHole", "Dungeon (Main)"),
    new PMTOKScene("map/field/W0C1_FoldRoom", "Dungeon (Help Bowser)"),
    new PMTOKScene("map/field/W0C1_BasementWay", "Dungeon (Exit)"),
    new PMTOKScene("map/field/W0C1_SpiralStair", "Spiral Staircase"),
    new PMTOKScene("map/field/W0C2_VolcanoCastle", "Top of the Volcano"),
    new PMTOKScene("map/battle/Btl_W0C1_PeachcastleA", "Battle - Peach's Castle"),
    "Whispering Woods",
    new PMTOKScene("map/field/W1C1_WakeUp", "Starting Area"),
    new PMTOKScene("map/field/W1C1_CastleView", "Castle View"),
    new PMTOKScene("map/field/W1C1_LostForest", "Whispering Woods"),
    new PMTOKScene("map/field/W1C1_BigStump", "Whispering Woods (Grandsappy)"),
    new PMTOKScene("map/field/W1C1_CampSite", "Camp Site"),
    new PMTOKScene("map/field/W1C1_LogHouse", "Log House"),
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
    new PMTOKScene("map/field/W1G1_KartRoad", "Kart Road (Opening Cutscene)"),
    new PMTOKScene("map/field/W1G1_KinopioHouse", "Toad House"),
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
    new PMTOKScene("map/field/W2C2_PuzzleEasy", "Slide Puzzle (Easy)"),
    new PMTOKScene("map/field/W2C2_PanelGetA", "Secret Room 1"),
    new PMTOKScene("map/field/W2C2_BoxMaze", "Box Maze"),
    new PMTOKScene("map/field/W2C2_CryDragon", "Water Wheel"),
    new PMTOKScene("map/field/W2C2_PuzzleHard", "Slide Puzzle (Hard)"),
    new PMTOKScene("map/field/W2C2_LoopWay", "Interstitial Room"),
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
    "Scorching Sandpaper Desert", // needs more work, uses multiple files
    new PMTOKScene("map/field/W3G2_Desert", "Desert"),
    new PMTOKScene("map/field/W3G2_DesertRuin", "Desert Ruin"),
    new PMTOKScene("map/field/W3G2_IceKinopio", "Rescue Captain T. Ode"),
    new PMTOKScene("map/field/W3G2_KinopioTop", "Tower Top"),
    new PMTOKScene("map/field/W3G2_KinopioTopRe", "Tower Top Reversed"),
    new PMTOKScene("map/field/W3G2_OasisLeft", "Oasis (West)"),
    new PMTOKScene("map/field/W3G2_OasisRight", "Oasis (East)"),
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
    new PMTOKScene("map/field/W3C4_Desert", "Desert Spawn Area"),
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
    new PMTOKScene("map/field/W3C4_DiscoEntrance", "Disco Entrance"),
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
    new PMTOKScene("map/field/W4G1_DokuroFirst", "Bonehead Island Interior 1"),
    new PMTOKScene("map/field/W4G1_DokuroSecond", "Bonehead Island Interior 2"),
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
    new PMTOKScene("map/field/W4G1_UnderSeaOrb", "Underwater (Diamond Island)"),
    new PMTOKScene("map/field/W4G2_CourageEntrance", "Courage Entrance"),
    new PMTOKScene("map/field/W4G2_CourageLevel1", "Courage Level"),
    new PMTOKScene("map/field/W4G2_CourageOrb", "Courage Orb"),
    new PMTOKScene("map/field/W4G2_WisdomLevel1", "Wisdom Level"),
    "Ice Vellumental Mountain",
    new PMTOKScene("map/field/W4C2_IceEntrance", "Entrance"),
    new PMTOKScene("map/field/W4C2_BigJump", "Big Jump"),
    new PMTOKScene("map/field/W4C2_IceSlide", "Ice Slide"),
    new PMTOKScene("map/field/W4C2_JumpStart", "Jump Start"),
    new PMTOKScene("map/field/W4C2_PuzzleTutorial", "Ice Slide Puzzle Tutorial"),
    new PMTOKScene("map/field/W4C2_PuzzleEasy", "Ice Slide Puzzle (Easy)"),
    new PMTOKScene("map/field/W4C2_PuzzleHard", "Ice Slide Puzzle (Hard)"),
    new PMTOKScene("map/field/W4C2_PuzzleResetA", "Ice Slide Puzzle Reset"),
    new PMTOKScene("map/field/W4C2_SpiralStair", "Spiral Staircase"),
    new PMTOKScene("map/field/W4C2_BossArea", "Boss Room"),
    new PMTOKScene("map/battle/Btl_W4C2_IceMountainA", "Battle - Ice Vellumental Mountain"),
    new PMTOKScene("map/battle/Btl_W4C2_IceMountainBossA", "Battle - Ice Vellumental Mountain (Boss)"),
    "Sea Tower",
    new PMTOKScene("map/field/W4C3_OrbTower", "Sea Tower"),
    new PMTOKScene("map/field/W4C3_OutSideA", "Outside 1"),
    new PMTOKScene("map/field/W4C3_OutSideB", "Outside 2"),
    new PMTOKScene("map/field/W4C3_EarthArea", "Earth Area"),
    new PMTOKScene("map/field/W4C3_EarthWater", "Earth Water"),
    new PMTOKScene("map/field/W4C3_FireArea", "Fire Area"),
    new PMTOKScene("map/field/W4C3_FireIce", "Fire Ice"),
    new PMTOKScene("map/field/W4C3_FourGod", "Four Vellumentals Room"),
    new PMTOKScene("map/field/W4C3_PuzzleReset", "Puzzle Reset"),
    new PMTOKScene("map/field/W4C3_WaterArea", "Water Area"),
    new PMTOKScene("map/field/W4C3_BossArea", "Top of the Tower"),
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
    new PMTOKScene("map/field/W5C2_BigTreeFirst", "Big Tree (1st Floor)"),
    new PMTOKScene("map/field/W5C2_BigTreeSecond", "Big Tree (2nd Floor)"),
    new PMTOKScene("map/field/W5C2_BigTreeThird", "Big Tree (3rd Floor)"),
    new PMTOKScene("map/field/W5C2_DeepJungle", "Deep Jungle"),
    new PMTOKScene("map/field/W5C2_DeadEnd", "Dead End 1"),
    new PMTOKScene("map/field/W5C2_DeadEndB", "Dead End 2"),
    new PMTOKScene("map/field/W5C2_LeafMemory", "Leaf Memory Puzzle"),
    new PMTOKScene("map/battle/Btl_W5C2_JungleA", "Battle - Spring of Jungle Mist"),
    "Spring of Rainbows",
    new PMTOKScene("map/field/W5C1_CliffWay", "Cliff Way"),
    new PMTOKScene("map/field/W5C1_QuizRoom", "Quiz Room"),
    new PMTOKScene("map/field/W5C1_RaceQuiz", "Quiz Race"),
    new PMTOKScene("map/field/W5C1_SecretSpa", "Secret Spa"),
    new PMTOKScene("map/field/W5C1_SteamFirst", "Steam First"),
    new PMTOKScene("map/battle/Btl_W5C1_QuizA", "Battle - Spring of Rainbows"),
    "Bowser's Castle",
    new PMTOKScene("map/field/W5C3_BlackHandAreaSide", "Black Hand Area Side"),
    new PMTOKScene("map/field/W5C3_Dockyard", "Dockyard"),
    new PMTOKScene("map/field/W5C3_EntranceWay", "Entrance"),
    new PMTOKScene("map/field/W5C3_MainHall", "Main Hall"),
    new PMTOKScene("map/field/W5C3_MetStatue", "Met Statue"),
    new PMTOKScene("map/field/W5C3_PillarPassage", "Pillar Passage"),
    new PMTOKScene("map/field/W5C3_ResidenceFloor", "Residence Floor"),
    new PMTOKScene("map/field/W5C3_RoomA", "Room"),
    new PMTOKScene("map/field/W5C3_SavePoint", "Save Room"),
    new PMTOKScene("map/field/W5C3_Shooting", "Shooting Gallery 1"),
    new PMTOKScene("map/field/W5C3_ShootingDemoAfter", "Shooting Gallery 2"),
    new PMTOKScene("map/field/W5C3_ShootingDemoBefore", "Shooting Gallery 3"),
    new PMTOKScene("map/field/W5C3_ThroneRoom", "Throne Room"),
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
    new PMTOKScene("map/field/W6C2_LateralLift", "Lateral Lift"),
    new PMTOKScene("map/field/W6C2_PopUpBox", "Pop-Up Box Room"),
    new PMTOKScene("map/field/W6C2_InsideBox", "Pop-Up Box Room (Inside)"),
    new PMTOKScene("map/field/W6C2_StairRoomA", "Stair Room 1"),
    new PMTOKScene("map/field/W6C2_StairRoomC", "Stair Room 2"),
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
