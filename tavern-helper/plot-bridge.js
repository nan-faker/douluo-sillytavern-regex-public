// @name         [助手]斗罗大陆 I-IV · Soul Land 角色创建世界书桥接器 @0.45
// @module       tavern-helper/plot-bridge
// @version      @0.45
// @source       tavern-helper-scripts/plot-bridge/dist/latest.json
"use strict";

/**
 * @name 斗罗Reborn 角色创建世界书桥接器
 * @description 监听角色创建前端的世界线选择，用酒馆助手世界书接口启用对应斗罗 Reborn 条目。
 * @version 0.1.7
 */
(function () {
  'use strict';

  const VERSION = '0.1.7';
  const REQUEST_EVENT = 'douluo-character-create:worldbook-sync';
  const RESULT_EVENT = 'douluo-character-create:worldbook-sync-result';
  const STORAGE_KEY = 'douluo_character_create_worldbook_bridge_last';
  const TARGET_BOOK_NAMES = ['斗罗大陆Reborn', '斗罗大陆Reborn.json'];
  const CLOSE_OTHER_ERAS = true;

  const ERAS = {
    dou1: { tag: '斗一', label: '斗一 / 斗罗大陆', aliases: ['斗一', '斗罗大陆', 'Dou1', 'DOU1'] },
    dou2: { tag: '斗二', label: '斗二 / 绝世唐门', aliases: ['斗二', '绝世唐门', '霍雨浩', '霍雨儿', '日月皇家', '魂导器', 'Dou2', 'DOU2'] },
    dou3: { tag: '斗三', label: '斗三 / 龙王传说', aliases: ['斗三', '龙王传说', '唐舞麟', '唐舞琳', '传灵塔', '斗铠', 'Dou3', 'DOU3'] },
    dou4: { tag: '斗四', label: '斗四 / 终极斗罗', aliases: ['斗四', '终极斗罗', '蓝轩宇', '蓝萱羽', '龙马', 'Dou4', 'DOU4'] },
  };

  const ENTRY_ERA_MARKERS = {
    dou1: [/斗\s*(一|1)/i, /dou\s*1/i],
    dou2: [/斗\s*(二|2)/i, /dou\s*2/i],
    dou3: [/斗\s*(三|3)/i, /dou\s*3/i],
    dou4: [/斗\s*(四|4)/i, /dou\s*4/i],
  };

  function hosts() {
    const list = [window];
    try { if (window.parent && window.parent !== window) list.push(window.parent); } catch (_) {}
    try { if (window.top && !list.includes(window.top)) list.push(window.top); } catch (_) {}
    return list;
  }

  function getGlobal(name) {
    for (const host of hosts()) {
      try { if (host && host[name] !== undefined && host[name] !== null) return host[name]; } catch (_) {}
    }
    return null;
  }

  function getContext() {
    for (const host of hosts()) {
      try {
        if (host.SillyTavern && typeof host.SillyTavern.getContext === 'function') return host.SillyTavern.getContext();
        if (typeof host.getContext === 'function') return host.getContext();
      } catch (_) {}
    }
    return null;
  }

  function requestHeaders() {
    const ctx = getContext();
    try { if (ctx && typeof ctx.getRequestHeaders === 'function') return ctx.getRequestHeaders(); } catch (_) {}
    const fn = getGlobal('getRequestHeaders');
    try { if (typeof fn === 'function') return fn(); } catch (_) {}
    return { 'Content-Type': 'application/json' };
  }

  async function postJson(path, body) {
    const fetcher = getGlobal('fetch') || (typeof fetch === 'function' ? fetch : null);
    if (typeof fetcher !== 'function') return null;
    const response = await fetcher(path, {
      method: 'POST',
      headers: requestHeaders(),
      body: JSON.stringify(body || {}),
      cache: 'no-cache',
    });
    if (!response || !response.ok) throw new Error(`${path} returned ${response ? response.status : 'no response'}`);
    return response.json();
  }

  function notify(type, message) {
    try {
      if (typeof toastr !== 'undefined' && toastr[type]) toastr[type](message);
      else console.log(`[斗罗世界书桥接器] ${message}`);
    } catch (_) {}
  }

  function normalizeName(name) {
    return String(name || '').replace(/\.json$/i, '').replace(/\s+/g, '').toLowerCase();
  }

  function bookNameVariants(name) {
    const rawOriginal = String(name || '');
    const raw = rawOriginal.trim();
    if (!raw && !rawOriginal) return [];
    const noJsonKeepSpace = rawOriginal.replace(/\.json$/i, '');
    const noJson = raw.replace(/\.json$/i, '').trim();
    const variants = [
      rawOriginal,
      raw,
      noJsonKeepSpace,
      noJson,
      `${noJson} `,
      `${noJson}.json`,
      `${noJson} .json`,
    ];
    const seen = new Set();
    return variants.filter(value => {
      if (!value) return false;
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/\s+/g, '')
      .replace(/[：:_\-—–·•|｜【】\[\]（）()《》<>]/g, '')
      .toLowerCase();
  }

  function unique(list) {
    return Array.from(new Set(list.map(v => String(v || '').trim()).filter(Boolean)));
  }

  function readManualBookNames() {
    const out = [];
    for (const host of hosts()) {
      try { pushBookName(out, host.DouluoWorldbookBridgeConfig && (host.DouluoWorldbookBridgeConfig.bookName || host.DouluoWorldbookBridgeConfig.worldbook)); } catch (_) {}
    }
    try { pushBookName(out, localStorage.getItem('douluo_worldbook_bridge_book_name')); } catch (_) {}
    try { pushBookName(out, localStorage.getItem('douluo_reborn_worldbook_name')); } catch (_) {}
    return unique(out);
  }

  function pushBookName(out, value) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(item => pushBookName(out, item));
      return;
    }
    if (typeof value === 'string') {
      out.push(value);
      return;
    }
    if (typeof value === 'object') {
      ['primary', 'name', 'bookName', 'filename', 'file_name', 'world', 'world_info', 'value', 'selected'].forEach(key => pushBookName(out, value[key]));
      pushBookName(out, value.additional);
      pushBookName(out, value.books);
      pushBookName(out, value.lorebooks);
    }
  }

  function normalizeEntries(raw) {
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.entries)) return raw.entries;
    if (raw && raw.entries && typeof raw.entries === 'object') return Object.values(raw.entries);
    if (raw && typeof raw === 'object') return Object.values(raw);
    return [];
  }

  function entryTitle(entry) {
    if (Array.isArray(entry)) return String(entry[1] || entry[0] || '').trim();
    return String(entry && (entry.comment || entry.name || entry.memo || entry.title || '') || '').trim();
  }

  function entryKeys(entry) {
    if (Array.isArray(entry)) return [entry[2], entry[3]].flat().filter(Boolean);
    return [entry && entry.key, entry && entry.keys, entry && entry.keysecondary, entry && entry.secondary_keys].flat().filter(Boolean);
  }

  function entryContent(entry) {
    if (Array.isArray(entry)) return String(entry[8] || entry[9] || entry[entry.length - 1] || '');
    return String(entry && entry.content || '');
  }

  function entryText(entry) {
    return [entryTitle(entry), entryKeys(entry).join('\n'), entryContent(entry)].filter(Boolean).join('\n');
  }

  function entryRouteText(entry) {
    return [entryTitle(entry), entryKeys(entry).join('\n')].filter(Boolean).join('\n');
  }

  function entryEnabled(entry) {
    if (Array.isArray(entry)) return true;
    if (typeof (entry && entry.enabled) === 'boolean') return entry.enabled;
    if (typeof (entry && entry.disable) === 'boolean') return !entry.disable;
    if (typeof (entry && entry.disabled) === 'boolean') return !entry.disabled;
    return false;
  }

  function setEntryEnabled(entry, enabled) {
    if (Array.isArray(entry)) return entry;
    const next = Object.assign({}, entry, { enabled: !!enabled, disable: !enabled });
    if ('disabled' in next) next.disabled = !enabled;
    if (entry && entry.extensions && typeof entry.extensions === 'object') next.extensions = Object.assign({}, entry.extensions);
    return next;
  }

  function detectEraIdFromExplicitText(value) {
    const text = String(value || '').normalize('NFKC').slice(0, 120);
    return Object.keys(ENTRY_ERA_MARKERS).find(eraId => ENTRY_ERA_MARKERS[eraId].some(pattern => pattern.test(text))) || '';
  }

  function detectEraIdFromTitle(title) {
    return detectEraIdFromExplicitText(title);
  }

  function detectEraIdFromKeys(entry) {
    for (const key of entryKeys(entry)) {
      const found = detectEraIdFromExplicitText(key);
      if (found) return found;
    }
    return '';
  }

  function detectEntryEraId(entry) {
    const explicit = detectEraIdFromTitle(entryTitle(entry));
    if (explicit) return explicit;
    return detectEraIdFromKeys(entry);
  }

  function routeMatchesEntry(entry, eraId) {
    return detectEntryEraId(entry) === eraId;
  }

  function entryHasAnyEra(entry) {
    return !!detectEntryEraId(entry);
  }

  async function tryReadBook(bookName) {
    if (!bookName) return null;
    const getWorldbook = getGlobal('getWorldbook');
    const ctx = getContext();
    for (const candidate of bookNameVariants(bookName)) {
      if (typeof getWorldbook === 'function') {
        try {
          const raw = await getWorldbook(candidate);
          const entries = normalizeEntries(raw);
          if (entries.length) return { bookName: candidate, requestedName: bookName, raw, entries, source: 'getWorldbook' };
        } catch (_) {}
      }
      if (ctx && typeof ctx.loadWorldInfo === 'function') {
        try {
          const raw = await ctx.loadWorldInfo(candidate);
          const entries = normalizeEntries(raw);
          if (entries.length) return { bookName: candidate, requestedName: bookName, raw, entries, source: 'loadWorldInfo' };
        } catch (_) {}
      }
      try {
        const raw = await postJson('/api/worldinfo/get', { name: candidate });
        const entries = normalizeEntries(raw);
        if (entries.length) return { bookName: candidate, requestedName: bookName, raw, entries, source: 'worldinfo/get' };
      } catch (_) {}
    }
    return null;
  }

  async function currentCharacterBooks() {
    const out = [];
    const getCharWorldbookNames = getGlobal('getCharWorldbookNames');
    try {
      if (typeof getCharWorldbookNames === 'function') pushBookName(out, await getCharWorldbookNames('current'));
    } catch (_) {}
    return unique(out);
  }

  async function listedWorldbooks() {
    const out = [];
    for (const name of ['getWorldbookNames', 'getWorldbooks', 'listWorldbooks']) {
      const fn = getGlobal(name);
      try { if (typeof fn === 'function') pushBookName(out, await fn()); } catch (_) {}
    }
    const ctx = getContext();
    try { if (ctx && typeof ctx.getWorldInfoNames === 'function') pushBookName(out, await ctx.getWorldInfoNames()); } catch (_) {}
    try { if (ctx && typeof ctx.getWorldBooks === 'function') pushBookName(out, await ctx.getWorldBooks()); } catch (_) {}
    try { pushBookName(out, ctx && ctx.world_names); } catch (_) {}
    try { pushBookName(out, ctx && ctx.worldInfo); } catch (_) {}
    try { pushBookName(out, ctx && ctx.world_info); } catch (_) {}
    try {
      const settings = await postJson('/api/settings/get', {});
      pushBookName(out, settings && settings.world_names);
    } catch (_) {}
    return unique(out);
  }

  async function candidateBookNames(options = {}) {
    const explicit = options.bookName || options.worldbook || options.lorebook;
    const charBooks = await currentCharacterBooks();
    const all = await listedWorldbooks();
    const reborn = all.filter(name => normalizeName(name).includes('斗罗reborn') || normalizeName(name).includes('reborn'));
    return unique([explicit].concat(readManualBookNames(), charBooks, TARGET_BOOK_NAMES, all.filter(name => TARGET_BOOK_NAMES.some(target => normalizeName(target) === normalizeName(name))), reborn));
  }

  async function resolveTargetBookName(options = {}) {
    const explicit = options.bookName || options.worldbook || options.lorebook;
    if (explicit) {
      const loaded = await tryReadBook(explicit);
      if (loaded) return loaded.bookName;
    }

    const charBooks = await currentCharacterBooks();
    for (const name of charBooks) {
      const loaded = await tryReadBook(name);
      if (loaded && loaded.entries.some(entryHasAnyEra)) return loaded.bookName;
    }

    const all = unique(charBooks.concat(await listedWorldbooks()));
    const exact = all.filter(name => TARGET_BOOK_NAMES.some(target => normalizeName(target) === normalizeName(name)));
    for (const name of exact) {
      const loaded = await tryReadBook(name);
      if (loaded) return loaded.bookName;
    }

    for (const target of TARGET_BOOK_NAMES) {
      const loaded = await tryReadBook(target);
      if (loaded) return loaded.bookName;
    }

    const reborn = all.filter(name => normalizeName(name).includes('斗罗reborn') || normalizeName(name).includes('reborn'));
    for (const name of reborn) {
      const loaded = await tryReadBook(name);
      if (loaded) return loaded.bookName;
    }

    return '';
  }

  function diagnostics(candidates = []) {
    const ctx = getContext();
    const apiNames = [
      'getWorldbook',
      'updateWorldbookWith',
      'getCharWorldbookNames',
      'getWorldbookNames',
      'getWorldbooks',
      'listWorldbooks',
    ];
    const apis = apiNames.map(name => `${name}:${typeof getGlobal(name) === 'function' ? 'Y' : 'N'}`).join(' ');
    const ctxInfo = `ctx:${ctx ? 'Y' : 'N'} loadWorldInfo:${ctx && typeof ctx.loadWorldInfo === 'function' ? 'Y' : 'N'} getWorldBooks:${ctx && typeof ctx.getWorldBooks === 'function' ? 'Y' : 'N'}`;
    return `${apis} ${ctxInfo} candidates:${candidates.slice(0, 8).join(' / ') || '空'}`;
  }

  function normalizeEraId(value) {
    const raw = String(value || '').trim();
    if (ERAS[raw]) return raw;
    const text = normalizeText(raw);
    return Object.keys(ERAS).find(eraId => [eraId, ERAS[eraId].tag, ERAS[eraId].label].concat(ERAS[eraId].aliases).some(alias => text.includes(normalizeText(alias)))) || '';
  }

  async function scan(options = {}) {
    const candidates = await candidateBookNames(options);
    const bookName = await resolveTargetBookName(options);
    if (!bookName) return { success: false, status: 'missing-book', diagnostics: diagnostics(candidates), message: `未找到角色卡绑定世界书或斗罗大陆Reborn。${diagnostics(candidates)}` };
    const loaded = await tryReadBook(bookName);
    if (!loaded) return { success: false, status: 'read-failed', bookName, message: `无法读取世界书「${bookName}」。` };
    const counts = {};
    Object.keys(ERAS).forEach(eraId => {
      counts[eraId] = loaded.entries.filter(entry => routeMatchesEntry(entry, eraId)).length;
    });
    return { success: true, bookName, total: loaded.entries.length, counts };
  }

  async function syncEra(options = {}) {
    const updateWorldbookWith = getGlobal('updateWorldbookWith');
    if (typeof updateWorldbookWith !== 'function') {
      return { success: false, status: 'missing-api', message: '未检测到 updateWorldbookWith，请确认酒馆助手脚本环境已启用。' };
    }

    const eraId = normalizeEraId(options.eraId || options.era || options.tag);
    if (!ERAS[eraId]) return { success: false, status: 'bad-era', message: '未收到有效世界线。' };

    const candidates = await candidateBookNames(options);
    const bookName = await resolveTargetBookName(options);
    if (!bookName) return { success: false, status: 'missing-book', eraId, diagnostics: diagnostics(candidates), message: `未找到角色卡绑定世界书或斗罗大陆Reborn。${diagnostics(candidates)}` };

    const loaded = await tryReadBook(bookName);
    if (!loaded) return { success: false, status: 'read-failed', eraId, bookName, message: `无法读取世界书「${bookName}」。` };

    let matched = 0;
    let changed = 0;
    let otherTouched = 0;

    await updateWorldbookWith(bookName, entries => normalizeEntries(entries).map(entry => {
      if (routeMatchesEntry(entry, eraId)) {
        matched += 1;
        if (!entryEnabled(entry)) {
          changed += 1;
          return setEntryEnabled(entry, true);
        }
        return entry;
      }
      if (CLOSE_OTHER_ERAS && entryHasAnyEra(entry)) {
        otherTouched += 1;
        return setEntryEnabled(entry, false);
      }
      return entry;
    }), { render: 'immediate' });

    const era = ERAS[eraId];
    const result = matched > 0
      ? { success: true, status: 'ok', eraId, tag: era.tag, bookName, matched, changed, otherTouched, message: `已打开「${bookName}」中 ${matched} 条 ${era.tag} 条目，关闭 ${otherTouched} 条其它年代条目；通用条目不动。` }
      : { success: false, status: 'no-match', eraId, tag: era.tag, bookName, matched, changed, message: `已找到「${bookName}」，但未发现 ${era.tag} 条目。` };

    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ eraId, bookName, time: Date.now(), result })); } catch (_) {}
    notify(result.success ? 'success' : 'warning', result.message);
    return result;
  }

  function dispatchResult(host, requestId, result) {
    try {
      const EventCtor = host.CustomEvent || CustomEvent;
      host.dispatchEvent(new EventCtor(RESULT_EVENT, { detail: Object.assign({ requestId, bridgeVersion: VERSION }, result) }));
    } catch (_) {}
  }

  async function handleRequest(event) {
    const detail = event && event.detail || {};
    const requestId = detail.requestId || `wb-${Date.now()}`;
    const result = await syncEra(detail);
    for (const host of hosts()) dispatchResult(host, requestId, result);
  }

  const api = {
    version: VERSION,
    requestEvent: REQUEST_EVENT,
    resultEvent: RESULT_EVENT,
    scan,
    syncEra,
    setBookName(name) {
      try { localStorage.setItem('douluo_worldbook_bridge_book_name', String(name || '').trim()); } catch (_) {}
    },
    clearBookName() {
      try { localStorage.removeItem('douluo_worldbook_bridge_book_name'); } catch (_) {}
    },
  };

  for (const host of hosts()) {
    try {
      host.DouluoWorldbookBridge = api;
      host.removeEventListener(REQUEST_EVENT, handleRequest);
      host.addEventListener(REQUEST_EVENT, handleRequest);
    } catch (_) {}
  }

  console.log(`[斗罗Reborn 角色创建世界书桥接器 v${VERSION}] 已启用`);
})();
