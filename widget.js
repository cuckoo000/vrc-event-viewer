// イベントビューア ウィジェット
// <div id="vrc-event-viewer"></div> に今日／今週のイベント一覧を描画する。
// イベント由来のテキストはすべて textContent 経由で挿入する（XSS対策）。
(function () {
  'use strict';

  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  var DETAIL_FIELDS = [
    { key: 'details', label: 'イベント内容' },
    { key: 'conditions', label: '参加条件' },
    { key: 'method', label: '参加方法' },
    { key: 'remarks', label: '備考' }
  ];

  var config = window.VRC_EVENT_VIEWER_CONFIG || {};
  var container = document.getElementById('vrc-event-viewer');
  if (!container) return;

  var state = {
    mode: 'today',      // 'today' | 'week'
    date: jstToday()    // 「今日」タブで表示中の日付（YYYY-MM-DD）
  };

  // ---------- 日付ユーティリティ（JST固定） ----------

  function jstToday() {
    // en-CA ロケールは YYYY-MM-DD 形式を返す
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
  }

  function addDays(dateStr, n) {
    var p = dateStr.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.toISOString().slice(0, 10);
  }

  function dateLabel(dateStr) {
    var p = dateStr.split('-').map(Number);
    var weekday = WEEKDAYS[new Date(p[0], p[1] - 1, p[2]).getDay()];
    return p[1] + '/' + p[2] + '(' + weekday + ')';
  }

  // APIはJSTのISO文字列（例 2026-06-12T22:00:00+09:00）を返すため、
  // 閲覧環境のタイムゾーンに依存しないよう文字列のまま切り出す
  function timeOf(iso) {
    return iso.slice(11, 16);
  }

  function dateOf(iso) {
    return iso.slice(0, 10);
  }

  // ---------- DOMヘルパー ----------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // ---------- 描画 ----------

  function build() {
    container.textContent = '';
    container.classList.add('vev');

    var toolbar = el('div', 'vev-toolbar');

    var tabs = el('div', 'vev-tabs');
    var tabToday = el('button', 'vev-tab', '今日');
    var tabWeek = el('button', 'vev-tab', '今週');
    tabToday.type = 'button';
    tabWeek.type = 'button';
    tabToday.addEventListener('click', function () {
      state.mode = 'today';
      state.date = jstToday();
      update();
    });
    tabWeek.addEventListener('click', function () {
      state.mode = 'week';
      update();
    });
    tabs.appendChild(tabToday);
    tabs.appendChild(tabWeek);
    toolbar.appendChild(tabs);

    var nav = el('div', 'vev-nav');
    var prev = el('button', 'vev-nav-btn', '◀');
    var navLabel = el('span', 'vev-nav-label');
    var next = el('button', 'vev-nav-btn', '▶');
    prev.type = 'button';
    next.type = 'button';
    prev.setAttribute('aria-label', '前の日');
    next.setAttribute('aria-label', '次の日');
    prev.addEventListener('click', function () {
      state.date = addDays(state.date, -1);
      update();
    });
    next.addEventListener('click', function () {
      state.date = addDays(state.date, 1);
      update();
    });
    nav.appendChild(prev);
    nav.appendChild(navLabel);
    nav.appendChild(next);
    toolbar.appendChild(nav);

    container.appendChild(toolbar);

    var body = el('div', 'vev-body');
    container.appendChild(body);

    var footer = el('div', 'vev-footer');
    container.appendChild(footer);

    return {
      tabToday: tabToday,
      tabWeek: tabWeek,
      nav: nav,
      navLabel: navLabel,
      body: body,
      footer: footer
    };
  }

  var ui = build();

  function update() {
    ui.tabToday.classList.toggle('is-active', state.mode === 'today');
    ui.tabWeek.classList.toggle('is-active', state.mode === 'week');
    ui.nav.style.display = state.mode === 'today' ? '' : 'none';
    ui.navLabel.textContent = dateLabel(state.date);

    if (!config.apiUrl) {
      showMessage('設定エラー: config.js の apiUrl が未設定です。');
      return;
    }

    var start = state.mode === 'today' ? state.date : jstToday();
    var days = state.mode === 'today' ? 1 : 7;
    var requestKey = state.mode + ':' + start;
    update.lastRequest = requestKey;

    showMessage('読み込み中…');

    fetch(config.apiUrl + '?start=' + encodeURIComponent(start) + '&days=' + days)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (update.lastRequest !== requestKey) return; // 古いレスポンスは破棄
        renderEvents(data, start);
      })
      .catch(function () {
        if (update.lastRequest !== requestKey) return;
        showError();
      });
  }

  function showMessage(text) {
    ui.body.textContent = '';
    ui.body.appendChild(el('p', 'vev-message', text));
  }

  function showError() {
    ui.body.textContent = '';
    var box = el('div', 'vev-message');
    box.appendChild(el('p', null, 'イベント情報の取得に失敗しました。'));
    var retry = el('button', 'vev-retry', '再試行');
    retry.type = 'button';
    retry.addEventListener('click', update);
    box.appendChild(retry);
    ui.body.appendChild(box);
  }

  function renderEvents(data, rangeStart) {
    ui.body.textContent = '';

    var events = (data && data.events) || [];
    if (events.length === 0) {
      showMessage(state.mode === 'today'
        ? dateLabel(rangeStart) + ' のイベントはありません。'
        : '今週のイベントはありません。');
    } else {
      // 開始日でグルーピング（範囲開始日より前に始まった継続中イベントは範囲開始日に表示）
      var groups = {};
      var order = [];
      events.forEach(function (ev) {
        var day = dateOf(ev.start);
        if (day < rangeStart) day = rangeStart;
        if (!groups[day]) {
          groups[day] = [];
          order.push(day);
        }
        groups[day].push(ev);
      });
      order.sort();

      order.forEach(function (day) {
        var section = el('section', 'vev-day');
        var isToday = day === jstToday();
        section.appendChild(el('h2', 'vev-day-heading',
          dateLabel(day) + (isToday ? ' 今日' : '')));
        groups[day].forEach(function (ev) {
          section.appendChild(renderCard(ev, day));
        });
        ui.body.appendChild(section);
      });
    }

    ui.footer.textContent = '';
    if (data && data.updatedAt) {
      ui.footer.appendChild(el('span', 'vev-updated',
        '更新: ' + dateOf(data.updatedAt) + ' ' + timeOf(data.updatedAt)));
    }
    if (config.calendarUrl && /^https?:/.test(config.calendarUrl)) {
      var link = el('a', 'vev-calendar-link', 'Googleカレンダーで開く');
      link.href = config.calendarUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      ui.footer.appendChild(link);
    }
  }

  function renderCard(ev, groupDay) {
    var card = el('article', 'vev-card');

    var head = el('div', 'vev-card-head');
    head.appendChild(el('span', 'vev-time', timeRange(ev, groupDay)));
    if (ev.android === '対応') {
      head.appendChild(el('span', 'vev-badge vev-badge-android', 'Android対応'));
    } else if (ev.android === 'オンリー') {
      head.appendChild(el('span', 'vev-badge vev-badge-android-only', 'Androidオンリー'));
    }
    card.appendChild(head);

    card.appendChild(el('h3', 'vev-title', ev.title || '(タイトルなし)'));

    var metaParts = [];
    if (ev.organizer) metaParts.push('主催: ' + ev.organizer);
    if (ev.genre) metaParts.push('ジャンル: ' + ev.genre);
    if (metaParts.length > 0) {
      card.appendChild(el('p', 'vev-meta', metaParts.join(' ／ ')));
    }

    var detailRows = DETAIL_FIELDS.filter(function (f) { return ev[f.key]; });
    var hasRawDescription = !detailRows.length && ev.description;
    if (detailRows.length > 0 || hasRawDescription) {
      var details = el('details', 'vev-details');
      details.appendChild(el('summary', null, '詳細'));
      if (detailRows.length > 0) {
        var dl = el('dl', 'vev-detail-list');
        detailRows.forEach(function (f) {
          dl.appendChild(el('dt', null, f.label));
          dl.appendChild(el('dd', null, ev[f.key]));
        });
        details.appendChild(dl);
      } else {
        details.appendChild(el('p', 'vev-description', ev.description));
      }
      card.appendChild(details);
    }

    return card;
  }

  function timeRange(ev, groupDay) {
    if (ev.allDay) return '終日';
    var startDay = dateOf(ev.start);
    var endDay = dateOf(ev.end);
    var startText = startDay < groupDay
      ? dateLabel(startDay) + ' ' + timeOf(ev.start)
      : timeOf(ev.start);
    var endText = endDay > startDay ? '翌' + timeOf(ev.end) : timeOf(ev.end);
    return startText + '–' + endText;
  }

  update();
})();
