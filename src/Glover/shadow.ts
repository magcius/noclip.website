import { vec3 } from "gl-matrix";

///////////////////////////////////////////////////////
// Möller–Trumbore intersection
// Adapted to typescript from:
//  https://en.wikipedia.org/wiki/M%C3%B6ller%E2%80%93Trumbore_intersection_algorithm
const edge1 = vec3.create();
const edge2 = vec3.create();
const h = vec3.create();
const s = vec3.create();
const q = vec3.create();
export function rayTriangleIntersection (rayOrigin: vec3, rayVector: vec3,
    triangle: vec3[]): vec3 | null
{
    const EPSILON = 0.0000001;
    vec3.sub(edge1, triangle[1], triangle[0]);
    vec3.sub(edge2, triangle[2], triangle[0]);
    vec3.cross(h, rayVector, edge2);
    let a = vec3.dot(edge1, h);
    if (a > -EPSILON && a < EPSILON) {
        // This ray is parallel to this triangle.
        return null;
    }
    let f = 1.0/a;
    vec3.sub(s, rayOrigin, triangle[0]);
    let u = f * vec3.dot(s, h);
    if (u < 0.0 || u > 1.0) {
        return null;
    }
    vec3.cross(q, s, edge1);
    let v = f * vec3.dot(rayVector, q);
    if (v < 0.0 || u + v > 1.0) {
        return null;
    }
    // At this stage we can compute t to find out where the intersection point is on the line.
    let t = f * vec3.dot(edge2, q);
    if (t > EPSILON) {
        let intersection = vec3.create();
        vec3.scaleAndAdd(intersection, rayOrigin, rayVector, t);
        return intersection;
    } else {
        // This means that there is a line intersection but not a ray intersection.
        return null;
    }
}
//
///////////////////////////////////////////////////////