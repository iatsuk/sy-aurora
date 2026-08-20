(() => {
  const card = document.querySelector('[data-card]');
  const mapNode = document.querySelector('#voyage-card-map');
  const select = document.querySelector('[data-track-select]');
  const title = document.querySelector('[data-card-title]');
  const meta = document.querySelector('[data-card-meta]');
  const status = document.querySelector('[data-status]');
  const download = document.querySelector('[data-download]');
  const layoutButtons = [...document.querySelectorAll('[data-layout]')];
  if (!card || !mapNode || !select || !window.L) return;

  const formats = {
    article: { width: 1600, height: 1000 },
    portrait: { width: 1200, height: 1500 },
    wide: { width: 1920, height: 1080 }
  };
  let features = [];
  let activeIndex = 0;
  let activeLayer = null;
  let detailLayer = null;
  let activeLayout = 'article';

  const map = L.map(mapNode, {
    zoomControl: false,
    scrollWheelZoom: false,
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
      features = Array.isArray(data.features) ? data.features : [];
      if (!features.length) throw new Error('No GPX tracks have been published yet.');
      features.forEach((feature, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = feature.properties?.name || `Voyage ${index + 1}`;
        select.appendChild(option);
      });
      const requested = Number(new URLSearchParams(window.location.search).get('track'));
      activeIndex = Number.isInteger(requested) && requested >= 0 && requested < features.length ? requested : 0;
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
    url.searchParams.set('track', String(activeIndex));
    window.history.replaceState({}, '', url);
  });

  layoutButtons.forEach((button) => button.addEventListener('click', () => {
    activeLayout = button.dataset.layout;
    card.dataset.cardLayout = activeLayout;
    layoutButtons.forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)));
    window.setTimeout(() => {
      map.invalidateSize({ pan: false, animate: false });
      fitActiveLayer();
    }, 50);
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
      const scale = format.width / card.getBoundingClientRect().width;
      const canvas = await window.html2canvas(card, {
        backgroundColor: '#f3efe6',
        logging: false,
        scale,
        useCORS: true
      });
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The browser could not create the PNG.');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${slug(features[activeIndex].properties?.name || 'aurora-voyage')}-${format.width}x${format.height}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      status.textContent = `Downloaded ${format.width} × ${format.height} PNG.`;
    } catch (error) {
      status.textContent = `Export failed: ${error.message}`;
    } finally {
      download.disabled = false;
    }
  });

  function render(index) {
    const feature = features[index];
    if (!feature) return;
    activeLayer?.removeFrom(map);
    detailLayer?.removeFrom(map);

    const properties = feature.properties || {};
    activeLayer = L.geoJSON(feature, { style: { color: '#8c4f3f', weight: 4.5, opacity: .96 } }).addTo(map);
    detailLayer = buildDetails(feature, properties).addTo(map);
    title.textContent = properties.name || `Voyage ${index + 1}`;
    meta.textContent = [
      formatDateRange(properties.start, properties.end),
      Number.isFinite(properties.distance_nm) ? `${properties.distance_nm.toFixed(1)} NM` : '',
      formatDuration(properties.duration_hours)
    ].filter(Boolean).join(' · ');
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

  function buildDetails(feature, properties) {
    const details = L.layerGroup();
    const coordinates = feature.geometry?.type === 'LineString' ? feature.geometry.coordinates : [];
    if (coordinates.length < 2) return details;
    const start = coordinates[0];
    const end = coordinates[coordinates.length - 1];
    L.circleMarker([start[1], start[0]], { radius: 6, color: '#8c4f3f', weight: 2.5, fillColor: '#f3efe6', fillOpacity: 1 }).addTo(details);
    L.circleMarker([end[1], end[0]], { radius: 6, color: '#8c4f3f', weight: 2.5, fillColor: '#8c4f3f', fillOpacity: 1 }).addTo(details);

    (Array.isArray(properties.day_marks) ? properties.day_marks : []).forEach((mark) => {
      if (!Array.isArray(mark.coordinates) || mark.coordinates.length < 2) return;
      L.circleMarker([mark.coordinates[1], mark.coordinates[0]], { radius: 4, color: '#8c4f3f', weight: 2, fillColor: '#f3efe6', fillOpacity: 1 })
        .bindTooltip(formatUtcDay(mark.time), { permanent: true, direction: 'top', offset: [0, -5], className: 'voyage-day-label' })
        .addTo(details);
    });

    const distanceNm = Number.isFinite(properties.distance_nm) ? properties.distance_nm : 0;
    const fractions = distanceNm >= 80 ? [.25, .5, .75] : distanceNm >= 25 ? [.34, .67] : [.5];
    fractions.map((fraction) => pointAlongLine(coordinates, fraction)).filter(Boolean).forEach((point) => {
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

  function pointAlongLine(coordinates, fraction) {
    const distances = [0];
    for (let index = 1; index < coordinates.length; index += 1) {
      distances.push(distances[index - 1] + coordinateDistance(coordinates[index - 1], coordinates[index]));
    }
    const total = distances[distances.length - 1];
    if (!total) return null;
    const target = total * fraction;
    let index = 1;
    while (index < distances.length && distances[index] < target) index += 1;
    const start = coordinates[index - 1];
    const end = coordinates[Math.min(index, coordinates.length - 1)];
    const segment = distances[index] - distances[index - 1];
    const local = segment ? (target - distances[index - 1]) / segment : 0;
    const lonDelta = ((end[0] - start[0] + 540) % 360) - 180;
    return {
      lat: start[1] + (end[1] - start[1]) * local,
      lon: ((start[0] + lonDelta * local + 540) % 360) - 180,
      bearing: coordinateBearing(start, end)
    };
  }

  function coordinateDistance(a, b) {
    const toRadians = (value) => value * Math.PI / 180;
    const lat1 = toRadians(a[1]);
    const lat2 = toRadians(b[1]);
    const dLat = lat2 - lat1;
    const dLon = toRadians(b[0] - a[0]);
    const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(value)));
  }

  function coordinateBearing(a, b) {
    const toRadians = (value) => value * Math.PI / 180;
    const lat1 = toRadians(a[1]);
    const lat2 = toRadians(b[1]);
    const dLon = toRadians(b[0] - a[0]);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function formatDateRange(start, end) {
    const format = (value) => {
      const date = new Date(value);
      return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
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
    return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(date);
  }

  function waitForTiles() {
    const images = [...mapNode.querySelectorAll('.leaflet-tile')];
    return Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
      window.setTimeout(resolve, 2500);
    })));
  }

  function slug(value) {
    return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'aurora-voyage';
  }
})();
