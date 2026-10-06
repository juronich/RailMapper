/**
 * Phase A: Load base map geometry, stations, and regional journey files.
 * Extracts availableYears immediately.
 */
export async function loadInitData(map) {
    console.time('1. Fetch Initial JSONs');
    const initFiles = [
        fetch('data/stations.json').then(res => res.json()),
        fetch('data/railway-nodes.json').then(res => res.json()),
        fetch('data/railway-ways.json').then(res => res.json()),
        fetch('data/railway-ways-data.json').then(res => res.json()),
    ];
    const journeyFiles = [
        'data/journeys/ODM_Scotland.json',
        'data/journeys/ODM_North.json',
        'data/journeys/ODM_Midlands.json',
        'data/journeys/ODM_Wales.json',
        'data/journeys/ODM_South.json',
        'data/journeys/ODM_London.json'
    ].map(file => fetch(file).then(res => res.json()));
    const [initResults, journeyDataFiles] = await Promise.all([
        Promise.all(initFiles),
        Promise.all(journeyFiles)
    ]);
    const [stationsData, nodesData, waysData, waysMetaData] = initResults;
    // Data structures to populate
    const railwayNodes = new Map();
    const railwayGraph = new Map();
    const stationByStopPosition = new Map();
    // POPULATE NODES
    console.time('2. Populate Nodes');
    nodesData.nodes.forEach(node => {
        railwayNodes.set(String(node[0]), {
            latitude: node[1],
            longitude: node[2]
        });
    }); 
    // END OF POPULATE NODES
    console.timeEnd('2. Populate Nodes');
    // BUILD WAYS & GRAPH
  	//  console.time('3. Build Ways & Graph');
    
    // STATIONS & LOOKUP MAPS
    console.time('4. Stations & Lookup Maps');
    const stations = Object.entries(stationsData).map(([crs, record]) => ({
        crs: crs,
		id: record.station?.id,
        name: record.station?.name,
        latitude: parseFloat(record.station?.latitude),
        longitude: parseFloat(record.station?.longitude),
        stop_positions: record.stop_positions || []
    })).filter(s => s.name && !isNaN(s.latitude) && !isNaN(s.longitude));
    const stationByCRS = new Map(stations.map(s => [s.crs, s]));
    stations.forEach(station => {
		 railwayNodes.set(String(station.id), {
            latitude: station.latitude,
            longitude: station.longitude
        });
        station.stop_positions.forEach(id => {
            stationByStopPosition.set(String(id), station);
        });
        L.circleMarker([station.latitude, station.longitude], { radius: 2, weight: 1 })
            .bindPopup(`<strong>${station.name}</strong> (${station.crs})`)
            .addTo(map);
    });
    console.timeEnd('4. Stations & Lookup Maps');
    // END OF STATIONS & LOOKUP MAPS

    // JOURNEY DATA
    console.time('7. Journey Data');
    const journeys = [];
    const journeysMap = new Map(); // Fast O(1) lookup Map
    let availableYears = []; 
    journeyDataFiles.forEach(data => {
        const years = data.years;
        // Extract years if available
        if (years && availableYears.length === 0) {
            availableYears = years;
        }
        Object.entries(data.journeys).forEach(([firstCRS, destinations]) => {
            Object.entries(destinations).forEach(([secondCRS, values]) => {
                const journey = { OriginCRS: firstCRS, DestinationCRS: secondCRS };
                years.forEach((year, idx) => {
                    journey[year] = values[idx] || 0;
                });
                journeys.push(journey);
                // Build consistent bi-directional key (alphabetical)
                const key = firstCRS < secondCRS 
                    ? `${firstCRS}-${secondCRS}` 
                    : `${secondCRS}-${firstCRS}`;
                journeysMap.set(key, journey);
            });
        });
    });
    console.timeEnd('7. Journey Data');
    availableYears.sort((a, b) => b.localeCompare(a));
    // END OF JOURNEY DATA
    return {
        railwayNodes,
        railwayGraph,
        stations,
        stationByCRS,
        stationByStopPosition,
        journeys,
        journeysMap,
        availableYears
    };
}

export async function loadRoutingData(stations, railwayNodes) {
    console.time('Fetch Routing Data');															  
    const routingUrl = new URL('../data/railway-routing.json', import.meta.url);
    const transfersUrl = new URL('../data/station-transfers.json', import.meta.url);
    const [routingData, transfersData, connectorsData] = await Promise.all([
        fetch(routingUrl).then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status} loading routing data`);
            return res.json();
        }),
        fetch(transfersUrl).then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status} loading transfers data`);
            return res.json();
        })
    ]);
    console.timeEnd('Fetch Routing Data');
    console.time('5. Routing Graph');
    const railwayRoutingGraph = new Map();
    const stationConnections = new Map();
    const edges = routingData.edges;
    const len = edges.length;
    // 1. Build Standard Track Routing Graph
    for (let i = 0; i < len; i++) {
        const [from, to, distance, path] = edges[i];
        const distNum = Number(distance);
        const fwdPath = path.map(String);
        const revPath = fwdPath.slice().reverse();

        // Forward lookup
        let fromList = railwayRoutingGraph.get(from);
        if (!fromList) {
            fromList = [];
            railwayRoutingGraph.set(from, fromList);
        }
        fromList.push({ node: to, distance: distNum, path: fwdPath });
        // Reverse lookup
        let toList = railwayRoutingGraph.get(to);
        if (!toList) {
            toList = [];
            railwayRoutingGraph.set(to, toList);
        }
        toList.push({ node: from, distance: distNum, path: revPath });
    }
	// Station Connections
    for (let i = 0; i < stations.length; i++) {
        const station = stations[i];
        const stops = station.stop_positions || [];
        for (let j = 0; j < stops.length; j++) {
            const node = String(stops[j]);
            if (!railwayRoutingGraph.has(node)) continue;
            const nodeData = railwayNodes.get(node);
            if (!nodeData) continue;
            stationConnections.set(node, {
                stationCRS: station.crs,
                fromCoordinates: [station.latitude, station.longitude],
                toCoordinates: [nodeData.latitude, nodeData.longitude]
            });
        }
    }
    console.timeEnd('5. Routing Graph');

    // TRANSFERS
    console.time('6. Transfers');
    const stationTransfers = transfersData.transfers || [];
    const transfersByCRS = new Map();
    for (let i = 0; i < stationTransfers.length; i++) {
        const [crs1, crs2] = stationTransfers[i];
        let t1 = transfersByCRS.get(crs1);
        if (!t1) { t1 = []; transfersByCRS.set(crs1, t1); }
        t1.push(crs2);
        let t2 = transfersByCRS.get(crs2);
        if (!t2) { t2 = []; transfersByCRS.set(crs2, t2); }
        t2.push(crs1);
    }
    console.timeEnd('6. Transfers');
	
	// 7. Inject Hub-to-Hub Transfer Edges into Railway Routing Graph
  //  console.time('7. Inject Transfer Edges');

    // CRS lookup map built directly from the stations array
  //  const stationByCRS = new Map(stations.map(s => [s.crs, s]));

    // =========================================================================
// 7. Inject Inter-Station Transfer Edges into Railway Routing Graph
// =========================================================================
/*console.time('7. Inject Transfer Edges');

const stationByCRS = new Map(stations.map(s => [s.crs, s]));

// Helper: Calculate physical spatial distance between two station coordinates in meters
function getHaversineDistance(s1, s2) {
    if (s1.lat == null || s1.lon == null || s2.lat == null || s2.lon == null) return 300;
    const R = 6371000; // Earth radius in meters
    const rad = Math.PI / 180;
    const dLat = (s2.lat - s1.lat) * rad;
    const dLon = (s2.lon - s1.lon) * rad;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(s1.lat * rad) * Math.cos(s2.lat * rad) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 1. Collect ONLY CRS codes explicitly defined in transfersByCRS
const transferHubCRSs = new Set();
transfersByCRS.forEach((targetCRSList, originCRS) => {
    transferHubCRSs.add(originCRS);
    targetCRSList.forEach(crs => transferHubCRSs.add(crs));
});

// 2. Section 7a: Link centroids to platforms ONLY for transfer hub stations
transferHubCRSs.forEach(crs => {
    const station = stationByCRS.get(crs);
    if (!station || !station.id || !station.stop_positions) return;

    const centroidId = String(station.id);
    const stopsSet = new Set(station.stop_positions.map(String));

    // Find the maximum physical track distance (D_max) between any platforms at this station
    let maxPlatformDistance = 0;
    stopsSet.forEach(stopId => {
        const edges = railwayRoutingGraph.get(stopId) || [];
        edges.forEach(edge => {
            if (stopsSet.has(edge.node) && edge.distance > maxPlatformDistance) {
                maxPlatformDistance = edge.distance;
            }
        });
    });

    // Fallback if no direct internal track edges exist between platforms
    if (maxPlatformDistance === 0) maxPlatformDistance = 200;

    // Bounding Rule: Set w so that 2 * w = D_max + 1m (strictly greater than D_max)
    const centroidWeight = (maxPlatformDistance / 2) + 0.5;

    station.stop_positions.forEach(stop => {
        const stopId = String(stop);

        // Centroid -> Platform Stop
        let centroidEdges = railwayRoutingGraph.get(centroidId);
        if (!centroidEdges) {
            centroidEdges = [];
            railwayRoutingGraph.set(centroidId, centroidEdges);
        }
        if (!centroidEdges.some(e => e.node === stopId)) {
            centroidEdges.push({ 
                node: stopId, 
                distance: centroidWeight, 
                path: [centroidId, stopId],
                isTransfer: true 
            });
        }

        // Platform Stop -> Centroid
        let stopEdges = railwayRoutingGraph.get(stopId);
        if (!stopEdges) {
            stopEdges = [];
            railwayRoutingGraph.set(stopId, stopEdges);
        }
        if (!stopEdges.some(e => e.node === centroidId)) {
            stopEdges.push({ 
                node: centroidId, 
                distance: centroidWeight, 
                path: [stopId, centroidId],
                isTransfer: true 
            });
        }
    });
});

// 3. Section 7b: Inject inter-station hub-to-hub transfer edges (e.g. EUS <-> QXR)
transfersByCRS.forEach((targetCRSList, originCRS) => {
    const originStation = stationByCRS.get(originCRS);
    if (!originStation || !originStation.id) return;
    const originCentroid = String(originStation.id);

    targetCRSList.forEach(targetCRS => {
        const targetStation = stationByCRS.get(targetCRS);
        if (!targetStation || !targetStation.id) return;
        const targetCentroid = String(targetStation.id);

        if (originCentroid === targetCentroid) return;

        // Spatial walking distance between the two station hubs
        const interHubDistance = getHaversineDistance(originStation, targetStation);

        // Forward Transfer: Origin Centroid -> Target Centroid
        let originEdges = railwayRoutingGraph.get(originCentroid);
        if (!originEdges) {
            originEdges = [];
            railwayRoutingGraph.set(originCentroid, originEdges);
        }
        if (!originEdges.some(e => e.node === targetCentroid)) {
            originEdges.push({
                node: targetCentroid,
                distance: interHubDistance,
                path: [originCentroid, targetCentroid],
                isTransfer: true
            });
        }

        // Reverse Transfer: Target Centroid -> Origin Centroid
        let targetEdges = railwayRoutingGraph.get(targetCentroid);
        if (!targetEdges) {
            targetEdges = [];
            railwayRoutingGraph.set(targetCentroid, targetEdges);
        }
        if (!targetEdges.some(e => e.node === originCentroid)) {
            targetEdges.push({
                node: originCentroid,
                distance: interHubDistance,
                path: [targetCentroid, originCentroid],
                isTransfer: true
            });
        }
    });
});

console.timeEnd('7. Inject Transfer Edges');
*/
	// 7. Inject Transfer Edges into Railway Routing Graph
   /* console.time('7. Inject Transfer Edges');
    const stationByCRS = new Map();
    for (let i = 0; i < stations.length; i++) {
        if (stations[i].crs) stationByCRS.set(stations[i].crs, stations[i]);
    }
    const TRANSFER_PENALTY = 0.0; // Adjust distance/weight penalty as appropriate
    transfersByCRS.forEach((connectedCRSs, fromCRS) => {
        const fromStation = stationByCRS.get(fromCRS);
        if (!fromStation || !fromStation.stop_positions) return;
        for (let i = 0; i < connectedCRSs.length; i++) {
            const toCRS = connectedCRSs[i];
            const toStation = stationByCRS.get(toCRS);
            if (!toStation || !toStation.stop_positions) continue;
            // Connect every stop position of station A to station B
            fromStation.stop_positions.forEach(fromStop => {
                const fromNode = String(fromStop);
                let fromList = railwayRoutingGraph.get(fromNode);
                if (!fromList) {
                    fromList = [];
                    railwayRoutingGraph.set(fromNode, fromList);
                }
                toStation.stop_positions.forEach(toStop => {
                    const toNode = String(toStop);
                    fromList.push({
                        node: toNode,
                        distance: TRANSFER_PENALTY,
                        path: [fromNode, toNode]
                    });
                });
            });
        }
    });
    console.timeEnd('7. Inject Transfer Edges');*/
	// END OF TRANSFERS
//	console.log("Graph sample keys:", Array.from(railwayRoutingGraph.keys()).slice(0, 10));

	// Check 2: How is a station object structured?
//	console.log("Sample station object (STP):", stationByCRS.get('STP'));
//	console.log("Sample station entry:", stations ? Array.from(stations.values())[0] : "Check variable name");
    return { 
        railwayRoutingGraph,
        stationConnections,
        stationTransfers,
        transfersByCRS
    };
}

// Helper to spawn worker and return Phase B data via Promise
export function loadRoutingDataAsync(stations, railwayNodes) {
    return new Promise((resolve, reject) => {
        const workerUrl = new URL('./worker.js', import.meta.url);
        const worker = new Worker(workerUrl, { type: 'module' });
        // Convert railwayNodes Map to an Array of entries for safe cloning across threads
        const serializedNodes = Array.from(railwayNodes.entries());
        worker.postMessage({
            action: 'BUILD_ROUTING_GRAPH',
            payload: { 
                stations, 
                railwayNodes: serializedNodes,
            }
        });
        worker.onmessage = (event) => {
            const { action, payload, error } = event.data;
            if (error) {
                worker.terminate();
                reject(new Error(error));
            } else if (action === 'ROUTING_COMPLETE') {
                worker.terminate(); // Clean up worker if only needed once
                resolve(payload);
            }
        };
        worker.onerror = (err) => {
            console.error('Worker startup error:', err);
            worker.terminate();
            reject(err);
        }
    });
}

// dataLoader.js
export async function loadWaysAndGraph(railwayNodes) {
    console.time('Worker: Build Ways & Graph');
    const waysUrl = new URL('../data/railway-ways.json', import.meta.url);
    const waysData = await fetch(waysUrl).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ways data`);
        return res.json();
    });
    const allCoords = [];
    const railwayGraph = new Map();
    const ways = waysData.ways;
    const waysLen = ways.length;
	console.log('Sample node lookup:', railwayNodes.keys().next().value, typeof railwayNodes.keys().next().value);
    for (let w = 0; w < waysLen; w++) {
        const nodeIds = ways[w][1];
        if (!nodeIds || nodeIds.length < 2) continue;
      	const coords = [];
        const nodeCount = nodeIds.length;
		
        for (let i = 0; i < nodeCount; i++) {
            // Change lines 17-19:
			const nodeId = nodeIds[i];
			// Try direct lookup first, fallback to Number/String conversion if missing
			const node = railwayNodes.get(nodeId) ?? railwayNodes.get(String(nodeId)) ?? railwayNodes.get(Number(nodeId));
			const nodeIdStr = nodeIds[i];
            if (node) {
                coords.push([node.latitude, node.longitude]);
            }
            if (i < nodeCount - 1) {
                const nextNodeStr = nodeIds[i + 1];
                let graphList = railwayGraph.get(nodeIdStr);
                if (!graphList) {
                    graphList = [];
                    railwayGraph.set(nodeIdStr, graphList);
                }
                graphList.push(nextNodeStr);
                let nextGraphList = railwayGraph.get(nextNodeStr);
                if (!nextGraphList) {
                    nextGraphList = [];
                    railwayGraph.set(nextNodeStr, nextGraphList);
                }
                nextGraphList.push(nodeIdStr);
            }
        }
        if (coords.length >= 2) {
            allCoords.push(coords);
        }
    }
    console.timeEnd('Worker: Build Ways & Graph');
    return {
        allCoords,
        railwayGraph
    };
}
