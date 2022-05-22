import { mat4, vec3 } from "gl-matrix";
import { Camera } from "../Camera";
import { Color, colorFromHSL, White } from "../Color";
import { drawWorldSpaceLine, getDebugOverlayCanvas2D } from "../DebugJunk";
import { transformVec3Mat4w1 } from "../MathHelpers";
import * as SD from "./Stagedef";

const SHORT_TO_RAD = Math.PI / 0x8000;

const scratchVec3a: vec3 = vec3.create();
const scratchVec3b: vec3 = vec3.create();
const scratchColora: Color = White;
const scratchMat4a: mat4 = mat4.create();

export function debugDrawColi(stagedef: SD.Stage, camera: Camera) {
    for (let coliHeader of stagedef.animGroups) {
        for (let i = 0; i < coliHeader.coliTris.length; i++) {
            const coliTri = coliHeader.coliTris[i];
            const color = scratchColora;
            colorFromHSL(color, i / coliHeader.coliTris.length, 0.5, 0.5);

            const tf = scratchMat4a;
            mat4.fromTranslation(tf, coliTri.pos);
            mat4.rotateY(tf, tf, SHORT_TO_RAD * coliTri.rot[1]);
            mat4.rotateX(tf, tf, SHORT_TO_RAD * coliTri.rot[0]);
            mat4.rotateZ(tf, tf, SHORT_TO_RAD * coliTri.rot[2]);

            const vert1 = coliTri.pos;
            const vert2 = scratchVec3a;
            const vert3 = scratchVec3b;

            vec3.set(vert2, coliTri.vert2[0], coliTri.vert2[1], 0);
            vec3.set(vert3, coliTri.vert3[0], coliTri.vert3[1], 0);
            transformVec3Mat4w1(vert2, tf, vert2);
            transformVec3Mat4w1(vert3, tf, vert3);

            drawWorldSpaceLine(
                getDebugOverlayCanvas2D(),
                camera.clipFromWorldMatrix,
                vert1,
                vert2,
                color
            );
            drawWorldSpaceLine(
                getDebugOverlayCanvas2D(),
                camera.clipFromWorldMatrix,
                vert2,
                vert3,
                color
            );
            drawWorldSpaceLine(
                getDebugOverlayCanvas2D(),
                camera.clipFromWorldMatrix,
                vert3,
                vert1,
                color
            );
        }
    }
}
