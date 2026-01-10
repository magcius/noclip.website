import type { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import type { SceneContext } from "../SceneBase.js";
import type * as Viewer from "../viewer.js";
import { DNASceneBuilder } from "./dna/sceneBuilder.js";
import { PandaNode } from "./nodes/PandaNode.js";
import { ToontownRenderer } from "./render.js";
import { pathBase, ToontownResourceLoader } from "./resources.js";

class ToontownSceneDesc implements Viewer.SceneDesc {
  constructor(
    public id: string,
    public name: string,
    public modelPath: string,
  ) {}

  public async createScene(
    device: GfxDevice,
    context: SceneContext,
  ): Promise<Viewer.SceneGfx> {
    const loader = await context.dataShare.ensureObject<ToontownResourceLoader>(
      `${pathBase}/loader`,
      async () => {
        const loader = new ToontownResourceLoader();
        await loader.loadManifest(context.dataFetcher);
        return loader;
      },
    );

    const bamFile = await loader.loadModel(
      this.modelPath,
      context.dataFetcher,
      true,
    );

    return ToontownRenderer.create(
      device,
      bamFile.getRoot(),
      loader,
      context.dataFetcher,
    );
  }
}

interface NeighborhoodConfig {
  storageDNA: string | null; // Hood-wide storage (e.g., storage_TT.dna)
  skybox: string | null; // Hood-wide skybox (e.g., TT_sky.bam)
}

interface DNASceneConfig {
  storageDNA: string[]; // Area-specific storage (e.g., storage_TT_sz.dna)
  sceneDNA: string | null; // Main scene DNA file (e.g., toontown_central_sz.dna)
  extraModels?: string[]; // Additional models to load
}

// Neighborhood configurations
const Neighborhoods: Record<string, NeighborhoodConfig> = {
  ToontownCentral: {
    storageDNA: "phase_4/dna/storage_TT.dna",
    skybox: "phase_3.5/models/props/TT_sky.bam",
  },
  DonaldsDock: {
    storageDNA: "phase_6/dna/storage_DD.dna",
    skybox: "phase_3.5/models/props/BR_sky.bam",
  },
  MinniesMelodyland: {
    storageDNA: "phase_6/dna/storage_MM.dna",
    skybox: "phase_6/models/props/MM_sky.bam",
  },
  DaisyGardens: {
    storageDNA: "phase_8/dna/storage_DG.dna",
    skybox: "phase_3.5/models/props/TT_sky.bam",
  },
  TheBrrrgh: {
    storageDNA: "phase_8/dna/storage_BR.dna",
    skybox: "phase_3.5/models/props/BR_sky.bam",
  },
  DonaldsDreamland: {
    storageDNA: "phase_8/dna/storage_DL.dna",
    skybox: "phase_8/models/props/DL_sky.bam",
  },
  GoofySpeedway: {
    storageDNA: "phase_6/dna/storage_GS.dna",
    skybox: "phase_3.5/models/props/TT_sky.bam",
  },
  OutdoorZone: {
    storageDNA: "phase_6/dna/storage_OZ.dna",
    skybox: "phase_3.5/models/props/TT_sky.bam",
  },
  Tutorial: {
    storageDNA: null,
    skybox: "phase_3.5/models/props/TT_sky.bam",
  },
  MyEstate: {
    storageDNA: "phase_5.5/dna/storage_estate.dna",
    skybox: "phase_3.5/models/props/TT_sky.bam",
  },
  SellbotHQ: {
    storageDNA: null,
    skybox: "phase_9/models/cogHQ/cog_sky.bam",
  },
  CashbotHQ: {
    storageDNA: null,
    skybox: null,
  },
  LawbotHQ: {
    storageDNA: null,
    skybox: null,
  },
  BossbotHQ: {
    storageDNA: null,
    skybox: null,
  },
};

const GLOBAL_STORAGE_DNA = "phase_4/dna/storage.dna";
const TOWN_STORAGE_DNA = "phase_5/dna/storage_town.dna";

class ToontownDNASceneDesc implements Viewer.SceneDesc {
  constructor(
    public id: string,
    public name: string,
    public neighborhood: string,
    public sceneConfig: DNASceneConfig,
  ) {}

  // Returns the DNA files in the order they should be loaded
  public getDNALoadOrder(): string[] {
    const hood = Neighborhoods[this.neighborhood];
    const loadOrder = [GLOBAL_STORAGE_DNA];
    if (hood.storageDNA) {
      loadOrder.push(TOWN_STORAGE_DNA, hood.storageDNA);
    }
    loadOrder.push(...this.sceneConfig.storageDNA);
    if (this.sceneConfig.sceneDNA) {
      loadOrder.push(this.sceneConfig.sceneDNA);
    }
    return loadOrder;
  }

  public async createScene(
    device: GfxDevice,
    context: SceneContext,
  ): Promise<Viewer.SceneGfx> {
    const loader = await context.dataShare.ensureObject<ToontownResourceLoader>(
      `${pathBase}/loader`,
      async () => {
        const loader = new ToontownResourceLoader();
        await loader.loadManifest(context.dataFetcher);
        return loader;
      },
    );

    // Load DNA files in order and build storage
    const dnaFiles = this.getDNALoadOrder();
    console.log(`Loading DNA scene: ${this.name}`);
    console.log(`DNA load order:`, dnaFiles);

    const { storage, sceneFile } = await loader.loadDNAWithStorage(
      dnaFiles,
      context.dataFetcher,
    );

    const scene = new PandaNode();
    scene.name = "render";

    // Build the scene from DNA
    const sceneBuilder = new DNASceneBuilder(
      storage,
      loader,
      context.dataFetcher,
    );
    await sceneBuilder.build(sceneFile, scene);

    if (this.sceneConfig.extraModels) {
      for (const modelPath of this.sceneConfig.extraModels) {
        const model = await loader.loadModel(modelPath, context.dataFetcher);
        scene.addChild(model.getRoot().cloneSubgraph());
      }
    }

    const hood = Neighborhoods[this.neighborhood];
    if (hood.skybox) {
      const model = await loader.loadModel(hood.skybox, context.dataFetcher);
      const instance = model.getRoot().cloneSubgraph();
      instance.tags.set("sky", "Regular");
      scene.addChild(instance);
    }

    console.log(`Loaded scene with ${scene.children.length} nodes.`);

    // Create renderer from DNA instances
    return ToontownRenderer.create(device, scene, loader, context.dataFetcher);
  }
}

const sceneDescs = [
  "Toontown Central",
  new ToontownDNASceneDesc(
    "toontown_central_sz",
    "Playground",
    "ToontownCentral",
    {
      storageDNA: [
        "phase_4/dna/storage_TT_sz.dna",
        "phase_5/dna/storage_TT_town.dna",
      ],
      sceneDNA: "phase_4/dna/toontown_central_sz.dna",
    },
  ),
  "Donald's Dock",
  new ToontownDNASceneDesc("donalds_dock_sz", "Playground", "DonaldsDock", {
    storageDNA: [
      "phase_6/dna/storage_DD_sz.dna",
      "phase_6/dna/storage_DD_town.dna",
    ],
    sceneDNA: "phase_6/dna/donalds_dock_sz.dna",
  }),
  "Minnie's Melodyland",
  new ToontownDNASceneDesc(
    "minnies_melody_land_sz",
    "Playground",
    "MinniesMelodyland",
    {
      storageDNA: [
        "phase_6/dna/storage_MM_sz.dna",
        "phase_6/dna/storage_MM_town.dna",
      ],
      sceneDNA: "phase_6/dna/minnies_melody_land_sz.dna",
    },
  ),
  "Daisy Gardens",
  new ToontownDNASceneDesc("daisys_garden_sz", "Playground", "DaisyGardens", {
    storageDNA: [
      "phase_8/dna/storage_DG_sz.dna",
      "phase_8/dna/storage_DG_town.dna",
    ],
    sceneDNA: "phase_8/dna/daisys_garden_sz.dna",
  }),
  "The Brrrgh",
  new ToontownDNASceneDesc("the_burrrgh_sz", "Playground", "TheBrrrgh", {
    storageDNA: [
      "phase_8/dna/storage_BR_sz.dna",
      "phase_8/dna/storage_BR_town.dna",
    ],
    sceneDNA: "phase_8/dna/the_burrrgh_sz.dna",
  }),
  "Donald's Dreamland",
  new ToontownDNASceneDesc(
    "donalds_dreamland_sz",
    "Playground",
    "DonaldsDreamland",
    {
      storageDNA: [
        "phase_8/dna/storage_DL_sz.dna",
        "phase_8/dna/storage_DL_town.dna",
      ],
      sceneDNA: "phase_8/dna/donalds_dreamland_sz.dna",
    },
  ),
  "Goofy Speedway",
  new ToontownDNASceneDesc("goofy_speedway_sz", "Playground", "GoofySpeedway", {
    storageDNA: ["phase_6/dna/storage_GS_sz.dna"],
    sceneDNA: "phase_6/dna/goofy_speedway_sz.dna",
  }),
  new ToontownSceneDesc(
    "KartShop_Interior",
    "Goofy's Auto Shop",
    "phase_6/models/karting/KartShop_Interior.bam",
  ),
  "Chip 'n Dale's Acorn Acres",
  new ToontownDNASceneDesc("outdoor_zone_sz", "Playground", "OutdoorZone", {
    storageDNA: ["phase_6/dna/storage_OZ_sz.dna"],
    sceneDNA: "phase_6/dna/outdoor_zone_sz.dna",
  }),
  "Estate",
  new ToontownDNASceneDesc("estate", "Estate", "MyEstate", {
    storageDNA: [],
    sceneDNA: "phase_5.5/dna/estate_1.dna",
  }),
  "Sellbot HQ",
  new ToontownDNASceneDesc("SellbotHQExterior", "Courtyard", "SellbotHQ", {
    storageDNA: [],
    sceneDNA: "phase_9/dna/cog_hq_sellbot_sz.dna",
    extraModels: ["phase_9/models/cogHQ/SellbotHQExterior.bam"],
  }),
  "Cashbot HQ",
  new ToontownDNASceneDesc("CashBotShippingStation", "Trainyard", "CashbotHQ", {
    storageDNA: [],
    sceneDNA: null,
    extraModels: ["phase_10/models/cogHQ/CashBotShippingStation.bam"],
  }),
  new ToontownDNASceneDesc("VaultLobby", "Vault Lobby", "CashbotHQ", {
    storageDNA: [],
    sceneDNA: null,
    extraModels: ["phase_10/models/cogHQ/VaultLobby.bam"],
  }),
  "Lawbot HQ",
  new ToontownDNASceneDesc("LawbotPlaza", "Courtyard", "LawbotHQ", {
    storageDNA: [],
    sceneDNA: null,
    extraModels: ["phase_11/models/lawbotHQ/LawbotPlaza.bam"],
  }),
  new ToontownDNASceneDesc("LB_CH_Lobby", "Courthouse Lobby", "LawbotHQ", {
    storageDNA: [],
    sceneDNA: null,
    extraModels: ["phase_11/models/lawbotHQ/LB_CH_Lobby.bam"],
  }),
  new ToontownDNASceneDesc(
    "LB_CH_Lobby",
    "District Attorney's Office Lobby",
    "LawbotHQ",
    {
      storageDNA: [],
      sceneDNA: null,
      extraModels: ["phase_11/models/lawbotHQ/LB_DA_Lobby.bam"],
    },
  ),
  "Bossbot HQ",
  new ToontownDNASceneDesc("CogGolfHub", "Courtyard", "BossbotHQ", {
    storageDNA: [],
    sceneDNA: null,
    extraModels: ["phase_12/models/bossbotHQ/CogGolfHub.bam"],
  }),
  // TODO
  // new ToontownDNASceneDesc("CogGolfCourtyard", "Clubhouse", "BossbotHQ", {
  //   storageDNA: [],
  //   sceneDNA: null,
  //   extraModels: ["phase_12/models/bossbotHQ/CogGolfCourtyard.bam"],
  // }),
  "Experimental",
  new ToontownDNASceneDesc("tutorial_street", "Tutorial Street", "Tutorial", {
    storageDNA: [],
    sceneDNA: "phase_3.5/dna/tutorial_street.dna",
  }),
];

export const sceneGroup: Viewer.SceneGroup = {
  id: "Toontown",
  name: "Toontown Online",
  sceneDescs,
};
