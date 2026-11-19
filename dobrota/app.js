(() => {
  const API = 'https://zavhoz-board.sj-polomki.workers.dev';
  const STORE = 'dobrota-user-v1';
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

  function loadUser() {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; }
  }
  function saveUser(u) {
    user = u;
    localStorage.setItem(STORE, JSON.stringify(u));
  }
  function randId() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
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

  function statusBadge(status, reason) {
    const s = status || 'approved';
    if (s === 'pending') {
      return `<span class="badge badge-pending">проверяется…</span>`;
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

  function renderState(data) {
    const me = data.me || { name: user.name, totalPoints: 0, deedCount: 0 };
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
      </article>`).join('')}</div>` : '<p class="muted" style="margin-top:1.2rem;padding:1.2rem 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">Пока нет подтверждённых фото — добавьте дело с живым снимком.</p>';

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
          <div class="status-row">${statusBadge(d.status, d.reason)}</div>
        </div>
        <span class="pts-sm">${d.status === 'rejected' || d.status === 'pending' ? '—' : '+' + (d.points || 0)}</span>
      </li>`).join('') : '<li class="muted">Записей ещё нет — добавьте первое дело с фото.</li>';
    startPollIfPending(data);
  }

  async function loadAll() {
    show($('error'), '', false);
    show($('loading'), 'Загружаем…', true);
    try {
      const data = await api('/dobro/state?id=' + encodeURIComponent(user.id));
      if (data.me && data.me.name && data.me.name !== user.name) {
        saveUser({ id: user.id, name: data.me.name });
      }
      renderState(data);
    } catch (e) {
      show($('error'), e.message || 'Ошибка загрузки', true);
    } finally {
      show($('loading'), '', false);
    }
  }

  function enterApp(initialTab) {
    gate.classList.add('hidden');
    app.classList.remove('hidden');
    renderCats();
    updateAddLabel();
    setTab(initialTab || 'feed');
    loadAll();
  }

  $('gate-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('gate-name').value.trim();
    if (name.length < 2) {
      show($('gate-err'), 'Имя должно быть не короче 2 символов', true);
      return;
    }
    saveUser({ id: randId(), name });
    enterApp();
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
      saveUser({ id: user.id, name: data.name || $('nick').value.trim() });
      show($('flash'), 'Имя в рейтинге обновлено', true);
      await loadAll();
    } catch (e) {
      show($('error'), e.message || 'Ошибка', true);
    } finally {
      busy = false;
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

  const bootTab = new URLSearchParams(location.search).get('tab');
  const okTab = ['add', 'feed', 'board', 'history', 'profile', 'rules'].includes(bootTab) ? bootTab : 'feed';
  user = loadUser();
  if (user && user.id && user.name) enterApp(okTab);
})();
