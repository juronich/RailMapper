// Converts an array of node IDs into Leaflet lat/lng coordinate pairs.
export function getCoordinatesForPath(pathNodes, railwayNodes) {
    const coords = [];
    pathNodes.forEach(nodeId => {
        const node = railwayNodes.get(String(nodeId));
        if (node) {
            coords.push([node.latitude, node.longitude]);
        }
    });
    return coords;
}

// Draws the selected point-to-point route onto the route layer.
export function drawRailwayRoute(routeLayer, pathNodes, railwayNodes, options = {}) {
    routeLayer.clearLayers();
    const coords = getCoordinatesForPath(pathNodes, railwayNodes);
    if (coords.length < 2) return null;
    const defaultOptions = {
        color: '#ff3300',
        weight: 4,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
    };
    const polyline = L.polyline(coords, { ...defaultOptions, ...options });
    polyline.addTo(routeLayer);
    return polyline;
}

// Highlights destination stations on the destination layer with scaled markers/popups.
export function drawDestinationMarkers(destinationLayer, destinationData, stationByCRS) {
    destinationLayer.clearLayers();
    destinationData.forEach(({ crs, passengerCount }) => {
        const station = stationByCRS.get(crs);
        if (!station) return;
        // Scale marker radius based on passenger volume
        const radius = Math.max(4, Math.min(18, Math.sqrt(passengerCount) / 10));
        const circle = L.circleMarker([station.latitude, station.longitude], {
            radius: radius,
            fillColor: '#3388ff',
            color: '#000',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.7
        });
        circle.bindPopup(`
            <strong>${station.name} (${crs})</strong><br/>
            Passengers: <strong>${passengerCount.toLocaleString()}</strong>
        `);
        circle.addTo(destinationLayer);
    });
}

// Draws aggregated passenger flows across segment polylines.
export function drawPassengerFlows(flowLayer, flows, railwayNodes, maxFlowValue = 1) {
    flowLayer.clearLayers();
    flows.forEach((flowVolume, edgeKey) => {
        const [nodeA, nodeB] = edgeKey.split('-');
        const posA = railwayNodes.get(nodeA);
        const posB = railwayNodes.get(nodeB);
        if (!posA || !posB) return;
        // Calculate relative weight/opacity based on volume ratio
        const ratio = Math.min(1, flowVolume / maxFlowValue);
        const weight = 1 + ratio * 8;
        const opacity = 0.3 + ratio * 0.6;
        L.polyline(
            [[posA.latitude, posA.longitude], [posB.latitude, posB.longitude]],
            {
                color: '#e74c3c',
                weight: weight,
                opacity: opacity,
                lineCap: 'round'
            }
        ).addTo(flowLayer);
    });
}

 // Clears all dynamic overlay layers from the map.
export function clearAllMapLayers(routeLayer, destinationLayer, flowLayer) {
    if (routeLayer) routeLayer.clearLayers();
    if (destinationLayer) destinationLayer.clearLayers();
    if (flowLayer) flowLayer.clearLayers();
}
