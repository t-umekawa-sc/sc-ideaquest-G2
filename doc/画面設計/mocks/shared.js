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
