const map = L.map('map').setView([54.5, -3], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const originSelect = document.getElementById('origin');

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
                    radius: 4,
                    weight: 1
                })
                .bindPopup(`<strong>${station.Name}</strong><br>CRS: ${station.CRS}`)
                .addTo(map);
            }
        });
         stations.sort((a, b) => a.Name.localeCompare(b.Name));

        stations.forEach(station => {
            const option = document.createElement('option');
            option.value = station.CRS;
            option.textContent = `${station.Name} (${station.CRS})`;
            originSelect.appendChild(option);
        });

        originSelect.addEventListener('change', () => {
            const selectedCRS = originSelect.value;
            const station = stations.find(s => s.CRS === selectedCRS);

            if (station) {
                map.setView([
                    parseFloat(station.Latitude),
                    parseFloat(station.Longitude)
                ], 10);
            }
        });
    })
    .catch(error => console.error('Error loading station data:', error));
