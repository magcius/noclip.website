import { vec3 } from "gl-matrix";
import { HIModelInstance, HIPipeFlags } from "./HIModel.js";
import { HIScene } from "./HIScene.js";
import { RwBlendFunction, RwCullMode, RwEngine } from "./rw/rwcore.js";
import { RpAtomic } from "./rw/rpworld.js";
import { getMatrixTranslation } from "../MathHelpers.js";

export interface HIModelBucket {
    data: RpAtomic;
    pipeFlags: number;
    list: HIModelInstance | null;
}

interface HIModelAlphaBucket {
    data?: RpAtomic;
    minst?: HIModelInstance;
    alphaFade: number;
    sortValue: number;
    layer: number;
}

const scratchVec3 = vec3.create();
const scratchVec3_2 = vec3.create();

export class HIModelBucketManager {
    public enabled = false;

    private bucketList: HIModelBucket[] = [];
    private alphaList: HIModelAlphaBucket[] = [];
    private alphaCurr = 0;

    constructor() {
        for (let i = 0; i < 256; i++) {
            this.alphaList.push({ alphaFade: 1.0, sortValue: Infinity, layer: 0 });
        }
    }

    public deinit() {
        this.bucketList.length = 0;
        this.alphaList.length = 0;
    }

    public insertBucket(data: RpAtomic, pipeFlags: number) {
        this.bucketList.push({ data, pipeFlags, list: null });
    }

    public getBucket(data: RpAtomic) {
        for (const bucket of this.bucketList) {
            if (bucket.data === data) {
                return bucket;
            }
        }
        return null;
    }

    public begin() {
        for (const bucket of this.bucketList) {
            bucket.list = null;
        }
        this.enabled = true;
    }

    public add(minst: HIModelInstance, scene: HIScene, rw: RwEngine) {
        if (!minst.isVisible()) return;
        if (scene.camera.cullModel(minst.data, minst.mat, rw)) return;

        // TODO: Use RpAtomic.worldBoundingSphere instead
        const sph = minst.data.geometry.morphTargets[0].boundingSphere;
        vec3.set(scratchVec3, sph[0], sph[1], sph[2]);
        vec3.transformMat4(scratchVec3, scratchVec3, minst.mat);

        getMatrixTranslation(scratchVec3_2, rw.camera.worldMatrix);

        const camdist2 = vec3.sqrDist(scratchVec3, scratchVec3_2);
        if (camdist2 >= minst.fadeEnd * minst.fadeEnd) return;

        if ((minst.pipeFlags & HIPipeFlags.LIGHTING_MASK) !== HIPipeFlags.LIGHTING_PRELIGHTONLY) {
            minst.lightKit = scene.lightKitManager.lastLightKit;
        }

        const camdot = rw.camera.worldMatrix[8] * (scratchVec3[0] - rw.camera.worldMatrix[12]) +
                       rw.camera.worldMatrix[9] * (scratchVec3[1] - rw.camera.worldMatrix[13]) +
                       rw.camera.worldMatrix[10] * (scratchVec3[2] - rw.camera.worldMatrix[14]);
        
        let alphaFade = 1.0;
        if (camdist2 > minst.fadeStart * minst.fadeStart) {
            alphaFade = (minst.fadeEnd - Math.sqrt(camdist2)) / (minst.fadeEnd - minst.fadeStart);
            if (alphaFade <= 0.0) return;
            alphaFade = Math.min(alphaFade, 1.0);
        }

        if ((minst.pipeFlags & (HIPipeFlags.SRCBLEND_MASK | HIPipeFlags.DESTBLEND_MASK)) ||
            alphaFade != 1.0 || minst.alpha != 1.0) {
            if (this.alphaCurr < this.alphaList.length) {
                this.alphaList[this.alphaCurr].data = minst.bucket.data;
                this.alphaList[this.alphaCurr].minst = minst;
                this.alphaList[this.alphaCurr].alphaFade = alphaFade;
                this.alphaList[this.alphaCurr].sortValue = camdot;
                this.alphaList[this.alphaCurr].layer = (minst.pipeFlags & HIPipeFlags.LAYER_MASK) >>> HIPipeFlags.LAYER_SHIFT;
                this.alphaCurr++;
            }
        } else {
            minst.bucketNext = minst.bucket.list;
            minst.bucket.list = minst;
        }
    }

    public renderOpaque(scene: HIScene, rw: RwEngine) {
        this.enabled = false;

        const fog = scene.camera.fog;

        for (const bucket of this.bucketList) {
            let minst = bucket.list;
            while (minst) {
                const oldData = minst.data;
                minst.data = bucket.data;

                scene.lightKitManager.enable(minst.lightKit, rw.world);

                let cull = RwCullMode.NONE;
                if ((minst.pipeFlags & HIPipeFlags.CULL_MASK) === HIPipeFlags.CULL_FRONTONLY) {
                    cull = RwCullMode.BACK;
                }

                rw.renderState.cullMode = cull;

                scene.camera.fog = (minst.pipeFlags & HIPipeFlags.FOG_DISABLE) ? undefined : fog;
                scene.camera.setFogRenderStates(rw);
                
                minst.renderSingle(scene, rw);

                minst.data = oldData;

                minst = minst.bucketNext;
            }

            // Reset for next frame
            bucket.list = null;
        }

        scene.camera.fog = fog;
        scene.camera.setFogRenderStates(rw);
    }

    public renderAlpha(scene: HIScene, rw: RwEngine) {
        this.enabled = false;

        if (this.alphaCurr) {
            this.alphaList.sort((a, b) => {
                if (a.layer > b.layer) return -1;
                if (a.layer < b.layer) return 1;
                if (a.sortValue < b.sortValue) return -1;
                if (a.sortValue > b.sortValue) return 1;
                return 0;
            });
        }

        const fog = scene.camera.fog;

        for (let i = 0; i < this.alphaCurr; i++) {
            const bucket = this.alphaList[i];
            const minst = bucket.minst!;

            const oldData = minst.data;
            minst.data = bucket.data!;

            scene.lightKitManager.enable(minst.lightKit, rw.world);

            let srcBlend = ((minst.pipeFlags & HIPipeFlags.SRCBLEND_MASK) >>> HIPipeFlags.SRCBLEND_SHIFT);
            let dstBlend = ((minst.pipeFlags & HIPipeFlags.DESTBLEND_MASK) >>> HIPipeFlags.DESTBLEND_SHIFT);

            if (srcBlend === RwBlendFunction.NABLEND) {
                srcBlend = RwBlendFunction.SRCALPHA;
            }
            if (dstBlend === RwBlendFunction.NABLEND) {
                dstBlend = RwBlendFunction.INVSRCALPHA;
            }

            const fade = bucket.alphaFade;
            const oldAlpha = minst.alpha;

            minst.alpha *= fade;

            let zwrite = true;
            if ((minst.pipeFlags & HIPipeFlags.ZBUFFER_MASK) === HIPipeFlags.ZBUFFER_DISABLE) {
                zwrite = false;
            }

            let cull = RwCullMode.NONE;
            if ((minst.pipeFlags & HIPipeFlags.CULL_MASK) === HIPipeFlags.CULL_FRONTONLY) {
                cull = RwCullMode.BACK;
            }

            rw.renderState.srcBlend = srcBlend;
            rw.renderState.destBlend = dstBlend;
            rw.renderState.zWriteEnable = zwrite;
            rw.renderState.cullMode = cull;

            scene.camera.fog = (minst.pipeFlags & HIPipeFlags.FOG_DISABLE) ? undefined : fog;
            scene.camera.setFogRenderStates(rw);

            if ((minst.pipeFlags & HIPipeFlags.CULL_MASK) === HIPipeFlags.CULL_BACKTHENFRONT) {
                rw.renderState.cullMode = RwCullMode.FRONT;
                minst.renderSingle(scene, rw);
                rw.renderState.cullMode = RwCullMode.BACK;
                minst.renderSingle(scene, rw);
            } else if ((minst.pipeFlags & HIPipeFlags.ZBUFFER_MASK) === HIPipeFlags.ZBUFFER_ZFIRST) {
                // TODO not tested - the OG game does something different here
                rw.renderState.zWriteEnable = true;
                minst.renderSingle(scene, rw);
                rw.renderState.zWriteEnable = false;
                minst.renderSingle(scene, rw);
            } else {
                minst.renderSingle(scene, rw);
            }

            minst.alpha = oldAlpha;
            minst.data = oldData;
        }

        scene.camera.fog = fog;
        scene.camera.setFogRenderStates(rw);
        
        // Reset for next frame
        for (let i = 0; i < this.alphaCurr; i++) {
            this.alphaList[i].sortValue = Infinity;
            this.alphaList[i].layer = 0;
        }
        this.alphaCurr = 0;
    }
}