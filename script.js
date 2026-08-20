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
    const inactiveStyle = { color: '#2f6f73', weight: 2.4, opacity: .34 };
    const activeStyle = { color: '#8c4f3f', weight: 4.5, opacity: .96 };
    const defaultView = { center: [56.2, 10.7], zoom: 5 };
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

    let allBounds = null;
    const voyages = [];
    const refreshMap = () => map.invalidateSize({ pan: false, animate: false });
    const resetMap = () => {
      selectVoyage(null);
      if (allBounds?.isValid()) map.fitBounds(allBounds, { padding: [28, 28], maxZoom: 11, animate: false });
      else map.setView(defaultView.center, defaultView.zoom, { animate: false });
    };

    const selectVoyage = (selected, fit = false) => {
      voyages.forEach((voyage) => {
        const active = voyage === selected;
        voyage.layer.setStyle(active ? activeStyle : inactiveStyle);
        voyage.item.classList.toggle('active', active);
        voyage.button.setAttribute('aria-pressed', String(active));
        if (active) voyage.details.addTo(map);
        else voyage.details.removeFrom(map);
      });
      if (fit && selected) {
        refreshMap();
        map.fitBounds(selected.layer.getBounds(), { padding: [34, 34], maxZoom: 12, animate: false });
      }
    };

    document.querySelector('[data-map-zoom-in]')?.addEventListener('click', () => map.setZoom(map.getZoom() + 1, { animate: false }));
    document.querySelector('[data-map-zoom-out]')?.addEventListener('click', () => map.setZoom(map.getZoom() - 1, { animate: false }));
    document.querySelector('[data-map-reset]')?.addEventListener('click', resetMap);

    requestAnimationFrame(() => requestAnimationFrame(refreshMap));
    window.setTimeout(refreshMap, 180);
    window.addEventListener('resize', refreshMap, { passive: true });

    map.on('zoomend', () => {
      requestAnimationFrame(() => {
        refreshMap();
        tiles.redraw();
      });
    });

    try {
      const response = await fetch('data/tracks.geojson', { cache: 'no-store' });
      if (!response.ok) throw new Error(`tracks.geojson: ${response.status}`);
      const data = await response.json();
      if (!data.features?.length) return;

      const layers = [];
      const list = document.querySelector('[data-voyage-items]');
      document.querySelector('[data-map-empty]')?.remove();

      data.features.forEach((feature, index) => {
        const p = feature.properties || {};
        const layer = L.geoJSON(feature, { style: inactiveStyle }).addTo(map);
        const details = buildVoyageDetails(feature, p, activeStyle.color);
        layers.push(layer);

        const item = document.createElement('article');
        item.className = 'voyage-item';
        const distance = Number.isFinite(p.distance_nm) ? `${p.distance_nm.toFixed(1)} nm` : '';
        const duration = formatDuration(p.duration_hours);
        const dates = formatDateRange(p.start, p.end);
        const summary = [dates, distance, duration].filter(Boolean).join(' · ');
        item.innerHTML = `<button type="button" aria-pressed="false"><strong>${escapeHtml(p.name || `Voyage ${index + 1}`)}</strong><span>${escapeHtml(summary)}</span></button><a class="voyage-card-link" href="voyage-card.html?track=${index}">Blog card ↗</a>`;
        const button = item.querySelector('button');
        const voyage = { layer, details, item, button };
        button.addEventListener('click', () => selectVoyage(voyage, true));
        layer.on('click', () => selectVoyage(voyage, false));
        layer.bindTooltip(`<strong>${escapeHtml(p.name || `Voyage ${index + 1}`)}</strong><span>${escapeHtml(summary)}</span>`, {
          className: 'voyage-track-tooltip',
          sticky: true
        });
        voyages.push(voyage);
        list?.appendChild(item);
      });

      const group = L.featureGroup(layers);
      allBounds = group.getBounds();
      refreshMap();
      if (voyages.length === 1) selectVoyage(voyages[0], true);
      else resetMap();
      window.setTimeout(() => {
        refreshMap();
        tiles.redraw();
      }, 100);
    } catch (error) {
      console.warn('Unable to load voyage archive', error);
    }
  }

  function buildVoyageDetails(feature, properties, activeColor) {
    const details = L.layerGroup();
    const coordinates = feature.geometry?.type === 'LineString' ? feature.geometry.coordinates : [];
    if (coordinates.length < 2) return details;

    const start = coordinates[0];
    const end = coordinates[coordinates.length - 1];
    L.circleMarker([start[1], start[0]], {
      radius: 6,
      color: activeColor,
      weight: 2.5,
      fillColor: '#f3efe6',
      fillOpacity: 1,
      className: 'voyage-endpoint voyage-start'
    }).bindTooltip('Start', { direction: 'top' }).addTo(details);
    L.circleMarker([end[1], end[0]], {
      radius: 6,
      color: activeColor,
      weight: 2.5,
      fillColor: activeColor,
      fillOpacity: 1,
      className: 'voyage-endpoint voyage-finish'
    }).bindTooltip('Finish', { direction: 'top' }).addTo(details);

    const marks = Array.isArray(properties.day_marks) ? properties.day_marks : [];
    marks.forEach((mark) => {
      if (!Array.isArray(mark.coordinates) || mark.coordinates.length < 2) return;
      const label = formatUtcDay(mark.time);
      const distance = Number.isFinite(mark.distance_nm) ? `${mark.distance_nm.toFixed(1)} nm` : '';
      const tooltip = [formatUtcTimestamp(mark.time), distance].filter(Boolean).join(' · ');
      L.circleMarker([mark.coordinates[1], mark.coordinates[0]], {
        radius: 4,
        color: activeColor,
        weight: 2,
        fillColor: '#f3efe6',
        fillOpacity: 1,
        className: 'voyage-day-point'
      }).bindTooltip(label, {
        permanent: true,
        direction: 'top',
        offset: [0, -5],
        className: 'voyage-day-label'
      }).bindPopup(escapeHtml(tooltip)).addTo(details);
    });

    const distanceNm = Number.isFinite(properties.distance_nm) ? properties.distance_nm : 0;
    const fractions = distanceNm >= 80 ? [.25, .5, .75] : distanceNm >= 25 ? [.34, .67] : [.5];
    fractions.map((fraction) => pointAlongLine(coordinates, fraction)).filter(Boolean).forEach((point) => {
      const rotation = Number((point.bearing).toFixed(1));
      L.marker([point.lat, point.lon], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'voyage-direction-marker',
          html: `<span class="voyage-direction-arrow" style="transform: rotate(${rotation}deg)">↑</span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        })
      }).addTo(details);
    });

    return details;
  }

  function pointAlongLine(coordinates, fraction) {
    if (coordinates.length < 2) return null;
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
      return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(date);
    };
    const a = format(start);
    const b = end ? format(end) : '';
    return b && b !== a ? `${a} – ${b}` : a;
  }

  function formatDuration(hours) {
    if (!Number.isFinite(hours) || hours < 0) return '';
    const totalMinutes = Math.round(hours * 60);
    const wholeHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return wholeHours ? `${wholeHours} h${minutes ? ` ${minutes} min` : ''}` : `${minutes} min`;
  }

  function formatUtcDay(value) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return value || '';
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC'
    }).format(date);
  }

  function formatUtcTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return value || '';
    const day = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(date);
    const clock = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'UTC'
    }).format(date);
    return `${day} · ${clock} UTC`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }
  function escapeAttr(value) { return escapeHtml(value); }
})();
