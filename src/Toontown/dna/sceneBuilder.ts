// DNASceneBuilder - Builds a renderable scene from DNA files
// Traverses the DNA scene graph and loads referenced BAM models

import { vec3 } from "gl-matrix";
import type { DataFetcher } from "../../DataFetcher";
import type { BAMFile } from "../bam";
import { ColorAttrib, DecalEffect, TransformState } from "../nodes";
import { PandaNode } from "../nodes/PandaNode";
import type { ToontownResourceLoader } from "../resources";
import type { DNAStorage } from "./storage";
import type {
  DNAAnimBuilding,
  DNAAnimProp,
  DNAFile,
  DNAFlatBuilding,
  DNAGroup,
  DNAInteractiveProp,
  DNALandmarkBuilding,
  DNANode,
  DNANodeTransform,
  DNAProp,
  DNAStreet,
  DNAVisGroup,
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
  private missingCodes: Set<string> = new Set();

  constructor(
    private storage: DNAStorage,
    private loader: ToontownResourceLoader,
    private dataFetcher: DataFetcher,
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
      await this.visitNode(node, scene);
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
    console.log(`Preloading ${modelPaths.size} BAM models...`);

    const loadPromises: Promise<void>[] = [];
    for (const path of modelPaths) {
      if (!this.modelCache.has(path)) {
        loadPromises.push(this.loadModel(path));
      }
    }

    await Promise.all(loadPromises);
    console.log(`Loaded ${this.modelCache.size} BAM models`);
  }

  /**
   * Load a single BAM model
   */
  private async loadModel(path: string): Promise<void> {
    try {
      const bamFile = await this.loader.loadModel(path, this.dataFetcher);
      this.modelCache.set(path, bamFile);
    } catch (e) {
      console.warn(`Failed to load model ${path}:`, e);
    }
  }

  /**
   * Visit a DNA node and collect geometry
   */
  private async visitNode(node: DNANode, parentNode: PandaNode): Promise<void> {
    switch (node.type) {
      case "group":
        await this.visitGroup(node, parentNode);
        break;
      case "visgroup":
        await this.visitVisGroup(node, parentNode);
        break;
      case "prop":
        await this.visitProp(node, parentNode);
        break;
      case "anim_prop":
        await this.visitAnimProp(node, parentNode);
        break;
      case "interactive_prop":
        await this.visitInteractiveProp(node, parentNode);
        break;
      case "street":
        await this.visitStreet(node, parentNode);
        break;
      case "landmark_building":
        await this.visitLandmarkBuilding(node, parentNode);
        break;
      case "anim_building":
        await this.visitAnimBuilding(node, parentNode);
        break;
      case "flat_building":
        await this.visitFlatBuilding(node, parentNode);
        break;
      case "node":
        // Generic node - just traverse children with transform
        await this.visitGenericNode(node, parentNode);
        break;
    }
  }

  private async visitGroup(
    node: DNAGroup,
    parentNode: PandaNode,
  ): Promise<void> {
    const thisNode = new PandaNode();
    thisNode.name = node.name;
    parentNode.addChild(thisNode);

    for (const child of node.children) {
      await this.visitNode(child, thisNode);
    }
  }

  private async visitVisGroup(
    node: DNAVisGroup,
    parentNode: PandaNode,
  ): Promise<void> {
    // TODO VisGroup handling

    for (const child of node.children) {
      await this.visitNode(child, parentNode);
    }
  }

  private async visitGenericNode(
    node: DNANode & DNANodeTransform & { children: DNANode[] },
    parentNode: PandaNode,
  ): Promise<void> {
    const thisNode = new PandaNode();
    thisNode.name = node.name;
    thisNode.transform = buildTransformState(node);
    parentNode.addChild(thisNode);

    for (const child of node.children) {
      await this.visitNode(child, thisNode);
    }
  }

  private async visitProp(node: DNAProp, parentNode: PandaNode): Promise<void> {
    const thisNode = new PandaNode();
    thisNode.name = node.name;
    thisNode.transform = buildTransformState(node);
    if (node.color) {
      thisNode.state.attribs.push({
        attrib: ColorAttrib.flat(node.color),
        priority: 0,
      });
    }
    this.addGeometryFromCode(node.code, thisNode);
    parentNode.addChild(thisNode);

    // Visit children
    for (const child of node.children) {
      await this.visitNode(child, thisNode);
    }
  }

  /**
   * Visit an animated prop node
   */
  private async visitAnimProp(
    node: DNAAnimProp,
    parentNode: PandaNode,
  ): Promise<void> {
    const thisNode = new PandaNode();
    thisNode.name = node.name;
    thisNode.transform = buildTransformState(node);
    if (node.color) {
      thisNode.state.attribs.push({
        attrib: ColorAttrib.flat(node.color),
        priority: 0,
      });
    }
    this.addGeometryFromCode(node.code, thisNode);
    parentNode.addChild(thisNode);

    // TODO animation handling

    for (const child of node.children) {
      await this.visitNode(child, thisNode);
    }
  }

  /**
   * Visit an interactive prop node
   */
  private async visitInteractiveProp(
    node: DNAInteractiveProp,
    parentNode: PandaNode,
  ): Promise<void> {
    const thisNode = new PandaNode();
    thisNode.name = node.name;
    thisNode.transform = buildTransformState(node);
    if (node.color) {
      thisNode.state.attribs.push({
        attrib: ColorAttrib.flat(node.color),
        priority: 0,
      });
    }
    this.addGeometryFromCode(node.code, thisNode);
    parentNode.addChild(thisNode);

    // TODO animation handling

    for (const child of node.children) {
      await this.visitNode(child, thisNode);
    }
  }

  /**
   * Visit a street node
   */
  private async visitStreet(
    node: DNAStreet,
    parentNode: PandaNode,
  ): Promise<void> {
    const thisNode = new PandaNode();
    thisNode.name = node.name;
    thisNode.transform = buildTransformState(node);
    this.addGeometryFromCode(node.code, thisNode);
    parentNode.addChild(thisNode);

    // TODO rest of Street handling

    for (const child of node.children) {
      await this.visitNode(child, thisNode);
    }
  }

  /**
   * Visit a landmark building node
   */
  private async visitLandmarkBuilding(
    node: DNALandmarkBuilding,
    parentNode: PandaNode,
  ): Promise<void> {
    const thisNode = new PandaNode();
    thisNode.name = node.name;
    thisNode.transform = buildTransformState(node);
    this.addGeometryFromCode(node.code, thisNode);
    parentNode.addChild(thisNode);

    // TODO rest of LandmarkBuilding handling

    for (const child of node.children) {
      await this.visitNode(child, thisNode);
    }
  }

  /**
   * Visit an animated building node
   */
  private async visitAnimBuilding(
    node: DNAAnimBuilding,
    parentNode: PandaNode,
  ): Promise<void> {
    const thisNode = new PandaNode();
    thisNode.name = node.name;
    thisNode.transform = buildTransformState(node);
    this.addGeometryFromCode(node.code, thisNode);
    parentNode.addChild(thisNode);

    // TODO rest of AnimBuilding handling

    // Visit children
    for (const child of node.children) {
      await this.visitNode(child, thisNode);
    }
  }

  /**
   * Visit a flat building node
   * Flat buildings are procedurally generated from walls, windows, doors, etc.
   */
  private async visitFlatBuilding(
    node: DNAFlatBuilding,
    parentNode: PandaNode,
  ): Promise<void> {
    const buildingNode = parentNode.attachNewNode(node.name);
    buildingNode.transform = buildTransformState(node);

    // Internal node for walls
    const internalNode = buildingNode.attachNewNode(`${node.name}-internal`);
    internalNode.transform.scale = vec3.fromValues(node.width, 1, 1);

    let currHeight = 0;
    for (const wall of node.walls) {
      const wallGeom = this.getNodeByCode(wall.code);
      if (!wallGeom) throw new Error(`Wall code ${wall.code} not found`);
      const wallNode = wallGeom.cloneSubgraph();
      wallNode.setPosHprScale(
        vec3.fromValues(0, 0, currHeight),
        vec3.create(),
        vec3.fromValues(1, 1, wall.height),
      );
      wallNode.setColor(wall.color);
      internalNode.addChild(wallNode);
      currHeight += wall.height;

      if (wall.cornice) {
        const corniceNode = this.getNodeByCode(wall.cornice.code);
        if (!corniceNode)
          throw new Error(`Cornice code ${wall.cornice.code} not found`);

        const decalNode = corniceNode.findNodeBySuffix("_d");
        if (!decalNode)
          throw new Error(
            `Decal node not found in cornice ${wall.cornice.code}`,
          );
        const clonedDecalNode = decalNode.cloneSubgraph();
        clonedDecalNode.setPosHprScale(
          vec3.fromValues(0, 0, 1),
          vec3.create(),
          vec3.fromValues(
            1,
            node.width / wall.height,
            node.width / wall.height,
          ),
        );
        clonedDecalNode.setColor(wall.cornice.color);
        wallNode.addChild(clonedDecalNode);
        wallNode.setEffect(new DecalEffect()); // Render as decal base

        const noDecalNode = corniceNode.findNodeBySuffix("_nd");
        if (!noDecalNode)
          throw new Error(
            `NoDecal node not found in cornice ${wall.cornice.code}`,
          );
        const clonedNoDecalNode = noDecalNode.cloneSubgraph();
        clonedNoDecalNode.setPosHprScale(
          vec3.fromValues(0, 0, currHeight),
          vec3.create(),
          vec3.fromValues(1, node.width, node.width),
        );
        clonedNoDecalNode.setColor(wall.cornice.color);
        internalNode.addChild(clonedNoDecalNode);
      }
    }

    for (const child of node.children) {
      await this.visitNode(child, buildingNode);
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

    const modelPath = `${nodeRef.modelPath}.bam`;
    const bamFile = this.modelCache.get(modelPath);
    if (!bamFile) {
      console.warn(`Model not loaded: ${modelPath} for code ${code}`);
      return null;
    }

    let geomNode: PandaNode;
    if (nodeRef.nodeName) {
      const found = bamFile.findNode(nodeRef.nodeName);
      if (!found) {
        console.warn(`Node not found: ${nodeRef.nodeName} in ${modelPath}`);
        return null;
      }
      geomNode = found;
    } else {
      geomNode = bamFile.getRoot();
    }
    return geomNode;
  }

  /**
   * Add geometry from a code reference
   */
  private addGeometryFromCode(code: string, node: PandaNode) {
    if (!code) return;
    const geomNode = this.getNodeByCode(code);
    if (!geomNode) return;
    node.addChild(geomNode.cloneSubgraph());
  }
}
