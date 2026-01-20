import { mat4, vec3 } from "gl-matrix";
import { createBufferFromData } from "../../gfx/helpers/BufferHelpers.js";
import { setAttachmentStateSimple } from "../../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxShaderLibrary } from "../../gfx/helpers/GfxShaderLibrary.js";
import {
    fillMatrix4x4,
    fillVec4,
} from "../../gfx/helpers/UniformBufferHelpers.js";
import {
    GfxBindingLayoutDescriptor,
    GfxBlendFactor,
    GfxBlendMode,
    GfxBuffer,
    GfxBufferFrequencyHint,
    GfxBufferUsage,
    GfxCullMode,
    GfxDevice,
    GfxFormat,
    GfxFrontFaceMode,
    GfxIndexBufferDescriptor,
    GfxInputLayout,
    GfxInputLayoutBufferDescriptor,
    GfxMegaStateDescriptor,
    GfxMipFilterMode,
    GfxProgram,
    GfxSampler,
    GfxTexFilterMode,
    GfxVertexAttributeDescriptor,
    GfxVertexBufferDescriptor,
    GfxVertexBufferFrequency,
    GfxWrapMode,
} from "../../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache.js";
import { GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../../Program.js";
import { TextureMapping } from "../../TextureHolder.js";
import * as Viewer from "../../viewer.js";
import { DescentAssetCache } from "../Common/AssetCache.js";
import {
    DescentMovementType,
    DescentObject,
    DescentObjectRenderTypePolyobj,
    DescentObjectType,
    DescentRenderType,
} from "../Common/LevelObject.js";
import {
    DescentPolymodelMesh,
    makePolymodelMesh,
} from "../Common/Polymodel.js";
import { DescentTextureList, ResolvedTexture } from "../Common/TextureList.js";
import { MultiMap } from "../Common/Util.js";
import { Descent1Level } from "../D1/D1Level.js";
import { Descent2Level } from "../D2/D2Level.js";
import { DescentRenderParameters } from "./RenderParameters.js";

class DescentPolymodelProgram extends DeviceProgram {
    public static bindingLayouts: GfxBindingLayoutDescriptor[] = [
        { numUniformBuffers: 2, numSamplers: 1 },
    ];

    public static a_xyz = 0;
    public static a_norm = 1;
    public static a_uvl = 2;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}
precision highp float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_matProjection;
    Mat4x4 u_matView;
    vec4 u_cameraPos;
    float u_minLight;
    float u_cloakVis;
};

layout(std140) uniform ub_ObjectParams {
    Mat4x4 u_matModel;
    float u_segmentLight;
    float u_glow;
    float u_isTextured;
    float u_isCloaked;
};

layout(binding = 0) uniform sampler2D u_sampler;
`;

    public override vert = `
layout (location = ${DescentPolymodelProgram.a_xyz}) in vec3 a_xyz;
layout (location = ${DescentPolymodelProgram.a_norm}) in vec3 a_norm;
layout (location = ${DescentPolymodelProgram.a_uvl}) in vec3 a_uvl;

out vec3 v_uvl;
out float v_light;

void main() {
    mat4 t_matModel = UnpackMatrix(u_matModel);
    mat4 t_matView = UnpackMatrix(u_matView);
    vec4 t_mxyz = t_matModel * vec4(a_xyz, 1.0);
    vec4 t_xyz = t_matView * t_mxyz;
    gl_Position = UnpackMatrix(u_matProjection) * t_xyz;

    vec3 t_look = normalize(u_cameraPos.xyz - t_mxyz.xyz); 
    vec3 t_norm = normalize(mat3(t_matModel) * a_norm);
    float t_normLight = 0.25 + 0.75 * max(dot(t_look, t_norm), 0.0);
    v_uvl = a_uvl;
    v_light = mix(1.0/33.0, 1.0, clamp(max(max(u_segmentLight * t_normLight, u_minLight), v_uvl.z), 0.0, 1.0));
}
`;

    public override frag = `
in vec3 v_uvl;
in float v_light;

void main() {
    if (u_isTextured == 0.0) {
        gl_FragColor = vec4(v_uvl.xyz * v_light, 1.0);
    } else if (u_isCloaked != 0.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, u_cloakVis);
    } else {
        vec4 t_color = texture(SAMPLER_2D(u_sampler), v_uvl.xy).rgba;
        if (t_color.a < 0.5) discard;
        gl_FragColor = vec4(t_color.xyz * v_light, 1.0);
    }
}
`;

    constructor() {
        super();
    }
}

type MeshObjectMatrices = {
    current: mat4;
    angularVelocity: vec3 | null;
};

type MeshObjectCall = {
    indexOffset: number;
    indexCount: number;
    modelMatrix: MeshObjectMatrices;
    segmentNum: number;
    isCloaked: boolean;
    glow: number;
    position: vec3;
    radius: number;
};

type MeshTextureCall = {
    texture: ResolvedTexture | null;
    calls: MeshObjectCall[];
};

type MeshCallCollection = {
    vertices: Float32Array;
    indices: Uint16Array;
    calls: MeshTextureCall[];
    objectMatrices: MeshObjectMatrices[];
};

function makeObjectMatrices(object: DescentObject) {
    const pos = object.position;
    const ori = object.orientation;
    const current = mat4.fromValues(
        ori[0],
        ori[1],
        -ori[2],
        0,
        ori[3],
        ori[4],
        -ori[5],
        0,
        -ori[6],
        -ori[7],
        ori[8],
        0,
        pos[0],
        pos[1],
        -pos[2],
        1,
    );
    let angularVelocity = null;
    if (object.type === DescentObjectType.WEAPON) {
        const physics = object.movementType;
        if (physics.type === DescentMovementType.PHYSICS) {
            angularVelocity = physics.angular_velocity;
        }
    }
    return { current, angularVelocity };
}

function getPolymodelMeshVisibilityRadius(mesh: DescentPolymodelMesh): number {
    let radiusSquared = 0;
    for (const vertex of mesh.vertices) {
        radiusSquared = Math.max(
            radiusSquared,
            vec3.squaredLength(vertex.position),
        );
    }
    return Math.sqrt(radiusSquared);
}

function buildMeshCollection(
    level: Descent1Level | Descent2Level,
    textureList: DescentTextureList,
    assetCache: DescentAssetCache,
): MeshCallCollection {
    const palette = assetCache.palette;
    // First, group objects by polymodel ID
    const objectsGrouped = new MultiMap<number, DescentObject>();
    for (const object of level.objects) {
        const render = object.renderType;
        if (
            level.objectShouldBeVisible(object) &&
            render.type === DescentRenderType.POLYOBJ
        ) {
            objectsGrouped.add(render.model_num, object);
        }
    }

    const vertices: number[][] = [];
    const indices: number[] = [];
    const meshObjectCallsByObjectBitmap = new MultiMap<
        number,
        MeshObjectCall
    >();
    const meshObjectCallsByOverriddenTexture = new MultiMap<
        number,
        MeshObjectCall
    >();
    const objectMatrices = new Map<DescentObject, MeshObjectMatrices>();

    // Then bake polymodel meshes.
    for (const [modelNum, objects] of objectsGrouped.entries()) {
        const model = assetCache.getPolymodel(modelNum);
        if (model !== null) {
            const mesh = makePolymodelMesh(
                model,
                level.gameVersion === 1 ? palette : null,
            );
            const radius = getPolymodelMeshVisibilityRadius(mesh);
            // Group calls by texture.
            // Texture switches are slower than uniform switches,
            // so we will switch texture first, model matrix second.

            const vertexBase = vertices.length;
            for (const vertex of mesh.vertices)
                vertices.push([
                    vertex.position[0],
                    vertex.position[1],
                    -vertex.position[2],
                    vertex.normal[0],
                    vertex.normal[1],
                    -vertex.normal[2],
                    vertex.rgb_uvl[0],
                    vertex.rgb_uvl[1],
                    vertex.rgb_uvl[2],
                ]);

            for (const sourceCall of mesh.calls) {
                const objectTextureIndex = sourceCall.texture;
                const objectBitmapId =
                    objectTextureIndex !== null
                        ? assetCache.resolveObjectBitmap(
                              model,
                              objectTextureIndex,
                          )
                        : null;
                const objectBitmapKey = objectBitmapId ?? -1;

                const indexOffset = indices.length;
                for (const index of sourceCall.indices)
                    indices.push(index + vertexBase);
                const indexCount = indices.length - indexOffset;

                for (const object of objects) {
                    const render =
                        object.renderType as DescentObjectRenderTypePolyobj;

                    let objectMatrix = objectMatrices.get(object);
                    if (objectMatrix === undefined)
                        objectMatrices.set(
                            object,
                            (objectMatrix = makeObjectMatrices(object)),
                        );

                    let glow =
                        object.type === DescentObjectType.ROBOT
                            ? (assetCache.getRobotInfo(object.subtypeId)
                                  ?.glow ?? 0)
                            : 0;

                    const isCloaked =
                        object.type === DescentObjectType.ROBOT &&
                        assetCache.getRobotInfo(object.subtypeId)?.cloakType ===
                            1 &&
                        render.texture_override === -1;
                    const meshObjectCall = {
                        indexOffset,
                        indexCount,
                        modelMatrix: objectMatrix,
                        segmentNum: object.segmentNum,
                        isCloaked,
                        glow,
                        position: vec3.fromValues(
                            object.position[0],
                            object.position[1],
                            -object.position[2],
                        ),
                        radius,
                    };
                    if (render.texture_override !== -1) {
                        const tmapNum = render.texture_override;
                        meshObjectCallsByOverriddenTexture.add(
                            tmapNum,
                            meshObjectCall,
                        );
                    } else {
                        meshObjectCallsByObjectBitmap.add(
                            objectBitmapKey,
                            meshObjectCall,
                        );
                    }
                }
            }
        }
    }

    // Finally, make up final list of calls.
    const calls: MeshTextureCall[] = [];

    for (const [
        objectBitmapId,
        objectCalls,
    ] of meshObjectCallsByObjectBitmap.entries()) {
        const texture =
            objectBitmapId !== -1
                ? textureList.resolveObjectBitmapToTexture(objectBitmapId)
                : null;
        calls.push({ texture, calls: objectCalls });
    }
    for (const [
        tmapId,
        objectCalls,
    ] of meshObjectCallsByOverriddenTexture.entries()) {
        calls.push({
            texture: textureList.resolveTmapToTexture(tmapId),
            calls: objectCalls,
        });
    }

    return {
        vertices: new Float32Array(vertices.flat()),
        indices: new Uint16Array(indices),
        calls,
        objectMatrices: [...objectMatrices.values()],
    };
}

export class DescentPolymodelRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private inputLayout: GfxInputLayout;
    private gfxProgram: GfxProgram;
    private meshCalls: MeshTextureCall[];
    private gfxSampler: GfxSampler;
    private textureMapping: TextureMapping[];
    public meshes: MeshCallCollection;
    private objectMatrices: MeshObjectMatrices[];
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    constructor(
        device: GfxDevice,
        private level: Descent1Level | Descent2Level,
        private assetCache: DescentAssetCache,
        private textureList: DescentTextureList,
        private cache: GfxRenderCache,
        private renderParameters: DescentRenderParameters,
    ) {
        this.gfxProgram = cache.createProgram(new DescentPolymodelProgram());

        this.meshes = buildMeshCollection(level, this.textureList, assetCache);
        const { vertices, indices, calls, objectMatrices } = this.meshes;
        this.vertexBuffer = createBufferFromData(
            device,
            GfxBufferUsage.Vertex,
            GfxBufferFrequencyHint.Static,
            vertices.buffer,
        );
        this.indexBuffer = createBufferFromData(
            device,
            GfxBufferUsage.Index,
            GfxBufferFrequencyHint.Static,
            indices.buffer,
        );
        this.meshCalls = calls;
        this.objectMatrices = objectMatrices;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            {
                location: DescentPolymodelProgram.a_xyz,
                bufferIndex: 0,
                bufferByteOffset: 0 * 0x04,
                format: GfxFormat.F32_RGB,
            },
            {
                location: DescentPolymodelProgram.a_norm,
                bufferIndex: 0,
                bufferByteOffset: 3 * 0x04,
                format: GfxFormat.F32_RGB,
            },
            {
                location: DescentPolymodelProgram.a_uvl,
                bufferIndex: 0,
                bufferByteOffset: 6 * 0x04,
                format: GfxFormat.F32_RGB,
            },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            {
                byteStride: 9 * 0x04,
                frequency: GfxVertexBufferFrequency.PerVertex,
            },
        ];
        const indexBufferFormat = GfxFormat.U16_R;

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat,
        });
        this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer }];
        this.indexBufferDescriptor = { buffer: this.indexBuffer };

        this.gfxSampler = this.cache.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping = [new TextureMapping()];
        this.textureMapping[0].gfxSampler = this.gfxSampler;

        this.megaStateFlags = {
            cullMode: GfxCullMode.Back,
            frontFace: GfxFrontFaceMode.CW,
        };
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
    }

    public prepareToRender(
        renderInstManager: GfxRenderInstManager,
        viewerInput: Viewer.ViewerRenderInput,
    ): void {
        const template = renderInstManager.pushTemplate();
        const time = viewerInput.time * 0.001;
        const deltaTime = viewerInput.deltaTime * 0.001;
        template.setGfxProgram(this.gfxProgram);
        template.setBindingLayouts(DescentPolymodelProgram.bindingLayouts);
        template.setVertexInput(
            this.inputLayout,
            this.vertexBufferDescriptors,
            this.indexBufferDescriptor,
        );
        template.setMegaStateFlags(this.megaStateFlags);

        let offsetScene = template.allocateUniformBuffer(
            DescentPolymodelProgram.ub_SceneParams,
            4 * 4 * 2 + 8,
        );
        const mappedScene = template.mapUniformBufferF32(
            DescentPolymodelProgram.ub_SceneParams,
        );
        offsetScene += fillMatrix4x4(
            mappedScene,
            offsetScene,
            viewerInput.camera.projectionMatrix,
        );
        offsetScene += fillMatrix4x4(
            mappedScene,
            offsetScene,
            viewerInput.camera.viewMatrix,
        );
        offsetScene += fillVec4(
            mappedScene,
            offsetScene,
            viewerInput.camera.worldMatrix[12],
            viewerInput.camera.worldMatrix[13],
            viewerInput.camera.worldMatrix[14],
            viewerInput.camera.worldMatrix[15],
        );
        mappedScene[offsetScene++] = this.renderParameters.enableShading
            ? 0.0
            : 1.0;
        mappedScene[offsetScene++] = Math.sin(time * 6) * 0.075 + 0.225;

        for (const textureCall of this.meshCalls) {
            const objectTemplate = renderInstManager.pushTemplate();
            const pickedTexture =
                textureCall.texture !== null
                    ? this.textureList.pickTexture(textureCall.texture, time)
                    : null;
            this.textureMapping[0].gfxTexture =
                pickedTexture ?? this.textureList.getTransparentTexture();
            objectTemplate.setSamplerBindingsFromTextureMappings(
                this.textureMapping,
            );

            for (const objectCall of textureCall.calls) {
                if (
                    !viewerInput.camera.frustum.containsSphere(
                        objectCall.position,
                        objectCall.radius,
                    )
                )
                    continue;

                const renderInst = renderInstManager.newRenderInst();
                let offsetObject = renderInst.allocateUniformBuffer(
                    DescentPolymodelProgram.ub_ObjectParams,
                    4 * 4 + 4,
                );
                const mappedObject = renderInst.mapUniformBufferF32(
                    DescentPolymodelProgram.ub_ObjectParams,
                );
                offsetObject += fillMatrix4x4(
                    mappedObject,
                    offsetObject,
                    objectCall.modelMatrix.current,
                );
                mappedObject[offsetObject++] =
                    this.level.segments[objectCall.segmentNum].light ?? 1.0;
                mappedObject[offsetObject++] = objectCall.glow;
                mappedObject[offsetObject++] =
                    pickedTexture !== null ? 1.0 : 0.0;
                mappedObject[offsetObject++] = objectCall.isCloaked ? 1.0 : 0.0;
                renderInst.setDrawCount(
                    objectCall.indexCount,
                    objectCall.indexOffset,
                );
                renderInstManager.submitRenderInst(renderInst);
            }
            renderInstManager.popTemplate();
        }

        renderInstManager.popTemplate();

        // Rotate objects
        const rotMul = deltaTime * 2 * Math.PI;
        for (const matrices of this.objectMatrices) {
            if (matrices.angularVelocity !== null) {
                mat4.rotateX(
                    matrices.current,
                    matrices.current,
                    matrices.angularVelocity[0] * rotMul,
                );
                mat4.rotateY(
                    matrices.current,
                    matrices.current,
                    matrices.angularVelocity[1] * rotMul,
                );
                mat4.rotateZ(
                    matrices.current,
                    matrices.current,
                    matrices.angularVelocity[2] * rotMul,
                );
            }
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}
