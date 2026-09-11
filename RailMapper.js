const map = L.map('map').setView([54.5, -3], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const originInput = document.getElementById('origin');
const originResults = document.getElementById('origin-results');

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
        });

        originResults.appendChild(result);
    });
});
    .catch(error => console.error('Error loading station data:', error));
