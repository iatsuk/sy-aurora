(() => {
  const header = document.querySelector('[data-header]');
  const menuButton = document.querySelector('[data-menu-button]');
  const nav = document.querySelector('[data-nav]');

  const onScroll = () => header?.classList.toggle('scrolled', window.scrollY > 28);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  menuButton?.addEventListener('click', () => {
    const open = !nav.classList.contains('open');
    nav.classList.toggle('open', open);
    menuButton.setAttribute('aria-expanded', String(open));
  });
  nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    nav.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
  }));

  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -5% 0px' })
    : null;
  document.querySelectorAll('.reveal').forEach((el) => observer ? observer.observe(el) : el.classList.add('visible'));

  addFooterOwner();
  addRassvetReference();
  repairLeafletStylesheet().finally(initVoyageMapWhenVisible);
  initGallery();

  function addFooterOwner() {
    const footerIdentity = document.querySelector('.site-footer > div');
    if (!footerIdentity || footerIdentity.querySelector('.footer-owner')) return;
    const owner = document.createElement('span');
    owner.className = 'footer-owner';
    owner.textContent = 'Andrei Iatsuk';
    footerIdentity.appendChild(owner);
  }

  function addRassvetReference() {
    const copy = document.querySelector('.transition-copy');
    if (!copy || copy.querySelector('.transition-reference')) return;
    const note = document.createElement('p');
    note.className = 'transition-reference';
    note.innerHTML = 'The complete 2023–2026 record of the Ohlson 29 <a href="https://iatsuk.github.io/sy-rassvet/" target="_blank" rel="noreferrer"><strong>Rassvet</strong> ↗</a> is preserved on its own site.';
    copy.appendChild(note);
  }

  function repairLeafletStylesheet() {
    const href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    const integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    const oldLink = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .find((link) => link.href.startsWith(href));

    if (oldLink?.integrity === integrity) return Promise.resolve();
    oldLink?.remove();

    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.integrity = integrity;
      link.crossOrigin = 'anonymous';
      link.dataset.leafletRepair = 'true';
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', resolve, { once: true });
      document.head.appendChild(link);
      window.setTimeout(resolve, 1800);
    });
  }

  function initVoyageMapWhenVisible() {
    const mapNode = document.querySelector('#voyage-map');
    if (!mapNode || !window.L) return;

    if (!('IntersectionObserver' in window)) {
      initVoyageMap(mapNode);
      return;
    }

    const mapObserver = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      mapObserver.disconnect();
      initVoyageMap(mapNode);
    }, { rootMargin: '240px 0px', threshold: 0.01 });
    mapObserver.observe(mapNode);
  }

  async function initVoyageMap(mapNode) {
    const defaultView = { center: [56.2, 10.7], zoom: 5 };
    const inactiveStyle = { color: '#376e73', weight: 2.5, opacity: .42 };
    const relatedStyle = { color: '#8a6c42', weight: 3.2, opacity: .72 };
    const activeStyle = { color: '#d6b77a', weight: 4.8, opacity: 1 };
    const map = L.map(mapNode, {
      zoomControl: false,
      scrollWheelZoom: true,
      worldCopyJump: false,
      preferCanvas: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      inertia: false,
      trackResize: true
    }).setView(defaultView.center, defaultView.zoom, { animate: false });

    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      minZoom: 3,
      tileSize: 256,
      detectRetina: false,
      updateWhenIdle: false,
      updateWhenZooming: false,
      keepBuffer: 2,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const section = mapNode.closest('.voyages-section');
    const layout = section?.querySelector('.compact-voyage-layout');
    const list = section?.querySelector('[data-voyage-items]');
    const empty = section?.querySelector('[data-map-empty]');
    const records = [];
    const groups = new Map();
    let activeYear = 'all';
    let selectedRecord = null;
    let selectedGroup = null;

    const refreshMap = () => map.invalidateSize({ pan: false, animate: false });
    const trackYear = (properties) => {
      const candidate = String(properties.year || properties.start || properties.source || '');
      return candidate.match(/20\d{2}/)?.[0] || 'Undated';
    };
    const formatDate = (value) => {
      if (!value) return '';
      const date = new Date(value);
      return Number.isNaN(date.valueOf()) ? String(value) : new Intl.DateTimeFormat('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'
      }).format(date);
    };
    const formatDistance = (distance) => Number.isFinite(distance)
      ? `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(distance)} nm`
      : '';
    const formatDuration = (hours) => {
      if (!Number.isFinite(hours) || hours < 0) return '';
      const minutes = Math.round(hours * 60);
      const wholeHours = Math.floor(minutes / 60);
      const remainder = minutes % 60;
      return wholeHours ? `${wholeHours} h${remainder ? ` ${remainder} min` : ''}` : `${remainder} min`;
    };
    const humanize = (value) => String(value || 'Voyages')
      .split('/').pop().replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    const visibleRecords = () => records.filter((record) => activeYear === 'all' || record.year === activeYear);
    const geometryLines = (geometry) => {
      if (geometry?.type === 'LineString') return [geometry.coordinates || []];
      if (geometry?.type === 'MultiLineString') return geometry.coordinates || [];
      return [];
    };
    const fitLayers = (layers, maxZoom = 11) => {
      if (!layers.length) {
        map.setView(defaultView.center, defaultView.zoom, { animate: false });
        return;
      }
      const bounds = L.featureGroup(layers).getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom, animate: false });
    };
    const fitVisible = () => fitLayers(visibleRecords().map((record) => record.layer));

    let meta = section?.querySelector('[data-voyage-atlas-meta]');
    if (!meta && section && layout) {
      meta = document.createElement('div');
      meta.className = 'voyage-atlas-meta';
      meta.dataset.voyageAtlasMeta = '';
      meta.hidden = true;
      meta.innerHTML = `
        <dl class="voyage-atlas-totals" aria-label="Published voyage archive totals">
          <div><dt data-atlas-track-count>0</dt><dd>tracks</dd></div>
          <div><dt data-atlas-distance>0 nm</dt><dd>recorded distance</dd></div>
        </dl>
        <div class="voyage-year-filters" data-voyage-year-filters aria-label="Filter tracks by year"></div>`;
      layout.before(meta);
    }

    const updateTotals = () => {
      const visible = visibleRecords();
      const distance = visible.reduce((total, record) => total + (Number(record.properties.distance_nm) || 0), 0);
      const countNode = meta?.querySelector('[data-atlas-track-count]');
      const distanceNode = meta?.querySelector('[data-atlas-distance]');
      if (countNode) countNode.textContent = String(visible.length);
      if (distanceNode) distanceNode.textContent = formatDistance(distance);
    };

    const buildDetails = (feature) => {
      const details = L.layerGroup();
      const lines = geometryLines(feature.geometry).filter((line) => line.length);
      if (!lines.length) return details;
      const first = lines[0][0];
      const lastLine = lines[lines.length - 1];
      const last = lastLine[lastLine.length - 1];
      [[first, 'Start', false], [last, 'Finish', true]].forEach(([position, label, filled]) => {
        L.circleMarker([position[1], position[0]], {
          radius: 6,
          color: activeStyle.color,
          weight: 2.4,
          fillColor: filled ? activeStyle.color : '#f5f0e6',
          fillOpacity: 1
        }).bindTooltip(label, { direction: 'top' }).addTo(details);
      });
      (feature.properties?.day_marks || []).forEach((mark) => {
        if (!Array.isArray(mark.coordinates)) return;
        L.circleMarker([mark.coordinates[1], mark.coordinates[0]], {
          radius: 4,
          color: activeStyle.color,
          weight: 2,
          fillColor: '#f5f0e6',
          fillOpacity: 1
        }).bindTooltip(formatDate(mark.time), { direction: 'top' }).addTo(details);
      });
      return details;
    };

    const resetSelection = () => {
      selectedRecord = null;
      selectedGroup = null;
      records.forEach((record) => {
        record.layer.setStyle(inactiveStyle);
        record.details.removeFrom(map);
        record.item.classList.remove('active');
        record.button.setAttribute('aria-pressed', 'false');
      });
      groups.forEach((group) => {
        group.section.classList.remove('active');
        group.button.setAttribute('aria-pressed', 'false');
      });
    };

    const selectGroup = (group, fit = true) => {
      resetSelection();
      selectedGroup = group;
      group.section.classList.add('active');
      group.button.setAttribute('aria-pressed', 'true');
      const visible = group.records.filter((record) => activeYear === 'all' || record.year === activeYear);
      visible.forEach((record) => record.layer.setStyle(relatedStyle));
      if (fit) fitLayers(visible.map((record) => record.layer), 10);
    };

    const selectRecord = (record, fit = true) => {
      resetSelection();
      selectedRecord = record;
      selectedGroup = record.group;
      record.group.section.classList.add('active');
      record.group.records.forEach((candidate) => {
        if (activeYear === 'all' || candidate.year === activeYear) candidate.layer.setStyle(relatedStyle);
      });
      record.layer.setStyle(activeStyle);
      record.item.classList.add('active');
      record.button.setAttribute('aria-pressed', 'true');
      record.details.addTo(map);
      if (fit) fitLayers([record.layer], 12);
    };

    const applyYear = (year) => {
      activeYear = year;
      resetSelection();
      records.forEach((record) => {
        const visible = year === 'all' || record.year === year;
        if (visible && !map.hasLayer(record.layer)) record.layer.addTo(map);
        if (!visible && map.hasLayer(record.layer)) record.layer.removeFrom(map);
        record.item.hidden = !visible;
      });
      groups.forEach((group) => {
        group.section.hidden = !group.records.some((record) => year === 'all' || record.year === year);
      });
      meta?.querySelectorAll('[data-voyage-year]').forEach((button) => {
        const active = button.dataset.voyageYear === year;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      updateTotals();
      refreshMap();
      fitVisible();
    };

    const renderFilters = () => {
      const container = meta?.querySelector('[data-voyage-year-filters]');
      if (!container) return;
      container.replaceChildren();
      const years = [...new Set(records.map((record) => record.year))]
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      [['all', 'All years'], ...years.map((year) => [year, year])].forEach(([value, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.voyageYear = value;
        button.setAttribute('aria-pressed', String(value === 'all'));
        button.classList.toggle('active', value === 'all');
        button.textContent = label;
        button.addEventListener('click', () => applyYear(value));
        container.append(button);
      });
    };

    const createRecord = (feature, index) => {
      const properties = feature.properties || {};
      const year = trackYear(properties);
      const groupId = properties.voyage_id || `${year}/other`;
      const layer = L.geoJSON(feature, { style: inactiveStyle }).addTo(map);
      const details = buildDetails(feature);
      const item = document.createElement('article');
      const button = document.createElement('button');
      const title = properties.name || `Voyage ${index + 1}`;
      const summary = [
        formatDateRange(properties.start, properties.end),
        formatDistance(Number(properties.distance_nm)),
        formatDuration(Number(properties.duration_hours))
      ].filter(Boolean).join(' · ');
      item.className = 'voyage-track-item';
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = `<strong>${escapeHtml(title)}</strong><small>${escapeHtml(summary)}</small>`;
      item.append(button);
      const record = { properties, year, groupId, layer, details, item, button, title, summary, group: null };
      button.addEventListener('click', () => selectRecord(record));
      layer.on('click', () => selectRecord(record, false));
      layer.bindTooltip(`<strong>${escapeHtml(title)}</strong><br>${escapeHtml(summary)}`, { sticky: true });
      records.push(record);
    };

    const renderGroups = () => {
      if (!list) return;
      list.replaceChildren();
      records.forEach((record) => {
        if (!groups.has(record.groupId)) {
          groups.set(record.groupId, {
            id: record.groupId,
            year: record.year,
            title: record.properties.voyage_title || (record.groupId.endsWith('/other') ? `${record.year} voyages` : humanize(record.groupId)),
            records: []
          });
        }
        const group = groups.get(record.groupId);
        group.records.push(record);
        record.group = group;
      });

      [...groups.values()]
        .sort((a, b) => String(b.records[0]?.properties.start || b.id).localeCompare(String(a.records[0]?.properties.start || a.id)))
        .forEach((group) => {
          group.records.sort((a, b) => String(a.properties.start || a.properties.source).localeCompare(String(b.properties.start || b.properties.source)));
          const starts = group.records.map((record) => record.properties.start).filter(Boolean).sort();
          const ends = group.records.map((record) => record.properties.end).filter(Boolean).sort();
          const distance = group.records.reduce((total, record) => total + (Number(record.properties.distance_nm) || 0), 0);
          const groupSection = document.createElement('section');
          const button = document.createElement('button');
          const legs = document.createElement('div');
          groupSection.className = 'voyage-group';
          button.className = 'voyage-group-button';
          button.type = 'button';
          button.setAttribute('aria-pressed', 'false');
          button.innerHTML = `
            <span>${escapeHtml(group.year)} · ${group.records.length} ${group.records.length === 1 ? 'leg' : 'legs'}</span>
            <strong>${escapeHtml(group.title)}</strong>
            <small>${escapeHtml([formatDateRange(starts[0], ends[ends.length - 1]), formatDistance(distance)].filter(Boolean).join(' · '))}</small>`;
          legs.className = 'voyage-group-legs';
          group.records.forEach((record) => legs.append(record.item));
          groupSection.append(button, legs);
          list.append(groupSection);
          group.section = groupSection;
          group.button = button;
          button.addEventListener('click', () => selectGroup(group));
        });
    };

    document.querySelector('[data-map-zoom-in]')?.addEventListener('click', () => map.setZoom(map.getZoom() + 1, { animate: false }));
    document.querySelector('[data-map-zoom-out]')?.addEventListener('click', () => map.setZoom(map.getZoom() - 1, { animate: false }));
    document.querySelector('[data-map-reset]')?.addEventListener('click', () => {
      resetSelection();
      refreshMap();
      fitVisible();
    });

    requestAnimationFrame(() => requestAnimationFrame(refreshMap));
    window.setTimeout(refreshMap, 180);
    window.addEventListener('resize', refreshMap, { passive: true });
    map.on('zoomend', () => requestAnimationFrame(() => {
      refreshMap();
      tiles.redraw();
    }));

    try {
      const response = await fetch('data/tracks.geojson', { cache: 'no-store' });
      if (!response.ok) throw new Error(`tracks.geojson: ${response.status}`);
      const data = await response.json();
      const features = (data.features || []).filter((feature) => ['LineString', 'MultiLineString'].includes(feature.geometry?.type));
      if (!features.length) return;

      features.forEach(createRecord);
      renderGroups();
      renderFilters();
      empty?.remove();
      if (meta) meta.hidden = false;
      updateTotals();
      refreshMap();
      fitVisible();
      window.setTimeout(() => {
        refreshMap();
        tiles.redraw();
        fitVisible();
      }, 100);
    } catch (error) {
      console.warn('Unable to load voyage archive', error);
    }
  }

  function initGallery() {
    const media = Array.isArray(window.AURORA_MEDIA) ? window.AURORA_MEDIA : [];
    const grid = document.querySelector('[data-gallery-grid]');
    const filters = document.querySelector('[data-gallery-filters]');
    if (!grid || !media.length) return;

    const categories = ['All', ...new Set(media.map((item) => item.category || 'Other'))];
    let active = 'All';
    let visibleMedia = media;
    let currentIndex = 0;

    grid.innerHTML = '';
    categories.forEach((category) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `gallery-filter${category === active ? ' active' : ''}`;
      button.textContent = category;
      button.addEventListener('click', () => {
        active = category;
        filters.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === button));
        render();
      });
      filters?.appendChild(button);
    });

    const dialog = document.querySelector('[data-lightbox]');
    const stage = document.querySelector('[data-lightbox-stage]');
    const caption = document.querySelector('[data-lightbox-caption]');

    function render() {
      visibleMedia = active === 'All' ? media : media.filter((item) => (item.category || 'Other') === active);
      grid.innerHTML = '';
      visibleMedia.forEach((item, index) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'gallery-card';
        card.setAttribute('aria-label', `Open ${item.title || item.file}`);
        const visual = item.type === 'video'
          ? `<video src="${encodeURI(item.file)}" muted playsinline preload="metadata"></video>`
          : `<img src="${encodeURI(item.file)}" loading="lazy" alt="${escapeAttr(item.alt || item.title || 'Aurora')}" />`;
        card.innerHTML = `${visual}<span class="media-label"><span>${escapeHtml(item.title || item.category || 'Aurora')}</span><span>${item.type === 'video' ? 'VIDEO' : ''}</span></span>`;
        card.addEventListener('click', () => open(index));
        grid.appendChild(card);
      });
    }

    function open(index) {
      currentIndex = index;
      const item = visibleMedia[currentIndex];
      if (!item || !dialog || !stage) return;
      stage.innerHTML = item.type === 'video'
        ? `<video src="${encodeURI(item.file)}" controls autoplay playsinline></video>`
        : `<img src="${encodeURI(item.file)}" alt="${escapeAttr(item.alt || item.title || 'Aurora')}" />`;
      caption.textContent = [item.title, item.caption].filter(Boolean).join(' · ');
      if (!dialog.open) dialog.showModal();
    }

    document.querySelector('[data-lightbox-close]')?.addEventListener('click', () => dialog?.close());
    document.querySelector('[data-lightbox-prev]')?.addEventListener('click', () => open((currentIndex - 1 + visibleMedia.length) % visibleMedia.length));
    document.querySelector('[data-lightbox-next]')?.addEventListener('click', () => open((currentIndex + 1) % visibleMedia.length));
    dialog?.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    document.addEventListener('keydown', (event) => {
      if (!dialog?.open) return;
      if (event.key === 'ArrowLeft') open((currentIndex - 1 + visibleMedia.length) % visibleMedia.length);
      if (event.key === 'ArrowRight') open((currentIndex + 1) % visibleMedia.length);
    });

    render();
  }

  function formatDateRange(start, end) {
    if (!start) return '';
    const format = (value) => {
      const date = new Date(value);
      return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
    };
    const a = format(start);
    const b = end ? format(end) : '';
    return b && b !== a ? `${a} – ${b}` : a;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }
  function escapeAttr(value) { return escapeHtml(value); }
})();
