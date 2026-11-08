/**
 * 满幅与悬浮滑块
 *
 * 1) 把聊天区左右彻底贴边（配合 style.css）
 * 2) 用悬浮矩形滑块代替原生滚动条，未交互时半透明
 * 3) 头像不再占独立一列，挪到「角色名 + 时间」那一行的最右端
 *
 * 设计原则：任何一步失败都不许连累其它功能，更不许把元素弄没。
 */
(function () {
    'use strict';

    if (window.__sfFolioFitLoaded) return;
    window.__sfFolioFitLoaded = true;

    var THUMB_ID = 'sf-fit-thumb';
    var thumb = null;
    var chatEl = null;
    var dragging = false;
    var dragStartY = 0;
    var dragStartScroll = 0;
    var lastDocMode = null;
    var lastAvatarRatio = 0;

    function safe(fn, label) {
        try {
            return fn();
        } catch (e) {
            if (window.console && console.warn) console.warn('[满幅与悬浮滑块] ' + label + ' 出错：', e);
            return null;
        }
    }

    /* ───────────── 滑块 ───────────── */

    function ensureThumb() {
        var chat = document.getElementById('chat');
        if (!chat) return false;
        chatEl = chat;

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

    function updateThumb() {
        if (!thumb || !chatEl || !chatEl.isConnected) return;

        var viewH = chatEl.clientHeight;
        var contentH = chatEl.scrollHeight;
        if (!viewH || contentH <= viewH + 4) {
            thumb.classList.remove('sf-visible');
            return;
        }
        thumb.classList.add('sf-visible');

        var rect = chatEl.getBoundingClientRect();
        var thumbH = Math.max(32, Math.round(viewH * (viewH / contentH)));
        var maxScroll = contentH - viewH;
        var ratio = maxScroll > 0 ? (chatEl.scrollTop / maxScroll) : 0;
        if (ratio < 0) ratio = 0;
        if (ratio > 1) ratio = 1;

        /* fixed 定位：直接按视口坐标算，不依赖父级 position/transform */
        var y = rect.top + (rect.height - thumbH) * ratio;

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

    /* ───────────── 头像归位 ───────────── */

    /* 不同 ST 版本层级可能不同：先看直接子元素，再全树兜底找 */
    function findAvatarWrap(mes) {
        var kids = mes.children;
        for (var i = 0; i < kids.length; i++) {
            if (kids[i].classList && kids[i].classList.contains('mesAvatarWrapper')) return kids[i];
        }
        return mes.querySelector('.mesAvatarWrapper');
    }

    function relocateAvatar(mes) {
        if (mes.dataset.sfFit === '1') return;
        /* 编辑中的消息先放过，避免干扰 textarea */
        if (mes.querySelector('.edit_textarea')) return;

        var wrap = findAvatarWrap(mes);
        if (!wrap) {
            mes.dataset.sfFit = '1';
            return;
        }

        var nameRow = mes.querySelector('.ch_name');
        var timer = mes.querySelector('.mes_timer') || mes.querySelector('.timestamp');

        /* 已经归位过就标记完成，避免反复搬动 */
        if (nameRow && nameRow.contains(wrap)) {
            mes.dataset.sfFit = '1';
            return;
        }

        if (timer) {
            timer.insertAdjacentElement('afterend', wrap);
        } else if (nameRow) {
            nameRow.appendChild(wrap);
        } else {
            /* 既没有时间也没有名字行，保持原位，不要强行搬运 */
            mes.dataset.sfFit = '1';
            return;
        }

        mes.dataset.sfFit = '1';
    }

    /* 头像比例：从 ST 的头像变量换算成无单位值给 CSS 用。
       头像样式的类挂在 body 上，所以变量要从 body 取。 */
    function syncAvatarRatio() {
        if (!document.body) return;
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
        if (!document.body) return;
        syncAvatarRatio();

        /* 文档风格下 ST 自己把头像 display:none 了，JS 不要跟它抢 */
        var isDoc = document.body.classList.contains('documentstyle');
        var list = document.querySelectorAll('#chat .mes');

        if (lastDocMode === null) {
            lastDocMode = isDoc;
        } else if (lastDocMode !== isDoc) {
            lastDocMode = isDoc;
            for (var k = 0; k < list.length; k++) delete list[k].dataset.sfFit;
        }
        if (isDoc) return;

        for (var i = 0; i < list.length; i++) {
            safe(function () { relocateAvatar(list[i]); }, 'relocateAvatar');
        }
    }

    /* ───────────── 调度 ───────────── */

    var scheduled = false;

    function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
            scheduled = false;
            safe(function () {
                if (ensureThumb()) updateThumb();
            }, 'updateThumb');
        });
    }

    function tick() {
        safe(scanAvatars, 'scanAvatars');
        safe(function () {
            if (ensureThumb()) updateThumb();
        }, 'tick');
    }

    function boot() {
        tick();

        document.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', schedule);
        window.addEventListener('orientationchange', schedule);

        safe(function () {
            var host = document.getElementById('chat');
            if (!host || !window.MutationObserver) return;
            var mo = new MutationObserver(function () {
                safe(scanAvatars, 'observer-scan');
                schedule();
            });
            mo.observe(host, { childList: true, subtree: true });
        }, 'observer');

        /* 兜底巡检：聊天区被重建、或消息未触发观察时补扫 */
        setInterval(function () {
            if (chatEl && !chatEl.isConnected) chatEl = null;
            safe(tick, 'interval');
        }, 1200);
    }

    function start() {
        safe(boot, 'boot');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
