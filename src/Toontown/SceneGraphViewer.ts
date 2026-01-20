import {
  mat4,
  type ReadonlyMat4,
  type ReadonlyVec4,
  vec3,
  vec4,
} from "gl-matrix";
import { type Color, Cyan, colorNewFromRGBA } from "../Color";
import { branchlessONB } from "../DebugJunk";
import { FloatingPanel } from "../DebugFloaters";
import { AABB } from "../Geometry";
import { DebugDraw } from "../gfx/helpers/DebugDraw";
import { LAYER_ICON } from "../ui";
import { composeDrawMask, isNodeVisible } from "./Geom";
import {
  CollisionBox,
  CollisionNode,
  CollisionPlane,
  CollisionPolygon,
  CollisionSphere,
  CollisionTube,
  type DebugInfo,
  type DebugValue,
  GeomNode,
  type PandaNode,
} from "./nodes";
import { pandaToNoclip } from "./Render";

// Orange color for collision visualization (#ff9933)
const CollisionColor: Color = colorNewFromRGBA(1.0, 0.6, 0.2, 1.0);

interface SceneGraphTreeNode {
  node: PandaNode;
  worldTransform: mat4;
  // Combined transform: pandaToNoclip * worldTransform (for debug drawing)
  noclipTransform: mat4;
  depth: number;
  isExpanded: boolean;
  isVisible: boolean;
  hasGeomDescendants: boolean;
  hasCollisionDescendants: boolean;
  // Local AABB (in node's local space, computed from geometry or children)
  localAABB: AABB | null;
  parent: SceneGraphTreeNode | null;
  children: SceneGraphTreeNode[];
  element: HTMLElement | null;
}

export class SceneGraphViewer {
  private panel: FloatingPanel;
  private treeContainer: HTMLElement;
  private rootNodes: SceneGraphTreeNode[] = [];
  private allNodes: SceneGraphTreeNode[] = [];
  private highlightedNode: SceneGraphTreeNode | null = null;
  private filterQuery = "";
  private matchingNodes: Set<SceneGraphTreeNode> = new Set();
  private visibleNodes: Set<SceneGraphTreeNode> = new Set();
  private sceneRoot: PandaNode | null = null;
  public onclose: (() => void) | null = null;

  // Currently open debug info panel
  private debugInfoPanel: FloatingPanel | null = null;
  private debugInfoNode: SceneGraphTreeNode | null = null;

  constructor() {
    this.panel = new FloatingPanel();
    this.panel.setTitle(LAYER_ICON, "Scene Graph");
    this.panel.setWidth("420px");
    const panelsList = document.querySelector("#Panel > *") as HTMLElement;
    if (panelsList) {
      // Align with the left-hand panels
      this.panel.setPosition(
        panelsList.offsetLeft,
        panelsList.offsetTop + panelsList.offsetHeight + 20,
      );
    }
    this.panel.contents.style.maxHeight = "60vh";
    this.panel.contents.style.overflow = "auto";
    this.panel.contents.style.fontSize = "12px";
    this.panel.contents.style.fontFamily = "monospace";
    this.panel.onclose = () => {
      this.debugInfoPanel?.close();
      this.onclose?.();
    };

    // Create toolbar
    const toolbar = document.createElement("div");
    toolbar.style.padding = "4px 8px";
    toolbar.style.borderBottom = "1px solid #444";
    toolbar.style.display = "flex";
    toolbar.style.alignItems = "center";
    toolbar.style.gap = "8px";

    // Filter input
    const filterInput = document.createElement("input");
    filterInput.type = "text";
    filterInput.placeholder = "Filter by name, type, or tag...";
    filterInput.style.flex = "1";
    filterInput.style.padding = "4px 8px";
    filterInput.style.border = "1px solid #555";
    filterInput.style.borderRadius = "3px";
    filterInput.style.backgroundColor = "#333";
    filterInput.style.color = "#fff";
    filterInput.style.fontSize = "12px";
    filterInput.style.fontFamily = "monospace";
    filterInput.style.minWidth = "0";
    filterInput.oninput = () => {
      this.filterQuery = filterInput.value.trim();
      this.applyFilter();
      this.renderTree();
    };

    // Refresh button
    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    refreshBtn.style.cursor = "pointer";
    refreshBtn.style.flexShrink = "0";
    refreshBtn.onclick = () => this.refresh();

    toolbar.appendChild(filterInput);
    toolbar.appendChild(refreshBtn);
    this.panel.contents.appendChild(toolbar);

    // Create tree container
    this.treeContainer = document.createElement("div");
    this.treeContainer.style.padding = "4px";
    this.panel.contents.appendChild(this.treeContainer);
  }

  /**
   * Set the scene root and build the tree
   */
  setScene(root: PandaNode): void {
    this.sceneRoot = root;
    this.buildTree();
    this.renderTree();
  }

  /**
   * Refresh the tree from current scene state
   */
  refresh(): void {
    if (this.sceneRoot) {
      this.buildTree();
      this.applyFilter();
      this.renderTree();
    }
  }

  /**
   * Apply the current filter query to find matching nodes.
   * Case-insensitive fuzzy search across node type, name, and tags.
   */
  private applyFilter(): void {
    this.matchingNodes.clear();
    this.visibleNodes.clear();

    if (!this.filterQuery) {
      return;
    }

    const query = this.filterQuery.toLowerCase();

    // Check if a node matches the query
    const nodeMatches = (node: PandaNode): boolean => {
      // Match node type (constructor name)
      if (node.constructor.name.toLowerCase().includes(query)) {
        return true;
      }

      // Match node name
      if (node.name.toLowerCase().includes(query)) {
        return true;
      }

      // Match tag keys or values
      for (const [key, value] of node.tags) {
        if (key.toLowerCase().includes(query)) {
          return true;
        }
        if (value.toLowerCase().includes(query)) {
          return true;
        }
      }

      return false;
    };

    // Collapse all nodes first
    for (const treeNode of this.allNodes) {
      treeNode.isExpanded = false;
    }

    // Find matching nodes and expand only their parent chains
    for (const treeNode of this.allNodes) {
      if (nodeMatches(treeNode.node)) {
        this.matchingNodes.add(treeNode);
        this.visibleNodes.add(treeNode);

        // Expand and mark visible the parent chain
        let parent = treeNode.parent;
        while (parent) {
          parent.isExpanded = true;
          this.visibleNodes.add(parent);
          parent = parent.parent;
        }

        // Mark all descendants as visible too
        const addDescendants = (node: SceneGraphTreeNode) => {
          for (const child of node.children) {
            this.visibleNodes.add(child);
            addDescendants(child);
          }
        };
        addDescendants(treeNode);
      }
    }
  }

  /**
   * Show the viewer panel
   */
  show(): void {
    if (!this.panel.elem.parentElement) {
      window.main.ui.debugFloaterHolder.elem.appendChild(this.panel.elem);
    }
    this.panel.setVisible(true);
  }

  /**
   * Hide the viewer panel
   */
  hide(): void {
    this.panel.setVisible(false);
  }

  /**
   * Close and clean up the viewer
   */
  close(): void {
    this.highlightedNode = null;
    if (this.debugInfoPanel) {
      this.debugInfoPanel.close();
      this.debugInfoPanel = null;
      this.debugInfoNode = null;
    }
    this.panel.close();
  }

  /**
   * Build the tree structure from the scene graph
   */
  private buildTree(): void {
    this.rootNodes = [];
    this.allNodes = [];

    if (!this.sceneRoot) return;

    // First pass: collect nodes and compute transforms
    const collectNode = (
      node: PandaNode,
      parentTransform: ReadonlyMat4,
      parentDrawMask: number,
      depth: number,
      parent: SceneGraphTreeNode | null,
    ): SceneGraphTreeNode => {
      // Compute world transform
      let worldTransform: mat4;
      if (node.transform.isIdentity) {
        worldTransform = mat4.clone(parentTransform);
      } else {
        worldTransform = mat4.create();
        mat4.multiply(
          worldTransform,
          parentTransform,
          node.transform.getMatrix(),
        );
      }

      // Compute noclip transform (for drawing)
      const noclipTransform = mat4.create();
      mat4.multiply(noclipTransform, pandaToNoclip, worldTransform);

      // Compute visibility from draw mask
      const drawMask = composeDrawMask(
        parentDrawMask,
        node.drawControlMask,
        node.drawShowMask,
      );

      const treeNode: SceneGraphTreeNode = {
        node,
        worldTransform,
        noclipTransform,
        depth,
        isExpanded: depth < 2,
        isVisible: isNodeVisible(drawMask),
        hasGeomDescendants: false,
        hasCollisionDescendants: false,
        localAABB: null,
        parent,
        children: [],
        element: null,
      };

      // Process children first (bottom-up for AABB computation)
      for (const [child] of node.children) {
        const childTreeNode = collectNode(
          child,
          worldTransform,
          drawMask,
          depth + 1,
          treeNode,
        );
        treeNode.children.push(childTreeNode);
        if (
          childTreeNode.node instanceof GeomNode ||
          childTreeNode.hasGeomDescendants
        ) {
          treeNode.hasGeomDescendants = true;
        }
        if (
          childTreeNode.node instanceof CollisionNode ||
          childTreeNode.hasCollisionDescendants
        ) {
          treeNode.hasCollisionDescendants = true;
        }
      }

      // Compute local AABB
      if (node instanceof GeomNode) {
        // GeomNode has its own bounding box
        treeNode.localAABB = node.getBoundingBox();
      } else if (treeNode.children.length > 0) {
        // For non-GeomNodes, union children's AABBs (transformed to this node's local space)
        const aabb = new AABB();
        for (const child of treeNode.children) {
          if (child.localAABB) {
            // Transform child's AABB by child's local transform
            const childAABB = new AABB();
            childAABB.transform(
              child.localAABB,
              child.node.transform.getMatrix(),
            );
            aabb.union(aabb, childAABB);
          }
        }
        if (aabb.min[0] <= aabb.max[0]) {
          treeNode.localAABB = aabb;
        }
      }

      this.allNodes.push(treeNode);
      return treeNode;
    };

    const rootTreeNode = collectNode(
      this.sceneRoot,
      mat4.create(),
      0xffffffff,
      0,
      null,
    );
    this.rootNodes = [rootTreeNode];
  }

  /**
   * Render the tree UI
   */
  private renderTree(): void {
    this.treeContainer.innerHTML = "";
    const hasFilter = this.filterQuery.length > 0;

    const renderNode = (treeNode: SceneGraphTreeNode): void => {
      // Skip non-visible nodes when filtering
      if (hasFilter && !this.visibleNodes.has(treeNode)) {
        return;
      }

      const element = this.createNodeElement(treeNode);
      treeNode.element = element;
      this.treeContainer.appendChild(element);

      // Render children if expanded
      if (treeNode.isExpanded) {
        for (const child of treeNode.children) {
          renderNode(child);
        }
      }
    };

    for (const rootNode of this.rootNodes) {
      renderNode(rootNode);
    }
  }

  /**
   * Create DOM element for a tree node
   */
  private createNodeElement(treeNode: SceneGraphTreeNode): HTMLElement {
    const container = document.createElement("div");
    const isMatch = this.matchingNodes.has(treeNode);

    // Main row
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.padding = "2px 4px";
    row.style.paddingLeft = `${8 + treeNode.depth * 16}px`;
    row.style.cursor = "pointer";
    row.style.borderRadius = "2px";
    row.style.transition = "background-color 0.1s";

    // Dim nodes that aren't visible (hidden via draw mask)
    if (!treeNode.isVisible && !(treeNode.node instanceof CollisionNode)) {
      row.style.opacity = "0.4";
    }

    // Highlight matching nodes
    if (isMatch) {
      row.style.backgroundColor = "rgba(100, 180, 255, 0.25)";
      row.style.boxShadow = "inset 2px 0 0 #4af";
    }

    // Hover effects
    const defaultBg = isMatch ? "rgba(100, 180, 255, 0.25)" : "";
    row.onmouseenter = () => {
      row.style.backgroundColor = isMatch
        ? "rgba(100, 180, 255, 0.4)"
        : "rgba(255, 255, 255, 0.1)";
      this.onNodeHover(treeNode);
    };
    row.onmouseleave = () => {
      row.style.backgroundColor = defaultBg;
      this.onNodeHoverEnd();
    };

    // Click to expand/collapse, double-click to show debug info
    row.onclick = (e) => {
      e.stopPropagation();
      this.toggleExpand(treeNode);
    };
    row.ondblclick = (e) => {
      e.stopPropagation();
      this.showDebugInfoPanel(treeNode);
    };

    // Expand arrow
    const arrow = document.createElement("span");
    arrow.style.width = "16px";
    arrow.style.display = "inline-block";
    arrow.style.textAlign = "center";
    arrow.style.color = "#888";
    if (treeNode.children.length > 0) {
      arrow.textContent = treeNode.isExpanded ? "▼" : "▶";
    }
    row.appendChild(arrow);

    // Node type badge
    const typeBadge = document.createElement("span");
    typeBadge.style.padding = "1px 4px";
    typeBadge.style.borderRadius = "2px";
    typeBadge.style.marginRight = "6px";
    typeBadge.style.fontSize = "10px";
    let nodeName = treeNode.node.constructor.name;
    if (nodeName === "PandaNode") nodeName = "Node";
    typeBadge.textContent = nodeName;
    const isGeomNode = nodeName === "GeomNode" || treeNode.hasGeomDescendants;
    const isCollisionNode = treeNode.node instanceof CollisionNode;
    const hasCollision = isCollisionNode || treeNode.hasCollisionDescendants;
    if (isCollisionNode) {
      typeBadge.style.backgroundColor = "#f93";
      typeBadge.style.color = "#000";
    } else if (isGeomNode) {
      typeBadge.style.backgroundColor = "#2a5";
      typeBadge.style.color = "#fff";
    } else {
      typeBadge.style.backgroundColor = "#555";
      typeBadge.style.color = "#aaa";
    }
    row.appendChild(typeBadge);

    // Node name (don't dim nodes with geometry or collision descendants)
    const name = document.createElement("span");
    name.textContent = treeNode.node.name || "(unnamed)";
    name.style.color = isGeomNode || hasCollision ? "#fff" : "#888";
    name.style.flex = "1";
    name.style.overflow = "hidden";
    name.style.textOverflow = "ellipsis";
    name.style.whiteSpace = "nowrap";
    row.appendChild(name);

    // Child count
    if (treeNode.children.length > 0) {
      const count = document.createElement("span");
      count.style.color = "#666";
      count.style.fontSize = "10px";
      count.style.marginLeft = "4px";
      count.textContent = `(${treeNode.children.length})`;
      row.appendChild(count);
    }

    // Info button
    const infoBtn = document.createElement("span");
    infoBtn.textContent = "ℹ";
    infoBtn.style.marginLeft = "4px";
    infoBtn.style.padding = "0 4px";
    infoBtn.style.cursor = "pointer";
    infoBtn.style.opacity = "0.5";
    infoBtn.style.fontSize = "12px";
    infoBtn.title = "Show debug info";
    infoBtn.onmouseenter = () => {
      infoBtn.style.opacity = "1";
    };
    infoBtn.onmouseleave = () => {
      infoBtn.style.opacity = "0.5";
    };
    infoBtn.onclick = (e) => {
      e.stopPropagation();
      this.showDebugInfoPanel(treeNode);
    };
    row.appendChild(infoBtn);

    container.appendChild(row);
    return container;
  }

  /**
   * Show debug info in a separate floating panel with tree view
   */
  private showDebugInfoPanel(treeNode: SceneGraphTreeNode): void {
    // Close existing panel if showing same node
    if (this.debugInfoPanel && this.debugInfoNode === treeNode) {
      this.debugInfoPanel.close();
      this.debugInfoPanel = null;
      this.debugInfoNode = null;
      return;
    }

    // Close existing panel
    if (this.debugInfoPanel) {
      this.debugInfoPanel.close();
    }

    // Create new panel
    const panel = new FloatingPanel();
    const nodeName = treeNode.node.name || "(unnamed)";
    const nodeType = treeNode.node.constructor.name;
    panel.setTitle(LAYER_ICON, `${nodeType}: ${nodeName}`);
    panel.setWidth("500px");
    panel.setPosition(window.innerWidth - 532, 32);
    panel.contents.style.maxHeight = "70vh";
    panel.contents.style.overflow = "auto";
    panel.contents.style.fontSize = "12px";
    panel.contents.style.fontFamily = "monospace";
    panel.contents.style.padding = "8px";

    // Action buttons toolbar
    const toolbar = document.createElement("div");
    toolbar.style.display = "flex";
    toolbar.style.gap = "8px";
    toolbar.style.marginBottom = "8px";
    toolbar.style.paddingBottom = "8px";
    toolbar.style.borderBottom = "1px solid #444";

    const hideBtn = document.createElement("button");
    hideBtn.textContent = "Hide";
    hideBtn.style.cursor = "pointer";
    hideBtn.onclick = () => {
      treeNode.node.hide();
      treeNode.isVisible = false;
    };
    toolbar.appendChild(hideBtn);

    const showBtn = document.createElement("button");
    showBtn.textContent = "Show";
    showBtn.style.cursor = "pointer";
    showBtn.onclick = () => {
      treeNode.node.show();
      treeNode.isVisible = true;
    };
    toolbar.appendChild(showBtn);

    panel.contents.appendChild(toolbar);

    // Get debug info
    const debugInfo = treeNode.node.getDebugInfo();

    // Create tree view of debug info
    const treeView = this.createDebugInfoTree(debugInfo);
    panel.contents.appendChild(treeView);

    // Add to DOM
    window.main.ui.debugFloaterHolder.elem.appendChild(panel.elem);

    // Track the panel
    this.debugInfoPanel = panel;
    this.debugInfoNode = treeNode;

    panel.onclose = () => {
      if (this.debugInfoPanel === panel) {
        this.debugInfoPanel = null;
        this.debugInfoNode = null;
      }
    };
  }

  /**
   * Create a tree view for debug info
   */
  private createDebugInfoTree(debugInfo: DebugInfo): HTMLElement {
    const container = document.createElement("div");

    for (const [key, value] of debugInfo) {
      const row = this.createDebugValueRow(key, value, 0);
      container.appendChild(row);
    }

    return container;
  }

  /**
   * Create a row for a debug value (potentially with children)
   */
  private createDebugValueRow(
    key: string,
    value: DebugValue,
    depth: number,
  ): HTMLElement {
    const container = document.createElement("div");

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "flex-start";
    row.style.padding = "2px 0";
    row.style.paddingLeft = `${depth * 16}px`;
    row.style.borderRadius = "2px";

    // Key
    const keySpan = document.createElement("span");
    keySpan.textContent = `${key}: `;
    keySpan.style.color = "#8cf";
    keySpan.style.flexShrink = "0";
    keySpan.style.whiteSpace = "pre";
    row.appendChild(keySpan);

    // Value
    const valueSpan = document.createElement("span");
    valueSpan.style.color = "#ccc";
    valueSpan.style.wordBreak = "break-all";

    const isExpandable = this.isExpandableValue(value);

    if (isExpandable) {
      // Make it expandable
      let expanded = depth < 1; // Auto-expand first level

      const arrow = document.createElement("span");
      arrow.style.cursor = "pointer";
      arrow.style.marginRight = "4px";
      arrow.style.color = "#888";
      arrow.textContent = expanded ? "▼" : "▶";

      const typeLabel = document.createElement("span");
      typeLabel.style.color = "#a8a";
      typeLabel.textContent = this.getValueTypeLabel(value);

      valueSpan.appendChild(arrow);
      valueSpan.appendChild(typeLabel);

      const childContainer = document.createElement("div");
      childContainer.style.display = expanded ? "block" : "none";

      const renderChildren = () => {
        childContainer.innerHTML = "";
        this.appendExpandedChildren(childContainer, value, depth + 1);
      };

      if (expanded) {
        renderChildren();
      }

      arrow.onclick = () => {
        expanded = !expanded;
        arrow.textContent = expanded ? "▼" : "▶";
        childContainer.style.display = expanded ? "block" : "none";
        if (expanded && childContainer.childElementCount === 0) {
          renderChildren();
        }
      };

      row.appendChild(valueSpan);
      container.appendChild(row);
      container.appendChild(childContainer);
    } else {
      valueSpan.textContent = this.formatSimpleValue(value);
      row.appendChild(valueSpan);
      container.appendChild(row);
    }

    return container;
  }

  /**
   * Check if a value should be expandable
   */
  private isExpandableValue(value: DebugValue): boolean {
    switch (value.type) {
      case "ref":
        return value.obj !== null;
      case "refs":
        return value.objs.length > 0;
      case "array":
        return value.items.length > 0;
      case "object":
        return value.fields.size > 0;
      case "mat4":
        return true;
      default:
        return false;
    }
  }

  /**
   * Get a type label for expandable values
   */
  private getValueTypeLabel(value: DebugValue): string {
    switch (value.type) {
      case "ref":
        return value.obj ? `[${value.obj.constructor.name}]` : "null";
      case "refs":
        return `[${value.objs.length} refs]`;
      case "array":
        return `[${value.items.length} items]`;
      case "object":
        return `{${value.fields.size} fields}`;
      case "mat4":
        return "[mat4]";
      default:
        return "";
    }
  }

  /**
   * Append expanded children for a value
   */
  private appendExpandedChildren(
    container: HTMLElement,
    value: DebugValue,
    depth: number,
  ): void {
    switch (value.type) {
      case "ref":
        if (value.obj) {
          const info = value.obj.getDebugInfo();
          for (const [k, v] of info) {
            container.appendChild(this.createDebugValueRow(k, v, depth));
          }
        }
        break;
      case "refs":
        for (let i = 0; i < value.objs.length; i++) {
          const obj = value.objs[i];
          if (obj) {
            container.appendChild(
              this.createDebugValueRow(`[${i}]`, { type: "ref", obj }, depth),
            );
          } else {
            container.appendChild(
              this.createDebugValueRow(
                `[${i}]`,
                { type: "string", value: "null" },
                depth,
              ),
            );
          }
        }
        break;
      case "array":
        for (let i = 0; i < value.items.length; i++) {
          container.appendChild(
            this.createDebugValueRow(`[${i}]`, value.items[i], depth),
          );
        }
        break;
      case "object":
        for (const [k, v] of value.fields) {
          container.appendChild(this.createDebugValueRow(k, v, depth));
        }
        break;
      case "mat4": {
        // Show matrix as 4 rows
        for (let r = 0; r < 4; r++) {
          const row = value.value.slice(r * 4, r * 4 + 4) as ReadonlyVec4;
          container.appendChild(
            this.createDebugValueRow(
              `m[${r}]`,
              { type: "vec4", value: row },
              depth,
            ),
          );
        }
        break;
      }
    }
  }

  /**
   * Format a simple (non-expandable) value
   */
  private formatSimpleValue(value: DebugValue): string {
    switch (value.type) {
      case "string":
        return `"${value.value}"`;
      case "number":
        return Number.isInteger(value.value)
          ? value.value.toString()
          : value.value.toFixed(4);
      case "boolean":
        return value.value ? "true" : "false";
      case "vec2":
        return `(${value.value[0].toFixed(3)}, ${value.value[1].toFixed(3)})`;
      case "vec3":
        return `(${value.value[0].toFixed(3)}, ${value.value[1].toFixed(3)}, ${value.value[2].toFixed(3)})`;
      case "vec4":
        return `(${value.value[0].toFixed(3)}, ${value.value[1].toFixed(3)}, ${value.value[2].toFixed(3)}, ${value.value[3].toFixed(3)})`;
      case "color": {
        const [r, g, b, a] = [
          Math.round(value.value[0] * 255),
          Math.round(value.value[1] * 255),
          Math.round(value.value[2] * 255),
          value.value[3],
        ];
        return a === 1
          ? `rgb(${r}, ${g}, ${b})`
          : `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
      }
      case "enum":
        return value.name;
      case "flags":
        return value.names.length > 0 ? value.names.join(" | ") : "0";
      case "bytes":
        return `<${value.length} bytes>`;
      case "typedArray":
        return `<${value.value.length / (value.components || 1)} items>`;
      case "ref":
        return value.obj ? `[${value.obj.constructor.name}]` : "null";
      case "refs":
        return `[${value.objs.length} refs]`;
      case "array":
        return `[${value.items.length} items]`;
      case "object":
        return `{${value.fields.size} fields}`;
      case "mat4":
        return "[mat4]";
      default:
        return "?";
    }
  }

  /**
   * Toggle expand/collapse state of a node
   */
  private toggleExpand(treeNode: SceneGraphTreeNode): void {
    treeNode.isExpanded = !treeNode.isExpanded;
    this.renderTree();
  }

  /**
   * Handle mouse hover on a node
   */
  private onNodeHover(treeNode: SceneGraphTreeNode): void {
    this.highlightedNode = treeNode;
  }

  /**
   * Handle mouse leaving a node
   */
  private onNodeHoverEnd(): void {
    this.highlightedNode = null;
  }

  /**
   * Draw the highlighted node's collision solids and AABB on the debug canvas
   */
  drawDebugGraphics(debugDraw: DebugDraw): void {
    if (!this.highlightedNode) return;

    // Draw collision solids for this node and all descendants
    this.drawCollisionSolidsRecursive(debugDraw, this.highlightedNode);

    // Draw AABB if available
    if (this.highlightedNode.localAABB) {
      this.drawAABB(
        debugDraw,
        this.highlightedNode.localAABB,
        this.highlightedNode.noclipTransform,
        Cyan,
      );
    }
  }

  /**
   * Draw an AABB (12 edges)
   */
  private drawAABB(
    debugDraw: DebugDraw,
    aabb: AABB,
    transform: ReadonlyMat4,
    color: Color,
  ): void {
    // Compute 8 corners
    const corners: vec3[] = [
      vec3.fromValues(aabb.min[0], aabb.min[1], aabb.min[2]),
      vec3.fromValues(aabb.max[0], aabb.min[1], aabb.min[2]),
      vec3.fromValues(aabb.min[0], aabb.max[1], aabb.min[2]),
      vec3.fromValues(aabb.max[0], aabb.max[1], aabb.min[2]),
      vec3.fromValues(aabb.min[0], aabb.min[1], aabb.max[2]),
      vec3.fromValues(aabb.max[0], aabb.min[1], aabb.max[2]),
      vec3.fromValues(aabb.min[0], aabb.max[1], aabb.max[2]),
      vec3.fromValues(aabb.max[0], aabb.max[1], aabb.max[2]),
    ];

    // Transform corners to world space
    for (const corner of corners) {
      vec3.transformMat4(corner, corner, transform);
    }

    // Draw 12 edges
    const edges: [number, number][] = [
      [0, 1],
      [1, 3],
      [3, 2],
      [2, 0], // bottom face
      [4, 5],
      [5, 7],
      [7, 6],
      [6, 4], // top face
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7], // vertical edges
    ];

    for (const [a, b] of edges) {
      debugDraw.drawLine(corners[a], corners[b], color);
    }
  }

  /**
   * Recursively draw collision solids for a node and all its descendants
   */
  private drawCollisionSolidsRecursive(
    debugDraw: DebugDraw,
    treeNode: SceneGraphTreeNode,
  ): void {
    if (treeNode.node instanceof CollisionNode) {
      this.drawCollisionSolids(
        debugDraw,
        treeNode.node,
        treeNode.noclipTransform,
      );
    }

    for (const child of treeNode.children) {
      this.drawCollisionSolidsRecursive(debugDraw, child);
    }
  }

  /**
   * Draw all collision solids in a CollisionNode
   */
  private drawCollisionSolids(
    debugDraw: DebugDraw,
    node: CollisionNode,
    transform: ReadonlyMat4,
  ): void {
    for (const solid of node.solids) {
      if (solid instanceof CollisionSphere) {
        this.drawCollisionSphere(debugDraw, solid, transform);
      } else if (solid instanceof CollisionBox) {
        this.drawCollisionBox(debugDraw, solid, transform);
      } else if (solid instanceof CollisionTube) {
        this.drawCollisionTube(debugDraw, solid, transform);
      } else if (solid instanceof CollisionPolygon) {
        this.drawCollisionPolygon(debugDraw, solid, transform);
      } else if (solid instanceof CollisionPlane) {
        this.drawCollisionPlane(debugDraw, solid, transform);
      }
    }
  }

  /**
   * Draw a collision sphere
   */
  private drawCollisionSphere(
    debugDraw: DebugDraw,
    sphere: CollisionSphere,
    transform: ReadonlyMat4,
  ): void {
    // Transform center to world space
    const worldCenter = vec3.create();
    vec3.transformMat4(worldCenter, sphere.center, transform);

    // Scale the radius by the transform's scale
    const scaledRadius = this.getScaledRadius(sphere.radius, transform);

    debugDraw.drawSphereLine(worldCenter, scaledRadius, CollisionColor);
  }

  /**
   * Draw a collision box
   */
  private drawCollisionBox(
    debugDraw: DebugDraw,
    box: CollisionBox,
    transform: ReadonlyMat4,
  ): void {
    // Vertices are stored as 8 corners in the float array (24 floats = 8 * 3)
    const vertices = box.vertices;
    const worldVerts: vec3[] = [];

    for (let i = 0; i < 8; i++) {
      const v = vec3.fromValues(
        vertices[i * 3 + 0],
        vertices[i * 3 + 1],
        vertices[i * 3 + 2],
      );
      vec3.transformMat4(v, v, transform);
      worldVerts.push(v);
    }

    // Draw 12 edges of the box
    const edges: [number, number][] = [
      [0, 1],
      [1, 3],
      [3, 2],
      [2, 0], // Bottom face
      [4, 5],
      [5, 7],
      [7, 6],
      [6, 4], // Top face
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7], // Vertical edges
    ];

    for (const [a, b] of edges) {
      debugDraw.drawLine(worldVerts[a], worldVerts[b], CollisionColor);
    }
  }

  /**
   * Draw a collision tube/capsule
   */
  private drawCollisionTube(
    debugDraw: DebugDraw,
    tube: CollisionTube,
    transform: ReadonlyMat4,
  ): void {
    // Transform endpoints to world space
    const worldA = vec3.create();
    const worldB = vec3.create();
    vec3.transformMat4(worldA, tube.pointA, transform);
    vec3.transformMat4(worldB, tube.pointB, transform);

    // Scale the radius by the transform's scale
    const scaledRadius = this.getScaledRadius(tube.radius, transform);

    // Compute axis direction
    const axis = vec3.create();
    vec3.subtract(axis, worldB, worldA);
    const length = vec3.length(axis);

    if (length < 0.0001) {
      // Degenerate capsule - draw sphere
      debugDraw.drawSphereLine(worldA, scaledRadius, CollisionColor);
      return;
    }

    vec3.scale(axis, axis, 1 / length);

    // Draw end circles
    debugDraw.drawDiscLineN(worldA, axis, scaledRadius, CollisionColor);
    debugDraw.drawDiscLineN(worldB, axis, scaledRadius, CollisionColor);

    // Get orthonormal basis for connecting lines
    const axisX = vec3.create();
    const axisY = vec3.create();
    branchlessONB(axisX, axisY, axis);

    // Draw 4 connecting lines
    const tempA = vec3.create();
    const tempB = vec3.create();

    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const cosT = Math.cos(angle) * scaledRadius;
      const sinT = Math.sin(angle) * scaledRadius;

      vec3.scaleAndAdd(tempA, worldA, axisX, cosT);
      vec3.scaleAndAdd(tempA, tempA, axisY, sinT);
      vec3.scaleAndAdd(tempB, worldB, axisX, cosT);
      vec3.scaleAndAdd(tempB, tempB, axisY, sinT);

      debugDraw.drawLine(tempA, tempB, CollisionColor);
    }
  }

  /**
   * Draw a collision polygon
   */
  private drawCollisionPolygon(
    debugDraw: DebugDraw,
    polygon: CollisionPolygon,
    transform: ReadonlyMat4,
  ): void {
    if (polygon.points.length < 3) return;

    // to2dMatrix transforms 3D points to 2D. We need the inverse to go back.
    const from2dMatrix = mat4.create();
    mat4.invert(from2dMatrix, polygon.to2dMatrix);

    // Combined transform: from2D -> local -> world (noclip)
    const combinedTransform = mat4.create();
    mat4.multiply(combinedTransform, transform, from2dMatrix);

    // Project 2D points back to 3D world space
    // Note: Panda stores 2D polygon points in XZ plane (Y=0)
    const worldPoints: vec3[] = [];
    for (const { point } of polygon.points) {
      const local3D = vec3.fromValues(point[0], 0, point[1]);
      const world3D = vec3.create();
      vec3.transformMat4(world3D, local3D, combinedTransform);
      worldPoints.push(world3D);
    }

    // Draw polygon outline
    for (let i = 0; i < worldPoints.length; i++) {
      const next = (i + 1) % worldPoints.length;
      debugDraw.drawLine(worldPoints[i], worldPoints[next], CollisionColor);
    }
  }

  /**
   * Draw a collision plane (as a bounded grid)
   */
  private drawCollisionPlane(
    debugDraw: DebugDraw,
    plane: CollisionPlane,
    transform: ReadonlyMat4,
  ): void {
    // Plane is stored as (nx, ny, nz, d) where normal points "into" the plane
    const normal = vec3.fromValues(
      plane.plane[0],
      plane.plane[1],
      plane.plane[2],
    );
    const d = plane.plane[3];

    // Find a point on the plane: p = normal * -d
    const origin = vec3.create();
    vec3.scale(origin, normal, -d);

    // Transform to world space
    const worldOrigin = vec3.create();
    vec3.transformMat4(worldOrigin, origin, transform);

    // Transform normal (direction only, use inverse transpose)
    const worldNormal = vec3.create();
    const normalMat = mat4.create();
    mat4.invert(normalMat, transform);
    mat4.transpose(normalMat, normalMat);
    vec3.transformMat4(worldNormal, normal, normalMat);
    vec3.normalize(worldNormal, worldNormal);

    // Create orthonormal basis on the plane
    const tangent = vec3.create();
    const bitangent = vec3.create();
    branchlessONB(tangent, bitangent, worldNormal);

    // Draw a bounded grid (cross pattern) centered on origin
    const size = 50;

    // Draw cross through origin
    const p1 = vec3.create();
    const p2 = vec3.create();

    vec3.scaleAndAdd(p1, worldOrigin, tangent, -size);
    vec3.scaleAndAdd(p2, worldOrigin, tangent, size);
    debugDraw.drawLine(p1, p2, CollisionColor);

    vec3.scaleAndAdd(p1, worldOrigin, bitangent, -size);
    vec3.scaleAndAdd(p2, worldOrigin, bitangent, size);
    debugDraw.drawLine(p1, p2, CollisionColor);

    // Draw a square outline around the plane
    const corners: vec3[] = [];
    for (let i = 0; i < 4; i++) {
      const corner = vec3.create();
      const sx = i === 0 || i === 3 ? -size : size;
      const sy = i === 0 || i === 1 ? -size : size;
      vec3.scaleAndAdd(corner, worldOrigin, tangent, sx);
      vec3.scaleAndAdd(corner, corner, bitangent, sy);
      corners.push(corner);
    }

    for (let i = 0; i < corners.length; i++) {
      const next = (i + 1) % corners.length;
      debugDraw.drawLine(corners[i], corners[next], CollisionColor);
    }
  }

  /**
   * Helper to scale a radius by a transform's scale factor
   */
  private getScaledRadius(radius: number, transform: ReadonlyMat4): number {
    const radiusVec = vec3.fromValues(radius, 0, 0);
    const scaledRadiusVec = vec3.create();
    vec3.transformMat4(scaledRadiusVec, radiusVec, transform);
    const origin = vec3.create();
    vec3.transformMat4(origin, vec3.create(), transform);
    vec3.subtract(scaledRadiusVec, scaledRadiusVec, origin);
    return vec3.length(scaledRadiusVec);
  }

  /**
   * Check if the viewer is currently visible
   */
  isVisible(): boolean {
    return this.panel.elem.parentElement !== null;
  }
}
