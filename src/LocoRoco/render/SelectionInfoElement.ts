/**
 * Popup at the bottom left of the screen that shows information about the selected element.
 *
 * petton-svn, 2026.
 */

import {
  LocoObject,
  RootObject,
  SubRoot,
  PropTypeId,
  Mesh,
  Vec3,
  BufferPtr,
  AnimationTrack,
  AnimationTrackFileType,
} from "../lib/blv.js";
import { objIsColor } from "../../Color.js";
import { SceneNode, SceneTree, NodeAnimation } from "../SceneTree.js";
import { getTrackSampleTime } from "./SceneUpdate.js";

export interface SelectionInfoCallbacks {
  hasSignals(owner: LocoObject | RootObject | SubRoot): boolean;
  onNodeSelected(node: SceneNode | null): void;
  onShowSignals(owner: LocoObject | RootObject | SubRoot): void;
  onZoomTo(target: SceneNode): void;
}

// ── Styling ─────────────────────────────────────────────────────────────────

const CONTAINER_STYLE = `
  position: fixed;
  bottom: 10px;
  left: 10px;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 10px;
  font-family: monospace;
  font-size: 12px;
  border-radius: 4px;
  max-width: 400px;
  max-height: 40vh;
  overflow-y: auto;
  z-index: 10001;
  white-space: pre-wrap;
  word-break: break-all;
`;
const CHIP_BTN_STYLE = `cursor:pointer;background:#333;border:1px solid #666;border-radius:3px;padding:0 4px;color:#aaa;`;
const PLAY_BTN_STYLE_PREFIX = `cursor: pointer; background: #333; border: 1px solid #666; border-radius: 3px; padding: 0 4px; white-space:nowrap;`;
const RESTART_BTN_STYLE = `cursor: pointer; background: #333; border: 1px solid #666; border-radius: 3px; padding: 0 4px; color: #ff88ff; white-space:nowrap;`;
const LINK_STYLE = `cursor:pointer;text-decoration:underline dotted;`;

// ── Small helpers ───────────────────────────────────────────────────────────

interface AnimVisualState {
  statusLabel: "PLAYING" | "PAUSED" | "INACTIVE";
  statusColor: string;
  btnLabel: "Play" | "Pause";
  btnColor: string;
}

function getAnimVisualState(nodeAnim: NodeAnimation): AnimVisualState {
  if (!nodeAnim.isActive)
    return { statusLabel: "INACTIVE", statusColor: "#888", btnLabel: "Play", btnColor: "#00ff00" };
  if (nodeAnim.isPlaying)
    return { statusLabel: "PLAYING", statusColor: "#00ff00", btnLabel: "Pause", btnColor: "#ffaa00" };
  return { statusLabel: "PAUSED", statusColor: "#ffaa00", btnLabel: "Play", btnColor: "#00ff00" };
}

function fileTrackTypeName(fileType: AnimationTrackFileType): string {
  switch (fileType) {
    case AnimationTrackFileType.BufferSwitch: return "texture swap";
    case AnimationTrackFileType.UScroll: return "U scroll";
    case AnimationTrackFileType.VScroll: return "V scroll";
    default: return `type ${fileType}`;
  }
}

function hasBoundsInSubtree(node: SceneNode): boolean {
  if (node.meshInstances.length > 0) return true;
  if (node.pathLines.some((p) => p.strips.some((s) => s.length > 0))) return true;
  return node.children.some(hasBoundsInSubtree);
}

/** The node we should focus the camera on when "Zoom to" is clicked: the selection itself,
 *  or the nearest ancestor that actually contains geometry. */
function findZoomTarget(node: SceneNode): SceneNode | null {
  if (hasBoundsInSubtree(node)) return node;
  for (let sn = node.parent; sn !== null; sn = sn.parent) {
    if (hasBoundsInSubtree(sn)) return sn;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────

export class SelectionInfoElement {
  private element: HTMLDivElement | null = null;
  private currentNode: SceneNode | null = null;

  // Expansion state for every collapsible element in the panel. Keys without a prefix
  // (e.g. "mesh", "anims") persist across node changes; keys starting with "anim:" or
  // "track:" are per-node and cleared in `setNode`.
  private expandedKeys: Set<string> = new Set();

  // Populated by `buildAnimationsSection`; consumed by `update`.
  private liveAnimData: {
    animIdx: number;
    nodeAnim: NodeAnimation;
    tracks: { name: string; track: AnimationTrack }[];
  }[] = [];
  private animIdxToNodeAnim: Map<number, NodeAnimation> = new Map();

  constructor(
    private readonly sceneTree: SceneTree,
    private readonly callbacks: SelectionInfoCallbacks,
  ) {}

  // ── Public API ───────────────────────────────────────────────────────────

  setNode(node: SceneNode | null): void {
    if (node === this.currentNode)
      return;

    this.currentNode = node;
    // Clear per-node keys but keep the top-level section state.
    for (const key of this.expandedKeys) {
      if (key.startsWith("anim:") || key.startsWith("track:")) this.expandedKeys.delete(key);
    }
    this.liveAnimData = [];
    this.animIdxToNodeAnim.clear();
    this.refresh();
  }

  update(): void {
    if (!this.element) return;

    // Refresh status/button chips for every visible animation row.
    this.animIdxToNodeAnim.forEach((nodeAnim, animIdx) => {
      this.updateAnimStatusRow(animIdx, nodeAnim);
    });

    // Refresh time/frame/keyframe info for expanded rows only.
    for (const { animIdx, nodeAnim, tracks } of this.liveAnimData) {
      this.updateLiveAnimRow(animIdx, nodeAnim, tracks);
    }
  }

  destroy(): void {
    this.element?.remove();
  }

  // ── Refresh: full HTML rebuild + event wiring ───────────────────────────

  private getOrCreateElement(): HTMLDivElement {
    if (!this.element) {
      this.element = document.createElement("div");
      this.element.style.cssText = CONTAINER_STYLE;
      document.body.appendChild(this.element);
    }
    return this.element;
  }

  private refresh(): void {
    const el = this.getOrCreateElement();
    const node = this.currentNode;

    if (!node) {
      el.style.display = "none";
      return;
    }

    const hasDebugMesh = node.meshInstances.some((m) => m.isDebug);
    const hasSignals = node.owner !== null && this.callbacks.hasSignals(node.owner);
    const zoomTarget = findZoomTarget(node);
    const ancestors = this.buildAncestorChain(node);

    // Note: `buildAnimationsSection` has the side effect of populating
    // `liveAnimData`/`animIdxToNodeAnim` for the next `update` tick.
    const { items: animItems, displayedCount: animCount } = this.buildAnimationsSection(node);

    el.style.display = "block";
    el.innerHTML = [
      this.renderHeaderRow(hasDebugMesh, hasSignals, zoomTarget !== null),
      this.renderIdentityRow(node, this.renderBreadcrumb(ancestors)),
      this.renderMeshSection(node),
      this.renderCollapsibleSection("anims", `Animations (${animCount})`, animItems),
      this.renderPropsSection(node),
      `<div style="padding-bottom:6px;">${this.renderChildrenSection(node)}</div>`,
      `<i>Click again to cycle through overlapping objects</i>`,
    ].join("\n");

    this.wireHeaderButtons(el, node, zoomTarget);
    this.wireCollapsibles(el);
    this.wireNavigationLinks(el, node, ancestors);
    this.wireAnimationControls(el);
  }

  // ── Section renderers ────────────────────────────────────────────────────

  private buildAncestorChain(node: SceneNode): SceneNode[] {
    const ancestors: SceneNode[] = [];
    for (let sn: SceneNode | null = node; sn !== null && sn.parent !== null; sn = sn.parent) {
      ancestors.push(sn);
    }
    ancestors.reverse();
    return ancestors;
  }

  private renderBreadcrumb(ancestors: SceneNode[]): string {
    const separator = `<span style="color:#999;margin:0 2px">»</span>`;
    return ancestors
      .map((sn, i) => `<span data-ancestor-idx="${i}" style="${LINK_STYLE}">${sn.name}</span>`)
      .join(separator);
  }

  private renderHeaderRow(hasDebugMesh: boolean, hasSignals: boolean, hasZoomTarget: boolean): string {
    const debugBadge = hasDebugMesh ? ' <span style="color: #ffee00;">[DEBUG OVERLAY]</span>' : "";
    const signalsBtn = hasSignals ? `<span data-showsignals style="${CHIP_BTN_STYLE}">Show Signals</span>` : "";
    const zoomBtn = hasZoomTarget ? `<span data-zoomto style="${CHIP_BTN_STYLE}">Zoom to</span>` : "";
    const deselectBtn = `<span data-deselect style="${CHIP_BTN_STYLE}">Deselect</span>`;

    return (
      `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-bottom:4px">` +
        `<b style="flex-shrink:0">Selected Object${debugBadge}</b>` +
        `<span style="display:flex;gap:4px;flex-shrink:0;margin-left:auto;white-space:nowrap">` +
          signalsBtn + zoomBtn + deselectBtn +
        `</span>` +
      `</div>`
    );
  }

  private renderIdentityRow(node: SceneNode, pathHtml: string): string {
    return (
      `<div style="display:grid;grid-template-columns:max-content 1fr;gap:1px 8px;margin-bottom:4px">` +
        `<b>Name:</b><span>${node.name}</span>` +
        `<b>Type:</b><span>${node.objectType}</span>` +
        `<b>Path:</b><span>${pathHtml}</span>` +
      `</div>`
    );
  }

  private renderMeshSection(node: SceneNode): string {
    let totalTriangles = 0;
    for (const mi of node.meshInstances) totalTriangles += mi.gpuResources.drawCount / 3;

    const items = node.meshInstances.map((m, i) => {
      const parts: string[] = [`<span style="color: #aaa;">[${i}]</span>`];
      if (m.material) parts.push(`matType=${m.material.materialType}`);
      if (m.file) {
        const texMode = m.file.textureMode === 0x10200 ? "repeat" : "clamp";
        parts.push(`fileType=${m.file.fileType} texMode=${texMode} unk5=${m.file.unk5} unk6=${m.file.unk6.toFixed(3)}`);
      }
      if (!m.material && !m.file) parts.push(`(no material/file)`);
      return parts.join(" ");
    });

    const label = `Mesh instances (${node.meshInstances.length}, total ${Math.round(totalTriangles)} triangles)`;
    return this.renderCollapsibleSection("mesh", label, items);
  }

  private renderChildrenSection(node: SceneNode): string {
    const items = node.children.map((child, i) => {
      const name = child.name || "(unnamed)";
      const type = child.objectType || "?";
      return `<span data-child-idx="${i}" style="${LINK_STYLE}">${name} <span style="color:#888;">(${type})</span></span>`;
    });
    return this.renderCollapsibleSection("children", `Children (${node.children.length})`, items);
  }

  private renderPropsSection(node: SceneNode): string {
    const objProps = node.owner instanceof LocoObject ? node.owner.properties : [];
    const items = objProps.map((prop) => {
      const typeName = SelectionInfoElement.PROP_TYPE_NAMES[prop.typeId];
      const arity = prop.valueCount > 1 ? `[${prop.valueCount}]` : "";
      return `<b>${prop.name}</b>: ${prop.formatValue()} <span style="color:#888;">${typeName}${arity}</span>`;
    });
    return this.renderCollapsibleSection("props", `Properties (${objProps.length})`, items);
  }

  /** Render a collapsible section. The `key` identifies this section for expansion-state
   *  persistence across refreshes, and is also used by `wireCollapsibles` to attach the
   *  click handler after the HTML is inserted into the DOM. Callers don't need to know
   *  about wiring - just pass a unique key. */
  private renderCollapsibleSection(
    key: string,
    label: string,
    items: string[],
  ): string {
    if (items.length === 0) {
      return `<span style="color:#555;">[ ] ${label}</span>`;
    }
    const expanded = this.expandedKeys.has(key);
    const bracket = expanded ? "[-]" : "[+]";
    const header = `<span data-collapsible="${key}" style="cursor:pointer;"><span style="color:#66aaff;">${bracket}</span> ${label}</span>`;
    if (!expanded) return header;
    const itemsHtml = items.map((item) => `<div style="margin:1px 0;">${item}</div>`).join("");
    return `${header}\n<div style="padding-left:1.5em;">${itemsHtml}</div>`;
  }

  /** Paired with `renderCollapsibleSection`: attaches click handlers to every collapsible
   *  section header in `el`. Must be called after setting `el.innerHTML`. */
  private wireCollapsibles(el: HTMLDivElement): void {
    for (const target of Array.from(el.querySelectorAll("[data-collapsible]"))) {
      target.addEventListener("click", (e: Event) => {
        e.stopPropagation();
        const key = (target as HTMLElement).dataset.collapsible!;
        if (this.expandedKeys.has(key)) this.expandedKeys.delete(key);
        else this.expandedKeys.add(key);
        this.refresh();
      });
    }
  }

  // ── Event wiring ─────────────────────────────────────────────────────────

  private wireHeaderButtons(el: HTMLDivElement, node: SceneNode, zoomTarget: SceneNode | null): void {
    el.querySelector("[data-deselect]")?.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      this.callbacks.onNodeSelected(null);
      this.setNode(null);
    });

    el.querySelector("[data-showsignals]")?.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      this.callbacks.onShowSignals(node.owner!);
    });

    if (zoomTarget !== null) {
      el.querySelector("[data-zoomto]")?.addEventListener("click", (e: Event) => {
        e.stopPropagation();
        this.callbacks.onZoomTo(zoomTarget);
      });
    }
  }

  private wireNavigationLinks(el: HTMLDivElement, node: SceneNode, ancestors: SceneNode[]): void {
    const selectNode = (target: SceneNode | undefined) => {
      if (!target) return;
      this.callbacks.onNodeSelected(target);
      this.setNode(target);
    };

    this.wireIndexedClick(el, "[data-child-idx]",    "childIdx",    (i) => selectNode(node.children[i]));
    this.wireIndexedClick(el, "[data-ancestor-idx]", "ancestorIdx", (i) => selectNode(ancestors[i]));
  }

  private wireAnimationControls(el: HTMLDivElement): void {
    // Expand/collapse an animation row. (Each row has two [data-anim-idx] spans -
    // the bracket and the name - either one toggles the row.)
    this.wireIndexedClick(el, "[data-anim-idx]", "animIdx", (idx) => {
      const key = `anim:${idx}`;
      if (this.expandedKeys.has(key)) this.expandedKeys.delete(key);
      else this.expandedKeys.add(key);
      this.refresh();
    });

    // Play/pause - activating an inactive animation deactivates all its siblings.
    this.wireIndexedClick(el, "[data-anim-play]", "animPlay", (idx) => {
      const nodeAnim = this.animIdxToNodeAnim.get(idx);
      if (!nodeAnim) return;
      if (nodeAnim.isActive) {
        nodeAnim.isPlaying = !nodeAnim.isPlaying;
      } else {
        this.animIdxToNodeAnim.forEach((na) => { na.isActive = false; na.isPlaying = false; });
        nodeAnim.isActive = true;
        nodeAnim.isPlaying = true;
      }
      this.refresh();
    });

    // Restart: jump to t=0.
    this.wireIndexedClick(el, "[data-anim-restart]", "animRestart", (idx) => {
      const nodeAnim = this.animIdxToNodeAnim.get(idx);
      if (!nodeAnim) return;
      nodeAnim.currentTime = 0;
      nodeAnim.trackTimes.clear();
      this.refresh();
    });
  }

  /** Bind a click handler to every element matching `selector`, parsing its `dataset[datasetKey]` as an int. */
  private wireIndexedClick(
    el: HTMLDivElement,
    selector: string,
    datasetKey: string,
    handler: (idx: number) => void,
  ): void {
    for (const target of Array.from(el.querySelectorAll(selector))) {
      target.addEventListener("click", (e: Event) => {
        e.stopPropagation();
        const idx = parseInt((target as HTMLElement).dataset[datasetKey]!, 10);
        handler(idx);
      });
    }
  }

  // ── Live-update helpers (per animation frame) ───────────────────────────

  private updateAnimStatusRow(animIdx: number, nodeAnim: NodeAnimation): void {
    const el = this.element!;
    const { statusLabel, statusColor, btnLabel, btnColor } = getAnimVisualState(nodeAnim);

    const statusEl = el.querySelector(`[data-live-playing="${animIdx}"]`) as HTMLElement | null;
    if (statusEl) {
      statusEl.textContent = `[${statusLabel}]`;
      statusEl.style.color = statusColor;
    }

    const playBtnEl = el.querySelector(`[data-anim-play="${animIdx}"]`) as HTMLElement | null;
    if (playBtnEl) {
      playBtnEl.textContent = btnLabel;
      playBtnEl.style.color = btnColor;
    }

    // The Restart wrapper only exists in the DOM for non-looping animations; inside it,
    // the actual button is created/destroyed as the animation becomes active/inactive.
    const restartWrap = el.querySelector(`[data-anim-restart-wrap="${animIdx}"]`) as HTMLElement | null;
    if (!restartWrap) return;

    const shouldShow = nodeAnim.isActive;
    const alreadyShown = !!restartWrap.querySelector(`[data-anim-restart="${animIdx}"]`);

    if (shouldShow && !alreadyShown) {
      restartWrap.innerHTML = ` <span data-anim-restart="${animIdx}" style="${RESTART_BTN_STYLE}">Restart</span>`;
      restartWrap.querySelector(`[data-anim-restart="${animIdx}"]`)!
        .addEventListener("click", (e: Event) => {
          e.stopPropagation();
          nodeAnim.currentTime = 0;
          nodeAnim.trackTimes.clear();
          this.refresh();
        });
    } else if (!shouldShow) {
      restartWrap.innerHTML = "";
    }
  }

  private updateLiveAnimRow(
    animIdx: number,
    nodeAnim: NodeAnimation,
    tracks: { name: string; track: AnimationTrack }[],
  ): void {
    const el = this.element!;
    const part = nodeAnim.namedPart.part;
    if (!part) return;

    const animDur = part.endTime - part.startTime;
    const timeEl = el.querySelector(`[data-live-time="${animIdx}"]`);
    if (timeEl) {
      timeEl.textContent = `${nodeAnim.currentTime.toFixed(2)} / ${animDur.toFixed(2)}`;
    }

    for (let ti = 0; ti < tracks.length; ti++) {
      const { track } = tracks[ti];
      if (track.data.length === 0) continue;

      const t = getTrackSampleTime(nodeAnim, track);
      const { frameIndex, frac } = track.sampleFrame(t);

      const valEl = el.querySelector(`[data-live-track-val="${animIdx}-${ti}"]`) as HTMLElement | null;
      if (valEl) valEl.textContent = this.sampleTrackValueStr(nodeAnim, track);

      const trackCur = (nodeAnim.trackTimes.get(track) || 0).toFixed(2);
      const trackDur = (track.endTime - track.startTime).toFixed(2);
      const detailEl = el.querySelector(`[data-live-track-detail="${animIdx}-${ti}"]`) as HTMLElement | null;
      if (detailEl) {
        detailEl.textContent = `frame ${frameIndex}, frac ${frac.toFixed(3)}, t ${trackCur}/${trackDur}`;
      }

      // Highlight the two frames currently being interpolated.
      const nextIndex = Math.min(frameIndex + 1, track.data.length - 1);
      for (let ki = 0; ki < track.data.length; ki++) {
        const kfEl = el.querySelector(`[data-kf="${animIdx}-${ti}-${ki}"]`) as HTMLElement | null;
        if (!kfEl) continue;
        kfEl.style.color = (ki === frameIndex || ki === nextIndex) ? "#00ff00" : "#aaa";
      }
    }
  }

  // ── Animations section: HTML building + state population ────────────────

  private collectAnimationsForNode(targetNode: SceneNode): NodeAnimation[] {
    const path: SceneNode[] = [];
    const findPath = (n: SceneNode): boolean => {
      path.push(n);
      if (n === targetNode) return true;
      for (const child of n.children) {
        if (findPath(child)) return true;
      }
      path.pop();
      return false;
    };
    if (!findPath(this.sceneTree.root)) return [];

    const anims: NodeAnimation[] = [];
    for (const ancestor of path) {
      for (const anim of ancestor.animations) anims.push(anim);
    }
    return anims;
  }

  /** Build HTML items for the Animations section. Also populates `liveAnimData` and
   *  `animIdxToNodeAnim` so subsequent `update` calls can update the DOM in place. */
  private buildAnimationsSection(node: SceneNode): { items: string[]; displayedCount: number } {
    const obj = node.owner;
    if (!(obj instanceof LocoObject)) {
      return {
        items: ['<span style="color: #888;">No object selected</span>'],
        displayedCount: 0,
      };
    }

    this.liveAnimData = [];
    this.animIdxToNodeAnim = new Map();

    const { objMaterials, objFiles } = this.collectObjectMaterialsAndFiles(obj);

    const items: string[] = [];
    let displayedCount = 0;
    let globalAnimIdx = 0;

    for (const nodeAnim of this.collectAnimationsForNode(node)) {
      const part = nodeAnim.namedPart.part;
      // `globalAnimIdx` must always advance so indices remain stable across refreshes,
      // even for animations we skip.
      if (!part) { globalAnimIdx++; continue; }

      const affectsSelection =
        part.objectToAnimatedProperties.has(obj) ||
        part.fileAnimationTracks.some((ftp) => ftp.track?.file && objFiles.has(ftp.track.file)) ||
        part.colorAnimationTracks.some((ctp) => ctp.track?.material && objMaterials.has(ctp.track.material));
      if (!affectsSelection) { globalAnimIdx++; continue; }

      const animIdx = globalAnimIdx++;
      this.animIdxToNodeAnim.set(animIdx, nodeAnim);
      items.push(this.buildAnimationItem(animIdx, nodeAnim, obj, objFiles, objMaterials));
      displayedCount++;
    }

    return { items, displayedCount };
  }

  private collectObjectMaterialsAndFiles(obj: LocoObject): { objMaterials: Set<any>; objFiles: Set<any> } {
    const objMaterials = new Set<any>();
    const objFiles = new Set<any>();
    const mesh = this.getProperty(obj, "mesh");
    if (mesh instanceof Mesh) {
      for (const component of mesh.meshComponents) {
        if (!component.material) continue;
        objMaterials.add(component.material);
        if (component.material.file) objFiles.add(component.material.file);
      }
    }
    return { objMaterials, objFiles };
  }

  private buildAnimationItem(
    animIdx: number,
    nodeAnim: NodeAnimation,
    obj: LocoObject,
    objFiles: Set<any>,
    objMaterials: Set<any>,
  ): string {
    const part = nodeAnim.namedPart.part!;
    const isExpanded = this.expandedKeys.has(`anim:${animIdx}`);
    const animName = nodeAnim.namedPart.name?.trim() ? nodeAnim.namedPart.name : "(no name)";

    const { statusLabel, statusColor, btnLabel, btnColor } = getAnimVisualState(nodeAnim);
    const bracket = isExpanded ? "[-]" : "[+]";

    // The Restart wrapper only exists for non-looping animations; its inner button is
    // shown/hidden at runtime by `updateAnimStatusRow`.
    const isNonLooping = part.endTime === 0 && part.startTime === 0;
    const restartHtml = isNonLooping ? this.buildRestartWrapperHtml(animIdx, nodeAnim.isActive) : "";

    const header =
      `<span data-anim-idx="${animIdx}" style="cursor:pointer;"><span style="color:#66aaff;">${bracket}</span></span> ` +
      `<span data-anim-idx="${animIdx}" style="cursor:pointer;">${animName}</span> ` +
      `<span data-live-playing="${animIdx}" style="color: ${statusColor};">[${statusLabel}]</span> ` +
      `<span data-anim-play="${animIdx}" style="${PLAY_BTN_STYLE_PREFIX} color: ${btnColor};">${btnLabel}</span>` +
      restartHtml;

    if (!isExpanded) return header;

    const body = this.buildExpandedAnimationBody(animIdx, nodeAnim, obj, objFiles, objMaterials);
    return `${header}\n<div style="padding-left:1.5em;">${body}</div>`;
  }

  private buildRestartWrapperHtml(animIdx: number, buttonVisible: boolean): string {
    const inner = buttonVisible
      ? ` <span data-anim-restart="${animIdx}" style="${RESTART_BTN_STYLE}">Restart</span>`
      : "";
    return `<span data-anim-restart-wrap="${animIdx}">${inner}</span>`;
  }

  private buildExpandedAnimationBody(
    animIdx: number,
    nodeAnim: NodeAnimation,
    obj: LocoObject,
    objFiles: Set<any>,
    objMaterials: Set<any>,
  ): string {
    const part = nodeAnim.namedPart.part!;
    const animDur = part.endTime - part.startTime;

    const subItems: string[] = [
      `Time: <span data-live-time="${animIdx}">${nodeAnim.currentTime.toFixed(2)} / ${animDur.toFixed(2)}</span>`,
    ];
    const liveTracks: { name: string; track: AnimationTrack }[] = [];
    let trackIdx = 0;

    const addTrack = (track: AnimationTrack, name: string, extraDetail: string) => {
      subItems.push(this.buildTrackSubItem(animIdx, trackIdx, nodeAnim, track, name, extraDetail));
      liveTracks.push({ name, track });
      trackIdx++;
    };

    // 1. Property animations
    const animatedProps = part.objectToAnimatedProperties.get(obj);
    if (animatedProps !== undefined) {
      for (const prop of animatedProps.properties) {
        if (prop.data) addTrack(prop.data, prop.propertyName, `unk5=${prop.data.unk5}`);
      }
    }

    // 2. File animations (texture swap, UV scroll, ...)
    for (const fileTrackPtr of part.fileAnimationTracks) {
      const fileTrack = fileTrackPtr.track;
      if (!fileTrack?.file || !objFiles.has(fileTrack.file)) continue;
      const label = `${fileTrack.file.name || "(unnamed)"} (${fileTrackTypeName(fileTrackPtr.fileType)})`;
      addTrack(fileTrack, label, `unk5=${fileTrack.unk5}`);
    }

    // 3. Material color animations
    for (const colorTrackPtr of part.colorAnimationTracks) {
      const colorTrack = colorTrackPtr.track;
      if (!colorTrack?.material || !objMaterials.has(colorTrack.material)) continue;
      addTrack(
        colorTrack,
        `Material color: ${colorTrack.material.name || "(unnamed)"}`,
        `unk5=${colorTrack.unk5}`,
      );
    }

    this.liveAnimData.push({ animIdx, nodeAnim, tracks: liveTracks });
    return subItems.map((s) => `<div style="margin:1px 0;">${s}</div>`).join("");
  }

  private buildTrackSubItem(
    animIdx: number,
    trackIdx: number,
    nodeAnim: NodeAnimation,
    track: AnimationTrack,
    name: string,
    extraDetail: string,
  ): string {
    const initVal = this.sampleTrackValueStr(nodeAnim, track);
    const label = `${name}: <span data-live-track-val="${animIdx}-${trackIdx}">${initVal}</span>`;

    const trackItems: string[] = [
      `<span data-live-track-detail="${animIdx}-${trackIdx}" style="color:#ffcc00;"></span>`,
      `<span style="color:#888;">${extraDetail}</span>`,
      `<span style="color:#888;">start=${track.startTime} end=${track.endTime} dur=${track.duration} elemDur=${track.elementDuration} keys=${track.data.length}</span>`,
    ];
    for (let i = 0; i < track.data.length; i++) {
      const t = track.startTime + i * track.elementDuration;
      trackItems.push(
        `<span data-kf="${animIdx}-${trackIdx}-${i}" style="color:#aaa;">[${i}] t=${t.toFixed(2)}  ${this.formatTrackValue(track.data[i])}</span>`,
      );
    }
    return this.renderCollapsibleSection(`track:${animIdx}-${trackIdx}`, label, trackItems);
  }

  // ── Value formatting ─────────────────────────────────────────────────────

  private getProperty(obj: LocoObject, name: string): any {
    for (const prop of obj.properties) {
      if (prop.name === name) return prop.value;
    }
    return null;
  }

  /** Format any animation value — keyframe or sampled — as a string. */
  private formatTrackValue(val: any): string {
    if (val === null) return "(null)";
    if (val instanceof Vec3)
      return `(${val.x.toFixed(4)}, ${val.y.toFixed(4)}, ${val.z.toFixed(4)})`;
    if (objIsColor(val))
      return `rgba(${val.r.toFixed(1)}, ${val.g.toFixed(1)}, ${val.b.toFixed(1)}, ${val.a.toFixed(1)})`;
    if (val instanceof BufferPtr)
      return val.buffer
        ? `buf ${val.buffer.width}x${val.buffer.height} fmt=${val.buffer.textureFormat}`
        : "(null)";
    if (typeof val === "boolean") return val ? "true" : "false";
    if (typeof val === "number") return val.toFixed(4);
    return String(val);
  }

  /** Sample a track at the animation's current time and format the result as a string. */
  private sampleTrackValueStr(nodeAnim: NodeAnimation, track: AnimationTrack): string {
    if (track.data.length === 0) return "--";
    return this.formatTrackValue(track.sample(getTrackSampleTime(nodeAnim, track)));
  }

  private static readonly PROP_TYPE_NAMES: Record<PropTypeId, string> = {
    [PropTypeId.Bool]: "bool",
    [PropTypeId.Int]: "int32",
    [PropTypeId.Float]: "float32",
    [PropTypeId.StringPtr]: "string",
    [PropTypeId.Vec2]: "vec2",
    [PropTypeId.Vec3]: "vec3",
    [PropTypeId.BinaryData]: "binary",
    [PropTypeId.Tabtable]: "tabtable",
    [PropTypeId.SubRoot]: "subroot",
    [PropTypeId.InputSignal]: "inputsignal",
    [PropTypeId.FFTerminatedIntList]: "intlist",
    [PropTypeId.Polygon]: "polygon",
    [PropTypeId.Mesh]: "mesh",
    [PropTypeId.Box]: "box",
    [PropTypeId.RotRect]: "rotrect",
    [PropTypeId.InSignalPtr]: "insignal",
    [PropTypeId.OutSignalPtrList]: "outsignal",
    [PropTypeId.Spring]: "spring",
    [PropTypeId.MaterialPtr]: "material",
    [PropTypeId.Vertex]: "vertex",
    [PropTypeId.Angle]: "angle",
    [PropTypeId.VariableName]: "varname",
    [PropTypeId.CollisionMesh47]: "collmesh47",
    [PropTypeId.CollisionMesh48]: "collmesh48",
  };
}
