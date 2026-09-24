import { loadRoutingData } from '/js/dataLoader.js';

self.onmessage = async (event) => {
    const { action, payload } = event.data;
    if (action === 'BUILD_ROUTING_GRAPH') {
        try {
            const { stations, railwayNodes } = payload;
            const result = await loadRoutingData(stations, railwayNodes);
            self.postMessage({ action: 'ROUTING_COMPLETE', payload: result });
        } catch (error) {
            self.postMessage({ action: 'ERROR', error: error.message });
        }
    }
};
