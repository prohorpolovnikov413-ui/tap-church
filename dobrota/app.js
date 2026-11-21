(() => {
  const API = 'https://zavhoz-board.sj-polomki.workers.dev';
  const STORE = 'dobrota-user-v1';
  const COOKIE = 'dobrota_uid';
  const IDB_NAME = 'dobrota-db';
  const IDB_STORE = 'session';
  const RULES_SEEN = 'dobrota-rules-seen-v1';
  const LIKES_STORE = 'dobrota-likes-v1';
  const FRIENDS_STORE = 'dobrota-friends-v1';
  const CATS = [
    { id: 'help', label: 'Помощь', points: 15, icon: 'help' },
    { id: 'family', label: 'Семья', points: 15, icon: 'family' },
    { id: 'care', label: 'Забота', points: 15, icon: 'care' },
    { id: 'home', label: 'Дом', points: 15, icon: 'home' },
    { id: 'street', label: 'Улица', points: 15, icon: 'street' },
    { id: 'animals', label: 'Животные', points: 15, icon: 'animals' },
    { id: 'nature', label: 'Природа', points: 15, icon: 'nature' },
    { id: 'gift', label: 'Подарок', points: 10, icon: 'gift' },
    { id: 'time', label: 'Время', points: 20, icon: 'time' },
    { id: 'other', label: 'Другое', points: 10, icon: 'other' }
  ];
  // Old category ids → new (display + submit normalize)
  const CAT_ALIASES = { smile: 'gift', big: 'help', volunteer: 'time' };
  const LABELS = Object.fromEntries(CATS.map((c) => [c.id, c.label]));
  LABELS.smile = 'Подарок';
  LABELS.big = 'Помощь';
  LABELS.volunteer = 'Время';
  function normalizeCat(id) {
    const raw = String(id || '');
    const mapped = CAT_ALIASES[raw] || raw;
    return CATS.some((c) => c.id === mapped) ? mapped : 'other';
  }
  function catMeta(id) {
    const nid = normalizeCat(id);
    return CATS.find((c) => c.id === nid) || CATS[CATS.length - 1];
  }
  function catIconSvg(name) {
    const paths = {
      help: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M6.2 6.2l2.1 2.1M15.7 15.7l2.1 2.1M17.8 6.2l-2.1 2.1M8.3 15.7l-2.1 2.1"/><circle cx="12" cy="12" r="3.2"/>',
      family: '<circle cx="9" cy="9" r="2.4"/><circle cx="15" cy="9" r="2.4"/><path d="M4.5 19c.6-3 2.8-4.5 5.5-4.5S15 16 15.5 19M13 14.5c1.4-.4 3-.2 4.5 1.2.6.6 1 1.5 1.2 2.3"/>',
      care: '<path d="M12 20s-7-4.4-9.2-8.2C1.2 9.2 2.8 6 6 6c1.8 0 3.1 1 3.9 2.1C10.7 7 12 6 13.8 6c3.2 0 4.8 3.2 3.2 5.8C19 15.6 12 20 12 20z"/>',
      home: '<path d="M4 11.5 12 5l8 6.5V20H4v-8.5z"/><path d="M10 20v-6h4v6"/>',
      street: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-5h6v5M12 4v5"/>',
      animals: '<circle cx="9" cy="13" r="3.2"/><circle cx="16.5" cy="11.5" r="2.4"/><path d="M6.2 9.2 4.8 6.8M11.8 9.2l1.2-2.4M14.6 8.4l-.2-2.6M18.8 9l1.4-2.2"/>',
      nature: '<path d="M12 20V10"/><path d="M12 14c-3.5 0-6-2.2-6-5 3.2 0 6 2 6 5z"/><path d="M12 16c3.2 0 6-2.2 6-5-3 0-6 2-6 5z"/><path d="M8 20h8"/>',
      gift: '<path d="M5 10h14v10H5V10z"/><path d="M12 10v10M5 14h14"/><path d="M12 10c-2.2 0-3.5-1.6-3.5-3S10 5 12 7c2-2 3.5-.6 3.5 0S14.2 10 12 10z"/>',
      time: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5.5l3.2 2"/>',
      other: '<circle cx="7" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="17" cy="12" r="1.4"/>'
    };
    return `<svg class="cat-ico" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.other}</svg>`;
  }
  const DAILY_IDEAS = [
    'Помоги соседу с сумками', 'Позвони близкому человеку', 'Оставь добрую записку незнакомцу',
    'Уступи место в транспорте', 'Покорми бездомное животное', 'Подари улыбку кассиру',
    'Помоги кому-то с дорогой', 'Собери мусор во дворе', 'Напиши благодарность учителю',
    'Приготовь чай для родных', 'Поделись едой с нуждающимся', 'Выслушай друга без советов',
    'Помоги ребёнку завязать шнурки', 'Открой дверь пожилому человеку', 'Подари книгу соседу',
    'Напиши тёплое сообщение', 'Помоги с тяжёлой коробкой', 'Посади или полей растение',
    'Сделай комплимент коллеге', 'Убери общий подъезд', 'Отдай ненужные вещи нуждающимся',
    'Купи воду тому, кто просит', 'Помоги с коляской у лестницы', 'Нарисуй открытку для друга',
    'Проверь, всё ли хорошо у соседа', 'Помоги с уроками младшим', 'Заплати за чей-то кофе',
    'Поделись зонтом в дождь', 'Похвали работу курьера', 'Сфотографируй красивый момент для близких',
    'Помоги найти потерянную вещь', 'Принеси печенье коллегам', 'Поддержи человека в очереди',
    'Напиши письмо благодарности', 'Помоги с чемоданом', 'Подари цветок без повода',
    'Выслушай жалобу спокойно', 'Помоги перейти дорогу', 'Сделай зарядку вместе с другом',
    'Поделись музыкой, которая радует', 'Уступи очередь тому, кто спешит', 'Помоги с настройкой телефона',
    'Принеси воду мастеру', 'Скажи «спасибо» водителю', 'Помоги найти адрес',
    'Подари домашнюю выпечку', 'Помоги собрать разбросанные вещи', 'Напиши доброе ревью местному делу',
    'Поддержи начинающего', 'Помоги с пересадкой цветов', 'Сделай минуту тишины для уставшего',
    'Поделись тёплыми перчатками', 'Помоги донести коляску', 'Сфотографируй питомца для хозяина',
    'Нарисуй мелом добрый рисунок', 'Подари наклейку ребёнку', 'Помоги с выбором в магазине',
    'Отправь стикер «ты молодец»', 'Помоги соседу завести машину', 'Сделай сюрприз без повода'
  ];
  const LEVELS = [
    { min: 0, name: 'Помощник', hint: '' },
    { min: 3, name: 'Сосед', hint: '' },
    { min: 7, name: 'Свет', hint: '' },
    { min: 15, name: 'Опора', hint: '' },
    { min: 30, name: 'Маяк', hint: '' },
    { min: 50, name: 'Сердце', hint: '' }
  ];
  const BADGES = [
    { id: 'first', name: 'Первое', need: 1, desc: '' },
    { id: 'streak3', name: 'Искра', needStreak: 3, desc: '' },
    { id: 'streak7', name: 'Неделя', needStreak: 7, desc: '' },
    { id: 'streak30', name: 'Месяц', needStreak: 30, desc: '' },
    { id: 'ten', name: 'Десятка', need: 10, desc: '' },
    { id: 'photo5', name: 'В кадре', needPhotos: 5, desc: '' }
  ];

  const $ = (id) => document.getElementById(id);
  const gate = $('gate'), app = $('app');
  let user = null, photo = null, category = 'help', busy = false, prevTab = 'feed';
  category = normalizeCat(category);
  let hasPin = false, pendingSync = '';
  let lastState = null, feedFilter = 'all', reducedMotion = false;
  try { reducedMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch {}

  function randId() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  function validLocalUser(u) {
    return !!(u && typeof u.id === 'string' && u.id.length >= 8 && typeof u.name === 'string' && u.name.trim().length >= 2);
  }
  function readCookie(name) {
    try {
      const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&') + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : '';
    } catch { return ''; }
  }
  function writeCookie(name, value) {
    try {
      const maxAge = 60 * 60 * 24 * 400;
      document.cookie = name + '=' + encodeURIComponent(value) + '; path=/; max-age=' + maxAge + '; SameSite=Lax';
    } catch {}
  }
  function openIdb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no idb'));
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('idb'));
    });
  }
  async function idbGet() {
    try {
      const db = await openIdb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get('user');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch { return null; }
  }
  async function idbPut(u) {
    try {
      const db = await openIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(u, 'user');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {}
  }
  function loadUserSync() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const u = JSON.parse(raw);
        if (validLocalUser(u)) return { id: u.id, name: String(u.name).trim() };
      }
    } catch {}
    try {
      const c = readCookie(COOKIE);
      if (c) {
        const u = JSON.parse(c);
        if (validLocalUser(u)) return { id: u.id, name: String(u.name).trim() };
      }
    } catch {}
    return null;
  }
  async function loadUserDurable() {
    let u = loadUserSync();
    if (validLocalUser(u)) return u;
    const fromIdb = await idbGet();
    if (validLocalUser(fromIdb)) {
      return { id: fromIdb.id, name: String(fromIdb.name).trim() };
    }
    return null;
  }
  async function saveUser(u) {
    if (!validLocalUser(u)) return;
    user = { id: u.id, name: String(u.name).trim() };
    const payload = JSON.stringify(user);
    try { localStorage.setItem(STORE, payload); } catch {}
    writeCookie(COOKIE, payload);
    await idbPut(user);
  }
  function deedsWord(count) {
    const n = Math.abs(count) % 100, n1 = n % 10;
    if (n > 10 && n < 20) return 'дел';
    if (n1 === 1) return 'дело';
    if (n1 >= 2 && n1 <= 4) return 'дела';
    return 'дел';
  }
  function moscowDayKey(iso) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(iso ? new Date(iso) : new Date());
    } catch {
      const d = iso ? new Date(iso) : new Date();
      return d.toISOString().slice(0, 10);
    }
  }
  function dailyIdea() {
    const key = moscowDayKey();
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return DAILY_IDEAS[h % DAILY_IDEAS.length];
  }
  function levelFor(count) {
    let cur = LEVELS[0];
    for (const lv of LEVELS) if ((count || 0) >= lv.min) cur = lv;
    return cur;
  }
  function calcStreak(deeds) {
    const days = new Set();
    (deeds || []).forEach((d) => {
      if ((d.status || 'approved') === 'approved' && d.createdAt) days.add(moscowDayKey(d.createdAt));
    });
    if (!days.size) return 0;
    const today = moscowDayKey();
    const parts = today.split('-').map(Number);
    const todayUtc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    const yesterday = moscowDayKey(new Date(todayUtc - 86400000));
    if (!days.has(today) && !days.has(yesterday)) return 0;
    let s = 0;
    let cursor = days.has(today) ? todayUtc : todayUtc - 86400000;
    while (days.has(moscowDayKey(new Date(cursor)))) {
      s++;
      cursor -= 86400000;
    }
    return s;
  }
  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch { return fallback; }
  }
  function saveJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }
  function likesMap() { return loadJson(LIKES_STORE, {}); }
  function friendsSet() { return new Set(loadJson(FRIENDS_STORE, [])); }
  function toggleLike(feedId, authorKey) {
    const likes = likesMap();
    const on = !likes[feedId];
    if (on) likes[feedId] = true; else delete likes[feedId];
    saveJson(LIKES_STORE, likes);
    if (authorKey && authorKey !== (user && user.id) && authorKey !== (user && user.name)) {
      const fr = friendsSet();
      if (on) fr.add(authorKey); else {
        // keep friend once liked anyone from them historically — only remove if no likes left for them
      }
      if (on) { fr.add(String(authorKey)); saveJson(FRIENDS_STORE, [...fr]); }
    }
    return on;
  }
  function prefersReduced() { return reducedMotion; }
  function burstConfetti() {
    if (prefersReduced()) return;
    const layer = $('fx-layer');
    if (!layer) return;
    const colors = ['#ffba0d', '#ff8c42', '#ffc857', '#1ec9b5', '#ff5c7a', '#f2f2f0'];
    for (let i = 0; i < 36; i++) {
      const el = document.createElement('span');
      el.className = 'confetti-piece';
      el.style.left = (Math.random() * 100) + '%';
      el.style.background = colors[i % colors.length];
      el.style.animationDelay = (Math.random() * 0.25) + 's';
      el.style.transform = 'rotate(' + (Math.random() * 180) + 'deg)';
      layer.appendChild(el);
      setTimeout(() => el.remove(), 1400);
    }
  }
  function floatHeartAt(x, y) {
    if (prefersReduced()) return;
    const layer = $('fx-layer');
    if (!layer) return;
    const el = document.createElement('span');
    el.className = 'float-heart';
    el.textContent = '💛';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }
  function renderDaily() {
    const idea = dailyIdea();
    const title = $('daily-title');
    if (title) title.textContent = idea;
    const btn = $('btn-daily');
    if (btn) {
      btn.onclick = () => {
        $('title').value = idea;
        setTab('add');
        // One-tap camera prompt after short delay
        setTimeout(() => { try { $('cam').click(); } catch {} }, 280);
      };
    }
  }
  function formatDate(iso) {
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow'
    }).format(new Date(iso));
  }
  function show(el, text, on, kind) {
    if (!el) return;
    if (!on) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = text;
    el.classList.remove('hidden');
    if (el.id === 'flash') {
      el.classList.toggle('ok', kind !== 'err');
      el.classList.toggle('err', kind === 'err');
    }
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function compressImage(file) {
    if (!file.type.startsWith('image/')) throw new Error('Выберите файл изображения');
    if (file.size > 12 * 1024 * 1024) throw new Error('Файл больше 12 МБ');
    const img = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать фото')); };
      im.src = url;
    });
    const max = 720;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const limit = 60 * 1024;
    let q = 0.7, blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
    while (blob && blob.size > limit && q > 0.35) {
      q -= 0.08;
      blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
    }
    if (!blob || blob.size > limit) {
      const shrink = Math.sqrt(limit / Math.max(blob ? blob.size : limit * 2, 1));
      canvas.width = Math.max(1, Math.round(canvas.width * Math.min(0.8, shrink)));
      canvas.height = Math.max(1, Math.round(canvas.height * Math.min(0.8, shrink)));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      q = 0.5;
      blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
      while (blob && blob.size > limit && q > 0.28) {
        q -= 0.06;
        blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
      }
    }
    if (!blob || blob.size > limit) throw new Error('Фото всё ещё слишком большое — попробуйте другое');
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('Не удалось обработать фото'));
      fr.readAsDataURL(blob);
    });
  }

  async function api(path, opt) {
    const res = await fetch(API + path, opt);
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = (data && (data.errorText || data.error)) || 'Ошибка сервера';
      const map = {
        quota: 'Сервер сегодня перегружен, попробуйте позже',
        nick: 'Имя: 2–40 букв или цифр, без грубых слов',
        title: 'Опишите дело чуть подробнее',
        category: 'Выберите категорию',
        photo: 'Фото слишком большое или в неверном формате',
        rate: 'Подождите несколько секунд и попробуйте ещё раз',
        id: 'Не удалось определить аккаунт'
      };
      throw new Error(data && data.errorText ? data.errorText : (map[err] || err));
    }
    return data;
  }

  function renderCats() {
    const box = $('cats');
    box.innerHTML = '<legend class="lbl">Тип</legend><div class="cat-grid">' + CATS.map((c) => `
      <label class="cat${c.id === category ? ' on' : ''}">
        <input type="radio" name="category" value="${c.id}" ${c.id === category ? 'checked' : ''}>
        <span class="cat-main">${catIconSvg(c.icon)}<span class="cat-label">${esc(c.label)}</span></span>
        <span class="pts">+${c.points}</span>
      </label>`).join('') + '</div>';
    box.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('change', () => {
        category = normalizeCat(inp.value);
        renderCats();
        updateAddLabel();
      });
    });
  }
  function updateAddLabel() {
    const c = catMeta(category);
    $('btn-add').textContent = busy ? '…' : `Добавить · +${c.points}`;
  }

  function isRecoverableDeed(d) {
    if (!d) return false;
    if (d.status === 'error') return true;
    if (d.status !== 'rejected') return false;
    return /не удалось проверить|временно недоступн|нет ai|попробуйте ещё|попробуйте чуть|автоматически/i.test(d.reason || '');
  }

  function statusBadge(status, reason) {
    const s = status || 'approved';
    if (s === 'pending') {
      return `<span class="badge badge-pending">проверяется…</span>`;
    }
    if (s === 'error') {
      return `<span class="badge badge-pending">сбой проверки</span>${reason ? `<span class="reason">${esc(reason)}</span>` : ''}`;
    }
    if (s === 'rejected') {
      return `<span class="badge badge-bad">❌ отклонено</span>${reason ? `<span class="reason">${esc(reason)}</span>` : ''}`;
    }
    return `<span class="badge badge-ok">✅ принято</span>`;
  }

  let pollTimer = null;
  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  function startPollIfPending(data) {
    stopPoll();
    const pendingIds = new Set((data.deeds || []).filter((d) => d.status === 'pending').map((d) => d.id));
    if (!pendingIds.size) return;
    pollTimer = setInterval(async () => {
      try {
        const next = await api('/dobro/state?id=' + encodeURIComponent(user.id));
        const newlyApproved = (next.deeds || []).some((d) => pendingIds.has(d.id) && d.status === 'approved');
        renderState(next);
        if (newlyApproved) burstConfetti();
        if (!(next.deeds || []).some((d) => d.status === 'pending')) stopPoll();
      } catch {}
    }, 2000);
  }

  function rulesSeen() {
    try { return localStorage.getItem(RULES_SEEN) === '1'; } catch { return false; }
  }
  function markRulesSeen() {
    try { localStorage.setItem(RULES_SEEN, '1'); } catch {}
  }

  function setTab(name) {
    const titles = {
      add: 'Новое дело',
      feed: 'Лента',
      board: 'Рейтинг',
      history: 'История',
      profile: 'Профиль',
      rules: 'Правила'
    };
    if (name !== 'rules') prevTab = name;
    document.querySelectorAll('.panel').forEach((p) => {
      const on = p.id === 'panel-' + name;
      p.classList.toggle('active', on);
      if (on) p.removeAttribute('hidden');
      else p.setAttribute('hidden', '');
    });
    document.querySelectorAll('.tab').forEach((t) => {
      const tab = t.getAttribute('data-tab');
      t.classList.toggle('on', name === 'rules' ? tab === prevTab : tab === name);
    });
    const title = $('app-title');
    if (title) title.textContent = titles[name] || 'Доброта';
    const main = $('app-main');
    if (main) main.scrollTop = 0;
    if (name === 'add' && !rulesSeen()) openRules(true);
  }

  function openRules(fromFirstDeed) {
    if (fromFirstDeed) markRulesSeen();
    setTab('rules');
  }
  function closeRules() {
    markRulesSeen();
    setTab(prevTab === 'rules' ? 'add' : prevTab || 'add');
  }

  function updatePinUi() {
    const oldWrap = $('pin-old-wrap');
    const hint = $('pin-hint');
    const label = $('pin-new-label');
    const submit = $('pin-submit');
    if (oldWrap) oldWrap.classList.toggle('hidden', !hasPin);
    if (hint) hint.textContent = '';
    if (label) label.textContent = hasPin ? 'Новый' : 'PIN';
    if (submit) submit.textContent = hasPin ? 'Сменить' : 'Сохранить';
  }

  function filterFeed(items) {
    const likes = likesMap();
    const friends = friendsSet();
    const today = moscowDayKey();
    return (items || []).filter((item) => {
      if (feedFilter === 'mine') return !!item.isYou;
      if (feedFilter === 'today') return moscowDayKey(item.createdAt) === today;
      if (feedFilter === 'friends') {
        if (item.isYou) return false;
        const key = item.authorId || item.authorName;
        return friends.has(String(key)) || friends.has(String(item.authorName));
      }
      return true;
    });
  }

  function renderFeedList(feed) {
    const likes = likesMap();
    const list = filterFeed(feed);
    const box = $('feed-list');
    if (!list.length) {
      box.innerHTML = '<p class="muted empty-hint">Пусто</p>';
      return;
    }
    box.innerHTML = `<div class="feed">${list.map((item) => {
      const fid = String(item.id);
      const liked = !!likes[fid];
      const lvl = levelFor(item.isYou ? ((lastState && lastState.me && lastState.me.deedCount) || 0) : 0);
      const authorLvl = item.isYou ? lvl.name : (item.authorLevel || '');
      return `
      <article class="ig-card" data-feed-id="${esc(fid)}">
        <img class="ig-photo" src="${esc(item.photoUrl)}" alt="">
        <div class="ig-meta">
          <div class="ig-author">
            <p class="name">${esc(item.authorName || 'Участник')}${item.isYou ? ' · вы' : ''}</p>
            ${authorLvl ? `<span class="lvl">${esc(authorLvl)}</span>` : ''}
          </div>
          <p class="ig-title">${esc(item.title)}</p>
          <p class="ig-sub"><span class="ig-cat">${catIconSvg(catMeta(item.category).icon)}${esc(catMeta(item.category).label)}</span> · +${item.points || 0}</p>
          <div class="ig-actions">
            <button type="button" class="heart-btn${liked ? ' on' : ''}" data-like="${esc(fid)}" data-author="${esc(item.authorId || item.authorName || '')}" aria-label="Нравится">
              <svg viewBox="0 0 24 24"><path d="M12 21s-6.7-4.3-9.3-8.1C.7 9.7 2.2 6 5.6 6c1.9 0 3.2 1.1 4 2.2C10.4 7.1 11.7 6 13.6 6c3.4 0 4.9 3.7 2.9 6.9C18.7 16.7 12 21 12 21z"/></svg>
            </button>
          </div>
        </div>
      </article>`;
    }).join('')}</div>`;
    box.querySelectorAll('.heart-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-like');
        const author = btn.getAttribute('data-author');
        const on = toggleLike(id, author);
        btn.classList.toggle('on', on);
        btn.classList.remove('pop');
        void btn.offsetWidth;
        btn.classList.add('pop');
        const r = btn.getBoundingClientRect();
        floatHeartAt(r.left + r.width / 2, r.top);
      });
    });
  }

  function renderRewards(deeds, me) {
    const streak = calcStreak(deeds);
    const count = me.deedCount || 0;
    const photos = (deeds || []).filter((d) => (d.status || 'approved') === 'approved' && d.photoUrl).length;
    const lvl = levelFor(count);
    const sc = $('streak-count');
    if (sc) sc.textContent = `${streak} ${streak === 1 ? 'день' : (streak >= 2 && streak <= 4 ? 'дня' : 'дней')}`;
    const lb = $('level-badge');
    if (lb) lb.textContent = lvl.name;
    const grid = $('badges-grid');
    if (grid) {
      grid.innerHTML = BADGES.map((b) => {
        let on = false;
        if (b.need != null) on = count >= b.need;
        if (b.needStreak != null) on = streak >= b.needStreak;
        if (b.needPhotos != null) on = photos >= b.needPhotos;
        return `<div class="badge-chip${on ? ' on' : ' locked'}"><strong>${esc(b.name)}</strong></div>`;
      }).join('');
    }
  }

  function renderState(data) {
    lastState = data;
    const me = data.me || { name: user.name, totalPoints: 0, deedCount: 0 };
    if (typeof me.hasPin === 'boolean') {
      hasPin = me.hasPin;
      updatePinUi();
    }
    const lvl = levelFor(me.deedCount || 0);
    $('nick').value = me.name || user.name;
    $('me-line').innerHTML = `<strong>${me.totalPoints}</strong> · ${me.deedCount} · <span style="color:var(--warm)">${esc(lvl.name)}</span>`;
    const chip = $('me-chip');
    if (chip) chip.textContent = `${me.name || user.name} · ${me.totalPoints}`;
    const note = $('profile-note');
    if (note) note.textContent = `${me.totalPoints} · ${me.deedCount} · ${lvl.name}`;

    renderDaily();
    renderFeedList(data.feed || []);

    const board = data.board || [];
    $('board-list').innerHTML = board.length ? board.map((e) => {
      const bl = levelFor(e.deedCount || 0);
      return `
      <li class="${e.isYou ? 'you' : ''}">
        <span class="rank">${e.rank}</span>
        <div class="grow"><p>${esc(e.name)}${e.isYou ? ' <span class="muted">вы</span>' : ''} <span class="lvl" style="font-size:.65rem;margin-left:.25rem">${esc(bl.name)}</span></p>
        <p class="muted" style="font-weight:400">${e.deedCount}</p></div>
        <span class="pts-lg">${e.totalPoints}</span>
      </li>`;
    }).join('') : '<li class="muted">Пусто</li>';

    const deeds = data.deeds || [];
    renderRewards(deeds, me);
    $('hist-list').innerHTML = deeds.length ? deeds.map((d) => `
      <li class="deed-item status-${esc(d.status || 'approved')}">
        ${d.photoUrl ? `<img class="thumb" src="${esc(d.photoUrl)}" alt="">` : ''}
        <div class="grow">
          <p>${esc(d.title)}</p>
          <p class="muted" style="font-weight:400">${esc(catMeta(d.category).label)} · ${esc(formatDate(d.createdAt))}</p>
          <div class="status-row">${statusBadge(d.status, d.reason)}${
            isRecoverableDeed(d)
              ? `<button type="button" class="btn btn-ghost recover-deed" data-deed-id="${d.id}">OK</button>`
              : ''
          }</div>
        </div>
        <span class="pts-sm">${d.status === 'rejected' || d.status === 'pending' || d.status === 'error' ? '—' : '+' + (d.points || 0)}</span>
      </li>`).join('') : '<li class="muted">Пусто</li>';
    $('hist-list').querySelectorAll('.recover-deed').forEach((btn) => {
      btn.addEventListener('click', () => recoverDeed(Number(btn.getAttribute('data-deed-id')), btn));
    });
    startPollIfPending(data);
  }

  async function recoverDeed(deedId, btn) {
    if (busy || !user || !Number.isFinite(deedId)) return;
    busy = true;
    if (btn) btn.disabled = true;
    show($('error'), '', false);
    show($('flash'), '', false);
    try {
      const data = await api('/dobro/deed/recover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: user.id, deedId })
      });
      show($('flash'), `+${(data.deed && data.deed.points) || 0}`, true, 'ok');
      burstConfetti();
      await loadAll();
    } catch (e) {
      show($('error'), e.message || 'Не удалось принять дело', true);
      if (btn) btn.disabled = false;
    } finally {
      busy = false;
    }
  }

  async function loadAll() {
    show($('error'), '', false);
    show($('loading'), 'Загружаем…', true);
    try {
      const data = await api('/dobro/state?id=' + encodeURIComponent(user.id));
      if (data.me && data.me.exists === false) {
        // Local session points to unknown id — ask to log in again
        user = null;
        try { localStorage.removeItem(STORE); } catch {}
        showGate('login');
        show($('login-err'), 'Сессия не найдена на сервере. Войдите по имени и PIN или по ссылке.', true);
        show($('loading'), '', false);
        return;
      }
      if (data.me && data.me.name && data.me.name !== user.name) {
        await saveUser({ id: user.id, name: data.me.name });
      }
      renderState(data);
    } catch (e) {
      show($('error'), e.message || 'Ошибка загрузки', true);
    } finally {
      show($('loading'), '', false);
    }
  }

  function showGate(mode) {
    gate.classList.remove('hidden');
    app.classList.add('hidden');
    const reg = $('gate-mode-register');
    const log = $('gate-mode-login');
    const syn = $('gate-mode-sync');
    const sub = $('gate-sub');
    if (reg) reg.classList.toggle('hidden', mode !== 'register');
    if (log) log.classList.toggle('hidden', mode !== 'login');
    if (syn) syn.classList.toggle('hidden', mode !== 'sync');
    if (sub) {
      if (mode === 'login') sub.textContent = 'Имя и PIN';
      else if (mode === 'sync') sub.textContent = 'Вход по ссылке';
      else sub.textContent = 'Имя и PIN · вход сохранится';
    }
    show($('gate-err'), '', false);
    show($('login-err'), '', false);
    show($('sync-err'), '', false);
  }

  async function enterApp(initialTab) {
    gate.classList.add('hidden');
    app.classList.remove('hidden');
    renderCats();
    updateAddLabel();
    updatePinUi();
    setTab(initialTab || 'feed');
    await loadAll();
  }

  function cleanPin(raw) {
    const s = String(raw || '').trim();
    return /^\d{4}$/.test(s) ? s : '';
  }

  function stripSyncFromUrl() {
    try {
      const u = new URL(location.href);
      if (!u.searchParams.has('sync')) return;
      u.searchParams.delete('sync');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch {}
  }

  $('gate-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const name = $('gate-name').value.trim();
    const pin = cleanPin($('gate-pin').value);
    const pin2 = cleanPin($('gate-pin2').value);
    if (name.length < 2) {
      show($('gate-err'), 'Имя должно быть не короче 2 символов', true);
      return;
    }
    if (!pin) {
      show($('gate-err'), 'PIN — ровно 4 цифры', true);
      return;
    }
    if (pin !== pin2) {
      show($('gate-err'), 'PIN и повтор не совпадают', true);
      return;
    }
    busy = true;
    show($('gate-err'), '', false);
    $('gate-submit').disabled = true;
    try {
      const id = randId();
      const data = await api('/dobro/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, name, pin })
      });
      hasPin = true;
      await saveUser({ id: data.id || id, name: data.name || name });
      await enterApp();
    } catch (e) {
      const msg = e.message || 'Не удалось создать аккаунт';
      show($('gate-err'), msg, true);
      if (/занято|уже есть|войдите/i.test(msg)) {
        $('login-name').value = name;
        showGate('login');
        show($('login-err'), msg, true);
      }
    } finally {
      busy = false;
      $('gate-submit').disabled = false;
    }
  });

  $('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const name = $('login-name').value.trim();
    const pin = cleanPin($('login-pin').value);
    if (name.length < 2) {
      show($('login-err'), 'Введите имя аккаунта', true);
      return;
    }
    if (!pin) {
      show($('login-err'), 'PIN — ровно 4 цифры', true);
      return;
    }
    busy = true;
    show($('login-err'), '', false);
    $('login-submit').disabled = true;
    try {
      const data = await api('/dobro/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, pin })
      });
      hasPin = !!data.hasPin;
      await saveUser({ id: data.id, name: data.name || name });
      await enterApp();
    } catch (e) {
      show($('login-err'), e.message || 'Не удалось войти', true);
    } finally {
      busy = false;
      $('login-submit').disabled = false;
    }
  });

  $('btn-have-account').addEventListener('click', () => showGate('login'));
  $('btn-new-account').addEventListener('click', () => showGate('register'));
  $('btn-sync-other').addEventListener('click', () => showGate('login'));

  $('sync-claim-btn').addEventListener('click', async () => {
    if (busy || !pendingSync) return;
    busy = true;
    show($('sync-err'), '', false);
    $('sync-claim-btn').disabled = true;
    try {
      const data = await api('/dobro/sync/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: pendingSync })
      });
      hasPin = !!data.hasPin;
      await saveUser({ id: data.id, name: data.name || 'Участник' });
      pendingSync = '';
      stripSyncFromUrl();
      await enterApp();
    } catch (e) {
      show($('sync-err'), e.message || 'Ссылка не сработала', true);
    } finally {
      busy = false;
      $('sync-claim-btn').disabled = false;
    }
  });

  async function onPick(file) {
    if (!file) return;
    show($('error'), '', false);
    try {
      photo = await compressImage(file);
      $('preview').src = photo;
      $('preview').classList.remove('hidden');
      $('btn-del-photo').classList.remove('hidden');
    } catch (e) {
      show($('error'), e.message, true);
    }
  }
  function clearPhoto() {
    photo = null;
    $('cam').value = '';
    $('gal').value = '';
    $('preview').src = '';
    $('preview').classList.add('hidden');
    $('btn-del-photo').classList.add('hidden');
  }
  $('btn-camera').onclick = () => $('cam').click();
  $('btn-gallery').onclick = () => $('gal').click();
  $('btn-del-photo').onclick = clearPhoto;
  $('cam').onchange = (e) => onPick(e.target.files && e.target.files[0]);
  $('gal').onchange = (e) => onPick(e.target.files && e.target.files[0]);

  // Big FAB: open add tab and launch camera in one gesture
  const tabAdd = $('tab-add');
  if (tabAdd) {
    tabAdd.addEventListener('click', () => {
      setTimeout(() => {
        if (!photo) {
          try { $('cam').click(); } catch {}
        }
      }, 220);
    });
  }

  document.querySelectorAll('#feed-filters .feed-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      feedFilter = btn.getAttribute('data-filter') || 'all';
      document.querySelectorAll('#feed-filters .feed-filter').forEach((b) => {
        b.classList.toggle('on', b === btn);
      });
      if (lastState) renderFeedList(lastState.feed || []);
    });
  });

  $('deed-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    if (!photo) {
      show($('error'), 'Добавьте фото доброго дела — без него запись не принимается', true);
      try { $('cam').click(); } catch {}
      return;
    }
    busy = true;
    updateAddLabel();
    show($('error'), '', false);
    show($('flash'), '', false);
    try {
      const data = await api('/dobro/deed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: user.id,
          name: user.name,
          title: $('title').value,
          category: normalizeCat(category),
          photo
        })
      });
      $('title').value = '';
      clearPhoto();
      const st = data.deed && data.deed.status;
      if (st === 'pending' || !st) {
        show($('flash'), 'Проверка…', true, 'ok');
      } else if (st === 'approved') {
        show($('flash'), `+${data.deed.points}`, true, 'ok');
        burstConfetti();
      } else {
        show($('flash'), (data.deed && data.deed.reason) || 'Нет', true, 'err');
      }
      setTab('history');
      await loadAll();
    } catch (e) {
      show($('error'), e.message || 'Ошибка', true);
    } finally {
      busy = false;
      updateAddLabel();
    }
  });

  $('nick-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    busy = true;
    show($('error'), '', false);
    show($('flash'), '', false);
    try {
      const data = await api('/dobro/nick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: user.id, name: $('nick').value })
      });
      await saveUser({ id: user.id, name: data.name || $('nick').value.trim() });
      show($('flash'), 'Сохранено', true);
      await loadAll();
    } catch (e) {
      show($('error'), e.message || 'Ошибка', true);
    } finally {
      busy = false;
    }
  });

  $('pin-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy || !user) return;
    const pin = cleanPin($('pin-new').value);
    const oldPin = cleanPin($('pin-old').value);
    if (!pin) {
      show($('error'), 'PIN — ровно 4 цифры', true);
      return;
    }
    if (hasPin && !oldPin) {
      show($('error'), 'Введите текущий PIN', true);
      return;
    }
    busy = true;
    show($('error'), '', false);
    show($('flash'), '', false);
    try {
      const body = { id: user.id, pin };
      if (hasPin) body.oldPin = oldPin;
      await api('/dobro/set-pin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      hasPin = true;
      updatePinUi();
      $('pin-new').value = '';
      $('pin-old').value = '';
      show($('flash'), 'OK', true);
    } catch (e) {
      show($('error'), e.message || 'Не удалось сохранить PIN', true);
    } finally {
      busy = false;
    }
  });

  async function makeSyncLink() {
    if (busy || !user) return;
    busy = true;
    show($('error'), '', false);
    show($('flash'), '', false);
    try {
      const data = await api('/dobro/sync/issue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: user.id })
      });
      const url = location.origin + location.pathname.replace(/\/?$/, '/') + '?sync=' + encodeURIComponent(data.token);
      $('sync-url').value = url;
      show($('flash'), 'Готово', true);
    } catch (e) {
      show($('error'), e.message || 'Не удалось создать ссылку', true);
    } finally {
      busy = false;
    }
  }
  $('sync-make').addEventListener('click', makeSyncLink);
  $('sync-copy').addEventListener('click', async () => {
    const v = $('sync-url').value;
    if (!v) {
      await makeSyncLink();
    }
    const text = $('sync-url').value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      show($('flash'), 'Скопировано', true);
    } catch {
      $('sync-url').select();
      show($('flash'), 'Скопируйте ссылку вручную', true);
    }
  });

  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.getAttribute('data-tab')));
  });
  const btnRulesAdd = $('btn-rules-add');
  const btnRulesProfile = $('btn-rules-profile');
  const btnRulesDone = $('btn-rules-done');
  if (btnRulesAdd) btnRulesAdd.addEventListener('click', () => openRules(false));
  if (btnRulesProfile) btnRulesProfile.addEventListener('click', () => openRules(false));
  if (btnRulesDone) btnRulesDone.addEventListener('click', closeRules);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }

  async function boot() {
    const params = new URLSearchParams(location.search);
    const bootTab = params.get('tab');
    const okTab = ['add', 'feed', 'board', 'history', 'profile', 'rules'].includes(bootTab) ? bootTab : 'feed';
    const syncToken = (params.get('sync') || '').trim();

    user = await loadUserDurable();
    if (validLocalUser(user)) {
      await saveUser(user); // refresh all stores
      if (syncToken) {
        // Already logged in — ignore sync or offer? Prefer keep current session, strip sync
        stripSyncFromUrl();
      }
      await enterApp(okTab);
      return;
    }

    if (syncToken) {
      pendingSync = syncToken;
      showGate('sync');
      try {
        const info = await api('/dobro/sync/info?token=' + encodeURIComponent(syncToken));
        const hint = $('sync-restore-hint');
        if (hint && info.name) {
          hint.textContent = '«' + info.name + '»';
        }
      } catch (e) {
        show($('sync-err'), e.message || 'Ссылка недействительна', true);
      }
      return;
    }

    showGate('register');
  }

  boot().catch(() => showGate('register'));
})();
