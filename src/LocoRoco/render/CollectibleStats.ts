/*
 * Counts up the total number and value of various collectible items for display.
 *
 * petton-svn, 2026.
 */

import { SceneNode } from "../SceneTree.js";

export const enum CollectibleCategory {
  Picories,
  MuiMui,
  Fruit,
  Item,
}

export const CATEGORY_OBJECT_TYPES: Record<CollectibleCategory, Set<string>> = {
  [CollectibleCategory.Picories]: new Set([
    "coin_one",
    "kcoin_one",
    "coin_ten",
    "kcoin_ten",
    "coin_fifty",
    "kcoin_fifty",
    "coin_simple",
  ]),
  [CollectibleCategory.MuiMui]: new Set(["muimui"]),
  [CollectibleCategory.Fruit]: new Set([
    "mi_S_futaba",
    "mi_S_kakushi",
    "mi_S_normal",
    "mi_five_futaba",
    "mi_five_kakushi",
    "mi_five_normal",
    "mi_one_futaba",
    "mi_one_kakushi",
    "mi_one_normal",
  ]),
  [CollectibleCategory.Item]: new Set(["coin_item", "kcoin_item"]),
};

const PICORI_VALUES: Record<string, number> = {
  coin_one: 1,
  kcoin_one: 1,
  coin_ten: 10,
  kcoin_ten: 10,
  coin_fifty: 50,
  kcoin_fifty: 50,
  coin_simple: 1,
};

const FRUIT_VALUES: Record<string, number> = {
  mi_S_futaba: 1,
  mi_S_kakushi: 1,
  mi_S_normal: 1,
  mi_one_futaba: 1,
  mi_one_kakushi: 1,
  mi_one_normal: 1,
  mi_five_futaba: 5,
  mi_five_kakushi: 5,
  mi_five_normal: 5,
};

/**
 * Count collectible objects in the scene tree by object type.
 * Returns a map of objectType -> count.
 */
function countByObjectType(root: SceneNode): Map<string, number> {
  const counts = new Map<string, number>();
  const countedNodes = new Set<SceneNode>();

  const traverse = (node: SceneNode) => {
    if (countedNodes.has(node))
      return;

    countedNodes.add(node);
    counts.set(node.objectType, (counts.get(node.objectType) || 0) + 1);
    for (const child of node.children)
      traverse(child);
  };

  traverse(root);
  return counts;
}

/**
 * Format collectible stats as HTML for the given category.
 * Returns an empty string if the category is null or unknown.
 */
export function formatCollectibleStats(
  root: SceneNode,
  category: CollectibleCategory,
): string {
  const types = CATEGORY_OBJECT_TYPES[category];
  const counts = countByObjectType(root);
  const lines: string[] = [];
  let totalValue = 0;

  for (const type of types) {
    const count = counts.get(type) || 0;
    if (count === 0) continue;

    if (category === CollectibleCategory.Picories) {
      const value = PICORI_VALUES[type] || 1;
      totalValue += count * value;
      lines.push(`${type}: ${count} (${count * value})`);
    } else if (category === CollectibleCategory.Fruit) {
      const value = FRUIT_VALUES[type] || 1;
      totalValue += count * value;
      lines.push(`${type}: ${count} (${count * value})`);
    } else {
      lines.push(`${type}: ${count}`);
    }
  }

  if (category === CollectibleCategory.Picories) {
    lines.push(`Total value: ${totalValue}`);
  } else if (category === CollectibleCategory.Fruit) {
    lines.push(`Total mi: ${totalValue}`);
  }

  return lines.join("<br>");
}
