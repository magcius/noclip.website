import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";

import { parse as parseSCX } from './scx/parser.js'
import { SCX } from "./scx/types.js";
import { fetchTextures, makeTextureHolder } from "./util.js";
import Renderer from './renderer.js';
import MercuryPool from "./simulations/mercury_pool.js";
import RobotCircus from "./simulations/robot_circus.js";
import SandPendulum from "./simulations/sand_pendulum.js";
import pool from "./pool.js";
import { EnvironmentMap, ISimulation } from "./types.js";

type SceneSource = {
  path: string, 
  count?: number,
  scene?: SCX.Scene,
  envID?: string
};

type Variant = { 
  name: string, 
  cameras: [string, string][],
  scenes: SceneSource[], 
  environmentMaps: Record<string, EnvironmentMap>,
  createSimulation: () => ISimulation
};
type Screensaver = { name: string, basePath: string, variants: Record<string, Variant> };

const screensavers: Record<string, Screensaver> = {
  mercury_pool: {
    name: "Mercury Pool",
    basePath: "Screensavers/Mercury Pool/Media/",
    variants: {
      cavern: {
        name: "Cavern",
        cameras: [
          ["Dolly", "Mercury_Pool_Cave_Camera.scx/Camera02"]
        ],
        scenes: [
          {path: "Mercury_Pool_Cave_Scene.scx"},
          {path: "Mercury_Pool_Cave_Camera.scx"},
          {path: "pool", scene: pool, envID: "cave"},
          {path: "Mercury_Pool_Drop.scx", count: 3, envID: "cave"},
          {path: "Mercury_Pool_Splash.scx", count: 3, envID: "cave"},
        ],
        environmentMaps: {
          "cave": { texturePath: "Environment_Cave.TIF", rotation: [90, 180, 0] }
        },
        createSimulation: () => new MercuryPool()
      },
      industrial: {
        name: "Industrial",
        cameras: [
          ["Orbit", "Mercury_Pool_Tech_Camera.scx/Camera01"],
        ],
        scenes: [
          {path: "Mercury_Pool_Tech_Scene.scx"},
          {path: "Mercury_Pool_Tech_Camera.scx"},
          {path: "Mercury_Pool_Tech_Sky.scx"},
          {path: "pool", scene: pool, envID: "tech"},
          {path: "Mercury_Pool_Drop.scx", count: 3, envID: "tech"},
          {path: "Mercury_Pool_Splash.scx", count: 3, envID: "tech"},
        ],
        environmentMaps: {
          "tech": { texturePath: "Environment_Tech.tif", rotation: [90, 180, 0]}
        },
        createSimulation: () => new MercuryPool()
      }
    },
  },
  robot_circus: {
    name: "Robot Circus",
    basePath: "Screensavers/Robot Circus/Media/",
    variants: {
      classic: {
        name: "Classic",
        cameras: [
          ["Coaster", "Balance_Camera_Coaster.scx/Camera02"],
          ["Orbit", "Balance_Camera_Orbit.scx/Camera01"]
        ],
        scenes: [
          {path: "Balance_Scene.scx", envID: "silver"}, // envID necessary?
          {path: "Balance_Bar.scx", envID: "silver"}, // envID necessary?
          {path: "Balance_Stand.scx", envID: "silver"}, // envID necessary?
          {path: "Balance_Camera_Coaster.scx"},
          {path: "Balance_Camera_Orbit.scx"},

          {path: "Balance_Man1A.scx", envID: "gold"},
          // {path: "Balance_Man1AReal.scx", envID: "gold"}, // animated, unused
          // {path: "Balance_Man1B.scx", envID: "gold"}, // animated, unused
          {path: "Balance_Man2A.scx", envID: "gold"},
        ],
        environmentMaps: {
          "gold": { texturePath: "EnvironmentGold.tif", rotation: [0, 0, 0] },
          "silver": { texturePath: "EnvironmentSilver.tif", rotation: [0, 0, 0] }
        },
        createSimulation: () => new RobotCircus()
      },
      arena: {
        name: "Arena",
        cameras: [
          ["Coaster", "Balance_Camera_Coaster.scx/Camera02"],
          ["Orbit", "Balance_Camera_Orbit.scx/Camera01"]
        ],
        scenes: [
          {path: "Balance_Tech_Scene.scx", envID: "tech"}, // envID necessary?
          {path: "Balance_Tech_Bar.scx", envID: "tech"}, // envID necessary?
          {path: "Balance_Tech_Stand.scx", envID: "tech"}, // envID necessary?
          {path: "Balance_Camera_Coaster.scx", envID: "tech"}, // envID necessary?
          {path: "Balance_Camera_Orbit.scx", envID: "tech"}, // envID necessary?

          {path: "Balance_Man3A.scx", envID: "tech"}, // envID necessary?
          // {path: "Balance_Man3B.scx", envID: "tech"}, // envID necessary?
          {path: "Balance_Man4A.scx", envID: "tech"}, // envID necessary?
        ],
        environmentMaps: {
          "tech": { texturePath: "EnvironmentTech.tif", rotation: [0, 90, 0] },
        },
        createSimulation: () => new RobotCircus()
      }
    },
  },
  sand_pendulum: {
    name: "Sand Pendulum",
    basePath: "Screensavers/Sand Pendulum/Media/",
    variants: {
      grotto: {
        name: "Grotto",
        cameras: [
          ["Coaster", "Pendulum_Camera_Closeup.scx/Camera02"],
          ["Orbit", "Pendulum_Camera_Orbit.scx/Camera01"],
        ],
        scenes: [
          {path: "Pendulum_Camera_Orbit.scx", envID: "gold"}, // envID necessary?
          {path: "Pendulum_Camera.scx", envID: "gold"}, // envID necessary?
          {path: "Pendulum_Camera_Closeup.scx", envID: "gold"}, // envID necessary?
          {path: "Pendulum_Sand.scx", envID: "gold"}, // envID necessary?
          {path: "Pendulum_Sand_Particles.scx", envID: "gold"}, // envID necessary?
          {path: "Sparkle.scx", envID: "gold"}, // envID necessary?
          {path: "Pendulum_SW_Pendulum.scx", envID: "gold"}, // envID necessary?
          {path: "Pendulum_SW_Scene.scx", envID: "gold"}, // envID necessary?
        ],
        environmentMaps: {
          "gold": { texturePath: "EnvironmentGold.tif", rotation: [0, 0, 0] },
        },
        createSimulation: () => new SandPendulum()
      },
      checkerboard: {
        name: "Checkerboard", 
        cameras: [
          ["Coaster", "Pendulum_Camera_Closeup.scx/Camera02"],
          ["Orbit", "Pendulum_Camera_Orbit.scx/Camera01"],
        ],
        scenes: [
          {path: "Pendulum_Camera_Orbit.scx", envID: "gold"}, // envID necessary?
          {path: "Pendulum_Camera.scx", envID: "gold"}, // envID necessary?
          {path: "Pendulum_Camera_Closeup.scx", envID: "gold"}, // envID necessary?
          {path: "Pendulum_Sand.scx", envID: "gold"}, // envID necessary?
          {path: "Pendulum_Sand_Particles.scx", envID: "gold"}, // envID necessary?
          {path: "Sparkle.scx", envID: "gold"}, // envID necessary?
          {path: "Pendulum_Pendulum.scx", envID: "gold"}, // envID necessary?
          {path: "Pendulum_Scene.scx", envID: "gold"}, // envID necessary?
        ],
        environmentMaps: {
          "gold": { texturePath: "EnvironmentGold.tif", rotation: [0, 0, 0] },
        },
        createSimulation: () => new SandPendulum()
      }
    },
  },
};

const fetchScene = async (sceneContext: SceneContext, basePath: string, source: SceneSource) : Promise<[string, [SCX.Scene, string?]][]> => {
  const {path, count, envID} = source;
  let scene = source.scene;
  if (scene == null) {
    const data = await sceneContext.dataFetcher.fetchData(`${basePath}${path}`);
    scene = await parseSCX(new Uint8Array(data.arrayBuffer));
  }
  return (count ?? 1) > 1
    ? Array(count).fill(0).map((_, i) => ([`${path}_${i + 1}/`, [scene, envID]]))
    : [[`${path}/`, [scene, envID]]];
};

export const sceneGroup = {
  id: "PlusForXP",
  name: "Plus! for XP",
  sceneDescs: (Object.entries(screensavers) as [string, Screensaver][])
    .flatMap(([screensaverID, screensaver]) => ([
      screensaver.name, 
      ...(Object.entries(screensaver.variants) as [string, Variant][])
        .flatMap(([variantID, variant]) => ({
          id: `${screensaverID}-${variantID}`,
          name: variant.name,
          createScene: async (device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> => {
            const screensaver = screensavers[screensaverID];
            const variant = screensaver.variants[variantID];
            const { environmentMaps, cameras, createSimulation: simulateFunc } = variant;
            const basePath = `PlusForXP/${screensaver.basePath}`
            const scenes: Record<string, [SCX.Scene, string?]> = Object.fromEntries((await Promise.all(
              variant.scenes.map(async (source) => (await fetchScene(sceneContext, basePath, source)))
            )).flat());
            const textures = (await Promise.all([
              fetchTextures(sceneContext.dataFetcher, basePath, 
                (Object.values(scenes) as [SCX.Scene, string?][])
                .map(([scene]) => scene)
                .flatMap(({shaders}) => shaders ?? [])
                .map(shader => shader.texture)
                .filter(texture => texture != null)
                .map(texturePath => texturePath.replaceAll("\\", "/"))
              ),
              fetchTextures(sceneContext.dataFetcher, basePath, Object.values(environmentMaps).map(({texturePath}) => texturePath))
            ])).flat();
            const textureHolder = makeTextureHolder(textures);
            return new Renderer(device, {basePath, scenes, textures, environmentMaps, cameras, simulateFunc}, textureHolder);
          }
        }))
    ]))
};