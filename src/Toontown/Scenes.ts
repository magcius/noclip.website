import { type ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import type { GfxDevice } from "../gfx/platform/GfxPlatform";
import type { SceneContext } from "../SceneBase";
import type * as Viewer from "../viewer";
import { DNASceneBuilder } from "./dna/SceneBuilder";
import { pathBase, ToontownLoader } from "./Loader";
import {
  CompassEffect,
  CompassEffectProperties,
  CullBinAttrib,
  DepthTestAttrib,
  DepthWriteAttrib,
  DepthWriteMode,
  NurbsCurve,
  PandaCompareFunc,
  PandaNode,
  TransformState,
  TransparencyAttrib,
  TransparencyMode,
} from "./nodes";
import {
  type AnimatedProp,
  animatedPropMap,
  Char,
  GenericAnimatedProp,
  HydrantInteractiveProp,
  MailboxInteractiveProp,
  TrashcanInteractiveProp,
} from "./objects";
import { ToontownRenderer } from "./Render";

interface NeighborhoodConfig {
  storageDNA: string | null; // Hood-wide storage (e.g., storage_TT)
  skybox: string | null; // Hood-wide skybox (e.g., TT_sky)
  callback?: (
    scene: PandaNode,
    loader: ToontownLoader,
    builder: DNASceneBuilder,
  ) => Promise<void>;
}

interface DNASceneConfig {
  storageDNA: string[]; // Area-specific storage (e.g., storage_TT_sz)
  sceneDNA: string | null; // Main scene DNA file (e.g., toontown_central_sz)
  extraModels?: string[]; // Additional models to load
  cacheModels?: string[]; // Addition models to load (& not add to scene)
  musicFile?: string; // Background music file
  callback?: (
    scene: PandaNode,
    loader: ToontownLoader,
    builder: DNASceneBuilder,
  ) => Promise<void>;
}

// Neighborhood configurations
const Neighborhoods: Record<string, NeighborhoodConfig> = {
  ToontownCentral: {
    storageDNA: "phase_4/dna/storage_TT",
    skybox: "phase_3.5/models/props/TT_sky",
  },
  DonaldsDock: {
    storageDNA: "phase_6/dna/storage_DD",
    skybox: "phase_3.5/models/props/BR_sky",
  },
  MinniesMelodyland: {
    storageDNA: "phase_6/dna/storage_MM",
    skybox: "phase_6/models/props/MM_sky",
  },
  DaisyGardens: {
    storageDNA: "phase_8/dna/storage_DG",
    skybox: "phase_3.5/models/props/TT_sky",
  },
  TheBrrrgh: {
    storageDNA: "phase_8/dna/storage_BR",
    skybox: "phase_3.5/models/props/BR_sky",
  },
  DonaldsDreamland: {
    storageDNA: "phase_8/dna/storage_DL",
    skybox: "phase_8/models/props/DL_sky",
  },
  GoofySpeedway: {
    storageDNA: "phase_6/dna/storage_GS",
    skybox: "phase_3.5/models/props/TT_sky",
  },
  OutdoorZone: {
    storageDNA: "phase_6/dna/storage_OZ",
    skybox: "phase_3.5/models/props/TT_sky",
  },
  Tutorial: {
    storageDNA: "phase_4/dna/storage_TT",
    skybox: "phase_3.5/models/props/TT_sky",
  },
  MyEstate: {
    storageDNA: "phase_5.5/dna/storage_estate",
    skybox: "phase_3.5/models/props/TT_sky",
    callback: async (scene, loader, builder) => {
      // Ensure the foot path renders in ground cull bin
      scene.find("**/Path")?.setAttrib(CullBinAttrib.create("ground", 10), 1);

      // Generate houses
      const houseModels = [
        "phase_5.5/models/estate/houseA",
        "phase_5.5/models/estate/tt_m_ara_est_house_tiki",
        "phase_5.5/models/estate/tt_m_ara_est_house_tepee",
        "phase_5.5/models/estate/tt_m_ara_est_house_castle",
        "phase_5.5/models/estate/tt_m_ara_est_house_cupcake",
        "phase_5.5/models/estate/test_houseA",
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

      const mailboxModel = await loader.loadModel(
        "phase_5.5/models/estate/mailboxHouse",
      );
      // const gardenModel = await loader.loadModel(
      //   "phase_5.5/models/estate/planterC",
      //   context.dataFetcher,
      // );

      for (let i = 0; i < houseDrops.length; i++) {
        const { pos, hpr } = houseDrops[i];
        const baseNode = scene.attachNewNode(`esHouse_${i}`);
        baseNode.setPosHprScale(pos, hpr, vec3.fromValues(1, 1, 1));

        const modelPath = houseModels[0]; // Math.floor(Math.random() * houseModels.length)
        const model = await loader.loadModel(modelPath);
        const house = model.cloneTo(baseNode);

        // Set wall color
        const colorIndex = i; //Math.floor(Math.random() * houseColors.length);
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
        house.findAllMatches("**/chim*").forEach((n) => {
          n.setColor(chimneyColor);
        });

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
        const mailbox = mailboxModel.cloneTo(baseNode);

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
    skybox: "phase_9/models/cogHQ/cog_sky",
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
    storageDNA: "phase_6/dna/storage_GZ",
    skybox: "phase_3.5/models/props/TT_sky",
  },
  Party: {
    storageDNA: "phase_13/dna/storage_party_sz",
    skybox: "phase_3.5/models/props/TT_sky",
  },
};

const GLOBAL_STORAGE_DNA = "phase_4/dna/storage";
const TOWN_STORAGE_DNA = "phase_5/dna/storage_town";

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
    const loader = await context.dataShare.ensureObject<ToontownLoader>(
      `${pathBase}/loader`,
      async () => {
        const loader = new ToontownLoader(context.dataFetcher);
        await loader.loadManifest();
        return loader;
      },
    );

    // Load DNA files in order and build storage
    const dnaFiles = this.getDNALoadOrder();
    console.log(`Loading DNA scene: ${this.name}`);
    console.log(`DNA load order:`, dnaFiles);

    const { storage, sceneFile } = await loader.loadDNA(dnaFiles);

    const scene = PandaNode.create("render");
    const cameraNode = scene.attachNewNode("camera");

    // Build the scene from DNA
    const sceneBuilder = new DNASceneBuilder(storage, loader);
    await sceneBuilder.build(sceneFile, scene);

    if (this.sceneConfig.extraModels) {
      for (const modelPath of this.sceneConfig.extraModels) {
        const model = await loader.loadModel(modelPath);
        model.cloneTo(scene);
      }
    }

    const hood = Neighborhoods[this.neighborhood];
    if (hood.skybox) {
      const model = await loader.loadModel(hood.skybox);
      const instance = model.cloneTo(scene);
      instance.tags.set("sky", "Regular");
      instance.setEffect(
        CompassEffect.create(CompassEffectProperties.Position, cameraNode),
      );
      instance.setAttrib(CullBinAttrib.create("background", 100));
      instance.setAttrib(DepthTestAttrib.create(PandaCompareFunc.None));
      instance.setAttrib(DepthWriteAttrib.create(DepthWriteMode.Off));
      // Ensure sky renders before clouds
      instance.find("**/Sky")?.reparentTo(instance, -1);
    }

    // Remove overlapping door frames
    scene.findAllMatches("**/doorFrameHoleLeft").forEach((node) => {
      node.hide();
    });
    scene.findAllMatches("**/doorFrameHoleRight").forEach((node) => {
      node.hide();
    });

    // Run custom callbacks
    await hood.callback?.(scene, loader, sceneBuilder);
    await this.sceneConfig.callback?.(scene, loader, sceneBuilder);

    // Create animated props
    const animProps: AnimatedProp[] = [];
    const animPropNodes = scene.findAllMatches("**/animated_prop_*");
    for (const node of animPropNodes) {
      let prop: AnimatedProp;
      if (node.name.startsWith("animated_prop_generic")) {
        prop = new GenericAnimatedProp(node);
      } else {
        const className = node.name.substring(
          "animated_prop_".length,
          node.name.length - "_DNARoot".length,
        );
        const factory = animatedPropMap.get(className);
        if (!factory) {
          console.warn(`No factory found for class ${className}`);
          continue;
        }
        prop = new factory(node);
      }
      animProps.push(prop);
    }
    const interactivePropNodes = scene.findAllMatches("**/interactive_prop_*");
    for (const node of interactivePropNodes) {
      if (node.name.includes("hydrant")) {
        animProps.push(new HydrantInteractiveProp(node));
      } else if (node.name.includes("trashcan")) {
        animProps.push(new TrashcanInteractiveProp(node));
      } else if (node.name.includes("mailbox")) {
        animProps.push(new MailboxInteractiveProp(node));
      } else {
        animProps.push(new GenericAnimatedProp(node));
      }
    }
    // const animatedBuildingNodes = scene.findAllMatches("**/*:animated_building_*;-h");
    // for (const node of animatedBuildingNodes) {
    //   console.log("Creating GenericAnimatedBuilding", node.name);
    //   animProps.push(new GenericAnimatedBuilding(node));
    // }
    // const meshFront = scene.find("**/ttc_B2_mesh_front");
    // if (meshFront) {
    //   meshFront.effects = new RenderEffects();
    // }
    await Promise.all(
      animProps.map(async (prop) => {
        await prop.init();
        prop.enter();
      }),
    );
    // TODO: clean up after

    console.log(`Loaded DNA scene: ${this.name}`);

    // Create renderer from DNA instances
    return ToontownRenderer.create(
      device,
      scene,
      loader,
      this.sceneConfig.musicFile,
    );
  }
}

const sceneDescs = [
  "Toontown Central",
  new ToontownDNASceneDesc(
    "toontown_central_sz",
    "Playground",
    "ToontownCentral",
    {
      storageDNA: ["phase_4/dna/storage_TT_sz", "phase_5/dna/storage_TT_town"],
      sceneDNA: "phase_4/dna/toontown_central_sz",
      musicFile: "phase_4/audio/bgm/TC_nbrhood.mid",
      callback: async (scene, _loader, _builder) => {
        const char = new Char();
        await char.generateChar("mk");
        char.walkToNextPoint();
        scene.addChild(char);
      },
    },
  ),
  new ToontownDNASceneDesc(
    "toontown_central_2100",
    "Silly Street",
    "ToontownCentral",
    {
      storageDNA: ["phase_4/dna/storage_TT_sz", "phase_5/dna/storage_TT_town"],
      sceneDNA: "phase_5/dna/toontown_central_2100",
      musicFile: "phase_3.5/audio/bgm/TC_SZ.mid",
    },
  ),
  new ToontownDNASceneDesc(
    "toontown_central_2200",
    "Loopy Lane",
    "ToontownCentral",
    {
      storageDNA: ["phase_4/dna/storage_TT_sz", "phase_5/dna/storage_TT_town"],
      sceneDNA: "phase_5/dna/toontown_central_2200",
      musicFile: "phase_3.5/audio/bgm/TC_SZ.mid",
    },
  ),
  new ToontownDNASceneDesc(
    "toontown_central_2300",
    "Punchline Place",
    "ToontownCentral",
    {
      storageDNA: ["phase_4/dna/storage_TT_sz", "phase_5/dna/storage_TT_town"],
      sceneDNA: "phase_5/dna/toontown_central_2300",
      musicFile: "phase_3.5/audio/bgm/TC_SZ.mid",
    },
  ),
  new ToontownDNASceneDesc("tutorial_street", "Tutorial Terrace", "Tutorial", {
    storageDNA: ["phase_5/dna/storage_TT_town"],
    sceneDNA: "phase_3.5/dna/tutorial_street",
    musicFile: "phase_3/audio/bgm/tt_theme.mid",
  }),
  "Donald's Dock",
  new ToontownDNASceneDesc("donalds_dock_sz", "Playground", "DonaldsDock", {
    storageDNA: ["phase_6/dna/storage_DD_sz", "phase_6/dna/storage_DD_town"],
    sceneDNA: "phase_6/dna/donalds_dock_sz",
    musicFile: "phase_6/audio/bgm/DD_nbrhood.mid",
    callback: async (scene, loader, _builder) => {
      const water = scene.find("**/water");
      if (water) {
        water.setAttrib(TransparencyAttrib.create(TransparencyMode.Alpha));
        water.setColor(vec4.fromValues(1, 1, 1, 0.8));
      }

      // Place boat at pier
      const boat = scene.find("**/donalds_boat");
      if (!boat) return;
      const ewPath = await loader.loadModel("phase_6/paths/dd-e-w");
      // const wePath = await loader.loadModel("phase_6/paths/dd-w-e");
      const ewXyz = ewPath.find("**/*_xyz");
      if (ewXyz instanceof NurbsCurve && boat) {
        console.log(ewXyz);
        boat.pos = ewXyz.cvs[3].point as vec3;
      }

      // Raise west pier
      const westPier = scene.find("**/west_pier");
      if (westPier) westPier.hpr = vec3.fromValues(-90, 0.25, 0);

      // Spawn Donald
      const donald = new Char();
      await donald.generateChar("dw");
      donald.pos = vec3.fromValues(0, -1, 3.95);
      boat.addChild(donald);
      boat.find("**/wheel")?.hide(); // Hide boat wheel since Donald has one
    },
  }),
  new ToontownDNASceneDesc(
    "donalds_dock_1100",
    "Barnacle Boulevard",
    "DonaldsDock",
    {
      storageDNA: ["phase_6/dna/storage_DD_sz", "phase_6/dna/storage_DD_town"],
      sceneDNA: "phase_6/dna/donalds_dock_1100",
      musicFile: "phase_6/audio/bgm/DD_SZ.mid",
    },
  ),
  new ToontownDNASceneDesc(
    "donalds_dock_1200",
    "Seaweed Street",
    "DonaldsDock",
    {
      storageDNA: ["phase_6/dna/storage_DD_sz", "phase_6/dna/storage_DD_town"],
      sceneDNA: "phase_6/dna/donalds_dock_1200",
      musicFile: "phase_6/audio/bgm/DD_SZ.mid",
    },
  ),
  new ToontownDNASceneDesc(
    "donalds_dock_1300",
    "Lighthouse Lane",
    "DonaldsDock",
    {
      storageDNA: ["phase_6/dna/storage_DD_sz", "phase_6/dna/storage_DD_town"],
      sceneDNA: "phase_6/dna/donalds_dock_1300",
      musicFile: "phase_6/audio/bgm/DD_SZ.mid",
    },
  ),
  "Minnie's Melodyland",
  new ToontownDNASceneDesc(
    "minnies_melody_land_sz",
    "Playground",
    "MinniesMelodyland",
    {
      storageDNA: ["phase_6/dna/storage_MM_sz", "phase_6/dna/storage_MM_town"],
      sceneDNA: "phase_6/dna/minnies_melody_land_sz",
      musicFile: "phase_6/audio/bgm/MM_nbrhood.mid",
      callback: async (scene) => {
        const char = new Char();
        await char.generateChar("mn");
        char.walkToNextPoint();
        scene.addChild(char);
      },
    },
  ),
  new ToontownDNASceneDesc(
    "minnies_melody_land_4100",
    "Alto Avenue",
    "MinniesMelodyland",
    {
      storageDNA: ["phase_6/dna/storage_MM_sz", "phase_6/dna/storage_MM_town"],
      sceneDNA: "phase_6/dna/minnies_melody_land_4100",
      musicFile: "phase_6/audio/bgm/MM_SZ.mid",
    },
  ),
  new ToontownDNASceneDesc(
    "minnies_melody_land_4200",
    "Baritone Boulevard",
    "MinniesMelodyland",
    {
      storageDNA: ["phase_6/dna/storage_MM_sz", "phase_6/dna/storage_MM_town"],
      sceneDNA: "phase_6/dna/minnies_melody_land_4200",
      musicFile: "phase_6/audio/bgm/MM_SZ.mid",
    },
  ),
  new ToontownDNASceneDesc(
    "minnies_melody_land_4300",
    "Tenor Terrace",
    "MinniesMelodyland",
    {
      storageDNA: ["phase_6/dna/storage_MM_sz", "phase_6/dna/storage_MM_town"],
      sceneDNA: "phase_6/dna/minnies_melody_land_4300",
      musicFile: "phase_6/audio/bgm/MM_SZ.mid",
    },
  ),
  "Daisy Gardens",
  new ToontownDNASceneDesc("daisys_garden_sz", "Playground", "DaisyGardens", {
    storageDNA: ["phase_8/dna/storage_DG_sz", "phase_8/dna/storage_DG_town"],
    sceneDNA: "phase_8/dna/daisys_garden_sz",
    musicFile: "phase_8/audio/bgm/DG_nbrhood.mid",
    callback: async (scene, loader, _builder) => {
      const flowerModel = await loader.loadModel(
        "phase_8/models/props/DG_flower-mod",
      );
      const flower = flowerModel.cloneTo(scene);
      flower.pos = vec3.fromValues(1.39, 92.91, 2.0);
      flower.scale = vec3.fromValues(2.5, 2.5, 2.5);

      const daisy = new Char();
      await daisy.generateChar("dd");
      daisy.walkToNextPoint();
      scene.addChild(daisy);
    },
  }),
  new ToontownDNASceneDesc("daisys_garden_5100", "Elm Street", "DaisyGardens", {
    storageDNA: ["phase_8/dna/storage_DG_sz", "phase_8/dna/storage_DG_town"],
    sceneDNA: "phase_8/dna/daisys_garden_5100",
    musicFile: "phase_8/audio/bgm/DG_SZ.mid",
  }),
  new ToontownDNASceneDesc(
    "daisys_garden_5200",
    "Maple Street",
    "DaisyGardens",
    {
      storageDNA: ["phase_8/dna/storage_DG_sz", "phase_8/dna/storage_DG_town"],
      sceneDNA: "phase_8/dna/daisys_garden_5200",
      musicFile: "phase_8/audio/bgm/DG_SZ.mid",
    },
  ),
  new ToontownDNASceneDesc("daisys_garden_5300", "Oak Street", "DaisyGardens", {
    storageDNA: ["phase_8/dna/storage_DG_sz", "phase_8/dna/storage_DG_town"],
    sceneDNA: "phase_8/dna/daisys_garden_5300",
    musicFile: "phase_8/audio/bgm/DG_SZ.mid",
  }),
  "The Brrrgh",
  new ToontownDNASceneDesc("the_burrrgh_sz", "Playground", "TheBrrrgh", {
    storageDNA: ["phase_8/dna/storage_BR_sz", "phase_8/dna/storage_BR_town"],
    sceneDNA: "phase_8/dna/the_burrrgh_sz",
    musicFile: "phase_8/audio/bgm/TB_nbrhood.mid",
    callback: async (scene) => {
      const char = new Char();
      await char.generateChar("p");
      char.walkToNextPoint();
      scene.addChild(char);
    },
  }),
  new ToontownDNASceneDesc("the_burrrgh_3100", "Walrus Way", "TheBrrrgh", {
    storageDNA: ["phase_8/dna/storage_BR_sz", "phase_8/dna/storage_BR_town"],
    sceneDNA: "phase_8/dna/the_burrrgh_3100",
    musicFile: "phase_8/audio/bgm/TB_SZ.mid",
  }),
  new ToontownDNASceneDesc("the_burrrgh_3200", "Sleet Street", "TheBrrrgh", {
    storageDNA: ["phase_8/dna/storage_BR_sz", "phase_8/dna/storage_BR_town"],
    sceneDNA: "phase_8/dna/the_burrrgh_3200",
    musicFile: "phase_8/audio/bgm/TB_SZ.mid",
  }),
  new ToontownDNASceneDesc("the_burrrgh_3300", "Polar Place", "TheBrrrgh", {
    storageDNA: ["phase_8/dna/storage_BR_sz", "phase_8/dna/storage_BR_town"],
    sceneDNA: "phase_8/dna/the_burrrgh_3300",
    musicFile: "phase_8/audio/bgm/TB_SZ.mid",
  }),
  "Donald's Dreamland",
  new ToontownDNASceneDesc(
    "donalds_dreamland_sz",
    "Playground",
    "DonaldsDreamland",
    {
      storageDNA: ["phase_8/dna/storage_DL_sz", "phase_8/dna/storage_DL_town"],
      sceneDNA: "phase_8/dna/donalds_dreamland_sz",
      musicFile: "phase_8/audio/bgm/DL_nbrhood.mid",
      callback: async (scene) => {
        const char = new Char();
        await char.generateChar("d");
        char.walkToNextPoint();
        scene.addChild(char);
      },
    },
  ),
  new ToontownDNASceneDesc(
    "donalds_dreamland_9100",
    "Lullaby Lane",
    "DonaldsDreamland",
    {
      storageDNA: ["phase_8/dna/storage_DL_sz", "phase_8/dna/storage_DL_town"],
      sceneDNA: "phase_8/dna/donalds_dreamland_9100",
      musicFile: "phase_8/audio/bgm/DL_SZ.mid",
    },
  ),
  new ToontownDNASceneDesc(
    "donalds_dreamland_9200",
    "Pajama Place",
    "DonaldsDreamland",
    {
      storageDNA: ["phase_8/dna/storage_DL_sz", "phase_8/dna/storage_DL_town"],
      sceneDNA: "phase_8/dna/donalds_dreamland_9200",
      musicFile: "phase_8/audio/bgm/DL_SZ.mid",
    },
  ),
  "Goofy Speedway",
  new ToontownDNASceneDesc(
    "goofy_speedway_sz",
    "Goofy Speedway",
    "GoofySpeedway",
    {
      storageDNA: ["phase_6/dna/storage_GS_sz"],
      sceneDNA: "phase_6/dna/goofy_speedway_sz",
      musicFile: "phase_6/audio/bgm/GS_SZ.mid",
      callback: async (scene) => {
        const char = new Char();
        await char.generateChar("g");
        char.walkToNextPoint();
        scene.addChild(char);
      },
    },
  ),
  new ToontownDNASceneDesc(
    "KartShop_Interior",
    "Goofy's Auto Shop",
    "GoofySpeedway",
    {
      storageDNA: [],
      sceneDNA: null,
      extraModels: ["phase_6/models/karting/KartShop_Interior"],
      musicFile: "phase_6/audio/bgm/GS_KartShop.mid",
    },
  ),
  "Chip 'n Dale's Acorn Acres",
  new ToontownDNASceneDesc(
    "outdoor_zone_sz",
    "Chip 'n Dale's Acorn Acres",
    "OutdoorZone",
    {
      storageDNA: ["phase_6/dna/storage_OZ_sz"],
      sceneDNA: "phase_6/dna/outdoor_zone_sz",
      musicFile: "phase_6/audio/bgm/OZ_SZ.mid",
      callback: async (scene) => {
        const char = new Char();
        await char.generateChar("ch");
        char.walkToNextPoint();
        scene.addChild(char);
      },
    },
  ),
  new ToontownDNASceneDesc(
    "golf_zone_sz",
    "Chip 'n Dale's MiniGolf",
    "GolfZone",
    {
      storageDNA: ["phase_6/dna/storage_GZ_sz"],
      sceneDNA: "phase_6/dna/golf_zone_sz",
      musicFile: "phase_6/audio/bgm/OZ_SZ.mid",
    },
  ),
  "Estate",
  new ToontownDNASceneDesc("estate", "Estate", "MyEstate", {
    storageDNA: [],
    sceneDNA: "phase_5.5/dna/estate_1",
  }),
  new ToontownDNASceneDesc("party_sz", "Party", "Party", {
    storageDNA: [],
    sceneDNA: "phase_13/dna/party_sz",
    musicFile: "phase_4/audio/bgm/FF_safezone.mid",
  }),
  "Sellbot HQ",
  new ToontownDNASceneDesc(
    "SellbotHQExterior",
    "Sellbot HQ Courtyard",
    "SellbotHQ",
    {
      storageDNA: [],
      sceneDNA: "phase_9/dna/cog_hq_sellbot_sz",
      extraModels: ["phase_9/models/cogHQ/SellbotHQExterior"],
      musicFile: "phase_9/audio/bgm/encntr_suit_HQ_nbrhood.mid",
    },
  ),
  new ToontownDNASceneDesc("SellbotHQLobby", "Sellbot HQ Lobby", "SellbotHQ", {
    storageDNA: [],
    sceneDNA: "phase_9/dna/cog_hq_sellbot_sz",
    extraModels: ["phase_9/models/cogHQ/SellbotHQLobby"],
    musicFile: "phase_9/audio/bgm/CHQ_FACT_bg.mid",
  }),
  "Cashbot HQ",
  new ToontownDNASceneDesc(
    "CashBotShippingStation",
    "Cashbot Train Yard",
    "CashbotHQ",
    {
      storageDNA: [],
      sceneDNA: null,
      extraModels: ["phase_10/models/cogHQ/CashBotShippingStation"],
      musicFile: "phase_9/audio/bgm/encntr_suit_HQ_nbrhood.mid",
    },
  ),
  new ToontownDNASceneDesc("VaultLobby", "Cashbot HQ Lobby", "CashbotHQ", {
    storageDNA: [],
    sceneDNA: null,
    extraModels: ["phase_10/models/cogHQ/VaultLobby"],
    musicFile: "phase_9/audio/bgm/CHQ_FACT_bg.mid",
  }),
  "Lawbot HQ",
  new ToontownDNASceneDesc("LawbotPlaza", "Lawbot HQ Courtyard", "LawbotHQ", {
    storageDNA: [],
    sceneDNA: null,
    extraModels: ["phase_11/models/lawbotHQ/LawbotPlaza"],
    musicFile: "phase_11/audio/bgm/LB_courtyard.mid",
  }),
  new ToontownDNASceneDesc("LB_CH_Lobby", "Courthouse Lobby", "LawbotHQ", {
    storageDNA: [],
    sceneDNA: null,
    extraModels: ["phase_11/models/lawbotHQ/LB_CH_Lobby"],
    musicFile: "phase_7/audio/bgm/encntr_suit_winning_indoor.mid",
  }),
  new ToontownDNASceneDesc("LB_CH_Lobby", "DA's Office Lobby", "LawbotHQ", {
    storageDNA: [],
    sceneDNA: null,
    extraModels: ["phase_11/models/lawbotHQ/LB_DA_Lobby"],
  }),
  "Bossbot HQ",
  new ToontownDNASceneDesc("CogGolfHub", "Courtyard", "BossbotHQ", {
    storageDNA: [], // "phase_12/dna/storage_CC_sz"
    sceneDNA: null,
    extraModels: ["phase_12/models/bossbotHQ/CogGolfHub"],
  }),
  new ToontownDNASceneDesc("CogGolfCourtyard", "Clubhouse", "BossbotHQ", {
    storageDNA: [],
    sceneDNA: null,
    extraModels: ["phase_12/models/bossbotHQ/CogGolfCourtyard"],
  }),
];

export const sceneGroup: Viewer.SceneGroup = {
  id: "Toontown",
  name: "Toontown Online",
  sceneDescs,
};
