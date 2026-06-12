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
  // テキスト検索の対象フィールド（description は構造化に失敗した場合の原文）
  var SEARCH_FIELDS = ['title', 'details', 'organizer', 'description'];
  var SEARCH_DEBOUNCE_MS = 150;

  var config = window.VRC_EVENT_VIEWER_CONFIG || {};
  var container = document.getElementById('vrc-event-viewer');
  if (!container) return;

  var state = {
    mode: 'today',       // 'today' | 'week'
    date: jstToday(),    // 「今日」タブで表示中の日付（YYYY-MM-DD）
    query: '',           // 検索キーワード（生文字列）
    genres: [],          // 選択中ジャンル（OR条件）
    lastData: null,      // 直近のAPIレスポンス
    lastRangeStart: null // 直近の表示範囲開始日
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

  // ---------- 絞り込みユーティリティ ----------

  // 全角英数字・半角カナ等の揺れを吸収して比較する
  function normalizeText(value) {
    var s = String(value);
    if (s.normalize) s = s.normalize('NFKC');
    return s.toLowerCase();
  }

  function parseGenres(ev) {
    if (!ev.genre) return [];
    return ev.genre.split(',').map(function (g) { return g.trim(); }).filter(Boolean);
  }

  function matchesQuery(ev, normalizedQuery) {
    return SEARCH_FIELDS.some(function (field) {
      return ev[field] && normalizeText(ev[field]).indexOf(normalizedQuery) !== -1;
    });
  }

  function matchesGenres(ev) {
    if (state.genres.length === 0) return true;
    var genres = parseGenres(ev);
    return state.genres.some(function (g) { return genres.indexOf(g) !== -1; });
  }

  function toggleGenre(genre) {
    var i = state.genres.indexOf(genre);
    if (i === -1) {
      state.genres.push(genre);
    } else {
      state.genres.splice(i, 1);
    }
    render();
  }

  function clearFilters() {
    state.query = '';
    state.genres = [];
    ui.search.value = '';
    render();
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

    var search = el('input', 'vev-search');
    search.type = 'search';
    search.placeholder = '検索（タイトル・内容・主催者）';
    search.setAttribute('aria-label', 'イベントを検索');
    search.setAttribute('enterkeyhint', 'search');
    var debounceTimer = null;
    search.addEventListener('input', function () {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        debounceTimer = null;
        state.query = search.value;
        render();
      }, SEARCH_DEBOUNCE_MS);
    });
    container.appendChild(search);

    // ジャンルピッカー（折りたたみ）。チップ列は render() で差し替えるが、
    // details 要素自体は使い回すため開閉状態が維持される
    var genrePicker = el('details', 'vev-genre-picker');
    genrePicker.style.display = 'none';
    genrePicker.appendChild(el('summary', null, 'ジャンルで絞り込む'));
    var genrePickerChips = el('div', 'vev-chips vev-picker-chips');
    genrePicker.appendChild(genrePickerChips);
    container.appendChild(genrePicker);

    var filterbar = el('div', 'vev-filterbar');
    filterbar.style.display = 'none';
    container.appendChild(filterbar);

    var body = el('div', 'vev-body');
    container.appendChild(body);

    var footer = el('div', 'vev-footer');
    container.appendChild(footer);

    return {
      tabToday: tabToday,
      tabWeek: tabWeek,
      nav: nav,
      navLabel: navLabel,
      search: search,
      genrePicker: genrePicker,
      genrePickerChips: genrePickerChips,
      filterbar: filterbar,
      body: body,
      footer: footer
    };
  }

  var ui = build();

  // タブ・日送り時のみ呼ぶ。fetchして結果を保持し、描画は render() に委ねる
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
        state.lastData = data;
        state.lastRangeStart = start;
        render();
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

  // 保持中のレスポンスに検索・ジャンル条件を適用して描画する（fetchしない）
  function render() {
    if (!state.lastData) return; // 取得前（読み込み中・エラー表示中）は何もしない

    var data = state.lastData;
    var rangeStart = state.lastRangeStart;
    var events = (data && data.events) || [];

    var normalizedQuery = normalizeText(state.query.trim());
    var filtered = events.filter(function (ev) {
      return (!normalizedQuery || matchesQuery(ev, normalizedQuery)) && matchesGenres(ev);
    });

    renderGenrePicker(events);
    renderFilterBar(filtered.length);

    ui.body.textContent = '';
    if (events.length === 0) {
      showMessage(state.mode === 'today'
        ? dateLabel(rangeStart) + ' のイベントはありません。'
        : '今週のイベントはありません。');
    } else if (filtered.length === 0) {
      showMessage('条件に一致するイベントはありません。');
    } else {
      // 開始日でグルーピング（範囲開始日より前に始まった継続中イベントは範囲開始日に表示）
      var groups = {};
      var order = [];
      filtered.forEach(function (ev) {
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

  // 取得済みイベントからジャンル一覧を集計し、ピッカーのチップ列を再構築する
  // （該当イベント数の降順、同数は名前順。選択状態はカード内チップと共有）
  function renderGenrePicker(events) {
    var counts = {};
    events.forEach(function (ev) {
      parseGenres(ev).forEach(function (genre) {
        counts[genre] = (counts[genre] || 0) + 1;
      });
    });
    var genres = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || a.localeCompare(b, 'ja');
    });

    ui.genrePicker.style.display = genres.length === 0 ? 'none' : '';
    ui.genrePickerChips.textContent = '';
    genres.forEach(function (genre) {
      var selected = state.genres.indexOf(genre) !== -1;
      var chip = el('button', 'vev-chip' + (selected ? ' is-selected' : ''),
        genre + ' (' + counts[genre] + ')');
      chip.type = 'button';
      chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
      chip.addEventListener('click', function () { toggleGenre(genre); });
      ui.genrePickerChips.appendChild(chip);
    });
  }

  // 絞り込み状態の表示（選択ジャンル・件数・一括解除）。条件がないときは非表示
  function renderFilterBar(hitCount) {
    ui.filterbar.textContent = '';
    var active = state.query.trim() !== '' || state.genres.length > 0;
    ui.filterbar.style.display = active ? '' : 'none';
    if (!active) return;

    ui.filterbar.appendChild(el('span', 'vev-filterbar-label', '絞り込み中:'));

    state.genres.forEach(function (genre) {
      var chip = el('button', 'vev-chip is-selected', genre + ' ✕');
      chip.type = 'button';
      chip.setAttribute('aria-label', genre + ' の絞り込みを解除');
      chip.addEventListener('click', function () { toggleGenre(genre); });
      ui.filterbar.appendChild(chip);
    });

    ui.filterbar.appendChild(el('span', 'vev-hit-count', hitCount + '件'));

    var clear = el('button', 'vev-clear-filters', 'すべて解除');
    clear.type = 'button';
    clear.addEventListener('click', clearFilters);
    ui.filterbar.appendChild(clear);
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

    if (ev.organizer) {
      card.appendChild(el('p', 'vev-meta', '主催: ' + ev.organizer));
    }

    var genres = parseGenres(ev);
    if (genres.length > 0) {
      var chips = el('div', 'vev-chips');
      genres.forEach(function (genre) {
        var selected = state.genres.indexOf(genre) !== -1;
        var chip = el('button', 'vev-chip' + (selected ? ' is-selected' : ''), genre);
        chip.type = 'button';
        chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
        chip.addEventListener('click', function () { toggleGenre(genre); });
        chips.appendChild(chip);
      });
      card.appendChild(chips);
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
