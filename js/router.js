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
// router.js

// Computes shortest path tree from physical track stop_positions
export function computeShortestPathTree(originCRS, stationByCRS, railwayRoutingGraph) {
    const originStation = stationByCRS.get(originCRS);
    if (!originStation || !originStation.stop_positions || !originStation.stop_positions.length) return null;

    const distances = new Map();
    const parents = new Map();
    const pq = new MinPriorityQueue();

    // Start Dijkstra directly from the physical track stop_positions
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

// Reconstructs physical path and snaps the terminal endpoint to target station coords
export function reconstructPath(targetCRS, stationByCRS, railwayNodes, routingTree) {
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
        const edge = parents.get(curr);
        const segmentNodes = edge.path.map(String);

        if (segmentNodes[segmentNodes.length - 1] === curr) {
            for (let i = segmentNodes.length - 2; i >= 0; i--) {
                fullPathNodes.unshift(segmentNodes[i]);
            }
        } else {
            for (let i = 1; i < segmentNodes.length; i++) {
                fullPathNodes.unshift(segmentNodes[i]);
            }
        }
        curr = String(edge.parent);
    }
    fullPathNodes.unshift(String(curr));

    // Map physical track node IDs to [lat, lon] coordinates
    const coordinates = fullPathNodes.map(nodeId => {
        const node = railwayNodes.get(nodeId);
        return node ? [node.latitude, node.longitude] : null;
    }).filter(Boolean);

    // Append the exact target station pin coordinates as the final polyline point
    const targetLat = targetStation.latitude || targetStation.lat;
    const targetLon = targetStation.longitude || targetStation.lon;
    if (targetLat && targetLon) {
        coordinates.push([targetLat, targetLon]);
    }

    return { 
        pathNodes: fullPathNodes,
        coordinates,
        totalDistance: minDist 
    };
}

// Aggregates passenger volumes purely across physical track edges
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

        // Find best stop_position reached for target station
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

        // Accumulate flow on physical track segments
        let curr = bestStop;
        while (parents.has(curr)) {
            const edge = parents.get(curr);
            const segmentNodes = edge.path.map(String);

            for (let i = 0; i < segmentNodes.length - 1; i++) {
                const u = segmentNodes[i];
                const v = segmentNodes[i + 1];
                const edgeKey = u < v ? `${u}-${v}` : `${v}-${u}`;
                
                const currentVol = edgeFlows.get(edgeKey) || 0;
                edgeFlows.set(edgeKey, currentVol + passengerVolume);
            }

            curr = String(edge.parent);
        }
    });

    return edgeFlows;
}
/*
// Computes shortest path tree directly from originCRS using Dijkstra's algorithm.
export function computeShortestPathTree(originCRS, stationByCRS, railwayRoutingGraph) {
    console.time('Function: computeShortestPathTree');
    const originStation = stationByCRS.get(originCRS);
    const startNode = String(originCRS);
    if (!originStation || !railwayRoutingGraph.has(startNode)) {
        console.timeEnd('Function: computeShortestPathTree');
        return null;
    }

    const distances = new Map();
    const parents = new Map();
    const pq = new MinPriorityQueue();

    // 1. Initialize source directly with the station CRS string
    
    distances.set(startNode, 0);
    pq.push(startNode, 0);

    // 2. Standard Dijkstra loop across track & virtual connector edges
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
    console.timeEnd('Function: computeShortestPathTree');
    return { distances, parents, originStation };
}

export function getCoordinatesForPath(pathNodes, stationByCRS, railwayNodes) {
    const coordinates = [];
    for (let i = 0; i < pathNodes.length; i++) {
        const nodeId = pathNodes[i];
        // 1. Resolve Station CRS terminal nodes
        if (stationByCRS.has(nodeId)) {
            const station = stationByCRS.get(nodeId);
            const lat = station.latitude || station.lat;
            const lon = station.longitude || station.lon;
            if (lat && lon) coordinates.push([lat, lon]);
            continue;
        }
        // 2. Resolve Track nodes from railwayNodes
        const node = railwayNodes.get(nodeId);
        if (node) {
            coordinates.push([node.latitude, node.longitude]);
        }
    }
    return coordinates;
}
// Reconstructs standard node-by-node path between origin and target station directly.
export function reconstructPath(targetCRS, stationByCRS, routingTree) {
    if (!routingTree) return null;
    const { distances, parents } = routingTree;
    const targetStation = stationByCRS.get(targetCRS);
    if (!targetStation) return null;

    const targetNode = String(targetCRS);
    const minDist = distances.get(targetNode);

    // Target CRS wasn't reached by the tree search
    if (minDist === undefined || minDist === Infinity) return null;

    const fullPathNodes = [];
    let curr = targetNode;

    // Trace parent tree backwards from targetCRS to originCRS
    while (parents.has(curr)) {
        const edge = parents.get(curr);
        const segmentNodes = edge.path.map(String);

        // Ensure segment matches direction from curr to edge.parent
        if (segmentNodes[segmentNodes.length - 1] === curr) {
            for (let i = segmentNodes.length - 2; i >= 0; i--) {
                fullPathNodes.unshift(segmentNodes[i]);
            }
        } else {
            for (let i = 1; i < segmentNodes.length; i++) {
                fullPathNodes.unshift(segmentNodes[i]);
            }
        }
        curr = String(edge.parent);
    }
    fullPathNodes.unshift(String(curr));

    const pathCoordinates = fullPathNodes.map(nodeId => {
        // A) If it's a Station CRS code, grab station coordinates
        if (stationByCRS.has(nodeId)) {
            const st = stationByCRS.get(nodeId);
            return [st.latitude || st.lat, st.longitude || st.lon];
        }
        // B) Otherwise, look up track node in railwayNodes
        const trackNode = railwayNodes.get(nodeId);
        return trackNode ? [trackNode.latitude, trackNode.longitude] : null;
    }).filter(Boolean); // Drop any missing lookups cleanly
    return { 
        pathNodes: fullPathNodes, 
        coordinates: pathCoordinates,
        targetStationCoords: [targetStation.latitude || targetStation.lat, targetStation.longitude || targetStation.lon],
        totalDistance: minDist 
    };
}

// Aggregates passenger volumes across network segment polylines for a given origin and year.
export function calculatePassengerFlows(routingTree, selectedCRS, selectedYear, journeysMap, stationByCRS) {
    console.time('Function: calculatePassengerFlows');
    if (!routingTree || !routingTree.parents) return new Map();

    const { parents } = routingTree;
    const edgeFlows = new Map();

    stationByCRS.forEach((station, targetCRS) => {
        if (targetCRS === selectedCRS) return;

        // 1. O(1) key lookup in journeysMap
        const key = selectedCRS < targetCRS 
            ? `${selectedCRS}-${targetCRS}` 
            : `${targetCRS}-${selectedCRS}`;
            
        const journeyRecord = journeysMap.get(key);
        const passengerVolume = journeyRecord ? (journeyRecord[selectedYear] || 0) : 0;
        if (passengerVolume <= 0) return;

        const targetNode = String(targetCRS);
        if (!parents.has(targetNode)) return;

        // 2. Traverse parent tree along physical node edges
        let curr = targetNode;
        while (parents.has(curr)) {
            const edge = parents.get(curr);

            // Accumulate flow across all sub-segments in path
            const segmentNodes = edge.path.map(String);
            for (let i = 0; i < segmentNodes.length - 1; i++) {
                const u = segmentNodes[i];
                const v = segmentNodes[i + 1];

                // Skip virtual connector edges (sub-segments involving CRS codes)
                if (stationByCRS.has(u) || stationByCRS.has(v)) continue;

                const edgeKey = u < v ? `${u}-${v}` : `${v}-${u}`;
                const currentVol = edgeFlows.get(edgeKey) || 0;
                edgeFlows.set(edgeKey, currentVol + passengerVolume);
            }

            curr = String(edge.parent);
        }
    });

    console.timeEnd('Function: calculatePassengerFlows');
    return edgeFlows;
}
/*export class MinPriorityQueue {
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
    fullPathNodes.unshift(String(curr));
    return { 
        pathNodes: fullPathNodes, 
        targetStationCoords: [targetStation.lat, targetStation.lon],
        totalDistance: minDist 
    };
}

// Aggregates passenger volumes across network segment polylines for a given origin and year.
export function calculatePassengerFlows(routingTree, selectedCRS, selectedYear, journeysMap, stationByCRS) {
    console.time('Function: calculatePassengerFlows');
    if (!routingTree || !routingTree.parents) return new Map();

    const { distances, parents } = routingTree;
    const edgeFlows = new Map();

    stationByCRS.forEach((station, targetCRS) => {
        if (targetCRS === selectedCRS) return;

        // 1. O(1) key lookup in journeysMap
        const key = selectedCRS < targetCRS 
            ? `${selectedCRS}-${targetCRS}` 
            : `${targetCRS}-${selectedCRS}`;
            
        const journeyRecord = journeysMap.get(key);
        const passengerVolume = journeyRecord ? (journeyRecord[selectedYear] || 0) : 0;
        if (passengerVolume <= 0) return;

        // 2. Find closest reached stop node for target CRS
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

        // 3. Traverse parent tree along physical node edges
        let curr = bestStop;
        while (parents.has(curr)) {
            const edge = parents.get(curr);
            const parentNode = String(edge.parent);

            // Accumulate flow across all sub-segments in path
            const segmentNodes = edge.path.map(String);
            for (let i = 0; i < segmentNodes.length - 1; i++) {
                const u = segmentNodes[i];
                const v = segmentNodes[i + 1];
                const edgeKey = u < v ? `${u}-${v}` : `${v}-${u}`;
                
                const currentVol = edgeFlows.get(edgeKey) || 0;
                edgeFlows.set(edgeKey, currentVol + passengerVolume);
            }

            curr = parentNode;
        }
    });

    console.timeEnd('Function: calculatePassengerFlows');
    return edgeFlows;
}

/*
 // Aggregates passenger volumes across network segment polylines for a given origin and year.
export function calculatePassengerFlows(routingTree, selectedCRS, selectedYear, journeysMap, stationByCRS) {
    console.time('Function: calculatePassengerFlows');
    if (!routingTree) return new Map();
    const edgeFlows = new Map();
    stationByCRS.forEach((station, targetCRS) => {
        if (targetCRS === selectedCRS) return;
        // 1. Fast O(1) lookup in journeysMap using sorted CRS key
        const key = selectedCRS < targetCRS 
            ? `${selectedCRS}-${targetCRS}` 
            : `${targetCRS}-${selectedCRS}`;
        const journeyRecord = journeysMap.get(key);
        const passengerVolume = journeyRecord ? (journeyRecord[selectedYear] || 0) : 0;
        if (passengerVolume <= 0) return;
        // 2. Direct parent traversal up the Dijkstra tree without reconstructPath overhead
        let currentCRS = targetCRS;
        while (currentCRS && currentCRS !== selectedCRS) {
            const nodeData = routingTree.get(currentCRS);
            if (!nodeData || !nodeData.parent) break;
            const parentCRS = nodeData.parent;
            const u = String(currentCRS);
            const v = String(parentCRS);
            const edgeKey = u < v ? `${u}-${v}` : `${v}-${u}`;
            const currentVolume = edgeFlows.get(edgeKey) || 0;
            edgeFlows.set(edgeKey, currentVolume + passengerVolume);
            currentCRS = parentCRS;
        }
    });
    console.timeEnd('Function: calculatePassengerFlows');
    return edgeFlows;
}
*/

/*
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
*/
