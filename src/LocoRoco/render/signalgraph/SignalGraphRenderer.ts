/*
 * Renders the SignalGraph
 * 
 * petton-svn, 2026.
 */

import { LocoObject, RootObject, SubRoot } from "../../lib/blv.js";
import {
  SignalGraph,
  SignalNode,
  SignalEdge,
  hasNodeFor,
} from "./SignalGraph.js";
import { runLayout } from "./SignalLayout.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Radius of input/output socket circles (px).
const SOCKET_R = 5;

// Border radius of node boxes (px).
const BORDER_R = 5;

// Height of the node header area containing name and type (px).
const HEADER_H = 40;

// Height of each property row displayed between the header and sockets (px).
const PROP_ROW_TEXT_OFFSET_X = 4;
const PROP_ROW_TEXT_OFFSET_Y = 5;
const PROP_ROW_H = 16;

// Width of each node box in the SVG graph (px).
const NODE_W = 200;

// Vertical distance between consecutive sockets (px).
const SOCKET_SPACING = 18;

// General inner padding within a node box (px).
const PAD = 6;

// Truncates a string to `max` characters, replacing the last character with "…" if needed.
function ellipsize(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Creates an SVG element with the given tag and attributes.
// Attribute values are coerced to strings so callers can pass numbers directly.
function mkEl<T extends SVGElement>(
  tag: string,
  attrs: Record<string, string | number>,
): T {
  const el = document.createElementNS(SVG_NS, tag) as T;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

// Deterministic hue from a signal name.
export function sigColHue(name: string) : number {
  let h = 0;
  for (let i = 0; i < name.length; i++)
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360
}

// Deterministic HSL color from a signal name, used to visually distinguish wires.
function sigCol(name: string): string {
  const h = sigColHue(name);
  return `hsl(${h},70%,65%)`;
}

// Sets w, h, and socket y values for a node based on its content.
function measureNode(n: SignalNode): void {
  // Sockets start at this Y value.
  const sockBaseY = HEADER_H + n.displayedProperties.length * PROP_ROW_H + PAD / 2;
  const sockCount = Math.max(n.inputSockets.length, n.outputSockets.length, 1);
  n.w = NODE_W;
  n.h =
    HEADER_H +
    n.displayedProperties.length * PROP_ROW_H +
    PAD * 1.5 +
    sockCount * SOCKET_SPACING;
  for (let i = 0; i < n.inputSockets.length; i++)
    n.inputSockets[i].y = sockBaseY + i * SOCKET_SPACING + SOCKET_SPACING / 2;
  for (let i = 0; i < n.outputSockets.length; i++)
    n.outputSockets[i].y = sockBaseY + i * SOCKET_SPACING + SOCKET_SPACING / 2;
}

// Returns the path of graphs from the root down to the graph containing locoObj, or null.
function findPath(
  graph: SignalGraph,
  target: LocoObject | RootObject | SubRoot,
): SignalGraph[] | null {
  for (const n of graph.nodes) {
    if (n.owner === target) return [graph];
  }
  for (const n of graph.nodes) {
    if (n.innerGraph) {
      const sub = findPath(n.innerGraph, target);
      if (sub) return [graph, ...sub];
    }
  }
  return null;
}

// Color scheme for a node, determined by its type.
interface NodeColors {
  headerFill: string;
  bodyFill: string;
  bodyStroke: string;
  titleFill: string;
  subtitleFill: string;
  propNameFill: string;
  propValueFill: string;
}

function nodeColorsFromHue(hue: number): NodeColors {
  const hsl = (s: number, l: number) => `hsl(${hue}, ${s}%, ${l}%)`;
  return {
    headerFill:    hsl(35, 22),
    bodyFill:      hsl(28, 11),
    bodyStroke:    hsl(55, 45),
    titleFill:     hsl(100, 91),
    subtitleFill:  hsl(20, 52),
    propNameFill:  hsl(22, 61),
    propValueFill: hsl(45, 86),
  };
}

function nodeColors(gn: SignalNode): NodeColors {
  const isDrillable =
    gn.innerGraph !== null && gn.innerGraph.nodes.length > 0;
  if (gn.objectType === "junction") return nodeColorsFromHue(130);
  if (gn.objectType === "root") return nodeColorsFromHue(285);
  if (isDrillable) return nodeColorsFromHue(35);
  return nodeColorsFromHue(225);
}

// Builds the SVG <g> for a single graph node.
function buildNodeElement(gn: SignalNode): SVGGElement {
  const { headerFill, bodyFill, bodyStroke, titleFill, subtitleFill, propNameFill, propValueFill } = nodeColors(gn);
  const isDrillable =
    gn.innerGraph !== null && gn.innerGraph.nodes.length > 0;
  const w = gn.w;
  const h = gn.h;

  const nodeEl = document.createElementNS(SVG_NS, "g") as SVGGElement;
  nodeEl.setAttribute(
    "transform",
    `translate(${gn.layoutX},${gn.layoutY})`,
  );
  nodeEl.style.cursor = isDrillable ? "pointer" : "move";

  // Tooltip
  const titleEl = document.createElementNS(SVG_NS, "title");
  const hint = isDrillable ? " (double-click to enter)" : "";
  titleEl.textContent = `${gn.name}\nType: ${gn.objectType}${hint}\nIn: ${gn.inputSockets.map((s) => s.propName).join(", ") || "—"}\nOut: ${gn.outputSockets.map((s) => s.propName).join(", ") || "—"}`;
  nodeEl.appendChild(titleEl);

  // Shadow
  nodeEl.appendChild(
    mkEl("rect", {
      x: 2,
      y: 2,
      width: w,
      height: h,
      rx: BORDER_R,
      fill: "rgba(0,0,0,0.35)",
    }),
  );
  
  // Body fill
  nodeEl.appendChild(
    mkEl("rect", {
      x: 0,
      y: 0,
      width: w,
      height: h,
      rx: BORDER_R,
      fill: bodyFill,
    }),
  );

  // Header
  nodeEl.appendChild(
    mkEl("rect", {
      x: 0,
      y: 0,
      width: w,
      height: HEADER_H,
      rx: BORDER_R,
      fill: headerFill,
    }),
  );

  // Header bottom fill (covers the rounded corners at header/body boundary)
  nodeEl.appendChild(
    mkEl("rect", {
      x: 0,
      y: HEADER_H - BORDER_R,
      width: w,
      height: BORDER_R,
      fill: headerFill,
    }),
  );

  // Node name (in header)
  const nt = mkEl<SVGTextElement>("text", {
    x: w / 2,
    y: 15,
    "text-anchor": "middle",
    fill: titleFill,
    "font-size": 10,
    "font-family": "monospace",
  });
  nt.textContent = ellipsize(gn.name, Math.floor(w / 7));
  nodeEl.appendChild(nt);
  
  // Node type (in header)
  const tt = mkEl<SVGTextElement>("text", {
    x: w / 2,
    y: 28,
    "text-anchor": "middle",
    fill: subtitleFill,
    "font-size": 8,
    "font-family": "monospace",
  });
  tt.textContent = ellipsize(gn.objectType, Math.floor(w / 6));
  nodeEl.appendChild(tt);

  // Property rows
  gn.displayedProperties.forEach(({ name, value }, pi) => {
    const ry = HEADER_H + pi * PROP_ROW_H;
    if (pi % 2 !== (gn.displayedProperties.length % 2))
      nodeEl.appendChild(
        mkEl("rect", {
          x: 0,
          y: ry,
          width: w,
          height: PROP_ROW_H,
          fill: "rgba(255,255,255,0.04)",
        }),
      );

    const textY = ry + PROP_ROW_H - PROP_ROW_TEXT_OFFSET_Y;

    const pnt = mkEl<SVGTextElement>("text", {
      x: PROP_ROW_TEXT_OFFSET_X,
      y: textY,
      fill: propNameFill,
      "font-size": 8,
      "font-family": "monospace",
    });
    pnt.textContent = ellipsize(name, 20);
    nodeEl.appendChild(pnt);

    const pvt = mkEl<SVGTextElement>("text", {
      x: w - PROP_ROW_TEXT_OFFSET_X,
      y: textY,
      "text-anchor": "end",
      fill: propValueFill,
      "font-size": 8,
      "font-family": "monospace",
    });
    pvt.textContent = ellipsize(value, 20);
    nodeEl.appendChild(pvt);
  });

  // Outer border (drawn last so it sits on top of all content)
  nodeEl.appendChild(
    mkEl("rect", {
      x: 0,
      y: 0,
      width: w,
      height: h,
      rx: BORDER_R,
      fill: "none",
      stroke: bodyStroke,
      "stroke-width": 1,
    }),
  );

  // Input sockets
  gn.inputSockets.forEach(({ propName, y }) => {
    const c = sigCol(propName);
    nodeEl.appendChild(
      mkEl("circle", {
        cx: 0,
        cy: y,
        r: SOCKET_R,
        fill: c,
        stroke: "#111",
        "stroke-width": 1,
      }),
    );
    const lt = mkEl<SVGTextElement>("text", {
      x: SOCKET_R + 3,
      y: y + 4,
      fill: c,
      "font-size": 9,
      "font-family": "monospace",
    });
    lt.textContent = `${propName}`;
    nodeEl.appendChild(lt);
  });

  // Output sockets
  gn.outputSockets.forEach(({ propName, y }) => {
    const c = sigCol(propName);
    nodeEl.appendChild(
      mkEl("circle", {
        cx: w,
        cy: y,
        r: SOCKET_R,
        fill: c,
        stroke: "#111",
        "stroke-width": 1,
      }),
    );
    const lt = mkEl<SVGTextElement>("text", {
      x: w - SOCKET_R - 3,
      y: y + 4,
      "text-anchor": "end",
      fill: c,
      "font-size": 9,
      "font-family": "monospace",
    });
    lt.textContent = `${propName}`;
    nodeEl.appendChild(lt);
  });

  return nodeEl;
}

export interface SignalGraphRendererCallbacks {
  onNodeSelected(owner: LocoObject | RootObject | SubRoot | null): void;
}

interface NavStackEntry {
  graph: SignalGraph;
  vpX: number;
  vpY: number;
  vpScale: number;
  sourceNode?: SignalNode; // Focus on this node when returning to this entry.
}

// The fixed DOM scaffold for the overlay — created once per open() and never rebuilt.
interface OverlayDOM {
  overlay: HTMLDivElement;
  backBtn: HTMLButtonElement;
  breadcrumbEl: HTMLSpanElement;
  statsEl: HTMLSpanElement;
  closeBtn: HTMLButtonElement;
  svg: SVGSVGElement;
  vp: SVGGElement;
}

function createOverlayDOM(): OverlayDOM {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(10,10,20,0.93);z-index:10000;display:flex;flex-direction:column;font-family:monospace;";

  const hbar = document.createElement("div");
  hbar.style.cssText =
    "display:flex;align-items:center;gap:8px;padding:6px 12px;background:#16213e;border-bottom:1px solid #333;flex-shrink:0;";

  const backBtn = document.createElement("button");
  backBtn.textContent = "◀ Back";
  backBtn.style.cssText =
    "background:#2a4a6a;color:#adf;border:none;padding:3px 8px;border-radius:3px;cursor:pointer;font-size:12px;font-family:monospace;display:none;";
  hbar.appendChild(backBtn);

  const breadcrumbEl = document.createElement("span");
  breadcrumbEl.style.cssText =
    "color:#adf;font-size:13px;flex:1;font-weight:bold;";
  hbar.appendChild(breadcrumbEl);

  const statsEl = document.createElement("span");
  statsEl.style.cssText = "color:#888;font-size:11px;";
  hbar.appendChild(statsEl);

  const hintEl = document.createElement("span");
  hintEl.style.cssText = "color:#555;font-size:11px;";
  hintEl.textContent =
    "scroll=zoom · drag=pan · drag node=move · dblclick=enter";
  hbar.appendChild(hintEl);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText =
    "background:#c0392b;color:#fff;border:none;width:24px;height:24px;border-radius:3px;cursor:pointer;font-size:14px;line-height:1;";
  hbar.appendChild(closeBtn);
  overlay.appendChild(hbar);

  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText = "flex:1;display:block;cursor:grab;background:#0d0d1a;";
  overlay.appendChild(svg);

  // Defs: arrowhead
  const defs = document.createElementNS(SVG_NS, "defs");
  const mkr = document.createElementNS(SVG_NS, "marker");
  mkr.setAttribute("id", "sg-arrow");
  mkr.setAttribute("viewBox", "0 0 8 8");
  mkr.setAttribute("refX", "7");
  mkr.setAttribute("refY", "4");
  mkr.setAttribute("markerWidth", "5");
  mkr.setAttribute("markerHeight", "5");
  mkr.setAttribute("orient", "auto");
  const ap = document.createElementNS(SVG_NS, "path");
  ap.setAttribute("d", "M0,0 L8,4 L0,8 z");
  ap.setAttribute("fill", "#aaa");
  mkr.appendChild(ap);
  defs.appendChild(mkr);
  svg.appendChild(defs);

  const vp = document.createElementNS(SVG_NS, "g") as SVGGElement;
  svg.appendChild(vp);

  return { overlay, backBtn, breadcrumbEl, statsEl, closeBtn, svg, vp };
}

// Mutable view state for the overlay — grouped so the mutation surface is explicit.
interface ViewState {
  graph: SignalGraph;
  nodes: SignalNode[];
  nodeGEls: Map<SignalNode, SVGGElement>;
  edgeElems: Map<SignalEdge, SVGPathElement>;
  edgeHighlightElems: Map<SignalEdge, SVGPathElement>;
  selectedGn: SignalNode | null;
  vpX: number;
  vpY: number;
  vpScale: number;
}

function createViewState(rootGraph: SignalGraph): ViewState {
  return {
    graph: rootGraph,
    nodes: [],
    nodeGEls: new Map(),
    edgeElems: new Map(),
    edgeHighlightElems: new Map(),
    selectedGn: null,
    vpX: 0,
    vpY: 0,
    vpScale: 1,
  };
}

// Wires up all mouse/keyboard interaction on the SVG. Returns a cleanup function.
// `onClose` is called when the user dismisses the overlay (Escape at root, or close button).
function setupInteraction(
  dom: OverlayDOM,
  vs: ViewState,
  navStack: NavStackEntry[],
  callbacks: SignalGraphRendererCallbacks,
  onClose: () => void,
  showGraph: (g: SignalGraph, savedVP?: { vpX: number; vpY: number; vpScale: number }) => void,
  applyVP: () => void,
  centerOnNode: (gn: SignalNode) => void,
  updateEdges: () => void,
  applyNodeHighlight: (gn: SignalNode | null) => void,
): () => void {
  const { svg, vp, overlay, backBtn, closeBtn } = dom;

  type DragState =
    | { type: "pan"; mx0: number; my0: number; vx0: number; vy0: number }
    | {
        type: "node";
        mx0: number;
        my0: number;
        gn: SignalNode;
        nx0: number;
        ny0: number;
      };
  let drag: DragState | null = null;
  let dragMoved = false;
  let mousedownGn: SignalNode | null = null;
  let svgMousedownActive = false;

  const hitNodeAt = (e: MouseEvent): SignalNode | null => {
    let el: Element | null = e.target as Element;
    while (el && el.parentNode !== vp) el = el.parentElement;
    if (!el) return null;
    for (const [gn, gEl] of vs.nodeGEls)
      if (gEl === el) return gn;
    return null;
  };

  const onMouseDown = (e: MouseEvent) => {
    mousedownGn = hitNodeAt(e);
    dragMoved = false;
    svgMousedownActive = true;
    if (mousedownGn) {
      drag = {
        type: "node",
        mx0: e.clientX,
        my0: e.clientY,
        gn: mousedownGn,
        nx0: mousedownGn.layoutX,
        ny0: mousedownGn.layoutY,
      };
      svg.style.cursor = "move";
    } else {
      drag = {
        type: "pan",
        mx0: e.clientX,
        my0: e.clientY,
        vx0: vs.vpX,
        vy0: vs.vpY,
      };
      svg.style.cursor = "grabbing";
    }
    e.preventDefault();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!drag) return;
    dragMoved = true;
    if (drag.type === "pan") {
      vs.vpX = drag.vx0 + (e.clientX - drag.mx0);
      vs.vpY = drag.vy0 + (e.clientY - drag.my0);
      applyVP();
    } else {
      drag.gn.layoutX = drag.nx0 + (e.clientX - drag.mx0) / vs.vpScale;
      drag.gn.layoutY = drag.ny0 + (e.clientY - drag.my0) / vs.vpScale;
      vs.nodeGEls
        .get(drag.gn)!
        .setAttribute(
          "transform",
          `translate(${drag.gn.layoutX},${drag.gn.layoutY})`,
        );
      updateEdges();
    }
  };

  const onMouseUp = () => {
    drag = null;
    svg.style.cursor = "grab";
    if (svgMousedownActive && !dragMoved) {
      if (mousedownGn) {
        applyNodeHighlight(mousedownGn);
        callbacks.onNodeSelected(mousedownGn.owner);
      } else {
        applyNodeHighlight(null);
        callbacks.onNodeSelected(null);
      }
    }
    svgMousedownActive = false;
  };

  const onDblClick = (e: MouseEvent) => {
    if (dragMoved) return;
    const hitGn = hitNodeAt(e);
    if (hitGn?.innerGraph && hitGn.innerGraph.nodes.length > 0) {
      navStack.push({
        graph: vs.graph,
        vpX: vs.vpX,
        vpY: vs.vpY,
        vpScale: vs.vpScale,
        sourceNode: hitGn,
      });
      showGraph(hitGn.innerGraph);
    }
  };

  const goBack = () => {
    const prev = navStack.pop();
    if (!prev) return;
    showGraph(prev.graph, {
      vpX: prev.vpX,
      vpY: prev.vpY,
      vpScale: prev.vpScale,
    });
    if (prev.sourceNode != null) {
      requestAnimationFrame(() => {
        centerOnNode(prev.sourceNode!);
      });
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left,
      my = e.clientY - rect.top;
    const zoom = e.deltaY < 0 ? 1.1 : 0.9;
    vs.vpX = mx - (mx - vs.vpX) * zoom;
    vs.vpY = my - (my - vs.vpY) * zoom;
    vs.vpScale *= zoom;
    applyVP();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (navStack.length > 0) goBack();
      else onClose();
    }
  };

  const teardown = () => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    window.removeEventListener("keydown", onKey);
    overlay.remove();
  };

  svg.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  svg.addEventListener("dblclick", onDblClick);
  svg.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKey);
  backBtn.onclick = goBack;
  closeBtn.onclick = onClose;

  return teardown;
}

export class SignalGraphRenderer {
  private readonly laidOutGraphs = new Set<SignalGraph>();
  private closeCurrentOverlay: (() => void) | null = null;

  constructor(
    private readonly rootGraph: SignalGraph,
    private readonly callbacks: SignalGraphRendererCallbacks,
  ) {}

  public hasNodeFor(locoObject: LocoObject|RootObject|SubRoot): boolean {
    return hasNodeFor(this.rootGraph, locoObject);
  }

  public open(target?: LocoObject|RootObject|SubRoot): void {
    this.close();
    if (this.rootGraph.nodes.length === 0) {
      alert("No signal connections found in this level.");
      return;
    }
    this.buildOverlay(target);
  }

  public close(): void {
    this.closeCurrentOverlay?.();
  }

  private buildOverlay(target?: LocoObject | RootObject | SubRoot): void {
    const dom = createOverlayDOM();
    document.body.appendChild(dom.overlay);
  
    const { svg, vp, breadcrumbEl, statsEl, backBtn } = dom;

    const navStack: NavStackEntry[] = [];
    const vs = createViewState(this.rootGraph);

    // The border rect is always the last rect in each node <g>.
    const bodyRect = (el: SVGGElement) => {
      const rects = el.querySelectorAll("rect");
      return rects[rects.length - 1] as SVGRectElement | undefined;
    };

    const applyNodeHighlight = (gn: SignalNode | null) => {
      // Restore previous node border
      if (vs.selectedGn) {
        const prev = vs.nodeGEls.get(vs.selectedGn);
        if (prev) {
          const { bodyStroke } = nodeColors(vs.selectedGn);
          const br = bodyRect(prev);
          if (br) {
            br.setAttribute("stroke", bodyStroke);
            br.setAttribute("stroke-width", "1");
          }
        }
      }
      // Remove old edge highlights
      for (const p of vs.edgeHighlightElems.values()) p.remove();
      vs.edgeHighlightElems.clear();

      vs.selectedGn = gn;
      if (gn) {
        // Thicken selected node border
        const el = vs.nodeGEls.get(gn);
        if (el) {
          const br = bodyRect(el);
          if (br) {
            br.setAttribute("stroke", "#ffffff");
            br.setAttribute("stroke-width", "2.5");
          }
        }
        // Draw dotted white overlay on connected edges (inserted below nodes)
        const firstNode =
          vs.nodeGEls.size > 0
            ? vs.nodeGEls.values().next().value
            : null;
        for (const e of vs.graph.edges) {
          if (e.fromNode !== gn && e.toNode !== gn) continue;
          const src = vs.edgeElems.get(e);
          if (!src) continue;
          const p = src.cloneNode() as SVGPathElement;
          p.setAttribute("stroke", "#ffffff");
          p.setAttribute("stroke-width", "2");
          p.setAttribute("stroke-dasharray", "0,6");
          p.setAttribute("stroke-opacity", "0.85");
          p.setAttribute("stroke-linecap", "round");
          p.removeAttribute("marker-end");
          if (firstNode) vp.insertBefore(p, firstNode);
          else vp.appendChild(p);
          vs.edgeHighlightElems.set(e, p);
        }
      }
    };

    const applyVP = () =>
      vp.setAttribute(
        "transform",
        `translate(${vs.vpX},${vs.vpY}) scale(${vs.vpScale})`,
      );

    const centerOnNode = (gn: SignalNode) => {
      const rect = svg.getBoundingClientRect();
      vs.vpScale = 1;
      vs.vpX = rect.width / 2 - (gn.layoutX + gn.w / 2) * vs.vpScale;
      vs.vpY = rect.height / 2 - (gn.layoutY + gn.h / 2) * vs.vpScale;
      applyVP();
    };

    const updateEdges = () => {
      for (const e of vs.graph.edges) {
        const fn = e.fromNode;
        const tn = e.toNode;
        const x1 = fn.layoutX + fn.w,
          y1 = fn.layoutY + (fn.outputSockets[e.fromSockIdx]?.y ?? 0);
        const x2 = tn.layoutX,
          y2 = tn.layoutY + (tn.inputSockets[e.toSockIdx]?.y ?? 0);
        // Tangent scales with Euclidean distance and blends smoothly between
        // forward (gentle, coeff -> 0.25) and backward (strong loop, coeff -> 0.5)
        // using tanh so there's no hard switch at any point.
        const edgeDx = x2 - x1,
          edgeDy = y2 - y1;
        const edgeDist = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
        const tangent = edgeDist * (0.375 - 0.125 * Math.tanh(edgeDx / 150));
        const d = `M${x1},${y1} C${x1 + tangent},${y1} ${x2 - tangent},${y2} ${x2},${y2}`;
        vs.edgeElems.get(e)?.setAttribute("d", d);
        vs.edgeHighlightElems.get(e)?.setAttribute("d", d);
      }
    };

    const clearAllAndDrawGraph = (g: SignalGraph) => {
      // Clear SVG viewport content
      while (vp.firstChild) vp.removeChild(vp.firstChild);

      // Draw edges (behind nodes)
      for (const e of g.edges) {
        const outSockName = e.fromNode.outputSockets[e.fromSockIdx]?.propName;
        const p = mkEl<SVGPathElement>("path", {
          fill: "none",
          stroke: sigCol(outSockName),
          "stroke-width": "1.5",
          "stroke-opacity": "0.7",
          "marker-end": "url(#sg-arrow)",
        });
        vp.appendChild(p);
        vs.edgeElems.set(e, p);
      }

      // Draw nodes
      for (const gn of vs.nodes) {
        const nodeEl = buildNodeElement(gn);
        vp.appendChild(nodeEl);
        vs.nodeGEls.set(gn, nodeEl);
      }

      updateEdges();
    };

    const fitViewport = (savedVP?: { vpX: number; vpY: number; vpScale: number }) => {
      if (savedVP) {
        vs.vpX = savedVP.vpX;
        vs.vpY = savedVP.vpY;
        vs.vpScale = savedVP.vpScale;
      } else {
        const svgRect = svg.getBoundingClientRect();
        const graphW =
          Math.max(...vs.nodes.map((n) => n.layoutX + n.w)) + 80;
        const graphH =
          Math.max(...vs.nodes.map((n) => n.layoutY + n.h)) + 80;
        vs.vpScale = Math.min(1, svgRect.width / graphW, svgRect.height / graphH);
        vs.vpX = (svgRect.width - graphW * vs.vpScale) / 2;
        vs.vpY = (svgRect.height - graphH * vs.vpScale) / 2;
      }
      applyVP();
    };

    const updateChrome = (g: SignalGraph) => {
      const crumbs = navStack.map((s) => s.graph.name).concat(g.name);
      breadcrumbEl.textContent = crumbs.join(" › ");
      statsEl.textContent = `${vs.nodes.length} nodes · ${g.edges.length} edges`;
      backBtn.style.display = navStack.length > 0 ? "" : "none";
    };

    const showGraph = (
      g: SignalGraph,
      savedVP?: { vpX: number; vpY: number; vpScale: number },
    ) => {
      // Update view state for the new graph
      vs.graph = g;
      vs.nodes = g.nodes;
      vs.nodeGEls = new Map();
      vs.edgeElems = new Map();
      vs.selectedGn = null;
      vs.edgeHighlightElems.clear();

      if (!this.laidOutGraphs.has(g)) {
        for (const n of vs.nodes) measureNode(n);
        runLayout(g);
        this.laidOutGraphs.add(g);
      }

      clearAllAndDrawGraph(g);
      fitViewport(savedVP);
      updateChrome(g);
    };

    // Wire up interaction and get the teardown function.
    // `onClose` is what Escape/close-button call — it tears down and nulls the reference.
    // `this.close()` also calls `this.closeCurrentOverlay` which does the same thing,
    // so both paths converge and double-calls are safe because teardown is idempotent.
    const onClose = () => {
      teardown();
      this.closeCurrentOverlay = null;
    };
    const teardown = setupInteraction(
      dom, vs, navStack, this.callbacks, onClose,
      showGraph, applyVP, centerOnNode, updateEdges, applyNodeHighlight,
    );
    this.closeCurrentOverlay = onClose;

    showGraph(this.rootGraph);

    if (target) {
      // Navigate to the correct (possibly nested) graph, building the navStack along the way.
      const path = findPath(this.rootGraph, target);
      if (path) {
        for (let i = 0; i < path.length - 1; i++) {
          const srcNode = vs.nodes.find(
            (gn) => gn.innerGraph === path[i + 1],
          );
          navStack.push({
            graph: vs.graph,
            vpX: vs.vpX,
            vpY: vs.vpY,
            vpScale: vs.vpScale,
            sourceNode: srcNode,
          });
          showGraph(path[i + 1]);
        }
      }
      // Center and highlight after layout paint.
      requestAnimationFrame(() => {
        const targetGn = vs.nodes.find(
          (gn) => gn.owner === target,
        );
        if (!targetGn) return;
        centerOnNode(targetGn);
        applyNodeHighlight(targetGn);
      });
    }
  }
}
