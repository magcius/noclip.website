import { vec3 } from "gl-matrix";
import { SCX } from "./scx/types.js";

export const numSegments = 32;
export const numVertexRows = numSegments + 1;
const vertices = Array(numVertexRows).fill(0).map((_, y) => Array(numVertexRows).fill(0).map((_, x) => {
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
    (i + 0) * (numVertexRows) + j + 0, 
    (i + 0) * (numVertexRows) + j + 1, 
    (i + 1) * (numVertexRows) + j + 1, 
    (i + 1) * (numVertexRows) + j + 0
  );
})).flat();

const poolScene: SCX.Scene = {
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
      scale: [1, 1, 1]
    }],
    meshes: [{
      vertexcount: vertices.length,
      positions: vertices.map(v => [...v.position]).flat(),
      normals: vertices.map(v => [...v.normal]).flat(),
      indices: quads.flat(),
      texCoords: Array(vertices.length * 2).fill(0),
      shader: 1,
      dynamic: true
    }],
    animations: []
  }]
};

export default poolScene;