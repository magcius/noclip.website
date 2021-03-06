import { DataManager } from "./DataManager";
import { DkrObjectModel } from "./DkrObjectModel";
import { bytesToInt } from "./DkrUtil";

export class DkrObjectCache {
    private objectHeaders: any = {};
    private objectModels: any = {};
    

    constructor(private dataManager: DataManager) {
        
    }

    public getObjectHeader(index: number, callback: Function): void {
        if(!!this.objectHeaders[index]) {
            // Header was found in cache, so just return it.
            callback(this.objectHeaders[index]);
        } else {
            // Header was not found, so it needs to be loaded.
            this.dataManager.getObjectHeader(index).then((headerDataBuffer) => {
                if(!!this.objectHeaders[index]) {
                    // Header has already been loaded, so just return it.
                    callback(this.objectHeaders[index]);
                } else {
                    this.objectHeaders[index] = new Uint8Array(headerDataBuffer.arrayBuffer);
                    callback(this.objectHeaders[index]);
                }
            });
        }
    }

    public getObjectModel(index: number, callback: Function): void {
        if(!!this.objectModels[index]) {
            // Model was found in cache, so just return it.
            callback(this.objectModels[index]);
        } else {
            // Model was not found, so it needs to be loaded.
            this.dataManager.getObjectModel(index).then((modelDataBuffer) => {
                if(!!this.objectModels[index]) {
                    // Model has already been loaded, so just return it.
                    callback(this.objectModels[index]);
                } else {
                    this.objectModels[index] = new Uint8Array(modelDataBuffer.arrayBuffer);
                    callback(this.objectModels[index]);
                }
            });
        }
    }

    // Preloads object models & headers
    public preloadObjects(indices: Array<number>, callback: Function): void {
        let promises = new Array<Promise<any>>(indices.length);
        // Need to load all the headers first before I can get the models.
        for(let i = 0; i < indices.length; i++) {
            promises[i] = this.dataManager.getObjectHeader(indices[i]);
        }
        Promise.all(promises).then((out) => {
            let modelIds = new Set<number>();
            for (let index = 0; index < out.length; index++) {
                if(!this.objectHeaders[indices[index]]) {
                    let objectData = new Uint8Array(out[index].arrayBuffer);
                    let modelType = objectData[0x53];
                    let numberOfModels = objectData[0x55];
                    let modelIdsOffset = bytesToInt(objectData, 0x10);
                    switch(modelType) {
                        case 0: // 3D Model
                            for(let i = 0; i < numberOfModels; i++) {
                                modelIds.add(bytesToInt(objectData, modelIdsOffset + (i*4)));
                            }
                            break;
                        case 1: // Billboarded sprite
                        case 2: // Vehicle part (Billboarded sprite)
                            break;
                    }
                    this.objectHeaders[indices[index]] = objectData;
                }
            }
            let modelIdsList = Array.from(modelIds);
            let modelPromises = new Array<Promise<any>>(modelIdsList.length);
            for(let i = 0; i < modelIdsList.length; i++) {
                modelPromises[i] = this.dataManager.getObjectModel(modelIdsList[i]);
            }
            Promise.all(modelPromises).then((outModels) => {
                for (let index = 0; index < outModels.length; index++) {
                    if(!this.objectModels[indices[index]]) {
                        this.objectModels[indices[index]] = new Uint8Array(outModels[index].arrayBuffer);
                    }
                }
                callback();
            });
        });
    }
}
