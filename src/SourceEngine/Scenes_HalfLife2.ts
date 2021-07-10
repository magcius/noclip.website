
import { vec3 } from "gl-matrix";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { assert, nArray } from "../util";
import { BSPFile } from "./BSPFile";
import { BSPRenderer, SkyboxRenderer, SourceFileSystem, SourceRenderContext, SourceRenderer } from "./Main";
import { vmtParseVector } from "./VMT";
import { createScene } from "./Scenes";

class HalfLife2SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${pathBase}/hl2_textures`),
                filesystem.createVPKMount(`${pathBase}/hl2_misc`),
            ]);
            return filesystem;
        });

        return createScene(context, filesystem, this.id, `${pathBase}/maps/${this.id}.bsp`);
    }
}

class HalfLife2SceneDescAll implements SceneDesc {
    constructor(private maps: string[], public id: string = 'All', public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${pathBase}/hl2_textures`),
                filesystem.createVPKMount(`${pathBase}/hl2_misc`),
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

const pathBase = `HalfLife2`;

const id = 'HalfLife2';
const name = 'Half-Life 2';
// https://developer.valvesoftware.com/wiki/Half-Life_2_map_reference
const sceneDescs = [
    "Main Menu Backgrounds",
    new HalfLife2SceneDesc('background01'),
    new HalfLife2SceneDesc('background02'),
    new HalfLife2SceneDesc('background03'),
    new HalfLife2SceneDesc('background04'),
    new HalfLife2SceneDesc('background05'),

    "Point Insertion",
    new HalfLife2SceneDesc('d1_trainstation_01'),
    new HalfLife2SceneDesc('d1_trainstation_02'),
    new HalfLife2SceneDesc('d1_trainstation_03'),
    new HalfLife2SceneDesc('d1_trainstation_04'),

    "A Red Letter Day",
    new HalfLife2SceneDesc('d1_trainstation_05'),
    new HalfLife2SceneDesc('d1_trainstation_06'),

    "Route Kanal",
    new HalfLife2SceneDesc('d1_canals_01'),
    new HalfLife2SceneDesc('d1_canals_01a'),
    new HalfLife2SceneDesc('d1_canals_02'),
    new HalfLife2SceneDesc('d1_canals_03'),
    new HalfLife2SceneDesc('d1_canals_05'),

    "Water Hazard",
    new HalfLife2SceneDesc('d1_canals_06'),
    new HalfLife2SceneDesc('d1_canals_07'),
    new HalfLife2SceneDesc('d1_canals_08'),
    new HalfLife2SceneDesc('d1_canals_09'),
    new HalfLife2SceneDesc('d1_canals_10'),
    new HalfLife2SceneDesc('d1_canals_11'),
    new HalfLife2SceneDesc('d1_canals_12'),
    new HalfLife2SceneDesc('d1_canals_13'),

    "Black Mesa East",
    new HalfLife2SceneDesc('d1_eli_01'),
    new HalfLife2SceneDesc('d1_eli_02'),

    "We Don't Go To Ravenholm",
    new HalfLife2SceneDesc('d1_town_01'),
    new HalfLife2SceneDesc('d1_town_01a'),
    new HalfLife2SceneDesc('d1_town_02'),
    new HalfLife2SceneDesc('d1_town_03'),
    new HalfLife2SceneDesc('d1_town_02a'),
    new HalfLife2SceneDesc('d1_town_04'),
    new HalfLife2SceneDesc('d1_town_05'),

    "Highway 17",
    new HalfLife2SceneDesc('d2_coast_01'),
    new HalfLife2SceneDesc('d2_coast_03'),
    new HalfLife2SceneDesc('d2_coast_04'),
    new HalfLife2SceneDesc('d2_coast_05'),
    new HalfLife2SceneDesc('d2_coast_07'),
    new HalfLife2SceneDesc('d2_coast_08'),

    "Sandtraps",
    new HalfLife2SceneDesc('d2_coast_09'),
    new HalfLife2SceneDesc('d2_coast_10'),
    new HalfLife2SceneDesc('d2_coast_11'),
    new HalfLife2SceneDesc('d2_coast_12'),
    new HalfLife2SceneDesc('d2_prison_01'),

    "Nova Prospekt",
    new HalfLife2SceneDesc('d2_prison_02'),
    new HalfLife2SceneDesc('d2_prison_03'),
    new HalfLife2SceneDesc('d2_prison_04'),
    new HalfLife2SceneDesc('d2_prison_05'),

    "Entanglement",
    new HalfLife2SceneDesc('d2_prison_06'),
    new HalfLife2SceneDesc('d2_prison_07'),
    new HalfLife2SceneDesc('d2_prison_08'),
    new HalfLife2SceneDesc('d3_c17_01'),

    "Anticitizen One",
    new HalfLife2SceneDesc('d3_c17_02'),
    new HalfLife2SceneDesc('d3_c17_03'),
    new HalfLife2SceneDesc('d3_c17_04'),
    new HalfLife2SceneDesc('d3_c17_05'),
    new HalfLife2SceneDesc('d3_c17_06a'),
    new HalfLife2SceneDesc('d3_c17_06b'),
    new HalfLife2SceneDesc('d3_c17_07'),
    new HalfLife2SceneDesc('d3_c17_08'),

    "\"Follow Freeman!\"",
    new HalfLife2SceneDesc('d3_c17_09'),
    new HalfLife2SceneDesc('d3_c17_10a'),
    new HalfLife2SceneDesc('d3_c17_10b'),
    new HalfLife2SceneDesc('d3_c17_11'),
    new HalfLife2SceneDesc('d3_c17_12'),
    new HalfLife2SceneDesc('d3_c17_12b'),
    new HalfLife2SceneDesc('d3_c17_13'),

    "Our Benefactors",
    new HalfLife2SceneDesc('d3_citadel_01'),
    new HalfLife2SceneDesc('d3_citadel_02'),
    new HalfLife2SceneDesc('d3_citadel_03'),
    new HalfLife2SceneDesc('d3_citadel_04'),
    new HalfLife2SceneDesc('d3_citadel_05'),

    "Dark Energy",
    new HalfLife2SceneDesc('d3_breen_01'),

    new HalfLife2SceneDescAll([
        'd1_trainstation_01',
        'd1_trainstation_02',
        'd1_trainstation_03',
        'd1_trainstation_04',
        'd1_trainstation_05',
        'd1_trainstation_06',
        'd1_canals_01',
        'd1_canals_01a',
        'd1_canals_02',
        'd1_canals_03',
        'd1_canals_05',
        'd1_canals_06',
        'd1_canals_07',
        'd1_canals_08',
        'd1_canals_09',
        'd1_canals_10',
        'd1_canals_11',
        'd1_canals_12',
        'd1_canals_13',
        'd1_eli_01',
        'd1_eli_02',
        'd1_town_01',
        'd1_town_01a',
        'd1_town_02',
        // 'd1_town_03',
        'd1_town_02a',
        'd1_town_04',
        'd1_town_05',
        'd2_coast_01',
        'd2_coast_03',
        'd2_coast_04',
        'd2_coast_05',
        'd2_coast_07',
        // 'd2_coast_08',
        'd2_coast_09',
        'd2_coast_10',
        'd2_coast_11',
        'd2_coast_12',
        // 'd2_prison_01',
        // 'd2_prison_02',
        // 'd2_prison_03',
        // 'd2_prison_04',
        // 'd2_prison_05',
        // 'd2_prison_06',
        // 'd2_prison_07',
        // 'd2_prison_08',
        // 'd3_c17_01',
        // 'd3_c17_02',
        // 'd3_c17_03',
        // 'd3_c17_04',
        // 'd3_c17_05',
        // 'd3_c17_06a',
        // 'd3_c17_06b',
        // 'd3_c17_07',
        // 'd3_c17_08',
        // 'd3_c17_09',
        // 'd3_c17_10a',
        // 'd3_c17_10b',
        // 'd3_c17_11',
        // 'd3_c17_12',
        // 'd3_c17_12b',
        // 'd3_c17_13',
        // 'd3_citadel_01',
        // 'd3_citadel_02',
        // 'd3_citadel_03',
        // 'd3_citadel_04',
        // 'd3_citadel_05',
        // 'd3_breen_01',
    ]),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
