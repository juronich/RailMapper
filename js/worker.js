/*import { loadRoutingData } from './dataLoader.js';

self.onmessage = async (event) => {
    const { action, payload } = event.data;
    if (action === 'BUILD_ROUTING_GRAPH') {
        try {
            const { stations, railwayNodes } = payload;
            // Re-hydrate array back into a Map
            const nodesMap = new Map(railwayNodes);
            const result = await loadRoutingData(stations,  nodesMap);
            self.postMessage({ action: 'ROUTING_COMPLETE', payload: result });
        } catch (error) {
            self.postMessage({ action: 'ERROR', error: error.message });
        }
    }
};
*/
import { loadRoutingData, loadWaysAndGraph } from './dataLoader.js';
self.onmessage = async (event) => {
    const { action, payload } = event.data;
    if (action === 'BUILD_ROUTING_GRAPH') {
        try {
            const { stations, railwayNodes } = payload;
            const nodesMap = new Map(railwayNodes);
            // Run graph build and ways processing in parallel inside worker
            const [routingResult, waysResult] = await Promise.all([
                loadRoutingData(stations, nodesMap),
                loadWaysAndGraph(nodesMap)
            ]);
            self.postMessage({
                action: 'ROUTING_COMPLETE',
                payload: {
                    ...routingResult,
                    allCoords: waysResult.allCoords,
                    railwayGraph: waysResult.railwayGraph
                }
            });
        } catch (error) {
            self.postMessage({ action: 'ERROR', error: error.message });
        }
    }
};
