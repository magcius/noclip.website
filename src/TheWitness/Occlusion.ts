
import { computeViewSpaceDepthFromWorldSpacePoint } from "../Camera";
import { standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxDevice, GfxFormat, GfxQueryPoolType } from "../gfx/platform/GfxPlatform";
import { GfxQueryPool } from "../gfx/platform/GfxPlatformImpl";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription } from "../gfx/render/GfxRenderGraph";
import { gfxRenderInstCompareNone, GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { Entity_Cluster } from "./Entity";
import { TheWitnessGlobals } from "./Globals";

class Occlusion_Cluster {
    public renderInstList = new GfxRenderInstList(gfxRenderInstCompareNone);
    public index: number = -1;
    public depth: number = -1;
    public visible: boolean = false;

    constructor(public entity: Entity_Cluster) {
    }
}

export class Occlusion_Manager {
    private queryPool: GfxQueryPool;
    private clusters: Occlusion_Cluster[] = [];

    constructor(device: GfxDevice) {
        const numClusters = 250;
        this.queryPool = device.createQueryPool(GfxQueryPoolType.OcclusionConservative, numClusters);
    }

    public init(globals: TheWitnessGlobals): void {
        for (let i = 0; i < globals.entity_manager.flat_entity_list.length; i++) {
            const entity = globals.entity_manager.flat_entity_list[i];
            if (!(entity instanceof Entity_Cluster))
                continue;

            if (entity.cluster_mesh_instance === null)
                continue;

            this.clusters.push(new Occlusion_Cluster(entity));
        }
    }

    public clusterIsVisible(portable_id: number | undefined): boolean {
        if (portable_id === undefined)
            return true;
        for (let i = 0; i < this.clusters.length; i++)
            if (this.clusters[i].entity.portable_id === portable_id)
                return this.clusters[i].visible;
        return true;
    }

    public prepareToRender(globals: TheWitnessGlobals, renderInstManager: GfxRenderInstManager): void {
        // Go through the world's clusters, and push them to the render inst list...
        const oldRenderList = renderInstManager.currentRenderInstList;

        for (let i = 0; i < this.clusters.length; i++) {
            const cluster = this.clusters[i], entity = cluster.entity;
            if (!entity.visible)
                continue;
            cluster.depth = computeViewSpaceDepthFromWorldSpacePoint(globals.viewpoint.viewFromWorldMatrix, entity.bounding_center_world);
            renderInstManager.currentRenderInstList = cluster.renderInstList;
            entity.cluster_mesh_instance!.prepareToRender(globals, renderInstManager, entity, cluster.depth);
        }

        renderInstManager.currentRenderInstList = oldRenderList;

        // Sort the clusters by depth so that the most opaque clusters go first.
        this.clusters.sort((a, b) => {
            return a.depth - b.depth;
        });
    }

    public pushPasses(globals: TheWitnessGlobals, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager): void {
        const occlDepthBufferDesc = new GfxrRenderTargetDescription(GfxFormat.D24);
        occlDepthBufferDesc.setDimensions(128, 64, 1);
        occlDepthBufferDesc.depthClearValue = standardFullClearRenderPassDescriptor.depthClearValue;

        const cache = renderInstManager.gfxRenderCache;
        const device = cache.device;

        const occlDepthTargetID = builder.createRenderTargetID(occlDepthBufferDesc, `Occlusion Depth`);
        builder.pushPass((pass) => {
            pass.setDebugName('Occlusion Query');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, occlDepthTargetID);
            pass.attachOcclusionQueryPool(this.queryPool);

            pass.exec((passRenderer) => {
                let allocQueryNum = 0;

                for (let i = 0; i < this.clusters.length; i++) {
                    const cluster = this.clusters[i];

                    // Retrieve the old cluster results.
                    if (cluster.index >= 0) {
                        const visible = device.queryPoolResultOcclusion(this.queryPool, cluster.index);
                        if (visible !== null) {
                            cluster.visible = visible;
                        } else {
                            // Query is not ready? Assume it's visible.
                            cluster.visible = true;
                        }
                    } else {
                        // If no query was submitted last frame, then assume it's invisible?
                        cluster.visible = false;
                    }

                    // Reset the cluster.
                    cluster.index = -1;

                    if (cluster.renderInstList.renderInsts.length === 0)
                        continue;

                    cluster.index = allocQueryNum++;
                    passRenderer.beginOcclusionQuery(cluster.index);
                    cluster.renderInstList.drawOnPassRenderer(cache, passRenderer);
                    passRenderer.endOcclusionQuery(cluster.index);
                }
            });
        });
    }

    public destroy(device: GfxDevice): void {
        device.destroyQueryPool(this.queryPool);
    }
}
