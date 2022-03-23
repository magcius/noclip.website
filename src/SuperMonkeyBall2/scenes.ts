import { vec3, mat4 } from 'gl-matrix';
import { Color, colorFromHSL, White } from '../Color';
import { drawWorldSpaceAABB, drawWorldSpaceBasis, drawWorldSpaceFan, drawWorldSpaceLine, drawWorldSpacePoint, getDebugOverlayCanvas2D } from '../DebugJunk';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { BasicGXRendererHelper } from '../gx/gx_render';
import { SceneContext } from '../SceneBase';
import * as SD from './stagedef';
import * as Viewer from '../viewer';
import { parseStagedefLz } from './parse';
import { AABB } from '../Geometry';
import { CameraController } from '../Camera';

const PATH_CASE = 'SuperMonkeyBall2';

const SHORT_TO_RAD = Math.PI / 0x8000;

const scratchVec3a: vec3 = vec3.create();
const scratchVec3b: vec3 = vec3.create();
const scratchVec3c: vec3 = vec3.create();
const scratchColora: Color = White;
const scratchMat4a: mat4 = mat4.create();
const scratchMat4b: mat4 = mat4.create();
const scratchAABB: AABB = new AABB(-100, -100, -100, 100, 100, 100);

class Mkb2Renderer extends BasicGXRendererHelper {

    constructor(device: GfxDevice, private stagedef: SD.Stage) {
        super(device);
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        for (let coliHeader of this.stagedef.itemgroups) {
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
                    viewerInput.camera.clipFromWorldMatrix,
                    point1,
                    point2,
                    color,
                );
                drawWorldSpaceLine(
                    getDebugOverlayCanvas2D(),
                    viewerInput.camera.clipFromWorldMatrix,
                    point2,
                    point3,
                    color,
                );
                drawWorldSpaceLine(
                    getDebugOverlayCanvas2D(),
                    viewerInput.camera.clipFromWorldMatrix,
                    point3,
                    point1,
                    color,
                );
            }
        }
    }
}

class Mkb2SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const lzBuffer = await context.dataFetcher.fetchData(`${PATH_CASE}/stage/STAGE320.lz`);
        const stagedef = parseStagedefLz(lzBuffer);
        const renderer = new Mkb2Renderer(device, stagedef);
        return renderer;
    }
}

const id = 'supermonkeyball2'
const name = 'Super Monkey Ball 2'

const sceneDescs = [
    new Mkb2SceneDesc('jungle', 'Jungle'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
