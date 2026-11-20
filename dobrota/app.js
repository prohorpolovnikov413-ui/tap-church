(() => {
  const API = 'https://zavhoz-board.sj-polomki.workers.dev';
  const STORE = 'dobrota-user-v1';
  const COOKIE = 'dobrota_uid';
  const IDB_NAME = 'dobrota-db';
  const IDB_STORE = 'session';
  const RULES_SEEN = 'dobrota-rules-seen-v1';
  const CATS = [
    { id: 'smile', label: 'Маленькая радость', hint: 'улыбка, комплимент, тёплое слово', points: 5 },
    { id: 'help', label: 'Практическая помощь', hint: 'помог с сумками, делом, дорогой', points: 15 },
    { id: 'care', label: 'Забота и внимание', hint: 'выслушал, поддержал, утешил', points: 25 },
    { id: 'big', label: 'Большое дело', hint: 'серьёзная помощь человеку', points: 50 },
    { id: 'volunteer', label: 'Волонтёрство', hint: 'время и силы ради других', points: 80 }
  ];
  const LABELS = Object.fromEntries(CATS.map((c) => [c.id, c.label]));

  const $ = (id) => document.getElementById(id);
  const gate = $('gate'), app = $('app');
  let user = null, photo = null, category = 'help', busy = false, prevTab = 'feed';
  let hasPin = false, pendingSync = '';

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
    box.innerHTML = '<legend class="lbl">Категория и баллы</legend>' + CATS.map((c) => `
      <label class="cat${c.id === category ? ' on' : ''}">
        <input type="radio" name="category" value="${c.id}" ${c.id === category ? 'checked' : ''}>
        <div class="row"><span>${esc(c.label)}</span><span class="pts">+${c.points}</span></div>
        <p>${esc(c.hint)}</p>
      </label>`).join('');
    box.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('change', () => {
        category = inp.value;
        renderCats();
        updateAddLabel();
      });
    });
  }
  function updateAddLabel() {
    const c = CATS.find((x) => x.id === category);
    $('btn-add').textContent = busy ? 'Проверяем…' : `Добавить · +${c.points}`;
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
    const pending = (data.deeds || []).some((d) => d.status === 'pending');
    if (!pending) return;
    pollTimer = setInterval(async () => {
      try {
        const next = await api('/dobro/state?id=' + encodeURIComponent(user.id));
        renderState(next);
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
    if (hint) {
      hint.textContent = hasPin
        ? 'PIN уже задан. Чтобы сменить — введите текущий и новый.'
        : 'Задайте PIN из 4 цифр, чтобы входить с другого устройства по имени.';
    }
    if (label) label.textContent = hasPin ? 'Новый PIN (4 цифры)' : 'PIN (4 цифры)';
    if (submit) submit.textContent = hasPin ? 'Сменить PIN' : 'Сохранить PIN';
  }

  function renderState(data) {
    const me = data.me || { name: user.name, totalPoints: 0, deedCount: 0 };
    if (typeof me.hasPin === 'boolean') {
      hasPin = me.hasPin;
      updatePinUi();
    }
    $('nick').value = me.name || user.name;
    $('me-line').innerHTML = `У вас сейчас <strong>${me.totalPoints}</strong> баллов и <strong>${me.deedCount}</strong> ${deedsWord(me.deedCount)}`;
    const chip = $('me-chip');
    if (chip) chip.textContent = `${me.name || user.name} · ${me.totalPoints} б.`;
    const note = $('profile-note');
    if (note) note.textContent = `${me.totalPoints} баллов · ${me.deedCount} ${deedsWord(me.deedCount)}`;

    const feed = data.feed || [];
    $('feed-list').innerHTML = feed.length ? `<div class="feed">${feed.map((item) => `
      <article class="card">
        <img src="${esc(item.photoUrl)}" alt="">
        <p class="t">${esc(item.title)}</p>
        <p class="m">${esc(item.authorName)}${item.isYou ? ' · это вы' : ''} · ${esc(LABELS[item.category] || item.category)} · +${item.points || 0}</p>
      </article>`).join('')}</div>` : '<p class="muted" style="margin-top:1.2rem;padding:1.2rem 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">Пока нет дел с фото — добавьте запись со снимком.</p>';

    const board = data.board || [];
    $('board-list').innerHTML = board.length ? board.map((e) => `
      <li class="${e.isYou ? 'you' : ''}">
        <span class="rank">${e.rank}</span>
        <div class="grow"><p>${esc(e.name)}${e.isYou ? ' <span class="muted">это вы</span>' : ''}</p>
        <p class="muted" style="font-weight:400">${e.deedCount} ${deedsWord(e.deedCount)}</p></div>
        <span class="pts-lg">${e.totalPoints}</span>
      </li>`).join('') : '<li class="muted">Пока пусто — будьте первым, кто отметит доброе дело.</li>';

    const deeds = data.deeds || [];
    $('hist-list').innerHTML = deeds.length ? deeds.map((d) => `
      <li class="deed-item status-${esc(d.status || 'approved')}">
        ${d.photoUrl ? `<img class="thumb" src="${esc(d.photoUrl)}" alt="">` : ''}
        <div class="grow">
          <p>${esc(d.title)}</p>
          <p class="muted" style="font-weight:400">${esc(LABELS[d.category] || d.category)} · ${esc(formatDate(d.createdAt))}</p>
          <div class="status-row">${statusBadge(d.status, d.reason)}${
            isRecoverableDeed(d)
              ? `<button type="button" class="btn btn-ghost recover-deed" data-deed-id="${d.id}">Принять</button>`
              : ''
          }</div>
        </div>
        <span class="pts-sm">${d.status === 'rejected' || d.status === 'pending' || d.status === 'error' ? '—' : '+' + (d.points || 0)}</span>
      </li>`).join('') : '<li class="muted">Записей ещё нет — добавьте первое дело с фото.</li>';
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
      show($('flash'), `Принято · +${(data.deed && data.deed.points) || 0} баллов`, true, 'ok');
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
      if (mode === 'login') sub.textContent = 'Войдите в существующий аккаунт по имени и PIN.';
      else if (mode === 'sync') sub.textContent = 'Восстановление аккаунта по личной ссылке.';
      else sub.textContent = 'Создайте аккаунт: имя в рейтинге и PIN из 4 цифр. На этом устройстве вход сохранится.';
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

  $('deed-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    if (!photo) {
      show($('error'), 'Добавьте фото доброго дела — без него запись не принимается', true);
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
          category,
          photo
        })
      });
      $('title').value = '';
      clearPhoto();
      const st = data.deed && data.deed.status;
      if (st === 'pending' || !st) {
        show($('flash'), 'Отправлено · фото проверяется…', true, 'ok');
      } else if (st === 'approved') {
        show($('flash'), `✅ Принято · +${data.deed.points} баллов`, true, 'ok');
      } else {
        show($('flash'), `❌ Отклонено: ${(data.deed && data.deed.reason) || 'фото не подошло'}`, true, 'err');
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
      show($('flash'), 'Имя в рейтинге обновлено', true);
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
      show($('flash'), 'PIN сохранён', true);
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
      show($('flash'), 'Ссылка готова — откройте её на другом устройстве', true);
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
      show($('flash'), 'Ссылка скопирована', true);
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
          hint.textContent = 'Ссылка ведёт в аккаунт «' + info.name + '». Подтвердите вход на этом устройстве.';
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
