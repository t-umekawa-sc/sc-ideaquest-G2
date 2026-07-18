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
