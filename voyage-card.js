(() => {
  const card = document.querySelector('[data-card]');
  const mapNode = document.querySelector('#voyage-card-map');
  const contextMapNode = document.querySelector('#voyage-context-map');
  const detailCaption = document.querySelector('[data-detail-caption]');
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

  if (!card || !mapNode || !contextMapNode || !trackSelect || !rangeStart || !rangeEnd || !window.L) return;

  const formats = {
    story: { width: 1080, height: 1920 },
    portrait: { width: 1080, height: 1350 },
    article: { width: 1600, height: 1000 },
    wide: { width: 1920, height: 1080 },
    'wide-context': { width: 1920, height: 1080 }
  };
  const routeColor = '#d84a1b';
  const contextColor = '#2f6f9f';
  const paperColor = '#f3efe6';
  const navyColor = '#071b24';
  const sandColor = '#ead9b7';

  let features = [];
  let voyageGroups = new Map();
  let activeIndex = 0;
  let activeScope = 'leg';
  let activeLayout = 'story';
  let activeSelection = [];

  const routeCanvas = document.createElement('canvas');
  routeCanvas.className = 'voyage-route-canvas';
  routeCanvas.setAttribute('aria-hidden', 'true');
  mapNode.append(routeCanvas);

  const contextRouteCanvas = document.createElement('canvas');
  contextRouteCanvas.className = 'voyage-route-canvas';
  contextRouteCanvas.setAttribute('aria-hidden', 'true');
  contextMapNode.append(contextRouteCanvas);

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

  map.attributionControl.setPrefix(false);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    minZoom: 3,
    maxZoom: 18,
    crossOrigin: true,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  const contextMap = L.map(contextMapNode, {
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
    attributionControl: false
  }).setView([56.2, 10.7], 5);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    minZoom: 3,
    maxZoom: 18,
    crossOrigin: true
  }).addTo(contextMap);

  map.on('moveend zoomend resize', () => requestAnimationFrame(drawRouteOverlay));
  contextMap.on('moveend zoomend resize', () => requestAnimationFrame(drawContextOverlay));

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
      setLayout(Object.hasOwn(formats, requestedLayout) ? requestedLayout : 'story', false);
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
      const layoutSuffix = activeLayout === 'wide-context' ? '-context' : '';
      link.download = `${slug(summary.title || 'aurora-voyage')}${layoutSuffix}-${format.width}x${format.height}.png`;
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
    updateContextLayoutAvailability();
    if (render) renderSelection();
  }

  function setLayout(layout, refresh = true) {
    const contextUnavailable = layout === 'wide-context' &&
      (activeScope === 'voyage' || currentVoyageEntries().length < 2);
    activeLayout = contextUnavailable ? 'wide' : layout;
    card.dataset.cardLayout = activeLayout;
    layoutButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.layout === activeLayout)));
    updateMapCaptions();
    if (refresh) {
      updateUrl();
      window.setTimeout(refreshMapAndRoute, 60);
    }
  }

  function updateContextLayoutAvailability() {
    const button = layoutButtons.find((candidate) => candidate.dataset.layout === 'wide-context');
    const disabled = !features.length || activeScope === 'voyage' || currentVoyageEntries().length < 2;
    if (button) button.disabled = disabled;
    if (disabled && activeLayout === 'wide-context') {
      activeLayout = 'wide';
      card.dataset.cardLayout = activeLayout;
      layoutButtons.forEach((candidate) =>
        candidate.setAttribute('aria-pressed', String(candidate.dataset.layout === activeLayout))
      );
    }
    updateMapCaptions();
  }

  function updateMapCaptions() {
    if (!detailCaption) return;
    detailCaption.textContent = activeScope === 'range' ? 'Current range' : 'Current passage';
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
    updateContextLayoutAvailability();
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
      footer: selection.length > 1 ? `${voyageTitle} · ${selection.length} passages` : voyageTitle,
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

      if (activeLayout === 'wide-context') {
        contextMap.invalidateSize({ pan: false, animate: false });
        fitContextSelection();
      }

      requestAnimationFrame(() => requestAnimationFrame(() => {
        drawRouteOverlay();
        drawContextOverlay();
      }));
    });
  }

  function fitSelection() {
    const bounds = selectionBounds(activeSelection);
    if (bounds?.isValid()) {
      const shortSide = Math.min(mapNode.clientWidth || 0, mapNode.clientHeight || 0);
      const padding = Math.max(28, Math.min(42, Math.round(shortSide * .06)));
      map.fitBounds(bounds, { padding: [padding, padding], maxZoom: 13, animate: false });
    }
  }

  function contextVoyageState() {
    const voyageEntries = currentVoyageEntries();
    const selected = selectedEntries();
    if (!voyageEntries.length || !selected.length) return null;

    const selectedIndexes = new Set(selected.map((entry) => entry.index));
    const lastSelectedIndex = selected[selected.length - 1].index;
    const endPosition = voyageEntries.findIndex((entry) => entry.index === lastSelectedIndex);
    if (endPosition < 0) return null;

    return {
      entries: voyageEntries.slice(0, endPosition + 1),
      selectedIndexes
    };
  }

  function fitContextSelection() {
    if (activeLayout !== 'wide-context') return;
    const state = contextVoyageState();
    if (!state) return;
    const featuresToFit = state.entries.map((entry) => entry.feature);
    const bounds = selectionBounds(featuresToFit);
    if (!bounds?.isValid()) return;

    const shortSide = Math.min(contextMapNode.clientWidth || 0, contextMapNode.clientHeight || 0);
    const padding = Math.max(20, Math.min(34, Math.round(shortSide * .055)));
    contextMap.fitBounds(bounds, { padding: [padding, padding], maxZoom: 10, animate: false });
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

    activeSelection.forEach((feature) => {
      (Array.isArray(feature.properties?.day_marks) ? feature.properties.day_marks : []).forEach((mark) => {
        if (!Array.isArray(mark.coordinates) || mark.coordinates.length < 2) return;
        const point = map.latLngToContainerPoint([mark.coordinates[1], mark.coordinates[0]]);
        drawDayMark(context, point, formatDayMark(mark));
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

    // Dark terminal / stopover callouts have priority and move only as much as needed vertically.
    // Compact passage metrics remain all-or-none and use one common offset for the whole selection.
    const occupiedBoxes = drawPassageBoundaries(context);
    if (activeSelection.length > 1) drawPassageLabels(context, occupiedBoxes);
  }

  function drawContextOverlay() {
    const width = contextMapNode.clientWidth;
    const height = contextMapNode.clientHeight;
    const context = contextRouteCanvas.getContext('2d');

    if (activeLayout !== 'wide-context' || !width || !height) {
      contextRouteCanvas.width = Math.max(1, contextRouteCanvas.width);
      contextRouteCanvas.height = Math.max(1, contextRouteCanvas.height);
      context.clearRect(0, 0, contextRouteCanvas.width, contextRouteCanvas.height);
      return;
    }

    const state = contextVoyageState();
    if (!state) return;

    const density = Math.min(window.devicePixelRatio || 1, 2);
    const targetWidth = Math.round(width * density);
    const targetHeight = Math.round(height * density);
    if (contextRouteCanvas.width !== targetWidth || contextRouteCanvas.height !== targetHeight) {
      contextRouteCanvas.width = targetWidth;
      contextRouteCanvas.height = targetHeight;
    }
    contextRouteCanvas.style.width = `${width}px`;
    contextRouteCanvas.style.height = `${height}px`;

    context.setTransform(density, 0, 0, density, 0, 0);
    context.clearRect(0, 0, width, height);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    const previousEntries = state.entries.filter((entry) => !state.selectedIndexes.has(entry.index));
    const currentEntries = state.entries.filter((entry) => state.selectedIndexes.has(entry.index));

    drawContextLines(context, previousEntries, contextColor, 4.2);
    drawContextLines(context, currentEntries, routeColor, 5.4);

    const firstEndpoints = featureEndpoints(state.entries[0]?.feature);
    const lastEndpoints = featureEndpoints(state.entries[state.entries.length - 1]?.feature);
    if (firstEndpoints) drawContextPoint(context, firstEndpoints.start, contextColor, false);
    if (lastEndpoints) drawContextPoint(context, lastEndpoints.end, routeColor, true);
  }

  function drawContextLines(context, entries, color, width) {
    context.strokeStyle = color;
    context.lineWidth = width;
    entries.forEach((entry) => {
      geometryLines(entry.feature?.geometry)
        .filter((line) => line.length >= 2)
        .forEach((line) => {
          context.beginPath();
          line.forEach((coordinate, index) => {
            const point = contextMap.latLngToContainerPoint([coordinate[1], coordinate[0]]);
            if (index === 0) context.moveTo(point.x, point.y);
            else context.lineTo(point.x, point.y);
          });
          context.stroke();
        });
    });
  }

  function drawContextPoint(context, coordinate, color, filled) {
    const point = contextMap.latLngToContainerPoint([coordinate[1], coordinate[0]]);
    context.save();
    context.beginPath();
    context.arc(point.x, point.y, 5.5, 0, Math.PI * 2);
    context.fillStyle = filled ? color : paperColor;
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = 2.5;
    context.stroke();
    context.restore();
  }

  function featureEndpoints(feature) {
    const lines = geometryLines(feature?.geometry).filter((line) => line.length >= 2);
    if (!lines.length) return null;
    const lastLine = lines[lines.length - 1];
    return {
      start: lines[0][0],
      end: lastLine[lastLine.length - 1]
    };
  }

  function drawPassageBoundaries(context) {
    const occupiedBoxes = [];
    const firstFeature = activeSelection[0];
    const lastFeature = activeSelection[activeSelection.length - 1];
    const firstEndpoints = featureEndpoints(firstFeature);
    const lastEndpoints = featureEndpoints(lastFeature);
    if (!firstEndpoints || !lastEndpoints) return occupiedBoxes;

    const firstProperties = firstFeature.properties || {};
    const startBox = drawBoundaryCallout(
      context,
      firstEndpoints.start,
      'START',
      formatLocalDateTime(firstProperties.start, firstProperties.start_timezone),
      { filled: false },
      occupiedBoxes
    );
    if (startBox) occupiedBoxes.push(startBox);

    let cumulativeDistance = 0;
    activeSelection.forEach((feature, index) => {
      const properties = feature.properties || {};
      cumulativeDistance += Number(properties.distance_nm) || 0;
      const endpoints = featureEndpoints(feature);
      if (!endpoints) return;

      if (index < activeSelection.length - 1) {
        const nextFeature = activeSelection[index + 1];
        const nextProperties = nextFeature.properties || {};
        const currentPassage = passageCode(properties.name, index);
        const stopDuration = formatStopDuration(properties.end, nextProperties.start);
        const stopBox = drawBoundaryCallout(
          context,
          endpoints.end,
          `${currentPassage} · ${cumulativeDistance.toFixed(1)} NM total`,
          stopDuration ? `Stopover ${stopDuration}` : 'Stopover',
          { filled: true },
          occupiedBoxes
        );
        if (stopBox) occupiedBoxes.push(stopBox);

        const nextEndpoints = featureEndpoints(nextFeature);
        if (nextEndpoints) drawEndpoint(context, nextEndpoints.start, false, 4.5);
      }
    });

    const lastProperties = lastFeature.properties || {};
    const finishBox = drawBoundaryCallout(
      context,
      lastEndpoints.end,
      `FINISH · ${cumulativeDistance.toFixed(1)} NM`,
      formatLocalDateTime(lastProperties.end, lastProperties.end_timezone),
      { filled: true },
      occupiedBoxes
    );
    if (finishBox) occupiedBoxes.push(finishBox);

    return occupiedBoxes;
  }

  function drawPassageLabels(context, darkBoxes) {
    // Keep all passage metrics visually consistent. Try a small set of common
    // offsets for the entire selection; never move just one label independently.
    const offsets = [-14, 14, -20, 20];
    const darkSafety = 3;
    const lightSafety = 2;

    for (const offset of offsets) {
      const placements = activeSelection.map((feature) =>
        buildPassageLabelPlacement(context, feature, offset)
      );
      if (placements.some((placement) => !placement)) continue;

      const collidesWithDark = placements.some((placement) =>
        darkBoxes.some((box) => rectsIntersect(placement.rect, expandRect(box, darkSafety)))
      );
      if (collidesWithDark) continue;

      const paddedLightBoxes = placements.map((placement) =>
        expandRect(placement.rect, lightSafety)
      );
      const collidesWithLight = paddedLightBoxes.some((box, index) =>
        paddedLightBoxes.some((other, otherIndex) =>
          otherIndex > index && rectsIntersect(box, other)
        )
      );
      if (collidesWithLight) continue;

      placements.forEach((placement) => drawPassageLabel(context, placement));
      return;
    }
  }

  function buildPassageLabelPlacement(context, feature, offset) {
    const properties = feature.properties || {};
    const distance = Number(properties.distance_nm);
    const duration = Number(properties.duration_hours);
    if (!Number.isFinite(distance) || !Number.isFinite(duration)) return null;

    const lines = geometryLines(feature?.geometry).filter((line) => line.length >= 2);
    if (!lines.length) return null;

    const before = pointAlongGeometry(lines, .455);
    const centre = pointAlongGeometry(lines, .5);
    const after = pointAlongGeometry(lines, .545);
    if (!before || !centre || !after) return null;

    const beforePoint = map.latLngToContainerPoint([before.lat, before.lon]);
    const centrePoint = map.latLngToContainerPoint([centre.lat, centre.lon]);
    const afterPoint = map.latLngToContainerPoint([after.lat, after.lon]);

    let angle = Math.atan2(afterPoint.y - beforePoint.y, afterPoint.x - beforePoint.x);
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;

    const line1 = `${distance.toFixed(1)} NM`;
    const line2 = formatDurationCompact(duration);
    const primaryFont = '700 10px Manrope, system-ui, sans-serif';
    const secondaryFont = '600 9px Manrope, system-ui, sans-serif';

    context.save();
    context.font = primaryFont;
    const primaryWidth = context.measureText(line1).width;
    context.font = secondaryFont;
    const secondaryWidth = context.measureText(line2).width;
    context.restore();

    const labelWidth = Math.ceil(Math.max(primaryWidth, secondaryWidth)) + 18;
    const labelHeight = 34;

    const labelCentreX = centrePoint.x - Math.sin(angle) * offset;
    const labelCentreY = centrePoint.y + Math.cos(angle) * offset;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const boxWidth = labelWidth * cos + labelHeight * sin;
    const boxHeight = labelWidth * sin + labelHeight * cos;
    const rect = {
      x: labelCentreX - boxWidth / 2,
      y: labelCentreY - boxHeight / 2,
      width: boxWidth,
      height: boxHeight
    };

    const edgeMargin = 4;
    const inside = rect.x >= edgeMargin && rect.y >= edgeMargin &&
      rect.x + rect.width <= mapNode.clientWidth - edgeMargin &&
      rect.y + rect.height <= mapNode.clientHeight - edgeMargin;
    if (!inside) return null;

    return {
      x: centrePoint.x,
      y: centrePoint.y,
      angle,
      offset,
      width: labelWidth,
      height: labelHeight,
      rect,
      line1,
      line2
    };
  }

  function drawPassageLabel(context, placement) {
    context.save();
    context.translate(placement.x, placement.y);
    context.rotate(placement.angle);

    const x = -placement.width / 2;
    const y = placement.offset - placement.height / 2;

    roundedRect(context, x, y, placement.width, placement.height, 6);
    context.fillStyle = 'rgba(243,239,230,.94)';
    context.fill();
    context.strokeStyle = 'rgba(7,27,36,.14)';
    context.lineWidth = 1;
    context.stroke();

    context.textAlign = 'center';
    context.textBaseline = 'middle';

    context.font = '700 10px Manrope, system-ui, sans-serif';
    context.fillStyle = navyColor;
    context.fillText(placement.line1, 0, placement.offset - 6);

    context.font = '600 9px Manrope, system-ui, sans-serif';
    context.fillStyle = 'rgba(7,27,36,.72)';
    context.fillText(placement.line2, 0, placement.offset + 8);
    context.restore();
  }

  function passageCode(value, fallbackIndex) {
    const text = shortLegName(value);
    const match = text.match(/(?:passage|leg)\s+(\d+)/i);
    return match ? `P${match[1]}` : `P${fallbackIndex + 1}`;
  }

  function expandRect(rect, amount) {
    return {
      x: rect.x - amount,
      y: rect.y - amount,
      width: rect.width + amount * 2,
      height: rect.height + amount * 2
    };
  }

  function rectsIntersect(a, b) {
    return a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y;
  }

  function overlapArea(a, b) {
    if (!rectsIntersect(a, b)) return 0;
    const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return Math.max(0, width) * Math.max(0, height);
  }

  function unionRects(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const right = Math.max(a.x + a.width, b.x + b.width);
    const bottom = Math.max(a.y + a.height, b.y + b.height);
    return { x, y, width: right - x, height: bottom - y };
  }

  function formatDurationCompact(hours) {
    if (!Number.isFinite(hours) || hours < 0) return '';
    const totalMinutes = Math.round(hours * 60);
    const wholeHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return wholeHours ? `${wholeHours}h${minutes ? ` ${minutes}m` : ''}` : `${minutes}m`;
  }

  function formatStopDuration(end, nextStart) {
    const endDate = new Date(end);
    const startDate = new Date(nextStart);
    if (Number.isNaN(endDate.valueOf()) || Number.isNaN(startDate.valueOf()) || startDate <= endDate) return '';

    const totalMinutes = Math.round((startDate - endDate) / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const remainder = totalMinutes - days * 1440;
    const hours = Math.floor(remainder / 60);
    const minutes = remainder % 60;

    if (days) return `${days}d${hours ? ` ${hours}h` : ''}`;
    if (hours) return `${hours}h${minutes ? ` ${minutes}m` : ''}`;
    return `${minutes}m`;
  }

  function drawEndpoint(context, coordinate, filled, radius = 6) {
    const point = map.latLngToContainerPoint([coordinate[1], coordinate[0]]);
    context.save();
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fillStyle = filled ? routeColor : paperColor;
    context.fill();
    context.strokeStyle = routeColor;
    context.lineWidth = 2.5;
    context.stroke();
    context.restore();
  }

  function drawBoundaryCallout(context, coordinate, primary, secondary, options = {}, occupiedBoxes = []) {
    const point = map.latLngToContainerPoint([coordinate[1], coordinate[0]]);
    drawEndpoint(context, coordinate, Boolean(options.filled), 6);

    context.save();
    const primaryFont = '700 10px Manrope, system-ui, sans-serif';
    const secondaryFont = '500 9px Manrope, system-ui, sans-serif';
    context.font = primaryFont;
    const primaryWidth = context.measureText(primary || '').width;
    context.font = secondaryFont;
    const secondaryWidth = context.measureText(secondary || '').width;
    const boxWidth = Math.ceil(Math.max(primaryWidth, secondaryWidth) + 22);
    const boxHeight = secondary ? 38 : 24;
    const pointGap = 9;
    const collisionGap = 2;

    let x = point.x - boxWidth / 2;
    x = Math.max(6, Math.min(x, mapNode.clientWidth - boxWidth - 6));

    const preferredAbove = point.y - boxHeight - pointGap;
    const preferredBelow = point.y + pointGap;
    const candidates = [
      resolveBoundaryVerticalPosition(x, preferredAbove, boxWidth, boxHeight, -1, occupiedBoxes, collisionGap),
      resolveBoundaryVerticalPosition(x, preferredBelow, boxWidth, boxHeight, 1, occupiedBoxes, collisionGap)
    ].filter(Boolean);

    let chosen = candidates
      .sort((a, b) => (a.displacement - b.displacement) || (a.direction - b.direction))[0];

    if (!chosen) {
      const y = Math.max(6, Math.min(preferredAbove, mapNode.clientHeight - boxHeight - 6));
      chosen = { rect: { x, y, width: boxWidth, height: boxHeight }, displacement: 0, direction: -1 };
    }

    const { y } = chosen.rect;

    roundedRect(context, x, y, boxWidth, boxHeight, 6);
    context.fillStyle = 'rgba(7,27,36,.92)';
    context.fill();

    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = primaryFont;
    context.fillStyle = sandColor;
    context.fillText(primary || '', x + boxWidth / 2, y + (secondary ? 12 : boxHeight / 2));

    if (secondary) {
      context.font = secondaryFont;
      context.fillStyle = 'rgba(255,253,248,.76)';
      context.fillText(secondary, x + boxWidth / 2, y + 27);
    }
    context.restore();

    return chosen.rect;
  }

  function resolveBoundaryVerticalPosition(x, preferredY, width, height, direction, occupiedBoxes, gap) {
    let y = preferredY;
    const maxIterations = occupiedBoxes.length + 2;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const rect = { x, y, width, height };
      const collision = occupiedBoxes.find((box) =>
        rectsIntersect(rect, expandRect(box, gap))
      );
      if (!collision) {
        const inside = y >= 6 && y + height <= mapNode.clientHeight - 6;
        return inside
          ? { rect, displacement: Math.abs(y - preferredY), direction }
          : null;
      }

      if (direction < 0) y = collision.y - height - gap;
      else y = collision.y + collision.height + gap;
    }

    return null;
  }

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function drawDayMark(context, point, label) {
    context.save();
    context.beginPath();
    context.arc(point.x, point.y, 4, 0, Math.PI * 2);
    context.fillStyle = navyColor;
    context.fill();
    context.strokeStyle = sandColor;
    context.lineWidth = 2;
    context.stroke();

    if (label) {
      context.font = '700 10px Manrope, system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const width = Math.ceil(context.measureText(label).width) + 12;
      const height = 19;
      const x = point.x - width / 2;
      const y = point.y - 29;
      roundedRect(context, x, y, width, height, 5);
      context.fillStyle = 'rgba(7,27,36,.9)';
      context.fill();
      context.fillStyle = sandColor;
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

  function formatLocalDateTime(value, timeZone) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return '';
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: safeTimeZone(timeZone),
      timeZoneName: 'short'
    }).format(date);
  }

  function formatDayMark(mark) {
    if (mark?.local_date) {
      const date = new Date(`${mark.local_date}T12:00:00Z`);
      return Number.isNaN(date.valueOf()) ? mark.local_date : new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        timeZone: 'UTC'
      }).format(date);
    }
    const date = new Date(mark?.time);
    return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      timeZone: safeTimeZone(mark?.timezone)
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

    if (activeLayout === 'story') url.searchParams.delete('layout');
    else url.searchParams.set('layout', activeLayout);

    window.history.replaceState({}, '', url);
  }

  async function settleMap() {
    map.invalidateSize({ pan: false, animate: false });
    fitSelection();

    if (activeLayout === 'wide-context') {
      contextMap.invalidateSize({ pan: false, animate: false });
      fitContextSelection();
    }

    await nextFrames(3);
    const tileWaits = [waitForTiles(mapNode)];
    if (activeLayout === 'wide-context') tileWaits.push(waitForTiles(contextMapNode));
    await Promise.all(tileWaits);

    drawRouteOverlay();
    drawContextOverlay();
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

  function waitForTiles(node) {
    const images = [...node.querySelectorAll('.leaflet-tile')];
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
