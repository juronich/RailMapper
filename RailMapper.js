const map = L.map('map').setView([54.5, -3], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

fetch('data/stations.csv')
    .then(response => response.text())
    .then(csv => {
        const rows = csv.trim().split('\n').map(row => row.split(','));
        const headers = rows.shift();

        rows.forEach(row => {
            const station = {};
            headers.forEach((header, i) => station[header.trim()] = row[i]?.trim());

            const lat = parseFloat(station.Latitude);
            const lon = parseFloat(station.Longitude);

            if (!isNaN(lat) && !isNaN(lon)) {
                L.circleMarker([lat, lon], {
                    radius: 4,
                    weight: 1
                })
                .bindPopup(`<strong>${station.Name}</strong><br>CRS: ${station.CRS}`)
                .addTo(map);
            }
        });
    })
    .catch(error => console.error('Error loading station data:', error));
