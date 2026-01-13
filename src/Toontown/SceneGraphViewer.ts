import { mat4, type ReadonlyMat4 } from "gl-matrix";
import { Cyan } from "../Color.js";
import { FloatingPanel } from "../DebugFloaters.js";
import { drawWorldSpaceAABB, getDebugOverlayCanvas2D } from "../DebugJunk.js";
import { AABB } from "../Geometry.js";
import { LAYER_ICON } from "../ui.js";
import type { DebugInfo, DebugValue } from "./nodes/debug.js";
import { GeomNode } from "./nodes/GeomNode.js";
import type { PandaNode } from "./nodes/PandaNode.js";
import { pandaToNoclip } from "./render.js";

/**
 * Represents a node in the scene graph tree UI
 */
interface SceneGraphTreeNode {
  node: PandaNode;
  worldTransform: mat4;
  // Combined transform: pandaToNoclip * worldTransform (for AABB drawing)
  noclipTransform: mat4;
  depth: number;
  isExpanded: boolean;
  hasGeomDescendants: boolean;
  // Local AABB (in node's local space, computed from geometry or children)
  localAABB: AABB | null;
  parent: SceneGraphTreeNode | null;
  children: SceneGraphTreeNode[];
  element: HTMLElement | null;
}

/**
 * Scene Graph Viewer - displays scene hierarchy with AABB highlighting
 */
export class SceneGraphViewer {
  private panel: FloatingPanel;
  private treeContainer: HTMLElement;
  private rootNodes: SceneGraphTreeNode[] = [];
  private allNodes: SceneGraphTreeNode[] = [];
  private highlightedNode: SceneGraphTreeNode | null = null;
  // private showAllNodes = false;
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

    // Show all nodes toggle
    // const showAllLabel = document.createElement("label");
    // showAllLabel.style.display = "flex";
    // showAllLabel.style.alignItems = "center";
    // showAllLabel.style.gap = "4px";
    // showAllLabel.style.cursor = "pointer";

    // const showAllCheckbox = document.createElement("input");
    // showAllCheckbox.type = "checkbox";
    // showAllCheckbox.checked = this.showAllNodes;
    // showAllCheckbox.onchange = () => {
    //   this.showAllNodes = showAllCheckbox.checked;
    //   this.renderTree();
    // };
    // showAllLabel.appendChild(showAllCheckbox);
    // showAllLabel.appendChild(document.createTextNode("Show all nodes"));

    // Refresh button
    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    refreshBtn.style.marginLeft = "auto";
    refreshBtn.style.cursor = "pointer";
    refreshBtn.onclick = () => this.refresh();

    // toolbar.appendChild(showAllLabel);
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
      this.renderTree();
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

      const treeNode: SceneGraphTreeNode = {
        node,
        worldTransform,
        noclipTransform,
        depth,
        isExpanded: depth < 2,
        hasGeomDescendants: false,
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

    const rootTreeNode = collectNode(this.sceneRoot, mat4.create(), 0, null);
    this.rootNodes = [rootTreeNode];
  }

  /**
   * Render the tree UI
   */
  private renderTree(): void {
    this.treeContainer.innerHTML = "";

    const renderNode = (treeNode: SceneGraphTreeNode): void => {
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

    // Main row
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.padding = "2px 4px";
    row.style.paddingLeft = `${8 + treeNode.depth * 16}px`;
    row.style.cursor = "pointer";
    row.style.borderRadius = "2px";
    row.style.transition = "background-color 0.1s";

    // Hover effects
    row.onmouseenter = () => {
      row.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
      this.onNodeHover(treeNode);
    };
    row.onmouseleave = () => {
      row.style.backgroundColor = "";
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
    if (isGeomNode) {
      typeBadge.style.backgroundColor = "#2a5";
      typeBadge.style.color = "#fff";
    } else {
      typeBadge.style.backgroundColor = "#555";
      typeBadge.style.color = "#aaa";
    }
    row.appendChild(typeBadge);

    // Node name
    const name = document.createElement("span");
    name.textContent = treeNode.node.name || "(unnamed)";
    name.style.color = isGeomNode ? "#fff" : "#888";
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
        const m = value.value;
        for (let r = 0; r < 4; r++) {
          const rowStr = `[${m[r * 4 + 0].toFixed(3)}, ${m[r * 4 + 1].toFixed(3)}, ${m[r * 4 + 2].toFixed(3)}, ${m[r * 4 + 3].toFixed(3)}]`;
          container.appendChild(
            this.createDebugValueRow(
              `row${r}`,
              { type: "string", value: rowStr },
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
   * Draw the highlighted node's AABB on the debug canvas
   * Called from the render loop
   */
  drawHighlightedAABB(clipFromWorldMatrix: ReadonlyMat4): void {
    if (!this.highlightedNode) return;
    if (!this.highlightedNode.localAABB) return;

    const ctx = getDebugOverlayCanvas2D();

    // Draw the AABB using the noclip transform
    // This draws the oriented bounding box (not axis-aligned in world space)
    drawWorldSpaceAABB(
      ctx,
      clipFromWorldMatrix,
      this.highlightedNode.localAABB,
      this.highlightedNode.noclipTransform,
      Cyan,
    );
  }

  /**
   * Check if the viewer is currently visible
   */
  isVisible(): boolean {
    return this.panel.elem.parentElement !== null;
  }
}
