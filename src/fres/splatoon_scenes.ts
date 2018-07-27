
import * as Viewer from '../viewer';
import * as Yaz0 from '../compression/Yaz0';

import { RenderState, depthClearFlags } from '../render';
import Progressable from '../Progressable';
import { fetch } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';

import * as SARC from './sarc';
import * as BFRES from './bfres';
import * as GX2Texture from './gx2_texture';
import { GX2TextureHolder, ModelRenderer } from './render';

class SplatoonRenderer implements Viewer.MainScene {
    public textures: Viewer.Texture[];

    constructor(public textureHolder: GX2TextureHolder, public mainRenderers: ModelRenderer[], public skyRenderers: ModelRenderer[]) {
        this.textures = textureHolder.viewerTextures;
    }

    public render(state: RenderState) {
        const gl = state.gl;
        state.setClipPlanes(0.2, 500000);

        this.skyRenderers.forEach((renderer) => renderer.render(state));

        state.useFlags(depthClearFlags);
        gl.clear(gl.DEPTH_BUFFER_BIT);

        this.mainRenderers.forEach((renderer) => renderer.render(state));
    }

    public destroy(gl: WebGL2RenderingContext) {
        GX2Texture.deswizzler.terminate();

        for (const renderer of this.skyRenderers)
            renderer.destroy(gl);
        for (const renderer of this.mainRenderers)
            renderer.destroy(gl);
    }
}

class SplatoonSceneDesc implements Viewer.SceneDesc {
    public id: string;
    public name: string;
    public path: string;

    constructor(name: string, path: string) {
        this.name = name;
        this.path = path;
        this.id = this.path;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        const textureHolder = new GX2TextureHolder();

        return Progressable.all([
            this._createRenderersFromPath(gl, textureHolder, `data/spl/${this.path}`, false),
            this._createRenderersFromPath(gl, textureHolder, 'data/spl/VR_SkyDayCumulonimbus.szs', true),
        ]).then((renderers: ModelRenderer[][]): Viewer.MainScene => {
            const [mainRenderers, skyRenderers] = renderers;
            return new SplatoonRenderer(textureHolder, mainRenderers, skyRenderers);
        });
    }

    private _createRenderersFromPath(gl: WebGL2RenderingContext, textureHolder: GX2TextureHolder, path: string, isSkybox: boolean): Progressable<ModelRenderer[]> {
        return fetch(path).then((result: ArrayBufferSlice) => {
            return Yaz0.decompress(result);
        }).then((result: ArrayBufferSlice) => {
            const renderers: ModelRenderer[] = [];
            const sarc = SARC.parse(result);
            const file = sarc.files.find((file) => file.name.endsWith('.bfres'));
            const fres = BFRES.parse(file.buffer);

            textureHolder.addFRESTextures(gl, fres);

            for (const fmdlEntry of fres.fmdl) {
                // _drcmap is the map used for the Gamepad. It does nothing but cause Z-fighting.
                if (fmdlEntry.entry.name.endsWith('_drcmap'))
                    continue;

                // "_DV" seems to be the skybox. There are additional models which are powered
                // by skeleton animation, which we don't quite support yet. Kill them for now.
                if (fmdlEntry.entry.name.indexOf('_DV_') !== -1)
                    continue;

                const modelRenderer = new ModelRenderer(gl, textureHolder, fres, fmdlEntry.fmdl);
                modelRenderer.isSkybox = isSkybox;
                renderers.push(modelRenderer);
            }

            return renderers;
        });
    }
}

// Splatoon Models
const name = "Splatoon";
const id = "splatoon";
const sceneDescs: SplatoonSceneDesc[] = [
    new SplatoonSceneDesc('Inkopolis Plaza', 'Fld_Plaza00.szs'),
    new SplatoonSceneDesc('Inkopolis Plaza Lobby', 'Fld_PlazaLobby.szs'),
    new SplatoonSceneDesc('Ancho-V Games', 'Fld_Office00.szs'),
    new SplatoonSceneDesc('Arrowana Mall', 'Fld_UpDown00.szs'),
    new SplatoonSceneDesc('Blackbelly Skatepark', 'Fld_SkatePark00.szs'),
    new SplatoonSceneDesc('Bluefin Depot', 'Fld_Ruins00.szs'),
    new SplatoonSceneDesc('Camp Triggerfish', 'Fld_Athletic00.szs'),
    new SplatoonSceneDesc('Flounder Heights', 'Fld_Jyoheki00.szs'),
    new SplatoonSceneDesc('Hammerhead Bridge', 'Fld_Kaisou00.szs'),
    new SplatoonSceneDesc('Kelp Dome', 'Fld_Maze00.szs'),
    new SplatoonSceneDesc('Mahi-Mahi Resort', 'Fld_Hiagari00.szs'),
    new SplatoonSceneDesc('Moray Towers', 'Fld_Tuzura00.szs'),
    new SplatoonSceneDesc('Museum d\'Alfonsino', 'Fld_Pivot00.szs'),
    new SplatoonSceneDesc('Pirahna Pit', 'Fld_Quarry00.szs'),
    new SplatoonSceneDesc('Port Mackerel', 'Fld_Amida00.szs'),
    new SplatoonSceneDesc('Saltspray Rig', 'Fld_SeaPlant00.szs'),
    new SplatoonSceneDesc('Urchin Underpass (New)', 'Fld_Crank01.szs'),
    new SplatoonSceneDesc('Urchin Underpass (Old)', 'Fld_Crank00.szs'),
    new SplatoonSceneDesc('Walleye Warehouse', 'Fld_Warehouse00.szs'),
    new SplatoonSceneDesc('Octo Valley', 'Fld_World00.szs'),
    new SplatoonSceneDesc('Object: Tree', 'Obj_Tree02.szs'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
