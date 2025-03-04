import {
  GfxBlendFactor,
  GfxBlendMode,
  GfxBuffer,
  GfxBufferFrequencyHint,
  GfxBufferUsage,
  GfxCullMode,
  GfxDevice,
  GfxFormat, GfxMegaStateDescriptor,
  GfxRenderProgramDescriptor,
  GfxSampler, GfxTexture, GfxTextureDimension,
  GfxTextureUsage, GfxVertexBufferFrequency
} from "../gfx/platform/GfxPlatform.js";
import { TextureHolder } from "../TextureHolder.js";
import { SCX } from './scx/types.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { preprocessProgramObj_GLSL } from '../gfx/shaderc/GfxShaderCompiler.js';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';
import {
  makeAttachmentClearDescriptor,
  makeBackbufferDescSimple,
  standardFullClearRenderPassDescriptor
} from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { Color, colorFromRGBA, colorNewFromRGBA } from '../Color.js';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers.js';
import { mat4, quat, vec3, vec4 } from 'gl-matrix';
import { GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from "../gfx/platform/GfxPlatform.js";
import { Camera, CameraController } from '../Camera.js';
import { defaultMegaState, setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { align } from '../util.js';
import { bakeLights } from './bake_lights.js';
import { Material, Mesh, Texture, SceneNode } from './types.js';
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import Plus4XPProgram from "./program.js";
import { buildNodeAnimations, ChannelAnimation } from "./animation.js";
import * as UI from '../ui.js';
// import sphereScene from "./sphere.js";

type Context = {
  basePath: string,
  scenes: Record<string, SCX.Scene>,
  textures: Texture[],
  envTextures: Texture[],
  envMapRotation: [number, number, number],
  cameras: [string, string][],
};

type UnbakedMesh = {
  node: SceneNode,
  mesh: SCX.Mesh,
  lights: SCX.Light[],
  shader: SCX.Shader,
  diffuseColorBuffer: GfxBuffer,
  sceneName: string
};

export default class Renderer implements SceneGfx {

  private texturesByPath:Record<string, Texture>;
  private envGfxTexture:GfxTexture | null;
  private envMapMatrix = mat4.create();
  private missingTexture: GfxTexture;
  private program: GfxRenderProgramDescriptor;
  private renderHelper: GfxRenderHelper;
  private renderInstListMain = new GfxRenderInstList();
  private ambientColor: Color = colorNewFromRGBA(0, 0, 0);
  private rootNode: SceneNode;
  private materialsByName = new Map<string, Material>();
  private sceneNodesByName = new Map<string | undefined, SceneNode>();
  private renderableNodes: SceneNode[] = [];
  private camerasByName = new Map<string, SCX.Camera>();
  private cameras: [string, string | null][];
  private activeCameraName: string | null = null;
  private lastViewerCameraMatrix: string | null = null;
  private customCamera: Camera;
  private scratchViewMatrix = mat4.create();
  private scratchModelMatrix = mat4.create();
  private scratchWorldInverseTransposeMatrix = mat4.create();
  private diffuseSampler: GfxSampler | null;
  private envSampler: GfxSampler | null;
  private animations: ChannelAnimation[] = [];
  private animating: boolean = true;
  private megaStateFlags: GfxMegaStateDescriptor;

  private cameraSelect: UI.SingleSelect;
  
  constructor(device: GfxDevice, context: Context, public textureHolder: TextureHolder<any>) {

    this.megaStateFlags = {
      ...defaultMegaState,
      cullMode: GfxCullMode.Back
    };
    setAttachmentStateSimple(this.megaStateFlags, {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.SrcAlpha,
        blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
    });

    this.renderHelper = new GfxRenderHelper(device);
    this.program = preprocessProgramObj_GLSL(device, new Plus4XPProgram());

    const samplerDescriptor = {
      wrapS: GfxWrapMode.Repeat,
      wrapT: GfxWrapMode.Repeat,
      minFilter: GfxTexFilterMode.Bilinear,
      magFilter: GfxTexFilterMode.Bilinear,
      mipFilter: GfxMipFilterMode.NoMip
    };
    this.diffuseSampler = device.createSampler(samplerDescriptor);
    this.envSampler = device.createSampler(samplerDescriptor);

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
    mat4.fromQuat(this.envMapMatrix, quat.fromEuler(quat.create(), ...context.envMapRotation));
    
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

    const unbakedMeshes: UnbakedMesh[] = [];
    // this.buildScene(device, "Sphere", sphereScene, unbakedMeshes);

    for (const [name, scene] of Object.entries(context.scenes)) {
      this.buildScene(device, name, scene, unbakedMeshes);
    }

    this.customCamera = new Camera();
    this.cameras = [["FreeCam", null], ...context.cameras];

    // parent the scene nodes
    for (const sceneNode of this.sceneNodesByName.values()) {
      sceneNode.parent = this.sceneNodesByName.get(sceneNode.parentName) ?? this.rootNode;
      sceneNode.parent.children.push(sceneNode);
    }

    this.renderableNodes = [...this.sceneNodesByName.values()].filter(node => node.meshes.length ?? 0 > 0);

    this.updateNodeTransform(this.rootNode, false, null);
    
    const transformedLightsBySceneName: Map<string, SCX.Light[]> = new Map();
    const rootTransform = this.rootNode.worldTransform;

    for (const {node, shader, mesh, diffuseColorBuffer, sceneName, lights} of unbakedMeshes) {
      if (!transformedLightsBySceneName.has(sceneName)) {
        transformedLightsBySceneName.set(sceneName, 
          lights.map((light: SCX.Light) : SCX.Light => ({
            ...light,
            pos: light.pos == undefined ? undefined : [...vec3.transformMat4(vec3.create(), light.pos, rootTransform)] as SCX.Vec3,
            dir: light.dir == undefined ? undefined : [...vec4.transformMat4(vec4.create(), [...light.dir, 0], rootTransform)] as SCX.Vec3,
          }))
        );
      }
      const diffuseColors = bakeLights(
        mesh, 
        shader, 
        node.worldTransform, 
        transformedLightsBySceneName.get(sceneName)!
      );
      device.uploadBufferData(diffuseColorBuffer, 0, new Uint8Array(diffuseColors.buffer));
    }
    

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

  private buildScene(device: GfxDevice, sceneName: string, scene: SCX.Scene, unbakedMeshes:UnbakedMesh[] ) {
    
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

        const lights: SCX.Light[] = [
          {
            type: "ambient",
            name: 'ambient',
            color: scene.globals[0].ambient,
          } as SCX.Light,
          ...scene.lights.values()
        ];
        
        unbakedMeshes.push({ node, mesh, shader: material.shader, diffuseColorBuffer, sceneName, lights });

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

  public createPanels(): UI.Panel[] {
    const cameraPanel = new UI.Panel();
    cameraPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
    cameraPanel.setTitle(UI.EYE_ICON, 'Vantage Points');
    this.cameraSelect = new UI.SingleSelect();
    this.cameraSelect.setStrings(this.cameras.map(a => a[0]));
    this.cameraSelect.onselectionchange = (strIndex: number) => {
      const choice = this.cameras[strIndex];
      this.activeCameraName = choice[1];
      this.lastViewerCameraMatrix = null;
    };
    this.cameraSelect.selectItem(1); // TODO: persist through serialize/deserialize
    cameraPanel.contents.appendChild(this.cameraSelect.elem);
    
    return [cameraPanel];
  }

  /*
  serializeSaveState?(dst: ArrayBuffer, offs: number): number {}
  deserializeSaveState?(src: ArrayBuffer, offs: number, byteLength: number): number {}
  onstatechanged?: (() => void) | undefined;
  */
 
  render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
    const {deltaTime} = viewerInput;
    this.animating = deltaTime > 0;

    // TODO: update the sim
    
    this.animations.forEach(anim => anim(deltaTime / 1000));
    
    const renderInstManager = this.renderHelper.renderInstManager;
    const builder = this.renderHelper.renderGraph.newGraphBuilder();

    const renderPassDescriptor = makeAttachmentClearDescriptor(this.ambientColor);
    const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, renderPassDescriptor);
    const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

    const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
    const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
    builder.pushPass((pass) => {
        pass.setDebugName('Main');
        pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
        pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
        pass.exec((passRenderer) => {
            this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
        });
    });
    this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
    builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);
    this.prepareToRender(device, viewerInput, renderInstManager);
    this.renderHelper.renderGraph.execute(builder);
    this.renderInstListMain.reset();
  }

  // count = 0;

  private prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput, renderInstManager: GfxRenderInstManager) {

    // if (this.count >= 10) {
    //   return;
    // }
    // this.count++;

    const template = this.renderHelper.pushTemplateRenderInst();
    template.setBindingLayouts(Plus4XPProgram.bindingLayouts);
    const gfxProgram = renderInstManager.gfxRenderCache.createProgramSimple(this.program);
    template.setGfxProgram(gfxProgram);
    template.setMegaStateFlags(this.megaStateFlags);

    this.updateNodeTransform(this.rootNode, false, null);

    const cameraViewMatrix: mat4 = mat4.create();
    
    updateCameraParams: {
      let cameraOffset = template.allocateUniformBuffer(Plus4XPProgram.ub_CameraParams, 16 * 3 /*3 Mat4x4*/);
      const cameraBuffer = template.mapUniformBufferF32(Plus4XPProgram.ub_CameraParams);

      this.lastViewerCameraMatrix ??= [...viewerInput.camera.worldMatrix].join("_");
      
      if (this.activeCameraName != null) {
        
        const camera: SCX.Camera = this.camerasByName.get(this.activeCameraName)!;
        const cameraNode: SceneNode = this.sceneNodesByName.get(this.activeCameraName)!;
        
        this.customCamera.clipSpaceNearZ = viewerInput.camera.clipSpaceNearZ;
        this.customCamera.setPerspective(
          camera.fov,
          viewerInput.camera.aspect,
          camera.nearclip,
          camera.farclip
        );
        
        const cameraWorldPos = mat4.getTranslation(vec3.create(), cameraNode.worldTransform);
        const targetWorldPos = vec3.transformMat4(vec3.create(), camera.targetpos, this.rootNode.worldTransform);
        const relativePos = vec3.sub(vec3.create(), targetWorldPos, cameraWorldPos);
        mat4.fromTranslation(this.scratchViewMatrix, cameraWorldPos);
        mat4.rotateY(this.scratchViewMatrix, this.scratchViewMatrix, 
          -Math.PI / 2 - Math.atan2(relativePos[2], relativePos[0])
        );
        mat4.rotateX(this.scratchViewMatrix, this.scratchViewMatrix, Math.atan2(relativePos[1], Math.sqrt(
          relativePos[0] ** 2 +
          relativePos[2] ** 2
        )));
        
        if (this.activeCameraName != null && this.lastViewerCameraMatrix !== [...viewerInput.camera.worldMatrix].join("_")) {
          this.cameraSelect.selectItem(0);
          mat4.copy(viewerInput.camera.worldMatrix, this.scratchViewMatrix);
          viewerInput.camera.worldMatrixUpdated();
          cameraOffset += fillMatrix4x4(cameraBuffer, cameraOffset, viewerInput.camera.projectionMatrix);
        } else {
          cameraOffset += fillMatrix4x4(cameraBuffer, cameraOffset, this.customCamera.projectionMatrix);
        }
        mat4.invert(this.scratchViewMatrix, this.scratchViewMatrix);
        cameraOffset += fillMatrix4x4(cameraBuffer, cameraOffset, this.scratchViewMatrix);
        mat4.copy(cameraViewMatrix, this.scratchViewMatrix);
      } else {
        cameraOffset += fillMatrix4x4(cameraBuffer, cameraOffset, viewerInput.camera.projectionMatrix);
        cameraOffset += fillMatrix4x4(cameraBuffer, cameraOffset, viewerInput.camera.viewMatrix);
        mat4.copy(cameraViewMatrix, viewerInput.camera.viewMatrix);
      }

      mat4.invert(this.scratchViewMatrix, cameraViewMatrix);
      cameraOffset += fillMatrix4x4(cameraBuffer, cameraOffset, this.scratchViewMatrix);
    }

    this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);

    renderSimulation: {
      // TODO: render any sim-related stuff, ie. mercury pool and sand runtime texture
    }
    
    renderSceneNodeMeshes: {
      for (const node of this.renderableNodes) {        
        for (const mesh of node.meshes!) {  
          
          renderMesh: {
            const renderInst = renderInstManager.newRenderInst();  
            updateObjectParams: {
              let objectOffset = renderInst.allocateUniformBuffer(Plus4XPProgram.ub_ObjectParams, 16 * 3 + 4 /*Mat4x3 * 3 + vec4*/);
              const object = renderInst.mapUniformBufferF32(Plus4XPProgram.ub_ObjectParams);
              objectOffset += fillMatrix4x4(object, objectOffset, node.worldTransform);

              mat4.invert(this.scratchWorldInverseTransposeMatrix, node.worldTransform);
              mat4.transpose(this.scratchWorldInverseTransposeMatrix, this.scratchWorldInverseTransposeMatrix);
              objectOffset += fillMatrix4x4(object, objectOffset, this.scratchWorldInverseTransposeMatrix);

              objectOffset += fillMatrix4x4(object, objectOffset, this.envMapMatrix);

              {
                object[objectOffset] = mesh.material.gfxTexture == null ? 1 : 0;
                objectOffset++;
              }
            }
            
            renderInst.setSamplerBindingsFromTextureMappings([
              {
                gfxTexture: mesh.material.gfxTexture ?? this.missingTexture,
                gfxSampler: this.diffuseSampler,
                lateBinding: null
              },
              {
                gfxTexture: this.envGfxTexture ?? this.missingTexture,
                gfxSampler: this.envSampler,
                lateBinding: null
              }
            ]);
            
            renderInst.setVertexInput(
              mesh.inputLayout,
              mesh.vertexBufferDescriptors, 
              mesh.indexBufferDescriptor
            );
          
            renderInst.setDrawCount(mesh.indexCount);
            renderInstManager.submitRenderInst(renderInst);
          }
        }
      }
    }

    renderInstManager.popTemplate();
    this.renderHelper.prepareToRender();
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
    if (this.diffuseSampler != null) {
      device.destroySampler(this.diffuseSampler);
    }
    this.diffuseSampler = null;
    if (this.envSampler != null) {
      device.destroySampler(this.envSampler);
    }
    this.envSampler = null;
    this.sceneNodesByName.clear();
    this.renderableNodes.length = 0;
    this.camerasByName.clear();
    this.rootNode.children = [];
  }
}