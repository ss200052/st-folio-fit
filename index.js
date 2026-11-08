/**
 * 满幅与悬浮滑块（st-folio-fit）
 *
 * 功能：
 *   1. 聊天区满幅，压掉左右固定留白，右侧零占位
 *   2. 用自绘的悬浮滑块代替原生滚动条（平时淡，按住变实）
 *   3. 头像不再占独立一列，挪到「名字 + 时间」那一行的最右端
 *
 * 结构上刻意分层：
 *   - 核心视觉功能只依赖 DOM，不依赖 ST 模块，模块加载失败也能用
 *   - 设置面板才需要 ST 的 extensions.js / script.js
 */

const MODULE_NAME = 'st-folio-fit';
const DEFAULTS = {
    full: true,        // 聊天区满幅
    slider: true,      // 悬浮滑块
    avatar: true,      // 头像挪到名字行
    avatarHeight: 40,  // 名字行里头像高度(px)
    dock: true,        // 收纳底部一堆脚本按钮
};

/* ───────────── 设置存取 ───────────── */

let extApi = null;       // { extension_settings, renderExtensionTemplateAsync }
let saveSettings = null; // ST 的 saveSettingsDebounced
const localFallback = Object.assign({}, DEFAULTS);

function settings() {
    if (extApi && extApi.extension_settings) {
        const bag = extApi.extension_settings;
        if (!bag[MODULE_NAME] || typeof bag[MODULE_NAME] !== 'object') bag[MODULE_NAME] = {};
        const s = bag[MODULE_NAME];
        for (const k of Object.keys(DEFAULTS)) {
            if (s[k] === undefined) s[k] = DEFAULTS[k];
        }
        return s;
    }
    return localFallback;
}

function persist() {
    if (typeof saveSettings === 'function') {
        try { saveSettings(); } catch (e) { /* 忽略 */ }
    }
}

/* ───────────── 滑块 ───────────── */

const THUMB_ID = 'sf-fit-thumb';
let thumb = null;
let chatEl = null;
let dragging = false;
let dragStartY = 0;
let dragStartScroll = 0;
let scheduled = false;
let hotTimer = null;

function safe(fn, label) {
    try {
        return fn();
    } catch (e) {
        if (window.console && console.warn) console.warn('[满幅与悬浮滑块] ' + label + ' 出错：', e);
        return null;
    }
}

function ensureChat() {
    const chat = document.getElementById('chat');
    if (chat) chatEl = chat;
    return !!chatEl && chatEl.isConnected;
}

function ensureThumb() {
    if (!settings().slider) {
        destroyThumb();
        return false;
    }
    if (!ensureChat()) return false;

    if (!thumb) {
        thumb = document.createElement('div');
        thumb.id = THUMB_ID;
        bindThumbEvents();
    }
    if (!thumb.isConnected) {
        (document.body || document.documentElement).appendChild(thumb);
    }
    return true;
}

function destroyThumb() {
    if (thumb) {
        thumb.remove();
        thumb = null;
    }
}

function updateThumb() {
    if (!thumb || !chatEl || !chatEl.isConnected) return;

    const viewH = chatEl.clientHeight;
    const contentH = chatEl.scrollHeight;
    if (!viewH || contentH <= viewH + 4) {
        thumb.classList.remove('sf-visible');
        return;
    }
    thumb.classList.add('sf-visible');

    const rect = chatEl.getBoundingClientRect();
    const thumbH = Math.max(32, Math.round(viewH * (viewH / contentH)));
    const maxScroll = contentH - viewH;
    let ratio = maxScroll > 0 ? (chatEl.scrollTop / maxScroll) : 0;
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;

    const y = rect.top + (rect.height - thumbH) * ratio;
    thumb.style.height = thumbH + 'px';
    thumb.style.transform = 'translateY(' + Math.round(y) + 'px)';
}

function flashHot() {
    if (!thumb || dragging) return;
    thumb.classList.add('sf-hot');
    if (hotTimer) clearTimeout(hotTimer);
    hotTimer = setTimeout(() => {
        hotTimer = null;
        if (thumb && !dragging) thumb.classList.remove('sf-hot');
    }, 300);
}

function bindThumbEvents() {
    thumb.addEventListener('pointerdown', (e) => {
        if (!chatEl) return;
        e.preventDefault();
        dragging = true;
        dragStartY = e.clientY;
        dragStartScroll = chatEl.scrollTop;
        thumb.classList.add('sf-active');
        try { thumb.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    });

    thumb.addEventListener('pointermove', (e) => {
        if (!dragging || !chatEl) return;
        const contentH = chatEl.scrollHeight;
        const viewH = chatEl.clientHeight;
        const thumbH = parseFloat(thumb.style.height) || 32;
        const scrollable = contentH - viewH;
        if (scrollable <= 0) return;

        const delta = e.clientY - dragStartY;
        const ratio = scrollable / Math.max(1, viewH - thumbH);
        chatEl.scrollTop = dragStartScroll + delta * ratio;
        schedule();
    });

    function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        thumb.classList.remove('sf-active');
        try {
            if (e && e.pointerId !== undefined) thumb.releasePointerCapture(e.pointerId);
        } catch (err) { /* 忽略 */ }
        updateThumb();
        schedule();
    }

    thumb.addEventListener('pointerup', endDrag);
    thumb.addEventListener('pointercancel', endDrag);
    thumb.addEventListener('pointerenter', () => { if (!dragging) thumb.classList.add('sf-hot'); });
    thumb.addEventListener('pointerleave', () => { if (!dragging) thumb.classList.remove('sf-hot'); });
}

/* ───────────── 头像 ───────────── */

let lastDocMode = null;
let lastAvatarRatio = 0;

function findAvatarWrap(mes) {
    const kids = mes.children;
    for (let i = 0; i < kids.length; i++) {
        if (kids[i].classList && kids[i].classList.contains('mesAvatarWrapper')) return kids[i];
    }
    return mes.querySelector('.mesAvatarWrapper');
}

function syncAvatarRatio() {
    if (!document.body) return;
    const cs = getComputedStyle(document.body);
    const w = parseFloat(cs.getPropertyValue('--avatar-base-width')) || 50;
    const h = parseFloat(cs.getPropertyValue('--avatar-base-height')) || 50;
    if (!(h > 0) || !(w > 0)) return;
    const ar = w / h;
    if (Math.abs(ar - lastAvatarRatio) < 0.01) return;
    lastAvatarRatio = ar;
    document.documentElement.style.setProperty('--sf-avatar-ar', String(ar));
}

function relocateAvatar(mes) {
    if (mes.dataset.sfFit === '1') return;
    if (mes.querySelector('.edit_textarea')) return;

    const wrap = findAvatarWrap(mes);
    if (!wrap) { mes.dataset.sfFit = '1'; return; }

    const nameRow = mes.querySelector('.ch_name');
    if (!nameRow) return;   // 名字行还没渲染，下次再试

    const avatar = wrap.querySelector('.avatar');
    if (!avatar) { mes.dataset.sfFit = '1'; return; }

    if (nameRow.contains(avatar)) { mes.dataset.sfFit = '1'; return; }

    /* ST 的 .mes_timer 是 .mesAvatarWrapper 的子元素，不能当锚点。
       名字行里的时间元素是 <small class="timestamp">。 */
    const anchor = nameRow.querySelector('.timestamp') || nameRow.querySelector('.mes_timer');
    const buttons = nameRow.querySelector('.mes_buttons');

    if (anchor) {
        anchor.insertAdjacentElement('afterend', avatar);
    } else if (buttons) {
        buttons.insertAdjacentElement('beforebegin', avatar);
    } else {
        nameRow.appendChild(avatar);
    }

    wrap.dataset.sfMoved = '1';
    mes.dataset.sfFit = '1';
}

/* 关闭开关时把头像搬回原位 */
function restoreAvatars() {
    const list = document.querySelectorAll('#chat .mes');
    for (let i = 0; i < list.length; i++) {
        const mes = list[i];
        const wrap = findAvatarWrap(mes);
        const av = mes.querySelector('.ch_name .avatar');
        if (wrap && av) {
            wrap.insertBefore(av, wrap.firstChild);
            delete wrap.dataset.sfMoved;
        }
        delete mes.dataset.sfFit;
    }
}

function scanAvatars() {
    if (!document.body) return;
    syncAvatarRatio();

    if (!settings().avatar) return;

    const isDoc = document.body.classList.contains('documentstyle');
    const list = document.querySelectorAll('#chat .mes');

    if (lastDocMode === null) {
        lastDocMode = isDoc;
    } else if (lastDocMode !== isDoc) {
        lastDocMode = isDoc;
        for (let k = 0; k < list.length; k++) delete list[k].dataset.sfFit;
    }
    if (isDoc) return;

    for (let i = 0; i < list.length; i++) {
        safe(() => relocateAvatar(list[i]), 'relocateAvatar');
    }
}

/* ───────────── 底部按钮收纳 ───────────── */
/* TavernHelper 的脚本按钮（山河舆图、音频播放器等）与 MVU 的「重新处理变量」
   都挤在输入区附近同一个容器里，换行后很占地方。
   不靠 class 猜，而是按按钮文字特征找到那个容器，整体收进一个开关后面。 */

const DOCK_KEYWORDS = ['山河舆图', '音频播放', '音频', '重新处理变量', '重新生成变量', '处理变量'];
let dockEl = null;
let dockToggle = null;

function looksLikeButton(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'BUTTON') return true;
    const cls = String(el.className || '');
    return /menu_button|mes_button|button/.test(cls) || el.getAttribute('role') === 'button';
}

/* 按文字特征找到「装着这些脚本按钮的那个容器」
   搜索范围严格限定在酒馆原生的输入框容器内部（#send_form / #form_sheld），
   不碰聊天区，避免误收其它按钮。 */
function findButtonDock() {
    const root = document.getElementById('send_form') || document.getElementById('form_sheld');
    if (!root) return null;

    const all = root.querySelectorAll('button, .menu_button, [role="button"], div, span');
    for (const el of all) {
        const txt = (el.textContent || '').trim();
        if (!txt || txt.length > 40) continue;
        if (!DOCK_KEYWORDS.some(k => txt.indexOf(k) !== -1)) continue;

        /* 命中关键词，向上找同时装着多个按钮的那层，但不许越过输入区容器 */
        let node = el.parentElement;
        for (let depth = 0; depth < 6 && node; depth++) {
            if (node === root || node === document.body || node === document.documentElement) break;
            const btns = node.querySelectorAll('button, .menu_button, [role="button"]');
            if (btns.length >= 2) return node;
            node = node.parentElement;
        }
    }
    return null;
}

function ensureDock() {
    if (!settings().dock) { destroyDock(); return; }

    /* 已收纳且还在页面上就什么都不做 */
    if (dockEl && dockEl.isConnected) return;

    dockEl = findButtonDock();
    if (!dockEl) return;

    if (dockEl.classList.contains('sf-dock-collapsed')) return;

    dockEl.classList.add('sf-dock-collapsed');
    dockEl.dataset.sfDock = '1';

    if (!dockToggle || !dockToggle.isConnected) {
        dockToggle = document.createElement('button');
        dockToggle.id = 'sf-dock-toggle';
        dockToggle.type = 'button';
        dockToggle.textContent = '⋯ 展开按钮';
        dockToggle.title = '展开／收起底部的脚本按钮';
        dockToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const collapsed = dockEl.classList.toggle('sf-dock-collapsed');
            dockToggle.textContent = collapsed ? '⋯ 展开按钮' : '收起按钮';
        });
    }

    if (dockEl.parentElement && !dockToggle.isConnected) {
        dockEl.parentElement.insertBefore(dockToggle, dockEl);
    }
}

function destroyDock() {
    if (dockEl) {
        dockEl.classList.remove('sf-dock-collapsed');
        delete dockEl.dataset.sfDock;
        dockEl = null;
    }
    if (dockToggle) {
        dockToggle.remove();
        dockToggle = null;
    }
}

/* ───────────── 应用设置 ───────────── */

function applySettings() {
    const s = settings();
    document.body.classList.toggle('sf-fit-full', !!s.full);
    document.body.classList.toggle('sf-fit-avatar', !!s.avatar);
    document.documentElement.style.setProperty('--sf-avatar-h', (Number(s.avatarHeight) || 40) + 'px');

    if (s.slider) {
        safe(() => { if (ensureThumb()) updateThumb(); }, 'slider-on');
    } else {
        destroyThumb();
    }

    if (!s.avatar) {
        safe(restoreAvatars, 'restoreAvatars');
    } else {
        safe(scanAvatars, 'scanAvatars');
    }

    safe(ensureDock, 'ensureDock');
}

/* ───────────── 调度 ───────────── */

function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
        scheduled = false;
        safe(() => { if (ensureThumb()) updateThumb(); }, 'updateThumb');
    });
}

function tick() {
    safe(scanAvatars, 'scanAvatars');
    safe(() => { if (ensureThumb()) updateThumb(); }, 'tick');
    safe(ensureDock, 'ensureDock');
}

function boot() {
    applySettings();

    document.addEventListener('scroll', () => {
        safe(flashHot, 'flashHot');
        schedule();
    }, true);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);

    safe(() => {
        const host = document.getElementById('chat');
        if (!host || !window.MutationObserver) return;
        const mo = new MutationObserver(() => {
            safe(scanAvatars, 'observer-scan');
            schedule();
        });
        mo.observe(host, { childList: true, subtree: true });
    }, 'observer');

    setInterval(() => {
        if (chatEl && !chatEl.isConnected) chatEl = null;
        safe(tick, 'interval');
    }, 1200);
}

/* ───────────── 设置面板 ───────────── */

function bindSettingsUI() {
    const s = settings();

    const $full = document.getElementById('sf-opt-full');
    const $slider = document.getElementById('sf-opt-slider');
    const $avatar = document.getElementById('sf-opt-avatar');
    const $dock = document.getElementById('sf-opt-dock');
    const $range = document.getElementById('sf-opt-avatar-height');
    const $num = document.getElementById('sf-opt-avatar-height-num');

    if (!$full) return;

    $full.checked = !!s.full;
    $slider.checked = !!s.slider;
    $avatar.checked = !!s.avatar;
    if ($dock) $dock.checked = !!s.dock;
    $range.value = s.avatarHeight;
    $num.value = s.avatarHeight;

    $full.addEventListener('change', () => {
        s.full = $full.checked; persist(); applySettings();
    });
    $slider.addEventListener('change', () => {
        s.slider = $slider.checked; persist(); applySettings();
    });
    $avatar.addEventListener('change', () => {
        s.avatar = $avatar.checked; persist(); applySettings();
    });
    if ($dock) {
        $dock.addEventListener('change', () => {
            s.dock = $dock.checked; persist(); applySettings();
        });
    }

    const setHeight = (v) => {
        let n = Math.round(Number(v));
        if (!isFinite(n)) n = DEFAULTS.avatarHeight;
        n = Math.max(16, Math.min(72, n));
        s.avatarHeight = n;
        $range.value = n;
        $num.value = n;
        persist();
        applySettings();
    };
    $range.addEventListener('input', () => setHeight($range.value));
    $num.addEventListener('change', () => setHeight($num.value));
}

async function renderSettingsUI() {
    if (!extApi || typeof extApi.renderExtensionTemplateAsync !== 'function') return;
    if (document.getElementById('sf-folio-fit-settings')) return;

    let html = '';
    try {
        html = await extApi.renderExtensionTemplateAsync('third-party/' + MODULE_NAME, 'settings', {}, false, false);
    } catch (e) {
        console.warn('[满幅与悬浮滑块] 设置模板加载失败', e);
        return;
    }
    if (!html) return;

    const target = document.getElementById('extensions_settings2')
        || document.getElementById('extensions_settings');
    if (!target) return;

    target.insertAdjacentHTML('beforeend', html);
    bindSettingsUI();
}

/* ───────────── 启动 ───────────── */

async function loadSTApi() {
    try {
        const ext = await import('../../../extensions.js');
        extApi = {
            extension_settings: ext.extension_settings,
            renderExtensionTemplateAsync: ext.renderExtensionTemplateAsync,
        };
    } catch (e) {
        console.warn('[满幅与悬浮滑块] 未能加载 extensions.js，设置面板不可用（功能仍生效）', e);
    }
    try {
        const sc = await import('../../../../script.js');
        saveSettings = sc.saveSettingsDebounced;
    } catch (e) {
        /* 静默降级：设置只存在内存里 */
    }
}

(async () => {
    await loadSTApi();

    const start = () => {
        boot();
        renderSettingsUI();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
