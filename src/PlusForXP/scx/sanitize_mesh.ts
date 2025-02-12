import { vec3 } from "gl-matrix";
import { SCX } from "./types.js";

export const sanitizeMesh = (mesh: SCX.PolygonMesh, flipNormals: boolean, replaceNormals: boolean = false) => {
  const polygons = mesh.polygons!;
  
  if (replaceNormals) {
    const normal = vec3.create();
    const vertices = [vec3.create(), vec3.create(), vec3.create()];
    const edgeVectors = [vec3.create(), vec3.create()];

    // Find all vertices that share a position
    const sharedPositions: Map<string, {vertices: Set<number>, normal: vec3}> = new Map();
    for (let i = 0; i < mesh.vertexcount; i++) {
      const key = mesh.positions.slice(i * 3, (i + 1) * 3).join(",");
      if (!sharedPositions.has(key)) {
        sharedPositions.set(key, {vertices: new Set(), normal: vec3.create()});
      }
      sharedPositions.get(key)!.vertices.add(i);
    }
    // add the normal for each polygon to the normals of its unified vertices
    for (const polygon of polygons) {
      for (let i = 0; i < 3; i++) {
        const vertIndex = polygon.verts[i];
        vec3.copy(vertices[i], mesh.positions.slice(vertIndex * 3, (vertIndex + 1) * 3) as SCX.Vec3);
      }
      vec3.sub(edgeVectors[0], vertices[0], vertices[1]);
      vec3.sub(edgeVectors[1], vertices[1], vertices[2]);
      if (flipNormals) {
        vec3.cross(normal, edgeVectors[0], edgeVectors[1]);
      } else {
        vec3.cross(normal, edgeVectors[1], edgeVectors[0]);
      }
      for (const vertex of vertices) {
        const key = vertex.join(",");
        const referenceNormal = sharedPositions.get(key)!.normal;
        vec3.add(referenceNormal, referenceNormal, normal);
      }
    }
    // normalize each shared position's normal and overwrite its vertices' normals.
    // TODO: distinguish between vertices that share a position but have different smoothingGroup
    for (const sharedPosition of sharedPositions.values()) {
      vec3.normalize(sharedPosition.normal, sharedPosition.normal);
      for (const vertIndex of sharedPosition.vertices) {
        mesh.normals.splice(vertIndex * 3, 3, ...sharedPosition.normal);
      }
    }
  }

  // Flip the normals of this mesh; its transform inverts it
  if (flipNormals) {
    const normal = vec3.create();
    for (let i = 0; i < mesh.vertexcount; i++) {
      vec3.copy(normal, (mesh.normals.slice(i * 3, (i + 1) * 3) as SCX.Vec3));
      vec3.negate(normal, normal);
      mesh.normals.splice(i * 3, 3, ...normal);
    }
  }

  // Promote the polygons' (presumably unanimous) shader to the mesh itself
  mesh.shader = polygons[0].shader;

  // Create an index buffer from the mesh's polygons, delete them,
	const indices = [];
  const allPolygonShaders = new Set(polygons.map((polygon) => polygon.shader));
	if (allPolygonShaders.size > 1) {
		console.warn("Mesh polygons reference multiple shaders:", [...allPolygonShaders]);
	}
	for (const polygon of polygons) {
		indices.push(...polygon.verts);
	}
	mesh.indices = indices;
	delete mesh.polycount;
	delete mesh.polygons;
};