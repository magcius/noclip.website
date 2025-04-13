import { vec3 } from "gl-matrix";
import { RwStream } from "./rw/rwcore.js";

export class HIMarkerAsset {
    public pos: vec3;

    constructor(stream: RwStream) {
        this.pos = stream.readVec3();
    }
}