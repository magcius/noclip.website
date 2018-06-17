
// Skyward Sword

import * as Viewer from '../viewer';
import * as LZ77 from '../lz77';
import * as BRRES from './brres';
import * as U8 from './u8';

import { fetch, assert } from '../util';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { RenderState } from '../render';
import { RRESTextureHolder, ModelRenderer } from './render';

function collectTextures(scenes: Viewer.Scene[]): Viewer.Texture[] {
    const textures: Viewer.Texture[] = [];
    for (const scene of scenes)
        if (scene)
            textures.push.apply(textures, scene.textures);
    return textures;
}

class SkywardSwordScene implements Viewer.MainScene {
    public textures: Viewer.Texture[];
    public textureHolder: RRESTextureHolder;
    public models: ModelRenderer[] = [];

    constructor(gl: WebGL2RenderingContext, public textureRRESes: BRRES.RRES[], public stageRRES: BRRES.RRES, public roomRRESes: BRRES.RRES[]) {
        this.textureHolder = new RRESTextureHolder();

        this.textures = this.textureHolder.viewerTextures;

        // First, load in the system and common textures.
        for (const textureRRES of textureRRESes)
            this.textureHolder.addTextures(gl, textureRRES.textures);

        // Now load the scene textures.
        this.textureHolder.addTextures(gl, stageRRES.textures);

        // Now go through the rooms and create models.
        for (const roomRRES of roomRRESes) {
            this.textureHolder.addTextures(gl, roomRRES.textures);

            for (const mdl0 of roomRRES.models) {
                this.spawnModel(gl, mdl0);
            }
        }

        // Sort models based on type.
        function sortKey(modelRenderer: ModelRenderer) {
            const modelSorts = [
                'model0',   // Main geometry
                'model0_s', // Main geometry decals.
                'model1',   // Indirect water.
                'model2',   // Other transparent objects.
            ];
            const idx = modelSorts.indexOf(modelRenderer.mdl0.name);

            if (idx < 0) {
                console.error(`Unknown model name ${modelRenderer.mdl0.name}`);
                return 9999;
            }

            return idx;
        }

        this.models.sort((a, b) => {
            return sortKey(a) - sortKey(b);
        });

        // Now create models for any water that might spawn.
        for (const mdl0 of stageRRES.models) {
            if (!mdl0.name.includes('Water'))
                continue;

            this.spawnModel(gl, mdl0);
        }

        // Hide IndTex until we get that working.
        outer:
        for (const modelRenderer of this.models) {
            for (const material of modelRenderer.mdl0.materials) {
                for (const sampler of material.samplers) {
                    if (sampler.name === 'DummyWater') {
                        modelRenderer.setVisible(false);
                        continue outer;
                    }
                }
            }
        }
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.textureHolder.destroy(gl);
        this.models.forEach((model) => model.destroy(gl));
    }

    public render(state: RenderState): void {
        this.models.forEach((model) => {
            model.render(state);
        });
    }

    private spawnModel(gl: WebGL2RenderingContext, mdl0: BRRES.MDL0): void {
        const modelRenderer = new ModelRenderer(gl, this.textureHolder, mdl0);
        this.models.push(modelRenderer);
    }
}

class SkywardSwordSceneDesc implements Viewer.SceneDesc {
    constructor(public name: string, public id: string, public path: string) {}

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        const basePath = `data/zss`;
        const systemPath = `${basePath}/System.arc`;
        const objPackPath = `${basePath}/ObjectPack.arc.LZ`;
        const stagePath = `${basePath}/${this.path}`;
        return Progressable.all([fetch(systemPath), fetch(objPackPath), fetch(stagePath)]).then((buffers: ArrayBufferSlice[]) => {
            const [systemBuffer, objPackBuffer, stageBuffer] = buffers;

            const textureRRESes: BRRES.RRES[] = [];

            const systemArchive = U8.parse(systemBuffer);
            const systemRRES = BRRES.parse(systemArchive.findFile('g3d/model.brres').buffer);
            textureRRESes.push(systemRRES);

            const objPackArchive = U8.parse(LZ77.decompress(objPackBuffer));
            const skyCmnArchive = U8.parse(objPackArchive.findFile('oarc/SkyCmn.arc').buffer);
            const skyCmnRRES = BRRES.parse(skyCmnArchive.findFile('g3d/model.brres').buffer);
            textureRRESes.push(skyCmnRRES);

            const stageArchive = U8.parse(LZ77.decompress(stageBuffer));
            const stageRRES = BRRES.parse(stageArchive.findFile('g3d/stage.brres').buffer);

            const roomArchivesDir = stageArchive.findDir('rarc');
            const roomRRESes: BRRES.RRES[] = [];
            if (roomArchivesDir) {
                for (const roomArchiveFile of roomArchivesDir.files) {
                    const roomArchive = U8.parse(roomArchiveFile.buffer);
                    const roomRRES = BRRES.parse(roomArchive.findFile('g3d/room.brres').buffer);
                    roomRRESes.push(roomRRES);
                }
            }

            return new SkywardSwordScene(gl, textureRRESes, stageRRES, roomRRESes);
        });
    }
}

const id = "zss";
const name = "Skyward Sword";
const sceneDescs: Viewer.SceneDesc[] = [
    new SkywardSwordSceneDesc("Skyloft", "F000", `F000_stg_l0.arc.LZ`),
    new SkywardSwordSceneDesc("Skyloft - Knight's Academy", "F001", `F001r_stg_l0.arc.LZ`),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
