import { vec3 } from "gl-matrix";
import { White } from "../../../Color.js";
import { RpAtomic, RpAtomicPipeline, RpGeometryFlag, RpMaterial } from "../rpworld.js";
import { RwEngine } from "../rwcore.js";
import { RwGfxIndexBuffer, RwGfxVertexBuffer } from "../rwgfx.js";

interface MeshData {
    indexBuffer: RwGfxIndexBuffer;
    material: RpMaterial;
}

interface InstanceData {
    vertexBuffer: RwGfxVertexBuffer;
    meshes: MeshData[];
}

export class AtomicAllInOnePipeline implements RpAtomicPipeline {
    private static lightDirection = vec3.create();

    public instance(atomic: RpAtomic, rw: RwEngine) {
        if (atomic.geometry.instanceData) {
            this.destroy(atomic, rw);
        }

        const geom = atomic.geometry;
        const mt = geom.morphTargets[0];

        const vertexBuffer = rw.gfx.createVertexBuffer(mt.verts!, mt.normals, geom.preLitLum, geom.texCoords);
        const meshes: MeshData[] = [];

        for (const mesh of geom.mesh.meshes) {
            const indexBuffer = rw.gfx.createIndexBuffer(mesh.indices);
            const material = geom.materials[mesh.matIndex];

            meshes.push({ indexBuffer, material });
        }

        const instData: InstanceData = { vertexBuffer, meshes };

        atomic.geometry.instanceData = instData;
    }

    public render(atomic: RpAtomic, rw: RwEngine) {
        if (!atomic.geometry.instanceData) {
            this.instance(atomic, rw);
        }

        const instData = atomic.geometry.instanceData as InstanceData;

        rw.gfx.setClipPlanes(rw.camera.nearPlane, rw.camera.farPlane);
        rw.gfx.setFogStart(rw.camera.fogPlane);
        rw.gfx.setFogEnd(rw.camera.farPlane);

        rw.gfx.setModelMatrix(atomic.frame.matrix);

        if (atomic.geometry.flags & RpGeometryFlag.NORMALS) {
            rw.gfx.enableNormalArray();
        } else {
            rw.gfx.disableNormalArray();
        }

        if (atomic.geometry.flags & RpGeometryFlag.PRELIT) {
            rw.gfx.enableColorArray();
        } else {
            rw.gfx.disableColorArray();
        }

        if (atomic.geometry.flags & (RpGeometryFlag.TEXTURED | RpGeometryFlag.TEXTURED2)) {
            rw.gfx.enableTexCoordArray();
        } else {
            rw.gfx.disableTexCoordArray();
        }

        if (atomic.geometry.flags & RpGeometryFlag.LIGHT) {
            rw.gfx.enableLighting();
            rw.gfx.loadWorldLights(rw.world);
        } else {
            rw.gfx.disableLighting();
        }

        for (const mesh of instData.meshes) {
            if (atomic.geometry.flags & RpGeometryFlag.MODULATEMATERIALCOLOR) {
                rw.gfx.setMaterialColor(mesh.material.color);
            } else {
                rw.gfx.setMaterialColor(White);
            }

            rw.gfx.setMaterialAmbient(mesh.material.ambient);
            rw.gfx.setMaterialDiffuse(mesh.material.diffuse);

            rw.gfx.setTexture(mesh.material.texture);

            rw.gfx.drawElements(instData.vertexBuffer, mesh.indexBuffer);
        }
    }

    public destroy(atomic: RpAtomic, rw: RwEngine) {
        if (!atomic.geometry.instanceData) {
            return;
        }

        const instData = atomic.geometry.instanceData as InstanceData;

        for (const mesh of instData.meshes) {
            rw.gfx.destroyIndexBuffer(mesh.indexBuffer);
        }

        rw.gfx.destroyVertexBuffer(instData.vertexBuffer);

        atomic.geometry.instanceData = undefined;
    }
}