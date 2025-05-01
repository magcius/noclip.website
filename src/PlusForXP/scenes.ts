import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext } from "../SceneBase";
import { SceneGfx, SceneDesc } from "../viewer";

import { Parser as SCXParser } from "./scx/parser";
import { SCX } from "./scx/types";
import { decodeImage, createTextureHolder } from "./util";
import Renderer from "./renderer";
import { createPoolScene, MercuryPool } from "./simulations/mercury_pool";
import RobotCircus from "./simulations/robot_circus";
import SandPendulum from "./simulations/sand_pendulum";
import { EnvironmentMap, Simulation, Texture } from "./types";

type SceneSource = { envID?: string } & ({ type: "fetched"; path: string; count?: number } | { type: "procedural"; name: string; func: () => SCX.Scene });

type Variant = {
    name: string;
    cameras: [string, string][];
    scenes: SceneSource[];
    environmentMaps: Record<string, EnvironmentMap>;
    createSimulation: () => Simulation;
};
type Screensaver = { name: string; basePath: string; variants: Record<string, Variant> };

const screensavers: Record<string, Screensaver> = {
    mercury_pool: {
        name: "Mercury Pool",
        basePath: "Screensavers/Mercury Pool/Media/",
        variants: {
            cavern: {
                name: "Cavern",
                cameras: [["Dolly", "Mercury_Pool_Cave_Camera.scx/Camera02"]],
                scenes: [
                    { type: "fetched", path: "Mercury_Pool_Cave_Scene.scx" },
                    { type: "fetched", path: "Mercury_Pool_Cave_Camera.scx" },
                    { type: "procedural", name: "pool", func: () => createPoolScene(), envID: "cave" },
                    { type: "fetched", path: "Mercury_Pool_Drop.scx", count: 5, envID: "cave" },
                    { type: "fetched", path: "Mercury_Pool_Splash.scx", count: 5, envID: "cave" },
                ],
                environmentMaps: {
                    cave: { texturePath: "Environment_Cave.TIF", rotation: [90, 180, 0], tint: [0.4, 1.0, 0.5] },
                },
                createSimulation: () => new MercuryPool(),
            },
            industrial: {
                name: "Industrial",
                cameras: [["Orbit", "Mercury_Pool_Tech_Camera.scx/Camera01"]],
                scenes: [
                    { type: "fetched", path: "Mercury_Pool_Tech_Scene.scx" },
                    { type: "fetched", path: "Mercury_Pool_Tech_Camera.scx" },
                    { type: "fetched", path: "Mercury_Pool_Tech_Sky.scx" },
                    { type: "procedural", name: "pool", func: () => createPoolScene(), envID: "tech" },
                    { type: "fetched", path: "Mercury_Pool_Drop.scx", count: 5, envID: "tech" },
                    { type: "fetched", path: "Mercury_Pool_Splash.scx", count: 5, envID: "tech" },
                ],
                environmentMaps: {
                    tech: { texturePath: "Environment_Tech.tif", rotation: [90, 180, 0], tint: [1.8, 1.8, 1.8] },
                },
                createSimulation: () => new MercuryPool(),
            },
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
                    ["Orbit", "Balance_Camera_Orbit.scx/Camera01"],
                ],
                scenes: [
                    { type: "fetched", path: "Balance_Scene.scx" },
                    { type: "fetched", path: "Balance_Bar.scx", envID: "silver" },
                    { type: "fetched", path: "Balance_Stand.scx", envID: "silver" },
                    { type: "fetched", path: "Balance_Camera_Coaster.scx" },
                    { type: "fetched", path: "Balance_Camera_Orbit.scx" },

                    { type: "fetched", path: "Balance_Man1A.scx", envID: "gold" },
                    // {path: "Balance_Man1AReal.scx", envID: "gold"}, // animated, unused
                    // {path: "Balance_Man1B.scx", envID: "gold"}, // animated, unused
                    { type: "fetched", path: "Balance_Man2A.scx", envID: "gold" },
                ],
                environmentMaps: {
                    gold: { texturePath: "EnvironmentGold.tif", rotation: [0, 0, 0] },
                    silver: { texturePath: "EnvironmentSilver.tif", rotation: [0, 0, 0] },
                },
                createSimulation: () => new RobotCircus(),
            },
            arena: {
                name: "Arena",
                cameras: [
                    ["Coaster", "Balance_Camera_Coaster.scx/Camera02"],
                    ["Orbit", "Balance_Camera_Orbit.scx/Camera01"],
                ],
                scenes: [
                    { type: "fetched", path: "Balance_Tech_Scene.scx" },
                    { type: "fetched", path: "Balance_Tech_Bar.scx", envID: "tech" },
                    { type: "fetched", path: "Balance_Tech_Stand.scx", envID: "tech" },
                    { type: "fetched", path: "Balance_Camera_Coaster.scx" },
                    { type: "fetched", path: "Balance_Camera_Orbit.scx" },

                    { type: "fetched", path: "Balance_Man3A.scx", envID: "tech" },
                    // {path: "Balance_Man3B.scx", envID: "tech"},
                    { type: "fetched", path: "Balance_Man4A.scx", envID: "tech" },
                ],
                environmentMaps: {
                    tech: { texturePath: "EnvironmentTech.tif", rotation: [0, 90, 0] },
                },
                createSimulation: () => new RobotCircus(),
            },
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
                    { type: "fetched", path: "Pendulum_Camera_Orbit.scx" },
                    { type: "fetched", path: "Pendulum_Camera.scx" },
                    { type: "fetched", path: "Pendulum_Camera_Closeup.scx" },
                    { type: "fetched", path: "Pendulum_Sand.scx" },
                    { type: "fetched", path: "Pendulum_Sand_Particles.scx" },
                    { type: "fetched", path: "Sparkle.scx" },
                    { type: "fetched", path: "Pendulum_SW_Pendulum.scx", envID: "gold" },
                    { type: "fetched", path: "Pendulum_SW_Scene.scx" },
                ],
                environmentMaps: {
                    gold: { texturePath: "EnvironmentGold.tif", rotation: [0, 0, 0] },
                },
                createSimulation: () => new SandPendulum(),
            },
            checkerboard: {
                name: "Checkerboard",
                cameras: [
                    ["Coaster", "Pendulum_Camera_Closeup.scx/Camera02"],
                    ["Orbit", "Pendulum_Camera_Orbit.scx/Camera01"],
                ],
                scenes: [
                    { type: "fetched", path: "Pendulum_Camera_Orbit.scx" },
                    { type: "fetched", path: "Pendulum_Camera.scx" },
                    { type: "fetched", path: "Pendulum_Camera_Closeup.scx" },
                    { type: "fetched", path: "Pendulum_Sand.scx" },
                    { type: "fetched", path: "Pendulum_Sand_Particles.scx" },
                    { type: "fetched", path: "Sparkle.scx" },
                    { type: "fetched", path: "Pendulum_Pendulum.scx", envID: "gold" },
                    { type: "fetched", path: "Pendulum_Scene.scx" },
                ],
                environmentMaps: {
                    gold: { texturePath: "EnvironmentGold.tif", rotation: [0, 0, 0] },
                },
                createSimulation: () => new SandPendulum(),
            },
        },
    },
};

class PlusForXPSceneDesc implements SceneDesc {
    id: string;
    name: string;

    constructor(
        private screensaverID: string,
        private variantID: string,
        private variant: Variant,
    ) {
        this.id = `${screensaverID}-${variantID}`;
        this.name = variant.name;
    }

    async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        const screensaver = screensavers[this.screensaverID];
        const { environmentMaps, cameras, createSimulation: simulateFunc } = this.variant;
        const basePath = `PlusForXP/${screensaver.basePath}`;

        const fetches = [];
        const scenes: Record<string, { scene: SCX.Scene; envID?: string }> = {};

        for (const scene of this.variant.scenes) {
            fetches.push(
                (async (source) => {
                    switch (source.type) {
                        case "fetched": {
                            const { path, count, envID } = source;
                            const data = await sceneContext.dataFetcher.fetchData(`${basePath}${path}`);
                            const scene = SCXParser.parse(data);
                            if (count === undefined) {
                                scenes[`${path}/`] = { scene, envID };
                                break;
                            }
                            for (let i = 0; i < count; i++) {
                                scenes[`${path}_${i + 1}/`] = { scene, envID };
                            }
                            break;
                        }
                        case "procedural": {
                            const { name, func, envID } = source;
                            scenes[`${name}/`] = { scene: func(), envID };
                            break;
                        }
                    }
                })(scene),
            );
        }

        await Promise.all(fetches);

        const texturePaths: string[] = [];
        for (const { scene } of Object.values(scenes)) {
            for (const { texture: texturePath } of scene.shaders) {
                if (texturePath === undefined) {
                    continue;
                }
                texturePaths.push(texturePath.replaceAll("\\", "/"));
            }
        }
        texturePaths.push(...Object.values(environmentMaps).map(({ texturePath }) => texturePath));

        const loaders = [];
        const textures: Texture[] = [];
        for (const texturePath of texturePaths) {
            loaders.push(
                (async (path) => {
                    const { arrayBuffer } = await sceneContext.dataFetcher.fetchData(`${basePath}/${path}`);
                    const texture = await decodeImage(path, arrayBuffer);
                    if (texture != null) {
                        textures.push(texture);
                    }
                })(texturePath),
            );
        }
        await Promise.all(loaders);

        const textureHolder = createTextureHolder(textures);
        return new Renderer(device, { basePath, scenes, textures, environmentMaps, cameras, simulateFunc }, textureHolder);
    }
}

export const sceneGroup = {
    id: "PlusForXP",
    name: "Plus! for XP",
    sceneDescs: Object.entries(screensavers).flatMap(([screensaverID, screensaver]) => [
        screensaver.name,
        ...(Object.entries(screensaver.variants) as [string, Variant][]).flatMap(
            ([variantID, variant]) => new PlusForXPSceneDesc(screensaverID, variantID, variant),
        ),
    ]),
};
