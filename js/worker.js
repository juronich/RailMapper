self.onmessage = async (e) => {
    const { stations, ways } = e.data;
    
    // Computation runs on a separate CPU thread
    const graph = buildAdjacencyGraph(stations, ways);
    
    self.postMessage({ graph });
};
