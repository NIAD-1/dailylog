import { db, collection, getDocs, query, where } from "./db.js";
import { clearRoot, navigate } from "./ui.js";

// Lagos LGA approximate center coordinates for markers
const LGA_COORDINATES = {
    "Agege": [6.6194, 3.3280],
    "Ajeromi-Ifelodun": [6.4500, 3.3333],
    "Alimosho": [6.6000, 3.2833],
    "Amuwo-Odofin": [6.4667, 3.3000],
    "Apapa": [6.4500, 3.3667],
    "Badagry": [6.4167, 2.8833],
    "Epe": [6.5833, 3.9833],
    "Eti-Osa": [6.4333, 3.4667],
    "Ibeju-Lekki": [6.4500, 3.6167],
    "Ifako-Ijaiye": [6.6667, 3.3167],
    "Ikeja": [6.6018, 3.3515],
    "Ikorodu": [6.6194, 3.5105],
    "Kosofe": [6.5833, 3.3833],
    "Lagos Island": [6.4541, 3.4084],
    "Lagos Mainland": [6.4969, 3.3864],
    "Mushin": [6.5333, 3.3500],
    "Ojo": [6.4667, 3.1833],
    "Oshodi-Isolo": [6.5500, 3.3333],
    "Shomolu": [6.5500, 3.3833],
    "Surulere": [6.5000, 3.3500]
};

const LGA_COLORS = [
    '#e8f5e9', '#c8e6c9', '#a5d6a7', '#81c784', '#66bb6a',
    '#4caf50', '#43a047', '#388e3c', '#2e7d32', '#1b5e20'
];

let mapInstance = null;

function getHeatColor(count, max) {
    if (max === 0) return LGA_COLORS[0];
    const idx = Math.min(Math.floor((count / max) * 9), 9);
    return LGA_COLORS[idx];
}

export async function renderMapPage(root) {
    clearRoot(root);

    root.innerHTML = `
    <section class="card" style="padding:0;overflow:hidden;border-radius:8px">
        <div class="map-header">
            <div>
                <h2 style="margin:0;color:var(--accent)">🗺️ Lagos Inspection Map</h2>
                <p class="muted" style="margin:4px 0 0 0;font-size:13px">Facilities and inspection coverage across Lagos LGAs</p>
            </div>
            <button id="backFromMap" class="secondary" style="padding:8px 16px;font-size:13px">← Back</button>
        </div>

        <div class="map-controls">
            <div class="map-filter-group">
                <label style="margin:0;font-size:11px">Filter by Activity:</label>
                <select id="mapActivityFilter" style="padding:6px 10px;font-size:13px;width:auto;border-radius:4px">
                    <option value="all">All Activities</option>
                    <option value="Routine Surveillance">Routine Surveillance</option>
                    <option value="GSDP">GSDP</option>
                    <option value="GLSI">GLSI</option>
                </select>
            </div>
            <div class="map-stats" id="mapStats">Loading...</div>
        </div>

        <div id="lagosMap" style="height:500px;width:100%;background:#e8f0fe"></div>

        <div class="map-legend">
            <span class="legend-title">Facility density:</span>
            <span class="legend-item"><span class="legend-dot" style="background:#e8f5e9"></span>Low</span>
            <span class="legend-item"><span class="legend-dot" style="background:#66bb6a"></span>Medium</span>
            <span class="legend-item"><span class="legend-dot" style="background:#1b5e20"></span>High</span>
        </div>

        <div id="lgaBreakdown" class="lga-breakdown-grid"></div>
    </section>`;

    document.getElementById('backFromMap').addEventListener('click', () => navigate('welcome'));

    // Load facilities
    let facilities = [];
    try {
        const snap = await getDocs(collection(db, 'facilities'));
        snap.forEach(d => facilities.push({ id: d.id, ...d.data() }));
    } catch (e) {
        console.error('Error loading facilities for map:', e);
        // Fallback: try loading from JSON
        try {
            const resp = await fetch('./facilities-data.json');
            facilities = await resp.json();
        } catch (e2) {
            console.error('Error loading JSON fallback:', e2);
        }
    }

    initMap(facilities, 'all');

    document.getElementById('mapActivityFilter').addEventListener('change', (e) => {
        initMap(facilities, e.target.value);
    });
}

function initMap(facilities, activityFilter) {
    const filtered = activityFilter === 'all'
        ? facilities
        : facilities.filter(f => f.activityType === activityFilter);

    // Count per LGA (using address text matching)
    const lgaCounts = {};
    const lgaFacilities = {};
    Object.keys(LGA_COORDINATES).forEach(lga => {
        lgaCounts[lga] = 0;
        lgaFacilities[lga] = [];
    });

    // Assign facilities to LGAs based on address matching
    filtered.forEach(f => {
        const addr = (f.address || '').toLowerCase();
        const name = (f.name || '').toLowerCase();
        let matched = false;

        for (const lga of Object.keys(LGA_COORDINATES)) {
            const lgaLower = lga.toLowerCase();
            // Check address and name for LGA mentions
            if (addr.includes(lgaLower) || name.includes(lgaLower)) {
                lgaCounts[lga]++;
                lgaFacilities[lga].push(f);
                matched = true;
                break;
            }
        }

        // Common area name aliases
        if (!matched) {
            const areaAliases = {
                'ikeja': 'Ikeja', 'vi': 'Eti-Osa', 'victoria island': 'Eti-Osa',
                'lekki': 'Eti-Osa', 'ikoyi': 'Eti-Osa', 'ajah': 'Eti-Osa',
                'isolo': 'Oshodi-Isolo', 'oshodi': 'Oshodi-Isolo',
                'mushin': 'Mushin', 'surulere': 'Surulere',
                'yaba': 'Lagos Mainland', 'ebute metta': 'Lagos Mainland',
                'maryland': 'Kosofe', 'ketu': 'Kosofe', 'ojota': 'Kosofe',
                'festac': 'Amuwo-Odofin', 'mile 2': 'Amuwo-Odofin',
                'apapa': 'Apapa', 'ajegunle': 'Ajeromi-Ifelodun',
                'ikorodu': 'Ikorodu', 'agege': 'Agege',
                'ipaja': 'Alimosho', 'egbeda': 'Alimosho', 'idimu': 'Alimosho',
                'igando': 'Alimosho', 'alimosho': 'Alimosho',
                'ojo': 'Ojo', 'badagry': 'Badagry', 'epe': 'Epe',
                'shomolu': 'Shomolu', 'gbagada': 'Shomolu', 'bariga': 'Shomolu',
                'ogba': 'Ifako-Ijaiye', 'ifako': 'Ifako-Ijaiye',
                'lagos island': 'Lagos Island', 'marina': 'Lagos Island',
                'broad street': 'Lagos Island', 'idumota': 'Lagos Island'
            };

            for (const [alias, lga] of Object.entries(areaAliases)) {
                if (addr.includes(alias) || name.includes(alias)) {
                    lgaCounts[lga]++;
                    lgaFacilities[lga].push(f);
                    matched = true;
                    break;
                }
            }
        }

        // If still unmatched, put in a general "Unassigned" group
        if (!matched) {
            if (!lgaCounts['_unassigned']) {
                lgaCounts['_unassigned'] = 0;
                lgaFacilities['_unassigned'] = [];
            }
            lgaCounts['_unassigned']++;
            lgaFacilities['_unassigned'].push(f);
        }
    });

    const maxCount = Math.max(...Object.values(lgaCounts).filter(v => typeof v === 'number'), 1);
    const totalFacilities = filtered.length;
    const mappedFacilities = totalFacilities - (lgaCounts['_unassigned'] || 0);

    // Update stats
    document.getElementById('mapStats').innerHTML = `
        <span class="map-stat"><strong>${totalFacilities}</strong> Facilities</span>
        <span class="map-stat"><strong>${mappedFacilities}</strong> Mapped</span>
        <span class="map-stat"><strong>${Object.keys(LGA_COORDINATES).filter(l => lgaCounts[l] > 0).length}</strong>/20 LGAs</span>
    `;

    // Initialize or reset map
    if (mapInstance) {
        mapInstance.remove();
    }

    // Lagos State bounding box
    const lagosBounds = L.latLngBounds(
        L.latLng(6.38, 2.70),  // Southwest corner (Badagry coast)
        L.latLng(6.75, 4.10)   // Northeast corner (beyond Epe)
    );

    mapInstance = L.map('lagosMap', {
        center: [6.52, 3.38],
        zoom: 11,
        minZoom: 10,
        maxZoom: 18,
        zoomControl: true,
        scrollWheelZoom: true,
        maxBounds: lagosBounds,
        maxBoundsViscosity: 1.0  // Hard boundary — can't pan outside
    });

    // Add tile layers (Street + Satellite toggle)
    const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 18
    });

    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri',
        maxZoom: 18
    });

    const labelsLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18
    });

    // Default to street view
    streetLayer.addTo(mapInstance);

    // Layer control
    L.control.layers({
        '🗺️ Street Map': streetLayer,
        '🛰️ Satellite': satelliteLayer
    }, {
        'Labels': labelsLayer
    }, { position: 'topright' }).addTo(mapInstance);

    // Add LGA circle markers with counts
    Object.entries(LGA_COORDINATES).forEach(([lga, coords]) => {
        const count = lgaCounts[lga] || 0;
        const color = getHeatColor(count, maxCount);
        const radius = Math.max(15, Math.min(40, 15 + (count / maxCount) * 25));

        // Circle marker
        const circle = L.circleMarker(coords, {
            radius: radius,
            fillColor: color,
            color: '#2e7d32',
            weight: 2,
            opacity: 0.9,
            fillOpacity: 0.75
        }).addTo(mapInstance);

        // Tooltip on hover
        circle.bindTooltip(`<strong>${lga}</strong><br>${count} facilities`, {
            permanent: false,
            direction: 'top',
            className: 'map-tooltip'
        });

        // Popup on click with facility list
        const facilityList = (lgaFacilities[lga] || [])
            .slice(0, 10)
            .map(f => `<li>${f.name}${f.lastVisitDate ? ` <small>(${f.lastVisitDate})</small>` : ''}</li>`)
            .join('');
        const moreCount = (lgaFacilities[lga] || []).length - 10;

        // Google Street View link
        const streetViewUrl = `https://www.google.com/maps/@${coords[0]},${coords[1]},17z/data=!3m1!1e3`;

        circle.bindPopup(`
            <div style="max-width:280px">
                <h4 style="margin:0 0 4px 0;color:#2e7d32">${lga}</h4>
                <p style="margin:0 0 8px 0;font-size:12px;color:#666">${count} facilities</p>
                <ul style="margin:0;padding:0 0 0 16px;font-size:12px;max-height:150px;overflow-y:auto">
                    ${facilityList}
                    ${moreCount > 0 ? `<li style="color:#666">...and ${moreCount} more</li>` : ''}
                </ul>
                <a href="${streetViewUrl}" target="_blank" style="display:inline-block;margin-top:8px;font-size:11px;color:#2e7d32;font-weight:600">📍 View on Google Maps →</a>
            </div>
        `);

        // Count label on the circle
        if (count > 0) {
            const label = L.divIcon({
                className: 'lga-count-label',
                html: `<span>${count}</span>`,
                iconSize: [30, 20],
                iconAnchor: [15, 10]
            });
            L.marker(coords, { icon: label, interactive: false }).addTo(mapInstance);
        }
    });

    // LGA breakdown grid
    const breakdownHTML = Object.keys(LGA_COORDINATES)
        .sort((a, b) => (lgaCounts[b] || 0) - (lgaCounts[a] || 0))
        .map(lga => {
            const count = lgaCounts[lga] || 0;
            const pct = totalFacilities > 0 ? Math.round((count / totalFacilities) * 100) : 0;
            return `
            <div class="lga-breakdown-item">
                <div class="lga-breakdown-name">${lga}</div>
                <div class="lga-breakdown-bar-wrap">
                    <div class="lga-breakdown-bar" style="width:${pct}%;background:${getHeatColor(count, maxCount)}"></div>
                </div>
                <div class="lga-breakdown-count">${count}</div>
            </div>`;
        }).join('');

    document.getElementById('lgaBreakdown').innerHTML = breakdownHTML;
}
