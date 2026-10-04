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

// 1. Dijkstra seeds strictly from origin physical stop_positions
export function computeShortestPathTree(originCRS, stationByCRS, railwayRoutingGraph) {
    const originStation = stationByCRS.get(originCRS);
    if (!originStation || !originStation.stop_positions || !originStation.stop_positions.length) return null;

    const distances = new Map();
    const parents = new Map();
    const pq = new MinPriorityQueue();

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
            const v = String(edge.node);
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

// 2. Reconstructs physical path (Fixed argument order: accepts 3 arguments as called by RailMapper)
export function reconstructPath(targetCRS, stationByCRS, routingTree) {
    if (!routingTree) return null;
    const { distances, parents } = routingTree;
    const targetStation = stationByCRS.get(targetCRS);
    if (!targetStation || !targetStation.stop_positions || !targetStation.stop_positions.length) return null;

    // Find closest reached stop_position for target station
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

    // Trace parent tree backwards across physical track nodes
    const fullPathNodes = [];
    let curr = bestStop;
    while (parents.has(curr)) {
        const edgeInfo = parents.get(curr);
        const segmentNodes = (edgeInfo.path || [edgeInfo.parent, curr]).map(String);

        if (segmentNodes[segmentNodes.length - 1] === curr) {
            for (let i = segmentNodes.length - 1; i > 0; i--) {
                fullPathNodes.unshift(segmentNodes[i]);
            }
        } else {
            for (let i = 0; i < segmentNodes.length - 1; i++) {
                fullPathNodes.unshift(segmentNodes[i]);
            }
        }
        curr = String(edgeInfo.parent);
    }
    fullPathNodes.unshift(String(curr));

    return { 
        pathNodes: fullPathNodes,
        totalDistance: minDist 
    };
}

// 3. Flow calculation operating purely on physical track edges
export function calculatePassengerFlows(routingTree, selectedCRS, selectedYear, journeysMap, stationByCRS) {
    if (!routingTree || !routingTree.parents) return new Map();

    const { distances, parents } = routingTree;
    const edgeFlows = new Map();

    stationByCRS.forEach((station, targetCRS) => {
        if (targetCRS === selectedCRS) return;

        const key = selectedCRS < targetCRS 
            ? `${selectedCRS}-${targetCRS}` 
            : `${targetCRS}-${selectedCRS}`;
            
        const journeyRecord = journeysMap.get(key);
        const passengerVolume = journeyRecord ? (journeyRecord[selectedYear] || 0) : 0;
        if (passengerVolume <= 0) return;

        let bestStop = null;
        let minDist = Infinity;
        if (station.stop_positions) {
            station.stop_positions.forEach(stopId => {
                const nodeStr = String(stopId);
                const d = distances.get(nodeStr);
                if (d !== undefined && d < minDist) {
                    minDist = d;
                    bestStop = nodeStr;
                }
            });
        }

        if (!bestStop || minDist === Infinity) return;

        let curr = bestStop;
        while (parents.has(curr)) {
            const edgeInfo = parents.get(curr);
            const parentNode = String(edgeInfo.parent);

            // Directly accumulate flow on the edge between parentNode and curr
            const u = parentNode;
            const v = curr;
            const edgeKey = u < v ? `${u}-${v}` : `${v}-${u}`;
            
            const currentVol = edgeFlows.get(edgeKey) || 0;
            edgeFlows.set(edgeKey, currentVol + passengerVolume);

            curr = parentNode;
        }
    });

    return edgeFlows;
}
