import { ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import type { GfxDevice } from "../gfx/platform/GfxPlatform";
import type { SceneContext } from "../SceneBase";
import type * as Viewer from "../viewer";
import { DNASceneBuilder } from "./dna/sceneBuilder";
import {
  CompassEffect,
  CompassEffectProperties,
  CullBinAttrib,
  DepthTestAttrib,
  DepthWriteAttrib,
  DepthWriteMode,
  PandaCompareFunc,
  PandaNode,
  TransformState,
} from "./nodes";
import { ToontownRenderer } from "./render";
import { pathBase, ToontownResourceLoader } from "./resources";

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

    const scene = PandaNode.create("render");
    const _cameraNode = scene.attachNewNode("camera");

    const bamFile = await loader.loadModel(
      this.modelPath,
      context.dataFetcher,
      true,
    );
    scene.addChild(bamFile.getRoot().clone());
    return ToontownRenderer.create(device, scene, loader, context.dataFetcher);
  }
}

interface NeighborhoodConfig {
  storageDNA: string | null; // Hood-wide storage (e.g., storage_TT.dna)
  skybox: string | null; // Hood-wide skybox (e.g., TT_sky.bam)
  callback?: (
    scene: PandaNode,
    loader: ToontownResourceLoader,
    context: SceneContext,
    builder: DNASceneBuilder,
  ) => Promise<void>;
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
    storageDNA: "phase_4/dna/storage_TT.dna",
    skybox: "phase_3.5/models/props/TT_sky.bam",
  },
  MyEstate: {
    storageDNA: "phase_5.5/dna/storage_estate.dna",
    skybox: "phase_3.5/models/props/TT_sky.bam",
    callback: async (scene, loader, context, builder) => {
      // Ensure the foot path renders in ground cull bin
      scene.find("**/Path")?.setAttrib(CullBinAttrib.create("ground", 10), 1);

      const houseModels = [
        "phase_5.5/models/estate/houseA.bam",
        "phase_5.5/models/estate/tt_m_ara_est_house_tiki.bam",
        "phase_5.5/models/estate/tt_m_ara_est_house_tepee.bam",
        "phase_5.5/models/estate/tt_m_ara_est_house_castle.bam",
        "phase_5.5/models/estate/tt_m_ara_est_house_cupcake.bam",
        "phase_5.5/models/estate/test_houseA.bam",
      ];
      const houseDrops: { pos: ReadonlyVec3; hpr: ReadonlyVec3 }[] = [
        {
          pos: vec3.fromValues(-56.7788, -42.8756, 4.06471),
          hpr: vec3.fromValues(-90, 0, 0),
        },
        {
          pos: vec3.fromValues(83.3909, -77.5085, 0.0708361),
          hpr: vec3.fromValues(116.565, 0, 0),
        },
        {
          pos: vec3.fromValues(-69.077, -119.496, 0.025),
          hpr: vec3.fromValues(77.1957, 0, 0),
        },
        {
          pos: vec3.fromValues(63.4545, 11.0656, 8.05158),
          hpr: vec3.fromValues(356.6, 0, 0),
        },
        {
          pos: vec3.fromValues(43.9315, 76.72, 0.0377455),
          hpr: vec3.fromValues(248.962, 0, 0),
        },
        {
          pos: vec3.fromValues(-36.9122, 36.3429, 2.49382),
          hpr: vec3.fromValues(36.8699, 0, 0),
        },
      ];
      const houseColors = [
        vec4.fromValues(0.892, 0.453, 0.39, 1), // red
        vec4.fromValues(0.276, 0.692, 0.539, 1), // green
        vec4.fromValues(0.639, 0.624, 0.882, 1), // purple
        vec4.fromValues(0.525, 0.78, 0.935, 1), // blue
        vec4.fromValues(0.953, 0.545, 0.757, 1), // pink
        vec4.fromValues(0.992, 0.843, 0.392, 1), // yellow
      ];
      const houseColors2 = [
        vec4.fromValues(0.792, 0.353, 0.29, 1), // red
        vec4.fromValues(0.176, 0.592, 0.439, 1), // green
        vec4.fromValues(0.439, 0.424, 0.682, 1), // purple
        vec4.fromValues(0.325, 0.58, 0.835, 1), // blue
        vec4.fromValues(0.753, 0.345, 0.557, 1), // pink
        vec4.fromValues(0.992, 0.843, 0.392, 1), // yellow
      ];
      const gardenDrops = [
        vec3.fromValues(25, 68, 0),
        vec3.fromValues(68, -6, 0),
        vec3.fromValues(27, -59, 0),
        vec3.fromValues(-54, -72, 1),
        vec3.fromValues(-95, -29, 0),
        vec3.fromValues(-30, 58, 0),
      ];

      const mailboxModel = await loader.loadModel(
        "phase_5.5/models/estate/mailboxHouse.bam",
        context.dataFetcher,
      );
      // const gardenModel = await loader.loadModel(
      //   "phase_5.5/models/estate/planterC.bam",
      //   context.dataFetcher,
      // );

      for (let i = 0; i < houseDrops.length; i++) {
        const { pos, hpr } = houseDrops[i];
        const baseNode = scene.attachNewNode(`esHouse_${i}`);
        baseNode.setPosHprScale(pos, hpr, vec3.fromValues(1, 1, 1));

        const modelPath = houseModels[0]; // Math.floor(Math.random() * houseModels.length)
        const model = await loader.loadModel(modelPath, context.dataFetcher);
        const house = model.getRoot().clone();
        baseNode.addChild(house);

        // Set wall color
        const colorIndex = i;//Math.floor(Math.random() * houseColors.length);
        const houseColor = houseColors[colorIndex];
        const houseColorDark = vec4.fromValues(
          houseColor[0] * 0.8,
          houseColor[1] * 0.8,
          houseColor[2] * 0.8,
          1,
        );
        house.find("**/*back")?.setColor(houseColor);
        house.find("**/*front")?.setColor(houseColor);
        house.find("**/*right")?.setColor(houseColorDark);
        house.find("**/*left")?.setColor(houseColorDark);

        // Set attic color
        house
          .find("**/attic")
          ?.setColor(vec4.fromValues(0.49, 0.314, 0.224, 1));

        // Set chimney color
        const chimneyColor = houseColors2[colorIndex];
        house
          .findAllMatches("**/chim*")
          .forEach((n) => n.setColor(chimneyColor));

        // Setup door
        const doorOrigin = house.find("**/door_origin");
        if (!doorOrigin) throw new Error("Door origin not found");
        doorOrigin.setPosHprScale(
          doorOrigin.pos,
          vec3.fromValues(90, 0, 0),
          vec3.fromValues(0.6, 0.6, 0.8),
        );
        doorOrigin.transform = doorOrigin.transform.compose(
          TransformState.fromPos(vec3.fromValues(0.5, 0, 0)),
        );
        const doorModel = builder.addGeometryFromCode(
          "door_double_round_ur",
          doorOrigin,
        );
        if (doorModel) {
          doorModel.setColor(vec4.fromValues(0.651, 0.376, 0.31, 1));
        }

        // Setup floor mat
        house.find("**/mat")?.setColor(vec4.fromValues(0.4, 0.357, 0.259, 1));

        // Setup mailbox
        const mailbox = mailboxModel.getRoot().clone();
        baseNode.addChild(mailbox);

        let zOffset = 0;
        if (i === 2) {
          zOffset = 0.5;
        } else if (i === 3) {
          // This appears to not be necessary?
          // zOffset = -1;
        }
        mailbox.transform = house.transform.compose(
          TransformState.fromPosHprScale(
            vec3.fromValues(19, -4, zOffset),
            vec3.fromValues(90, 0, 0),
            vec3.fromValues(1, 1, 1),
          ),
        );
        const flag = mailbox.find("**/mailbox_flag");
        if (flag) {
          if (Math.floor(Math.random() * 2)) {
            // Flag up
            flag.p = 0;
          } else {
            // Flag down
            flag.p = -70;
          }
        }

        // Setup garden
        // const gardenPos = gardenDrops[i];
        // const garden = gardenModel.getRoot().clone();
        // baseNode.addChild(garden);

        // garden.transform = house.transform.compose(
        //   TransformState.fromPosHprScale(
        //     gardenPos,
        //     vec3.fromValues(0, 0, 0),
        //     vec3.fromValues(1, 1, 1),
        //   ),
        // );
      }
    },
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
    callback: async (scene) => {
      // Ensure the reflective floor renders in ground cull bin
      scene
        .find("**/underground")
        ?.setAttrib(CullBinAttrib.create("ground", -10));
    },
  },
  BossbotHQ: {
    storageDNA: null,
    skybox: null,
  },
  GolfZone: {
    storageDNA: "phase_6/dna/storage_GZ.dna",
    skybox: "phase_3.5/models/props/TT_sky.bam",
  },
  Party: {
    storageDNA: "phase_13/dna/storage_party_sz.dna",
    skybox: "phase_3.5/models/props/TT_sky.bam",
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

    const scene = PandaNode.create("render");
    const cameraNode = scene.attachNewNode("camera");

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
        scene.addChild(model.getRoot().clone());
      }
    }

    const hood = Neighborhoods[this.neighborhood];
    if (hood.skybox) {
      const model = await loader.loadModel(hood.skybox, context.dataFetcher);
      const instance = model.getRoot().clone();
      instance.tags.set("sky", "Regular");
      instance.setEffect(
        CompassEffect.create(CompassEffectProperties.Position, cameraNode),
      );
      instance.setAttrib(CullBinAttrib.create("background", 100));
      instance.setAttrib(DepthTestAttrib.create(PandaCompareFunc.None));
      instance.setAttrib(DepthWriteAttrib.create(DepthWriteMode.Off));
      // Ensure sky renders before clouds
      instance.find("**/Sky")?.reparentTo(instance, -1);
      scene.addChild(instance);
    }

    // Remove overlapping door frames
    scene.findAllMatches("**/doorFrameHoleLeft").forEach((node) => node.hide());
    scene
      .findAllMatches("**/doorFrameHoleRight")
      .forEach((node) => node.hide());

    // Run custom callback
    await hood.callback?.(scene, loader, context, sceneBuilder);

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
  new ToontownDNASceneDesc(
    "toontown_central_2100",
    "Silly Street",
    "ToontownCentral",
    {
      storageDNA: [
        "phase_4/dna/storage_TT_sz.dna",
        "phase_5/dna/storage_TT_town.dna",
      ],
      sceneDNA: "phase_5/dna/toontown_central_2100.dna",
    },
  ),
  new ToontownDNASceneDesc(
    "toontown_central_2200",
    "Loopy Lane",
    "ToontownCentral",
    {
      storageDNA: [
        "phase_4/dna/storage_TT_sz.dna",
        "phase_5/dna/storage_TT_town.dna",
      ],
      sceneDNA: "phase_5/dna/toontown_central_2200.dna",
    },
  ),
  new ToontownDNASceneDesc(
    "toontown_central_2300",
    "Punchline Place",
    "ToontownCentral",
    {
      storageDNA: [
        "phase_4/dna/storage_TT_sz.dna",
        "phase_5/dna/storage_TT_town.dna",
      ],
      sceneDNA: "phase_5/dna/toontown_central_2300.dna",
    },
  ),
  new ToontownDNASceneDesc("tutorial_street", "Tutorial Terrace", "Tutorial", {
    storageDNA: ["phase_5/dna/storage_TT_town.dna"],
    sceneDNA: "phase_3.5/dna/tutorial_street.dna",
  }),
  "Donald's Dock",
  new ToontownDNASceneDesc("donalds_dock_sz", "Playground", "DonaldsDock", {
    storageDNA: [
      "phase_6/dna/storage_DD_sz.dna",
      "phase_6/dna/storage_DD_town.dna",
    ],
    sceneDNA: "phase_6/dna/donalds_dock_sz.dna",
  }),
  new ToontownDNASceneDesc(
    "donalds_dock_1100",
    "Barnacle Boulevard",
    "DonaldsDock",
    {
      storageDNA: [
        "phase_6/dna/storage_DD_sz.dna",
        "phase_6/dna/storage_DD_town.dna",
      ],
      sceneDNA: "phase_6/dna/donalds_dock_1100.dna",
    },
  ),
  new ToontownDNASceneDesc(
    "donalds_dock_1200",
    "Seaweed Street",
    "DonaldsDock",
    {
      storageDNA: [
        "phase_6/dna/storage_DD_sz.dna",
        "phase_6/dna/storage_DD_town.dna",
      ],
      sceneDNA: "phase_6/dna/donalds_dock_1200.dna",
    },
  ),
  new ToontownDNASceneDesc(
    "donalds_dock_1300",
    "Lighthouse Lane",
    "DonaldsDock",
    {
      storageDNA: [
        "phase_6/dna/storage_DD_sz.dna",
        "phase_6/dna/storage_DD_town.dna",
      ],
      sceneDNA: "phase_6/dna/donalds_dock_1300.dna",
    },
  ),
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
  new ToontownDNASceneDesc(
    "minnies_melody_land_4100",
    "Alto Avenue",
    "MinniesMelodyland",
    {
      storageDNA: [
        "phase_6/dna/storage_MM_sz.dna",
        "phase_6/dna/storage_MM_town.dna",
      ],
      sceneDNA: "phase_6/dna/minnies_melody_land_4100.dna",
    },
  ),
  new ToontownDNASceneDesc(
    "minnies_melody_land_4200",
    "Baritone Boulevard",
    "MinniesMelodyland",
    {
      storageDNA: [
        "phase_6/dna/storage_MM_sz.dna",
        "phase_6/dna/storage_MM_town.dna",
      ],
      sceneDNA: "phase_6/dna/minnies_melody_land_4200.dna",
    },
  ),
  new ToontownDNASceneDesc(
    "minnies_melody_land_4300",
    "Tenor Terrace",
    "MinniesMelodyland",
    {
      storageDNA: [
        "phase_6/dna/storage_MM_sz.dna",
        "phase_6/dna/storage_MM_town.dna",
      ],
      sceneDNA: "phase_6/dna/minnies_melody_land_4300.dna",
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
  new ToontownDNASceneDesc("daisys_garden_5100", "Elm Street", "DaisyGardens", {
    storageDNA: [
      "phase_8/dna/storage_DG_sz.dna",
      "phase_8/dna/storage_DG_town.dna",
    ],
    sceneDNA: "phase_8/dna/daisys_garden_5100.dna",
  }),
  new ToontownDNASceneDesc(
    "daisys_garden_5200",
    "Maple Street",
    "DaisyGardens",
    {
      storageDNA: [
        "phase_8/dna/storage_DG_sz.dna",
        "phase_8/dna/storage_DG_town.dna",
      ],
      sceneDNA: "phase_8/dna/daisys_garden_5200.dna",
    },
  ),
  new ToontownDNASceneDesc("daisys_garden_5300", "Oak Street", "DaisyGardens", {
    storageDNA: [
      "phase_8/dna/storage_DG_sz.dna",
      "phase_8/dna/storage_DG_town.dna",
    ],
    sceneDNA: "phase_8/dna/daisys_garden_5300.dna",
  }),
  "The Brrrgh",
  new ToontownDNASceneDesc("the_burrrgh_sz", "Playground", "TheBrrrgh", {
    storageDNA: [
      "phase_8/dna/storage_BR_sz.dna",
      "phase_8/dna/storage_BR_town.dna",
    ],
    sceneDNA: "phase_8/dna/the_burrrgh_sz.dna",
  }),
  new ToontownDNASceneDesc("the_burrrgh_3100", "Walrus Way", "TheBrrrgh", {
    storageDNA: [
      "phase_8/dna/storage_BR_sz.dna",
      "phase_8/dna/storage_BR_town.dna",
    ],
    sceneDNA: "phase_8/dna/the_burrrgh_3100.dna",
  }),
  new ToontownDNASceneDesc("the_burrrgh_3200", "Sleet Street", "TheBrrrgh", {
    storageDNA: [
      "phase_8/dna/storage_BR_sz.dna",
      "phase_8/dna/storage_BR_town.dna",
    ],
    sceneDNA: "phase_8/dna/the_burrrgh_3200.dna",
  }),
  new ToontownDNASceneDesc("the_burrrgh_3300", "Polar Place", "TheBrrrgh", {
    storageDNA: [
      "phase_8/dna/storage_BR_sz.dna",
      "phase_8/dna/storage_BR_town.dna",
    ],
    sceneDNA: "phase_8/dna/the_burrrgh_3300.dna",
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
  new ToontownDNASceneDesc(
    "donalds_dreamland_9100",
    "Lullaby Lane",
    "DonaldsDreamland",
    {
      storageDNA: [
        "phase_8/dna/storage_DL_sz.dna",
        "phase_8/dna/storage_DL_town.dna",
      ],
      sceneDNA: "phase_8/dna/donalds_dreamland_9100.dna",
    },
  ),
  new ToontownDNASceneDesc(
    "donalds_dreamland_9200",
    "Pajama Place",
    "DonaldsDreamland",
    {
      storageDNA: [
        "phase_8/dna/storage_DL_sz.dna",
        "phase_8/dna/storage_DL_town.dna",
      ],
      sceneDNA: "phase_8/dna/donalds_dreamland_9200.dna",
    },
  ),
  "Goofy Speedway",
  new ToontownDNASceneDesc(
    "goofy_speedway_sz",
    "Goofy Speedway",
    "GoofySpeedway",
    {
      storageDNA: ["phase_6/dna/storage_GS_sz.dna"],
      sceneDNA: "phase_6/dna/goofy_speedway_sz.dna",
    },
  ),
  new ToontownSceneDesc(
    "KartShop_Interior",
    "Goofy's Auto Shop",
    "phase_6/models/karting/KartShop_Interior.bam",
  ),
  "Chip 'n Dale's Acorn Acres",
  new ToontownDNASceneDesc(
    "outdoor_zone_sz",
    "Chip 'n Dale's Acorn Acres",
    "OutdoorZone",
    {
      storageDNA: ["phase_6/dna/storage_OZ_sz.dna"],
      sceneDNA: "phase_6/dna/outdoor_zone_sz.dna",
    },
  ),
  new ToontownDNASceneDesc(
    "golf_zone_sz",
    "Chip 'n Dale's MiniGolf",
    "GolfZone",
    {
      storageDNA: ["phase_6/dna/storage_GZ_sz.dna"],
      sceneDNA: "phase_6/dna/golf_zone_sz.dna",
    },
  ),
  "Estate",
  new ToontownDNASceneDesc("estate", "Estate", "MyEstate", {
    storageDNA: [],
    sceneDNA: "phase_5.5/dna/estate_1.dna",
  }),
  new ToontownDNASceneDesc("party_sz", "Party", "Party", {
    storageDNA: [],
    sceneDNA: "phase_13/dna/party_sz.dna",
  }),
  "Sellbot HQ",
  new ToontownDNASceneDesc(
    "SellbotHQExterior",
    "Sellbot HQ Courtyard",
    "SellbotHQ",
    {
      storageDNA: [],
      sceneDNA: "phase_9/dna/cog_hq_sellbot_sz.dna",
      extraModels: ["phase_9/models/cogHQ/SellbotHQExterior.bam"],
    },
  ),
  new ToontownDNASceneDesc("SellbotHQLobby", "Sellbot HQ Lobby", "SellbotHQ", {
    storageDNA: [],
    sceneDNA: "phase_9/dna/cog_hq_sellbot_sz.dna",
    extraModels: ["phase_9/models/cogHQ/SellbotHQLobby.bam"],
  }),
  "Cashbot HQ",
  new ToontownDNASceneDesc(
    "CashBotShippingStation",
    "Cashbot Train Yard",
    "CashbotHQ",
    {
      storageDNA: [],
      sceneDNA: null,
      extraModels: ["phase_10/models/cogHQ/CashBotShippingStation.bam"],
    },
  ),
  new ToontownDNASceneDesc("VaultLobby", "Cashbot HQ Lobby", "CashbotHQ", {
    storageDNA: [],
    sceneDNA: null,
    extraModels: ["phase_10/models/cogHQ/VaultLobby.bam"],
  }),
  "Lawbot HQ",
  new ToontownDNASceneDesc("LawbotPlaza", "Lawbot HQ Courtyard", "LawbotHQ", {
    storageDNA: [],
    sceneDNA: null,
    extraModels: ["phase_11/models/lawbotHQ/LawbotPlaza.bam"],
  }),
  new ToontownDNASceneDesc("LB_CH_Lobby", "Courthouse Lobby", "LawbotHQ", {
    storageDNA: [],
    sceneDNA: null,
    extraModels: ["phase_11/models/lawbotHQ/LB_CH_Lobby.bam"],
  }),
  new ToontownDNASceneDesc("LB_CH_Lobby", "DA's Office Lobby", "LawbotHQ", {
    storageDNA: [],
    sceneDNA: null,
    extraModels: ["phase_11/models/lawbotHQ/LB_DA_Lobby.bam"],
  }),
  "Bossbot HQ",
  new ToontownDNASceneDesc("CogGolfHub", "Courtyard", "BossbotHQ", {
    storageDNA: [], // "phase_12/dna/storage_CC_sz.dna"
    sceneDNA: null,
    extraModels: ["phase_12/models/bossbotHQ/CogGolfHub.bam"],
  }),
  new ToontownDNASceneDesc("CogGolfCourtyard", "Clubhouse", "BossbotHQ", {
    storageDNA: [],
    sceneDNA: null,
    extraModels: ["phase_12/models/bossbotHQ/CogGolfCourtyard.bam"],
  }),
];

export const sceneGroup: Viewer.SceneGroup = {
  id: "Toontown",
  name: "Toontown Online",
  sceneDescs,
};
