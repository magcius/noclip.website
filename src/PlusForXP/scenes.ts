import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";

type Variant = { 
  name: string, 
  cameras: [string, string][],
  scenePaths: string[]
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
        ]
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
        ]
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
        ]
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
        ]
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
        ]
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
        ]
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
            // TODO
            return {render: _=>_, destroy: _=>_};
          }
        }))
    ]))
};