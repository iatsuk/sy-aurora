(() => {
  const card = document.querySelector('[data-card]');
  const mapNode = document.querySelector('#voyage-card-map');
  const select = document.querySelector('[data-track-select]');
  const title = document.querySelector('[data-card-title]');
  const meta = document.querySelector('[data-card-meta]');
  const voyageName = document.querySelector('[data-card-voyage]');
  const status = document.querySelector('[data-status]');
  const download = document.querySelector('[data-download]');
  const layoutButtons = [...document.querySelectorAll('[data-layout]')];
  if (!card || !mapNode || !select || !window.L) return;

  const formats = {
    article: { width: 1600, height: 1000 },
    portrait: { width: 1200, height: 1500 },
    wide: { width: 1920, height: 1080 }
  };
  const routeStyle = { color: '#d84a1b', weight: 5.4, opacity: 1 };
  let features = [];
  let activeIndex = 0;
  let activeLayer = null;
  let detailLayer = null;
  let activeLayout = 'article';

  const map = L.map(mapNode, {
    zoomControl: false,
    scrollWheelZoom: false,
    dragging: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
    attributionControl: true
  }).setView([56.2, 10.7], 5);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    minZoom: 3,
    maxZoom: 18,
    crossOrigin: true,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  fetch('data/tracks.geojson', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`tracks.geojson: ${response.status}`);
      return response.json();
    })
    .then((data) => {
      features = (Array.isArray(data.features) ? data.features : [])
        .filter((feature) => ['LineString', 'MultiLineString'].includes(feature.geometry?.type));
      if (!features.length) throw new Error('No GPX tracks have been published yet.');

      populateSelect(features);
      activeIndex = resolveRequestedTrack(features);
      select.value = String(activeIndex);
      render(activeIndex);

      if (window.html2canvas) {
        download.disabled = false;
        status.textContent = 'Ready to export.';
      } else {
        status.textContent = 'The PNG exporter could not be loaded.';
      }
    })
    .catch((error) => {
      status.textContent = error.message;
      title.textContent = 'No voyage available';
      meta.textContent = 'Add a GPX file and rebuild data/tracks.geojson';
    });

  select.addEventListener('change', () => {
    activeIndex = Number(select.value);
    render(activeIndex);
    const url = new URL(window.location.href);
    const source = features[activeIndex]?.properties?.source;
    url.searchParams.set('track', source || String(activeIndex));
    window.history.replaceState({}, '', url);
  });

  layoutButtons.forEach((button) => button.addEventListener('click', () => {
    activeLayout = button.dataset.layout;
    card.dataset.cardLayout = activeLayout;
    layoutButtons.forEach((candidate) =>
      candidate.setAttribute('aria-pressed', String(candidate === button))
    );
    window.setTimeout(() => {
      map.invalidateSize({ pan: false, animate: false });
      fitActiveLayer();
    }, 60);
  }));

  download.addEventListener('click', async () => {
    if (!window.html2canvas || !features.length) return;
    download.disabled = true;
    status.textContent = 'Preparing map tiles and typography…';
    try {
      await document.fonts?.ready;
      map.invalidateSize({ pan: false, animate: false });
      fitActiveLayer();
      await waitForTiles();

      const format = formats[activeLayout];
      const rect = card.getBoundingClientRect();
      const scale = format.width / rect.width;
      const canvas = await window.html2canvas(card, {
        backgroundColor: '#f3efe6',
        logging: false,
        scale,
        useCORS: true,
        width: rect.width,
        height: rect.height
      });
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The browser could not create the PNG.');

      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${slug(features[activeIndex].properties?.name || 'aurora-voyage')}-${format.width}x${format.height}.png`;
      document.body.appendChild(link);
      link.click();
      const objectUrl = link.href;
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      status.textContent = `Downloaded ${canvas.width} × ${canvas.height} PNG.`;
    } catch (error) {
      status.textContent = `Export failed: ${error.message}`;
    } finally {
      download.disabled = false;
    }
  });

  function populateSelect(items) {
    const groups = new Map();
    items.forEach((feature, index) => {
      const properties = feature.properties || {};
      const label = properties.voyage_title || properties.year || 'Other voyages';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push({ feature, index });
    });

    groups.forEach((entries, label) => {
      const group = document.createElement('optgroup');
      group.label = label;
      entries.forEach(({ feature, index }) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = feature.properties?.name || `Voyage ${index + 1}`;
        group.appendChild(option);
      });
      select.appendChild(group);
    });
  }

  function resolveRequestedTrack(items) {
    const requested = new URLSearchParams(window.location.search).get('track');
    if (!requested) return 0;
    const bySource = items.findIndex((feature) => feature.properties?.source === requested);
    if (bySource >= 0) return bySource;
    const numeric = Number(requested);
    return Number.isInteger(numeric) && numeric >= 0 && numeric < items.length ? numeric : 0;
  }

  function render(index) {
    const feature = features[index];
    if (!feature) return;
    activeLayer?.removeFrom(map);
    detailLayer?.removeFrom(map);

    const properties = feature.properties || {};
    activeLayer = L.geoJSON(feature, { style: routeStyle }).addTo(map);
    detailLayer = buildDetails(feature, properties).addTo(map);

    title.textContent = properties.name || `Voyage ${index + 1}`;
    meta.textContent = [
      formatDateRange(properties.start, properties.end),
      Number.isFinite(properties.distance_nm) ? `${properties.distance_nm.toFixed(1)} NM` : '',
      formatDuration(properties.duration_hours)
    ].filter(Boolean).join(' · ');
    if (voyageName) voyageName.textContent = properties.voyage_title || properties.year || 'Recorded passage';

    requestAnimationFrame(() => {
      map.invalidateSize({ pan: false, animate: false });
      fitActiveLayer();
    });
  }

  function fitActiveLayer() {
    if (activeLayer?.getBounds().isValid()) {
      map.fitBounds(activeLayer.getBounds(), { padding: [38, 38], maxZoom: 12, animate: false });
    }
  }

  function geometryLines(geometry) {
    if (geometry?.type === 'LineString') return [geometry.coordinates || []];
    if (geometry?.type === 'MultiLineString') return geometry.coordinates || [];
    return [];
  }

  function buildDetails(feature, properties) {
    const details = L.layerGroup();
    const lines = geometryLines(feature.geometry).filter((line) => line.length >= 2);
    if (!lines.length) return details;

    const start = lines[0][0];
    const lastLine = lines[lines.length - 1];
    const finish = lastLine[lastLine.length - 1];

    L.circleMarker([start[1], start[0]], {
      radius: 6,
      color: routeStyle.color,
      weight: 2.5,
      fillColor: '#f3efe6',
      fillOpacity: 1
    }).addTo(details);

    L.circleMarker([finish[1], finish[0]], {
      radius: 6,
      color: routeStyle.color,
      weight: 2.5,
      fillColor: routeStyle.color,
      fillOpacity: 1
    }).addTo(details);

    (Array.isArray(properties.day_marks) ? properties.day_marks : []).forEach((mark) => {
      if (!Array.isArray(mark.coordinates) || mark.coordinates.length < 2) return;
      L.circleMarker([mark.coordinates[1], mark.coordinates[0]], {
        radius: 4,
        color: routeStyle.color,
        weight: 2,
        fillColor: '#f3efe6',
        fillOpacity: 1
      })
        .bindTooltip(formatUtcDay(mark.time), {
          permanent: true,
          direction: 'top',
          offset: [0, -5],
          className: 'voyage-day-label'
        })
        .addTo(details);
    });

    const distanceNm = Number.isFinite(properties.distance_nm) ? properties.distance_nm : 0;
    const fractions = distanceNm >= 80 ? [.25, .5, .75] : distanceNm >= 25 ? [.34, .67] : [.5];
    fractions
      .map((fraction) => pointAlongGeometry(lines, fraction))
      .filter(Boolean)
      .forEach((point) => {
        L.marker([point.lat, point.lon], {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: 'voyage-direction-marker',
            html: `<span class="voyage-direction-arrow" style="transform: rotate(${point.bearing.toFixed(1)}deg)">↑</span>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11]
          })
        }).addTo(details);
      });

    return details;
  }

  function pointAlongGeometry(lines, fraction) {
    const segments = [];
    let total = 0;

    lines.forEach((line) => {
      for (let index = 1; index < line.length; index += 1) {
        const start = line[index - 1];
        const end = line[index];
        const distance = coordinateDistance(start, end);
        if (!distance) continue;
        segments.push({ start, end, from: total, to: total + distance, distance });
        total += distance;
      }
    });

    if (!total || !segments.length) return null;
    const target = total * fraction;
    const segment = segments.find((candidate) => candidate.to >= target) || segments[segments.length - 1];
    const local = Math.max(0, Math.min(1, (target - segment.from) / segment.distance));
    const lonDelta = ((segment.end[0] - segment.start[0] + 540) % 360) - 180;

    return {
      lat: segment.start[1] + (segment.end[1] - segment.start[1]) * local,
      lon: ((segment.start[0] + lonDelta * local + 540) % 360) - 180,
      bearing: coordinateBearing(segment.start, segment.end)
    };
  }

  function coordinateDistance(a, b) {
    const toRadians = (value) => value * Math.PI / 180;
    const lat1 = toRadians(a[1]);
    const lat2 = toRadians(b[1]);
    const dLat = lat2 - lat1;
    const dLon = toRadians(b[0] - a[0]);
    const value = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(value)));
  }

  function coordinateBearing(a, b) {
    const toRadians = (value) => value * Math.PI / 180;
    const lat1 = toRadians(a[1]);
    const lat2 = toRadians(b[1]);
    const dLon = toRadians(b[0] - a[0]);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function formatDateRange(start, end) {
    const format = (value) => {
      const date = new Date(value);
      return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(date);
    };
    const first = format(start);
    const last = format(end);
    return first && last && first !== last ? `${first} – ${last}` : first;
  }

  function formatDuration(hours) {
    if (!Number.isFinite(hours) || hours < 0) return '';
    const totalMinutes = Math.round(hours * 60);
    const wholeHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return wholeHours ? `${wholeHours} H${minutes ? ` ${minutes} MIN` : ''}` : `${minutes} MIN`;
  }

  function formatUtcDay(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC'
    }).format(date);
  }

  function waitForTiles() {
    const images = [...mapNode.querySelectorAll('.leaflet-tile')];
    return Promise.all(images.map((image) =>
      image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
            window.setTimeout(resolve, 3000);
          })
    ));
  }

  function slug(value) {
    return String(value)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'aurora-voyage';
  }
})();
