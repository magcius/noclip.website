import { GatMap, isWalkable } from "./gat.js";

const COST_ORTHO = 10;
const COST_DIAG = 14;
const MAX_PATHNODE = 150;

const UNEXPLORED = 0;
const OPEN = 1;
const CLOSED = 2;

export interface PathStep {
    x: number;
    y: number;
    dir: number;
}

interface PathNode {
    x: number;
    y: number;
    cost: number;
    total: number;
    dir: number;
    type: number;
    parent: PathNode | null;
}

const NEIGHBORS: { dx: number, dy: number, cost: number, dir: number }[] = [
    { dx: +1, dy: -1, cost: COST_DIAG, dir: 5 },
    { dx: +1, dy: 0, cost: COST_ORTHO, dir: 6 },
    { dx: +1, dy: +1, cost: COST_DIAG, dir: 7 },
    { dx: 0, dy: +1, cost: COST_ORTHO, dir: 0 },
    { dx: -1, dy: +1, cost: COST_DIAG, dir: 1 },
    { dx: -1, dy: 0, cost: COST_ORTHO, dir: 2 },
    { dx: -1, dy: -1, cost: COST_DIAG, dir: 3 },
    { dx: 0, dy: -1, cost: COST_ORTHO, dir: 4 },
];

export function findPath(gat: GatMap, sx: number, sy: number, dx: number, dy: number): PathStep[] | null {
    if (sx === dx && sy === dy)
        return null;
    if (!isWalkable(gat, dx, dy))
        return null;

    const heuristic = (x: number, y: number): number => (Math.abs(x - dx) + Math.abs(y - dy)) * 10;

    const master = new Map<number, PathNode>();
    const key = (x: number, y: number): number => x + y * gat.width;
    let poolCount = 0;

    const getNode = (x: number, y: number): PathNode | null => {
        const k = key(x, y);
        const existing = master.get(k);
        if (existing !== undefined)
            return existing;
        if (poolCount >= MAX_PATHNODE - 1)
            return null;
        poolCount++;
        const node: PathNode = { x, y, cost: 0, total: 0, dir: 0, type: UNEXPLORED, parent: null };
        master.set(k, node);
        return node;
    };

    const heap: PathNode[] = [];
    const heapPush = (node: PathNode): void => {
        heap.push(node);
        let i = heap.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (heap[parent].total <= heap[i].total)
                break;
            [heap[parent], heap[i]] = [heap[i], heap[parent]];
            i = parent;
        }
    };
    const heapPop = (): PathNode => {
        const top = heap[0];
        const last = heap.pop()!;
        if (heap.length > 0) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = 2 * i + 2;
                let smallest = i;
                if (l < heap.length && heap[l].total < heap[smallest].total) smallest = l;
                if (r < heap.length && heap[r].total < heap[smallest].total) smallest = r;
                if (smallest === i)
                    break;
                [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
                i = smallest;
            }
        }
        return top;
    };

    const start = getNode(sx, sy)!;
    start.type = OPEN;
    start.parent = null;
    start.cost = 0;
    start.total = heuristic(sx, sy);
    heapPush(start);

    const processNode = (parent: PathNode, traverseCost: number, x: number, y: number, dir: number): boolean => {
        const newCost = parent.cost + traverseCost;
        const node = getNode(x, y);
        if (node === null)
            return false;
        if (node.type !== UNEXPLORED) {
            if (node.cost <= newCost)
                return true;
            node.parent = parent;
            node.cost = newCost;
            node.total = newCost + heuristic(x, y);
            node.dir = dir;
            if (node.type === OPEN)
                heapPush(node);
            else if (node.type === CLOSED) {
                node.type = OPEN;
                heapPush(node);
            }
        } else {
            node.type = OPEN;
            node.parent = parent;
            node.cost = newCost;
            node.total = newCost + heuristic(x, y);
            node.dir = dir;
            heapPush(node);
        }
        return true;
    };

    while (heap.length > 0) {
        const best = heapPop();
        if (best.type === CLOSED)
            continue;
        if (best.x === dx && best.y === dy)
            return buildResultPath(best);

        for (const n of NEIGHBORS) {
            const nx = best.x + n.dx, ny = best.y + n.dy;
            if (!isWalkable(gat, nx, ny))
                continue;
            if (!processNode(best, n.cost, nx, ny, n.dir))
                return null;
        }
        best.type = CLOSED;
    }

    return null;
}

function buildResultPath(goal: PathNode): PathStep[] {
    const reversed: PathStep[] = [];
    let node: PathNode | null = goal;
    while (node !== null) {
        reversed.push({ x: node.x, y: node.y, dir: node.dir });
        node = node.parent;
    }
    reversed.reverse();
    return reversed;
}
