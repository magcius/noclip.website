import { mat3, mat4, vec3 } from "gl-matrix";
import { SCX } from "./scx/types.js";
import { Vec3One } from "../MathHelpers.js";

export const bakeLights = (mesh: SCX.Mesh, material:SCX.Shader, worldTransform: mat4, lights: SCX.Light[]) : Float32Array => {
  lights = [...lights].reverse();

  const useMaterialColors = material.luminance === 0 && (material.blend < 1 || material.texture === null);
  const ambientColor = useMaterialColors ? material.ambient : null;
  const diffuseColor = useMaterialColors ? material.diffuse : null;
  
  const { positions, normals } = mesh;
  const position = vec3.create();
  const normal = vec3.create();
  const normalMatrix = mat3.normalFromMat4(mat3.create(), worldTransform);
  const color = vec3.create();
  const bakedColors: vec3[] = Array(mesh.vertexcount).fill(null).map(_ => vec3.create());

  for (let i = 0; i < mesh.vertexcount; i++) {
    const bakedColor = bakedColors[i];
    vec3.set(position, positions[i * 3 + 0], positions[i * 3 + 1], positions[i * 3 + 2]);
    vec3.set(normal, normals[i * 3 + 0], normals[i * 3 + 1], normals[i * 3 + 2]);  

    vec3.transformMat4(position, position, worldTransform);
    vec3.transformMat3(normal, normal, normalMatrix);
    vec3.normalize(normal, normal);

    for (const light of lights) {
      const lightIntensity = lightCalculationsByType[light.type!](light, normal, position);
      if (lightIntensity <= 0) {
        continue;
      }
      vec3.copy(color, Vec3One);
      vec3.scale(color, color, lightIntensity * (light.intensity ?? 1) + material.luminance * 2);
      const materialColor = light.type === "ambient" ? ambientColor : diffuseColor;
      if (materialColor !== null) {
        vec3.mul(color, color, materialColor);
      }
      if (light.color !== undefined) {
        vec3.mul(color, color, light.color);
      }
      vec3.add(bakedColor, bakedColor, color);
    }
  }
  return new Float32Array(bakedColors.flatMap(color => [...color, material.opacity]));
};

type LightCalculation = (light: SCX.Light, normal: vec3, position: vec3) => number;

const spotCalculation = (light: SCX.Light, normal: vec3, position: vec3) : number => {
    
  if (light.pos === undefined || light.attenend === undefined || light.attenstart === undefined) {
    return 0;
  }
  
  let lightIntensity = 0;
  const lightDistSquared = vec3.sqrDist(light.pos, position);
  let lightDistance;
  
  if (lightDistSquared === 0) {
    lightDistance = 0;
  } else {
    lightDistance = Math.sqrt(lightDistSquared);
  }
  
  const directionToLight = vec3.sub(vec3.create(), light.pos, position);
  vec3.normalize(directionToLight, directionToLight);

  if (lightDistance > light.attenend) {
    return 0;
  }

  lightIntensity = vec3.dot(directionToLight, normal);

  let attenuation = 1;
  if (lightDistance > light.attenstart) {
    attenuation = 1 - (lightDistance - light.attenstart) / (light.attenend - light.attenstart);
  }

  if (lightIntensity <= 0) {
    return 0;
  }

  if (light.type === "spot") {
    if (light.dir === undefined || light.penumbra === undefined || light.umbra === undefined) {
      return 0;
    }

    const angle = vec3.dot(directionToLight, light.dir);
    if (angle <= 0) {
      return 0;
    }
    
    const penumbra = Math.cos(light.penumbra * Math.PI / 180);
    const umbra = Math.cos(light.umbra * Math.PI / 180);
    if (angle <= penumbra) {
      return 0;
    }
      
    if (angle < umbra) {
      attenuation *= (angle - penumbra) / (umbra - penumbra);
    }
  }
  
  return lightIntensity * attenuation;
};

const lightCalculationsByType: Record<SCX.LightType, LightCalculation>  = {
  "spot" : spotCalculation,
  "directional" : (light, normal) => light.dir === undefined ? 0 : vec3.dot(light.dir, normal),
  "point" : spotCalculation,
  "ambient" : () => 1
}
