import { loadRoutingData } from './dataLoader.js';

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
