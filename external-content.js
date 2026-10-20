(() => {
  const messages = {
    en: {
      notice: 'Loading this content connects to {service}. Your IP address and technical data are transmitted; the provider may use cookies and process data outside the EEA.',
      load: 'Allow and load {service}',
      hide: 'Remove external content',
      privacy: 'Privacy information'
    },
    de: {
      notice: 'Beim Laden wird eine Verbindung zu {service} hergestellt. Ihre IP-Adresse und technische Daten werden übermittelt; der Anbieter kann Cookies einsetzen und Daten außerhalb des EWR verarbeiten.',
      load: '{service} erlauben und laden',
      hide: 'Externe Inhalte entfernen',
      privacy: 'Datenschutzhinweise'
    },
    ru: {
      notice: 'Загрузка подключит {service}. Сервис получит ваш IP-адрес и технические данные, может использовать cookies и обрабатывать данные за пределами ЕЭЗ.',
      load: 'Разрешить и загрузить {service}',
      hide: 'Убрать внешнее содержимое',
      privacy: 'Об обработке данных'
    }
  };
  const activeBlocks = new Set();
  const language = () => Object.hasOwn(messages, document.documentElement.lang)
    ? document.documentElement.lang : 'en';
  const renderLabels = (state) => {
    const copy = messages[language()];
    state.notice.textContent = copy.notice.replace('{service}', state.container.dataset.externalService);
    state.button.textContent = state.iframe
      ? copy.hide : copy.load.replace('{service}', state.container.dataset.externalService);
    state.button.setAttribute('aria-expanded', String(Boolean(state.iframe)));
    state.privacyLink.textContent = copy.privacy;
    const prefix = language() === 'ru' ? '' : `/${language()}`;
    state.privacyLink.href = `https://deelstuff.com${prefix}/datenschutz/#${state.container.dataset.privacySection}`;
  };
  const initialize = (root = document) => {
    const containers = root.matches?.('[data-external-content]')
      ? [root] : root.querySelectorAll('[data-external-content]');
    for (const container of containers) {
      if (container.dataset.externalInitialized) continue;
      container.dataset.externalInitialized = 'true';
      container.dataset.i18nIgnore = '';
      const body = document.createElement('div');
      const notice = document.createElement('p');
      const controls = document.createElement('div');
      const button = document.createElement('button');
      const privacyLink = document.createElement('a');
      body.className = 'external-content-body';
      notice.className = 'external-content-notice';
      controls.className = 'external-content-controls';
      button.type = 'button';
      controls.append(button, privacyLink);
      body.append(notice);
      container.append(body, controls);
      const state = { container, body, notice, button, privacyLink, iframe: null };
      button.addEventListener('click', () => {
        if (state.iframe) {
          state.iframe.remove();
          state.iframe = null;
          notice.hidden = false;
        } else {
          const iframe = document.createElement('iframe');
          iframe.title = container.dataset.externalTitle;
          iframe.referrerPolicy = 'no-referrer';
          if (container.dataset.externalKind === 'video') {
            iframe.allowFullscreen = true;
            iframe.allow = 'encrypted-media; picture-in-picture; fullscreen';
          }
          iframe.src = container.dataset.externalSrc;
          notice.hidden = true;
          body.append(iframe);
          state.iframe = iframe;
        }
        renderLabels(state);
      });
      activeBlocks.add(state);
      renderLabels(state);
    }
  };
  window.SiteExternalContent = { initialize };
  initialize();
  new MutationObserver(() => {
    for (const state of activeBlocks) renderLabels(state);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
})();
