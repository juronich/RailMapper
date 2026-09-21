const map = L.map('map').setView([54.5, -3], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
	className: 'basemap'
}).addTo(map);

const destinationLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const flowLayer = L.layerGroup().addTo(map);
const originInput = document.getElementById('origin');
const yearInput = document.getElementById('year');
const originResults = document.getElementById('origin-results');


let journeys = [];
let stations = [];
let stationTransfers = [];
let railwayNodes = new Map();
let railwayGraph = new Map();
let railwayRoutingGraph = new Map();
let currentRoutingTree = null;
let currentOriginCRS = null;
let currentPassengerFlows = null;
let stationByStopPosition = new Map();

Promise.all([
    fetch('data/railway-nodes.json').then(response => response.json()),
    fetch('data/railway-ways.json').then(response => response.json()),
    fetch('data/railway-ways-data.json').then(response => response.json()),
    fetch('data/stations.json').then(response => response.json()),
	fetch('data/railway-routing.json').then(response => response.json()),
	fetch('data/station-transfers.json').then(response => response.json())
])
.then(([nodesData, waysData, waysMetaData, stationsData, routingData, transfersData]) => {
    const nodes = Array.isArray(nodesData) ? nodesData : nodesData.nodes;
    const ways = Array.isArray(waysData) ? waysData : waysData.ways;
    const waysMeta = Array.isArray(waysMetaData) ? waysMetaData : waysMetaData["ways-data"];
    const waysMetaById = new Map(waysMeta.map(way => [String(way[0]), way]));
	const routingEdges = routingData.edges;


    stations = Object.entries(stationsData).map(([crs, record]) => ({
        crs: crs,
        name: record.station?.name,
        latitude: parseFloat(record.station?.latitude),
        longitude: parseFloat(record.station?.longitude),
        Network: record.station?.Network || [],
        TOC: record.station?.TOC || [],
        stop_positions: record.stop_positions || []
    })).filter(station => station.name && !isNaN(station.latitude) && !isNaN(station.longitude));
	stationByStopPosition.clear();

	stations.forEach(station => {
    	station.stop_positions.forEach(id => {
        	stationByStopPosition.set(String(id), station);
    	});
	});
    console.log('Railway nodes:', nodes.length);
    console.log('Railway ways:', ways.length);
    console.log('Railway ways-data:', waysMeta.length);
    console.log('Railway stations:', stations.length);

    const railwayFeatures = [];

    nodes.forEach(node => {
        railwayNodes.set(String(node[0]), {
            latitude: node[1],
            longitude: node[2]
        });
    });

    ways.forEach(way => {
        const wayId = way[0];
        const nodeIds = way[1];
        if (!nodeIds || nodeIds.length < 2) return;

        const coordinates = nodeIds
            .map(nodeId => railwayNodes.get(String(nodeId)))
            .filter(node => node);

        const wayMeta = waysMetaById.get(String(wayId));

        if (coordinates.length >= 2) {
            railwayFeatures.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: coordinates.map(node => [
                        node.longitude,
                        node.latitude
                    ])
                },
                properties: {
                    railway: wayMeta?.[1] || null,
                    service: wayMeta?.[2] || null,
                    layer: wayMeta?.[3] || null,
                    operator: wayMeta?.[4] || null,
                    network: wayMeta?.[5] || null,
                    usage: wayMeta?.[6] || null
                }
            });
        }

        for (let i = 0; i < nodeIds.length - 1; i++) {
            const startNode = String(nodeIds[i]);
            const endNode = String(nodeIds[i + 1]);

            if (!railwayGraph.has(startNode)) {
                railwayGraph.set(startNode, []);
            }

            if (!railwayGraph.has(endNode)) {
                railwayGraph.set(endNode, []);
            }

            railwayGraph.get(startNode).push(endNode);
            railwayGraph.get(endNode).push(startNode);
        }
    });

    console.log('Railway graph nodes:', railwayGraph.size);

    const railwayLayer = L.geoJSON({
        type: 'FeatureCollection',
        features: railwayFeatures
    }, {
        style: {
            color: '#4EA72E',
            weight: 1,
            opacity: 0.7
        }
    }).addTo(map);

    console.log('Railway stations:', stations.length);

    stations.forEach(station => {
        L.circleMarker([station.latitude, station.longitude], {
            radius: 2,
            weight: 1
        })
        .bindPopup(`<strong>${station.name}</strong> (${station.crs})`)
        .addTo(map);
    });
	routingData.edges.forEach(edge => {
    	const [from, to, distance, path] = edge;

    	if (!railwayRoutingGraph.has(String(from))) railwayRoutingGraph.set(String(from), []);
    	if (!railwayRoutingGraph.has(String(to))) railwayRoutingGraph.set(String(to), []);

    	railwayRoutingGraph.get(String(from)).push({
        	node: String(to),
        	distance: distance,
        	path: path
    	});

    	railwayRoutingGraph.get(String(to)).push({
        	node: String(from),
        	distance: distance,
        	path: [...path].reverse()
    	});
	});
	console.log('Railway routing graph nodes:', railwayRoutingGraph.size);
	stationTransfers = transfersData.transfers || [];
	console.log('Station transfers loaded:', stationTransfers.length);
})
.catch(error => console.error('Error loading railway network data:', error));


function getTransferNodes(crs) {
    const station = stations.find(station => station.crs === crs);
    if (!station) return [];

    return station.stop_positions
        .map(id => String(id))
        .filter(id => railwayRoutingGraph.has(id));
}

function buildOriginRoutingTree(originCRS) {
    const originStation = stations.find(station => station.crs === originCRS);
    if (!originStation) {
        console.error('Could not find origin station:', originCRS);
        return null;
    }
    const distances = new Map();
    const previous = new Map();
    const unvisited = new Set();
    railwayRoutingGraph.forEach((edges, node) => {
        distances.set(node, Infinity);
        unvisited.add(node);
    });
    const startNodes = originStation.stop_positions
        .map(id => String(id))
        .filter(id => railwayRoutingGraph.has(id));
    if (!startNodes.length) {
        console.error('Origin station has no usable routing nodes:', originCRS);
        return null;
    }
    startNodes.forEach(node => {
        distances.set(node, 0);
    });
    const stationConnections = new Map();
    stations.forEach(station => {
        station.stop_positions.forEach(id => {
            const node = String(id);
            if (!railwayRoutingGraph.has(node)) return;
            stationConnections.set(node, {
                stationCRS: station.crs,
                fromCoordinates: [
                    station.latitude,
                    station.longitude
                ],
                toCoordinates: [
                    railwayNodes.get(node).latitude,
                    railwayNodes.get(node).longitude
                ]
            });
        });
    });
    const transfersByCRS = new Map();
    stationTransfers.forEach(([crs1, crs2]) => {
        if (!transfersByCRS.has(crs1)) transfersByCRS.set(crs1, []);
        if (!transfersByCRS.has(crs2)) transfersByCRS.set(crs2, []);
        transfersByCRS.get(crs1).push(crs2);
        transfersByCRS.get(crs2).push(crs1);
    });
    while (unvisited.size > 0) {
        let currentNode = null;
        let currentDistance = Infinity;
        for (const node of unvisited) {
            const distance = distances.get(node);

            if (distance < currentDistance) {
                currentNode = node;
                currentDistance = distance;
            }
        }
        if (currentNode === null || currentDistance === Infinity) {
            break;
        }
        unvisited.delete(currentNode);
        for (const edge of railwayRoutingGraph.get(currentNode) || []) {
            if (!unvisited.has(edge.node)) continue;
            const newDistance = currentDistance + edge.distance;
            if (newDistance < distances.get(edge.node)) {
                distances.set(edge.node, newDistance);
                previous.set(edge.node, {
                    node: currentNode,
                    edge: edge
                });
            }
        }
        const currentStation = stationByStopPosition.get(currentNode);
        if (currentStation) {
            const connectedCRS = transfersByCRS.get(currentStation.crs) || [];
            for (const targetCRS of connectedCRS) {
                const targetStation = stations.find(
                    station => station.crs === targetCRS
                );
                if (!targetStation) continue;
                for (const stopPosition of targetStation.stop_positions) {
                    const transferNode = String(stopPosition);
                    if (!unvisited.has(transferNode)) continue;
                    if (!railwayRoutingGraph.has(transferNode)) continue;
                    const newDistance = currentDistance;
                    if (newDistance < distances.get(transferNode)) {
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
}


function drawPassengerFlows(tree, flowData) {
    flowLayer.clearLayers();

    if (!tree || !flowData || !flowData.edgeFlows || !flowData.edgeFlows.size) return;

    const flows = flowData.edgeFlows;
    const destinationNodes = flowData.destinationNodes || new Map();
    const maxFlow = Math.max(...flows.values());

    flows.forEach((flow, edgeKey) => {
        const [fromNode, toNode] = edgeKey.split('->');
        const previous = tree.previous.get(toNode);

        if (!previous || previous.node !== fromNode) return;

        const edge = previous.edge;
        let coordinates = [];

        if (edge.transfer) {
            coordinates = [
                edge.fromCoordinates,
                edge.toCoordinates
            ];
        } else {
            coordinates = edge.path
                .map(nodeId => railwayNodes.get(String(nodeId)))
                .filter(node => node)
                .map(node => [
                    node.latitude,
                    node.longitude
                ]);
        }

        if (coordinates.length < 2) return;

        const stationConnection = tree.stationConnections?.get(fromNode);

        if (stationConnection && stationConnection.stationCRS === tree.originCRS) {
            coordinates.unshift(stationConnection.fromCoordinates);
        }

        // Extend the final destination segment to the station coordinates.
        if (destinationNodes.has(toNode)) {
            const destinationConnection = tree.stationConnections?.get(toNode);

            if (destinationConnection) {
                coordinates.push(destinationConnection.fromCoordinates);
            }
        }

        const width = 1 + (Math.sqrt(flow / maxFlow) * 12);

        L.polyline(coordinates, {
            color: '#3388ff',
            weight: width,
            opacity: 1,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(flowLayer);
    });
}

function findRailwayRoute(startCRS, endCRS) {
    const startStation = stations.find(station => station.crs === startCRS);
    const endStation = stations.find(station => station.crs === endCRS);
    if (!startStation || !endStation) {
        console.error('Could not find start or end station');
        return null;
    }
    const startNodes = startStation.stop_positions
        .map(id => String(id))
        .filter(id => railwayRoutingGraph.has(id));
    const endNodes = new Set(
        endStation.stop_positions
            .map(id => String(id))
            .filter(id => railwayRoutingGraph.has(id))
    );
    if (!startNodes.length || !endNodes.size) {
        console.error('One or both stations have no usable routing nodes');
        return null;
    }
    const distances = new Map();
    const previous = new Map();
    const unvisited = new Set();
    railwayRoutingGraph.forEach((edges, node) => {
        distances.set(node, Infinity);
        unvisited.add(node);
    });
    startNodes.forEach(node =>{distances.set(node, 0)});
    while (unvisited.size > 0) {
        let currentNode = null;
        let currentDistance = Infinity;
        for (const node of unvisited) {
            const distance = distances.get(node);
            if (distance < currentDistance) {
                currentNode = node;
                currentDistance = distance;
            }
        }
        if (currentNode === null || currentDistance === Infinity) {
            break;
        }
        if (endNodes.has(currentNode)) {
            const routingEdges = [];
            let node = currentNode;
            while (previous.has(node)) {
                const previousStep = previous.get(node);
                routingEdges.unshift(previousStep.edge);
                node = previousStep.node;
            }
            const physicalNodes = [];
            routingEdges.forEach((edge, index) => {
    			if (edge.transfer) {
        			physicalNodes.push({
            			transfer: true,
            			fromCoordinates: edge.fromCoordinates,
            			toCoordinates: edge.toCoordinates
        			});
        			return;
    			}

    			if (index === 0) {
        			physicalNodes.push(...edge.path);
    			} else {
        			physicalNodes.push(...edge.path.slice(1));
    			}
			});
            return {
                nodes: physicalNodes,
                distance: currentDistance
            };
        }
        unvisited.delete(currentNode);
        for (const edge of railwayRoutingGraph.get(currentNode) || []) {
    		if (!unvisited.has(edge.node)) continue;
    		const newDistance = currentDistance + edge.distance;
    		if (newDistance < distances.get(edge.node)) {
        		distances.set(edge.node, newDistance);
        		previous.set(edge.node, {
            		node: currentNode,
            		edge: edge
        		});
    		}
		}
		const currentStation = stations.find(station =>
    		station.stop_positions.map(id => String(id)).includes(currentNode)
		);
		if (currentStation) {
    		for (const [fromCRS, toCRS] of stationTransfers) {
        		let targetCRS = null;
        		if (fromCRS === currentStation.crs) {
            		targetCRS = toCRS;
        		} else if (toCRS === currentStation.crs) {
            		targetCRS = fromCRS;
        		}
        		if (!targetCRS) continue;
        		const transferNodes = getTransferNodes(targetCRS);
        		for (const transferNode of transferNodes) {
            		if (!unvisited.has(transferNode)) continue;
            		const newDistance = currentDistance;
            		if (newDistance < distances.get(transferNode)) {
                		distances.set(transferNode, newDistance);
                		previous.set(transferNode, {
                    		node: currentNode,
                    		edge: {
    							node: transferNode,
    							distance: 0,
    							path: [],
    							transfer: true,
    							fromCoordinates: [currentStation.latitude, currentStation.longitude],
    							toCoordinates: [
									stations.find(station => station.crs === targetCRS).latitude, 
									stations.find(station => station.crs === targetCRS).longitude
								]
							}
                		});
            		}
        		}
    		}
		}
    }
    return null;
}
function drawRailwayRoute(route) {
    routeLayer.clearLayers();

    if (!route) {
        console.error('No route found');
        return;
    }

    const coordinates = [];
	route.nodes.forEach(node => {
    	if (typeof node === 'object' && node.transfer) {
        	coordinates.push(node.fromCoordinates);
        	coordinates.push(node.toCoordinates);
        	return;
    	}

    	const railwayNode = railwayNodes.get(String(node));

    	if (railwayNode) {
        	coordinates.push([railwayNode.latitude, railwayNode.longitude]);
    	}
	});

    L.polyline(coordinates, {
        color: 'blue',
        weight: 5,
        opacity: 0.9
    }).addTo(routeLayer);

    console.log('Route nodes:', route.nodes.length);
    console.log('Route distance:', (route.distance / 1000).toFixed(2), 'km');

    map.fitBounds(coordinates);
}

function drawDestinationRoute(tree, destinationCRS, destinationJourneys) {
    routeLayer.clearLayers();
	if (!tree || !currentOriginCRS) return;
	const maxFlow = Math.max(...currentPassengerFlows.values());
	const width = 1 + (Math.sqrt(destinationJourneys / maxFlow) * 12);
    const destinationStation = stations.find(
        station => station.crs === destinationCRS
    );
    if (!destinationStation) return;
    const destinationNodes = destinationStation.stop_positions
        .map(id => String(id))
        .filter(id => tree.distances.get(id) !== Infinity);
    if (!destinationNodes.length) return;
    const destinationNode = destinationNodes.reduce((closest, node) => {
        if (!closest) return node;
        return tree.distances.get(node) < tree.distances.get(closest)
            ? node
            : closest;
    }, null);
    const routingEdges = [];
    let node = destinationNode;
    while (tree.previous.has(node)) {
        const previous = tree.previous.get(node);
        routingEdges.unshift(previous.edge);
        node = previous.node;
    }
    const coordinates = [];


routingEdges.forEach(edge => {
    if (edge.transfer) {
        coordinates.push(edge.fromCoordinates);
        coordinates.push(edge.toCoordinates);
        return;
    }

    const edgeCoordinates = edge.path
        .map(nodeId => railwayNodes.get(String(nodeId)))
        .filter(node => node)
        .map(node => [
            node.latitude,
            node.longitude
        ]);

    if (coordinates.length === 0) {
        coordinates.push(...edgeCoordinates);
    } else {
        coordinates.push(...edgeCoordinates.slice(1));
    }
});

// Add the destination stop-position → station connection
const destinationConnection = tree.stationConnections?.get(destinationNode);

if (destinationConnection) {
    coordinates.push(destinationConnection.fromCoordinates);
}
    if (coordinates.length < 2) return;
    L.polyline(coordinates, {
        color: '#000000',
        weight: width + 3,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(routeLayer);
	L.polyline(coordinates, {
        color: '#ff6600',
        weight: width,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(routeLayer);
}

const journeyFiles = [
    'data/journeys/ODM_Scotland.json',
    'data/journeys/ODM_North.json',
    'data/journeys/ODM_Midlands.json',
    'data/journeys/ODM_Wales.json',
    'data/journeys/ODM_South.json',
    'data/journeys/ODM_London.json'
];

originInput.disabled = true;

Promise.all(
    journeyFiles.map(file =>
        fetch(file).then(response => response.json())
    )
)
.then(journeyDataFiles => {
    journeyDataFiles.forEach(data => {
        const years = data.years;

        Object.entries(data.journeys).forEach(([firstCRS, destinations]) => {
            Object.entries(destinations).forEach(([secondCRS, values]) => {
                const journey = {
                    OriginCRS: firstCRS,
                    DestinationCRS: secondCRS
                };

                years.forEach((year, index) => {
                    journey[year] = values[index] || 0;
                });

                journeys.push(journey);
            });
        });
    });

    console.log('Journey data loaded:', journeys.length, 'station pairs');
    originInput.disabled = false;
})
.catch(error => console.error('Error loading journey data:', error));

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
}

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
            destinationLayer.clearLayers();

            originInput.value = `${station.name} (${station.crs})`;
            originInput.dataset.crs = station.crs;
            originResults.innerHTML = '';

            map.setView([
                station.latitude,
                station.longitude
            ], 9);

            const selectedCRS = station.crs;

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
