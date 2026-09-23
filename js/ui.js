 // Populates the year dropdown selector with available years from journey data.
export function initializeYearSelector(yearSelectElement, availableYears, onYearChange) {
    yearSelectElement.innerHTML = '';
    availableYears.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelectElement.appendChild(option);
    });
    yearSelectElement.addEventListener('change', (e) => {
        onYearChange(e.target.value);
    });
}

// ui.js

/**
 * Dynamically creates and injects a year select element into the DOM.
 */
export function createYearSelector(containerId, availableYears, initialYear, onYearChange) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    // Clear any existing contents in container
    container.innerHTML = '';

    // Create label
    const label = document.createElement('label');
    label.htmlFor = 'year-select';
    label.textContent = 'Year: ';
    label.style.marginRight = '8px';
    // Create select element
    const select = document.createElement('select');
    select.id = 'year-select';
    // Populate option elements from availableYears array
    availableYears.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        if (year === initialYear) {
            option.selected = true;
        }
        select.appendChild(option);
    });
    // Attach change listener
    select.addEventListener('change', (e) => {
        if (typeof onYearChange === 'function') {
            onYearChange(e.target.value);
        }
    });
    // Append label and select to container
    container.appendChild(label);
    container.appendChild(select);
    return select;
}

// Initializes auto-complete station search for origin/destination input fields.
export function setupStationAutocomplete(config) {
    const {
        inputElement,
        resultsElement,
        stations,
        onSelectStation,
        onClear
    } = config;
    let selectedIndex = -1;
    function clearResults() {
        resultsElement.innerHTML = '';
        resultsElement.style.display = 'none';
        selectedIndex = -1;
    }
    function renderResults(filteredStations) {
        resultsElement.innerHTML = '';
        if (filteredStations.length === 0) {
            clearResults();
            return;
        }
        filteredStations.slice(0, 10).forEach((station, index) => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            item.innerHTML = `<strong>${station.name}</strong> <small>(${station.crs})</small>`;
            item.addEventListener('click', () => {
                inputElement.value = `${station.name} (${station.crs})`;
                clearResults();
                onSelectStation(station.crs);
            });
            resultsElement.appendChild(item);
        });
        resultsElement.style.display = 'block';
    }
    // Input event for filtering
    inputElement.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        if (query.length < 2) {
            clearResults();
            if (query.length === 0 && onClear) {
                onClear();
            }
            return;
        }
        const matches = stations.filter(s => 
            s.name.toLowerCase().includes(query) || 
            s.crs.toLowerCase().includes(query)
        );
        renderResults(matches);
    });
    // Keyboard navigation (Arrow keys + Enter)
    inputElement.addEventListener('keydown', (e) => {
        const items = resultsElement.querySelectorAll('.autocomplete-item');
        if (!items.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % items.length;
            highlightItem(items, selectedIndex);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = (selectedIndex - 1 + items.length) % items.length;
            highlightItem(items, selectedIndex);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0 && items[selectedIndex]) {
                items[selectedIndex].click();
            }
        } else if (e.key === 'Escape') {
            clearResults();
        }
    });
    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
        if (!inputElement.contains(e.target) && !resultsElement.contains(e.target)) {
            clearResults();
        }
    });
}

// Highlights active auto-complete selection item.
function highlightItem(items, index) {
    items.forEach((item, i) => {
        if (i === index) {
            item.classList.add('active');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('active');
        }
    });
}
