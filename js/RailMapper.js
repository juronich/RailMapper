console.log('v0.20176');
import { loadData } from './dataLoader.js';
import { computeShortestPathTree, reconstructPath, calculatePassengerFlows } from './router.js';
import { drawRailwayRoute, drawDestinationMarkers, drawPassengerFlows, clearAllMapLayers } from './renderer.js';
import { initializeYearSelector, setupStationAutocomplete } from './ui.js';

// MAP
const map = L.map('map').setView([54.5, -3], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
	className: 'basemap'
}).addTo(map);
// END OF MAP

// Separate Leaflet feature groups for dynamic overlays
const routeLayer = L.layerGroup().addTo(map);
const destinationLayer = L.layerGroup().addTo(map);
const flowLayer = L.layerGroup().addTo(map);

// Global dataset storage (populated on load)
let appState = {
    railwayNodes: null,
    stations: [],
    stationByCRS: new Map(),
    railwayRoutingGraph: new Map(),
    journeys: [],
    availableYears: []
};

// Currently selected user state
let selectedOriginCRS = null;
let selectedYear = null;
let currentRoutingTree = null;

// Core Rendering Orchestration
function updateVisualization() {
    clearAllMapLayers(routeLayer, destinationLayer, flowLayer);
    if (!selectedOriginCRS) return;
    // 1. Calculate Dijkstra shortest path tree from selected origin station
    currentRoutingTree = computeShortestPathTree(
        selectedOriginCRS, 
        appState.stationByCRS, 
        appState.railwayRoutingGraph
    );
    if (!currentRoutingTree) {
        console.warn(`No valid routing paths found starting from ${selectedOriginCRS}`);
        return;
    }
    // 2. Calculate edge-by-edge passenger flows across the network
    const edgeFlows = calculatePassengerFlows(
        currentRoutingTree, 
        selectedOriginCRS, 
        selectedYear, 
        appState.journeys, 
        appState.stationByCRS
    );
    let maxFlowVolume = 1;
	for (const volume of edgeFlows.values()) {
    	if (volume > maxFlowVolume) {
        	maxFlowVolume = volume;
    	}
	}
    // 3. Render flow polylines onto flowLayer
    drawPassengerFlows(
        flowLayer, 
        edgeFlows, 
        appState.railwayNodes, 
        maxFlowVolume
    );
    // 4. Render destination circle markers
    const originJourneys = appState.journeys.filter(
        j => j.OriginCRS === selectedOriginCRS && j[selectedYear] > 0
    );
    const destinationData = originJourneys.map(j => ({
        crs: j.DestinationCRS,
        passengerCount: j[selectedYear]
    }));
    drawDestinationMarkers(
        destinationLayer, 
        destinationData, 
        appState.stationByCRS, 
        (destinationCRS) => handleDestinationClick(destinationCRS)
    );
}

// Triggered when a destination station marker or search item is clicked
function handleDestinationClick(destinationCRS) {
    routeLayer.clearLayers();
    if (!currentRoutingTree || !selectedOriginCRS) return;
    const route = reconstructPath(
        destinationCRS, 
        appState.stationByCRS, 
        currentRoutingTree
    );
    if (route && route.pathNodes) {
        drawRailwayRoute(
            routeLayer, 
            route.pathNodes, 
            appState.railwayNodes, 
            { color: '#e63946', weight: 5, opacity: 0.9 }
        );
    }
}

// Application Initialization
async function init() {
    try {
        // Load datasets and draw base railway polylines
        const data = await loadData(map);
        appState.railwayNodes = data.railwayNodes;
        appState.stations = data.stations;
        appState.stationByCRS = data.stationByCRS;
        appState.railwayRoutingGraph = data.railwayRoutingGraph;
        appState.journeys = data.journeys;
        appState.availableYears = data.availableYears || [];
// Set default active year
		 if (appState.availableYears.length > 0) {
            selectedYear = appState.availableYears[appState.availableYears.length - 1];
        } else {
            selectedYear = '2024-25';
        }
        // Initialize UI components
        initializeYearSelector(
            document.getElementById('year'), 
            appState.availableYears, 
            (newYear) => {
                selectedYear = newYear;
                updateVisualization();
            }
        );
        setupStationAutocomplete({
            inputElement: document.getElementById('origin'),
            resultsElement: document.getElementById('origin-results'),
            stations: appState.stations,
            onSelectStation: (crs) => {
                selectedOriginCRS = crs;
                updateVisualization();
            },
            onClear: () => {
                selectedOriginCRS = null;
                currentRoutingTree = null;
                clearAllMapLayers(routeLayer, destinationLayer, flowLayer);
            }
        });
		console.log('RailMapper initialized successfully.');
    } catch (error) {
        console.error('Failed to initialize railway application:', error);
    }
}

// Start application after DOM is ready
document.addEventListener('DOMContentLoaded', init);


