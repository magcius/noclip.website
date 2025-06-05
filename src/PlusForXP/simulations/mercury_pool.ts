import { vec2, vec3 } from "gl-matrix";
import { ViewerRenderInput } from "../../viewer";
import { SceneNode, Simulation } from "../types";
import { getDescendants } from "../util";
import { GfxBuffer, GfxDevice } from "../../gfx/platform/GfxPlatform";
import { SCX } from "../scx/types";
import { World } from "../world";
import { GfxRenderHelper } from "../../gfx/render/GfxRenderHelper";

const numSegments = 32;
const numVertexRows = numSegments + 1;

export const createPoolScene = (): SCX.Scene => {
    // A pool scene just contains a planar mesh composed of regular equilateral triangles.
    const vertices = [];
    for (let row = 0; row < numVertexRows; row++) {
        for (let column = 0; column < numVertexRows; column++) {
            let columnOffset = 0;
            if (column > 0 && column < numVertexRows - 1) {
                columnOffset = (row % 2) / 2 - 0.25;
            }
            vertices.push({
                i: row * numVertexRows + column,
                position: vec3.fromValues((column + columnOffset) / numSegments - 0.5, row / numSegments - 0.5, 0),
                normal: vec3.fromValues(0, 0, 1),
            });
        }
    }
    const triangles: number[] = [];
    for (let row = 0; row < numSegments; row++) {
        const swap = row % 2 === 1;
        for (let column = 0; column < numSegments; column++) {
            const [a, b, c, d] = [
                (row + 0) * numVertexRows + column + 0,
                (row + 0) * numVertexRows + column + 1,
                (row + 1) * numVertexRows + column + 1,
                (row + 1) * numVertexRows + column + 0,
            ];
            if (swap) {
                triangles.push(a, b, c, a, c, d);
            } else {
                triangles.push(a, b, d, b, c, d);
            }
        }
    }

    const mercuryShader: SCX.Shader = { name: "pool", id: 1, ambient: [1, 1, 1], diffuse: [1, 1, 1], specular: [1, 1, 1], opacity: 1, luminance: 0, blend: 1 };
    const poolMesh = {
        vertexcount: vertices.length,
        positions: new Float32Array(vertices.map((v) => [...v.position]).flat()),
        normals: new Float32Array(vertices.map((v) => [...v.normal]).flat()),
        indices: new Uint32Array(triangles.flat()),
        texCoords: new Float32Array(vertices.length * 2).fill(0),
        shader: 1,
        dynamic: true,
    };

    return {
        shaders: [mercuryShader],
        global: { animinterval: [0, 1000], framerate: 30, ambient: [0, 0, 0] },
        cameras: [],
        lights: [],
        objects: [
            {
                name: "pool",
                transform: { trans: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
                meshes: [poolMesh],
                animations: [],
            },
        ],
    };
};

enum MercuryDropState {
    "waiting",
    "falling",
    "splashing",
}

type MercuryDrop = {
    initialized: boolean;
    startTime: number;
    lastStartTime: number;
    position: [number, number];
    dropModel: SceneNode;
    splashModel: SceneNode;
    splashAnimatedNodes: SceneNode[];
    state: MercuryDropState;
};

type DynamicAttribute = {
    buffer: GfxBuffer;
    data: Float32Array;
    uint8Array: Uint8Array;
};

type DynamicIndex = {
    buffer: GfxBuffer;
    data: Uint32Array;
};

export class MercuryPool extends Simulation {
    private isInitialized: boolean;
    private isIndustrial: boolean;
    private drops: MercuryDrop[];
    private dropRange: [number, number];
    private fallDuration: number;
    private splashDuration: number;
    private rippleDuration: number;
    private poolPositions: vec3[];
    private poolTriangles: [number, number, number][];
    private poolPositionAttribute: DynamicAttribute;
    private poolNormals: vec3[];
    private poolNormalAttribute: DynamicAttribute;
    private poolScale: number;

    override setup(device: GfxDevice, renderHelper: GfxRenderHelper, world: World): void {
        super.setup(device, renderHelper, world);
        const dropTemplate = {
            initialized: false,
            startTime: 0,
            lastStartTime: 0,
            position: [0, 0] as [number, number],
            state: MercuryDropState.waiting,
        };
        this.isIndustrial = world.sceneNodesByName.has("Mercury_Pool_Tech_Scene.scx/_root");
        this.dropRange = this.isIndustrial ? [28, 28] : [16, 16];
        this.fallDuration = 800;
        this.splashDuration = 1333;
        this.rippleDuration = 5000;
        this.poolScale = this.isIndustrial ? 64 : 72;
        const pool = world.sceneNodesByName.get("pool/pool")!;
        pool.transform.scale = [this.poolScale, this.poolScale, 1];
        pool.transformChanged = true;
        const poolAttributes = pool.meshes[0].vertexAttributes;
        const poolIndices = pool.meshes[0].indexBufferDescriptor.data!;

        const poolPositionAttribute = poolAttributes.find((buffer) => buffer.name === "position")!;
        this.poolPositionAttribute = {
            buffer: poolPositionAttribute.buffer,
            data: poolPositionAttribute.data!,
            uint8Array: new Uint8Array(poolPositionAttribute.data!.buffer),
        };

        const numVertices = numVertexRows ** 2;
        this.poolPositions = [];
        for (let i = 0; i < numVertices; i++) {
            this.poolPositions.push(this.poolPositionAttribute.data.subarray(i * 3, (i + 1) * 3));
        }

        const numTriangles = numSegments ** 2 * 2;
        this.poolTriangles = [];
        for (let i = 0; i < numTriangles; i++) {
            const [index0, index1, index2] = [...poolIndices.subarray(i * 3, (i + 1) * 3)];
            this.poolTriangles.push([index0, index1, index2]);
        }

        const poolNormalAttribute = poolAttributes.find((buffer) => buffer.name === "normal")!;
        this.poolNormalAttribute = {
            buffer: poolNormalAttribute.buffer,
            data: poolNormalAttribute.data!,
            uint8Array: new Uint8Array(poolNormalAttribute.data!.buffer),
        };

        this.poolNormals = Array(numVertexRows * numVertexRows)
            .fill(0)
            .map((_, i) => this.poolNormalAttribute.data.subarray(i * 3, (i + 1) * 3));

        this.drops = [];
        for (let i = 1; i < 10; i++) {
            const dropModel = world.sceneNodesByName.get(`Mercury_Pool_Drop.scx_${i}/_root`);
            const splashModel = world.sceneNodesByName.get(`Mercury_Pool_Splash.scx_${i}/_root`);
            if (dropModel === undefined || splashModel === undefined) {
                break;
            }
            dropModel.visible = false;
            dropModel.transformChanged = true;
            splashModel.visible = false;
            splashModel.transformChanged = true;
            const splashAnimatedNodes = getDescendants(splashModel).filter((n) => n.animates);
            splashAnimatedNodes.forEach((n) => (n.loops = false));
            this.drops.push({ ...dropTemplate, dropModel, splashModel, splashAnimatedNodes });
        }
    }

    override update(input: ViewerRenderInput): void {
        const { time } = input;

        if (!this.isInitialized) {
            this.isInitialized = true;
            let firstStartTime = time - Math.random() * this.rippleDuration;
            for (const drop of this.drops) {
                drop.startTime = firstStartTime;
                drop.lastStartTime = firstStartTime;
                firstStartTime += Math.random() * (this.fallDuration + this.rippleDuration);
            }
        }

        for (const drop of this.drops) {
            const { dropModel, splashModel, splashAnimatedNodes } = drop;

            switch (drop.state) {
                case MercuryDropState.waiting: {
                    if (time > drop.startTime) {
                        drop.state = MercuryDropState.falling;
                        drop.position = MercuryPool.createDropPosition(this.dropRange);
                        drop.lastStartTime = drop.startTime;
                        vec3.set(dropModel.transform.trans, ...drop.position, -100);
                        dropModel.visible = true;
                        dropModel.transformChanged = true;
                    }
                    break;
                }
                case MercuryDropState.falling: {
                    if (time > drop.startTime + this.fallDuration) {
                        drop.state = MercuryDropState.splashing;

                        dropModel.visible = false;
                        dropModel.transformChanged = true;

                        vec3.set(splashModel.transform.trans, ...drop.position, 0);
                        splashModel.visible = true;
                        splashModel.transformChanged = true;
                        splashAnimatedNodes.forEach((n) => n.animations.forEach((anim) => anim.reset()));
                    } else {
                        dropModel.transform.trans[2] = 100 * (1 - (time - drop.startTime) / this.fallDuration);
                        dropModel.transformChanged = true;
                    }
                    break;
                }
                case MercuryDropState.splashing: {
                    if (time > drop.startTime + this.fallDuration + this.splashDuration) {
                        drop.state = MercuryDropState.waiting;
                        splashModel.visible = false;
                        splashModel.transformChanged = true;
                        drop.startTime = time + this.rippleDuration - Math.random() * this.fallDuration;
                    }
                    break;
                }
            }
        }

        const [v0, v1] = [vec3.create(), vec3.create()];
        for (let i = 0; i < numVertexRows; i++) {
            for (let j = 0; j < numVertexRows; j++) {
                const index = i * numVertexRows + j;
                this.poolPositions[index][2] = 0;
                vec3.scale(v0, this.poolPositions[index], this.poolScale);
                let sum = 0;
                for (const drop of this.drops) {
                    const t = Math.max(0, time - drop.lastStartTime - this.fallDuration);
                    const dist = vec2.distance(v0 as vec2, drop.position);
                    let x = Math.max(0, (12 * t) / 1000 - dist);
                    sum += ((-Math.cos(x * 0.6) * 0.5 + 0.5) * Math.max(0, 1 - t / this.rippleDuration) * (250 / this.poolScale)) / (1 + dist * 0.1);
                }
                this.poolPositions[index][2] = sum;
            }
        }

        const normalData = this.poolNormalAttribute.data;
        normalData.fill(0);
        for (const [index0, index1, index2] of this.poolTriangles) {
            vec3.sub(v0, this.poolPositions[index1], this.poolPositions[index0]);
            vec3.sub(v1, this.poolPositions[index2], this.poolPositions[index1]);
            vec3.cross(v0, v1, v0);
            vec3.add(this.poolNormals[index0], this.poolNormals[index0], v0);
            vec3.add(this.poolNormals[index1], this.poolNormals[index1], v0);
            vec3.add(this.poolNormals[index2], this.poolNormals[index2], v0);
        }

        this.device.uploadBufferData(this.poolPositionAttribute.buffer, 0, this.poolPositionAttribute.uint8Array);
        this.device.uploadBufferData(this.poolNormalAttribute.buffer, 0, this.poolNormalAttribute.uint8Array);
    }

    static createDropPosition(range: [number, number]): [number, number] {
        return [(Math.random() * 2 - 1) * range[0], (Math.random() * 2 - 1) * range[1]];
    }
}
