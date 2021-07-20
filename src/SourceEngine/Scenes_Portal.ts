
import { vec3 } from "gl-matrix";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { assert, nArray } from "../util";
import { BSPFile } from "./BSPFile";
import { BaseEntity, EntityFactoryRegistry, EntitySystem } from "./EntitySystem";
import { BSPRenderer, SkyboxRenderer, SourceFileSystem, SourceRenderContext, SourceRenderer } from "./Main";
import { createScene } from "./Scenes";
import { BSPEntity, vmtParseVector } from "./VMT";

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
                filesystem.createVPKMount(`${pathBase2}/hl2_textures`),
                filesystem.createVPKMount(`${pathBase2}/hl2_misc`),
            ]);
            return filesystem;
        });

        const renderContext = new SourceRenderContext(context.device, filesystem);
        this.registerEntityFactories(renderContext.entityFactoryRegistry);
        return createScene(context, filesystem, this.id, `${pathBase}/maps/${this.id}.bsp`, renderContext);
    }
}

class HalfLife2SceneDescAll implements SceneDesc {
    constructor(private maps: string[], public id: string = 'All', public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${pathBase}/portal_pak`),
                filesystem.createVPKMount(`${pathBase2}/hl2_textures`),
                filesystem.createVPKMount(`${pathBase2}/hl2_misc`),
            ]);
            return filesystem;
        });

        // Clear out old filesystem pakfile.
        filesystem.pakfiles.length = 0;

        const renderContext = new SourceRenderContext(context.device, filesystem);
        const renderer = new SourceRenderer(context, renderContext);

        async function fetchBSPFile(mapId: string, mapPath: string): Promise<BSPFile> {
            return await context.dataShare.ensureObject(`SourceEngine/${mapPath}`, async () => {
                const bsp = await context.dataFetcher.fetchData(mapPath);
                return new BSPFile(bsp, mapId);
            });
        }

        const bspFiles = await Promise.all(this.maps.map((mapId) => {
            return fetchBSPFile(mapId, `${pathBase}/maps/${mapId}.bsp`);
        }));

        // Go through and hook up the landmarks...
        const offsets = nArray(this.maps.length, () => vec3.create());
        for (let i = 1; i < bspFiles.length; i++) {
            const i0 = i - 1, i1 = i;
            const r0 = bspFiles[i0], r1 = bspFiles[i1];

            const l0s = r0.entities.filter((b) => b.classname === 'info_landmark');
            const l1s = r1.entities.filter((b) => b.classname === 'info_landmark');

            // Look for the same landmark in both maps.
            const sameLandmarks = l0s.filter((l0) => l1s.find((l1) => l0.targetname === l1.targetname));
            if (sameLandmarks.length !== 1)
                debugger;

            const l0 = sameLandmarks[0];
            const l1 = l1s.find((l1) => l1.targetname === l0.targetname)!;

            // Move R1 into R0's space by comparing the difference in origins.
            const [x0, y0, z0] = vmtParseVector(l0.origin);
            const [x1, y1, z1] = vmtParseVector(l1.origin);

            const n0 = vec3.fromValues(x0, y0, z0);
            const n1 = vec3.fromValues(x1, y1, z1);
            vec3.sub(offsets[i1], n0, n1);
            vec3.add(offsets[i1], offsets[i1], offsets[i0]);
        }

        bspFiles.forEach((bspFile, i) => {
            if (bspFile.pakfile !== null)
                filesystem.pakfiles.push(bspFile.pakfile);

            const bspRenderer = new BSPRenderer(renderContext, bspFile, offsets[i]);
            renderer.bspRenderers.push(bspRenderer);
        });

        const bspFile = bspFiles[0];
        // Build skybox from worldname.
        const worldspawn = bspFile.entities[0];
        assert(worldspawn.classname === 'worldspawn');
        if (worldspawn.skyname)
            renderer.skyboxRenderer = new SkyboxRenderer(renderContext, worldspawn.skyname);

        await renderContext.materialCache.bindLocalCubemap(bspFile.cubemaps[0]);

        return renderer;
    }
}

const pathBase = `Portal`;
const pathBase2 = `HalfLife2`;

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

    
    new HalfLife2SceneDescAll([
        'testchmb_a_00',
        'testchmb_a_01',
        'testchmb_a_02',
        'testchmb_a_03',
        'testchmb_a_04',
        'testchmb_a_05',
        'testchmb_a_06',
        'testchmb_a_07',
        'testchmb_a_08',
        'testchmb_a_09',
        'testchmb_a_10',
        'testchmb_a_11',
        'testchmb_a_13',
        'testchmb_a_14',
        'testchmb_a_15',
        'escape_00',
        'escape_01',
        'escape_02',
    ]),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
