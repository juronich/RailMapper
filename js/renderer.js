// Converts an array of node IDs into Leaflet lat/lng coordinate pairs.
export function getCoordinatesForPath(pathNodes, railwayNodes) {
    const coords = [];
    pathNodes.forEach(nodeId => {
        const nodeKey = String(nodeId);
        const node = railwayNodes.get(nodeKey);
        if (node && !isNaN(node.latitude) && !isNaN(node.longitude)) {
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
export function drawDestinationMarkers(destinationLayer, destinationData, stationByCRS, availableYears, selectedYear, journeys, selectedOriginCRS, onMarkerClick) {
    destinationLayer.clearLayers();
    destinationData.forEach(({ crs }) => {
        const station = stationByCRS.get(crs);
        if (!station || isNaN(station.latitude) || isNaN(station.longitude)) return;
        // Find the bi-directional journey record for this station pair
        const journeyRecord = journeys.find(j => 
            (j.OriginCRS === selectedOriginCRS && j.DestinationCRS === crs) ||
            (j.OriginCRS === crs && j.DestinationCRS === selectedOriginCRS)
        );
        const currentPassengerCount = journeyRecord ? (journeyRecord[selectedYear] || 0) : 0; 
        const radius = Math.max(3, Math.min(25, Math.sqrt(currentPassengerCount) * 0.05)); // Scale marker size based on active year volume
        let popupHtml = `<div style="font-family: sans-serif; min-width: 160px;">`; // Build popup HTML listing all available years
        popupHtml += `<strong style="font-size: 14px;">${station.name} (${crs})</strong><hr style="margin: 4px 0;">`;
        popupHtml += `<table style="width: 100%; border-collapse: collapse; font-size: 12px;">`;
        availableYears.forEach(year => {
            const val = journeyRecord && journeyRecord[year] ? journeyRecord[year].toLocaleString() : '0';
            if (year === selectedYear) {
                popupHtml += `<tr style="background-color: #f0f4f8;">
                    <td style="padding: 2px 4px;"><strong>${year}</strong></td>
                    <td style="text-align: right; padding: 2px 4px;"><strong>${val}</strong></td>
                </tr>`;
            } else {
                popupHtml += `<tr>
                    <td style="padding: 2px 4px; color: #555;">${year}</td>
                    <td style="text-align: right; padding: 2px 4px; color: #555;">${val}</td>
                </tr>`;
            }
        });
        popupHtml += `</table></div>`;
        // Create Leaflet circle marker
        const marker = L.circleMarker([station.latitude, station.longitude], {
            radius: radius,
            color: '#000',
            fillColor: '#3388ff',
            fillOpacity: 0.7,
            weight: 1
        }).bindPopup(popupHtml);
        // Attach click callback to draw the individual route polyline
        marker.on('click', () => {
            if (typeof onMarkerClick === 'function') {
                onMarkerClick(crs);
            }
        });

        marker.addTo(destinationLayer);
    });
}
        
// Draws aggregated passenger flows across segment polylines.
export function drawPassengerFlows(flowLayer, flows, railwayNodes, maxFlowValue = 1) {
    // THINK I CAN REMOVE maxFlowValue from this
    flowLayer.clearLayers();
    flows.forEach((flowVolume, edgeKey) => {
        const [nodeA, nodeB] = edgeKey.split('-');
        const posA = railwayNodes.get(nodeA);
        const posB = railwayNodes.get(nodeB);
        if (!posA || !posB) return;
        // Calculate relative weight/opacity based on volume ratio
        const ratio = Math.min(1, flowVolume / maxFlowValue);
        //const weight = 1 + ratio * 8;
        const weight = 1 + (Math.pow(flowVolume, 0.2) * 0.65);
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
