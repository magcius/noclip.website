import { SCX } from "./types.js";

export const splitMesh = (mesh: SCX.PolygonMesh) : SCX.PolygonMesh[] => {
  if (mesh.polygons == null) {
    return [];
  }

  const polygonsByShaderID: Record<number, SCX.Polygon[]> = {};
  for (const polygon of mesh.polygons) {
    polygonsByShaderID[polygon.shader] ??= [];
    polygonsByShaderID[polygon.shader].push(polygon);
  }

  return Object.values(polygonsByShaderID).map(polygons => ({
    ...mesh,
    polygons,
    polycount: polygons.length
  }));
}