import {
  GfxBufferFrequencyHint,
  GfxBufferUsage, GfxDevice,
  GfxFormat, GfxTexture, GfxTextureDimension,
  GfxTextureUsage, GfxVertexBufferFrequency
} from "../gfx/platform/GfxPlatform.js";
import { TextureHolder } from "../TextureHolder.js";
import { SCX } from './scx/types.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { Color, colorNewFromRGBA } from '../Color.js';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers.js';
import { mat4, vec3 } from 'gl-matrix';
import { CameraController } from '../Camera.js';
import { align } from '../util.js';
import { Material, Mesh, Texture, SceneNode } from './types.js';
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { buildNodeAnimations, ChannelAnimation } from "./animation.js";

type Context = {
  basePath: string,
  scenes: Record<string, SCX.Scene>,
  textures: Texture[],
  envTextures: Texture[],
  cameras: [string, string][],
};

export default class Renderer implements SceneGfx {

  private texturesByPath:Record<string, Texture>;
  private envGfxTexture:GfxTexture | null;
  private missingTexture: GfxTexture;
  private renderHelper: GfxRenderHelper;
  private ambientColor: Color = colorNewFromRGBA(0, 0, 0);
  private rootNode: SceneNode;
  private materialsByName = new Map<string, Material>();
  private sceneNodesByName = new Map<string | undefined, SceneNode>();
  private renderableNodes: SceneNode[] = [];
  private camerasByName = new Map<string, SCX.Camera>();
  private scratchModelMatrix = mat4.create();
  private animations: ChannelAnimation[] = [];
  private animating: boolean = true;
  
  constructor(device: GfxDevice, context: Context, public textureHolder: TextureHolder<any>) {

    this.renderHelper = new GfxRenderHelper(device);
    
    this.texturesByPath = Object.fromEntries(
      context.textures.map(texture => ([texture.path, texture]))
    );

    const firstEnvTexture = context.envTextures[0];
    if (firstEnvTexture != null) {
      this.envGfxTexture = device.createTexture({
        ...firstEnvTexture,
        dimension: GfxTextureDimension.n2D,
        pixelFormat: GfxFormat.U8_RGBA_NORM,
        depthOrArrayLayers: 1,
        numLevels: 1,
        usage:  GfxTextureUsage.Sampled,
      });
      device.uploadTextureData(this.envGfxTexture, 0, [firstEnvTexture.rgba8]);
    }
    
    this.rootNode = {
      name: "root",
      children: [],
      transform: {
        trans: vec3.create(),
        rot: vec3.fromValues(-Math.PI / 2, 0, 0),
        scale: vec3.fromValues(1, 1, 1)
      },
      worldTransform: mat4.create(),
      transformChanged: true,
      animates: false,
      meshes: []
    };

    for (const [name, scene] of Object.entries(context.scenes)) {
      this.buildScene(device, name, scene);
    }

    // parent the scene nodes
    for (const sceneNode of this.sceneNodesByName.values()) {
      sceneNode.parent = this.sceneNodesByName.get(sceneNode.parentName) ?? this.rootNode;
      sceneNode.parent.children.push(sceneNode);
    }

    this.renderableNodes = [...this.sceneNodesByName.values()].filter(node => node.meshes.length ?? 0 > 0);

    this.updateNodeTransform(this.rootNode, false, null);
    
    const requiredTextures = new Map();
    for (const material of this.materialsByName.values()) {

      const texture = (material.shader.texture == null) 
        ? null 
        : this.texturesByPath[material.shader.texture.replaceAll("\\", "/")];

      if (texture == null) {
        continue;
      }

      const texturePath = texture.path;
      if (!requiredTextures.has(texturePath)) {
        const gfxTexture = device.createTexture({
          ...texture,
          dimension: GfxTextureDimension.n2D,
          pixelFormat: GfxFormat.U8_RGBA_NORM,
          depthOrArrayLayers: 1,
          numLevels: 1,
          usage:  GfxTextureUsage.Sampled,
        });
        device.uploadTextureData(gfxTexture, 0, [texture.rgba8]);
        requiredTextures.set(texturePath, gfxTexture);
      }
      material.gfxTexture = requiredTextures.get(texture?.path);
    }

    this.missingTexture = device.createTexture({
      width: 1,
      height: 1,
      dimension: GfxTextureDimension.n2D,
      pixelFormat: GfxFormat.U8_RGBA_NORM,
      depthOrArrayLayers: 1,
      numLevels: 1,
      usage:  GfxTextureUsage.Sampled,
    });
    device.uploadTextureData(this.missingTexture, 0, [new Uint8Array([0xFF, 0x00, 0xFF, 0xFF])]);
  }

  private buildScene(device: GfxDevice, sceneName: string, scene: SCX.Scene) {
    
    /*
    for (const {ambient} of scene.globals) {
      colorFromRGBA(this.ambientColor, ...ambient);
    }
    */

    // Create the materials
    for (const shader of scene.shaders) {
      this.materialsByName.set(sceneName + shader.id, {
        shader: shader,
        gfxTexture: null
      });
    }

    // Create camera scene nodes and their animations
    for (const camera of scene.cameras) {
      const cameraName = sceneName + camera.name;
      const sceneNode = {
        name: cameraName,
        transform: {
          trans: vec3.fromValues(...camera.pos),
          rot: vec3.fromValues(Math.PI / 2, 0, 0),
          scale: vec3.fromValues(1, 1, 1)
        },
        children: [],
        worldTransform: mat4.create(),
        transformChanged: true,
        animates: camera.animations != null,
        meshes: []
      };
      this.sceneNodesByName.set(cameraName, sceneNode);
      this.camerasByName.set(cameraName, camera);
      if (camera.animations != null) {
        this.animations.push(...buildNodeAnimations(sceneNode.transform, camera.animations));
      }
    }

    const inputLayout = device.createInputLayout({
      indexBufferFormat: GfxFormat.U32_R,
      vertexAttributeDescriptors: [
          { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0, }, // position
          { location: 1, bufferIndex: 1, format: GfxFormat.F32_RGB, bufferByteOffset: 0, }, // normal
          { location: 2, bufferIndex: 2, format: GfxFormat.F32_RGBA, bufferByteOffset: 0, }, // diffuseColor
          { location: 3, bufferIndex: 3, format: GfxFormat.F32_RG,  bufferByteOffset: 0, }, // texCoord
      ],
      vertexBufferDescriptors: [
          { byteStride: 3*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
          { byteStride: 3*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
          { byteStride: 4*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
          { byteStride: 2*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
      ]
    });

    // Create object scene nodes, their animations, and their meshes
    for (const object of scene.objects) {
      const transform = {
        trans: vec3.create(),
        rot: vec3.fromValues(Math.PI / 2, 0, 0),
        scale: vec3.fromValues(1, 1, 1)
      };
      for (const {trans, rot, scale} of object.transforms) {
          vec3.set(transform.trans, ...trans);
          vec3.set(transform.rot, ...rot);
          vec3.set(transform.scale, ...scale);
      }
      const objectName = sceneName + object.name;
      const meshes: Mesh[] = [];
      const node = {
        name: objectName,
        parentName: object.parent == null ? undefined : sceneName + object.parent,
        parent: this.rootNode,
        children: [],
        transform,
        worldTransform: mat4.create(),
        transformChanged: true,
        animates: object.animations != null,
        meshes
      };
      for (const mesh of object.meshes ?? []) {
        if (mesh.indices.length <= 0) {
          continue;
        }

        const material = this.materialsByName.get(sceneName + mesh.shader);
        if (material == null) {
          console.warn(`Missing shader ${mesh.shader} on mesh in ${object.name} of scene ${sceneName}`);
          continue;
        }

        const a = align;

        const diffuseColorBuffer = device.createBuffer(
          mesh.vertexcount * 4, 
          GfxBufferUsage.Vertex, 
          GfxBufferFrequencyHint.Static
        );
        device.uploadBufferData(diffuseColorBuffer, 0, new Uint8Array(
          new Float32Array(mesh.vertexcount * 4).fill(1).buffer
        ));

        const positionBuffer = makeStaticDataBuffer(
          device, 
          GfxBufferUsage.Vertex, 
          new Float32Array(mesh.positions).buffer
        );

        const normalBuffer = makeStaticDataBuffer(
          device, 
          GfxBufferUsage.Vertex, 
          new Float32Array(mesh.normals).buffer
        );

        const texcoordBuffer = makeStaticDataBuffer(
          device, 
          GfxBufferUsage.Vertex, 
          new Float32Array(mesh.texCoords).buffer
        );

        const vertexBufferDescriptors = [
            { buffer: positionBuffer, byteOffset: 0, },
            { buffer: normalBuffer, byteOffset: 0, },
            { buffer: diffuseColorBuffer, byteOffset: 0, },
            { buffer: texcoordBuffer, byteOffset: 0, },
        ];

        const indexBuffer = makeStaticDataBuffer(
          device, 
          GfxBufferUsage.Index, 
          new Uint32Array(mesh.indices).buffer
        );
        const indexBufferDescriptor = { buffer: indexBuffer, byteOffset: 0 };

        // TODO: lights and light baking

        meshes.push({
          inputLayout,
          vertexBufferDescriptors,
          indexBufferDescriptor,
          indexCount: mesh.indices.length,
          material
        });
      }
      
      this.sceneNodesByName.set(objectName, node);

      if (object.animations != null) {
        this.animations.push(...buildNodeAnimations(node.transform, object.animations));
      }
    }
  }

  public adjustCameraController(c: CameraController) {
    c.setSceneMoveSpeedMult(0.04);
  }

  render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
    const {deltaTime} = viewerInput;
    this.animating = deltaTime > 0;

    // TODO: update the sim
    
    this.animations.forEach(anim => anim(deltaTime / 1000));
    
    // TODO: prepareToRender
  }

  private updateNodeTransform(node: SceneNode, parentChanged: boolean, parentWorldTransform: mat4 | null) {
    const shouldUpdate = node.transformChanged || parentChanged || (node.animates && this.animating);
    node.transformChanged = false;

    if (shouldUpdate) {
      const scratch = this.scratchModelMatrix;
      mat4.identity(scratch);
      mat4.translate(scratch, scratch, node.transform.trans);
      mat4.rotateZ(scratch, scratch, node.transform.rot[2]);
      mat4.rotateY(scratch, scratch, node.transform.rot[1]);
      mat4.rotateX(scratch, scratch, node.transform.rot[0]);
      mat4.scale(scratch, scratch, node.transform.scale);

      mat4.mul(
        node.worldTransform,
        parentWorldTransform ?? mat4.create(),
        scratch,
      );
    }
    if (node.children != null) {
      for (const child of node.children) {
        this.updateNodeTransform(child, shouldUpdate, node.worldTransform);
      }
    }
  }

  destroy(device: GfxDevice): void {
    this.textureHolder.destroy(device);
    this.renderHelper.destroy();
    this.animations = [];
    for (const material of this.materialsByName.values()) {
      if (material.gfxTexture != null) {
        device.destroyTexture(material.gfxTexture);
        material.gfxTexture = null;
      }
    }
    this.materialsByName.clear();
    for (const node of this.sceneNodesByName.values()) {
      if (node.meshes == null || node.meshes.length === 0) {
        continue;
      }
      for (const {buffer} of node.meshes[0].vertexBufferDescriptors) {
        device.destroyBuffer(buffer);
      }
      for (const mesh of node.meshes) {
        device.destroyBuffer(mesh.indexBufferDescriptor.buffer);
      }
    }
    this.sceneNodesByName.clear();
    this.renderableNodes.length = 0;
    this.camerasByName.clear();
    this.rootNode.children = [];
  }
}