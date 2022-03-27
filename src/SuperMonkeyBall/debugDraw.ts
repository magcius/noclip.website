import { mat4, vec3 } from "gl-matrix";
import {Color, colorFromHSL, White} from '../Color';
import * as SD from './stagedef';
import { Camera } from '../Camera';
import { drawWorldSpaceLine, getDebugOverlayCanvas2D } from "../DebugJunk";

const SHORT_TO_RAD= Math.PI / 0x8000;

const scratchVec3a: vec3 = vec3.create();
const scratchVec3b: vec3 = vec3.create();
const scratchColora: Color = White;
const scratchMat4a: mat4 = mat4.create();

export function debugDrawColi(stagedef: SD.Stage, camera: Camera) {
    for (let coliHeader of stagedef.itemgroups) {
        for (let i = 0; i < coliHeader.coliTris.length; i++) {
            const coliTri = coliHeader.coliTris[i];
            const color = scratchColora;
            colorFromHSL(color, i / coliHeader.coliTris.length, 0.5, 0.5);

            const tf = scratchMat4a;
            mat4.fromTranslation(tf, coliTri.point1Pos);
            mat4.rotateY(tf, tf, SHORT_TO_RAD * coliTri.rotFromXY[1]);
            mat4.rotateX(tf, tf, SHORT_TO_RAD * coliTri.rotFromXY[0]);
            mat4.rotateZ(tf, tf, SHORT_TO_RAD * coliTri.rotFromXY[2]);

            const point1 = coliTri.point1Pos;
            const point2 = scratchVec3a;
            const point3 = scratchVec3b;

            vec3.set(point2, coliTri.point2Point1Delta[0], coliTri.point2Point1Delta[1], 0);
            vec3.set(point3, coliTri.point3Point1Delta[0], coliTri.point3Point1Delta[1], 0);
            vec3.transformMat4(point2, point2, tf);
            vec3.transformMat4(point3, point3, tf);

            drawWorldSpaceLine(
                getDebugOverlayCanvas2D(),
                camera.clipFromWorldMatrix,
                point1,
                point2,
                color,
            );
            drawWorldSpaceLine(
                getDebugOverlayCanvas2D(),
                camera.clipFromWorldMatrix,
                point2,
                point3,
                color,
            );
            drawWorldSpaceLine(
                getDebugOverlayCanvas2D(),
                camera.clipFromWorldMatrix,
                point3,
                point1,
                color,
            );
        }
    }
}
