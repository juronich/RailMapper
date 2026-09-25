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
    console.time('Function: computeShortestPathTree');
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
    console.timeEnd('Function: computeShortestPathTree');
    return { distances, parents, originStation };
}

// Reconstructs standard node-by-node path between origin and target station.
export function reconstructPath(targetCRS, stationByCRS, routingTree) {
    console.time('Function: reconstructPath');
    if (!routingTree) return null;
    const { distances, parents } = routingTree;
    const targetStation = stationByCRS.get(targetCRS);
    if (!targetStation || !targetStation.stop_positions || !targetStation.stop_positions.length) return null;
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
        // Edge path nodes sanitized to strings
        const segmentNodes = edge.path.map(String);
        // Ensure segment matches direction from curr to edge.parent
        if (segmentNodes[segmentNodes.length - 1] === curr) {
            // Path ends at curr -> insert in forward order (excluding starting curr)
            for (let i = segmentNodes.length - 2; i >= 0; i--) {
                fullPathNodes.unshift(segmentNodes[i]);
            }
        } else {
            // Path starts at curr -> insert reversed
            for (let i = 1; i < segmentNodes.length; i++) {
                fullPathNodes.unshift(segmentNodes[i]);
            }
        }
        curr = String(edge.parent);
    }
    console.timeEnd('Function: reconstructPath');
    fullPathNodes.unshift(String(curr));
    return { pathNodes: fullPathNodes, totalDistance: minDist };
}

 // Aggregates passenger volumes across network segment polylines for a given origin and year.
export function calculatePassengerFlows(routingTree, selectedCRS, selectedYear, journeys, stationByCRS) {
    console.time('Function: calculatePassengerFlows');
    if (!routingTree) return new Map();
    const edgeFlows = new Map();
    // Match journeys where selectedCRS is EITHER Origin OR Destination
    const activeJourneys = journeys.filter(j => 
        (j.OriginCRS === selectedCRS || j.DestinationCRS === selectedCRS) && 
        j[selectedYear] > 0
    );
    activeJourneys.forEach(journey => {
        const passengerVolume = journey[selectedYear];
        // Find whichever station is opposite to the selected active station
        const targetCRS = (journey.OriginCRS === selectedCRS) 
            ? journey.DestinationCRS 
            : journey.OriginCRS;
        const route = reconstructPath(targetCRS, stationByCRS, routingTree);
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
    console.timeEnd('Function: calculatePassengerFlows');
    return edgeFlows;
}
