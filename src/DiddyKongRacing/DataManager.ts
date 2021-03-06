/*
 * Handles loading assets from the `/data/` directory.
 */

import { DataFetcher, NamedArrayBufferSlice } from "../DataFetcher";
import { SceneContext } from "../SceneBase";
import { assert } from "../util";
import { bytesToUShort } from "./DkrUtil";

export class DataManager {
    private path: string;
    private assets: any;

    private doneFlag = false;

    // Used to translate an id in a object map into an actual object id.
    public levelObjectTranslateTable: Array<number>;

    // Contains the IDs of the animations used by objects.
    public objectAnimationIds: Array<Array<number> | null>;

    constructor(private context: SceneContext, private pathBase: string, private version: string, callback: Function) {
        this.path = pathBase + '/' + version + '/';

        this.ensureAndFetchFile('assets.json').then((assetsJsonBinary) => {
            this.assets = JSON.parse(new TextDecoder().decode(assetsJsonBinary.arrayBuffer as ArrayBuffer));
            this.parseAssets(() => {
                callback(this);
            });
        });
    }

    private parseAssets(callback: Function) {
        assert(this.assets['@revision'] === 1);
        //console.log(this.assets);

        let lvlObjTransTablePath = this.assets.assets[35].folder + '/' + this.assets.assets[35].filenames[0];
        let objAnimationIds = this.assets.assets[30].folder + '/' + this.assets.assets[30].filenames[0];

        let promises = [
            this.ensureAndFetchFile(lvlObjTransTablePath),
            this.ensureAndFetchFile(objAnimationIds),
        ]

        Promise.all(promises).then((out) => {
            // Level Object To Object ID translation table
            let buffer = new Uint8Array(out[0].arrayBuffer);
            this.levelObjectTranslateTable = new Array<number>(buffer.length / 2);
            for(let i = 0; i < this.levelObjectTranslateTable.length; i++) {
                this.levelObjectTranslateTable[i] = bytesToUShort(buffer, i * 2);
            }
            // Animation IDs table
            buffer = new Uint8Array(out[1].arrayBuffer);
            this.objectAnimationIds = new Array<Array<number>|null>(buffer.length / 2);
            for(let i = 0; i < this.objectAnimationIds.length; i++) {
                const index = bytesToUShort(buffer, i * 2);
                const nextIndex = bytesToUShort(buffer, (i + 1) * 2);
                const numberOfAnimations = nextIndex - index;
                if(numberOfAnimations < 0) {
                    break;
                }
                if(numberOfAnimations == 0) {
                    this.objectAnimationIds[i] = null;
                } else {
                    const idArray = new Array<number>(numberOfAnimations);
                    for(let j = 0; j < numberOfAnimations; j++) {
                        idArray[j] = index + j;
                    }
                    this.objectAnimationIds[i] = idArray;
                }
            }
            callback();
        });
    }

    private ensureAndFetchFile(filepath: string): Promise<NamedArrayBufferSlice> {
        return this.context.dataShare.ensureObject(this.path + filepath, () => {
            return this.context.dataFetcher.fetchData(this.path + filepath)!;
        });
    }

    public signalDoneFlag(): void {
        this.doneFlag = true;
    }

    public doneFlagSet(): boolean {
        return this.doneFlag;
    }

    public isLoading(): boolean {
        const meter: any = this.context.dataFetcher.progressMeter;
        return meter.loadProgress < 1.0;
    }

    /************** Methods for getting assets **************/

    private getImageData(img: HTMLImageElement): ImageData {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height);
    }

    // 3D texture = texture used mainly in 3d geometry.
    public get3dTexture(index: number): Promise<ImageData> {
        assert(this.assets.assets[2].type === 'Textures');
        assert(this.assets.assets[2].folder === 'textures/3d');
        assert(!!this.assets.assets[2].filenames[index]);

        const img = document.createElement('img');
        img.crossOrigin = 'anonymous';
        img.src = 'data/' + this.path + 'textures/3d/' + this.assets.assets[2].filenames[index];

        return new Promise<ImageData>((resolve) => {
            img.onload = () => {
                resolve(this.getImageData(img));
            };
            img.onerror = (err) => {
                throw err;
            }
        });
    }

    // 2D texture = texture used mainly in sprites & particles.
    public get2dTexture(index: number): Promise<ImageData> {
        assert(this.assets.assets[4].type === 'Textures');
        assert(this.assets.assets[4].folder === 'textures/2d');
        assert(!!this.assets.assets[4].filenames[index]);

        const img = document.createElement('img');
        img.crossOrigin = 'anonymous';
        img.src = 'data/' + this.path + 'textures/2d/' + this.assets.assets[4].filenames[index];

        return new Promise<ImageData>((resolve) => {
            img.onload = () => {
                resolve(this.getImageData(img));
            };
            img.onerror = (err) => {
                throw err;
            }
        });
    }

    public get3dTextureHeader(index: number): Promise<NamedArrayBufferSlice> {
        assert(this.assets.assets[2].type === 'Textures');
        assert(this.assets.assets[2].folder === 'textures/3d');
        assert(!!this.assets.assets[2].filenames[index]);
        return this.ensureAndFetchFile('textures/3d/' + this.assets.assets[2].filenames[index] + '.header');
    }

    public get2dTextureHeader(index: number): Promise<NamedArrayBufferSlice> {
        assert(this.assets.assets[4].type === 'Textures');
        assert(this.assets.assets[4].folder === 'textures/2d');
        assert(!!this.assets.assets[4].filenames[index]);
        return this.ensureAndFetchFile('textures/2d/' + this.assets.assets[4].filenames[index] + '.header');
    }

    public getLevelObjectMap(index: number): Promise<NamedArrayBufferSlice> {
        assert(this.assets.assets[21].type === 'LevelObjectMap');
        assert(this.assets.assets[21].folder === 'levels/objectMaps');
        assert(!!this.assets.assets[21].filenames[index]);
        return this.ensureAndFetchFile('levels/objectMaps/' + this.assets.assets[21].filenames[index]);
    }

    public getLevelHeader(index: number): Promise<NamedArrayBufferSlice> {
        assert(this.assets.assets[23].type === 'LevelHeaders');
        assert(this.assets.assets[23].folder === 'levels/headers');
        assert(!!this.assets.assets[23].filenames[index]);
        return this.ensureAndFetchFile('levels/headers/' + this.assets.assets[23].filenames[index]);
    }

    public getLevelModel(index: number): Promise<NamedArrayBufferSlice> {
        assert(this.assets.assets[27].type === 'LevelModels');
        assert(this.assets.assets[27].folder === 'levels/models');
        assert(!!this.assets.assets[27].filenames[index]);
        return this.ensureAndFetchFile('levels/models/' + this.assets.assets[27].filenames[index]);
    }

    public getObjectModel(index: number): Promise<NamedArrayBufferSlice> {
        assert(this.assets.assets[29].type === 'ObjectModels');
        assert(this.assets.assets[29].folder === 'objects/models');
        assert(!!this.assets.assets[29].filenames[index]);
        return this.ensureAndFetchFile('objects/models/' + this.assets.assets[29].filenames[index]);
    }

    public getObjectAnimation(index: number): Promise<NamedArrayBufferSlice> {
        assert(this.assets.assets[32].type === 'ObjectAnimations');
        assert(this.assets.assets[32].folder === 'objects/animations');
        assert(!!this.assets.assets[32].filenames[index]);
        return this.ensureAndFetchFile('objects/animations/' + this.assets.assets[32].filenames[index]);
    }

    public getObjectHeader(index: number): Promise<NamedArrayBufferSlice> {
        assert(this.assets.assets[34].type === 'ObjectHeaders');
        assert(this.assets.assets[34].folder === 'objects/headers');
        assert(!!this.assets.assets[34].filenames[index]);
        return this.ensureAndFetchFile('objects/headers/' + this.assets.assets[34].filenames[index]);
    }

    public getSpriteSheet(callback: Function): void {
        this.ensureAndFetchFile('dkr_sprites.json').then((spritesJsonBinary) => {
            let spritesData = JSON.parse(new TextDecoder().decode(spritesJsonBinary.arrayBuffer as ArrayBuffer));

            const img = document.createElement('img');
            img.crossOrigin = 'anonymous';
            img.src = 'data/' + this.path + 'dkr_sprites.png';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(img, 0, 0);
                callback(spritesData.sprites, ctx.getImageData(0, 0, img.width, img.height));
            };
            img.onerror = (err) => {
                throw err;
            }
        });
    }
}
