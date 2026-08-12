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
    const refreshMap = () => map.invalidateSize({ pan: false, animate: false });
    const resetMap = () => {
      if (allBounds?.isValid()) map.fitBounds(allBounds, { padding: [28, 28], maxZoom: 11, animate: false });
      else map.setView(defaultView.center, defaultView.zoom, { animate: false });
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

      const palette = ['#2f6f73', '#8d6b43', '#24566b', '#8c4f3f', '#5e6f47'];
      const layers = [];
      const list = document.querySelector('[data-voyage-items]');
      document.querySelector('[data-map-empty]')?.remove();

      data.features.forEach((feature, index) => {
        const color = palette[index % palette.length];
        const layer = L.geoJSON(feature, { style: { color, weight: 3, opacity: .88 } }).addTo(map);
        layers.push(layer);

        const p = feature.properties || {};
        const item = document.createElement('article');
        item.className = 'voyage-item';
        const distance = Number.isFinite(p.distance_nm) ? `${p.distance_nm.toFixed(1)} nm` : '';
        const dates = formatDateRange(p.start, p.end);
        item.innerHTML = `<button type="button"><strong>${escapeHtml(p.name || `Voyage ${index + 1}`)}</strong><span>${[dates, distance].filter(Boolean).join(' · ')}</span></button>`;
        item.querySelector('button').addEventListener('click', () => {
          refreshMap();
          map.fitBounds(layer.getBounds(), { padding: [28, 28], maxZoom: 12, animate: false });
        });
        list?.appendChild(item);
      });

      const group = L.featureGroup(layers);
      allBounds = group.getBounds();
      refreshMap();
      resetMap();
      window.setTimeout(() => {
        refreshMap();
        tiles.redraw();
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
      return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
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
