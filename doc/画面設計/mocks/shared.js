/* =============================================================
 * ideaquest モック共通スクリプト
 * 静的モックで再利用する軽い挙動のみを持つ（実装ロジックではない）。
 * 各モックは <script src="shared.js"></script> で読み込む。
 * ============================================================= */

/* --- カスタムコンボボックス（[data-combobox] を初期化） ---
   マークアップ:
   <div class="combobox" data-combobox>
     <button type="button" class="combobox__button" aria-haspopup="listbox" aria-expanded="false">
       <span class="combobox__value">選択中</span><span class="combobox__arrow">▾</span>
     </button>
     <ul class="combobox__list" role="listbox" hidden>
       <li class="combobox__option" role="option" aria-selected="true">選択肢A</li>
       ...
     </ul>
   </div>
*/
(function () {
  function initCombobox(root) {
    const btn = root.querySelector('.combobox__button');
    const valueEl = root.querySelector('.combobox__value');
    const list = root.querySelector('.combobox__list');
    const options = Array.from(list.querySelectorAll('.combobox__option'));
    let activeIndex = Math.max(0, options.findIndex(o => o.getAttribute('aria-selected') === 'true'));

    function setActive(i) {
      activeIndex = (i + options.length) % options.length;
      options.forEach(o => o.classList.remove('is-active'));
      options[activeIndex].classList.add('is-active');
      options[activeIndex].scrollIntoView({ block: 'nearest' });
    }
    function open() { list.hidden = false; btn.setAttribute('aria-expanded', 'true'); setActive(activeIndex); }
    function close() { list.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    function select(i) {
      options.forEach(o => o.setAttribute('aria-selected', 'false'));
      options[i].setAttribute('aria-selected', 'true');
      valueEl.textContent = options[i].textContent;
      close(); btn.focus();
    }

    btn.addEventListener('click', () => (list.hidden ? open() : close()));
    options.forEach((o, i) => {
      o.addEventListener('click', () => select(i));
      o.addEventListener('mousemove', () => setActive(i));
    });
    btn.addEventListener('keydown', (e) => {
      if (list.hidden && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(activeIndex); }
      else if (e.key === 'Escape') { close(); }
    });
    document.addEventListener('click', (e) => { if (!root.contains(e.target)) close(); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-combobox]').forEach(initCombobox);
  });
})();

/* --- 複数選択コンボボックス（[data-multiselect] を初期化） ---
   マークアップ:
   <div class="multiselect" data-multiselect data-free="true">
     <div class="multiselect__control">
       <!-- 選択チップは control 内・input の前に挿入される -->
       <input class="multiselect__input" type="text" role="combobox"
              aria-autocomplete="list" aria-expanded="false" placeholder="選択または入力…">
     </div>
     <ul class="multiselect__list" role="listbox" hidden>
       <li class="multiselect__option" role="option" data-value="業務改善">業務改善</li>
       ...
       <li class="multiselect__empty" role="presentation" hidden></li>
     </ul>
   </div>
   ・data-free="true": 候補に無い手入力を Enter で追加（タグ作成）
   ・data-single="true": 単一選択（オートコンプリート付き）。チップにせず入力欄に確定値を表示・候補のみ
   ・初期選択: <li ... aria-selected="true"> または data-selected を付けたオプション
*/
(function () {
  function initMultiselect(root) {
    const control = root.querySelector('.multiselect__control');
    const input = root.querySelector('.multiselect__input');
    const list = root.querySelector('.multiselect__list');
    const emptyEl = list.querySelector('.multiselect__empty');
    const single = root.dataset.single === 'true';
    const allowFree = !single && root.dataset.free === 'true'; // 単一選択は候補のみ
    const options = Array.from(list.querySelectorAll('.multiselect__option'));
    options.forEach(o => { if (!o.dataset.value) o.dataset.value = o.textContent.trim(); });
    const selected = new Set(); // 値（小文字）で重複防止
    let chosenLabel = ''; // 単一選択の確定表示

    const visibleOptions = () => options.filter(o => !o.hidden);
    const activeOption = () => list.querySelector('.multiselect__option.is-active');
    function setActive(o) {
      options.forEach(x => x.classList.remove('is-active'));
      if (o) { o.classList.add('is-active'); o.scrollIntoView({ block: 'nearest' }); }
    }
    function open() { list.hidden = false; input.setAttribute('aria-expanded', 'true'); filter(); }
    function close() {
      list.hidden = true; input.setAttribute('aria-expanded', 'false'); setActive(null);
      if (single) input.value = chosenLabel; // 未確定の入力は確定値へ戻す
    }

    function filter() {
      let q = input.value.trim().toLowerCase();
      if (single && input.value === chosenLabel) q = ''; // 確定値表示中は全件
      let anyVisible = false, exact = false;
      options.forEach(o => {
        const val = o.dataset.value.toLowerCase();
        const hideSelected = !single && selected.has(val); // 複数選択は選択済みを候補から隠す
        o.hidden = hideSelected || (q && !val.includes(q));
        if (!o.hidden) anyVisible = true;
        if (val === q) exact = true;
      });
      setActive(visibleOptions()[0] || null);
      if (emptyEl) {
        if (anyVisible) { emptyEl.hidden = true; }
        else if (allowFree && q && !exact) { emptyEl.hidden = false; emptyEl.textContent = '「' + input.value.trim() + '」を追加（Enter）'; }
        else { emptyEl.hidden = false; emptyEl.textContent = '候補がありません'; }
      }
    }

    function choose(value, label, custom) {
      const key = value.toLowerCase();
      if (single) { selected.clear(); selected.add(key); chosenLabel = label; input.value = label; close(); return; }
      if (selected.has(key)) return;
      selected.add(key);
      const chip = document.createElement('span');
      chip.className = 'multiselect__chip' + (custom ? ' is-custom' : '');
      chip.dataset.value = value;
      chip.innerHTML = '<span class="multiselect__chip-label"></span>' +
        '<button type="button" class="multiselect__chip-remove" aria-label="「' + label + '」を解除">×</button>';
      chip.querySelector('.multiselect__chip-label').textContent = label;
      control.insertBefore(chip, input);
      input.value = ''; filter();
    }
    function removeChip(chip) {
      selected.delete(chip.dataset.value.toLowerCase());
      chip.remove(); filter(); input.focus();
    }

    // 初期選択
    options.forEach(o => {
      if (o.getAttribute('aria-selected') === 'true' || o.dataset.selected != null) {
        choose(o.dataset.value, o.textContent.trim(), false);
      }
    });

    control.addEventListener('click', (e) => {
      const rm = e.target.closest('.multiselect__chip-remove');
      if (rm) { removeChip(rm.closest('.multiselect__chip')); return; }
      input.focus(); if (single) input.select(); open();
    });
    input.addEventListener('focus', () => { if (single) input.select(); open(); });
    input.addEventListener('input', () => { if (list.hidden) open(); else filter(); });

    // mousedown で選択（input の blur によるクローズより先に動かす）
    list.addEventListener('mousedown', (e) => {
      const o = e.target.closest('.multiselect__option');
      if (o && !o.hidden) { e.preventDefault(); choose(o.dataset.value, o.textContent.trim(), false); input.focus(); return; }
      const em = e.target.closest('.multiselect__empty');
      if (em && allowFree) {
        const v = input.value.trim();
        if (v && !selected.has(v.toLowerCase())) { e.preventDefault(); choose(v, v, true); input.focus(); }
      }
    });
    list.addEventListener('mousemove', (e) => { const o = e.target.closest('.multiselect__option'); if (o && !o.hidden) setActive(o); });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (list.hidden) open();
        const vis = visibleOptions(); if (!vis.length) return;
        let i = vis.indexOf(activeOption());
        i = e.key === 'ArrowDown' ? (i + 1) % vis.length : (i - 1 + vis.length) % vis.length;
        setActive(vis[i]);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const act = activeOption();
        if (act && !act.hidden) { choose(act.dataset.value, act.textContent.trim(), false); }
        else if (allowFree) { const v = input.value.trim(); if (v && !selected.has(v.toLowerCase())) choose(v, v, true); }
      } else if (e.key === 'Backspace' && input.value === '') {
        if (single) { selected.clear(); chosenLabel = ''; filter(); }
        else { const chips = control.querySelectorAll('.multiselect__chip'); if (chips.length) removeChip(chips[chips.length - 1]); }
      } else if (e.key === 'Escape') { close(); }
    });

    input.addEventListener('blur', () => setTimeout(() => { if (!root.contains(document.activeElement)) close(); }, 0));
    document.addEventListener('click', (e) => { if (!root.contains(e.target)) close(); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-multiselect]').forEach(initMultiselect);
  });
})();

/* --- ヘッダーのアバターメニュー（.usermenu を初期化・全画面共通） ---
   マークアップ:
   <div class="usermenu">
     <button class="usermenu__trigger" aria-haspopup="menu" aria-expanded="false"> …avatar… </button>
     <ul class="usermenu__list" role="menu" hidden> …items… </ul>
   </div>
*/
(function () {
  function initUserMenu(root) {
    const trigger = root.querySelector('.usermenu__trigger');
    const menu = root.querySelector('.usermenu__list');
    if (!trigger || !menu) return;
    function close() { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open; trigger.setAttribute('aria-expanded', String(open));
    });
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.usermenu').forEach(initUserMenu);
  });
})();

/* --- コンテンツ背景画像（ユーザーメニューから設定・全認証画面共通） ---
   ユーザーメニュー内の [data-bg-set]（変更）／[data-bg-reset]（リセット）を初期化。
   保存は localStorage('ideaquest_content_bg')、表示は #appBg（.app-bg）。
   ※各画面の「保存済み背景の復元」はページ側の初期化スクリプトが担当（このモジュールは設定操作のみ）。
   本番はユーザー設定APIに保存し認証済みレイアウトへ共通適用（実体は MinIO）。 */
(function () {
  const BG_KEY = 'ideaquest_content_bg';
  function applyBg(url) {
    const el = document.getElementById('appBg');
    if (!el) return;
    if (url) { el.style.backgroundImage = 'url("' + url + '")'; el.classList.add('is-set'); }
    else { el.style.backgroundImage = ''; el.classList.remove('is-set'); }
  }
  function closeMenuFrom(el) {
    const um = el.closest('.usermenu'); if (!um) return;
    const list = um.querySelector('.usermenu__list'); const trg = um.querySelector('.usermenu__trigger');
    if (list) list.hidden = true; if (trg) trg.setAttribute('aria-expanded', 'false');
  }
  function initBg() {
    const setters = document.querySelectorAll('[data-bg-set]');
    if (!setters.length) return;
    // 単一の隠しファイル入力を用意
    let input = document.getElementById('ideaquestBgInput');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.id = 'ideaquestBgInput'; input.hidden = true;
      document.body.appendChild(input);
    }
    input.addEventListener('change', () => {
      const f = input.files && input.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { applyBg(r.result); try { localStorage.setItem(BG_KEY, r.result); } catch (e) { /* 容量超過時は表示のみ */ } };
      r.readAsDataURL(f); input.value = '';
    });
    setters.forEach(b => b.addEventListener('click', () => { closeMenuFrom(b); input.click(); }));
    document.querySelectorAll('[data-bg-reset]').forEach(b => b.addEventListener('click', () => {
      closeMenuFrom(b); applyBg(null); localStorage.removeItem(BG_KEY);
    }));
  }
  document.addEventListener('DOMContentLoaded', initBg);
})();

/* --- 複数値セルのクリップ（末尾「…」＋ホバーで全件） ---
   .cell-tags のはみ出しを検出して .is-clipped を付与（CSS で「…」を表示）。
   全件は title 属性でホバー表示（各画面が title を付ける／未設定なら子要素テキストを連結）。
   テーブルは動的描画のため、各画面は render() の最後に window.applyCellClips() を呼ぶ。 */
function applyCellClips(root) {
  (root || document).querySelectorAll('.cell-tags').forEach(el => {
    if (!el.title) el.title = Array.from(el.children).map(c => c.textContent.trim()).filter(Boolean).join('、');
    el.classList.toggle('is-clipped', el.scrollWidth > el.clientWidth + 1);
  });
}
window.applyCellClips = applyCellClips;
window.addEventListener('resize', () => applyCellClips());

/* --- 行アクション ⋯（ケバブ）メニュー（sticky 操作列） ---
   .rowmenu__trigger クリックで隣接の .rowmenu__list をトグル。
   table-wrap の overflow に隠れないよう list を position:fixed でトリガー直下（右寄せ）に配置。
   実処理（編集/無効化 等）は各画面の委譲ハンドラ（menuitem に data-* を付ける）。ここでは開閉のみ担当。 */
(function () {
  let openList = null;
  function close() {
    if (!openList) return;
    const trg = openList.__trigger;
    openList.hidden = true;
    openList.style.position = openList.style.top = openList.style.left = '';
    // 一時的に最前面へ持ち上げた操作セルを元に戻す
    if (openList.__cell) openList.__cell.classList.remove('rowmenu-open');
    if (trg) trg.setAttribute('aria-expanded', 'false');
    openList = null;
  }
  function open(trigger) {
    const list = trigger.parentElement.querySelector('.rowmenu__list');
    if (!list) return;
    close();
    // sticky 操作セルは（モダンブラウザでは position:sticky 自体が）スタッキングコンテキストを作るため、
    // 下の行の sticky セルが上の行のメニューを覆う。開いている行の操作セルだけ z-index を持ち上げて解消。
    const cell = trigger.closest('.col-actions');
    if (cell) cell.classList.add('rowmenu-open');
    list.hidden = false;
    list.style.position = 'fixed';
    const r = trigger.getBoundingClientRect();
    let top = r.bottom + 4, left = r.right - list.offsetWidth;
    if (top + list.offsetHeight > window.innerHeight) top = Math.max(8, r.top - list.offsetHeight - 4); // 下がはみ出すなら上へ
    list.style.top = top + 'px';
    list.style.left = Math.max(8, left) + 'px';
    trigger.setAttribute('aria-expanded', 'true');
    list.__trigger = trigger; list.__cell = cell; openList = list;
  }
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.rowmenu__trigger');
    if (trigger) { e.stopPropagation(); (openList && openList.__trigger === trigger) ? close() : open(trigger); return; }
    if (e.target.closest('.rowmenu__list [role="menuitem"]')) { close(); return; } // 実処理は委譲ハンドラが処理・ここは閉じるだけ
    if (!e.target.closest('.rowmenu__list')) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
})();

/* --- モーダル共通挙動（標準・非侵襲） ---
   各モックは従来どおり .modal に .show を付け外し／hidden をトグルするだけ。
   ここが MutationObserver で開閉を検知し、標準の a11y/UX を横断適用する:
   ・開いたら背景スクロールロック＋先頭フィールドへ初期フォーカス（＋起動要素を記憶）
   ・閉じたらスクロール解除＋起動要素へフォーカス復帰
   ・Esc で閉じる（.show を外して 200ms 後に hidden＝各モックの closeModal と同挙動）
   ・Tab のフォーカストラップ（モーダル外に出さない）
   デザイン標準 §4「モーダルダイアログ」参照。 */
(function () {
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  let lastFocused = null, activeModal = null;
  const isOpen = (m) => m.classList.contains('show') && !m.hidden;
  function focusables(m) {
    const panel = m.querySelector('.modal__panel') || m;
    return Array.from(panel.querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null);
  }
  function onOpen(m) {
    if (activeModal === m) return;
    lastFocused = document.activeElement;
    activeModal = m;
    document.body.classList.add('modal-open');
    const panel = m.querySelector('.modal__panel') || m;
    // 開くたびに位置・最大化をリセット（中央から。ドラッグ/最大化の残りを消す）
    if (panel.classList) {
      panel.classList.remove('is-max', 'is-dragging');
      panel.style.position = ''; panel.style.left = ''; panel.style.top = ''; panel.style.margin = ''; panel.style.width = '';
      const mb = m.querySelector('.modal__maxbtn');
      if (mb) { mb.textContent = '⤢'; mb.setAttribute('aria-label', '最大化'); }
    }
    const field = panel.querySelector('input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled])');
    const target = field || focusables(m)[0];
    if (target) setTimeout(() => { try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } }, 40);
  }
  function onClose(m) {
    if (activeModal !== m) return;
    activeModal = null;
    if (!document.querySelector('.modal.show')) document.body.classList.remove('modal-open');
    if (lastFocused && lastFocused.focus) { try { lastFocused.focus({ preventScroll: true }); } catch (e) { lastFocused.focus(); } }
    lastFocused = null;
  }
  function watch(m) {
    if (m.__iqWatched) return; m.__iqWatched = true;   // 二重監視を防止
    new MutationObserver(() => { isOpen(m) ? onOpen(m) : onClose(m); })
      .observe(m, { attributes: true, attributeFilter: ['class', 'hidden'] });
    if (isOpen(m)) onOpen(m);
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.modal').forEach(watch);
    // 動的に後から追加される .modal（例: DataTable の詳細ソート/絞込ダイアログ）も拾う
    new MutationObserver((muts) => {
      muts.forEach((mu) => mu.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.matches && n.matches('.modal')) watch(n);
        if (n.querySelectorAll) n.querySelectorAll('.modal').forEach(watch);
      }));
    }).observe(document.body, { childList: true, subtree: true });
  });
  document.addEventListener('keydown', (e) => {
    if (!activeModal) return;
    if (e.key === 'Escape') {
      const m = activeModal;
      m.classList.remove('show');
      setTimeout(() => { m.hidden = true; }, 200);   // 各モックの closeModal と同じ挙動
      return;
    }
    if (e.key === 'Tab') {
      const els = focusables(activeModal);
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
})();

/* --- 入力バリデーションのインラインエラー（alert() の代替・標準ヘルパー） ---
   使い方: clearFieldErrors(モーダルパネル) でリセット → 必須未入力等に setFieldError(input, '文言')。
   最初のエラーフィールドへフォーカスする（呼び出し側で focusFirstError も可）。 */
function clearFieldErrors(root) {
  (root || document).querySelectorAll('.field__error').forEach(e => e.remove());
  (root || document).querySelectorAll('[aria-invalid="true"]').forEach(e => e.removeAttribute('aria-invalid'));
}
function setFieldError(input, message) {
  if (!input) return;
  input.setAttribute('aria-invalid', 'true');
  const host = input.closest('.form-row, .field') || input.parentElement;
  let err = host.querySelector('.field__error');
  if (!err) { err = document.createElement('div'); err.className = 'field__error'; host.appendChild(err); }
  err.textContent = message;
}
window.clearFieldErrors = clearFieldErrors;
window.setFieldError = setFieldError;

/* --- モーダルのドラッグ移動＋最大化（共通部品・.modal--draggable / .modal--maximizable で opt-in） ---
   ・ドラッグ: .modal__header（または旧 .modal__drag）を掴んで .modal__panel を移動（position:fixed）。
     中のボタン（×/最大化）や入力は起点にしない。最大化中・モバイル幅では無効。画面外へ出さない。
   ・最大化: shared.js が ⤢/⤡ ボタンをヘッダーに差し込み、.is-max（画面ほぼ全体）をトグル。復元で中央へ。
   各画面は挙動を持たず、フラグ（クラス）で使う/使わないを宣言するだけ＝1部品・挙動共通。 */
(function () {
  const HANDLE = '.modal--draggable .modal__header, .modal--draggable .modal__drag';
  const panelOf = (m) => m.querySelector('.modal__panel');
  const isMobile = () => window.matchMedia('(max-width: 640px)').matches;

  // 最大化ボタンの差し込み（冪等・動的モーダルにも対応）
  function initMaximizable(m) {
    if (!m.classList.contains('modal--maximizable') || m.__iqMaxInit) return;
    const header = m.querySelector('.modal__header, .modal__drag'); if (!header) return;
    m.__iqMaxInit = true;
    const close = header.querySelector('.modal__close');
    let tools = header.querySelector('.modal__header__tools');
    if (!tools) { tools = document.createElement('div'); tools.className = 'modal__header__tools'; header.appendChild(tools); }
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'modal__maxbtn'; btn.setAttribute('aria-label', '最大化'); btn.textContent = '⤢';
    tools.appendChild(btn);
    if (close) tools.appendChild(close);   // ×をツール群の末尾へ移動（⤢ の右）
    btn.addEventListener('click', () => {
      const p = panelOf(m); if (!p) return;
      const max = p.classList.toggle('is-max');
      p.style.position = ''; p.style.left = ''; p.style.top = ''; p.style.margin = ''; p.style.width = '';  // 位置・幅リセット
      btn.textContent = max ? '⤡' : '⤢';
      btn.setAttribute('aria-label', max ? '元のサイズに戻す' : '最大化');
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.modal--maximizable').forEach(initMaximizable);
    // 動的に追加される最大化可能モーダル（DataTable のダイアログ等）も拾う
    new MutationObserver((muts) => {
      muts.forEach((mu) => mu.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.matches && n.matches('.modal--maximizable')) initMaximizable(n);
        if (n.querySelectorAll) n.querySelectorAll('.modal--maximizable').forEach(initMaximizable);
      }));
    }).observe(document.body, { childList: true, subtree: true });
  });

  // ドラッグ
  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    if (isMobile()) return;
    if (e.target.closest('button, a, input, select, textarea, .modal__header__tools')) return;
    const handle = e.target.closest(HANDLE); if (!handle) return;
    const m = handle.closest('.modal'); const p = m && panelOf(m);
    if (!p || p.classList.contains('is-max')) return;
    const r = p.getBoundingClientRect();
    drag = { p, dx: e.clientX - r.left, dy: e.clientY - r.top };
    p.classList.add('is-dragging');
    p.style.position = 'fixed'; p.style.margin = '0'; p.style.width = r.width + 'px';  // fixed 化で幅が崩れないよう固定
    p.style.left = r.left + 'px'; p.style.top = r.top + 'px';
    e.preventDefault();
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { p, dx, dy } = drag;
    const x = Math.max(0, Math.min(window.innerWidth - p.offsetWidth, e.clientX - dx));
    const y = Math.max(0, Math.min(window.innerHeight - p.offsetHeight, e.clientY - dy));
    p.style.left = x + 'px'; p.style.top = y + 'px';
  });
  document.addEventListener('pointerup', () => { if (drag) { drag.p.classList.remove('is-dragging'); drag = null; } });
})();

/* --- 一覧の操作標準（DataTable）---------------------------------------------
   一覧に「ソート（単一列/詳細=複数キー）・絞り込み（横断/詳細=項目別）・番号ページャ・
   列幅調整・列の表示/非表示/並べ替え・CSVエクスポート・表示密度・行の固定（ピン）」を
   まとめて付与する共通部品。正＝doc/画面設計/デザイン標準.md「一覧の操作標準」。
   使い方: DataTable.init(rootEl, config)。config は当該画面が列定義とデータを宣言する。
   （モックは全件クライアント保持で挙動を再現。実装では複数ソートキー/項目別フィルタ/
    CSV/ピンID取得を一覧APIのクエリ契約として backend に委譲する。） */
window.DataTable = (function () {
  const LS = 'ideaquest_dt_';
  const load = (k) => { try { return JSON.parse(localStorage.getItem(LS + k) || 'null'); } catch (e) { return null; } };
  const save = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const stripTags = (h) => { const d = document.createElement('div'); d.innerHTML = h; return (d.textContent || '').trim(); };

  function init(root, cfg) {
    const cols = cfg.columns.map((c) => ({ resizable: !c.actions, sortable: false, ...c }));
    const dataCols = cols.filter((c) => !c.actions);
    const actionsCol = cols.find((c) => c.actions) || null;
    const colByKey = Object.fromEntries(cols.map((c) => [c.key, c]));
    const rowId = cfg.rowId || ((r) => r.id);
    const unit = cfg.unit || '件';
    const perPageOptions = cfg.perPageOptions || [10, 20, 50, 100];
    // カード表示の指定は2通り: cfg.card(r)=中身HTMLを返す関数（自由）／cfg.cardLayout(r)=
    // {title,badges:[{label,cls}],meta:[..],stats:[..]} を返す（標準構造ヘルパ・記述量を削減）。
    // どちらか与えると「テーブル/カード」表示切替が有効（未指定＝従来どおりテーブルのみ）。
    const hasCard = typeof cfg.card === 'function' || typeof cfg.cardLayout === 'function';
    const sortableCols = dataCols.filter((c) => c.sortable);

    // ---- 永続状態（列順/非表示/幅/密度/ピン）＋セッション状態（検索/ソート/絞込/ページ） ----
    const persisted = load(cfg.storageKey) || {};
    const defaultOrder = dataCols.map((c) => c.key);
    const validOrder = (persisted.order || defaultOrder).filter((k) => colByKey[k] && !colByKey[k].actions);
    dataCols.forEach((c) => { if (!validOrder.includes(c.key)) validOrder.push(c.key); }); // 新列を末尾補完
    const st = {
      search: '', simpleSort: null, advSort: [], filters: {}, page: 1,
      perPage: persisted.perPage || cfg.perPage || 20,
      density: persisted.density || 'normal',
      order: validOrder,
      hidden: (persisted.hidden || dataCols.filter((c) => c.hiddenDefault).map((c) => c.key)).filter((k) => colByKey[k]),
      widths: persisted.widths || {},
      pins: persisted.pins || [],
      view: (hasCard && (persisted.view || cfg.defaultView)) || 'list', // 'list' | 'card'（card はカード指定時のみ）
    };
    function persist() { save(cfg.storageKey, { order: st.order, hidden: st.hidden, widths: st.widths, density: st.density, pins: st.pins, perPage: st.perPage, view: st.view }); }
    if (!perPageOptions.includes(st.perPage)) { perPageOptions.push(st.perPage); perPageOptions.sort((a, b) => a - b); } // 現在値を必ず選択肢に

    function visibleDataCols() { return st.order.map((k) => colByKey[k]).filter((c) => c && !st.hidden.includes(c.key)); }
    function visibleCols() { return actionsCol ? visibleDataCols().concat([actionsCol]) : visibleDataCols(); }

    // ---- パイプライン：検索→絞込→ソート→ピン分離→ページ ----
    function searchText(r) {
      const sc = dataCols.filter((c) => c.searchVal);
      const src = sc.length ? sc.map((c) => c.searchVal(r)) : dataCols.map((c) => (c.sortVal ? c.sortVal(r) : ''));
      return src.join(' ').toLowerCase();
    }
    function matchFilters(r) {
      return Object.keys(st.filters).every((key) => {
        const col = colByKey[key]; if (!col) return true;
        const cond = st.filters[key];
        const v = col.filterVal ? col.filterVal(r) : (col.sortVal ? col.sortVal(r) : '');
        if (cond.type === 'text') return String(v).toLowerCase().includes(String(cond.q).toLowerCase());
        if (cond.type === 'enum') return cond.values.includes(String(v));
        if (cond.type === 'number') { const n = Number(v); return (cond.min == null || n >= cond.min) && (cond.max == null || n <= cond.max); }
        if (cond.type === 'date') return (!cond.from || String(v) >= cond.from) && (!cond.to || String(v) <= cond.to);
        return true;
      });
    }
    function activeSort() { return st.advSort.length ? st.advSort : (st.simpleSort ? [st.simpleSort] : []); }
    function comparator(a, b) {
      for (const s of activeSort()) {
        const col = colByKey[s.key]; if (!col || !col.sortVal) continue;
        const va = col.sortVal(a), vb = col.sortVal(b);
        const d = (typeof va === 'number' && typeof vb === 'number') ? va - vb : String(va).localeCompare(String(vb), 'ja');
        if (d) return s.dir === 'desc' ? -d : d;
      }
      return 0;
    }
    function compute() {
      const sorted = activeSort().length ? cfg.data.slice().sort(comparator) : cfg.data.slice();
      const pinnedIds = st.pins;
      const pinned = sorted.filter((r) => pinnedIds.includes(String(rowId(r))));
      const filtered = sorted.filter((r) => {
        if (pinnedIds.includes(String(rowId(r)))) return false;
        if (st.search && !searchText(r).includes(st.search.toLowerCase())) return false;
        return matchFilters(r);
      });
      return { pinned, filtered };
    }

    // ---- スケルトン構築 ----
    root.innerHTML = `
      <div class="list-toolbar" data-dt-toolbar>
        <div class="filters">
          <div class="dt-search">
            <input class="input" type="search" data-dt-search placeholder="${esc(cfg.searchPlaceholder || '検索…')}">
            ${cfg.searchFields ? `<span class="dt-search__hint">${esc(cfg.searchFields)} を検索</span>` : ''}
          </div>
          <button class="btn btn-outline btn-sm" type="button" data-dt-filter>詳細絞込</button>
          <button class="btn btn-outline btn-sm" type="button" data-dt-sort>詳細ソート</button>
          ${hasCard && sortableCols.length ? `<label class="dt-cardsort" data-dt-card-only hidden>並び替え
            <select class="select" data-dt-cardsort aria-label="並び替え（カード表示）">
              <option value="">なし</option>
              ${sortableCols.map((c) => `<option value="${esc(c.key)}:asc">${esc(c.label)} ↑</option><option value="${esc(c.key)}:desc">${esc(c.label)} ↓</option>`).join('')}
            </select></label>` : ''}
          <button class="btn btn-sm" type="button" data-dt-clear hidden>絞り込み・並び替えをクリア</button>
        </div>
        <div class="tools">
          <span class="seg seg-density" role="group" aria-label="表示密度">
            <button class="seg__btn" type="button" data-dt-density="normal">標準</button>
            <button class="seg__btn" type="button" data-dt-density="compact">コンパクト</button>
          </span>
          <button class="btn btn-outline btn-sm" type="button" data-dt-cols data-dt-table-only>列設定</button>
          <button class="btn btn-outline btn-sm" type="button" data-dt-export>エクスポート</button>
          ${hasCard ? `<div class="viewtoggle" role="radiogroup" aria-label="表示切替">
            <button type="button" role="radio" data-dt-view="card" title="カード表示">🔲 カード</button>
            <button type="button" role="radio" data-dt-view="list" title="リスト表示">☰ リスト</button>
          </div>` : ''}
        </div>
        <div class="dt-chips" data-dt-chips></div>
      </div>
      <div class="table-wrap dt-scroll" data-dt-wrap>
        <table class="table dt-fixed"><thead data-dt-head></thead><tbody data-dt-body></tbody></table>
      </div>
      ${hasCard ? '<div class="dt-cards" data-dt-cards role="list" hidden></div>' : ''}
      <div class="list-empty" data-dt-empty hidden>該当するデータがありません。</div>
      <div class="dt-footer" data-dt-footer>
        <span class="list-count" data-dt-count></span>
        <nav class="pagination" data-dt-pager aria-label="ページ送り" hidden></nav>
        <label class="dt-perpage">表示
          <select class="select" data-dt-perpage aria-label="1ページの表示件数">${perPageOptions.map((n) => `<option value="${n}">${n}</option>`).join('')}</select>
          件</label>
      </div>`;
    const $ = (s) => root.querySelector(s);
    const searchEl = $('[data-dt-search]'), headEl = $('[data-dt-head]'), bodyEl = $('[data-dt-body]'),
      countEl = $('[data-dt-count]'), chipsEl = $('[data-dt-chips]'), pagerEl = $('[data-dt-pager]'),
      emptyEl = $('[data-dt-empty]'), wrapEl = $('[data-dt-wrap]'), tableEl = wrapEl.querySelector('table'),
      cardsEl = $('[data-dt-cards]');

    function renderHead() {
      const vc = visibleCols();
      const advOn = st.advSort.length > 0;
      headEl.innerHTML = '<tr>' + vc.map((c) => {
        const cls = [c.align === 'num' ? 'num' : '', c.actions ? 'col-actions' : '', c.sortable ? 'dt-sortable' : '', (c.sortable && advOn) ? 'is-locked-sort' : ''].filter(Boolean).join(' ');
        let aria = '';
        if (c.sortable) { const s = (!advOn && st.simpleSort && st.simpleSort.key === c.key) ? st.simpleSort.dir : 'none'; aria = ` aria-sort="${s === 'asc' ? 'ascending' : s === 'desc' ? 'descending' : 'none'}"`; }
        const w = st.widths[c.key] || c.width;
        const style = w ? ` style="width:${w}px"` : '';
        const ind = c.sortable ? '<span class="dt-sort-ind"></span>' : '';
        const resizer = c.resizable ? `<span class="dt-resizer" data-dt-resizer="${esc(c.key)}"></span>` : '';
        return `<th scope="col" class="${cls}"${aria}${style} data-key="${esc(c.key)}"><div class="dt-th"><span class="dt-th__label">${esc(c.label)}</span>${ind}</div>${resizer}</th>`;
      }).join('') + '</tr>';
    }

    function rowHtml(r, pinned) {
      const vc = visibleCols();
      const id = esc(String(rowId(r)));
      const tds = vc.map((c, i) => {
        const cls = [c.align === 'num' ? 'num' : '', c.actions ? 'col-actions' : '', c.cellClass || ''].filter(Boolean).join(' ');
        let inner = c.render ? c.render(r) : esc(c.sortVal ? c.sortVal(r) : '');
        if (i === 0) {
          // ピン中は 📌（固定済み）、未ピンは 📍（この行を固定できる）でアイコンを切替。
          const pin = `<button class="dt-pin-toggle" type="button" data-dt-pin="${id}" aria-pressed="${pinned ? 'true' : 'false'}" title="${pinned ? '固定を解除' : 'この行を固定'}">${pinned ? '📌' : '📍'}</button>`;
          inner = `<span style="display:inline-flex;align-items:center;gap:6px;min-width:0">${pin}${inner}</span>`;
        }
        return `<td class="${cls}">${inner}</td>`;
      }).join('');
      return `<tr data-dt-row="${id}"${pinned ? ' class="is-pinned"' : ''}>${tds}</tr>`;
    }

    // カード本文。cfg.card（自由HTML）優先。無ければ cfg.cardLayout（標準構造ヘルパ）で組み立てる。
    function buildCardBody(r) {
      if (typeof cfg.card === 'function') return cfg.card(r);
      const L = cfg.cardLayout(r) || {};
      const badges = (L.badges || []).filter(Boolean).map((b) => `<span class="badge ${b.cls || 'badge-muted'}">${esc(b.label)}</span>`).join('');
      const meta = (L.meta || []).filter((x) => x != null && x !== '').map((m) => `<span>${esc(m)}</span>`).join('');
      const stats = (L.stats || []).filter((x) => x != null && x !== '').map((s) => `<span>${esc(s)}</span>`).join('');
      return (L.title != null ? `<div class="dt-card__title">${esc(L.title)}</div>` : '')
        + (badges || meta ? `<div class="dt-card__meta">${badges}${meta}</div>` : '')
        + (stats ? `<div class="dt-card__stats">${stats}</div>` : '');
    }

    // カード1枚。右上のツール（行固定トグル＋操作列の ⋯ アクションメニュー）を本文の上に重ねる。
    // 操作列（actions:true）を定義していれば、テーブルと同じ RowMenu をカードにも自動表示する。
    function cardHtml(r, pinned) {
      const id = esc(String(rowId(r)));
      const clickable = typeof cfg.onRowClick === 'function';
      const cls = ['dt-card', pinned ? 'is-pinned' : '', clickable ? 'dt-card--link' : '', actionsCol ? 'dt-card--has-actions' : ''].filter(Boolean).join(' ');
      const pin = `<button class="dt-pin-toggle" type="button" data-dt-pin="${id}" aria-pressed="${pinned ? 'true' : 'false'}" title="${pinned ? '固定を解除' : 'この行を固定'}">${pinned ? '📌' : '📍'}</button>`;
      const acts = actionsCol && actionsCol.render ? actionsCol.render(r) : '';
      const a11y = ` role="listitem"${clickable ? ' tabindex="0"' : ''}`; // クリック可時はキーボード操作（Enter/Space）
      return `<div class="${cls}" data-dt-row="${id}"${a11y}><div class="dt-card__tools">${pin}${acts}</div><div class="dt-card__body">${buildCardBody(r)}</div></div>`;
    }

    function renderPager(total) {
      const pages = Math.max(1, Math.ceil(total / st.perPage));
      if (st.page > pages) st.page = pages;
      if (pages <= 1) { pagerEl.hidden = true; return; }
      pagerEl.hidden = false;
      const cur = st.page, win = 2, nums = [];
      for (let p = 1; p <= pages; p++) { if (p === 1 || p === pages || (p >= cur - win && p <= cur + win)) nums.push(p); else if (nums[nums.length - 1] !== '…') nums.push('…'); }
      const btn = (label, page, opts) => { opts = opts || {}; return `<button class="btn btn-outline btn-sm ${opts.cls || ''}" type="button" ${opts.disabled ? 'disabled' : ''} data-dt-page="${page}" aria-label="${opts.aria || ''}">${label}</button>`; };
      pagerEl.innerHTML =
        btn('«', 1, { disabled: cur <= 1, aria: '最初のページ' }) +
        btn('‹', cur - 1, { disabled: cur <= 1, aria: '前のページ' }) +
        nums.map((n) => n === '…' ? '<span class="pagination__ellipsis">…</span>' : btn(n, n, { cls: 'pagination__page' + (n === cur ? ' is-current' : ''), aria: n + 'ページ目' })).join('') +
        btn('›', cur + 1, { disabled: cur >= pages, aria: '次のページ' }) +
        btn('»', pages, { disabled: cur >= pages, aria: '最後のページ' });
    }

    function labelOf(k) { return colByKey[k] ? colByKey[k].label : k; }
    function enumLabel(key, v) { const col = colByKey[key]; const o = col && col.filter && col.filter.options && col.filter.options.find((x) => x[0] === v); return o ? o[1] : v; }
    function filterSummary(c) {
      if (c.type === 'text') return '「' + c.q + '」を含む';
      if (c.type === 'enum') return c.values.map((v) => enumLabel(c.key, v)).join('・');
      if (c.type === 'number') return (c.min != null ? c.min : '') + '〜' + (c.max != null ? c.max : '');
      if (c.type === 'date') return (c.from || '') + '〜' + (c.to || '');
      return '';
    }
    function setBadge(sel, n) {
      const btn = root.querySelector(sel); if (!btn) return;
      let b = btn.querySelector('.dt-badge');
      if (n > 0) { if (!b) { b = document.createElement('span'); b.className = 'dt-badge'; btn.appendChild(b); } b.textContent = n; }
      else if (b) b.remove();
    }
    function renderChips() {
      const chips = [];
      if (st.advSort.length) chips.push(`<span class="dt-chip">詳細ソート: ${st.advSort.map((s) => esc(labelOf(s.key)) + (s.dir === 'desc' ? '▼' : '▲')).join(' › ')}<button class="dt-chip__x" type="button" data-dt-chip="sort" aria-label="詳細ソートを解除">✕</button></span>`);
      Object.keys(st.filters).forEach((k) => { chips.push(`<span class="dt-chip">${esc(labelOf(k))}: ${esc(filterSummary(st.filters[k]))}<button class="dt-chip__x" type="button" data-dt-chip="filter:${esc(k)}" aria-label="絞込を解除">✕</button></span>`); });
      chipsEl.innerHTML = chips.length ? `<span class="dt-chips__label">適用中:</span>` + chips.join('') + `<button class="dt-chip dt-chip--clear" type="button" data-dt-clear2>すべてクリア</button>` : '';
      setBadge('[data-dt-sort]', st.advSort.length);
      setBadge('[data-dt-filter]', Object.keys(st.filters).length);
    }

    function render() {
      searchEl.value = st.search;
      const ppEl = root.querySelector('[data-dt-perpage]'); if (ppEl) ppEl.value = String(st.perPage);
      root.querySelectorAll('[data-dt-density]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dtDensity === st.density)));
      tableEl.classList.toggle('table--compact', st.density === 'compact');
      if (cardsEl) cardsEl.classList.toggle('dt-cards--compact', st.density === 'compact'); // 密度はカードにも効かせる
      const { pinned, filtered } = compute();
      renderHead();
      const totalNonPin = filtered.length;
      // カレントページのクランプは「スライスの前」に行う（ピン増加などで非固定件数が減って
      // カレントページが範囲外になった時に、空ページ表示＋ページャ消失で戻れなくなるのを防ぐ）。
      const pages = Math.max(1, Math.ceil(totalNonPin / st.perPage));
      st.page = Math.min(Math.max(1, st.page), pages);
      const start = (st.page - 1) * st.perPage;
      const pageRows = filtered.slice(start, start + st.perPage);
      const useCard = hasCard && st.view === 'card';
      const isEmpty = (totalNonPin + pinned.length) === 0;
      if (useCard) {
        // カードビュー：ソート/絞込/ページング/ピンは共通パイプラインの結果をそのまま使う。
        cardsEl.innerHTML = pinned.map((r) => cardHtml(r, true)).join('') + pageRows.map((r) => cardHtml(r, false)).join('');
        cardsEl.hidden = isEmpty; wrapEl.hidden = true;
      } else {
        bodyEl.innerHTML = pinned.map((r) => rowHtml(r, true)).join('') + pageRows.map((r) => rowHtml(r, false)).join('');
        // 固定行：最後の1行に区切り線＋固定ヘッダー配下で段積み sticky（top を累積）
        const pinnedTrs = bodyEl.querySelectorAll('tr.is-pinned');
        if (pinnedTrs.length) {
          pinnedTrs[pinnedTrs.length - 1].classList.add('dt-pin-sep');
          let top = headEl.offsetHeight;
          pinnedTrs.forEach((tr) => { tr.style.setProperty('--dt-row-top', top + 'px'); top += tr.offsetHeight; });
        }
        wrapEl.hidden = isEmpty; if (cardsEl) cardsEl.hidden = true;
      }
      // 表示切替トグルの状態反映（radiogroup）／テーブル専用ツール（列設定）はカード時隠す／
      // カード専用（カード用並び替えセレクト）はテーブル時隠す。
      if (hasCard) {
        root.querySelectorAll('[data-dt-view]').forEach((b) => { const on = b.dataset.dtView === st.view; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
        root.querySelectorAll('[data-dt-table-only]').forEach((el) => { el.hidden = useCard; });
        root.querySelectorAll('[data-dt-card-only]').forEach((el) => { el.hidden = !useCard; });
        const cs = root.querySelector('[data-dt-cardsort]');
        if (cs) { const adv = st.advSort.length > 0; cs.disabled = adv; cs.value = (!adv && st.simpleSort) ? (st.simpleSort.key + ':' + st.simpleSort.dir) : ''; cs.title = adv ? '詳細ソートが有効です（クリアで単一の並び替えに戻せます）' : ''; }
      }
      countEl.textContent = totalNonPin + ' ' + unit + (pinned.length ? `（＋固定 ${pinned.length}）` : '');
      emptyEl.hidden = !isEmpty;
      renderPager(totalNonPin);
      renderChips();
      const anyFilter = st.search || Object.keys(st.filters).length || st.advSort.length || st.simpleSort;
      root.querySelector('[data-dt-clear]').hidden = !anyFilter;
      requestAnimationFrame(() => { wrapEl.style.setProperty('--dt-head-h', headEl.offsetHeight + 'px'); });
    }

    // ===== イベント =====
    searchEl.addEventListener('input', () => { st.search = searchEl.value.trim(); st.page = 1; render(); });
    function clearAll() { st.search = ''; st.simpleSort = null; st.advSort = []; st.filters = {}; st.page = 1; render(); }
    root.querySelector('[data-dt-clear]').addEventListener('click', clearAll);
    root.querySelectorAll('[data-dt-density]').forEach((b) => b.addEventListener('click', () => { st.density = b.dataset.dtDensity; persist(); render(); }));
    { const pp = root.querySelector('[data-dt-perpage]'); if (pp) pp.addEventListener('change', () => { st.perPage = Number(pp.value); st.page = 1; persist(); render(); }); }

    headEl.addEventListener('click', (e) => {
      if (e.target.closest('.dt-resizer')) return;
      const th = e.target.closest('th.dt-sortable'); if (!th || st.advSort.length) return;
      const key = th.dataset.key;
      const cur = st.simpleSort && st.simpleSort.key === key ? st.simpleSort.dir : null;
      st.simpleSort = cur === 'asc' ? { key, dir: 'desc' } : cur === 'desc' ? null : { key, dir: 'asc' };
      st.page = 1; render();
    });
    headEl.addEventListener('pointerdown', (e) => {
      const h = e.target.closest('[data-dt-resizer]'); if (!h) return;
      e.preventDefault();
      const key = h.dataset.dtResizer, th = h.closest('th');
      const startX = e.clientX, startW = th.getBoundingClientRect().width;
      document.body.classList.add('dt-resizing'); h.classList.add('dt-resizer--active');
      function move(ev) { const w = Math.max(64, startW + (ev.clientX - startX)); st.widths[key] = Math.round(w); th.style.width = w + 'px'; }
      function up() { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.body.classList.remove('dt-resizing'); h.classList.remove('dt-resizer--active'); persist(); }
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    });
    headEl.addEventListener('dblclick', (e) => { const h = e.target.closest('[data-dt-resizer]'); if (!h) return; delete st.widths[h.dataset.dtResizer]; persist(); render(); });

    function onListClick(e) {
      const pin = e.target.closest('[data-dt-pin]');
      if (pin) { e.stopPropagation(); const id = pin.dataset.dtPin; const i = st.pins.indexOf(id); if (i >= 0) st.pins.splice(i, 1); else { if (st.pins.length >= (cfg.maxPins || 5)) { alert('固定できる行は最大 ' + (cfg.maxPins || 5) + ' 件です。'); return; } st.pins.push(id); } persist(); render(); return; }
      if (e.target.closest('a,button,input,select,label')) return;
      if (!cfg.onRowClick) return;
      const el = e.target.closest('[data-dt-row]'); if (!el) return;
      const r = cfg.data.find((x) => String(rowId(x)) === el.dataset.dtRow); if (r) cfg.onRowClick(r);
    }
    bodyEl.addEventListener('click', onListClick);
    if (cardsEl) {
      cardsEl.addEventListener('click', onListClick);
      // クリック可能カードはキーボード（Enter/Space）でも行クリックを発火（a11y）。
      cardsEl.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.target.closest('a,button,input,select,label')) return;
        const el = e.target.closest('.dt-card'); if (!el || !cfg.onRowClick) return;
        e.preventDefault();
        const r = cfg.data.find((x) => String(rowId(x)) === el.dataset.dtRow); if (r) cfg.onRowClick(r);
      });
    }
    if (hasCard) {
      root.querySelectorAll('[data-dt-view]').forEach((b) => b.addEventListener('click', () => { if (st.view === b.dataset.dtView) return; st.view = b.dataset.dtView; persist(); render(); }));
      // 表示切替（radiogroup）の矢印キー操作。
      const vg = root.querySelector('.viewtoggle');
      if (vg) vg.addEventListener('keydown', (e) => {
        if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].indexOf(e.key) < 0) return;
        e.preventDefault();
        st.view = st.view === 'card' ? 'list' : 'card'; persist(); render();
        const cur = vg.querySelector('[data-dt-view="' + st.view + '"]'); if (cur) cur.focus();
      });
      // カード用の単一並び替えセレクト。詳細ソート適用中は無効（render で disabled）。
      const cs = root.querySelector('[data-dt-cardsort]');
      if (cs) cs.addEventListener('change', () => { const v = cs.value; if (!v) { st.simpleSort = null; } else { const p = v.split(':'); st.simpleSort = { key: p[0], dir: p[1] }; st.advSort = []; } st.page = 1; render(); });
    }
    pagerEl.addEventListener('click', (e) => { const b = e.target.closest('[data-dt-page]'); if (!b || b.disabled) return; st.page = Number(b.dataset.dtPage); render(); });
    chipsEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-dt-clear2]')) return clearAll();
      const x = e.target.closest('[data-dt-chip]'); if (!x) return;
      const t = x.dataset.dtChip;
      if (t === 'sort') st.advSort = []; else if (t.indexOf('filter:') === 0) delete st.filters[t.slice(7)];
      st.page = 1; render();
    });

    root.querySelector('[data-dt-sort]').addEventListener('click', openSortBuilder);
    root.querySelector('[data-dt-filter]').addEventListener('click', openFilterDialog);
    root.querySelector('[data-dt-cols]').addEventListener('click', openColMenu);
    root.querySelector('[data-dt-export]').addEventListener('click', exportCsv);

    function exportCsv() {
      const { filtered } = compute();
      const vc = visibleDataCols();
      const head = vc.map((c) => c.label);
      const cell = (c, r) => c.csvVal ? c.csvVal(r) : c.sortVal ? c.sortVal(r) : stripTags(c.render ? c.render(r) : '');
      const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
      const csv = [head.map(q).join(',')].concat(filtered.map((r) => vc.map((c) => q(cell(c, r))).join(','))).join('\r\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = (cfg.exportName || 'export') + '.csv'; a.click(); URL.revokeObjectURL(a.href);
    }

    function dialog(title, bodyHtml, footerHtml, size) {
      const el = document.createElement('div');
      el.className = 'modal modal--' + (size || 'md') + ' modal--draggable modal--maximizable';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
      el.innerHTML = `<div class="modal__backdrop" data-close></div><div class="modal__panel sectioned">
        <div class="modal__header"><h2>${esc(title)}</h2><button class="modal__close" type="button" aria-label="閉じる" data-close>✕</button></div>
        <div class="modal__body">${bodyHtml}</div><div class="modal__footer">${footerHtml}</div></div>`;
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
      function close() { el.classList.remove('show'); document.removeEventListener('keydown', onEsc); setTimeout(() => el.remove(), 200); }
      function onEsc(ev) { if (ev.key === 'Escape') close(); }
      el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
      document.addEventListener('keydown', onEsc);
      return { el, close };
    }

    function openSortBuilder() {
      let work = st.advSort.length ? st.advSort.map((s) => ({ ...s })) : (st.simpleSort ? [{ ...st.simpleSort }] : []);
      const sortable = dataCols.filter((c) => c.sortable);
      const body = `<p class="admin-sub" style="margin:0 0 var(--space-3)">右の項目をクリックすると並び替え条件に追加されます。左は上ほど優先。</p>
        <div class="sort-builder">
          <div class="sort-builder__pane"><div class="sort-builder__title">並び替え条件（上ほど優先）</div><ul class="sort-builder__list" data-keys></ul></div>
          <div class="sort-builder__pane"><div class="sort-builder__title">対象外の項目</div><ul class="sort-builder__list" data-avail></ul></div>
        </div>`;
      const foot = `<button class="btn btn-outline" type="button" data-clear>この条件をクリア</button><span style="flex:1"></span><button class="btn btn-outline" type="button" data-close>キャンセル</button><button class="btn btn-primary" type="button" data-apply>適用する</button>`;
      const dlg = dialog('詳細ソート（複数項目）', body, foot, 'md');
      const keysEl = dlg.el.querySelector('[data-keys]'), availEl = dlg.el.querySelector('[data-avail]'), builder = dlg.el.querySelector('.sort-builder');
      function paint() {
        keysEl.innerHTML = work.length ? work.map((s, i) => {
          const up = i === 0 ? 'disabled' : '', dn = i === work.length - 1 ? 'disabled' : '';
          return `<li class="sort-key" data-k="${esc(s.key)}"><span class="sort-key__ord"><button type="button" data-up ${up} aria-label="上へ">▲</button><button type="button" data-dn ${dn} aria-label="下へ">▼</button></span><span class="sort-key__pri">${i + 1}</span><span class="sort-key__name" title="${esc(labelOf(s.key))}">${esc(labelOf(s.key))}</span><span class="seg"><button type="button" class="seg__btn" data-dir="asc" aria-pressed="${s.dir === 'asc'}">昇順</button><button type="button" class="seg__btn" data-dir="desc" aria-pressed="${s.dir === 'desc'}">降順</button></span><button type="button" class="sort-key__x" data-remove aria-label="除外">✕</button></li>`;
        }).join('') : '<li class="sort-builder__empty">条件なし（右から追加）</li>';
        const used = work.map((s) => s.key);
        const avail = sortable.filter((c) => !used.includes(c.key));
        availEl.innerHTML = avail.length ? avail.map((c) => `<li class="sort-avail" data-k="${esc(c.key)}" data-add="${esc(c.key)}"><span title="${esc(c.label)}">${esc(c.label)}</span><span class="sort-avail__add">＋ 追加</span></li>`).join('') : '<li class="sort-builder__empty">すべて条件に追加済み</li>';
      }
      function flip(mutate) {
        const before = new Map(); builder.querySelectorAll('[data-k]').forEach((el) => before.set(el.dataset.k, el.getBoundingClientRect()));
        mutate(); paint();
        builder.querySelectorAll('[data-k]').forEach((el) => {
          const f = before.get(el.dataset.k), l = el.getBoundingClientRect();
          if (!f) { el.style.opacity = '0'; requestAnimationFrame(() => { el.classList.add('dt-flip'); el.style.opacity = '1'; }); return; }
          const dx = f.left - l.left, dy = f.top - l.top;
          if (dx || dy) { el.style.transition = 'none'; el.style.transform = `translate(${dx}px,${dy}px)`; requestAnimationFrame(() => { el.classList.add('dt-flip'); el.style.transform = ''; el.style.transition = ''; }); }
        });
      }
      paint();
      dlg.el.addEventListener('click', (e) => {
        const add = e.target.closest('[data-add]'), rm = e.target.closest('[data-remove]'), up = e.target.closest('[data-up]'), dn = e.target.closest('[data-dn]'), dir = e.target.closest('[data-dir]'), li = e.target.closest('.sort-key');
        if (add) return flip(() => work.push({ key: add.dataset.add, dir: 'asc' }));
        if (rm && li) return flip(() => { const i = work.findIndex((s) => s.key === li.dataset.k); if (i >= 0) work.splice(i, 1); });
        if (up && li) { const i = work.findIndex((s) => s.key === li.dataset.k); if (i > 0) return flip(() => { const t = work[i - 1]; work[i - 1] = work[i]; work[i] = t; }); }
        if (dn && li) { const i = work.findIndex((s) => s.key === li.dataset.k); if (i < work.length - 1) return flip(() => { const t = work[i + 1]; work[i + 1] = work[i]; work[i] = t; }); }
        if (dir && li) { const s = work.find((x) => x.key === li.dataset.k); if (s) { s.dir = dir.dataset.dir; paint(); } }
        if (e.target.closest('[data-clear]')) { work = []; paint(); }
        if (e.target.closest('[data-apply]')) { st.advSort = work; if (work.length) st.simpleSort = null; st.page = 1; dlg.close(); render(); }
      });
    }

    function openFilterDialog() {
      const filterable = dataCols.filter((c) => c.filter);
      const rowHtmlF = (c) => {
        const cur = st.filters[c.key];
        if (c.filter.type === 'text') return `<div class="filter-row" data-fk="${esc(c.key)}"><label>${esc(c.label)}</label><input class="input" data-f="text" value="${cur ? esc(cur.q) : ''}" placeholder="含む文字"></div>`;
        if (c.filter.type === 'enum') return `<div class="filter-row" data-fk="${esc(c.key)}"><label>${esc(c.label)}</label><div class="filter-checks">${c.filter.options.map((o) => `<label class="checkbox"><input type="checkbox" data-f="enum" value="${esc(o[0])}" ${cur && cur.values.includes(o[0]) ? 'checked' : ''}> ${esc(o[1])}</label>`).join('')}</div></div>`;
        if (c.filter.type === 'number') return `<div class="filter-row" data-fk="${esc(c.key)}"><label>${esc(c.label)}</label><div class="filter-range"><input class="input" type="number" data-f="min" value="${cur && cur.min != null ? cur.min : ''}" placeholder="最小"><span>〜</span><input class="input" type="number" data-f="max" value="${cur && cur.max != null ? cur.max : ''}" placeholder="最大"></div></div>`;
        if (c.filter.type === 'date') return `<div class="filter-row" data-fk="${esc(c.key)}"><label>${esc(c.label)}</label><div class="filter-range"><input class="input" type="date" data-f="from" value="${cur ? esc(cur.from || '') : ''}"><span>〜</span><input class="input" type="date" data-f="to" value="${cur ? esc(cur.to || '') : ''}"></div></div>`;
        return '';
      };
      const body = `<div class="filter-form">${filterable.map(rowHtmlF).join('')}</div>`;
      const foot = `<button class="btn btn-outline" type="button" data-clear>クリア</button><span style="flex:1"></span><button class="btn btn-outline" type="button" data-close>キャンセル</button><button class="btn btn-primary" type="button" data-apply>適用する</button>`;
      const dlg = dialog('詳細絞込', body, foot, 'md');
      dlg.el.addEventListener('click', (e) => {
        if (e.target.closest('[data-clear]')) { dlg.el.querySelectorAll('input').forEach((i) => { if (i.type === 'checkbox') i.checked = false; else i.value = ''; }); return; }
        if (!e.target.closest('[data-apply]')) return;
        const next = {};
        dlg.el.querySelectorAll('.filter-row').forEach((row) => {
          const key = row.dataset.fk, col = colByKey[key], type = col.filter.type;
          if (type === 'text') { const v = row.querySelector('[data-f="text"]').value.trim(); if (v) next[key] = { type, key, q: v }; }
          else if (type === 'enum') { const vals = Array.from(row.querySelectorAll('[data-f="enum"]:checked')).map((i) => i.value); if (vals.length) next[key] = { type, key, values: vals }; }
          else if (type === 'number') { const mn = row.querySelector('[data-f="min"]').value, mx = row.querySelector('[data-f="max"]').value; if (mn !== '' || mx !== '') next[key] = { type, key, min: mn === '' ? null : Number(mn), max: mx === '' ? null : Number(mx) }; }
          else if (type === 'date') { const fr = row.querySelector('[data-f="from"]').value, to = row.querySelector('[data-f="to"]').value; if (fr || to) next[key] = { type, key, from: fr, to: to }; }
        });
        st.filters = next; st.page = 1; dlg.close(); render();
      });
    }

    let colMenuEl = null;
    function closeColMenu() { if (colMenuEl) { colMenuEl.remove(); colMenuEl = null; document.removeEventListener('click', onDocClick, true); } }
    function onDocClick(e) { if (colMenuEl && !colMenuEl.contains(e.target) && !e.target.closest('[data-dt-cols]')) closeColMenu(); }
    function openColMenu() {
      if (colMenuEl) return closeColMenu();
      const btn = root.querySelector('[data-dt-cols]'), rect = btn.getBoundingClientRect();
      colMenuEl = document.createElement('div'); colMenuEl.className = 'col-menu';
      function paint() {
        const items = st.order.map((k) => colByKey[k]).filter(Boolean);
        colMenuEl.innerHTML = `<div class="col-menu__title">表示する列・並び順</div>` + items.map((c, i) => {
          const shown = !st.hidden.includes(c.key);
          const up = (i === 0 || c.locked) ? 'disabled' : '', dn = (i === items.length - 1 || c.locked) ? 'disabled' : '';
          return `<div class="col-menu__item" data-ck="${esc(c.key)}"><label class="col-menu__grab checkbox"><input type="checkbox" data-vis ${shown ? 'checked' : ''} ${c.locked ? 'disabled' : ''}><span class="col-menu__name">${esc(c.label || '（操作）')}</span>${c.locked ? '<span class="col-menu__lock">必須</span>' : ''}</label><span class="col-menu__ord"><button type="button" data-up ${up}>▲</button><button type="button" data-dn ${dn}>▼</button></span></div>`;
        }).join('') + `<div class="col-menu__foot"><button class="btn btn-sm btn-outline" type="button" data-wreset>列幅をリセット</button><button class="btn btn-sm btn-outline" type="button" data-reset>既定に戻す</button></div>`;
      }
      paint();
      document.body.appendChild(colMenuEl);
      colMenuEl.style.top = Math.min(rect.bottom + 4, window.innerHeight - colMenuEl.offsetHeight - 8) + 'px';
      colMenuEl.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - colMenuEl.offsetWidth - 8)) + 'px';
      colMenuEl.addEventListener('click', (e) => {
        const item = e.target.closest('.col-menu__item'), key = item && item.dataset.ck;
        if ((e.target.closest('[data-up]') || e.target.closest('[data-dn]')) && key) {
          const dir = e.target.closest('[data-up]') ? -1 : 1, i = st.order.indexOf(key), j = i + dir;
          if (j >= 0 && j < st.order.length && !colByKey[st.order[j]].locked && !colByKey[key].locked) { const t = st.order[i]; st.order[i] = st.order[j]; st.order[j] = t; persist(); paint(); render(); }
          return;
        }
        if (e.target.closest('[data-wreset]')) { st.widths = {}; persist(); render(); return; }
        if (e.target.closest('[data-reset]')) { st.order = defaultOrder.slice(); st.hidden = dataCols.filter((c) => c.hiddenDefault).map((c) => c.key); st.widths = {}; persist(); paint(); render(); return; }
      });
      colMenuEl.addEventListener('change', (e) => {
        const cb = e.target.closest('[data-vis]'); if (!cb) return;
        const key = cb.closest('.col-menu__item').dataset.ck;
        if (cb.checked) st.hidden = st.hidden.filter((k) => k !== key); else if (!st.hidden.includes(key)) st.hidden.push(key);
        persist(); render();
      });
      setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
    }

    render();
    return { render: render, state: st };
  }
  return { init: init };
})();
