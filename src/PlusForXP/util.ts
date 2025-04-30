import { decode as tifDecode } from "tiff";
import { FakeTextureHolder } from "../TextureHolder.js";
import { DataFetcher } from "../DataFetcher.js";
import { SceneNode, Texture } from "./types.js";
import { range } from "../MathHelpers.js";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { align } from "../util.js";
import { mat4, vec3 } from "gl-matrix";

type _FixedTupleOf<T, N extends number, R extends unknown[]> = R["length"] extends N ? R : _FixedTupleOf<T, N, [T, ...R]>;
export type FixedTuple<T, N extends number> = N extends N ? (number extends N ? T[] : _FixedTupleOf<T, N, []>) : never;

const loadJPGData = (jpegBinary: ArrayBuffer): Promise<{ width: number; height: number; data: Uint8ClampedArray }> => {
    const img = document.createElement("img");
    img.crossOrigin = "anonymous";
    const url = window.URL.createObjectURL(new Blob([new Uint8Array(jpegBinary)], { type: "image/jpg" }));
    img.src = url;

    return new Promise<ImageData>((resolve, reject) => {
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(img, 0, 0);
            resolve(ctx.getImageData(0, 0, img.width, img.height));
            window.URL.revokeObjectURL(url);
        };
        img.onerror = (err) => {
            reject(err);
            window.URL.revokeObjectURL(url);
        };
    });
};

export const decodeImage = async (path: string, imageBytes: ArrayBufferLike): Promise<Texture | null> => {
    const extension = path.toLowerCase().split(".").pop();
    switch (extension) {
        case "tif":
        case "tiff": {
            const result = tifDecode(imageBytes)[0];
            const { width, height, components, size } = result;
            let rgba8: Uint8ClampedArray;
            if (components === 3) {
                const data = [];
                for (let i = 0; i < size; i++) {
                    const [r, g, b] = result.data.slice(i * 3, (i + 1) * 3);
                    data.push(r, g, b, 0xff);
                }
                rgba8 = new Uint8ClampedArray(data);
            } else {
                rgba8 = new Uint8ClampedArray(result.data);
            }
            return { path, width, height, rgba8 };
        }
        case "jpg":
        case "jpeg": {
            const { width, height, data: rgba8 } = await loadJPGData(imageBytes as ArrayBuffer);
            return { path, width, height, rgba8 };
        }
    }
    return null;
};

export const flipTexture = (texture: Texture): Texture => {
    const data: number[] = [];
    for (let i = 0; i < texture.height; i++) {
        const row = texture.height - 1 - i;
        data.push(...texture.rgba8.subarray(row * texture.width * 4, (row + 1) * texture.width * 4));
    }
    return {
        ...texture,
        rgba8: new Uint8ClampedArray(data),
    };
};

export const createTextureHolder = (textures: Texture[]) =>
    new FakeTextureHolder(
        textures.map((texture) => {
            const { path: name, rgba8, width, height } = texture;
            const canvas = document.createElement("canvas");
            [canvas.width, canvas.height] = [width, height];
            const ctx = canvas.getContext("2d")!;
            const imageData = ctx.createImageData(width, height);
            imageData.data.set(rgba8);
            ctx.putImageData(imageData, 0, 0);
            return { name, surfaces: [canvas] };
        }),
    );

export const createSceneNode = (initData: Partial<SceneNode> & { name: string }): SceneNode => ({
    children: [],
    transform: {
        trans: vec3.create(),
        rot: vec3.create(),
        scale: vec3.fromValues(1, 1, 1),
    },
    worldTransform: mat4.create(),
    animates: false,
    loops: false,
    animations: [],
    visible: true,
    worldVisible: true,
    meshes: [],
    ...initData,
    transformChanged: true,
});

export const reparent = (child: SceneNode, newParent: SceneNode) => {
    const index = child.parent?.children.indexOf(child) ?? -1;
    if (index !== -1) {
        child.parent!.children.splice(index, 1);
    }
    child.parent = newParent;
    child.parentName = newParent.name;
    newParent.children.push(child);
};

export const wrapNode = (node: SceneNode, suffix: string = "-wrap"): SceneNode => {
    const { transform } = node;
    const wrapper = createSceneNode({
        name: node.name + suffix,
        transform: {
            trans: vec3.clone(transform.trans),
            rot: [0, 0, 0],
            scale: [1, 1, 1],
        },
    });
    vec3.set(transform.trans, 0, 0, 0);
    if (node.parent !== undefined) {
        const index = node.parent.children.indexOf(node);
        node.parent.children[index] = wrapper;
        wrapper.parentName = node.parentName;
        wrapper.parent = node.parent;
    }
    reparent(node, wrapper);
    return wrapper;
};

export const getParentNodes = (node: SceneNode): SceneNode[] => {
    const parents = [node];
    while (node.parent !== undefined) {
        node = node.parent;
        parents.push(node);
    }
    return parents;
};

export const getDescendants = (node: SceneNode): SceneNode[] => {
    const descendants = new Set<SceneNode>();
    const f = (n: SceneNode) => {
        descendants.add(n);
        n.children.forEach(f);
    };
    f(node);
    return [...descendants];
};

export const createDataBuffer = (device: GfxDevice, usage: GfxBufferUsage, data: ArrayBufferLike, dynamic: boolean = false): GfxBuffer => {
    return device.createBuffer(
        align(data.byteLength, 4) / 4,
        usage,
        dynamic ? GfxBufferFrequencyHint.Dynamic : GfxBufferFrequencyHint.Static,
        new Uint8Array(data, 0, data.byteLength),
    );
};

const scratchModelMatrix = mat4.create();

export const updateNodeTransform = (node: SceneNode, parentChanged: boolean, parentWorldTransform: mat4 | null, animating: boolean) => {
    const shouldUpdate = node.transformChanged || parentChanged || (node.animates && animating);
    node.transformChanged = false;

    if (shouldUpdate) {
        const transform = node.animates ? node.animatedTransform! : node.transform;
        const scratch = scratchModelMatrix;
        mat4.identity(scratch);
        mat4.translate(scratch, scratch, transform.trans);
        mat4.rotateZ(scratch, scratch, transform.rot[2]);
        mat4.rotateY(scratch, scratch, transform.rot[1]);
        mat4.rotateX(scratch, scratch, transform.rot[0]);
        mat4.scale(scratch, scratch, transform.scale);

        mat4.mul(node.worldTransform, parentWorldTransform ?? mat4.create(), scratch);

        node.worldVisible = node.visible && (node.parent?.worldVisible ?? true);
    }
    if (node.children !== null) {
        for (const child of node.children) {
            updateNodeTransform(child, shouldUpdate, node.worldTransform, animating);
        }
    }
};
