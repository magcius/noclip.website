import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";

import { parse as parseSCX } from './scx/parser.js'
import { SCX } from "./scx/types.js";
import { fetchTextures, makeTextureHolder } from "./util.js";
import Renderer from './renderer.js';

type Variant = { 
  name: string, 
  cameras: [string, string][],
  scenePaths: string[], 
  envTexturePaths: string[], 
  envMapRotation: [number, number, number] 
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
        scenePaths: [
          "Mercury_Pool_Cave_Scene.scx",
          "Mercury_Pool_Cave_Camera.scx",

          "Mercury_Pool_Drop.scx",
          "Mercury_Pool_Splash.scx",
        ],
        envTexturePaths: [
          'Environment_Cave.TIF',
        ],
        envMapRotation: [90, 180, 0]
      },
      industrial: {
        name: "Industrial", 
        cameras: [
          ["Orbit", "Mercury_Pool_Tech_Camera.scx/Camera01"],
        ],
        scenePaths: [
          "Mercury_Pool_Tech_Scene.scx",
          "Mercury_Pool_Tech_Camera.scx",
          "Mercury_Pool_Tech_Sky.scx",

          "Mercury_Pool_Drop.scx",
          "Mercury_Pool_Splash.scx",
        ],
        envTexturePaths: [
          'Environment_Tech.tif',
        ],
        envMapRotation: [90, 180, 0]
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
        scenePaths: [
          "Balance_Scene.scx",
          "Balance_Bar.scx",
          "Balance_Stand.scx",
          "Balance_Camera_Coaster.scx",
          "Balance_Camera_Orbit.scx",

          "Balance_Man1A.scx",
          // "Balance_Man1AReal.scx",
          // "Balance_Man1B.scx",
          "Balance_Man2A.scx",
        ],
        envTexturePaths: [
          'EnvironmentGold.tif',
          'EnvironmentSilver.tif',
        ],
        envMapRotation: [0, 0, 0]
      },
      arena: {
        name: "Arena",
        cameras: [
          ["Coaster", "Balance_Camera_Coaster.scx/Camera02"],
          ["Orbit", "Balance_Camera_Orbit.scx/Camera01"]
        ],
        scenePaths: [
          "Balance_Tech_Scene.scx",
          "Balance_Tech_Bar.scx",
          "Balance_Tech_Stand.scx",
          "Balance_Camera_Coaster.scx",
          "Balance_Camera_Orbit.scx",

          "Balance_Man3A.scx",
          // "Balance_Man3B.scx",
          "Balance_Man4A.scx",
        ],
        envTexturePaths: [
          'EnvironmentTech.tif',
        ],
        envMapRotation: [0, 90, 0]
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
        scenePaths: [
          "Pendulum_Camera_Orbit.scx",
          "Pendulum_Camera.scx",
          "Pendulum_Camera_Closeup.scx",
          "Pendulum_Sand.scx",
          "Pendulum_Sand_Particles.scx",
          "Sparkle.scx",
          "Pendulum_SW_Pendulum.scx",
          "Pendulum_SW_Scene.scx",
        ],
        envTexturePaths: [
          'EnvironmentGold.tif',
        ],
        envMapRotation: [0, 0, 0]
      },
      checkerboard: {
        name: "Checkerboard", 
        cameras: [
          ["Coaster", "Pendulum_Camera_Closeup.scx/Camera02"],
          ["Orbit", "Pendulum_Camera_Orbit.scx/Camera01"],
        ],
        scenePaths: [
          "Pendulum_Camera_Orbit.scx",
          "Pendulum_Camera.scx",
          "Pendulum_Camera_Closeup.scx",
          "Pendulum_Sand.scx",
          "Pendulum_Sand_Particles.scx",
          "Sparkle.scx",
          "Pendulum_Pendulum.scx",
          "Pendulum_Scene.scx",
        ],
        envTexturePaths: [
          'EnvironmentGold.tif',
        ],
        envMapRotation: [0, 0, 0]
      }
    },
  },
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
            const { envMapRotation, cameras } = variant;
            const basePath = `PlusForXP/${screensaver.basePath}`
            const scenes: Record<string, SCX.Scene> = Object.fromEntries(await Promise.all(
              variant.scenePaths
                .map(
                  filename => sceneContext.dataFetcher.fetchData(`${basePath}${filename}`)
                  .then(({arrayBuffer}) => parseSCX(new Uint8Array(arrayBuffer)))
                  .then(scene => ([`${filename}/`, scene]))
                )
            ));
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
            return new Renderer(device, {basePath, scenes, textures, envTextures, envMapRotation, cameras}, textureHolder);
          }
        }))
    ]))
};