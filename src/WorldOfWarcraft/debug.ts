import { ReadonlyMat4, mat3, mat4, vec3 } from "gl-matrix";
import { WowWmoBspNode } from "../../rust/pkg/index.js";
import { Color } from "../Color.js";
import { drawWorldSpaceAABB, drawWorldSpaceLine, drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk.js";
import { Frustum, Plane } from "../Geometry.js";
import { PortalData, WmoGroupData } from "./data.js";
import { WdtScene } from "./scenes.js";

let drawFrustumScratchVec3a = vec3.create();
let drawFrustumScratchVec3b = vec3.create();
// Note that this assumes a frustum whose near/far planes are at index 4 and 5, respectively
export function drawDebugFrustum(f: Frustum, transformMat: mat4, color: Color | undefined = undefined) {
  const clipMat = (window.main.scene as WdtScene).mainView.clipFromWorldMatrix;
  const near = f.planes[4];
  const far = f.planes[5];
  for (let i = 0; i < f.planes.length; i++) {
    if (i === 4 || i === 5) {
      continue;
    }
    const p1 = f.planes[i];
    const p2 = f.planes[i === f.planes.length - 1 ? 0 : i + 1];
    findIncidentPoint(drawFrustumScratchVec3a, p1, p2, near);
    findIncidentPoint(drawFrustumScratchVec3b, p1, p2, far);
    vec3.transformMat4(drawFrustumScratchVec3a, drawFrustumScratchVec3a, transformMat);
    vec3.transformMat4(drawFrustumScratchVec3b, drawFrustumScratchVec3b, transformMat);
    drawWorldSpaceLine(
      getDebugOverlayCanvas2D(),
      clipMat,
      drawFrustumScratchVec3a,
      drawFrustumScratchVec3b,
      color
    );
  }
}

let incidentScratchMat = mat3.create();
let incidentScratchVec3 = vec3.create();
function findIncidentPoint(dst: vec3, p1: Plane, p2: Plane, p3: Plane) {
  incidentScratchMat[0] = p1.n[0];
  incidentScratchMat[1] = p2.n[0];
  incidentScratchMat[2] = p3.n[0];
  incidentScratchMat[3] = p1.n[1];
  incidentScratchMat[4] = p2.n[1];
  incidentScratchMat[5] = p3.n[1];
  incidentScratchMat[6] = p1.n[2];
  incidentScratchMat[7] = p2.n[2];
  incidentScratchMat[8] = p3.n[2];
  mat3.invert(incidentScratchMat, incidentScratchMat);
  incidentScratchVec3[0] = -p1.d;
  incidentScratchVec3[1] = -p2.d;
  incidentScratchVec3[2] = -p3.d;
  vec3.transformMat3(dst, incidentScratchVec3, incidentScratchMat);
}

export function drawDebugPortal(portal: PortalData, transformMat: mat4, color: Color | undefined = undefined, text: string | undefined = undefined) {
  const clipMat = (window.main.scene as WdtScene).mainView.clipFromWorldMatrix;
  for (let i in portal.points) {
    const p = vec3.transformMat4(vec3.create(), portal.points[i], transformMat)
    if (text !== undefined && i === '0') {
      drawWorldSpaceText(getDebugOverlayCanvas2D(), clipMat, p, text, undefined, color);
    }
    drawWorldSpacePoint(
      getDebugOverlayCanvas2D(),
      clipMat,
      p,
      color
    );
  }
  drawWorldSpaceAABB(getDebugOverlayCanvas2D(), clipMat, portal.aabb, transformMat, color);
}
