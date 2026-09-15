import { mat4 } from 'gl-matrix';
import { AABB } from '../Geometry.js';
import { SceneContext, SceneDesc, SceneGroup } from '../SceneBase.js';
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { SceneGfx } from '../viewer.js';
import { BWLoading } from './loading.js';
import { MDL0Renderer, PokemonBlackWhiteRenderer } from './render.js';
import { archiveNames, GameVersion, getLocations, loadWorld, WorldData } from './world.js';

const pathBase = 'PokemonBlackWhite';

class PokemonBlackWhiteSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string, private header = -1, private season = 0, private version: GameVersion = 'White') {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const path = `${pathBase}/${this.version}`;
        const renderer = new PokemonBlackWhiteRenderer(device);
        const loading = new BWLoading(context.dataFetcher, () => renderer.destroy(device));
        context.destroyablePool.push(loading);
        try {
            const shared = await context.dataShare.ensureObject(`${path}/WorldData`, async () => {
                const data = await Promise.all(archiveNames.map((name) => context.dataFetcher.fetchData(`${path}/${name}`)));
                loading.setProgress(0.35);
                await loading.yield();
                return new WorldData(data);
            });
            loading.setProgress(0.45);
            await loading.yield();
            const world = loadWorld(shared, this.header, this.season, this.version);
            loading.setProgress(0.5);
            await loading.yield();
            let completed = 0, batchStart = performance.now();
            for (const { model, texture, position, rotation, srt, pat, joint } of world.objects) {
                const object = new MDL0Renderer(renderer.resources, model, texture, joint);
                renderer.modelRenderers.push(object);
                if (srt) object.bindSRT0(srt);
                if (pat) object.bindPAT0(device, pat);
                mat4.fromTranslation(object.modelMatrix, position);
                mat4.rotateY(object.modelMatrix, object.modelMatrix, rotation);
                for (const material of object.materialInstances) material.lightMask = 0;
                object.bbox = new AABB();
                object.bbox.transform(object.localBounds, object.modelMatrix);
                completed++;
                if (performance.now() - batchStart >= 8) {
                    loading.setProgress(0.5 + 0.49 * completed / world.objects.length);
                    await loading.yield();
                    batchStart = performance.now();
                }
            }
            renderer.target = world.target;
            renderer.distance = world.distance;
            loading.setProgress(1);
            return renderer;
        } catch (e) {
            renderer.destroy(device);
            if (loading.cancelled) return new Promise<SceneGfx>(() => {});
            throw e;
        } finally {
            loading.restore();
            const index = context.destroyablePool.indexOf(loading);
            if (index >= 0) context.destroyablePool.splice(index, 1);
        }
    }
}

function createVersionScenes(version: GameVersion): (string | SceneDesc)[] {
    const prefix = version.toLowerCase();
    return [
        `Pokémon ${version} (Region)`,
        ...['Spring', 'Summer', 'Autumn', 'Winter'].map((season, i) =>
            new PokemonBlackWhiteSceneDesc(`${prefix}-${season.toLowerCase()}`, `Unova Region (${season})`, -1, i, version)),
        `Pokémon ${version} (Locations)`,
        ...getLocations(version).map(([header, name]) =>
            new PokemonBlackWhiteSceneDesc(`${prefix}-${header}`, name, header, 0, version)),
    ];
}

export const sceneGroup: SceneGroup = {
    id: 'pkmnbw', name: 'Pokémon Black / White', altName: 'Pokemon Black White Unova',
    sceneDescs: [...createVersionScenes('White'), ...createVersionScenes('Black')],
};
