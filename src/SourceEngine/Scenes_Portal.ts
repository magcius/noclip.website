
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { BSPEntity } from "./BSPFile";
import { BaseEntity, EntityFactoryRegistry, EntitySystem } from "./EntitySystem";
import { BSPRenderer, SourceFileSystem, SourceLoadContext, SourceRenderContext } from "./Main";
import { createScene } from "./Scenes";

class npc_portal_turret_floor extends BaseEntity {
    public static classname = 'npc_portal_turret_floor';

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);
        this.setModelName(renderContext, 'models/props/Turret_01.mdl');
    }
}

class PortalSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    private registerEntityFactories(registry: EntityFactoryRegistry): void {
        registry.registerFactory(npc_portal_turret_floor);
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
    new PortalSceneDesc('background1'),
    new PortalSceneDesc('testchmb_a_00'),
    new PortalSceneDesc('testchmb_a_01'),
    new PortalSceneDesc('testchmb_a_02'),
    new PortalSceneDesc('testchmb_a_03'),
    new PortalSceneDesc('testchmb_a_04'),
    new PortalSceneDesc('testchmb_a_05'),
    new PortalSceneDesc('testchmb_a_06'),
    new PortalSceneDesc('testchmb_a_07'),
    new PortalSceneDesc('testchmb_a_08'),
    new PortalSceneDesc('testchmb_a_09'),
    new PortalSceneDesc('testchmb_a_10'),
    new PortalSceneDesc('testchmb_a_11'),
    new PortalSceneDesc('testchmb_a_13'),
    new PortalSceneDesc('testchmb_a_14'),
    new PortalSceneDesc('testchmb_a_15'),
    new PortalSceneDesc('escape_00'),
    new PortalSceneDesc('escape_01'),
    new PortalSceneDesc('escape_02'),
    new PortalSceneDesc('testchmb_a_08_advanced'),
    new PortalSceneDesc('testchmb_a_09_advanced'),
    new PortalSceneDesc('testchmb_a_10_advanced'),
    new PortalSceneDesc('testchmb_a_11_advanced'),
    new PortalSceneDesc('testchmb_a_13_advanced'),
    new PortalSceneDesc('testchmb_a_14_advanced'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
