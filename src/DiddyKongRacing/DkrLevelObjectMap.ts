
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";
import { DataManager } from "./DataManager.js";
import { DkrControlGlobals } from "./DkrControlGlobals.js";
import { DkrDrawCallParams } from "./DkrDrawCall.js";
import { DkrLevel } from "./DkrLevel.js";
import { DkrObject, MODEL_TYPE_3D_MODEL } from "./DkrObject.js";
import { DkrSprites } from "./DkrSprites.js";
import { DkrTextureCache } from "./DkrTextureCache.js";

export class DkrLevelObjectMap {
    private objects: DkrObject[] = [];

    constructor(objectMap: ArrayBufferSlice, level: DkrLevel, device: GfxDevice, renderHelper: GfxRenderHelper, dataManager: DataManager, textureCache: DkrTextureCache, sprites: DkrSprites) {
        let objectIds = new Set<number>(); // Set ensures each item is unqiue
        let objectEntries: any[] = [];

        const dataView = objectMap.createDataView();

        let totalLength = dataView.getUint32(0);

        // Are bytes 0x04-0x0F used for anything?

        let currentOffset = 0x10; // Objects start at offset 0x10

        while(currentOffset - 0x10 < totalLength) {
            const b0 = dataView.getUint8(currentOffset + 0x00), b1 = dataView.getUint8(currentOffset + 0x01);
            const length = b1 & 0x7F;
            const tableEntry = ((b1 & 0x80) << 1) | b0;
            const objectId = dataManager.levelObjectTranslateTable[tableEntry];

            objectIds.add(objectId);
            objectEntries.push({
                objectId: objectId,
                data: objectMap.subarray(currentOffset, length),
            });

            currentOffset += length;
        }

        for(let i = 0; i < objectEntries.length; i++) {
            const objId = objectEntries[i].objectId;
            this.objects[i] = new DkrObject(
                objId, 
                device, 
                level,
                renderHelper, 
                dataManager, 
                textureCache
            );
            this.objects[i].parseObjectProperties(objectEntries[i].data);
        }

        sprites.addInstances(this.objects);
    }

    public destroy(device: GfxDevice): void {
        for (const object of this.objects)
            object.destroy(device);
    }

    public updateObjects(deltaTime: number) {
        if(!!this.objects) {
            for(let object of this.objects) {
                object.update(deltaTime);
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, objectMapId: number, beforeLevelMap: boolean = true) {
        if(!!this.objects) {
            if(beforeLevelMap) { // Only want to draw one time.
                for(let object of this.objects) {
                    object.prepareToRenderParticles(device, renderInstManager, viewerInput);
                }
            }
            for (let i = 0; i < this.objects.length; i++) {
                const obj: DkrObject = this.objects[i];

                if(!DkrControlGlobals.SHOW_DEV_OBJECTS.on && obj.isADeveloperObject()) {
                    continue;
                }
                if(obj.shouldRenderBeforeLevelMap() !== beforeLevelMap) {
                    continue;
                }

                if(obj.getModelType() == MODEL_TYPE_3D_MODEL) {
                    const model = obj.getModel();
                    if(!!model) {
                        const params: DkrDrawCallParams = {
                            modelMatrix: obj.getModelMatrix(),
                            textureFrame: 0,
                            overrideAlpha: obj.getOverrideAlpha(),
                            usesNormals: obj.usesVertexNormals(),
                            isSkydome: false,
                            objAnim: null,
                            objAnimIndex: 0,
                        };
                        model.prepareToRender(device, renderInstManager, viewerInput, params, obj.getTexFrameOverride());
                    }
                }
            }
        }
    }

    public getObjects(): Array<DkrObject> {
        return this.objects;
    }

    public getFlybyAnimationNodes(animationIndex: number): Array<DkrObject> {
        let nodes = new Array<DkrObject>();
        for(let i = 0; i < this.objects.length; i++) {
            if(this.objects[i].getName() == 'Animation') {
                let properties = this.objects[i].getProperties();
                if(properties.animIndex == animationIndex) {
                    nodes.push(this.objects[i]);
                }
            }
        }
        nodes.sort((a, b) => a.getProperties().order - b.getProperties().order);
        return nodes;
    }
}
