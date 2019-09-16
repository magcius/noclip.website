
import { vec2, vec3, quat } from "gl-matrix";
import { assert } from "../util";

export function parseVector2(e: Element): vec2 {
    assert(e.tagName === 'Vector2');
    const x = Number(e.getAttribute('x'));
    const y = Number(e.getAttribute('y'));
    return vec2.fromValues(x, y);
}

export function parseVector3(e: Element): vec3 {
    assert(e.tagName === 'Vector3');
    const x = Number(e.getAttribute('x'));
    const y = Number(e.getAttribute('y'));
    const z = Number(e.getAttribute('z'));
    return vec3.fromValues(x, y, z);
}

export function parseQuaternion(e: Element): quat {
    assert(e.tagName === 'Quaternion');
    const x = Number(e.getAttribute('x'));
    const y = Number(e.getAttribute('y'));
    const z = Number(e.getAttribute('z'));
    const w = Number(e.getAttribute('w'));
    return quat.fromValues(x, y, z, w);
}
