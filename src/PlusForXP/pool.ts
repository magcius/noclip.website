import { vec3 } from "gl-matrix";
import { SCX } from "./scx/types.js";

const numSegments = 32;
const vertices = Array(numSegments + 1).fill(0).map((_, y) => Array(numSegments + 1).fill(0).map((_, x) => {
  return {
    position: vec3.fromValues(
      x / numSegments - 0.5, // TODO: experiment with equilateral placement
      y / numSegments - 0.5, 
      0
    ),
    normal: vec3.fromValues(0, 0, 1)
  };
})).flat().map((vert, i) => ({...vert, i}));
const quadIndices = (a:number, b:number, c:number, d:number) : number[] => [a, b, c, a, c, d];
const quads = Array(numSegments).fill(0).map((_, i) => Array(numSegments).fill(0).map((_, j) => {
  return quadIndices(
    (i + 0) * (numSegments + 1) + j + 0, 
    (i + 0) * (numSegments + 1) + j + 1, 
    (i + 1) * (numSegments + 1) + j + 1, 
    (i + 1) * (numSegments + 1) + j + 0
  );
})).flat();

const positions = vertices.map(v => [...v.position]).flat();
const normals = vertices.map(v => [...v.normal]).flat();
const indices = quads.flat();

const vertexcount = vertices.length;

const pool = {
  vertexcount,
  positions,
  normals,
  texCoords: Array(vertexcount * 2).fill(0),
  indices
};

export type PoolScene = SCX.Scene & {

};

const poolScene: PoolScene = {
  shaders: [{
    name: "pool",
    id: 1,
    ambient: [ 1, 1, 1 ],
    diffuse: [ 1, 1, 1 ],
    specular: [ 1, 1, 1 ],
    opacity: 1,
    luminance: 0,
    blend: 1
  }],
  globals: [{
    animinterval: [0, 1000],
    framerate: 0,
    ambient: [0, 0, 0]
  }],
  cameras: [],
  lights: [],
  objects: [{
    name: "pool",
    transforms: [{
      trans: [0, 0, 0],
      rot: [0, 0, 0],
      scale: [64, 64, 1]
    }],
    meshes: [{
      ...pool,
      shader: 1
    }],
    animations: []
  }]
};

export default poolScene;