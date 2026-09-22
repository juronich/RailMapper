export class MinPriorityQueue {
    constructor() {
        this.heap = [];
    }
    push(val, priority) {
        this.heap.push({ val, priority });
        this._bubbleUp(this.heap.length - 1);
    }
    pop() {
        if (this.heap.length === 0) return null;
        const top = this.heap[0];
        const bottom = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = bottom;
            this._sinkDown(0);
        }
        return top;
    }
    isEmpty() {
        return this.heap.length === 0;
    }
    _bubbleUp(idx) {
        while (idx > 0) {
            const parentIdx = Math.floor((idx - 1) / 2);
            if (this.heap[idx].priority >= this.heap[parentIdx].priority) break;
            [this.heap[idx], this.heap[parentIdx]] = [this.heap[parentIdx], this.heap[idx]];
            idx = parentIdx;
        }
    }
    _sinkDown(idx) {
        const length = this.heap.length;
        while (true) {
            let left = 2 * idx + 1;
            let right = 2 * idx + 2;
            let smallest = idx;
            if (left < length && this.heap[left].priority < this.heap[smallest].priority) {
                smallest = left;
            }
            if (right < length && this.heap[right].priority < this.heap[smallest].priority) {
                smallest = right;
            }
            if (smallest === idx) break;

            [this.heap[idx], this.heap[smallest]] = [this.heap[smallest], this.heap[idx]];
            idx = smallest;
        }
    }
}


// Computes shortest path tree from an origin station using Dijkstra's algorithm.
export function computeShortestPathTree(originCRS, stationByCRS, railwayRoutingGraph) {
    const originStation = stationByCRS.get(originCRS);
    if (!originStation || !originStation.stop_positions.length) return null;
    const distances = new Map();
    const parents = new Map();
    const pq = new MinPriorityQueue();
    // Initialize source stop positions
    originStation.stop_positions.forEach(stopId => {
        const nodeStr = String(stopId);
        distances.set(nodeStr, 0);
        pq.push(nodeStr, 0);
    });
    while (!pq.isEmpty()) {
        const current = pq.pop();
        if (!current) continue;
        const { val: u, priority: distU } = current;
        if (distU > distances.get(u)) continue;
        const neighbors = railwayRoutingGraph.get(u) || [];
        for (const edge of neighbors) {
            const v = edge.node;
            const newDist = distU + edge.distance;
            if (!distances.has(v) || newDist < distances.get(v)) {
                distances.set(v, newDist);
                parents.set(v, { parent: u, path: edge.path });
                pq.push(v, newDist);
            }
        }
    }
    return { distances, parents, originStation };
}

// Reconstructs standard node-by-node path between origin and target station.
export function reconstructPath(targetCRS, stationByCRS, routingTree) {
    if (!routingTree) return null;
    const { distances, parents } = routingTree;
    const targetStation = stationByCRS.get(targetCRS);
    if (!targetStation || !targetStation.stop_positions.length) return null;
    // Pick closest stop_position for target station
    let bestStop = null;
    let minDist = Infinity;
    targetStation.stop_positions.forEach(stopId => {
        const nodeStr = String(stopId);
        const d = distances.get(nodeStr);
        if (d !== undefined && d < minDist) {
            minDist = d;
            bestStop = nodeStr;
        }
    });
    if (!bestStop || minDist === Infinity) return null;
    const fullPathNodes = [];
    let curr = bestStop;
    while (parents.has(curr)) {
        const edge = parents.get(curr);
        fullPathNodes.unshift(...edge.path.slice(1).reverse());
        curr = edge.parent;
    }
    fullPathNodes.unshift(curr);
    return { pathNodes: fullPathNodes, totalDistance: minDist };
}

 // Aggregates passenger volumes across network segment polylines for a given origin and year.
export function calculatePassengerFlows(routingTree, originCRS, selectedYear, journeys, stationByCRS) {
    if (!routingTree) return new Map();
    const edgeFlows = new Map();
    const activeJourneys = journeys.filter(j => j.OriginCRS === originCRS && j[selectedYear] > 0);
    activeJourneys.forEach(journey => {
        const passengerVolume = journey[selectedYear];
        const destCRS = journey.DestinationCRS;
        const route = reconstructPath(destCRS, stationByCRS, routingTree);
        if (!route || !route.pathNodes || route.pathNodes.length < 2) return;
        const nodes = route.pathNodes;
        for (let i = 0; i < nodes.length - 1; i++) {
            const u = String(nodes[i]);
            const v = String(nodes[i + 1]);
            const edgeKey = u < v ? `${u}-${v}` : `${v}-${u}`;
            const currentVolume = edgeFlows.get(edgeKey) || 0;
            edgeFlows.set(edgeKey, currentVolume + passengerVolume);
        }
    });
    return edgeFlows;
}
