
import * as Viewer from '../viewer';
import { GfxDevice, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import Progressable from '../Progressable';
import { fetchData } from '../fetch';
import * as MapShape from './map_shape';
import * as Tex from './tex';
import { BasicRendererHelper } from '../oot3d/render';
import { PaperMario64TextureHolder, PaperMario64ModelTreeRenderer } from './render';

const pathBase = `pm64`;

class PaperMario64Renderer extends BasicRendererHelper {
    public textureHolder = new PaperMario64TextureHolder();
    public modelTreeRenderers: PaperMario64ModelTreeRenderer[] = [];

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.modelTreeRenderers.length; i++)
            this.modelTreeRenderers[i].prepareToRender(hostAccessPass, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.textureHolder.destroy(device);
        for (let i = 0; i < this.modelTreeRenderers.length; i++)
            this.modelTreeRenderers[i].destroy(device);
    }
}

class PaperMario64SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        const areaId = this.id.slice(0, 3);

        return Progressable.all([
            fetchData(`${pathBase}/${this.id}_shape`, abortSignal),
            fetchData(`${pathBase}/${areaId}_tex`, abortSignal),
        ]).then(([shapeData, texData]) => {
            const mapShape = MapShape.parse(shapeData);
            const tex = Tex.parse(texData);

            const renderer = new PaperMario64Renderer();
            renderer.textureHolder.addTextureArchive(device, tex);

            const modelTreeRenderer = new PaperMario64ModelTreeRenderer(device, tex, renderer.textureHolder, mapShape.rootNode);
            renderer.modelTreeRenderers.push(modelTreeRenderer);
            modelTreeRenderer.addToViewRenderer(device, renderer.viewRenderer);

            return renderer;
        });
    }
}

const id = 'pm64';
const name = 'Paper Mario 64';
const sceneDescs = [
    new PaperMario64SceneDesc('mac_00', 'mac_00'),
    new PaperMario64SceneDesc('kpa_117', 'kpa_117'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
