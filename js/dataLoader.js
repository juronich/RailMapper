// dataLoader.js

const networkFiles = [
    fetch('data/railway-nodes.json').then(res => res.json()),
    fetch('data/railway-ways.json').then(res => res.json()),
    fetch('data/railway-ways-data.json').then(res => res.json()),
    fetch('data/stations.json').then(res => res.json()),
    fetch('data/railway-routing.json').then(res => res.json()),
    fetch('data/station-transfers.json').then(res => res.json())
];

const journeyFetches = [
    'data/journeys/ODM_Scotland.json',
    'data/journeys/ODM_North.json',
    'data/journeys/ODM_Midlands.json',
    'data/journeys/ODM_Wales.json',
    'data/journeys/ODM_South.json',
    'data/journeys/ODM_London.json'
].map(file => fetch(file).then(res => res.json()));

export async function loadData(map) {
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

    // 1. POPULATE NODES
    nodesData.nodes.forEach(node => {
        railwayNodes.set(String(node[0]), {
            latitude: node[1],
            longitude: node[2]
        });
    });

    // 2. BUILD WAYS & GRAPH
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

    // 3. STATIONS & LOOKUP MAPS
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

    // 4. ROUTING GRAPH
    routingData.edges.forEach(([from, to, distance, path]) => {
        const fromNode = String(from);
        const toNode = String(to);
        if (!railwayRoutingGraph.has(fromNode)) railwayRoutingGraph.set(fromNode, []);
        if (!railwayRoutingGraph.has(toNode)) railwayRoutingGraph.set(toNode, []);
        railwayRoutingGraph.get(fromNode).push({ node: toNode, distance, path });
        railwayRoutingGraph.get(toNode).push({ node: fromNode, distance, path: [...path].reverse() });
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

    // 5. TRANSFERS
    const stationTransfers = transfersData.transfers || [];
    const transfersByCRS = new Map();
    stationTransfers.forEach(([crs1, crs2]) => {
        if (!transfersByCRS.has(crs1)) transfersByCRS.set(crs1, []);
        if (!transfersByCRS.has(crs2)) transfersByCRS.set(crs2, []);
        transfersByCRS.get(crs1).push(crs2);
        transfersByCRS.get(crs2).push(crs1);
    });

    // 6. JOURNEY DATA
    const journeys = [];
    journeyDataFiles.forEach(data => {
        const years = data.years;
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
        journeys
    };
}
