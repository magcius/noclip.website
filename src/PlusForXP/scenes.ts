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
import { ISimulation } from "./types.js";

type EnvironmentMap = {
  texturePath: string,
  rotation: [number, number, number]
};

type SceneSource = {
  path: string, 
  count?: number,
  scene?: SCX.Scene,
  environment?: EnvironmentMap
};

type Variant = { 
  name: string, 
  cameras: [string, string][],
  scenes: SceneSource[], 
  envTexturePaths: string[], 
  envMapRotation: [number, number, number],
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
          {path: "pool", scene: pool},
          {path: "Mercury_Pool_Drop.scx", count: 3},
          {path: "Mercury_Pool_Splash.scx", count: 3},
        ],
        envTexturePaths: [
          'Environment_Cave.TIF',
        ],
        envMapRotation: [90, 180, 0],
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
          {path: "pool", scene: pool},
          {path: "Mercury_Pool_Drop.scx", count: 3},
          {path: "Mercury_Pool_Splash.scx", count: 3},
        ],
        envTexturePaths: [
          'Environment_Tech.tif',
        ],
        envMapRotation: [90, 180, 0],
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
          {path: "Balance_Scene.scx"},
          {path: "Balance_Bar.scx"},
          {path: "Balance_Stand.scx"},
          {path: "Balance_Camera_Coaster.scx"},
          {path: "Balance_Camera_Orbit.scx"},

          {path: "Balance_Man1A.scx"},
          // {path: "Balance_Man1AReal.scx"}, // animated, unused
          // {path: "Balance_Man1B.scx"}, // animated, unused
          {path: "Balance_Man2A.scx"},
        ],
        envTexturePaths: [
          'EnvironmentGold.tif',
          'EnvironmentSilver.tif',
        ],
        envMapRotation: [0, 0, 0],
        createSimulation: () => new RobotCircus()
      },
      arena: {
        name: "Arena",
        cameras: [
          ["Coaster", "Balance_Camera_Coaster.scx/Camera02"],
          ["Orbit", "Balance_Camera_Orbit.scx/Camera01"]
        ],
        scenes: [
          {path: "Balance_Tech_Scene.scx"},
          {path: "Balance_Tech_Bar.scx"},
          {path: "Balance_Tech_Stand.scx"},
          {path: "Balance_Camera_Coaster.scx"},
          {path: "Balance_Camera_Orbit.scx"},

          {path: "Balance_Man3A.scx"},
          // {path: "Balance_Man3B.scx"},
          {path: "Balance_Man4A.scx"},
        ],
        envTexturePaths: [
          'EnvironmentTech.tif',
        ],
        envMapRotation: [0, 90, 0],
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
          {path: "Pendulum_Camera_Orbit.scx"},
          {path: "Pendulum_Camera.scx"},
          {path: "Pendulum_Camera_Closeup.scx"},
          {path: "Pendulum_Sand.scx"},
          {path: "Pendulum_Sand_Particles.scx"},
          {path: "Sparkle.scx"},
          {path: "Pendulum_SW_Pendulum.scx"},
          {path: "Pendulum_SW_Scene.scx"},
        ],
        envTexturePaths: [
          'EnvironmentGold.tif',
        ],
        envMapRotation: [0, 0, 0],
        createSimulation: () => new SandPendulum()
      },
      checkerboard: {
        name: "Checkerboard", 
        cameras: [
          ["Coaster", "Pendulum_Camera_Closeup.scx/Camera02"],
          ["Orbit", "Pendulum_Camera_Orbit.scx/Camera01"],
        ],
        scenes: [
          {path: "Pendulum_Camera_Orbit.scx"},
          {path: "Pendulum_Camera.scx"},
          {path: "Pendulum_Camera_Closeup.scx"},
          {path: "Pendulum_Sand.scx"},
          {path: "Pendulum_Sand_Particles.scx"},
          {path: "Sparkle.scx"},
          {path: "Pendulum_Pendulum.scx"},
          {path: "Pendulum_Scene.scx"},
        ],
        envTexturePaths: [
          'EnvironmentGold.tif',
        ],
        envMapRotation: [0, 0, 0],
        createSimulation: () => new SandPendulum()
      }
    },
  },
};

const fetchScene = async (sceneContext: SceneContext, basePath: string, source: SceneSource) : Promise<[string, SCX.Scene][]> => {
  const {path, count} = source;
  let scene = source.scene;
  if (scene == null) {
    const data = await sceneContext.dataFetcher.fetchData(`${basePath}${path}`);
    scene = await parseSCX(new Uint8Array(data.arrayBuffer));
  }
  return (count ?? 1) > 1
    ? Array(count).fill(0).map((_, i) => ([`${path}_${i + 1}/`, scene]))
    : [[`${path}/`, scene]];
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
            const { envMapRotation, cameras, createSimulation: simulateFunc } = variant;
            const basePath = `PlusForXP/${screensaver.basePath}`
            const scenes: Record<string, SCX.Scene> = Object.fromEntries((await Promise.all(
              variant.scenes.map((source) => fetchScene(sceneContext, basePath, source))
            )).flat());
            const [textures, envTextures] = await Promise.all([
              fetchTextures(sceneContext.dataFetcher, basePath, 
                (Object.values(scenes) as SCX.Scene[])
                .flatMap(({shaders}) => shaders ?? [])
                .map(shader => shader.texture)
                .filter(texture => texture != null)
                .map(texturePath => texturePath.replaceAll("\\", "/"))
              ),
              fetchTextures(sceneContext.dataFetcher, basePath, variant.envTexturePaths)
            ]);
            const textureHolder = makeTextureHolder([...textures, ...envTextures]);
            return new Renderer(device, {basePath, scenes, textures, envTextures, envMapRotation, cameras, simulateFunc}, textureHolder);
          }
        }))
    ]))
};