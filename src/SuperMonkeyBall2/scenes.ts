import { vec3, mat4 } from 'gl-matrix';
import { Color, colorFromHSL, White } from '../Color';
import { drawWorldSpaceLine, drawWorldSpacePoint, getDebugOverlayCanvas2D } from '../DebugJunk';
import { GfxDevice, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import { BasicGXRendererHelper } from '../gx/gx_render';
import { ColorAnimator } from '../oot3d/cmab';
import { SceneContext } from '../SceneBase';
import * as Viewer from '../viewer';

/**
 * TODO:
 * Debug draw lines
 * Describe stagedef in Typescript interfaces
 * Decompress and parse stagedef
 * Render basic stagedef
 */

const pathBase = 'SuperMonkeyBall2';

const scratchVec3a: vec3 = vec3.create();
const scratchVec3b: vec3 = vec3.create();
const scratchColora: Color = White;

class Mkb2Renderer extends BasicGXRendererHelper {

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        for (let x = -10; x < 10; x++) {
            for (let y = -10; y < 10; y++) {
                for (let z = -10; z < 10; z++) {
                    const pos = scratchVec3a;
                    const origin = scratchVec3b;
                    vec3.zero(origin);
                    const color = scratchColora;
                    let dist = Math.sqrt(x*x + y*y + z*z) / Math.sqrt(300);
                    colorFromHSL(color, dist, dist, 0.5);
                    dist = dist * dist * dist;
                    vec3.set(pos, x, y, z);
                    vec3.scale(pos, pos, 500 * dist);
                    drawWorldSpaceLine(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, origin, pos, color)
                }
            }
        }
    }
}

class Mkb2SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, private index: number, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const lzBuffer = await context.dataFetcher.fetchData(`${pathBase}/files/stage/STAGE005.lz`);
        const renderer = new Mkb2Renderer(device);
        return renderer;
    }
}

const id = 'supermonkeyball2'
const name = 'Super Monkey Ball 2'

const sceneDescs = [
    new Mkb2SceneDesc('test', 1, 'test'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };