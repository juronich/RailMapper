console.log('v0.20175');
import { loadData } from './dataLoader.js';
import { computeShortestPathTree, reconstructPath } from './router.js';
import { drawRailwayRoute, drawDestinationMarkers, drawPassengerFlows, clearAllMapLayers } from './renderer.js';


// MAP
const map = L.map('map').setView([54.5, -3], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
	className: 'basemap'
}).addTo(map);
// END OF MAP

const destinationLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const flowLayer = L.layerGroup().addTo(map);
const originInput = document.getElementById('origin');
const yearInput = document.getElementById('year');
const originResults = document.getElementById('origin-results');

// Global Application State Variables
let journeys = [];
let stations = [];
let stationTransfers = [];
let railwayNodes = new Map();
let railwayGraph = new Map();
let railwayRoutingGraph = new Map();
let stationByCRS = new Map();
let stationByStopPosition = new Map();
let stationConnections = new Map();
let transfersByCRS = new Map();
let currentRoutingTree = null;
let currentOriginCRS = null;
let currentPassengerFlows = null;

// LOAD DATA
loadData(map)
    .then(data => {
        railwayNodes = data.railwayNodes;
        railwayGraph = data.railwayGraph;
        railwayRoutingGraph = data.railwayRoutingGraph;
        stations = data.stations;
        stationByCRS = data.stationByCRS;
        stationByStopPosition = data.stationByStopPosition;
        stationConnections = data.stationConnections;
        stationTransfers = data.stationTransfers;
        transfersByCRS = data.transfersByCRS;
        journeys = data.journeys;

        originInput.disabled = false;
        console.log('All data loaded and initialized successfully.');
    })
    .catch(err => console.error('Error during dataset initialization:', err));

/**
 * Example handler showing how router + renderer work together when selecting a route:
 */
function displayRouteToStation(destinationCRS) {
    if (!currentRoutingTree) return;
    // 1. Calculate path geometry (router.js)
    const route = reconstructPath(destinationCRS, stationByCRS, currentRoutingTree);
    if (route && route.pathNodes.length > 0) {
        // 2. Render path on map (renderer.js)
        drawRailwayRoute(routeLayer, route.pathNodes, railwayNodes, {
            color: '#e67e22',
            weight: 5
        });
    }
}



// FUNCTION: getTransferNodes() - Used in X to 
function getTransferNodes(crs) {
    const station = stations.find(station => station.crs === crs);
    if (!station) return [];

    return station.stop_positions
        .map(id => String(id))
        .filter(id => railwayRoutingGraph.has(id));
} // END OF FUNCTION: getTransferNodes() 

// FUNCTION: processSelectedOrigin() - To process the selected Origin Station
function processSelectedOrigin(selectedCRS) {
	destinationLayer.clearLayers();
    currentOriginCRS = selectedCRS;
    currentRoutingTree = buildOriginRoutingTree(selectedCRS);
    updateDestinationBubbles(selectedCRS);
    console.log('Selected station:', selectedCRS);
    const selectedYear = yearInput.value;
    const flowData = calculatePassengerFlows(
        currentRoutingTree,
        selectedCRS,
        selectedYear
    );
    currentPassengerFlows = flowData.edgeFlows;
    drawPassengerFlows(currentRoutingTree, flowData);
    console.log('Year: ', selectedYear);
} // END OF FUNCTION: processSelectedOrigin()

// FUNCTION: buildOriginRoutingTree() - Function to build the possible routes from the selected Origin
function buildOriginRoutingTree(originCRS) {
    const originStation = stationByCRS.get(originCRS);
    if (!originStation) {
        console.error('Could not find origin station:', originCRS);
        return null;
    }
    const startNodes = originStation.stop_positions
        .map(id => String(id))
        .filter(id => railwayRoutingGraph.has(id));
    if (!startNodes.length) {
        console.error('Origin station has no usable routing nodes:', originCRS);
        return null;
    }
    const distances = new Map();
    const previous = new Map();
    const pq = new MinPriorityQueue();
    // Initialize origin nodes
    startNodes.forEach(node => {
        distances.set(node, 0);
        pq.push(node, 0);
    });
    while (!pq.isEmpty()) {
        const { node: currentNode, priority: currentDistance } = pq.pop();
        // Skip stale queue entries
        if (currentDistance > (distances.get(currentNode) ?? Infinity)) continue;
        // 1. Traverse standard network edges
        const edges = railwayRoutingGraph.get(currentNode) || [];
        for (let i = 0; i < edges.length; i++) {
            const edge = edges[i];
            const newDistance = currentDistance + edge.distance;

            if (newDistance < (distances.get(edge.node) ?? Infinity)) {
                distances.set(edge.node, newDistance);
                previous.set(edge.node, {
                    node: currentNode,
                    edge: edge
                });
                pq.push(edge.node, newDistance);
            }
        }
        // 2. Traverse station transfers
        const currentStation = stationByStopPosition.get(currentNode);
        if (currentStation) {
            const connectedCRS = transfersByCRS.get(currentStation.crs) || [];
            for (let i = 0; i < connectedCRS.length; i++) {
                const targetCRS = connectedCRS[i];
                const targetStation = stationByCRS.get(targetCRS);
                if (!targetStation) continue;
                for (let j = 0; j < targetStation.stop_positions.length; j++) {
                    const transferNode = String(targetStation.stop_positions[j]);
                    if (!railwayRoutingGraph.has(transferNode)) continue;
                    const newDistance = currentDistance; // 0-distance transfer
                    if (newDistance < (distances.get(transferNode) ?? Infinity)) {
                        distances.set(transferNode, newDistance);
                        previous.set(transferNode, {
                            node: currentNode,
                            edge: {
                                node: transferNode,
                                distance: 0,
                                path: [],
                                transfer: true,
                                fromCoordinates: [
                                    currentStation.latitude,
                                    currentStation.longitude
                                ],
                                toCoordinates: [
                                    targetStation.latitude,
                                    targetStation.longitude
                                ]
                            }
                        });
                        pq.push(transferNode, newDistance);
                    }
                }
            }
        }
    }
    return {
        originCRS: originCRS,
        stationConnections: stationConnections,
        distances: distances,
        previous: previous
    };
}
// END OF FUNCTION: buildOriginRoutingTree()

// FUNCTION: calculatePassengerFlows() - Calculate the journeys from the selected Origin station
function calculatePassengerFlows(tree, originCRS, year) {
    const destinationVolumes = new Map();
    journeys.forEach(journey => {
        let destinationCRS = null;
        if (journey.OriginCRS === originCRS) {
            destinationCRS = journey.DestinationCRS;
        } else if (journey.DestinationCRS === originCRS) {
            destinationCRS = journey.OriginCRS;
        }
        if (!destinationCRS || destinationCRS === originCRS) return;
        const volume = Number(journey[year]) || 0;
        if (volume === 0) return;
        destinationVolumes.set(
            destinationCRS,
            (destinationVolumes.get(destinationCRS) || 0) + volume
        );
    });
    const nodeVolumes = new Map();
    const destinationNodes = new Map();
    destinationVolumes.forEach((volume, destinationCRS) => {
        const station = stations.find(station => station.crs === destinationCRS);
        if (!station) return;
        const reachableNodes = station.stop_positions
            .map(id => String(id))
            .filter(id => tree.distances.get(id) !== Infinity);
        if (!reachableNodes.length) return;
        const destinationNode = reachableNodes.reduce((closest, node) => {
            if (!closest) return node;
            return tree.distances.get(node) < tree.distances.get(closest)
                ? node
                : closest;
        }, null);
        nodeVolumes.set(
            destinationNode,
            (nodeVolumes.get(destinationNode) || 0) + volume
        );
        destinationNodes.set(destinationNode, destinationCRS);
    });
    const edgeFlows = new Map();
    const nodesByDistance = [...tree.distances.entries()]
        .filter(([node, distance]) => distance !== Infinity)
        .sort((a, b) => b[1] - a[1]);
    nodesByDistance.forEach(([node]) => {
        const volume = nodeVolumes.get(node) || 0;
        if (!volume) return;
        const previous = tree.previous.get(node);
        if (!previous) return;
        const edgeKey = `${previous.node}->${node}`;
        edgeFlows.set(
            edgeKey,
            (edgeFlows.get(edgeKey) || 0) + volume
        );
        nodeVolumes.set(
            previous.node,
            (nodeVolumes.get(previous.node) || 0) + volume
        );
    });
    return {
        edgeFlows: edgeFlows,
        destinationNodes: destinationNodes
    };
} // END OF FUNCTION: calculatePassengerFlows()





// FUNCTION: updateDestinationBubbles()
function updateDestinationBubbles(selectedCRS) {
    destinationLayer.clearLayers();
    const selectedYear = yearInput.value;
    const relevantJourneys = journeys.filter(journey =>
        journey.OriginCRS === selectedCRS ||
        journey.DestinationCRS === selectedCRS
    );
    const destinationStations = relevantJourneys.map(journey => {
        const crs = journey.OriginCRS === selectedCRS
            ? journey.DestinationCRS
            : journey.OriginCRS;
        return {
            station: stations.find(station => station.crs === crs),
            journeys: parseInt(journey[selectedYear], 10) || 0,
            yearlyJourneys: Object.keys(journey)
                .filter(column => column !== 'OriginCRS' && column !== 'DestinationCRS')
                .sort((a, b) => b.localeCompare(a))
                .map(year => ({
                    year: year,
                    journeys: parseInt(journey[year], 10) || 0
                }))
        };
    });
    destinationStations.forEach(destination => {
        if (!destination.station) return;
		L.circleMarker([
    		destination.station.latitude,
    		destination.station.longitude
		], {
    		radius: Math.pow(destination.journeys, 0.25) * 1.5,
    		weight: 2,
    		color: 'black',
    		fillColor: 'red',
    		fillOpacity: 0.45
		})
		.on('click', () => {
    		drawDestinationRoute(
        		currentRoutingTree,
        		destination.station.crs,
        		destination.journeys
    		);
		})
		.on('popupclose', () => {
    		routeLayer.clearLayers();
		})
		.bindPopup(`
            <strong>${destination.station.name}</strong> (${destination.station.crs})<br>
            Journeys from/to: ${originInput.value}<br><br>
            <strong>Average: ${Math.round(
                destination.yearlyJourneys.reduce((total, year) => total + year.journeys, 0) /
                destination.yearlyJourneys.length
            ).toLocaleString()}</strong><br><br>
            ${destination.yearlyJourneys
                .map(year => year.year === selectedYear
                    ? `<strong>${year.year}: ${year.journeys.toLocaleString()}</strong>`
                    : `${year.year}: ${year.journeys.toLocaleString()}`
                )
                .join('<br>')}
        `)
        .addTo(destinationLayer);
    });
    const selectedStation = stations.find(station => station.crs === selectedCRS);
    if (selectedStation) {
        L.circleMarker([
            selectedStation.latitude,
            selectedStation.longitude
        ], {
            radius: 10,
            weight: 4,
            color: 'black',
            fillColor: 'yellow',
            fillOpacity: 0.9
        })
        .bindPopup(`<strong>${selectedStation.name}</strong> (${selectedStation.crs})`)
        .addTo(destinationLayer);
    }
} // END OF FUNCTION: updateDestinationBubbles()

// LISTENERS
originInput.addEventListener('input', () => {
    const search = originInput.value.toLowerCase().trim();
    originResults.innerHTML = '';
    if (!search) return;
    const matches = stations
        .filter(station =>
            station.name.toLowerCase().includes(search) ||
            station.crs.toLowerCase().includes(search)
        )
        .slice(0, 10);
    matches.forEach(station => {
        const result = document.createElement('div');
        result.className = 'origin-result';
        result.textContent = `${station.name} (${station.crs})`;
        result.addEventListener('click', () => {
            originInput.value = `${station.name} (${station.crs})`;
            originInput.dataset.crs = station.crs;
            originResults.innerHTML = '';
            map.setView([
                station.latitude,
                station.longitude
            ], 9);
            const selectedCRS = station.crs;
			processSelectedOrigin(selectedCRS);
        });
        originResults.appendChild(result);
    });
});
yearInput.addEventListener('change', () => {
    const selectedCRS = originInput.dataset.crs;
    if (!selectedCRS) return;
    updateDestinationBubbles(selectedCRS);
    if (!currentRoutingTree || currentOriginCRS !== selectedCRS) return;
    const selectedYear = yearInput.value;
    const flowData = calculatePassengerFlows(
    	currentRoutingTree,
    	selectedCRS,
    	selectedYear
	);
	currentPassengerFlows = flowData.edgeFlows;
	drawPassengerFlows(currentRoutingTree, flowData);
});
