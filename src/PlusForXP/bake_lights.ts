
import { mat3, mat4, vec3 } from "gl-matrix";
import { SCX } from "./scx/types.js";
import { Vec3One } from "../MathHelpers.js";

export const bakeLights = (mesh: SCX.Mesh, shader: SCX.Shader, worldTransform: mat4, lights: SCX.Light[]): Float32Array => {
    const useShaderColors = shader.luminance === 0 && (shader.blend < 1 || shader.texture === null);
    const ambientColor = useShaderColors ? shader.ambient : vec3.fromValues(1, 1, 1);
    const diffuseColor = useShaderColors ? shader.diffuse : vec3.fromValues(1, 1, 1);

    const { positions, normals } = mesh;
    const position = vec3.create();
    const normal = vec3.create();
    const normalMatrix = mat3.normalFromMat4(mat3.create(), worldTransform);
    const color = vec3.create();
    const bakedColors: vec3[] = [];

    for (let i = 0; i < mesh.vertexcount; i++) {
        const bakedColor = vec3.create();
        bakedColors.push(bakedColor);
        vec3.set(position, positions[i * 3 + 0], positions[i * 3 + 1], positions[i * 3 + 2]);
        vec3.set(normal, normals[i * 3 + 0], normals[i * 3 + 1], normals[i * 3 + 2]);

        vec3.transformMat4(position, position, worldTransform);
        vec3.transformMat3(normal, normal, normalMatrix);
        vec3.normalize(normal, normal);

        for (const light of lights) {
            let { intensity } = light;
            if (intensity <= 0 && shader.luminance <= 0) {
                continue;
            }
            intensity *= lightCalculationsByType[light.type!](light, normal, position);
            if (intensity <= 0) {
                continue;
            }
            vec3.copy(color, Vec3One);
            vec3.scale(color, color, intensity + shader.luminance * 2);
            const materialColor = light.type === SCX.LightType.Ambient ? ambientColor : diffuseColor;
            vec3.mul(color, color, materialColor);
            vec3.mul(color, color, light.color);
            vec3.add(bakedColor, bakedColor, color);
        }
    }
    return new Float32Array(bakedColors.flatMap((rgb) => [...rgb, shader.opacity]));
};

type LightCalculation = (light: SCX.Light, normal: vec3, position: vec3) => number;

const spotCalculation = (light: SCX.Light, normal: vec3, position: vec3): number => {
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

    if (light.type === SCX.LightType.Spot) {
        if (light.dir === undefined || light.penumbra === undefined || light.umbra === undefined) {
            return 0;
        }

        const angle = vec3.dot(directionToLight, light.dir);
        if (angle <= 0) {
            return 0;
        }

        const penumbra = Math.cos((light.penumbra * Math.PI) / 180);
        const umbra = Math.cos((light.umbra * Math.PI) / 180);
        if (angle <= penumbra) {
            return 0;
        }

        if (angle < umbra) {
            attenuation *= (angle - penumbra) / (umbra - penumbra);
        }
    }

    return lightIntensity * attenuation;
};

const lightCalculationsByType: Record<SCX.LightType, LightCalculation> = {
    [SCX.LightType.Spot]: spotCalculation,
    [SCX.LightType.Directional]: (light, normal) => (light.dir === undefined ? 0 : vec3.dot(light.dir, normal)),
    [SCX.LightType.Point]: spotCalculation,
    [SCX.LightType.Ambient]: () => 1,
};
