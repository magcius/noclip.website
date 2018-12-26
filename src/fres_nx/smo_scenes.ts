
import * as Viewer from '../viewer';
import * as Yaz0 from '../compression/Yaz0';

import Progressable from '../Progressable';
import { fetchData } from '../fetch';
import ArrayBufferSlice from '../ArrayBufferSlice';

import * as SARC from '../fres/sarc';
import * as BFRES from './bfres';
import * as BNTX from './bntx';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { BRTITextureHolder, BasicFRESRenderer, FMDLRenderer } from './render';

const basePath = `data/smo`;

class OdysseySceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public texturesArc: string, public name: string = id) {
    }

    private _fetchSARC(arcPath: string): Progressable<SARC.SARC> {
        return fetchData(arcPath).then((buffer) => {
            return Yaz0.decompress(buffer);
        }).then((buffer) => {
            return SARC.parse(buffer);
        });
    }

    private _loadFRESWithTextures(device: GfxDevice, textureHolder: BRTITextureHolder, sarc: SARC.SARC): BFRES.FRES {
        const fres = BFRES.parse(sarc.files.find((f) => f.name.endsWith('.bfres')).buffer);
        const bntxFile = fres.externalFiles.find((f) => f.name === 'textures.bntx');

        if (bntxFile !== undefined) {
            const bntx = BNTX.parse(fres.externalFiles[0].buffer);
            textureHolder.addTexturesGfx(device, bntx.textures);
        }

        return fres;
    }

    public createScene_Device(device: GfxDevice): Progressable<Viewer.Scene_Device> {
        const path = `${basePath}/${this.id}.szs`;
        const texturesPath = `${basePath}/${this.texturesArc}.szs`;

        return Progressable.all([this._fetchSARC(path), this._fetchSARC(texturesPath)]).then((sarcs: SARC.SARC[]) => {
            const [mainSARC, extraTexSARC] = sarcs;

            const textureHolder = new BRTITextureHolder();
            const mainFRES = this._loadFRESWithTextures(device, textureHolder, mainSARC);
            this._loadFRESWithTextures(device, textureHolder, extraTexSARC);

            const sceneRenderer = new BasicFRESRenderer(textureHolder);
            sceneRenderer.addFMDLRenderer(device, new FMDLRenderer(device, textureHolder, mainFRES.fmdl[0]));
            return sceneRenderer;
        });
    }
}

// Splatoon Models
const name = "Super Mario Odyssey (Experimental)";
const id = "smo";
const sceneDescs: OdysseySceneDesc[] = [
    new OdysseySceneDesc('CapWorldHomeTower000', 'CapWorldHomeStageTexture'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
