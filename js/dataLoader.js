


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
    console.time('3. Build Ways & Graph');
    const basePolylines = [];
    waysData.ways.forEach(way => {
        const nodeIds = way[1];
        if (!nodeIds || nodeIds.length < 2) return;
        const coords = [];
        for (let i = 0; i < nodeIds.length; i++) {
            const nodeIdStr = String(nodeIds[i]);
            const node = railwayNodes.get(nodeIdStr);
            if (node) coords.push([node.latitude, node.longitude]);
            if (i < nodeIds.length - 1) {
                const nextNodeStr = String(nodeIds[i + 1]);
                if (!railwayGraph.has(nodeIdStr)) railwayGraph.set(nodeIdStr, []);
                if (!railwayGraph.has(nextNodeStr)) railwayGraph.set(nextNodeStr, []);
                railwayGraph.get(nodeIdStr).push(nextNodeStr);
                railwayGraph.get(nextNodeStr).push(nodeIdStr);
            }
        }
        if (coords.length >= 2) {
            basePolylines.push(L.polyline(coords, {
                color: '#4EA72E',
                weight: 1,
                opacity: 0.7
            }));
        }
    });
    // Batch draw base railway network on map
    L.featureGroup(basePolylines).addTo(map);
    console.timeEnd('3. Build Ways & Graph');
    // END OF BUILD WAYS & GRAPH

    // STATIONS & LOOKUP MAPS
    console.time('4. Stations & Lookup Maps');
    const stations = Object.entries(stationsData).map(([crs, record]) => ({
        crs: crs,
        name: record.station?.name,
        latitude: parseFloat(record.station?.latitude),
        longitude: parseFloat(record.station?.longitude),
        stop_positions: record.stop_positions || []
    })).filter(s => s.name && !isNaN(s.latitude) && !isNaN(s.longitude));
    const stationByCRS = new Map(stations.map(s => [s.crs, s]));
    stations.forEach(station => {
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
        availableYears
    };
}

/**
 * Phase B: Load heavy routing and transfer data needed for graph building
 */
export async function loadRoutingData(stations, railwayNodes) {
    console.time('Fetch Routing Data');
    // Dynamically resolve data URLs relative to the location of dataLoader.js
    const routingUrl = new URL('../data/railway-routing.json', import.meta.url);
    const transfersUrl = new URL('../data/station-transfers.json', import.meta.url);
    const [routingData, transfersData] = await Promise.all([
      fetch(routingUrl).then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status} loading routing data (${routingUrl.pathname})`);
            return res.json();
        }),
        fetch(transfersUrl).then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status} loading transfers data (${transfersUrl.pathname})`);
            return res.json();
        })
    ]);
    const railwayRoutingGraph = new Map();
    const stationConnections = new Map();
    console.timeEnd('Fetch Routing Data');
    // ROUTING GRAPH
    console.time('5. Routing Graph');
    routingData.edges.forEach(([from, to, distance, path]) => {
        const fromNode = String(from);
        const toNode = String(to);
        const pathStrings = path.map(String);
        if (!railwayRoutingGraph.has(fromNode)) railwayRoutingGraph.set(fromNode, []);
        if (!railwayRoutingGraph.has(toNode)) railwayRoutingGraph.set(toNode, []);
        // Forward edge
        railwayRoutingGraph.get(fromNode).push({ 
            node: toNode, 
            distance: Number(distance), 
            path: pathStrings 
        });
        // Reverse edge (store reversed node path array)
        railwayRoutingGraph.get(toNode).push({ 
            node: fromNode, 
            distance: Number(distance), 
            path: [...pathStrings].reverse() 
        });
    });
    stations.forEach(station => {
        station.stop_positions.forEach(id => {
            const node = String(id);
            if (!railwayRoutingGraph.has(node)) return;
            const nodeData = railwayNodes.get(node);
            if (!nodeData) return;
            stationConnections.set(node, {
                stationCRS: station.crs,
                fromCoordinates: [station.latitude, station.longitude],
                toCoordinates: [nodeData.latitude, nodeData.longitude]
            });
        });
    });
    console.timeEnd('5. Routing Graph');
    // END OF ROUTING GRAPH
    
    // TRANSFERS
    console.time('6. Transfers');
    const stationTransfers = transfersData.transfers || [];
    const transfersByCRS = new Map();
    stationTransfers.forEach(([crs1, crs2]) => {
        if (!transfersByCRS.has(crs1)) transfersByCRS.set(crs1, []);
        if (!transfersByCRS.has(crs2)) transfersByCRS.set(crs2, []);
        transfersByCRS.get(crs1).push(crs2);
        transfersByCRS.get(crs2).push(crs1);
    });
    console.timeEnd('6. Transfers');
    // END OF TRANSFERS
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
                railwayNodes: serializedNodes
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



/*export async function loadData(map) {
    console.time('1. Fetch JSONs');
    const [[nodesData, waysData, waysMetaData, stationsData, routingData, transfersData], journeyDataFiles] = 
        await Promise.all([
            Promise.all(networkFiles),
            Promise.all(journeyFetches)
        ]);
    // Data structures to populate
    const railwayNodes = new Map();
    const railwayGraph = new Map();
    const railwayRoutingGraph = new Map();
    const stationByStopPosition = new Map();
    const stationConnections = new Map();
    console.timeEnd('1. Fetch JSONs');
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
    console.time('3. Build Ways & Graph');
    const basePolylines = [];
    waysData.ways.forEach(way => {
        const nodeIds = way[1];
        if (!nodeIds || nodeIds.length < 2) return;
        const coords = [];
        for (let i = 0; i < nodeIds.length; i++) {
            const nodeIdStr = String(nodeIds[i]);
            const node = railwayNodes.get(nodeIdStr);
            if (node) coords.push([node.latitude, node.longitude]);
            if (i < nodeIds.length - 1) {
                const nextNodeStr = String(nodeIds[i + 1]);
                if (!railwayGraph.has(nodeIdStr)) railwayGraph.set(nodeIdStr, []);
                if (!railwayGraph.has(nextNodeStr)) railwayGraph.set(nextNodeStr, []);
                railwayGraph.get(nodeIdStr).push(nextNodeStr);
                railwayGraph.get(nextNodeStr).push(nodeIdStr);
            }
        }
        if (coords.length >= 2) {
            basePolylines.push(L.polyline(coords, {
                color: '#4EA72E',
                weight: 1,
                opacity: 0.7
            }));
        }
    });
    // Batch draw base railway network on map
    L.featureGroup(basePolylines).addTo(map);
    console.timeEnd('3. Build Ways & Graph');
    // END OF BUILD WAYS & GRAPH
    
    // STATIONS & LOOKUP MAPS
    console.time('4. Stations & Lookup Maps');
    const stations = Object.entries(stationsData).map(([crs, record]) => ({
        crs: crs,
        name: record.station?.name,
        latitude: parseFloat(record.station?.latitude),
        longitude: parseFloat(record.station?.longitude),
        stop_positions: record.stop_positions || []
    })).filter(s => s.name && !isNaN(s.latitude) && !isNaN(s.longitude));
    const stationByCRS = new Map(stations.map(s => [s.crs, s]));
    stations.forEach(station => {
        station.stop_positions.forEach(id => {
            stationByStopPosition.set(String(id), station);
        });
        L.circleMarker([station.latitude, station.longitude], { radius: 2, weight: 1 })
            .bindPopup(`<strong>${station.name}</strong> (${station.crs})`)
            .addTo(map);
    });
    console.timeEnd('4. Stations & Lookup Maps');
    // END OF STATIONS & LOOKUP MAPS
    
    // ROUTING GRAPH
    console.time('5. Routing Graph');
    routingData.edges.forEach(([from, to, distance, path]) => {
        const fromNode = String(from);
        const toNode = String(to);
        const pathStrings = path.map(String);
        if (!railwayRoutingGraph.has(fromNode)) railwayRoutingGraph.set(fromNode, []);
        if (!railwayRoutingGraph.has(toNode)) railwayRoutingGraph.set(toNode, []);
        // Forward edge
        railwayRoutingGraph.get(fromNode).push({ 
            node: toNode, 
            distance: Number(distance), 
            path: pathStrings 
        });
        // Reverse edge (store reversed node path array)
        railwayRoutingGraph.get(toNode).push({ 
            node: fromNode, 
            distance: Number(distance), 
            path: [...pathStrings].reverse() 
        });
    });
    stations.forEach(station => {
        station.stop_positions.forEach(id => {
            const node = String(id);
            if (!railwayRoutingGraph.has(node)) return;
            stationConnections.set(node, {
                stationCRS: station.crs,
                fromCoordinates: [station.latitude, station.longitude],
                toCoordinates: [railwayNodes.get(node).latitude, railwayNodes.get(node).longitude]
            });
        });
    });
    console.timeEnd('5. Routing Graph');
    // END OF ROUTING GRAPH
    
    // TRANSFERS
    console.time('6. Transfers');
    const stationTransfers = transfersData.transfers || [];
    const transfersByCRS = new Map();
    stationTransfers.forEach(([crs1, crs2]) => {
        if (!transfersByCRS.has(crs1)) transfersByCRS.set(crs1, []);
        if (!transfersByCRS.has(crs2)) transfersByCRS.set(crs2, []);
        transfersByCRS.get(crs1).push(crs2);
        transfersByCRS.get(crs2).push(crs1);
    });
    console.timeEnd('6. Transfers');
    // END OF TRANSFERS
    
    // JOURNEY DATA
    console.time('7. Journey Data');
    const journeys = [];
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
            });
        });
    });
    console.timeEnd('7. Journey Data');
    availableYears.sort((a, b) => b.localeCompare(a));
    // END OF JOURNEY DATA
    
    return {
        railwayNodes,
        railwayGraph,
        railwayRoutingGraph,
        stations,
        stationByCRS,
        stationByStopPosition,
        stationConnections,
        stationTransfers,
        transfersByCRS,
        journeys,
        availableYears
    };
}
*/
