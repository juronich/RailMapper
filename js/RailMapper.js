console.time('App Ready Time');
console.log('v0.201786');
import { loadInitData, loadRoutingDataAsync } from './dataLoader.js';
import { computeShortestPathTree, reconstructPath, calculatePassengerFlows } from './router.js';
import { drawRailwayRoute, drawDestinationMarkers, drawPassengerFlows, drawOriginMarker, clearAllMapLayers } from './renderer.js';
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
    availableYears: []
};

// Currently selected user state
let selectedOriginCRS = null;
let selectedYear = null;
let currentRoutingTree = null;
let pendingOriginCRS = null;
let isDataReady = false;

/*const worker = new Worker('worker.js');
worker.postMessage({ stations, ways });
worker.onmessage = (e) => {
    appState.graph = e.data.graph;
    isDataReady = true;
    hideLoadingSpinner();
};

function startBackgroundWorker(stations) {
    // Instantiate worker inside background routine
    worker = new Worker('./worker.js', { type: 'module' });
    // Listen for calculated graph from worker thread
    worker.onmessage = (e) => {
        const { graph, journeys } = e.data;
        appState.graph = graph;
        appState.journeys = journeys;
        isDataReady = true;
        console.log('⚡ Graph & Journey data ready from Web Worker');
        // Execute queued station selection if user picked one while loading
        if (pendingOriginCRS) {
            updateVisualizationForOrigin(pendingOriginCRS);
            pendingOriginCRS = null;
        }
    };
    // Trigger calculation in background thread
    worker.postMessage({ stations });
}
*/


// Core Rendering Orchestration
function updateVisualization() {
	Console.time('Function: Update Visualization');
    clearAllMapLayers(routeLayer, destinationLayer, flowLayer, originLayer);
    if (!selectedOriginCRS) return;
	// Draw Marker for Origin station
	drawOriginMarker(originLayer, selectedOriginCRS, appState.stationByCRS);
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
    drawDestinationMarkers(
        destinationLayer, 
        destinationData, 
        appState.stationByCRS, 
		appState.availableYears,
		selectedYear,
		appState.journeys,
		selectedOriginCRS,
        (destinationCRS) => handleDestinationClick(destinationCRS) // Triggers handleDestinationClick
    );
	Console.timeEnd('Function: Update Visualization');
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

/*function handleOriginSelection(crs) {
    if (!isDataReady) {
        // Queue user choice while background loading finishes
        pendingOriginCRS = crs;
        showLoadingIndicatorOnMap("Building network routing graph...");
        return;
    }
    updateVisualizationForOrigin(crs);
}*/

async function init() {
    try {
        const data = await loadInitData(map);
        appState.railwayNodes = data.railwayNodes;
        appState.stations = data.stations;
        appState.stationByCRS = data.stationByCRS;
        appState.journeys = data.journeys;
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
                updateVisualization();
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
        		if (routingData.allCoords && routingData.allCoords.length > 0) {
            		const canvasRenderer = L.canvas({ padding: 0.5 });
            		L.polyline(routingData.allCoords, {
                		color: '#4EA72E',
                		weight: 1,
                		opacity: 0.7,
                		renderer: canvasRenderer
            		}).addTo(map);
        		}
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



/*
// NEW App Init
async function init() {
    console.time('UI Interactive Time');
    // 1. PHASE A: Fetch metadata only & unlock UI controls immediately
    const stations = await fetch('./data/stations.json').then(r => r.json());
    appState.stations = stations;
    // Initialize UI elements right away
    setupMap();
    createYearSelector('year-selector-container', AVAILABLE_YEARS, DEFAULT_YEAR, onYearChange);
    initializeStationSearch(stations, (selectedStation) => {
        handleOriginSelection(selectedStation.crs);
    });
    console.timeEnd('UI Interactive Time'); // ~200ms - user can now interact!
    // 2. PHASE B: Background processing (Non-blocking)
	startBackgroundWorker(stations);
    loadBackgroundRoutingData();
}
async function loadBackgroundRoutingData() {
    console.time('Background Data & Graph');
    // Fetch regional journeys & ways asynchronously
    const [journeys, ways] = await Promise.all([
        fetchJourneysByRegion(),
        fetch('./data/ways.json').then(r => r.json())
    ]);
    // Build routing graph
    appState.graph = buildAdjacencyGraph(appState.stations, ways);
    appState.journeys = journeys;
    isDataReady = true;
    console.timeEnd('Background Data & Graph');
    // If user selected an origin station while data was loading, execute now
    if (pendingOriginCRS) {
        updateVisualizationForOrigin(pendingOriginCRS);
        pendingOriginCRS = null;
    }
}
*/
/*
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
            selectedYear = appState.availableYears[0];
        } else {
            selectedYear = '2024-25';
        }
        // Initialize UI components
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
                updateVisualization();
            },
            onClear: () => {
                selectedOriginCRS = null;
                currentRoutingTree = null;
                clearAllMapLayers(routeLayer, destinationLayer, flowLayer, originLayer);
            }
        });
		console.log('RailMapper initialized successfully.');
		console.timeEnd('App Ready Time')
		const loadTimeS = (performance.now()/1000).toFixed(2);
    	console.log(`🚀 Application fully initialized in ${loadTimeS} s`);
    } catch (error) {
        console.error('Failed to initialize railway application:', error);
    }
}
*/

// Start application after DOM is ready
document.addEventListener('DOMContentLoaded', init);


