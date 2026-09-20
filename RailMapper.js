const map = L.map('map').setView([54.5, -3], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const destinationLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);

const originInput = document.getElementById('origin');
const yearInput = document.getElementById('year');
const originResults = document.getElementById('origin-results');

let journeys = [];
let stations = [];
let stationTransfers = [];
let railwayNodes = new Map();
let railwayGraph = new Map();
let railwayRoutingGraph = new Map();

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

    const stationByStopPosition = new Map();

    stations.forEach(station => {
        station.stop_positions.forEach(id => {
            stationByStopPosition.set(String(id), station);
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
    			const targetStation = stations.find(station => station.crs === targetCRS);

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
        distances: distances,
        previous: previous
    };
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

            updateDestinationBubbles(selectedCRS);

            console.log('Selected station:', selectedCRS);

            const selectedYear = yearInput.value;
            console.log('Year: ', selectedYear);
        });

        originResults.appendChild(result);
    });
});

yearInput.addEventListener('change', () => {
    const selectedCRS = originInput.dataset.crs;

    if (!selectedCRS) return;

    updateDestinationBubbles(selectedCRS);
});



/*const map = L.map('map').setView([54.5, -3], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const destinationLayer = L.layerGroup().addTo(map);

Promise.all([
    fetch('data/railway-nodes.json').then(response => response.json()),
    fetch('data/railway-ways.json').then(response => response.json()),
    fetch('data/railway-ways-data.json').then(response => response.json()),
    fetch('data/stations.json').then(response => response.json())
])
.then(([nodesData, waysData, waysMetaData, stationsData]) => {
	const nodes = Array.isArray(nodesData) ? nodesData : nodesData.nodes;
	const ways = Array.isArray(waysData) ? waysData : waysData.ways;
	const waysMeta = Array.isArray(waysMetaData) ? waysMetaData : waysMetaData["ways-data"];
	const waysMetaById = new Map(waysMeta.map(way => [String(way[0]), way]));
	stations = Object.entries(stationsData);

    console.log('Railway nodes:', nodes.length);
    console.log('Railway ways:', ways.length);
	console.log('Railway ways-data:', waysMeta.length);
    console.log('Railway stations:', stations.length);

    const railwayNodes = new Map();
    const railwayGraph = new Map();
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
    				railway: waysMetaById.get(String(wayId))?.[1] || null,
    				service: waysMetaById.get(String(wayId))?.[2] || null,
    				layer: waysMetaById.get(String(wayId))?.[3] || null,
    				operator: waysMetaById.get(String(wayId))?.[4] || null,
    				network: waysMetaById.get(String(wayId))?.[5] || null,
    				usage: waysMetaById.get(String(wayId))?.[6] || null
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
    const railwayLayer = L.geoJSON(
		{
        	type: 'FeatureCollection',
        	features: railwayFeatures
    	}, 
		{
        	style: {
            	color: '#777',
            	weight: 1,
            	opacity: 0.7
        	}
    	}
	).addTo(map);
    
	const stationsByCRS = new Map();
	stations.forEach(([crs, record]) => {
    	const station = record.station;
    	if (!station || !station.name) return;
    	stationsByCRS.set(crs, {
        	crs: crs,
        	name: station.name,
        	latitude: parseFloat(station.latitude),
        	longitude: parseFloat(station.longitude),
        	Network: station.Network || [],
        	TOC: station.TOC || [],
        	stop_positions: record.stop_positions || []
    	});
	});
	console.log('Railway stations:', stationsByCRS.size);
	stationsByCRS.forEach(station => {
    	L.circleMarker([station.latitude, station.longitude], {
        	radius: 2,
        	weight: 1
    	})
    	.bindPopup(`<strong>${station.name}</strong> (${station.crs})`)
    	.addTo(map);
	});
})
.catch(error => console.error('Error loading railway network data:', error));

const originInput = document.getElementById('origin');
const yearInput = document.getElementById('year');
const originResults = document.getElementById('origin-results');
let journeys = [];
let stations = [];



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
        		station: stations.find(station => station.CRS === crs),
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
            	parseFloat(destination.station.Latitude),
            	parseFloat(destination.station.Longitude)
        	], {
            	radius: Math.pow(destination.journeys, 0.25) * 1.5,
            	weight: 2,
            	color: 'black',
            	fillColor: 'red',
            	fillOpacity: 0.45
        	})

			.bindPopup(`
    			<strong>${destination.station.Name}</strong> (${destination.station.CRS})<br>
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


				
        	/*.bindPopup(`
            	<strong>${destination.station.Name}</strong> (${destination.station.CRS})<br>
            	Journeys from/to: ${originInput.value}<br><br>
            	${destination.yearlyJourneys
                	.map(year => `${year.year}: ${year.journeys.toLocaleString()}`)
                	.join('<br>')}
        	`)
			*/
/*
        	.addTo(destinationLayer);
    	});
		const selectedStation = stations.find(station => station.CRS === selectedCRS);
		if (selectedStation) {
    		L.circleMarker([
        		parseFloat(selectedStation.Latitude),
        		parseFloat(selectedStation.Longitude)
    		], {
        		radius: 10,
        		weight: 4,
        		color: 'black',
        		fillColor: 'yellow',
        		fillOpacity: 0.9
    		})
    		.bindPopup(`<strong>${selectedStation.Name}</strong> (${selectedStation.CRS})`)
    		.addTo(destinationLayer);
		}
	} /* END OF FUNCTION */
/*
	originInput.addEventListener('input', () => {
    	const search = originInput.value.toLowerCase().trim();
    	originResults.innerHTML = '';
    	if (!search) return;
    	const matches = stations
        .filter(station =>
            station.Name.toLowerCase().includes(search) ||
            station.CRS.toLowerCase().includes(search)
        )
        .slice(0, 10);
		matches.forEach(station => {
        	const result = document.createElement('div');
        	result.className = 'origin-result';
        	result.textContent = `${station.Name} (${station.CRS})`;
        	result.addEventListener('click', () => {
				destinationLayer.clearLayers();
				originInput.value = `${station.Name} (${station.CRS})`;
            	originInput.dataset.crs = station.CRS;
            	originResults.innerHTML = '';
            	map.setView([
                	parseFloat(station.Latitude),
                	parseFloat(station.Longitude)
            	], 9);
				const selectedCRS = station.CRS;
				updateDestinationBubbles(selectedCRS);
				console.log('Selected station:', selectedCRS);
				const selectedYear = yearInput.value;
				console.log('Year: ', yearInput.value);
        	});
        	originResults.appendChild(result);
    	});
	});
	yearInput.addEventListener('change', () => {
    	const selectedCRS = originInput.dataset.crs;
    	if (!selectedCRS) return;
    	updateDestinationBubbles(selectedCRS);
	});
})
.catch(error => console.error('Error loading station data:', error));*/
