/* Shared source: iatsuk/web-analytics. No visitor cookies or persistent IDs. */
(() => {
  const endpoints = {
    'deelstuff.com': 'https://stats.deelstuff.com/count',
    'sy-aurora.de': 'https://stats.deelstuff.com/count',
    'kombuese.deelstuff.com': 'https://stats.deelstuff.com/count',
    'sy-rassvet.com': 'https://stats.deelstuff.com/count',
  };
  const endpoint = endpoints[location.hostname];
  if (!endpoint || location.protocol !== 'https:' || window.top !== window) return;
  try {
    if (location.hash === '#analytics-disable') localStorage.setItem('analytics.disabled', 'true');
    if (location.hash === '#analytics-enable') localStorage.removeItem('analytics.disabled');
    if (localStorage.getItem('analytics.disabled') === 'true') return;
  } catch { /* Storage restrictions must not break the page. */ }
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true || navigator.webdriver) return;
  let recorded = false;
  const recordVisiblePage = () => {
    if (recorded || document.visibilityState !== 'visible') return;
    recorded = true;
    document.removeEventListener('visibilitychange', recordVisiblePage);
    let referrer = '';
    try {
      const source = new URL(document.referrer);
      if (source.origin !== location.origin) referrer = source.origin;
    } catch { /* No referrer is normal for direct visits. */ }
    const canonical = document.querySelector('link[rel="canonical"]');
    let pathname = location.pathname;
    try {
      const source = new URL(canonical?.href || location.href);
      if (source.hostname === location.hostname) pathname = source.pathname;
    } catch { /* Use the current path if a canonical URL is malformed. */ }
    if (/^\/(?:impressum|datenschutz)(?:\/(?:en|de|ru))?\/?$/.test(pathname.replace(/^\/(en|de)\//, '/'))) return;
    const query = new URLSearchParams({ p: "/" + location.hostname + pathname, t: document.title.slice(0, 250), r: referrer, b: '0' });
    const image = new Image();
    image.referrerPolicy = 'origin';
    image.src = endpoint + '?' + query;
  };
  document.addEventListener('visibilitychange', recordVisiblePage);
  recordVisiblePage();
})();
