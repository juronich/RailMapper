const map = L.map('map').setView([54.5, -3], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const destinationLayer = L.layerGroup().addTo(map);

fetch('data/railway-network.json')
    .then(response => response.json())
    .then(data => {
        console.log('Railway nodes:', data.nodes.length);
        console.log('Railway ways:', data.ways.length);

        const railwayGraph = new Map();
        const railwayFeatures = [];

        data.ways.forEach(way => {
            const nodeIndexes = way[0];

            if (nodeIndexes.length < 2) return;

            const coordinates = nodeIndexes.map(nodeIndex => {
                const node = data.nodes[nodeIndex];
                return [node[1], node[0]];
            });

            railwayFeatures.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: coordinates
                },
                properties: {
                    railway: way[1],
                    operator: way[2],
                    layer: way[3],
                    service: way[4]
                }
            });

            for (let i = 0; i < nodeIndexes.length - 1; i++) {
                const startNode = nodeIndexes[i];
                const endNode = nodeIndexes[i + 1];

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

        console.log('Railway features:', railwayFeatures.length);
    })
    .catch(error => console.error('Error loading railway network:', error));

/*Promise.all([
	fetch('data/railways.geojson').then(response => response.json()),
    fetch('data/other_railways.geojson').then(response => response.json())
])
    .then(([railwayData, other_railwayData]) => {
		
        const combinedRailwayData = {
            type: 'FeatureCollection',
            features: [
                ...railwayData.features,
                ...other_railwayData.features
            ]
        };
		console.log('Railway features:',combinedRailwayData.features.length);
		let railwayPoints = 0;
		combinedRailwayData.features.forEach(feature => {
            if (feature.geometry?.type === 'LineString') {
                railwayPoints += feature.geometry.coordinates.length;
            }
        });
        console.log('Railway coordinate points:', railwayPoints);

		const railwayGraph = new Map();
		combinedRailwayData.features.forEach(feature => {
    		if (feature.geometry?.type !== 'LineString') return;
    		const coordinates = feature.geometry.coordinates;
    		for (let i = 0; i < coordinates.length - 1; i++) {
        		const start = coordinates[i];
        		const end = coordinates[i + 1];
        		const startKey = `${start[0].toFixed(5)},${start[1].toFixed(5)}`;
        		const endKey = `${end[0].toFixed(5)},${end[1].toFixed(5)}`;
        		if (!railwayGraph.has(startKey)) railwayGraph.set(startKey, []);
        		if (!railwayGraph.has(endKey)) railwayGraph.set(endKey, []);
        		railwayGraph.get(startKey).push({
            		node: endKey,
            		coordinates: end
        		});
        		railwayGraph.get(endKey).push({
            		node: startKey,
            		coordinates: start
        		});
    		}
		});
		console.log('Railway graph nodes:', railwayGraph.size);

        const railwayLayer = L.geoJSON(combinedRailwayData, {
            style: {
                color: '#777',
                weight: 2,
                opacity: 0.7
            }
        }).addTo(map);
    })
    .catch(error => console.error('Error loading railway data:', error));
*/


/*fetch('data/railways.geojson')
    .then(response => response.json())
    .then(data => {
		
		console.log('Railway features:', data.features.length);
		let railwayPoints = 0;
		data.features.forEach(feature => {
    		if (feature.geometry?.type === 'LineString') {
        		railwayPoints += feature.geometry.coordinates.length;
    		}
		});
		console.log('Railway features:', data.features.length);
		console.log('Railway coordinate points:', railwayPoints);
		
        const railwayLayer = L.geoJSON(data, {
            style: {
                color: '#777',
                weight: 1,
                opacity: 0.7
            }
        }).addTo(map);
    })
    .catch(error => console.error('Error loading railway data:', error));
fetch('data/other_railways.geojson')
    .then(response => response.json())
    .then(data => {
		
		console.log('Other Railway features:', data.features.length);
		let other_railwayPoints = 0;
		data.features.forEach(feature => {
    		if (feature.geometry?.type === 'LineString') {
        		railwayPoints += feature.geometry.coordinates.length;
    		}
		});
		console.log('Other Railway features:', data.features.length);
		console.log('Other Railway coordinate points:', other_railwayPoints);
		
        const other_railwayLayer = L.geoJSON(data, {
            style: {
                color: '#666',
                weight: 1,
                opacity: 0.7
            }
        }).addTo(map);
    })
    .catch(error => console.error('Error loading other_railway data:', error));
	*/
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
            L.circleMarker([lat, lon], {
                radius: 1,
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
    					.bindPopup(`<strong>${destination.station.Name}</strong> (${destination.station.CRS})<br>Journeys: ${destination.journeys.toLocaleString()}`)
    					.addTo(destinationLayer);
					});
        	});
        	originResults.appendChild(result);
    	});
	});
})
    .catch(error => console.error('Error loading station data:', error));
