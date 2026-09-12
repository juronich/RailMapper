const map = L.map('map').setView([54.5, -3], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

fetch('data/railways.geojson')
    .then(response => response.json())
    .then(data => {
        L.geoJSON(data, {
            style: {
                color: '#777',
                weight: 1,
                opacity: 0.7
            }
        }).addTo(map);
    })
    .catch(error => console.error('Error loading railway data:', error));

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
            .bindPopup(`<strong>${station.Name}</strong><br>CRS: ${station.CRS}`)
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
					console.log('Other stations:', otherStations);

					const destinationStations = otherStations.map(destination =>
    					({
        					station: stations.find(station => station.CRS === destination.crs),
        					journeys: destination.journeys
    					})
					);
					console.log('Destination stations:', destinationStations);
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
    					.bindPopup(`<strong>${destination.station.Name}</strong><br>Journeys: ${destination.journeys}`)
    					.addTo(map);
					});
        	});
        	originResults.appendChild(result);
    	});
	});
})
    .catch(error => console.error('Error loading station data:', error));
