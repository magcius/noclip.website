
import { computeViewSpaceDepthFromWorldSpacePoint } from "../Camera.js";
import { Color, colorNewCopy, Cyan, Green, Magenta, OpaqueBlack, Red, White } from "../Color.js";
import { drawScreenSpaceText, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk.js";
import { standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { GfxDevice, GfxFormat, GfxQueryPoolType } from "../gfx/platform/GfxPlatform.js";
import { GfxQueryPool } from "../gfx/platform/GfxPlatformImpl.js";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription } from "../gfx/render/GfxRenderGraph.js";
import { gfxRenderInstCompareNone, GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { Entity_Cluster } from "./Entity.js";
import { TheWitnessGlobals } from "./Globals.js";

class Occlusion_Cluster {
    public renderInstList = new GfxRenderInstList(gfxRenderInstCompareNone);
    public depth: number = -1;

    constructor(public entity: Entity_Cluster) {
    }
}

const maxQueriesPerFrame = 256;

class Occlusion_Frame {
    public clusters: Occlusion_Cluster[] = [];
    public pool: GfxQueryPool;

    constructor(device: GfxDevice) {
        this.pool = device.createQueryPool(GfxQueryPoolType.OcclusionConservative, maxQueriesPerFrame);
    }

    public is_ready(device: GfxDevice): boolean {
        for (let i = 0; i < this.clusters.length; i++) {
            const visible = device.queryPoolResultOcclusion(this.pool, i);
            if (visible === null)
                return false;
        }

        return true;
    }

    public mark_clusters_visible(device: GfxDevice): void {
        for (let i = 0; i < this.clusters.length; i++)
            this.clusters[i].entity.occlusion_visible = device.queryPoolResultOcclusion(this.pool, i)!;
    }

    public reset(): void {
        this.clusters.length = 0;
    }

    public destroy(device: GfxDevice): void {
        this.reset();
        device.destroyQueryPool(this.pool);
    }
}

export class Occlusion_Manager {
    private clusters: Occlusion_Cluster[] = [];
    private framePool: Occlusion_Frame[] = [];
    private submittedFrames: Occlusion_Frame[] = [];

    constructor(device: GfxDevice) {
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

    private newFrame(device: GfxDevice): Occlusion_Frame {
        if (this.framePool.length > 0)
            return this.framePool.pop()!;
        else
            return new Occlusion_Frame(device);
    }

    public prepareToRender(globals: TheWitnessGlobals, renderInstManager: GfxRenderInstManager): void {
        // Go through the world's clusters, and push them to the render inst list...
        const oldRenderList = renderInstManager.currentList;

        for (let i = 0; i < this.clusters.length; i++) {
            const cluster = this.clusters[i], entity = cluster.entity;
            if (!entity.visible || !entity.layer_active)
                continue;
            cluster.depth = computeViewSpaceDepthFromWorldSpacePoint(globals.viewpoint.viewFromWorldMatrix, entity.bounding_center_world);
            renderInstManager.currentList = cluster.renderInstList;
            entity.cluster_mesh_instance!.prepareToRender(globals, renderInstManager, entity, cluster.depth);
        }

        renderInstManager.currentList = oldRenderList;

        // Sort the clusters by depth so that the most opaque clusters go first.
        this.clusters.sort((a, b) => {
            return a.depth - b.depth;
        });
    }

    private updateFromFinishedFrames(device: GfxDevice): void {
        for (let i = 0; i < this.submittedFrames.length; i++) {
            const frame = this.submittedFrames[i];
            if (frame.is_ready(device)) {
                for (let i = 0; i < this.clusters.length; i++)
                    this.clusters[i].entity.occlusion_visible = false;

                frame.mark_clusters_visible(device);

                // Add to free list.
                frame.reset();
                this.submittedFrames.splice(i--, 1);
                this.framePool.push(frame);
            }
        }
    }

    public pushPasses(globals: TheWitnessGlobals, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager): void {
        this.updateFromFinishedFrames(globals.device);

        const occlDepthBufferDesc = new GfxrRenderTargetDescription(GfxFormat.D24);
        occlDepthBufferDesc.setDimensions(128, 64, 1);
        occlDepthBufferDesc.clearDepth = standardFullClearRenderPassDescriptor.clearDepth;

        const cache = renderInstManager.gfxRenderCache;
        const device = cache.device;

        const frame = this.newFrame(device);

        const occlDepthTargetID = builder.createRenderTargetID(occlDepthBufferDesc, `Occlusion Depth`);
        builder.pushPass((pass) => {
            pass.setDebugName('Occlusion Query');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, occlDepthTargetID);
            pass.attachOcclusionQueryPool(frame.pool);

            pass.exec((passRenderer) => {
                for (let i = 0; i < this.clusters.length; i++) {
                    const cluster = this.clusters[i];

                    // Was frustum culled, ignore.
                    if (cluster.renderInstList.renderInsts.length === 0)
                        continue;

                    // Clusters are already sorted by depth.
                    let index = frame.clusters.length;
                    frame.clusters.push(cluster);

                    passRenderer.beginOcclusionQuery(index);
                    cluster.renderInstList.drawOnPassRenderer(cache, passRenderer);
                    passRenderer.endOcclusionQuery();
                }
            });
        });

        this.submittedFrames.push(frame);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.framePool.length; i++)
            this.framePool[i].destroy(device);
        for (let i = 0; i < this.submittedFrames.length; i++)
            this.submittedFrames[i].destroy(device);
    }
}
