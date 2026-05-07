/**
 * LocoRoco Panel added into the standard set of panels.
 *
 * petton-svn, 2026.
 */

import * as UI from "../../ui.js";
import { GlobalSaveManager } from "../../SaveManager.js";
import { LOCO_ICON } from "./constants/LocoRocoUIIcon.js";
import { CollectibleCategory } from "./CollectibleStats.js";
import { CollisionVisMode } from "./CollisionVisualization.js";
import type { LocoRocoRenderer } from "../LocoRocoRenderer.js";

const UI_OBJECT_TYPES = new Set([
  "tutorialmuimui",
  "muising",
  "frontanim",
  "goalscore",
]);

function createFlexRadios(names: string[]): UI.RadioButtons {
  const radios = new UI.RadioButtons("", names);
  radios.elem.style.display = "flex";
  for (const opt of radios.options) {
    opt.style.flex = "1 1 auto";
    opt.style.padding = "0 6px";
  }
  return radios;
}

function createActionButton(label: string, onClick: () => void): HTMLDivElement {
  const button = document.createElement("div");
  button.textContent = label;
  button.style.cursor = "pointer";
  button.style.padding = "8px";
  button.style.textAlign = "center";
  button.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
  button.style.borderRadius = "4px";
  button.style.marginTop = "4px";
  button.style.userSelect = "none";
  button.onmouseover = () => {
    button.style.backgroundColor = "rgba(255, 255, 255, 0.2)";
  };
  button.onmouseout = () => {
    button.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
  };
  button.onclick = onClick;
  return button;
}

type BooleanSettingKey =
  | "showCollision"
  | "showKakushi"
  | "showUIObjects"
  | "showWorld"
  | "showObjects"
  | "showDebugOverlays";

export class LocoRocoPanel {
  public showCollision: boolean;
  public showKakushi: boolean;
  public showUIObjects: boolean;
  public showWorld: boolean;
  public showObjects: boolean;
  public showDebugOverlays: boolean;
  public focusCollectibles: boolean = false;
  public focusedCollectibleCategory: CollectibleCategory = CollectibleCategory.Fruit;
  public collisionVisualizationMode: CollisionVisMode;

  constructor(private readonly renderer: LocoRocoRenderer) {
    this.showCollision = GlobalSaveManager.loadSetting<boolean>("LocoRoco_ShowCollision", false);
    this.showKakushi = GlobalSaveManager.loadSetting<boolean>("LocoRoco_ShowKakushi", true);
    this.showUIObjects = GlobalSaveManager.loadSetting<boolean>("LocoRoco_ShowUIObjects", false);
    this.showWorld = GlobalSaveManager.loadSetting<boolean>("LocoRoco_ShowWorld", true);
    this.showObjects = GlobalSaveManager.loadSetting<boolean>("LocoRoco_ShowObjects", true);
    this.showDebugOverlays = GlobalSaveManager.loadSetting<boolean>("LocoRoco_ShowDebugOverlays", true);
    this.collisionVisualizationMode = GlobalSaveManager.loadSetting<CollisionVisMode>(
      "LocoRoco_CollisionMode",
      CollisionVisMode.Friction,
    );
  }

  /** Object types that should be hidden, derived from the current show* toggles. */
  public getHiddenObjectTypes(): Set<string> {
    const hidden = new Set<string>();
    if (!this.showKakushi) hidden.add("kakushi");
    if (!this.showUIObjects) UI_OBJECT_TYPES.forEach((t) => hidden.add(t));
    return hidden;
  }

  public build(): UI.Panel[] {
    const panel = new UI.Panel();
    panel.setTitle(LOCO_ICON, "LocoRoco");

    panel.contents.appendChild(
      createActionButton("Restart Animations", () => this.renderer.restartAnimations()),
    );
    panel.contents.appendChild(
      createActionButton("Signal Graph", () => this.renderer.openSignalGraph()),
    );

    this.appendCollisionControls(panel);
    this.appendVisibilityToggle(panel, "Kakushi (Hidden)", "showKakushi", "LocoRoco_ShowKakushi");
    this.appendVisibilityToggle(panel, "UI Objects", "showUIObjects", "LocoRoco_ShowUIObjects");
    this.appendVisibilityToggle(panel, "World", "showWorld", "LocoRoco_ShowWorld");
    this.appendVisibilityToggle(panel, "Objects", "showObjects", "LocoRoco_ShowObjects");
    this.appendVisibilityToggle(panel, "Debug Overlays", "showDebugOverlays", "LocoRoco_ShowDebugOverlays");

    this.appendFocusCollectibles(panel);

    const bottomSpacer = document.createElement("div");
    bottomSpacer.style.height = "8px";
    panel.contents.appendChild(bottomSpacer);

    return [panel];
  }

  private appendVisibilityToggle(
    panel: UI.Panel,
    label: string,
    field: BooleanSettingKey,
    saveKey: string,
  ): void {
    const checkbox = new UI.Checkbox(label, this[field]);
    checkbox.elem.style.paddingLeft = "12px";
    checkbox.elem.style.marginTop = "4px";
    checkbox.onchanged = () => {
      this[field] = checkbox.checked;
      GlobalSaveManager.saveSetting(saveKey, checkbox.checked);
    };
    panel.contents.appendChild(checkbox.elem);
  }

  private appendCollisionControls(panel: UI.Panel): void {
    const collisionCheckbox = new UI.Checkbox("Collision", this.showCollision);
    collisionCheckbox.elem.style.paddingLeft = "12px";
    collisionCheckbox.elem.style.marginTop = "4px";
    panel.contents.appendChild(collisionCheckbox.elem);

    const modeContainer = document.createElement("div");
    modeContainer.style.marginLeft = "20px";
    modeContainer.style.marginRight = "20px";
    modeContainer.style.marginTop = "8px";
    modeContainer.style.marginBottom = "8px";
    modeContainer.style.display = this.showCollision ? "block" : "none";

    const modeNames = ["Friction", "Sticky", "Unk4", "Unk5", "Unk6", "Signals"];
    const modeValues: CollisionVisMode[] = [
      CollisionVisMode.Friction,
      CollisionVisMode.SurfaceType,
      CollisionVisMode.Unk4,
      CollisionVisMode.Unk5,
      CollisionVisMode.Unk6,
      CollisionVisMode.Signals,
    ];
    const modeRadios = createFlexRadios(modeNames);
    const savedIndex = modeValues.indexOf(this.collisionVisualizationMode);
    modeRadios.setSelectedIndex(savedIndex >= 0 ? savedIndex : 0);
    modeRadios.onselectedchange = () => {
      this.collisionVisualizationMode = modeValues[modeRadios.selectedIndex];
      GlobalSaveManager.saveSetting(
        "LocoRoco_CollisionMode",
        this.collisionVisualizationMode,
      );
      this.renderer.regenerateCollisionLines();
    };
    modeContainer.appendChild(modeRadios.elem);
    panel.contents.appendChild(modeContainer);

    collisionCheckbox.onchanged = () => {
      this.showCollision = collisionCheckbox.checked;
      GlobalSaveManager.saveSetting("LocoRoco_ShowCollision", this.showCollision);
      modeContainer.style.display = this.showCollision ? "block" : "none";
      panel.syncSize();
    };
  }

  private appendFocusCollectibles(panel: UI.Panel): void {
    const focusCheckbox = new UI.Checkbox("Focus Collectibles", this.focusCollectibles);
    focusCheckbox.elem.style.paddingLeft = "12px";
    focusCheckbox.elem.style.marginTop = "4px";
    panel.contents.appendChild(focusCheckbox.elem);

    const focusContainer = document.createElement("div");
    focusContainer.style.marginLeft = "20px";
    focusContainer.style.marginRight = "20px";
    focusContainer.style.display = this.focusCollectibles ? "block" : "none";

    const statsDiv = document.createElement("div");
    statsDiv.style.fontSize = "11px";
    statsDiv.style.marginBottom = "4px";
    statsDiv.style.color = "rgba(255, 255, 255, 0.8)";
    focusContainer.appendChild(statsDiv);

    const categoryNames = ["Picories", "MuiMui", "Fruit", "Item"];
    const categoryKeys: CollectibleCategory[] = [
      CollectibleCategory.Picories,
      CollectibleCategory.MuiMui,
      CollectibleCategory.Fruit,
      CollectibleCategory.Item,
    ];
    const focusRadios = createFlexRadios(categoryNames);
    focusRadios.setSelectedIndex(categoryKeys.indexOf(this.focusedCollectibleCategory));
    if (this.focusCollectibles) {
      this.focusedCollectibleCategory = categoryKeys[focusRadios.selectedIndex];
    }

    const updateStats = () => {
      statsDiv.innerHTML = this.focusCollectibles
        ? this.renderer.formatCollectibleStats(this.focusedCollectibleCategory)
        : "";
    };

    focusRadios.onselectedchange = () => {
      this.focusedCollectibleCategory = categoryKeys[focusRadios.selectedIndex];
      updateStats();
    };
    focusContainer.appendChild(focusRadios.elem);
    panel.contents.appendChild(focusContainer);

    focusCheckbox.onchanged = () => {
      this.focusCollectibles = focusCheckbox.checked;
      focusContainer.style.display = this.focusCollectibles ? "block" : "none";
      if (this.focusCollectibles) {
        this.focusedCollectibleCategory = categoryKeys[focusRadios.selectedIndex];
      } else {
        this.focusedCollectibleCategory = CollectibleCategory.Fruit;
      }
      updateStats();
      panel.syncSize();
    };

    updateStats();
  }
}
