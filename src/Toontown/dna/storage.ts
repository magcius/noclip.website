// DNAStorage - Holds registered resources from DNA storage files
// Resources are registered from storage DNA files and then looked up when loading scene DNA

import type {
  DNAFile,
  ModelDeclaration,
  StoredFont,
  StoredNode,
  StoredTexture,
} from "./types";

/**
 * A stored node reference that can be looked up by code
 */
export interface StoredNodeRef {
  modelPath: string;
  nodeName: string | undefined;
  category: string;
}

/**
 * DNAStorage holds all registered resources from DNA storage files.
 * Storage files are loaded first to populate the registry, then scene
 * DNA files reference these codes to instantiate geometry.
 */
export class DNAStorage {
  // Code -> StoredNodeRef mapping (codes are unique across categories)
  private nodes: Map<string, StoredNodeRef> = new Map();

  // Code -> texture filename
  private textures: Map<string, string> = new Map();

  // Code -> font filename
  private fonts: Map<string, string> = new Map();

  // Category -> Set of codes in that category
  private nodesByCategory: Map<string, Set<string>> = new Map();
  private texturesByCategory: Map<string, Set<string>> = new Map();
  private fontsByCategory: Map<string, Set<string>> = new Map();

  /**
   * Store a model declaration's nodes
   */
  storeModelNodes(declaration: ModelDeclaration): void {
    for (const node of declaration.nodes) {
      this.storeNode(node, declaration.path);
    }
  }

  /**
   * Store a single node reference
   */
  storeNode(node: StoredNode, modelPath: string): void {
    const ref: StoredNodeRef = {
      modelPath,
      nodeName: node.nodeName ?? node.code,
      category: node.category,
    };
    this.nodes.set(node.code, ref);

    // Track by category
    let category = this.nodesByCategory.get(node.category);
    if (!category) {
      category = new Set();
      this.nodesByCategory.set(node.category, category);
    }
    category.add(node.code);
  }

  /**
   * Store a texture
   */
  storeTexture(texture: StoredTexture): void {
    this.textures.set(texture.code, texture.filename);

    let category = this.texturesByCategory.get(texture.category);
    if (!category) {
      category = new Set();
      this.texturesByCategory.set(texture.category, category);
    }
    category.add(texture.code);
  }

  /**
   * Store a font
   */
  storeFont(font: StoredFont): void {
    this.fonts.set(font.code, font.filename);

    let category = this.fontsByCategory.get(font.category);
    if (!category) {
      category = new Set();
      this.fontsByCategory.set(font.category, category);
    }
    category.add(font.code);
  }

  /**
   * Load all resources from a parsed DNA file
   */
  loadFromDNAFile(file: DNAFile): void {
    // Store model declarations
    for (const model of file.models) {
      this.storeModelNodes(model);
    }

    // Store textures
    for (const texture of file.storedTextures) {
      this.storeTexture(texture);
    }

    // Store fonts
    for (const font of file.storedFonts) {
      this.storeFont(font);
    }
  }

  /**
   * Find a node reference by code
   */
  findNode(code: string): StoredNodeRef | undefined {
    return this.nodes.get(code);
  }

  /**
   * Find a texture filename by code
   */
  findTexture(code: string): string | undefined {
    return this.textures.get(code);
  }

  /**
   * Find a font filename by code
   */
  findFont(code: string): string | undefined {
    return this.fonts.get(code);
  }

  /**
   * Get all codes in a node category
   */
  getNodeCodesInCategory(category: string): Set<string> | undefined {
    return this.nodesByCategory.get(category);
  }

  /**
   * Check if a node code exists
   */
  hasNode(code: string): boolean {
    return this.nodes.has(code);
  }

  /**
   * Check if a texture code exists
   */
  hasTexture(code: string): boolean {
    return this.textures.has(code);
  }

  /**
   * Get all unique model paths that need to be loaded
   */
  getRequiredModelPaths(): Set<string> {
    const paths = new Set<string>();
    for (const ref of this.nodes.values()) {
      paths.add(`${ref.modelPath}.bam`);
    }
    return paths;
  }

  /**
   * Debug: Print storage contents
   */
  debugPrint(): void {
    console.log(`DNAStorage contents:`);
    console.log(`  Nodes: ${this.nodes.size}`);
    for (const [category, codes] of this.nodesByCategory) {
      console.log(`    ${category}: ${codes.size} codes`);
    }
    console.log(`  Textures: ${this.textures.size}`);
    for (const [category, codes] of this.texturesByCategory) {
      console.log(`    ${category}: ${codes.size} codes`);
    }
    console.log(`  Fonts: ${this.fonts.size}`);
  }
}
