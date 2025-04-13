import { vec3 } from "gl-matrix";
import { HIModelFlags, HIModelInstance } from "./HIModel.js";
import { HIModelBucket } from "./HIModelBucket.js";
import { HIGame, HIScene } from "./HIScene.js";
import { RwEngine, RwStream } from "./rw/rwcore.js";
import { getMatrixAxisX, getMatrixTranslation } from "../MathHelpers.js";
import { RpClump } from "./rw/rpworld.js";
import { HIAssetType } from "./HIAssetTypes.js";

interface HILODTable {
    baseBucket: HIModelBucket | null;
    noRenderDist: number;
    flags: number;
    lodBucket: (HIModelBucket | null)[];
    lodDist: number[];
}

interface HILODManager {
    numextra: number;
    lod: HILODTable;
    model: HIModelInstance;
    adjustNoRenderDist: number;
}

const scratchVec3 = vec3.create();
const scratchVec3_2 = vec3.create();

export class HILOD {
    private tableList: HILODTable[] = [];
    private managerList: HILODManager[] = [];

    public setup(scene: HIScene) {
        for (const hip of scene.assetManager.hips) {
            for (const layer of hip.layers) {
                for (const asset of layer.assets) {
                    if (asset.type === HIAssetType.LODT) {
                        const stream = new RwStream(asset.rawData);
                        const count = stream.readUint32();
                        for (let i = 0; i < count; i++) {
                            const baseBucketID = stream.readUint32();
                            const noRenderDist = stream.readFloat();
                            const flags = (scene.game >= HIGame.TSSM) ? stream.readUint32() : 0;
                            const lodBucketID = [ stream.readUint32(), stream.readUint32(), stream.readUint32() ];
                            const lodDist = [ stream.readFloat(), stream.readFloat(), stream.readFloat() ];

                            let baseBucket: HIModelBucket | null = null;
                            const baseModel = scene.assetManager.findAsset(baseBucketID)?.runtimeData as RpClump;
                            if (baseModel) {
                                baseBucket = scene.modelBucketManager.getBucket(baseModel.atomics[0]);
                            }

                            const lodBucket: (HIModelBucket | null)[] = [];
                            for (let i = 0; i < 3; i++) {
                                const model = scene.assetManager.findAsset(lodBucketID[i])?.runtimeData as RpClump;
                                if (model) {
                                    lodBucket.push(scene.modelBucketManager.getBucket(model.atomics[0]));
                                }
                            }

                            for (let i = 0; i < 3; i++) {
                                lodDist[i] *= lodDist[i];
                            }

                            this.tableList.push({ baseBucket, noRenderDist, flags, lodBucket, lodDist });
                        }
                    }
                }
            }
        }

        for (const ent of scene.entList) {
            if (ent.model) {
                this.addToLODList(ent.model);
            }
        }
    }

    private addToLODList(model: HIModelInstance) {
        for (const manager of this.managerList) {
            if (manager.model === model) {
                return;
            }
        }

        for (const lod of this.tableList) {
            if (!lod.baseBucket) continue;
            if (lod.baseBucket.data !== model.data) continue;

            let numextra = 0;
            for (let minst: HIModelInstance | null = model; minst; minst = minst.next) {
                numextra++;
            }

            getMatrixAxisX(scratchVec3, model.mat);
            let distscale = vec3.sqrLen(scratchVec3);
            if (distscale < 0.0001) distscale = 1.0;

            for (let minst: HIModelInstance | null = model; minst; minst = minst.next) {
                minst.fadeEnd = Math.sqrt(distscale * lod.noRenderDist * lod.noRenderDist);
                minst.fadeStart = minst.fadeEnd - 4.0;
            }

            let adjustNoRenderDist = 10.0 + lod.noRenderDist;
            adjustNoRenderDist *= adjustNoRenderDist;

            this.managerList.push({ numextra, lod, model, adjustNoRenderDist });
            break;
        }
    }

    public update(rw: RwEngine) {
        getMatrixTranslation(scratchVec3, rw.camera.worldMatrix);

        for (const manager of this.managerList) {
            const lod = manager.lod;
            const model = manager.model;

            getMatrixAxisX(scratchVec3_2, model.mat);
            let distscale = vec3.sqrLen(scratchVec3_2);
            if (distscale < 0.0001) distscale = 1.0;

            getMatrixTranslation(scratchVec3_2, model.mat);
            const camdist2 = vec3.sqrDist(scratchVec3, scratchVec3_2) / distscale;

            if (camdist2 >= manager.adjustNoRenderDist) {
                model.flags |= HIModelFlags.LODNoRender;
                if (manager.numextra) {
                    for (let minst = model.next; minst; minst = minst.next) {
                        minst.flags |= HIModelFlags.LODNoRender;
                    }
                }
            } else {
                let i = 0;

                model.flags &= ~HIModelFlags.LODNoRender;
                if (lod.baseBucket) {
                    model.bucket = lod.baseBucket;
                    model.data = model.bucket.data;
                }

                for (; i < 3; i++) {
                    if (!lod.lodBucket[i]) break;
                    if (camdist2 <= lod.lodDist[i]) break;
                    model.bucket = lod.lodBucket[i]!;
                    model.data = model.bucket.data;
                }
                if (manager.numextra) {
                    if (i === 0) {
                        for (let minst = model.next; minst; minst = minst.next) {
                            minst.flags &= ~HIModelFlags.LODNoRender;
                        }
                    } else {
                        for (let minst = model.next; minst; minst = minst.next) {
                            minst.flags |= HIModelFlags.LODNoRender;
                        }
                    }
                }
            }
        }
    }
}