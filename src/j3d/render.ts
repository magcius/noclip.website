
/// <reference path="../decl.d.ts" />

import * as LZ77 from 'lz77';
import * as Viewer from 'viewer';
import * as BMD from 'bmd';
import { fetch } from 'util';

export class Scene implements Viewer.Scene {
    cameraController = Viewer.FPSCameraController;
    textures:HTMLCanvasElement[];

    constructor(gl, bmd) {
    }
    render() {
    }
}

export class SceneDesc implements Viewer.SceneDesc {
    name:string;
    path:string;

    constructor(name:string, path:string) {
        this.name = name;
        this.path = path;
    }

    createScene(gl:WebGLRenderingContext):PromiseLike<Scene> {
        return fetch(this.path).then((result:ArrayBuffer) => {
            let bmd = BMD.parse(result);
            return new Scene(gl, bmd);
        });
    }
}
