
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { BSPEntity } from "./BSPFile.js";
import { BaseEntity, EntityFactoryRegistry, EntitySystem } from "./EntitySystem.js";
import { BSPRenderer, SourceFileSystem, SourceLoadContext, SourceRenderContext } from "./Main.js";
import { createScene } from "./Scenes.js";

class npc_portal_turret_floor extends BaseEntity {
    public static classname = 'npc_portal_turret_floor';

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);
        this.setModelName(renderContext, 'models/props/Turret_01.mdl');
    }
}

class prop_portal_stats_display extends BaseEntity {
    public static classname = 'prop_portal_stats_display';

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);
        this.setModelName(renderContext, 'models/props/Round_elevator_body.mdl');
    }
}

class PortalSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    private registerEntityFactories(registry: EntityFactoryRegistry): void {
        registry.registerFactory(npc_portal_turret_floor);
        registry.registerFactory(prop_portal_stats_display);
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${pathBase}/portal_pak`),
                filesystem.createVPKMount(`HalfLife2/hl2_textures`),
                filesystem.createVPKMount(`HalfLife2/hl2_misc`),
            ]);
            return filesystem;
        });

        const loadContext = new SourceLoadContext(filesystem);
        this.registerEntityFactories(loadContext.entityFactoryRegistry);
        return createScene(context, loadContext, this.id, `${pathBase}/maps/${this.id}.bsp`, false);
    }
}

const pathBase = `Portal`;

const id = 'Portal';
const name = 'Portal';
const sceneDescs = [
    "Main Menu Background",
    new PortalSceneDesc('background1'),

    "Normal Chambers",
    new PortalSceneDesc('testchmb_a_00', 'Chamber 00-01'),
    new PortalSceneDesc('testchmb_a_01', 'Chamber 02-03'),
    new PortalSceneDesc('testchmb_a_02','Chamber 04-05'),
    new PortalSceneDesc('testchmb_a_03','Chamber 06-07'),
    new PortalSceneDesc('testchmb_a_04','Chamber 08'),
    new PortalSceneDesc('testchmb_a_05','Chamber 09'),
    new PortalSceneDesc('testchmb_a_06','Chamber 10'),
    new PortalSceneDesc('testchmb_a_07','Chamber 11-12'),
    new PortalSceneDesc('testchmb_a_08','Chamber 13'),
    new PortalSceneDesc('testchmb_a_09','Chamber 14'),
    new PortalSceneDesc('testchmb_a_10','Chamber 15'),
    new PortalSceneDesc('testchmb_a_11','Chamber 16'),
    new PortalSceneDesc('testchmb_a_13','Chamber 17'),
    new PortalSceneDesc('testchmb_a_14','Chamber 18'),
    new PortalSceneDesc('testchmb_a_15','Chamber 19 & Escape (Part 1) (Chamber 20)'),
    new PortalSceneDesc('escape_00', 'Escape (Part 2)'),
    new PortalSceneDesc('escape_01', 'Escape (Part 3)'),
    new PortalSceneDesc('escape_02', 'Escape (Part 4 - GLaDOS\' Chamber)'),

    "Advanced Chambers",
    new PortalSceneDesc('testchmb_a_08_advanced', 'Chamber 13 (Advanced)'),
    new PortalSceneDesc('testchmb_a_09_advanced', 'Chamber 14 (Advanced)'),
    new PortalSceneDesc('testchmb_a_10_advanced', 'Chamber 15 (Advanced)'),
    new PortalSceneDesc('testchmb_a_11_advanced', 'Chamber 16 (Advanced)'),
    new PortalSceneDesc('testchmb_a_13_advanced', 'Chamber 17 (Advanced)'),
    new PortalSceneDesc('testchmb_a_14_advanced', 'Chamber 18 (Advanced)'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
