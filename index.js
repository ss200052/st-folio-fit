/**
 * 满幅与悬浮滑块
 *
 * 1) 把聊天区左右彻底贴边（配合 style.css 关掉原生滚动条占位）
 * 2) 用一条悬浮矩形滑块代替原生滚动条，未交互时半透明，按住/拖动时变实
 * 3) 头像不再占独立一列，挪到「角色名 + 时间」那一行的最右端
 */
(function () {
    'use strict';

    if (window.__sfFolioFitLoaded) return;
    window.__sfFolioFitLoaded = true;

    var THUMB_ID = 'sf-fit-thumb';
    var thumb = null;
    var chatEl = null;
    var sheldEl = null;
    var dragging = false;
    var dragStartY = 0;
    var dragStartScroll = 0;

    /* ───────────── 滑块 ───────────── */

    function ensureThumb() {
        var chat = document.getElementById('chat');
        if (!chat) return false;
        chatEl = chat;
        sheldEl = chat.parentElement;
        if (!sheldEl) return false;

        if (getComputedStyle(sheldEl).position === 'static') {
            sheldEl.style.position = 'relative';
        }

        if (!thumb) {
            thumb = document.createElement('div');
            thumb.id = THUMB_ID;
            bindThumbEvents();
        }
        if (thumb.parentElement !== sheldEl) {
            sheldEl.appendChild(thumb);
        }
        return true;
    }

    function updateThumb() {
        if (!thumb || !chatEl || !sheldEl) return;

        var viewH = chatEl.clientHeight;
        var contentH = chatEl.scrollHeight;

        if (!viewH || contentH <= viewH + 4) {
            thumb.classList.remove('sf-visible');
            return;
        }
        thumb.classList.add('sf-visible');

        var chatRect = chatEl.getBoundingClientRect();
        var sheldRect = sheldEl.getBoundingClientRect();
        var trackTop = chatRect.top - sheldRect.top;
        var trackH = viewH;

        var thumbH = Math.max(32, Math.round(trackH * (trackH / contentH)));
        var maxScroll = contentH - trackH;
        var ratio = maxScroll > 0 ? (chatEl.scrollTop / maxScroll) : 0;
        if (ratio < 0) ratio = 0;
        if (ratio > 1) ratio = 1;

        var y = trackTop + (trackH - thumbH) * ratio;

        thumb.style.top = '0px';
        thumb.style.height = thumbH + 'px';
        thumb.style.transform = 'translateY(' + Math.round(y) + 'px)';
    }

    function bindThumbEvents() {
        thumb.addEventListener('pointerdown', function (e) {
            if (!chatEl) return;
            e.preventDefault();
            dragging = true;
            dragStartY = e.clientY;
            dragStartScroll = chatEl.scrollTop;
            thumb.classList.add('sf-active');
            try { thumb.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
        });

        thumb.addEventListener('pointermove', function (e) {
            if (!dragging || !chatEl) return;
            var contentH = chatEl.scrollHeight;
            var viewH = chatEl.clientHeight;
            var thumbH = parseFloat(thumb.style.height) || 32;
            var scrollable = contentH - viewH;
            if (scrollable <= 0) return;

            var delta = e.clientY - dragStartY;
            var ratio = scrollable / Math.max(1, viewH - thumbH);
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
            /* 松手后立刻按最终位置重算一次，避免滑块停在旧位置 */
            updateThumb();
            schedule();
        }

        thumb.addEventListener('pointerup', endDrag);
        thumb.addEventListener('pointercancel', endDrag);

        thumb.addEventListener('pointerenter', function () {
            if (!dragging) thumb.classList.add('sf-hot');
        });
        thumb.addEventListener('pointerleave', function () {
            thumb.classList.remove('sf-hot');
        });
    }

    /* ───────────── 头像挪到时间行 ───────────── */

    function findAvatarWrap(mes) {
        var kids = mes.children;
        for (var i = 0; i < kids.length; i++) {
            if (kids[i].classList && kids[i].classList.contains('mesAvatarWrapper')) {
                return kids[i];
            }
        }
        return null;
    }

    function relocateAvatar(mes) {
        if (mes.dataset.sfFit === '1') return;
        /* 编辑中的消息先放过，避免干扰 textarea */
        if (mes.querySelector('.edit_textarea')) return;
        /* 文档风格下 ST 自己会把头像 display:none，不必也不该挪 */
        if (document.body.classList.contains('documentstyle')) {
            mes.dataset.sfFit = '1';
            return;
        }

        var wrap = findAvatarWrap(mes);
        if (!wrap) {
            mes.dataset.sfFit = '1';
            return;
        }

        var nameRow = mes.querySelector('.ch_name');
        var timer = mes.querySelector('.mes_timer') || mes.querySelector('.timestamp');

        if (timer && nameRow && nameRow.contains(timer)) {
            timer.insertAdjacentElement('afterend', wrap);
        } else if (timer) {
            timer.insertAdjacentElement('afterend', wrap);
        } else if (nameRow) {
            nameRow.appendChild(wrap);
        } else {
            return;
        }

        mes.dataset.sfFit = '1';
    }

    /* 聊天风格切换（默认／气泡／文档）时，标记要重置，头像才会重新归位 */
    var lastDocMode = null;
    var lastAvatarRatio = 0;

    /* 从 ST 的头像变量算出宽高比，写成无单位的 --sf-avatar-ar 给 CSS 用。
       四种头像样式（圆/方/矩形/圆角）尺寸不同，这样小图标不会被拉变形。
       注意：头像样式的类加在 body 上，变量要从 body 取，取 html 会读不到覆盖值。 */
    function syncAvatarRatio() {
        var cs = getComputedStyle(document.body);
        var w = parseFloat(cs.getPropertyValue('--avatar-base-width')) || 50;
        var h = parseFloat(cs.getPropertyValue('--avatar-base-height')) || 50;
        if (!(h > 0) || !(w > 0)) return;
        var ar = w / h;
        if (Math.abs(ar - lastAvatarRatio) < 0.01) return;
        lastAvatarRatio = ar;
        document.documentElement.style.setProperty('--sf-avatar-ar', String(ar));
    }

    function scanAvatars() {
        syncAvatarRatio();
        var isDoc = document.body.classList.contains('documentstyle');
        var list = document.querySelectorAll('#chat .mes');
        if (lastDocMode === null) {
            lastDocMode = isDoc;
        } else if (lastDocMode !== isDoc) {
            lastDocMode = isDoc;
            for (var k = 0; k < list.length; k++) delete list[k].dataset.sfFit;
        }
        for (var i = 0; i < list.length; i++) relocateAvatar(list[i]);
    }

    /* ───────────── 调度 ───────────── */

    var scheduled = false;

    function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
            scheduled = false;
            if (ensureThumb()) updateThumb();
        });
    }

    function boot() {
        ensureThumb();
        scanAvatars();
        updateThumb();

        document.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', schedule);
        window.addEventListener('orientationchange', schedule);

        var host = document.getElementById('chat');
        if (host && window.MutationObserver) {
            var mo = new MutationObserver(function () {
                scanAvatars();
                schedule();
            });
            mo.observe(host, { childList: true, subtree: true });
        }

        /* 兜底：聊天区被重建、或新消息未触发观察时，定期补扫 */
        setInterval(function () {
            if (!chatEl || !document.body.contains(chatEl)) {
                if (thumb) { thumb.remove(); thumb = null; }
                chatEl = null;
            }
            ensureThumb();
            scanAvatars();
            schedule();
        }, 1200);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
