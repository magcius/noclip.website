import { mat4, vec2, vec3, vec4 } from "gl-matrix";
import type { BAMFile } from "../BAMFile";
import {
  DecalEffect,
  DepthWriteAttrib,
  DepthWriteMode,
  GeomNode,
  ModelNode,
  PreserveTransform,
  Texture,
  TextureAttrib,
  TransformState,
} from "../nodes";
import type { PandaNode } from "../nodes/PandaNode";
import type { ToontownResourceLoader } from "../Resources";
import type { DecodedImage } from "../Textures";
import type { TextFont } from "../text";
import { TextNode } from "../text";
import { DNASignBaseline } from "./DNASignBaseline";
import type { DNAStorage } from "./Storage";
import type {
  DNAAnimBuilding,
  DNAAnimProp,
  DNABaseline,
  DNACornice,
  DNADoor,
  DNAFile,
  DNAFlatBuilding,
  DNAFlatDoor,
  DNAGroup,
  DNAInteractiveProp,
  DNALandmarkBuilding,
  DNANode,
  DNANodeTransform,
  DNAProp,
  DNASign,
  DNASignGraphic,
  DNASignText,
  DNAStreet,
  DNAVisGroup,
  DNAWall,
  DNAWindows,
} from "./types";

/**
 * Build a TransformState from DNA transform properties
 */
function buildTransformState(transform: DNANodeTransform): TransformState {
  return TransformState.fromPosHprScale(
    transform.pos,
    transform.hpr,
    transform.scale,
  );
}

/**
 * DNASceneBuilder traverses DNA scene graph and collects geometry instances
 */
export class DNASceneBuilder {
  private modelCache: Map<string, BAMFile> = new Map();
  private textureCache: Map<string, DecodedImage> = new Map();
  private missingCodes: Set<string> = new Set();

  constructor(
    private storage: DNAStorage,
    private loader: ToontownResourceLoader,
  ) {}

  /**
   * Build the scene from a DNA file
   */
  async build(dnaFile: DNAFile, scene: PandaNode): Promise<void> {
    this.missingCodes.clear();

    // Preload all required models
    await this.preloadModels();

    // Traverse the DNA scene graph
    for (const node of dnaFile.root) {
      this.visitNode(node, scene);
    }

    if (this.missingCodes.size > 0) {
      console.warn(
        `Missing ${this.missingCodes.size} DNA codes:`,
        Array.from(this.missingCodes),
      );
    }
  }

  /**
   * Preload all BAM models referenced by the storage
   */
  private async preloadModels(): Promise<void> {
    const modelPaths = this.storage.getRequiredModelPaths();
    const texturePaths = this.storage.getRequiredTextures();
    const fontPaths = this.storage.getRequiredFontPaths();
    console.log(
      `Preloading ${modelPaths.size} BAM models, ${texturePaths.size} textures, ${fontPaths.length} fonts`,
    );

    const loadPromises: Promise<void>[] = [];
    for (const path of modelPaths) {
      if (!this.modelCache.has(path)) {
        loadPromises.push(this.loadModel(path));
      }
    }
    for (const path of texturePaths) {
      if (!this.textureCache.has(path)) {
        loadPromises.push(this.loadTexture(path));
      }
    }
    if (fontPaths.length > 0) {
      loadPromises.push(this.storage.loadFonts(this.loader));
    }

    await Promise.all(loadPromises);
    console.log(
      `Loaded ${this.modelCache.size} BAM models and ${this.textureCache.size} textures`,
    );
  }

  /**
   * Load a single BAM model
   */
  private async loadModel(path: string): Promise<void> {
    try {
      const bamFile = await this.loader.loadModel(path);
      this.modelCache.set(path, bamFile);
    } catch (e) {
      console.warn(`Failed to load model ${path}:`, e);
    }
  }

  /**
   * Load a single texture
   */
  private async loadTexture(path: string): Promise<void> {
    try {
      const texture = await this.loader.loadTexture(path, null, null);
      this.textureCache.set(path, texture);
    } catch (e) {
      console.warn(`Failed to load texture ${path}:`, e);
    }
  }

  /**
   * Visit a DNA node and collect geometry
   */
  private visitNode(node: DNANode, parentNode: PandaNode): void {
    switch (node.type) {
      case "group":
        this.visitGroup(node, parentNode);
        break;
      case "visgroup":
        this.visitVisGroup(node, parentNode);
        break;
      case "prop":
        this.visitProp(node, parentNode);
        break;
      case "anim_prop":
        this.visitAnimProp(node, parentNode);
        break;
      case "interactive_prop":
        this.visitInteractiveProp(node, parentNode);
        break;
      case "street":
        this.visitStreet(node, parentNode);
        break;
      case "landmark_building":
        this.visitLandmarkBuilding(node, parentNode);
        break;
      case "anim_building":
        this.visitAnimBuilding(node, parentNode);
        break;
      case "flat_building":
        this.visitFlatBuilding(node, parentNode);
        break;
      case "door":
        this.visitDoor(node, parentNode);
        break;
      case "flat_door":
        this.visitFlatDoor(node, parentNode);
        break;
      case "sign":
        this.visitSign(node, parentNode);
        break;
      case "node":
        this.visitGenericNode(node, parentNode);
        break;
      default:
        console.warn(`Unknown node type: ${(node as DNANode).type}`);
        break;
    }
  }

  private visitGroup(node: DNAGroup, parentNode: PandaNode): void {
    const thisNode = parentNode.attachNewNode(node.name);
    for (const child of node.children) {
      this.visitNode(child, thisNode);
    }
  }

  private visitVisGroup(node: DNAVisGroup, parentNode: PandaNode): void {
    const thisNode = parentNode.attachNewNode(node.name);
    thisNode.tags.set("DNAType", "DNAVisGroup"); // custom
    // TODO rest of VisGroup handling
    for (const child of node.children) {
      this.visitNode(child, thisNode);
    }
  }

  private visitGenericNode(
    node: DNANode & DNANodeTransform & { children: DNANode[] },
    parentNode: PandaNode,
  ): void {
    const thisNode = parentNode.attachNewNode(node.name);
    thisNode.transform = buildTransformState(node);
    for (const child of node.children) {
      this.visitNode(child, thisNode);
    }
  }

  private visitProp(node: DNAProp, parentNode: PandaNode): void {
    const thisNode = this.addGeometryFromCode(node.code, parentNode);
    if (!thisNode) return;
    thisNode.name = node.name;
    thisNode.transform = buildTransformState(node);
    if (node.color) thisNode.setColorScale(node.color);
    for (const child of node.children) {
      this.visitNode(child, thisNode);
    }
  }

  /**
   * Visit an animated prop node
   */
  private visitAnimProp(node: DNAAnimProp, parentNode: PandaNode): void {
    const thisNode = this.addGeometryFromCode(node.code, parentNode);
    if (!thisNode) return;
    thisNode.name = node.name;
    thisNode.transform = buildTransformState(node);
    thisNode.tags.set("DNAAnim", node.anim);
    if (node.color) thisNode.setColorScale(node.color);
    for (const child of node.children) {
      this.visitNode(child, thisNode);
    }
  }

  /**
   * Visit an interactive prop node
   */
  private visitInteractiveProp(
    node: DNAInteractiveProp,
    parentNode: PandaNode,
  ): void {
    const thisNode = this.addGeometryFromCode(node.code, parentNode);
    if (!thisNode) return;
    thisNode.name = node.name;
    thisNode.transform = buildTransformState(node);
    thisNode.tags.set("DNAAnim", node.anim);
    thisNode.tags.set("DNACellIndex", node.cellId.toString());
    if (node.color) thisNode.setColorScale(node.color);

    // TODO animation handling

    for (const child of node.children) {
      this.visitNode(child, thisNode);
    }
  }

  /**
   * Visit a street node
   */
  private visitStreet(node: DNAStreet, parentNode: PandaNode): void {
    const thisNode = this.addGeometryFromCode(node.code, parentNode);
    if (!thisNode) return;
    thisNode.name = node.name;
    thisNode.transform = buildTransformState(node);

    const streetTexture = this.storage.findTexture(node.streetTexture);
    const sidewalkTexture = this.storage.findTexture(node.sidewalkTexture);
    const curbTexture = this.storage.findTexture(node.curbTexture as string);

    const streetNode = thisNode.find("**/*_street");
    if (streetNode && streetTexture) {
      const attrib = new TextureAttrib();
      attrib.texture = new Texture();
      attrib.texture.name = node.streetTexture;
      attrib.texture.filename = streetTexture;
      streetNode.setAttrib(attrib, 1);
      if (node.streetColor) streetNode.setColorScale(node.streetColor);
    }

    const sidewalkNode = thisNode.find("**/*_sidewalk");
    if (sidewalkNode && sidewalkTexture) {
      const attrib = new TextureAttrib();
      attrib.texture = new Texture();
      attrib.texture.name = node.sidewalkTexture;
      attrib.texture.filename = sidewalkTexture;
      sidewalkNode.setAttrib(attrib, 1);
      if (node.sidewalkColor) sidewalkNode.setColorScale(node.sidewalkColor);
    }

    const curbNode = thisNode.find("**/*_curb");
    if (curbNode && node.curbTexture && curbTexture) {
      const attrib = new TextureAttrib();
      attrib.texture = new Texture();
      attrib.texture.name = node.curbTexture;
      attrib.texture.filename = curbTexture;
      curbNode.setAttrib(attrib, 1);
      if (node.curbColor) curbNode.setColorScale(node.curbColor);
    }

    // No children to visit
  }

  /**
   * Visit a landmark building node
   */
  private visitLandmarkBuilding(
    node: DNALandmarkBuilding,
    parentNode: PandaNode,
  ): void {
    const thisNode = this.addGeometryFromCode(node.code, parentNode);
    if (!thisNode) return;
    thisNode.name = node.name;
    thisNode.transform = buildTransformState(node);

    // Hide overlapping doors for HQ buildings
    if (node.buildingType === "hq") {
      thisNode.find("**/door_flat_0")?.hide();
      thisNode.find("**/door_flaat_0")?.hide(); // Yes, MM HQs have this
      thisNode.find("**/door_flat_1")?.hide();
    }

    for (const child of node.children) {
      this.visitNode(child, thisNode);
    }
  }

  /**
   * Visit an animated building node
   */
  private visitAnimBuilding(
    node: DNAAnimBuilding,
    parentNode: PandaNode,
  ): void {
    const thisNode = this.addGeometryFromCode(node.code, parentNode);
    if (!thisNode) return;
    thisNode.transform = buildTransformState(node);
    // Building animations are never activated
    // thisNode.tags.set("DNAAnim", node.anim);

    for (const child of node.children) {
      this.visitNode(child, thisNode);
    }
  }

  /**
   * Visit a flat building node
   * Flat buildings are procedurally generated from walls, windows, doors, etc.
   */
  private visitFlatBuilding(
    node: DNAFlatBuilding,
    parentNode: PandaNode,
  ): void {
    const buildingNode = parentNode.attachNewNode(node.name);
    buildingNode.transform = buildTransformState(node);

    // Internal node for walls
    const internalNode = buildingNode.attachNewNode(`${node.name}-internal`);
    internalNode.scale = vec3.fromValues(node.width, 1, 1);

    let currHeight = 0;
    for (const wall of node.walls) {
      this.visitWall(wall, internalNode, currHeight, node);
      currHeight += wall.height;
    }

    for (const child of node.children) {
      this.visitNode(child, buildingNode);
    }
  }

  private visitWall(
    node: DNAWall,
    parentNode: PandaNode,
    currHeight: number,
    building: DNAFlatBuilding,
  ): void {
    const wallNode = this.addGeometryFromCode(node.code, parentNode);
    if (!wallNode) return;
    wallNode.setPosHprScale(
      vec3.fromValues(0, 0, currHeight),
      vec3.create(),
      vec3.fromValues(1, 1, node.height),
    );
    wallNode.setColor(node.color);

    if (node.windows) {
      this.visitWindows(node.windows, wallNode, building, node);
    }

    if (node.cornice) {
      this.visitCornice(node.cornice, wallNode, currHeight, building, node);
    }

    for (const child of node.children) {
      this.visitNode(child, wallNode);
    }
  }

  private visitCornice(
    node: DNACornice,
    parentNode: PandaNode,
    currHeight: number,
    building: DNAFlatBuilding,
    wall: DNAWall,
  ): void {
    const internalNode = parentNode.parent;
    if (!internalNode) throw new Error(`Internal node not found`);

    const corniceNode = this.getNodeByCode(node.code);
    if (!corniceNode) throw new Error(`Cornice code ${node.code} not found`);

    const decalNode = corniceNode.find("**/*_d");
    if (!decalNode)
      throw new Error(`Decal node not found in cornice ${node.code}`);
    const clonedDecalNode = decalNode.clone();
    clonedDecalNode.setPosHprScale(
      vec3.fromValues(0, 0, 1),
      vec3.create(),
      vec3.fromValues(
        1,
        building.width / wall.height,
        building.width / wall.height,
      ),
    );
    clonedDecalNode.setColor(node.color);
    parentNode.addChild(clonedDecalNode);
    parentNode.setEffect(new DecalEffect()); // Render as decal base

    const noDecalNode = corniceNode.find("**/*_nd");
    if (!noDecalNode)
      throw new Error(`NoDecal node not found in cornice ${node.code}`);
    const clonedNoDecalNode = noDecalNode.clone();
    clonedNoDecalNode.setPosHprScale(
      vec3.fromValues(0, 0, currHeight + wall.height),
      vec3.create(),
      vec3.fromValues(1, building.width, building.width),
    );
    clonedNoDecalNode.setColor(node.color);
    internalNode.addChild(clonedNoDecalNode);
  }

  private visitWindows(
    node: DNAWindows,
    wallNode: PandaNode,
    building: DNAFlatBuilding,
    wall: DNAWall,
  ): void {
    if (node.count === 0) return;

    // Calculate base scale from building width (smaller walls get smaller windows)
    let baseScale: number;
    if (building.width <= 5.0) {
      baseScale = 1.0;
    } else if (building.width <= 10.0) {
      baseScale = 1.15;
    } else {
      baseScale = 1.3;
    }

    // Jitter helper for variety
    const jitter = (range: number) => (Math.random() - 0.5) * range;

    // Window positions by count
    const positions = this.getWindowPositions(node.count);

    for (let i = 0; i < node.count; i++) {
      // For 2 windows, use mirrored codes (ul/ur suffix)
      let code = node.code;
      if (node.count === 2) {
        code = code.slice(0, -2) + (i === 0 ? "ur" : "ul");
      }

      const windowNode = this.addGeometryFromCode(code, wallNode);
      if (!windowNode) continue;

      const pos = positions[i];
      const scale = baseScale + jitter(0.025);
      windowNode.setPosHprScale(
        vec3.fromValues(pos[0] + jitter(0.025), 0, pos[1] + jitter(0.025)),
        vec3.fromValues(0, 0, jitter(6.0)),
        vec3.fromValues(scale / building.width, scale, scale / wall.height),
      );
      windowNode.setColor(node.color);
    }

    // Set wall as decal base
    wallNode.setEffect(new DecalEffect());
  }

  private getWindowPositions(count: number): [number, number][] {
    switch (count) {
      case 1:
        return [[0.5, 0.5]];
      case 2:
        return [
          [0.333, 0.5],
          [0.666, 0.5],
        ];
      case 3:
        return [
          [0.33, 0.66],
          [0.5, 0.33],
          [0.66, 0.66],
        ];
      case 4:
        return [
          [0.33, 0.75],
          [0.66, 0.75],
          [0.33, 0.25],
          [0.66, 0.25],
        ];
      default:
        return [];
    }
  }

  private visitDoor(node: DNADoor, parentNode: PandaNode): void {
    let buildingFront = parentNode.find("**/*_front");
    if (!buildingFront) {
      throw new Error(`No front node found in building for door ${node.code}`);
    }
    if (!(buildingFront instanceof GeomNode)) {
      buildingFront = buildingFront.findNodeByType(GeomNode);
      if (!buildingFront) {
        throw new Error(
          `No GeomNode found in front node for door ${node.code}`,
        );
      }
    }
    buildingFront.setEffect(new DecalEffect());
    const doorNode = this.addGeometryFromCode(node.code, buildingFront);
    if (!doorNode) {
      throw new Error(`Door node not found for code ${node.code}`);
    }

    const doorOrigin = parentNode.find("**/*door_origin");
    if (!doorOrigin) {
      throw new Error(`Door origin node not found for door ${node.code}`);
    }

    // const block = this.getBlock(parentNode.name);
    // console.log("block", block);

    doorNode.transform = doorOrigin.transform;
    doorNode.setColor(node.color);

    const doorFrameHoleLeft = doorNode.find("door_*_hole_left");
    if (!doorFrameHoleLeft) {
      throw new Error(
        `Door frame hole left node not found for door ${node.code}`,
      );
    }
    doorFrameHoleLeft.setName("doorFrameHoleLeft");

    const doorFrameHoleRight = doorNode.find("door_*_hole_right");
    if (!doorFrameHoleRight) {
      throw new Error(
        `Door frame hole right node not found for door ${node.code}`,
      );
    }
    doorFrameHoleRight.setName("doorFrameHoleRight");

    const rightDoor = doorNode.find("door_*_right");
    if (!rightDoor) {
      throw new Error(`Right door node not found for door ${node.code}`);
    }
    rightDoor.setName("rightDoor");

    const leftDoor = doorNode.find("door_*_left");
    if (!leftDoor) {
      throw new Error(`Left door node not found for door ${node.code}`);
    }
    leftDoor.setName("leftDoor");

    const doorFrame = doorNode.find("door_*_flat");
    if (doorFrame) {
      doorFrameHoleLeft.reparentTo(doorFrame);
      doorFrameHoleRight.reparentTo(doorFrame);
      doorFrame.setEffect(new DecalEffect());

      // Move 3D doors outside of the decal
      rightDoor.reparentTo(parentNode);
      leftDoor.reparentTo(parentNode);

      // Hide the doors
      rightDoor.hide();
      leftDoor.hide();
    }

    doorFrameHoleLeft.hide();
    doorFrameHoleRight.hide();

    rightDoor.setColor(node.color);
    leftDoor.setColor(node.color);

    doorFrameHoleRight.setColor(vec4.fromValues(0, 0, 0, 1));
    doorFrameHoleLeft.setColor(vec4.fromValues(0, 0, 0, 1));
  }

  private visitFlatDoor(node: DNAFlatDoor, parentNode: PandaNode) {
    const doorNode = this.addGeometryFromCode(node.code, parentNode);
    if (!doorNode) return;
    doorNode.setPosHprScale(
      vec3.fromValues(0.5, 0, 0),
      vec3.create(),
      vec3.fromValues(
        1 / parentNode.parent!.transform.scale[0],
        1,
        1 / parentNode.transform.scale[2],
      ),
    );
    doorNode.setColor(node.color);
    parentNode.setEffect(new DecalEffect());
  }

  private visitBaseline(baseline: DNABaseline, parentNode: PandaNode): void {
    const baselineColor = baseline.color ?? vec4.fromValues(1, 1, 1, 1);
    const baselineFlags = baseline.flags ?? "";

    let font = baseline.code ? this.storage.getFont(baseline.code) : null;
    if (!font && baseline.code) {
      console.warn(`Unable to find baseline font: ${baseline.code}`);
    }
    if (!font) {
      // Fallback to any font
      font = this.storage.getAnyFont();
    }

    const baselineNode = parentNode.attachNewNode("baseline");
    baselineNode.setColor(baselineColor);

    const layout = new DNASignBaseline({
      width: baseline.width ?? 0,
      height: baseline.height ?? 0,
      indent: baseline.indent ?? 0,
      kern: baseline.kern ?? 0,
      wiggle: baseline.wiggle ?? 0,
      stumble: baseline.stumble ?? 0,
      stomp: baseline.stomp ?? 0,
      scale: baseline.scale
        ? vec3.clone(baseline.scale)
        : vec3.fromValues(1, 1, 1),
    });
    layout.reset();

    const width = baseline.width ?? 0;
    const height = baseline.height ?? 0;
    const items =
      width < 0 || height < 0 ? [...baseline.items].reverse() : baseline.items;

    for (const item of items) {
      if (item.type === "text") {
        if (!font) {
          console.warn(`No font available for sign text: "${item.letters}"`);
          continue;
        }
        this.visitSignText(
          item,
          baselineColor,
          baselineFlags,
          layout,
          font,
          baselineNode,
        );
      } else if (item.type === "graphic") {
        this.visitSignGraphic(item, baselineColor, layout, baselineNode);
      }
    }

    const pos = baseline.pos ? vec3.clone(baseline.pos) : vec3.create();
    const hpr = baseline.hpr ? vec3.clone(baseline.hpr) : vec3.create();
    layout.center(pos, hpr);
    baselineNode.setPosHprScale(pos, hpr, vec3.fromValues(1, 1, 1));
  }

  private visitSignText(
    dnaText: DNASignText,
    baselineColor: vec4,
    baselineFlags: string,
    layout: DNASignBaseline,
    baselineFont: TextFont,
    parentNode: PandaNode,
  ): void {
    const color = dnaText.color ?? baselineColor;

    let font = baselineFont;
    if (dnaText.code) {
      const override = this.storage.getFont(dnaText.code);
      if (override) {
        font = override;
      } else {
        console.warn(`Unable to find sign text font: ${dnaText.code}`);
      }
    }

    const textNode = new TextNode("sign");
    textNode.font = font;
    textNode.textColor = color;

    let letters = dnaText.letters ?? "";
    if (baselineFlags.includes("c")) {
      letters = letters.toUpperCase();
    }

    if (baselineFlags.includes("d")) {
      textNode.shadowColor = vec4.fromValues(
        color[0] * 0.3,
        color[1] * 0.3,
        color[2] * 0.3,
        color[3] * 0.7,
      );
      textNode.shadowOffset = vec2.fromValues(0.03, 0.03);
    }

    textNode.text = letters;

    const pos = dnaText.pos ? vec3.clone(dnaText.pos) : vec3.create();
    const hpr = dnaText.hpr ? vec3.clone(dnaText.hpr) : vec3.create();
    const scale = dnaText.scale
      ? vec3.clone(dnaText.scale)
      : vec3.fromValues(1, 1, 1);

    if (baselineFlags.includes("b") && layout.isFirstLetterOfWord(letters)) {
      scale[0] *= 1.5;
      scale[2] *= 1.5;
    }

    const textSize = vec3.fromValues(textNode.width, 0, textNode.height);
    layout.nextPosHprScale(pos, hpr, scale, textSize);

    const textGeom = textNode.generate();
    parentNode.addChild(textGeom);
    textGeom.setPosHprScale(pos, hpr, scale);
  }

  private visitSignGraphic(
    dnaGraphic: DNASignGraphic,
    baselineColor: vec4,
    layout: DNASignBaseline,
    parentNode: PandaNode,
  ): void {
    const graphicNode = this.addGeometryFromCode(dnaGraphic.code, parentNode);
    if (!graphicNode) return;

    const graphicSize = vec3.fromValues(
      dnaGraphic.width ?? 0,
      0,
      dnaGraphic.height ?? 0,
    );
    const pos = dnaGraphic.pos ? vec3.clone(dnaGraphic.pos) : vec3.create();
    const hpr = dnaGraphic.hpr ? vec3.clone(dnaGraphic.hpr) : vec3.create();
    const scale = dnaGraphic.scale
      ? vec3.clone(dnaGraphic.scale)
      : vec3.fromValues(1, 1, 1);

    layout.nextPosHprScale(pos, hpr, scale, graphicSize);
    graphicNode.setPosHprScale(pos, hpr, scale);
    graphicNode.setColor(dnaGraphic.color ?? baselineColor);
  }

  private visitSign(node: DNASign, parentNode: PandaNode) {
    let buildingFront = parentNode.find("**/sign_decal");
    if (!buildingFront) {
      buildingFront = parentNode.find("**/*_front");
    }
    if (buildingFront && !(buildingFront instanceof GeomNode)) {
      buildingFront = buildingFront.findNodeByType(GeomNode);
    }
    if (!buildingFront) {
      throw new Error(`No building front found for sign ${parentNode.name}`);
    }
    buildingFront.setEffect(new DecalEffect());

    let signNode: PandaNode | null = null;
    if (node.code) {
      signNode = this.addGeometryFromCode(node.code, buildingFront);
    } else {
      signNode = buildingFront.attachNewNode("sign");
    }
    if (!signNode) return;
    signNode.setAttrib(DepthWriteAttrib.create(DepthWriteMode.Off));
    signNode.setEffect(new DecalEffect());

    const signOrigin = parentNode.find("**/*sign_origin");
    if (!signOrigin) {
      throw new Error(`No sign origin found for sign ${parentNode.name}`);
    }

    signNode.transform = TransformState.fromMatrix(
      mat4.multiply(
        mat4.create(),
        signOrigin.transform.getMatrix(),
        buildTransformState(node).getMatrix(),
      ),
    );
    if (node.color) signNode.setColor(node.color);

    for (const baseline of node.baselines) {
      this.visitBaseline(baseline, signNode);
    }

    for (const child of node.children) {
      this.visitNode(child, signNode);
    }
  }

  private getNodeByCode(code: string): PandaNode | null {
    if (code === "DCS") {
      // Empty reference node
      return null;
    }

    const nodeRef = this.storage.findNode(code);
    if (!nodeRef) {
      this.missingCodes.add(code);
      return null;
    }

    const bamFile = this.modelCache.get(nodeRef.modelPath);
    if (!bamFile) {
      console.warn(`Model not loaded: ${nodeRef.modelPath} for code ${code}`);
      return null;
    }

    let geomNode: PandaNode;
    if (nodeRef.nodeName) {
      const found = bamFile.find(`**/${nodeRef.nodeName}`);
      if (found) {
        geomNode = found;
      } else {
        console.warn(
          `Node not found: ${nodeRef.nodeName} in ${nodeRef.modelPath}`,
          bamFile,
        );
        geomNode = bamFile.getRoot();
      }
    } else {
      geomNode = bamFile.getRoot();
    }
    return geomNode;
  }

  /**
   * Add geometry from a code reference
   */
  public addGeometryFromCode(code: string, node: PandaNode): PandaNode | null {
    if (code === "DCS") {
      const result = ModelNode.create(code);
      result.preserveTransform = PreserveTransform.Net;
      node.addChild(result);
      return result;
    }

    const nodeRef = this.storage.findNode(code);
    if (!nodeRef) {
      this.missingCodes.add(code);
      return null;
    }

    const bamFile = this.modelCache.get(nodeRef.modelPath);
    if (!bamFile) {
      console.warn(`Model not loaded: ${nodeRef.modelPath} for code ${code}`);
      return null;
    }

    let geomNode: PandaNode;
    if (nodeRef.nodeName) {
      const found = bamFile.find(`**/${nodeRef.nodeName}`);
      if (found) {
        geomNode = found;
      } else {
        console.warn(
          `Node not found: ${nodeRef.nodeName} in ${nodeRef.modelPath}`,
          bamFile,
        );
        geomNode = bamFile.getRoot();
      }
    } else {
      geomNode = bamFile.getRoot();
    }

    const cloned = geomNode.cloneTo(node);
    cloned.tags.set("DNACode", code);
    cloned.tags.set("DNARoot", nodeRef.category);
    cloned.tags.set("DNAModel", nodeRef.modelPath); // custom
    return cloned;
  }

  /**
   * Get block number from a node name (e.g. "tb22:foo" -> "22")
   */
  // private getBlock(name: string): string {
  //   const index = name.indexOf(":");
  //   if (index === -1) {
  //     throw new Error(`Invalid block name: ${name}`);
  //   }
  //   return name.substring(2, index);
  // }
}
