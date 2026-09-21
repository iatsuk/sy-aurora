(() => {
  const card = document.querySelector('[data-card]');
  const mapNode = document.querySelector('#voyage-card-map');
  const trackSelect = document.querySelector('[data-track-select]');
  const rangeControls = document.querySelector('[data-range-controls]');
  const rangeStart = document.querySelector('[data-range-start]');
  const rangeEnd = document.querySelector('[data-range-end]');
  const scopeButtons = [...document.querySelectorAll('[data-scope]')];
  const layoutButtons = [...document.querySelectorAll('[data-layout]')];
  const title = document.querySelector('[data-card-title]');
  const meta = document.querySelector('[data-card-meta]');
  const voyageName = document.querySelector('[data-card-voyage]');
  const status = document.querySelector('[data-status]');
  const download = document.querySelector('[data-download]');

  if (!card || !mapNode || !trackSelect || !rangeStart || !rangeEnd || !window.L) return;

  const formats = {
    portrait: { width: 1200, height: 1500 },
    article: { width: 1600, height: 1000 },
    wide: { width: 1920, height: 1080 }
  };
  const routeColor = '#d84a1b';
  const paperColor = '#f3efe6';

  let features = [];
  let voyageGroups = new Map();
  let activeIndex = 0;
  let activeScope = 'leg';
  let activeLayout = 'portrait';
  let activeSelection = [];

  const routeCanvas = document.createElement('canvas');
  routeCanvas.className = 'voyage-route-canvas';
  routeCanvas.setAttribute('aria-hidden', 'true');
  mapNode.append(routeCanvas);

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

  map.on('moveend zoomend resize', () => requestAnimationFrame(drawRouteOverlay));

  fetch('data/tracks.geojson', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`tracks.geojson: ${response.status}`);
      return response.json();
    })
    .then((data) => {
      features = (Array.isArray(data.features) ? data.features : [])
        .filter((feature) => ['LineString', 'MultiLineString'].includes(feature.geometry?.type));
      if (!features.length) throw new Error('No GPX tracks have been published yet.');

      buildVoyageGroups();
      populateTrackSelect();

      const params = new URLSearchParams(window.location.search);
      activeIndex = resolveFeatureReference(params.get('track'), features) ?? 0;
      trackSelect.value = String(activeIndex);

      populateRangeSelects(activeIndex);
      restoreRangeFromUrl(params);
      setScope(['leg', 'range', 'voyage'].includes(params.get('scope')) ? params.get('scope') : 'leg', false);

      const requestedLayout = params.get('layout');
      setLayout(Object.hasOwn(formats, requestedLayout) ? requestedLayout : 'portrait', false);
      renderSelection();

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

  trackSelect.addEventListener('change', () => {
    activeIndex = Number(trackSelect.value);
    populateRangeSelects(activeIndex);
    if (activeScope === 'range') {
      rangeStart.value = String(activeIndex);
      rangeEnd.value = String(activeIndex);
    }
    renderSelection();
  });

  scopeButtons.forEach((button) => button.addEventListener('click', () => {
    if (button.disabled) return;
    setScope(button.dataset.scope);
  }));

  rangeStart.addEventListener('change', () => {
    normalizeRange('start');
    renderSelection();
  });
  rangeEnd.addEventListener('change', () => {
    normalizeRange('end');
    renderSelection();
  });

  layoutButtons.forEach((button) => button.addEventListener('click', () => {
    setLayout(button.dataset.layout);
  }));

  download.addEventListener('click', async () => {
    if (!window.html2canvas || !activeSelection.length) return;
    download.disabled = true;
    status.textContent = 'Preparing map tiles and typography…';

    try {
      await document.fonts?.ready;
      await settleMap();
      const format = formats[activeLayout];
      const rect = card.getBoundingClientRect();
      const scale = format.width / rect.width;

      const captured = await window.html2canvas(card, {
        backgroundColor: paperColor,
        logging: false,
        scale,
        useCORS: true,
        width: rect.width,
        height: rect.height,
        scrollX: 0,
        scrollY: -window.scrollY
      });

      const output = document.createElement('canvas');
      output.width = format.width;
      output.height = format.height;
      const outputContext = output.getContext('2d');
      outputContext.drawImage(captured, 0, 0, format.width, format.height);

      const blob = await new Promise((resolve) => output.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The browser could not create the PNG.');

      const summary = aggregateSelection(activeSelection);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${slug(summary.title || 'aurora-voyage')}-${format.width}x${format.height}.png`;
      document.body.appendChild(link);
      link.click();
      const objectUrl = link.href;
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      status.textContent = `Downloaded ${format.width} × ${format.height} PNG.`;
    } catch (error) {
      status.textContent = `Export failed: ${error.message}`;
    } finally {
      download.disabled = false;
    }
  });

  function buildVoyageGroups() {
    voyageGroups = new Map();
    features.forEach((feature, index) => {
      const key = voyageKey(feature, index);
      if (!voyageGroups.has(key)) voyageGroups.set(key, []);
      voyageGroups.get(key).push({ feature, index });
    });
    voyageGroups.forEach((entries) => entries.sort((a, b) =>
      String(a.feature.properties?.start || a.feature.properties?.source || a.index)
        .localeCompare(String(b.feature.properties?.start || b.feature.properties?.source || b.index))
    ));
  }

  function voyageKey(feature, index) {
    const properties = feature.properties || {};
    return properties.voyage_id || `single:${properties.source || index}`;
  }

  function currentVoyageEntries() {
    return voyageGroups.get(voyageKey(features[activeIndex], activeIndex)) || [{ feature: features[activeIndex], index: activeIndex }];
  }

  function populateTrackSelect() {
    trackSelect.replaceChildren();
    voyageGroups.forEach((entries) => {
      const first = entries[0]?.feature;
      const group = document.createElement('optgroup');
      group.label = first?.properties?.voyage_title || first?.properties?.year || 'Other voyages';
      entries.forEach(({ feature, index }) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = feature.properties?.name || `Voyage ${index + 1}`;
        group.appendChild(option);
      });
      trackSelect.appendChild(group);
    });
  }

  function populateRangeSelects(index) {
    const entries = voyageGroups.get(voyageKey(features[index], index)) || [{ feature: features[index], index }];
    const fill = (select) => {
      select.replaceChildren();
      entries.forEach(({ feature, index: featureIndex }) => {
        const option = document.createElement('option');
        option.value = String(featureIndex);
        option.textContent = feature.properties?.name || `Voyage ${featureIndex + 1}`;
        select.appendChild(option);
      });
    };
    fill(rangeStart);
    fill(rangeEnd);
    rangeStart.value = String(index);
    rangeEnd.value = String(index);

    const rangeButton = scopeButtons.find((button) => button.dataset.scope === 'range');
    if (rangeButton) rangeButton.disabled = entries.length < 2;
    if (entries.length < 2 && activeScope === 'range') setScope('leg', false);
  }

  function restoreRangeFromUrl(params) {
    const entries = currentVoyageEntries();
    const from = resolveReferenceInEntries(params.get('from'), entries);
    const to = resolveReferenceInEntries(params.get('to'), entries);
    if (from != null) rangeStart.value = String(from);
    if (to != null) rangeEnd.value = String(to);
    normalizeRange('start');
  }

  function resolveFeatureReference(reference, items) {
    if (!reference) return null;
    const bySource = items.findIndex((feature) => feature.properties?.source === reference);
    if (bySource >= 0) return bySource;
    const numeric = Number(reference);
    return Number.isInteger(numeric) && numeric >= 0 && numeric < items.length ? numeric : null;
  }

  function resolveReferenceInEntries(reference, entries) {
    if (!reference) return null;
    const bySource = entries.find((entry) => entry.feature.properties?.source === reference);
    if (bySource) return bySource.index;
    const numeric = Number(reference);
    return entries.some((entry) => entry.index === numeric) ? numeric : null;
  }

  function setScope(scope, render = true) {
    activeScope = scope;
    scopeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.scope === scope)));
    rangeControls.hidden = scope !== 'range';
    if (render) renderSelection();
  }

  function setLayout(layout, refresh = true) {
    activeLayout = layout;
    card.dataset.cardLayout = layout;
    layoutButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.layout === layout)));
    if (refresh) {
      updateUrl();
      window.setTimeout(refreshMapAndRoute, 60);
    }
  }

  function normalizeRange(changed) {
    const entries = currentVoyageEntries();
    const positions = new Map(entries.map((entry, position) => [entry.index, position]));
    const startPosition = positions.get(Number(rangeStart.value));
    const endPosition = positions.get(Number(rangeEnd.value));
    if (startPosition == null || endPosition == null) return;
    if (startPosition <= endPosition) return;
    if (changed === 'start') rangeEnd.value = rangeStart.value;
    else rangeStart.value = rangeEnd.value;
  }

  function selectedEntries() {
    const entries = currentVoyageEntries();
    if (activeScope === 'leg') {
      return entries.filter((entry) => entry.index === activeIndex);
    }
    if (activeScope === 'voyage') return entries;

    const startIndex = entries.findIndex((entry) => entry.index === Number(rangeStart.value));
    const endIndex = entries.findIndex((entry) => entry.index === Number(rangeEnd.value));
    if (startIndex < 0 || endIndex < 0) return entries.filter((entry) => entry.index === activeIndex);
    return entries.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1);
  }

  function renderSelection() {
    const entries = selectedEntries();
    activeSelection = entries.map((entry) => entry.feature);
    const summary = aggregateSelection(activeSelection);

    title.textContent = summary.title;
    meta.textContent = [
      summary.dateRange,
      summary.startTime ? `Start ${summary.startTime}` : '',
      Number.isFinite(summary.distanceNm) ? `${summary.distanceNm.toFixed(1)} NM` : '',
      Number.isFinite(summary.durationHours) ? formatDuration(summary.durationHours) : '',
      Number.isFinite(summary.averageKnots) ? `Avg ${summary.averageKnots.toFixed(1)} kn` : ''
    ].filter(Boolean).join(' · ');

    if (voyageName) voyageName.textContent = summary.footer;
    updateUrl();
    refreshMapAndRoute();
  }

  function aggregateSelection(selection) {
    const first = selection[0] || {};
    const last = selection[selection.length - 1] || first;
    const firstProperties = first.properties || {};
    const lastProperties = last.properties || {};

    const distanceValues = selection.map((feature) => Number(feature.properties?.distance_nm));
    const distanceNm = distanceValues.some(Number.isFinite)
      ? distanceValues.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0)
      : NaN;

    const durationValues = selection.map((feature) => Number(feature.properties?.duration_hours));
    const completeDuration = durationValues.length > 0 && durationValues.every((value) => Number.isFinite(value) && value > 0);
    const durationHours = completeDuration ? durationValues.reduce((total, value) => total + value, 0) : NaN;
    const averageKnots = Number.isFinite(distanceNm) && Number.isFinite(durationHours) && durationHours > 0
      ? distanceNm / durationHours
      : NaN;

    const voyageTitle = firstProperties.voyage_title || firstProperties.year || 'Recorded passage';
    let cardTitle = firstProperties.name || 'Voyage';
    if (selection.length > 1 && activeScope === 'voyage') cardTitle = voyageTitle;
    if (selection.length > 1 && activeScope === 'range') {
      cardTitle = `${shortLegName(firstProperties.name)} – ${shortLegName(lastProperties.name)}`;
    }

    return {
      title: cardTitle,
      footer: selection.length > 1 ? `${voyageTitle} · ${selection.length} legs` : voyageTitle,
      dateRange: formatDateRange(
        firstProperties.start,
        lastProperties.end,
        firstProperties.start_timezone,
        lastProperties.end_timezone
      ),
      startTime: formatLocalTime(firstProperties.start, firstProperties.start_timezone),
      distanceNm,
      durationHours,
      averageKnots
    };
  }

  function shortLegName(value) {
    const text = String(value || 'Passage');
    const match = text.match(/(?:passage|leg)\s+\d+(?:\s*[-–—].*)?$/i);
    return match ? match[0].replace(/^./, (char) => char.toUpperCase()) : text;
  }

  function refreshMapAndRoute() {
    requestAnimationFrame(() => {
      map.invalidateSize({ pan: false, animate: false });
      fitSelection();
      requestAnimationFrame(() => requestAnimationFrame(drawRouteOverlay));
    });
  }

  function fitSelection() {
    const bounds = selectionBounds(activeSelection);
    if (bounds?.isValid()) {
      map.fitBounds(bounds, { padding: [38, 38], maxZoom: 12, animate: false });
    }
  }

  function selectionBounds(selection) {
    const bounds = L.latLngBounds([]);
    selection.forEach((feature) => {
      geometryLines(feature.geometry).forEach((line) => {
        line.forEach((coordinate) => {
          if (Array.isArray(coordinate) && coordinate.length >= 2) bounds.extend([coordinate[1], coordinate[0]]);
        });
      });
    });
    return bounds;
  }

  function geometryLines(geometry) {
    if (geometry?.type === 'LineString') return [geometry.coordinates || []];
    if (geometry?.type === 'MultiLineString') return geometry.coordinates || [];
    return [];
  }

  function selectedLines(selection) {
    return selection.flatMap((feature) => geometryLines(feature.geometry)).filter((line) => line.length >= 2);
  }

  function drawRouteOverlay() {
    const width = mapNode.clientWidth;
    const height = mapNode.clientHeight;
    if (!width || !height || !activeSelection.length) return;

    const density = Math.min(window.devicePixelRatio || 1, 2);
    const targetWidth = Math.round(width * density);
    const targetHeight = Math.round(height * density);
    if (routeCanvas.width !== targetWidth || routeCanvas.height !== targetHeight) {
      routeCanvas.width = targetWidth;
      routeCanvas.height = targetHeight;
    }
    routeCanvas.style.width = `${width}px`;
    routeCanvas.style.height = `${height}px`;

    const context = routeCanvas.getContext('2d');
    context.setTransform(density, 0, 0, density, 0, 0);
    context.clearRect(0, 0, width, height);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    const lines = selectedLines(activeSelection);
    context.strokeStyle = routeColor;
    context.lineWidth = 5.4;
    lines.forEach((line) => {
      context.beginPath();
      line.forEach((coordinate, index) => {
        const point = map.latLngToContainerPoint([coordinate[1], coordinate[0]]);
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      context.stroke();
    });

    const first = lines[0]?.[0];
    const lastLine = lines[lines.length - 1];
    const finish = lastLine?.[lastLine.length - 1];
    if (first) drawEndpoint(context, first, false);
    if (finish) drawEndpoint(context, finish, true);

    activeSelection.forEach((feature) => {
      (Array.isArray(feature.properties?.day_marks) ? feature.properties.day_marks : []).forEach((mark) => {
        if (!Array.isArray(mark.coordinates) || mark.coordinates.length < 2) return;
        const point = map.latLngToContainerPoint([mark.coordinates[1], mark.coordinates[0]]);
        drawDayMark(context, point, formatUtcDay(mark.time));
      });
    });

    const distance = activeSelection.reduce((total, feature) => total + (Number(feature.properties?.distance_nm) || 0), 0);
    const fractions = distance >= 120 ? [.2, .4, .6, .8] : distance >= 80 ? [.25, .5, .75] : distance >= 25 ? [.34, .67] : [.5];
    fractions
      .map((fraction) => pointAlongGeometry(lines, fraction))
      .filter(Boolean)
      .forEach((position) => {
        const point = map.latLngToContainerPoint([position.lat, position.lon]);
        drawDirectionArrow(context, point, position.bearing);
      });
  }

  function drawEndpoint(context, coordinate, filled) {
    const point = map.latLngToContainerPoint([coordinate[1], coordinate[0]]);
    context.save();
    context.beginPath();
    context.arc(point.x, point.y, 6, 0, Math.PI * 2);
    context.fillStyle = filled ? routeColor : paperColor;
    context.fill();
    context.strokeStyle = routeColor;
    context.lineWidth = 2.5;
    context.stroke();
    context.restore();
  }

  function drawDayMark(context, point, label) {
    context.save();
    context.beginPath();
    context.arc(point.x, point.y, 4, 0, Math.PI * 2);
    context.fillStyle = paperColor;
    context.fill();
    context.strokeStyle = routeColor;
    context.lineWidth = 2;
    context.stroke();

    if (label) {
      context.font = '700 10px Manrope, system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const width = Math.ceil(context.measureText(label).width) + 10;
      const height = 18;
      const x = point.x - width / 2;
      const y = point.y - 28;
      context.fillStyle = 'rgba(243,239,230,.94)';
      context.fillRect(x, y, width, height);
      context.fillStyle = routeColor;
      context.fillText(label, point.x, y + height / 2 + .5);
    }
    context.restore();
  }

  function drawDirectionArrow(context, point, bearing) {
    context.save();
    context.translate(point.x, point.y);
    context.rotate(bearing * Math.PI / 180);
    context.beginPath();
    context.moveTo(0, -8);
    context.lineTo(5, 1);
    context.lineTo(2.2, .2);
    context.lineTo(2.2, 7);
    context.lineTo(-2.2, 7);
    context.lineTo(-2.2, .2);
    context.lineTo(-5, 1);
    context.closePath();
    context.strokeStyle = paperColor;
    context.lineWidth = 4;
    context.stroke();
    context.fillStyle = routeColor;
    context.fill();
    context.restore();
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

  function safeTimeZone(value) {
    if (!value) return 'UTC';
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: value }).format(new Date());
      return value;
    } catch {
      return 'UTC';
    }
  }

  function formatDateRange(start, end, startTimeZone, endTimeZone) {
    const format = (value, timeZone) => {
      const date = new Date(value);
      return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: safeTimeZone(timeZone)
      }).format(date);
    };
    const first = format(start, startTimeZone);
    const last = format(end, endTimeZone || startTimeZone);
    return first && last && first !== last ? `${first} – ${last}` : first;
  }

  function formatLocalTime(value, timeZone) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return '';
    const zone = safeTimeZone(timeZone);
    const formatter = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: zone,
      timeZoneName: 'short'
    });
    return formatter.format(date);
  }

  function formatUtcDay(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC'
    }).format(date);
  }

  function formatDuration(hours) {
    if (!Number.isFinite(hours) || hours < 0) return '';
    const totalMinutes = Math.round(hours * 60);
    const wholeHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return wholeHours ? `${wholeHours} h${minutes ? ` ${minutes} min` : ''}` : `${minutes} min`;
  }

  function updateUrl() {
    if (!features.length) return;
    const url = new URL(window.location.href);
    const source = features[activeIndex]?.properties?.source;
    if (source) url.searchParams.set('track', source);
    else url.searchParams.set('track', String(activeIndex));

    if (activeScope === 'leg') url.searchParams.delete('scope');
    else url.searchParams.set('scope', activeScope);

    if (activeScope === 'range') {
      const startFeature = features[Number(rangeStart.value)];
      const endFeature = features[Number(rangeEnd.value)];
      url.searchParams.set('from', startFeature?.properties?.source || rangeStart.value);
      url.searchParams.set('to', endFeature?.properties?.source || rangeEnd.value);
    } else {
      url.searchParams.delete('from');
      url.searchParams.delete('to');
    }

    if (activeLayout === 'portrait') url.searchParams.delete('layout');
    else url.searchParams.set('layout', activeLayout);

    window.history.replaceState({}, '', url);
  }

  async function settleMap() {
    map.invalidateSize({ pan: false, animate: false });
    fitSelection();
    await nextFrames(3);
    await waitForTiles();
    drawRouteOverlay();
    await nextFrames(2);
  }

  function nextFrames(count) {
    return new Promise((resolve) => {
      const step = () => {
        if (count <= 0) {
          resolve();
          return;
        }
        count -= 1;
        requestAnimationFrame(step);
      };
      step();
    });
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
