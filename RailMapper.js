const map = L.map('map').setView([54.5, -3], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const destinationLayer = L.layerGroup().addTo(map);

/*function findNearestRailwayNode(latitude, longitude, nodes) {
    let nearestNode = null;
    let nearestDistance = Infinity;

    nodes.forEach((node, index) => {
        const nodeLatitude = node[0];
        const nodeLongitude = node[1];

        const distance = Math.pow(nodeLatitude - latitude, 2) + Math.pow(nodeLongitude - longitude, 2);

        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestNode = index;
        }
    });

    return nearestNode;
	
}
*/
Promise.all([
    fetch('data/railway-nodes.json').then(response => response.json()),
    fetch('data/railway-ways.json').then(response => response.json()),
    fetch('data/railway-ways-data.json').then(response => response.json()),
    fetch('data/railway-stops.json').then(response => response.json())
])
.then(([nodesData, waysData, waysMetaData, stopsData]) => {
	const nodes = Array.isArray(nodesData) ? nodesData : nodesData.nodes;
	const ways = Array.isArray(waysData) ? waysData : waysData.ways;
	const waysMeta = Array.isArray(waysMetaData) ? waysMetaData : waysMetaData["ways-data"];
	const stops = stopsData.elements || stopsData;

    console.log('Railway nodes:', nodes.length);
    console.log('Railway ways:', ways.length);
	console.log('Railway ways-data:', waysMeta.length);
    console.log('Railway stops:', stops.length);

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
                	railway: way[1],
                	operator: way[2],
                	layer: way[3],
                	service: way[4]
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
            color: '#777',
            weight: 1,
            opacity: 0.7
        }
    }).addTo(map);

    const stopsByName = new Map();

    stops.forEach(stop => {
        if (!stop.tags || !stop.tags.name) return;

        const name = stop.tags.name.trim().toLowerCase();

        if (!stopsByName.has(name)) {
            stopsByName.set(name, []);
        }

        stopsByName.get(name).push({
            id: String(stop.id),
            latitude: parseFloat(stop.lat),
            longitude: parseFloat(stop.lon),
            tags: stop.tags
        });
    });

    console.log('Named railway stops:', stopsByName.size);
    const brightonStops = stopsByName.get('brighton') || [];
    console.log('Brighton OSM stops:', brightonStops);
	const testGraphNode = railwayNodes.get('638636');

	console.log('Test graph node 638636:', testGraphNode);
	brightonStops.forEach(stop => {
    	const node = railwayNodes.get(stop.id);
    	console.log('Brighton stop:', stop);
    	console.log('Found in railway nodes:', node);
    	console.log('Connected to graph:', railwayGraph.has(stop.id));
    	if (node) {
        	let nearestGraphNode = null;
        	let nearestDistance = Infinity;
        	railwayGraph.forEach((connections, graphNodeId) => {
            	const graphNode = railwayNodes.get(graphNodeId);
				if (graphNodeId === '638636') {
    				console.log('Comparing Brighton stop with node 638636:', {
        				stopLatitude: node.latitude,
        				stopLongitude: node.longitude,
        				graphLatitude: graphNode.latitude,
        				graphLongitude: graphNode.longitude
    				});
				}
            	if (!graphNode) return;
            	const distance = Math.hypot(
                	node.latitude - graphNode.latitude,
                	node.longitude - graphNode.longitude
            	);
            	if (distance < nearestDistance) {
                	nearestDistance = distance;
                	nearestGraphNode = graphNodeId;
            	}
        	});
	        console.log('Nearest graph node:', nearestGraphNode);
    	    console.log('Approximate coordinate distance:', nearestDistance);
    	}
	});
})
.catch(error => console.error('Error loading railway network data:', error));






const originInput = document.getElementById('origin');
const originResults = document.getElementById('origin-results');
let journeys = [];

fetch('data/stations.csv')
.then(response => response.text())
.then(csv => {
    const rows = csv.trim().split('\n').map(row => row.split(','));
    const headers = rows.shift();
    const stations = [];
    rows.forEach(row => {
        const station = {};
        headers.forEach((header, i) => station[header.trim()] = row[i]?.trim());
        const lat = parseFloat(station.Latitude);
        const lon = parseFloat(station.Longitude);
		if (!isNaN(lat) && !isNaN(lon)) {
    		stations.push(station);
   			if (stations.length <= 5) console.log('Station loaded:', station);
    		L.circleMarker([lat, lon], {
                radius: 2,
                weight: 1
            })
            .bindPopup(`<strong>${station.Name}</strong> (${station.CRS})`)
            .addTo(map);
        }
    });
    stations.sort((a, b) => a.Name.localeCompare(b.Name));
	fetch('data/journeys.csv')
    	.then(response => response.text())
    	.then(csv => {
        	const rows = csv.trim().split('\n').map(row => row.split(','));
        	const headers = rows.shift();
        	rows.forEach(row => {
            	const journey = {};
            	headers.forEach((header, i) => journey[header.trim()] = row[i]?.trim());
            	journeys.push(journey);
        	});
        	//console.log('Journey data:', journeys);
    	})
   	 	.catch(error => console.error('Error loading journey data:', error));
		
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
            		], 10);
					const selectedCRS = station.CRS;
					const relevantJourneys = journeys.filter(journey =>
    					journey.OriginCRS === selectedCRS ||
    					journey.DestinationCRS === selectedCRS
					);
					console.log('Selected station:', selectedCRS);
					console.log('Relevant journeys:', relevantJourneys);
					const otherStations = relevantJourneys.map(journey => ({
    					crs: journey.OriginCRS === selectedCRS
        				? journey.DestinationCRS
        				: journey.OriginCRS,
    					journeys: parseInt(journey.Journeys, 10)
					}));
					//console.log('Other stations:', otherStations);

					const destinationStations = otherStations.map(destination =>
    					({
        					station: stations.find(station => station.CRS === destination.crs),
        					journeys: destination.journeys
    					})
					);
					//console.log('Destination stations:', destinationStations);
					destinationStations.forEach(destination => {
    					if (!destination.station) return;

    					L.circleMarker([
        					parseFloat(destination.station.Latitude),
        					parseFloat(destination.station.Longitude)
    					], {
        					//radius: 2 + Math.log10(destination.journeys + 1) * 3,
							radius: 0 + Math.pow(destination.journeys, 0.25) * 1.5,
        					weight: 2,
							color: 'black',
    						fillColor: 'red',
    						fillOpacity: 0.45
    					})
    					.bindPopup(`<strong>${destination.station.Name}</strong> (${destination.station.CRS})<br>Journeys from/to: ${originInput.value}<br> ${destination.journeys.toLocaleString()}`)
    					.addTo(destinationLayer);
					});
        	});
        	originResults.appendChild(result);
    	});
	});
})
    .catch(error => console.error('Error loading station data:', error));
