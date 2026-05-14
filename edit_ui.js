/* ============================================
   AI_SNS_School LP - 編集UIロジック（パワポ風）
   - 編集モード切替（ON/OFF）
   - クリックで data-key 要素を選択 → フロートツールバー表示
   - フォント / 色 / サイズ / 太字 を切替
   - localStorage で一時保存 ・ index_edited.html ダウンロード
   ============================================ */

(function () {
  'use strict';

  // ---------- 定数 ----------
  var STORAGE_KEY = 'ai_sns_school_lp_edits';
  var FONT_PRESETS = [
    { label: 'Noto Sans JP', value: "'Noto Sans JP', sans-serif" },
    { label: 'ヒラギノ角ゴ', value: "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', sans-serif" },
    { label: '游ゴシック', value: "'Yu Gothic', 'YuGothic', sans-serif" },
    { label: 'メイリオ', value: "'Meiryo', sans-serif" },
    { label: '明朝（Serif）', value: "'Hiragino Mincho ProN', 'Yu Mincho', serif" }
  ];
  var SIZE_PRESETS = [
    { label: '小', value: 0.85 },
    { label: '中', value: 1.0 },
    { label: '大', value: 1.25 },
    { label: '特大', value: 1.5 }
  ];

  // ---------- 状態 ----------
  var state = {
    editMode: true,
    selectedEl: null,
    elements: [], // data-key 要素のリスト
    statusTimer: null
  };

  // ---------- 起動 ----------
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    state.elements = Array.prototype.slice.call(
      document.querySelectorAll('[data-key]')
    );

    // 各要素にオリジナル値を保存 + contenteditable 付与
    state.elements.forEach(function (el) {
      if (!el.hasAttribute('data-original')) {
        el.setAttribute('data-original', el.innerText);
      }
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('spellcheck', 'false');
    });

    buildToolbar();
    bindHeaderControls();
    bindElementInteractions();
    loadFromStorage();
    setEditMode(true);
  }

  // ---------- ツールバー構築 ----------
  function buildToolbar() {
    var tb = document.getElementById('float-toolbar');
    if (!tb) return;

    // ターゲット表示
    var targetRow = document.createElement('div');
    targetRow.className = 'tb-target';
    targetRow.innerHTML = '編集対象: <b id="tb-target-name">—</b>';
    tb.appendChild(targetRow);

    // フォント
    var fontGroup = document.createElement('div');
    fontGroup.className = 'tb-group';
    fontGroup.innerHTML = '<label>フォント</label>';
    var fontSelect = document.createElement('select');
    fontSelect.id = 'tb-font';
    FONT_PRESETS.forEach(function (f) {
      var opt = document.createElement('option');
      opt.value = f.value;
      opt.textContent = f.label;
      fontSelect.appendChild(opt);
    });
    fontGroup.appendChild(fontSelect);
    tb.appendChild(fontGroup);

    // サイズ（プリセット + 数値）
    var sizeGroup = document.createElement('div');
    sizeGroup.className = 'tb-group';
    sizeGroup.innerHTML = '<label>サイズ</label>';
    SIZE_PRESETS.forEach(function (s) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tb-preset-btn';
      btn.textContent = s.label;
      btn.dataset.sizeMul = s.value;
      btn.addEventListener('click', function () {
        applySizeMul(s.value);
      });
      sizeGroup.appendChild(btn);
    });
    var sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.id = 'tb-size';
    sizeInput.min = 8;
    sizeInput.max = 96;
    sizeInput.step = 1;
    sizeInput.title = 'px 直接指定';
    sizeGroup.appendChild(sizeInput);
    tb.appendChild(sizeGroup);

    // 色
    var colorGroup = document.createElement('div');
    colorGroup.className = 'tb-group';
    colorGroup.innerHTML = '<label>色</label>';
    var colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.id = 'tb-color';
    colorInput.value = '#111111';
    colorGroup.appendChild(colorInput);
    tb.appendChild(colorGroup);

    // 太字 / リセット
    var actGroup = document.createElement('div');
    actGroup.className = 'tb-group';
    var boldBtn = document.createElement('button');
    boldBtn.type = 'button';
    boldBtn.className = 'tb-icon-btn';
    boldBtn.id = 'tb-bold';
    boldBtn.textContent = 'B';
    boldBtn.title = '太字';
    actGroup.appendChild(boldBtn);

    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'tb-icon-btn';
    clearBtn.id = 'tb-clear';
    clearBtn.textContent = '⟲';
    clearBtn.title = 'この要素のスタイルをクリア';
    clearBtn.style.width = '36px';
    actGroup.appendChild(clearBtn);

    tb.appendChild(actGroup);

    // ハンドラ
    fontSelect.addEventListener('change', function () {
      if (!state.selectedEl) return;
      state.selectedEl.style.fontFamily = fontSelect.value;
      persist();
    });

    sizeInput.addEventListener('input', function () {
      if (!state.selectedEl) return;
      var v = parseInt(sizeInput.value, 10);
      if (!isNaN(v) && v >= 8 && v <= 200) {
        state.selectedEl.style.fontSize = v + 'px';
        persist();
      }
    });

    colorInput.addEventListener('input', function () {
      if (!state.selectedEl) return;
      state.selectedEl.style.color = colorInput.value;
      persist();
    });

    boldBtn.addEventListener('click', function () {
      if (!state.selectedEl) return;
      var current = window.getComputedStyle(state.selectedEl).fontWeight;
      var isBold = parseInt(current, 10) >= 700 || current === 'bold' || current === 'bolder';
      state.selectedEl.style.fontWeight = isBold ? '400' : '900';
      boldBtn.classList.toggle('active', !isBold);
      persist();
    });

    clearBtn.addEventListener('click', function () {
      if (!state.selectedEl) return;
      state.selectedEl.style.fontFamily = '';
      state.selectedEl.style.fontSize = '';
      state.selectedEl.style.color = '';
      state.selectedEl.style.fontWeight = '';
      syncToolbarToSelection();
      persist();
    });
  }

  function applySizeMul(mul) {
    if (!state.selectedEl) return;
    // ベースサイズはコンピューテッド値から取得
    var cs = window.getComputedStyle(state.selectedEl);
    var base = state.selectedEl.dataset.baseSize;
    if (!base) {
      base = parseFloat(cs.fontSize);
      state.selectedEl.dataset.baseSize = base;
    } else {
      base = parseFloat(base);
    }
    var newSize = Math.round(base * mul);
    state.selectedEl.style.fontSize = newSize + 'px';
    var sizeInput = document.getElementById('tb-size');
    if (sizeInput) sizeInput.value = newSize;
    persist();
  }

  // ---------- ヘッダー操作 ----------
  function bindHeaderControls() {
    var modeBtn = document.getElementById('mode-toggle');
    var resetBtn = document.getElementById('reset-btn');
    var saveBtn = document.getElementById('save-btn');
    var downloadBtn = document.getElementById('download-btn');
    var publishBtn = document.getElementById('publish-btn');
    var logoutBtn = document.getElementById('logout-btn');

    if (modeBtn) {
      modeBtn.addEventListener('click', function () {
        setEditMode(!state.editMode);
      });
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', resetAll);
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        persist();
        showStatus('保存しました', '#4ADE80');
      });
    }
    if (downloadBtn) {
      downloadBtn.addEventListener('click', exportEditedHtml);
    }
    if (publishBtn) {
      publishBtn.addEventListener('click', publishToGitHub);
    }
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        if (!confirm('ログアウトしますか？')) return;
        window.location.href = '/logout';
      });
    }
  }

  function setEditMode(on) {
    state.editMode = on;
    document.body.classList.toggle('edit-on', on);
    document.body.classList.toggle('edit-off', !on);
    state.elements.forEach(function (el) {
      if (on) {
        el.setAttribute('contenteditable', 'true');
      } else {
        el.setAttribute('contenteditable', 'false');
      }
    });
    var modeBtn = document.getElementById('mode-toggle');
    if (modeBtn) {
      modeBtn.textContent = on ? '編集中（ON）' : '編集モード（OFF）';
    }
    if (!on) {
      deselect();
    }
  }

  // ---------- 要素操作 ----------
  function bindElementInteractions() {
    state.elements.forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (!state.editMode) return;
        e.stopPropagation();
        select(el);
      });

      el.addEventListener('focus', function () {
        if (!state.editMode) return;
        select(el);
      });

      el.addEventListener('input', function () {
        persist();
      });

      el.addEventListener('keydown', function (e) {
        // シングルライン要素では Enter で改行を防ぐ
        if (e.key === 'Enter' && !e.shiftKey) {
          var multiline = el.classList.contains('chat-bubble') ||
                          el.classList.contains('faq-a-text') ||
                          el.classList.contains('faq-q-text');
          if (!multiline) {
            e.preventDefault();
            el.blur();
          }
        }
      });
    });

    // 要素外クリックで選択解除
    document.addEventListener('click', function (e) {
      if (!state.editMode) return;
      var tb = document.getElementById('float-toolbar');
      if (e.target === tb || (tb && tb.contains(e.target))) return;
      if (e.target.hasAttribute && e.target.hasAttribute('data-key')) return;
      // ヘッダーは除外
      var header = document.getElementById('edit-header');
      if (header && header.contains(e.target)) return;
      deselect();
    });

    // スクロールに追従
    window.addEventListener('scroll', positionToolbar, { passive: true });
    window.addEventListener('resize', positionToolbar);
  }

  function select(el) {
    if (state.selectedEl) {
      state.selectedEl.classList.remove('selected');
    }
    state.selectedEl = el;
    el.classList.add('selected');
    syncToolbarToSelection();
    var tb = document.getElementById('float-toolbar');
    tb.classList.add('visible');
    positionToolbar();
  }

  function deselect() {
    if (state.selectedEl) {
      state.selectedEl.classList.remove('selected');
    }
    state.selectedEl = null;
    var tb = document.getElementById('float-toolbar');
    if (tb) tb.classList.remove('visible');
  }

  function syncToolbarToSelection() {
    if (!state.selectedEl) return;
    var cs = window.getComputedStyle(state.selectedEl);

    // ターゲット表示
    var name = document.getElementById('tb-target-name');
    if (name) name.textContent = state.selectedEl.getAttribute('data-key') || '—';

    // フォント
    var fontSelect = document.getElementById('tb-font');
    if (fontSelect) {
      var inline = state.selectedEl.style.fontFamily;
      var matched = false;
      for (var i = 0; i < FONT_PRESETS.length; i++) {
        if (FONT_PRESETS[i].value === inline) {
          fontSelect.value = FONT_PRESETS[i].value;
          matched = true;
          break;
        }
      }
      if (!matched) {
        fontSelect.selectedIndex = 0;
      }
    }

    // サイズ
    var sizeInput = document.getElementById('tb-size');
    if (sizeInput) {
      sizeInput.value = Math.round(parseFloat(cs.fontSize));
    }

    // 色（rgb→hex）
    var colorInput = document.getElementById('tb-color');
    if (colorInput) {
      colorInput.value = rgbToHex(cs.color);
    }

    // 太字
    var boldBtn = document.getElementById('tb-bold');
    if (boldBtn) {
      var w = parseInt(cs.fontWeight, 10) || 400;
      boldBtn.classList.toggle('active', w >= 700);
    }
  }

  function positionToolbar() {
    if (!state.selectedEl) return;
    var tb = document.getElementById('float-toolbar');
    if (!tb) return;
    var rect = state.selectedEl.getBoundingClientRect();
    var tbHeight = tb.offsetHeight || 80;
    var tbWidth = tb.offsetWidth || 420;
    var top = rect.top - tbHeight - 8;
    if (top < 60) top = rect.bottom + 8;
    var left = rect.left + rect.width / 2 - tbWidth / 2;
    if (left < 8) left = 8;
    if (left + tbWidth > window.innerWidth - 8) {
      left = window.innerWidth - tbWidth - 8;
    }
    tb.style.top = top + 'px';
    tb.style.left = left + 'px';
  }

  // ---------- 永続化（localStorage） ----------
  function persist() {
    var snapshot = {};
    state.elements.forEach(function (el) {
      var key = el.getAttribute('data-key');
      if (!key) return;
      snapshot[key] = {
        text: el.innerText,
        style: {
          fontFamily: el.style.fontFamily || '',
          fontSize: el.style.fontSize || '',
          color: el.style.color || '',
          fontWeight: el.style.fontWeight || ''
        }
      };
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (err) {
      console.warn('localStorage 保存失敗:', err);
    }
  }

  function loadFromStorage() {
    var raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return;
    }
    if (!raw) return;
    var snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch (err) {
      return;
    }
    state.elements.forEach(function (el) {
      var key = el.getAttribute('data-key');
      if (!key || !snapshot[key]) return;
      var s = snapshot[key];
      if (typeof s.text === 'string') el.innerText = s.text;
      if (s.style) {
        if (s.style.fontFamily) el.style.fontFamily = s.style.fontFamily;
        if (s.style.fontSize) el.style.fontSize = s.style.fontSize;
        if (s.style.color) el.style.color = s.style.color;
        if (s.style.fontWeight) el.style.fontWeight = s.style.fontWeight;
      }
    });
    showStatus('編集内容を復元しました', '#60A5FA');
  }

  function resetAll() {
    if (!confirm('すべての編集をリセットして初期状態に戻しますか？')) return;
    state.elements.forEach(function (el) {
      var original = el.getAttribute('data-original');
      if (typeof original === 'string') el.innerText = original;
      el.style.fontFamily = '';
      el.style.fontSize = '';
      el.style.color = '';
      el.style.fontWeight = '';
    });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) { /* noop */ }
    deselect();
    showStatus('リセットしました', '#FBBF24');
  }

  // ---------- GitHub に保存（F案: Worker /save 経由） ----------
  function publishToGitHub() {
    var publishBtn = document.getElementById('publish-btn');
    if (!confirm('編集内容を GitHub に保存して公開しますか？\n\n変更は数分以内に公開URLに反映されます。')) return;

    if (publishBtn) {
      publishBtn.disabled = true;
      publishBtn.textContent = '保存中...';
    }
    showStatus('GitHub に保存中...', '#FBBF24');

    buildEditedHtml()
      .then(function (html) {
        return fetch('/save', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            html: html,
            message: 'chore(cms): update index.html via edit_ui'
          })
        });
      })
      .then(function (res) {
        if (res.status === 401) {
          alert('セッションが切れました。再ログインします。');
          window.location.href = '/login?next=' + encodeURIComponent('/edit');
          return null;
        }
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      })
      .then(function (r) {
        if (!r) return;
        var res = r.res;
        var data = r.data;
        if (res.ok && data && data.ok) {
          var sha = data.commit ? data.commit.slice(0, 7) : '';
          showStatus('GitHub に保存しました (' + sha + ')', '#4ADE80');
          if (data.commit_url) {
            var msg = 'GitHub への保存に成功しました。\n\nコミット: ' + sha + '\n\nコミットURL を開きますか？';
            if (confirm(msg)) {
              window.open(data.commit_url, '_blank', 'noopener');
            }
          } else {
            alert('GitHub への保存に成功しました（commit: ' + sha + '）');
          }
        } else {
          var emsg = (data && data.error) ? data.error : 'unknown error';
          showStatus('保存失敗: ' + emsg, '#F87171');
          alert('GitHub への保存に失敗しました:\n' + emsg);
        }
      })
      .catch(function (err) {
        console.error(err);
        showStatus('保存失敗: ' + err.message, '#F87171');
        alert('保存に失敗しました:\n' + err.message);
      })
      .then(function () {
        if (publishBtn) {
          publishBtn.disabled = false;
          publishBtn.textContent = 'GitHubに保存（公開）';
        }
      });
  }

  // 編集済み HTML を組み立てる（exportEditedHtml と同じロジックを Promise 返却版で）
  function buildEditedHtml() {
    return fetch('index.html', { credentials: 'include' })
      .then(function (res) {
        if (!res.ok) throw new Error('index.html 取得失敗 (' + res.status + ')');
        return res.text();
      })
      .then(function (html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');

        state.elements.forEach(function (el) {
          var key = el.getAttribute('data-key');
          if (!key) return;
          var target = doc.querySelector('[data-key="' + cssEscape(key) + '"]');
          if (!target) return;
          target.innerText = el.innerText;
          var origStyle = target.getAttribute('style') || '';
          var origMap = parseStyleString(origStyle);
          delete origMap['font-family'];
          delete origMap['font-size'];
          delete origMap['color'];
          delete origMap['font-weight'];
          var inlineParts = [];
          Object.keys(origMap).forEach(function (k) {
            inlineParts.push(k + ': ' + origMap[k]);
          });
          if (el.style.fontFamily) inlineParts.push('font-family: ' + el.style.fontFamily);
          if (el.style.fontSize) inlineParts.push('font-size: ' + el.style.fontSize);
          if (el.style.color) inlineParts.push('color: ' + el.style.color);
          if (el.style.fontWeight) inlineParts.push('font-weight: ' + el.style.fontWeight);
          if (inlineParts.length) {
            target.setAttribute('style', inlineParts.join('; '));
          } else if (origStyle) {
            target.removeAttribute('style');
          }
        });

        return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
      })
      .catch(function (err) {
        console.warn('index.html fetch 失敗、現在のDOMから生成:', err);
        return buildFromCurrentDom();
      });
  }

  // ---------- index_edited.html ダウンロード ----------
  function exportEditedHtml() {
    // 元 index.html を fetch して、data-key 要素のテキスト + style を上書き
    fetch('index.html')
      .then(function (res) {
        if (!res.ok) throw new Error('index.html 取得失敗 (' + res.status + ')');
        return res.text();
      })
      .then(function (html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');

        state.elements.forEach(function (el) {
          var key = el.getAttribute('data-key');
          if (!key) return;
          var target = doc.querySelector('[data-key="' + cssEscape(key) + '"]');
          if (!target) return;
          // テキスト上書き
          target.innerText = el.innerText;
          // インラインstyle 上書き（既存style と統合）
          var inlineParts = [];
          var origStyle = target.getAttribute('style') || '';
          // 既存style から fontFamily/fontSize/color/fontWeight を除外
          var origMap = parseStyleString(origStyle);
          delete origMap['font-family'];
          delete origMap['font-size'];
          delete origMap['color'];
          delete origMap['font-weight'];
          Object.keys(origMap).forEach(function (k) {
            inlineParts.push(k + ': ' + origMap[k]);
          });
          if (el.style.fontFamily) inlineParts.push('font-family: ' + el.style.fontFamily);
          if (el.style.fontSize) inlineParts.push('font-size: ' + el.style.fontSize);
          if (el.style.color) inlineParts.push('color: ' + el.style.color);
          if (el.style.fontWeight) inlineParts.push('font-weight: ' + el.style.fontWeight);
          if (inlineParts.length) {
            target.setAttribute('style', inlineParts.join('; '));
          } else if (origStyle) {
            target.removeAttribute('style');
          }
        });

        var serialized = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
        downloadFile('index_edited.html', serialized);
        showStatus('index_edited.html をダウンロードしました', '#4ADE80');
      })
      .catch(function (err) {
        // file:// 経由など fetch が使えない場合のフォールバック：
        // 現在の DOM（編集UI部分を除外）をシリアライズ
        console.warn('index.html fetch 失敗、現在のDOMから生成:', err);
        var fallback = buildFromCurrentDom();
        downloadFile('index_edited.html', fallback);
        showStatus('（fallback）index_edited.html を生成', '#FBBF24');
      });
  }

  function buildFromCurrentDom() {
    // 現在ドキュメントをコピーし、編集UI関連を除去
    var clone = document.documentElement.cloneNode(true);
    var rm = function (sel) {
      var nodes = clone.querySelectorAll(sel);
      Array.prototype.forEach.call(nodes, function (n) {
        n.parentNode && n.parentNode.removeChild(n);
      });
    };
    rm('#edit-header');
    rm('#float-toolbar');
    rm('link[href="edit_ui.css"]');
    rm('script[src="edit_ui.js"]');
    // page-content ラッパーを外して .page-wrapper を直下に
    var pc = clone.querySelector('#page-content');
    if (pc && pc.parentNode) {
      while (pc.firstChild) {
        pc.parentNode.insertBefore(pc.firstChild, pc);
      }
      pc.parentNode.removeChild(pc);
    }
    // 各 data-key から contenteditable と selected を外す
    var nodes = clone.querySelectorAll('[data-key]');
    Array.prototype.forEach.call(nodes, function (n) {
      n.removeAttribute('contenteditable');
      n.removeAttribute('spellcheck');
      n.classList.remove('selected');
    });
    // body のクラス（edit-on / edit-off）も外す
    var b = clone.querySelector('body');
    if (b) {
      b.classList.remove('edit-on');
      b.classList.remove('edit-off');
    }
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  // ---------- ユーティリティ ----------
  function downloadFile(filename, content) {
    var blob = new Blob([content], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  function rgbToHex(rgb) {
    if (!rgb) return '#111111';
    var m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return '#111111';
    function h(n) { return ('0' + parseInt(n, 10).toString(16)).slice(-2); }
    return '#' + h(m[1]) + h(m[2]) + h(m[3]);
  }

  function parseStyleString(s) {
    var out = {};
    if (!s) return out;
    s.split(';').forEach(function (pair) {
      var idx = pair.indexOf(':');
      if (idx < 0) return;
      var k = pair.slice(0, idx).trim().toLowerCase();
      var v = pair.slice(idx + 1).trim();
      if (k) out[k] = v;
    });
    return out;
  }

  function cssEscape(s) {
    return String(s).replace(/(["\\])/g, '\\$1');
  }

  function showStatus(msg, color) {
    var el = document.getElementById('save-status');
    if (!el) return;
    el.style.color = color || '#4ADE80';
    el.textContent = msg;
    if (state.statusTimer) clearTimeout(state.statusTimer);
    state.statusTimer = setTimeout(function () {
      el.textContent = '';
    }, 2500);
  }
})();
