console.time('App Ready Time');
console.log('v0.201789');
import { loadInitData, loadRoutingDataAsync } from './dataLoader.js';
import { computeShortestPathTree, reconstructPath, calculatePassengerFlows } from './router.js';
import { drawBaseNetwork, drawRailwayRoute, drawDestinationMarkers, drawPassengerFlows, drawOriginMarker, clearAllMapLayers } from './renderer.js';
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
const originLayer = L.layerGroup().addTo(map);

// Global dataset storage (populated on load)
let appState = {
    railwayNodes: null,
    stations: [],
    stationByCRS: new Map(),
    railwayRoutingGraph: new Map(),
    journeys: [],
	journeysMap: new Map(),
    availableYears: []
};

// Currently selected user state
let selectedOriginCRS = null;
let selectedYear = null;
let currentRoutingTree = null;
let pendingOriginCRS = null;
let isDataReady = false;

// Core Rendering Orchestration
function updateVisualization() {
	console.time('Function: Update Visualization');
    clearAllMapLayers(routeLayer, destinationLayer, flowLayer, originLayer);
    if (!selectedOriginCRS) return;
	// Draw Marker for Origin station
	console.time('Function: Update Visualization (drawOriginMarker)');
	drawOriginMarker(originLayer, selectedOriginCRS, appState.stationByCRS);
	console.timeEnd('Function: Update Visualization (drawOriginMarker)');
    // 1. Calculate Dijkstra shortest path tree from selected origin station
	console.time('Function: Update Visualization (currentRoutingTree)');
    currentRoutingTree = computeShortestPathTree(
    	selectedOriginCRS, 
    	appState.stationByCRS, 
    	appState.railwayRoutingGraph
	);
	if (!currentRoutingTree) {
    	console.warn(`No valid routing paths found starting from ${selectedOriginCRS}`);
    	return;
	}
	console.timeEnd('Function: Update Visualization (currentRoutingTree)');
    // 2. Calculate edge-by-edge passenger flows across the network
	console.time('Function: Update Visualization (calculatePassengerFlows)');
    const edgeFlows = calculatePassengerFlows(
    	currentRoutingTree, 
    	selectedOriginCRS, 
    	selectedYear, 
    	appState.journeysMap, 
    	appState.stationByCRS
	);
	console.timeEnd('Function: Update Visualization (calculatePassengerFlows)');
	console.time('Function: Update Visualization (const volume of edgeFlows.values loop)');
    let maxFlowVolume = 1;
	for (const volume of edgeFlows.values()) {
    	if (volume > maxFlowVolume) {
        	maxFlowVolume = volume;
    	}
	}
	console.timeEnd('Function: Update Visualization (const volume of edgeFlows.values loop)');
    // 3. Render flow polylines onto flowLayer
	console.time('Function: Update Visualization (drawPassengerFlows)');
    drawPassengerFlows(
        flowLayer, 
        edgeFlows, 
        appState.railwayNodes, 
        maxFlowVolume
    );
	console.timeEnd('Function: Update Visualization (drawPassengerFlows)');
	// 4. Render destination circle markers
	console.time('Function: Update Visualization (const activeJourneys/destinationDate)');
	const activeJourneys = appState.journeys.filter(j => 
        (j.OriginCRS === selectedOriginCRS || j.DestinationCRS === selectedOriginCRS) && 
        j[selectedYear] > 0
    );
    const destinationData = activeJourneys.map(j => {
        const targetCRS = (j.OriginCRS === selectedOriginCRS) 
            ? j.DestinationCRS 
            : j.OriginCRS;
        return {
            crs: targetCRS,
            passengerCount: j[selectedYear]
        };
    });
	console.timeEnd('Function: Update Visualization (const activeJourneys/destinationDate)');
	console.time('Function: Update Visualization (drawDestinationMarkers)');

	
    drawDestinationMarkers(
        destinationLayer, 
        destinationData, 
        appState.stationByCRS, 
		appState.availableYears,
		selectedYear,
		appState.journeysMap,
		selectedOriginCRS,
        (destinationCRS) => handleDestinationClick(destinationCRS) // Triggers handleDestinationClick
    );
	console.timeEnd('Function: Update Visualization (drawDestinationMarkers)');
	console.timeEnd('Function: Update Visualization');
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
		const targetStation = appState.stationByCRS.get(destinationCRS);
        const targetCoords = targetStation ? [targetStation.latitude, targetStation.longitude] : null;
        drawRailwayRoute(
            routeLayer, 
            route.pathNodes, 
            appState.railwayNodes, 
            { color: '#8ED973'},
			targetCoords
        );
    }
}

async function init() {
    try {
        const data = await loadInitData(map);
        appState.railwayNodes = data.railwayNodes;
        appState.stations = data.stations;
        appState.stationByCRS = data.stationByCRS;
        appState.journeys = data.journeys;
		appState.journeysMap = data.journeysMap || new Map();;
        appState.availableYears = data.availableYears || [];
        selectedYear = appState.availableYears.length > 0 ? appState.availableYears[0] : '2024-25'; // Set default active year
        // Initialize UI components immediately
        initializeYearSelector(
            'year-container', 
            appState.availableYears, 
            selectedYear,
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
                setTimeout(() => {
					updateVisualization();
				}, 0);
            },
            onClear: () => {
                selectedOriginCRS = null;
                currentRoutingTree = null;
                clearAllMapLayers(routeLayer, destinationLayer, flowLayer, originLayer);
            }
        });
        console.log('Phase A UI initialized successfully.');
        console.timeEnd('App Ready Time');
       // initRoutingWorker(appState.stations, appState.railwayNodes);
		// PHASE B: Spawn Web Worker for Routing Data
		loadRoutingDataAsync(appState.stations, appState.railwayNodes)
        	.then(routingData => {
				appState.railwayRoutingGraph = routingData.railwayRoutingGraph;
        		appState.stationConnections = routingData.stationConnections;
        		appState.stationTransfers = routingData.stationTransfers;
        		appState.transfersByCRS = routingData.transfersByCRS;
        		appState.railwayGraph = routingData.railwayGraph;
            	//Object.assign(appState, routingData);
            	appState.isRoutingReady = true;
				// Render base network polylines using Canvas renderer
				console.log('routingData:', routingData);
        		/*if (routingData.allCoords && routingData.allCoords.length > 0) {
            		const canvasRenderer = L.canvas({ padding: 0.5 });
            		L.polyline(routingData.allCoords, {
                		color: '#4EA72E',
                		weight: 1,
                		opacity: 0.9,
                		renderer: canvasRenderer
            		}).addTo(map);
        		}*/
				drawBaseNetwork(routingData.allCoords, map);
				const graphKeys = Array.from(routingData.railwayRoutingGraph.keys());
				const hasCRS = graphKeys.some(k => isNaN(Number(k)));
				console.log("Are non-numeric/CRS codes in the graph?", hasCRS);
				console.log("Sample graph keys:", graphKeys.slice(0, 10));
				const nonNumericKeys = Array.from(routingData.railwayRoutingGraph.keys())
    				.filter(k => isNaN(Number(k)));
				console.log("Total non-numeric keys:", nonNumericKeys.length);
				console.log("Sample non-numeric keys:", nonNumericKeys.slice(0, 20));
            	console.log('🚀 Routing graph loaded in background via Worker');
				// If user selected a station while worker was processing, trigger visualization now
                if (selectedOriginCRS) {
                    updateVisualization();
                }
	        })
        	.catch(err => console.error('Worker Phase B failed:', err));
    } catch (error) {
        console.error('Failed to initialize railway application:', error);
    }
}

// Start application after DOM is ready
document.addEventListener('DOMContentLoaded', init);


