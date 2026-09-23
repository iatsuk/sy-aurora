(() => {
  const supportedLanguages = ['en', 'de', 'ru'];
  const storageKey = 'aurora-language';
  const languageNames = { en: 'English', de: 'Deutsch', ru: 'Русский' };
  const translationFiles = {
    de: ['i18n-de.js?v=20260923-2'],
    ru: ['i18n-ru.js?v=20260923-2']
  };

  const normalizeLanguage = (value) => {
    const primary = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
    return supportedLanguages.includes(primary) ? primary : null;
  };

  const readStoredLanguage = () => {
    try {
      return normalizeLanguage(window.localStorage.getItem(storageKey));
    } catch {
      return null;
    }
  };

  const storeLanguage = (language) => {
    try {
      window.localStorage.setItem(storageKey, language);
    } catch {
      // Language switching still works if browser storage is unavailable.
    }
  };

  const detectLanguage = () => {
    const requested = normalizeLanguage(new URLSearchParams(window.location.search).get('lang'));
    if (requested) {
      storeLanguage(requested);
      return requested;
    }

    const stored = readStoredLanguage();
    if (stored) return stored;

    const browserLanguages = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language];

    for (const candidate of browserLanguages) {
      const language = normalizeLanguage(candidate);
      if (language) return language;
    }

    return 'en';
  };

  const language = detectLanguage();
  let dictionary = {};
  const originalText = new WeakMap();
  const originalAttributes = new WeakMap();
  let translating = false;

  document.documentElement.lang = language;
  document.documentElement.dataset.language = language;

  const locale = language === 'de' ? 'de-DE' : language === 'ru' ? 'ru-RU' : 'en-GB';

  const loadScript = (src) => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(script);
  });

  const loadDictionary = async () => {
    if (language === 'en') return {};
    await Promise.all((translationFiles[language] || []).map(loadScript));
    return language === 'de'
      ? window.AURORA_TRANSLATIONS_DE || {}
      : window.AURORA_TRANSLATIONS_RU || {};
  };

  const escapeRegExp = (value) => value.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');

  const pluralPassage = (count) => {
    if (language === 'de') return count === 1 ? 'Passage' : 'Passagen';
    if (language === 'ru') {
      const mod10 = count % 10;
      const mod100 = count % 100;
      if (mod10 === 1 && mod100 !== 11) return 'переход';
      if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'перехода';
      return 'переходов';
    }
    return count === 1 ? 'passage' : 'passages';
  };

  const translateGalleryPhrase = (source) => {
    const categories = [
      'Overview',
      'Underway',
      'Deck and cockpit',
      'Rig and sails',
      'Interior',
      'Storage and service spaces',
      'Machinery and systems',
      'Hull and underwater'
    ];

    for (const english of categories) {
      const translated = dictionary[english];
      if (!translated) continue;
      const match = source.match(new RegExp(`^${escapeRegExp(english)}(?: (\\d+))?$`));
      if (match) return `${translated}${match[1] ? ` ${match[1]}` : ''}`;
    }

    return null;
  };

  const translateValue = (source) => {
    if (language === 'en' || !source) return source;
    if (Object.prototype.hasOwnProperty.call(dictionary, source)) return dictionary[source];

    const galleryPhrase = translateGalleryPhrase(source);
    if (galleryPhrase) return galleryPhrase;

    const altMatch = source.match(/^Aurora — (.+)$/);
    if (altMatch) return `Aurora — ${translateValue(altMatch[1])}`;

    const passageTitle = source.match(/^Aurora Delivery\. Passage (\d+)$/);
    if (passageTitle) {
      return language === 'de'
        ? `Aurora Überführung · Passage ${passageTitle[1]}`
        : `Перегон Aurora · переход ${passageTitle[1]}`;
    }

    const voyageNumber = source.match(/^Voyage (\d+)$/);
    if (voyageNumber) {
      return language === 'de'
        ? `Reise ${voyageNumber[1]}`
        : `Путешествие ${voyageNumber[1]}`;
    }

    const passageNumber = source.match(/^Passage (\d+)$/);
    if (passageNumber) {
      return language === 'de'
        ? `Passage ${passageNumber[1]}`
        : `Переход ${passageNumber[1]}`;
    }

    const yearPassages = source.match(/^(\d{4}) · (\d+) passages?$/);
    if (yearPassages) {
      const count = Number(yearPassages[2]);
      return `${yearPassages[1]} · ${count} ${pluralPassage(count)}`;
    }

    const titledPassages = source.match(/^(.+) · (\d+) passages?$/);
    if (titledPassages) {
      const count = Number(titledPassages[2]);
      return `${translateValue(titledPassages[1])} · ${count} ${pluralPassage(count)}`;
    }

    const yearVoyages = source.match(/^(\d{4}) voyages$/);
    if (yearVoyages) {
      return language === 'de'
        ? `${yearVoyages[1]} Reisen`
        : `Путешествия ${yearVoyages[1]} года`;
    }

    const openMatch = source.match(/^Open (.+)$/);
    if (openMatch) {
      return language === 'de'
        ? `${translateValue(openMatch[1])} öffnen`
        : `Открыть: ${translateValue(openMatch[1])}`;
    }

    const exportMatch = source.match(/^Export or share an image for (.+)$/);
    if (exportMatch) {
      return language === 'de'
        ? `Bild für ${translateValue(exportMatch[1])} exportieren oder teilen`
        : `Экспортировать или поделиться изображением: ${translateValue(exportMatch[1])}`;
    }

    return source;
  };

  const translateTextNode = (node) => {
    if (!node.parentElement || node.parentElement.closest('script, style, noscript, [data-i18n-ignore]')) return;
    if (!originalText.has(node)) originalText.set(node, node.nodeValue || '');

    const source = originalText.get(node);
    const match = source.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const translated = `${match[1]}${translateValue(match[2])}${match[3]}`;
    if (node.nodeValue !== translated) node.nodeValue = translated;
  };

  const translatableAttributes = ['placeholder', 'aria-label', 'title', 'alt', 'label'];

  const translateAttributes = (element) => {
    if (element.closest('[data-i18n-ignore]')) return;

    let originals = originalAttributes.get(element);
    if (!originals) {
      originals = new Map();
      originalAttributes.set(element, originals);
    }

    translatableAttributes.forEach((attribute) => {
      if (!element.hasAttribute(attribute)) return;
      if (!originals.has(attribute)) originals.set(attribute, element.getAttribute(attribute));
      const translated = translateValue(originals.get(attribute));
      if (element.getAttribute(attribute) !== translated) element.setAttribute(attribute, translated);
    });
  };

  const translateTree = (root) => {
    if (!root || translating) return;
    translating = true;

    try {
      if (root.nodeType === Node.TEXT_NODE) {
        translateTextNode(root);
        return;
      }

      if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;

      if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
      (root.querySelectorAll?.('*') || []).forEach(translateAttributes);

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        translateTextNode(node);
        node = walker.nextNode();
      }
    } finally {
      translating = false;
    }
  };

  const languageUrl = (code) => {
    const url = new URL('https://sy-aurora.de/');
    url.searchParams.set('lang', code);
    return url.toString();
  };

  const updateDocumentMetadata = () => {
    const voyageCardPage = Boolean(document.querySelector('[data-card]'));
    document.title = translateValue(voyageCardPage
      ? 'Aurora voyage image'
      : 'S/Y Aurora · Great Dane 28 · Hull 165');

    const description = document.querySelector('meta[name="description"]');
    if (description && !voyageCardPage) {
      description.content = translateValue('S/Y Aurora, Great Dane 28 hull 165. Live position, voyages, refit history, gallery, technical data and the story behind the design.');
    }

    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.href = languageUrl(language);
  };

  const createLanguageSelector = () => {
    const header = document.querySelector('[data-header]') || document.querySelector('.export-toolbar');
    const menuButton = document.querySelector('[data-menu-button]');
    if (!header || document.querySelector('[data-language-switcher]')) return;

    const wrapper = document.createElement('label');
    const visibleLabel = document.createElement('span');
    const select = document.createElement('select');

    wrapper.className = 'language-switcher';
    wrapper.dataset.languageSwitcher = '';
    wrapper.dataset.i18nIgnore = '';
    visibleLabel.className = 'visually-hidden';
    visibleLabel.textContent = language === 'de' ? 'Sprache' : language === 'ru' ? 'Язык' : 'Language';
    select.setAttribute('aria-label', visibleLabel.textContent);

    supportedLanguages.forEach((code) => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = `${code.toUpperCase()} · ${languageNames[code]}`;
      option.selected = code === language;
      select.append(option);
    });

    select.addEventListener('change', () => {
      const selected = normalizeLanguage(select.value) || 'en';
      storeLanguage(selected);
      const url = new URL(window.location.href);
      url.searchParams.set('lang', selected);
      window.location.assign(url.toString());
    });

    wrapper.append(visibleLabel, select);
    const insertionTarget = menuButton || header.querySelector('[data-download]') || header.querySelector('[data-nav]');
    header.insertBefore(wrapper, insertionTarget);
  };

  const ready = loadDictionary()
    .then((loadedDictionary) => {
      dictionary = loadedDictionary;
      updateDocumentMetadata();
      createLanguageSelector();
      translateTree(document.documentElement);

      const observer = new MutationObserver((records) => {
        if (translating) return;
        records.forEach((record) => {
          if (record.type === 'characterData') translateTree(record.target);
          record.addedNodes?.forEach(translateTree);
          if (record.type === 'attributes') translateTree(record.target);
        });
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: translatableAttributes
      });
    })
    .catch((error) => {
      console.error('Aurora translations could not be loaded.', error);
      createLanguageSelector();
    });

  window.AURORA_I18N = {
    language,
    locale,
    ready,
    translate: translateValue
  };
})();
