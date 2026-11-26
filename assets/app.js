/* 퍼피댕 웹 — 카드 게시판 + admin 전용 글쓰기 */
(function () {
  'use strict';

  var SB_URL = 'https://hrhvpihzuerwjzcqebfs.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyaHZwaWh6dWVyd2p6cWViZnMiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc5NTUyNzg0OSwiZXhwIjoyMTExMTAzODQ5fQ.KJr1tqN4JBvPpcmwDoI-uL0IEumOoy2MSRF74jXeloQ';
  var ADMIN_EMAIL = 'admin@puppydaeng.app';
  var BANNERS = ['banner-1.jpg', 'banner-2.jpg', 'banner-3.jpg', 'banner-4.jpg', 'banner-5.jpg', 'banner-6.jpg'];

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var sb = null;
  var rows = [];                 // site_posts rows
  var tableMissing = false;
  var POSTS = {};                // slug -> post data for modal
  var staticClones = [];         // 원본 정적 카드 (숨김/복원 대비)
  var staticDefaults = {};       // slug -> 원본 값
  var editingSlug = null;
  var chosenBanner = 'banner-1.jpg';
  var chosenDataUrl = '';
  var currentUser = null;

  /* ───────── 유틸 ───────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function inline(s) {
    return s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
  function renderBody(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n');
    var out = [], list = [];
    function flush() {
      if (list.length) { out.push('<ul>' + list.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'); list = []; }
    }
    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line) { flush(); return; }
      if (/^[-*]\s+/.test(line)) { list.push(inline(esc(line.replace(/^[-*]\s+/, '')))); return; }
      if (/^##\s+/.test(line)) { flush(); out.push('<h2>' + inline(esc(line.replace(/^##\s+/, ''))) + '</h2>'); return; }
      if (/^###\s+/.test(line)) { flush(); out.push('<h2>' + inline(esc(line.replace(/^###\s+/, ''))) + '</h2>'); return; }
      flush();
      out.push('<p>' + inline(esc(line)) + '</p>');
    });
    flush();
    return out.join('') || '<p>본문이 아직 없습니다.</p>';
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }
  function toDateInput(iso) { return iso ? String(iso).slice(0, 10) : ''; }
  function thumbSrc(row) {
    if (row.thumbnail_url) return row.thumbnail_url;
    if (row.banner_key && BANNERS.indexOf(row.banner_key) >= 0) return 'images/' + row.banner_key;
    return 'images/banner-1.jpg';
  }
  function toast(msg) {
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#0f1f1a;color:#fff;' +
      'padding:12px 18px;border-radius:8px;font-size:14px;z-index:200;box-shadow:0 10px 30px rgba(0,0,0,.25);max-width:88vw;';
    document.body.appendChild(el);
    setTimeout(function () { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, 2200);
    setTimeout(function () { el.remove(); }, 2600);
  }

  /* ───────── 모달 공통 ───────── */
  var lastFocus = null;
  function openModal(id) {
    var m = document.getElementById(id);
    if (!m) return;
    lastFocus = document.activeElement;
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    var f = m.querySelector('input,button,textarea,a');
    if (f) setTimeout(function () { try { f.focus(); } catch (e) {} }, 60);
  }
  function closeModal(m) {
    if (!m) return;
    m.hidden = true;
    if (!$$('.modal').some(function (x) { return !x.hidden; })) document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }
  document.addEventListener('click', function (e) {
    var closeBtn = e.target.closest('[data-close]');
    if (closeBtn) { closeModal(closeBtn.closest('.modal')); return; }
    if (e.target.classList && e.target.classList.contains('modal')) { closeModal(e.target); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var open = $$('.modal').filter(function (x) { return !x.hidden; });
      if (open.length) { closeModal(open[open.length - 1]); }
    }
  });

  /* ───────── 카드 렌더 ───────── */
  function staticCards() { return $$('#postGrid .card'); }

  function applyRowToCard(card, row) {
    if (!row) return;
    var slug = card.getAttribute('data-slug');
    if (row.title) {
      var t = card.querySelector('.card-title a');
      if (t) t.textContent = row.title;
    }
    if (row.category) {
      var c = card.querySelector('.card-cat');
      if (c) c.textContent = row.category;
    }
    if (row.excerpt) {
      var ex = card.querySelector('.card-ex');
      if (ex) ex.textContent = row.excerpt;
    }
    var img = card.querySelector('.card-thumb img');
    if (img && (row.thumbnail_url || row.banner_key)) img.src = thumbSrc(row);
    // 관리자용 수정/삭제 버튼 slug 유지
    $$('[data-edit]', card).forEach(function (b) { b.setAttribute('data-edit', slug); });
    $$('[data-del]', card).forEach(function (b) { b.setAttribute('data-del', slug); });
    $$('[data-open]', card).forEach(function (a) { a.setAttribute('data-open', slug); a.setAttribute('href', '#' + slug); });
  }

  function buildCard(row) {
    var cat = row.category || '분양 소식';
    var dateTxt = fmtDate(row.created_at);
    var el = document.createElement('article');
    el.className = 'card';
    el.setAttribute('data-slug', row.slug);
    el.setAttribute('data-custom', '1');
    el.innerHTML =
      '<a class="card-thumb" href="#' + esc(row.slug) + '" data-open="' + esc(row.slug) + '">' +
        '<img src="' + esc(thumbSrc(row)) + '" alt="' + esc(row.title || '') + '" width="1200" height="1200">' +
      '</a>' +
      '<div class="card-body">' +
        '<span class="card-cat">' + esc(cat) + '</span>' +
        '<h3 class="card-title"><a href="#' + esc(row.slug) + '" data-open="' + esc(row.slug) + '">' + esc(row.title || '') + '</a></h3>' +
        '<p class="card-meta"><time datetime="' + esc(toDateInput(row.created_at)) + '">' + esc(dateTxt) + '</time> · 댓글 없음</p>' +
        '<p class="card-ex">' + esc(row.excerpt || '') + '</p>' +
        '<div class="card-actions">' +
          '<a class="btn-read" href="#' + esc(row.slug) + '" data-open="' + esc(row.slug) + '">더 읽기</a>' +
          '<span class="admin-only"' + (document.body.classList.contains('is-admin') ? '' : ' hidden') + '>' +
            '<button class="mini" type="button" data-edit="' + esc(row.slug) + '">수정</button> ' +
            '<button class="mini danger" type="button" data-del="' + esc(row.slug) + '">삭제</button>' +
          '</span>' +
        '</div>' +
      '</div>';
    return el;
  }

  function buildPosts() {
    POSTS = {};
    var grid = $('#postGrid');
    var src = {};
    $$('#postSource .pm-src').forEach(function (a) {
      src[a.getAttribute('data-slug')] = { html: a.innerHTML, date: a.getAttribute('data-date'), cat: a.getAttribute('data-cat') };
    });

    var rowBySlug = {};
    rows.forEach(function (r) { rowBySlug[r.slug] = r; });

    // 그리드 초기화 후 원본 카드 클론으로 다시 채운다 (숨김 → 복원 대비)
    grid.innerHTML = '';

    // 1) 정적 카드: 덮어쓰기 적용 / 숨김 제외
    staticClones.forEach(function (clone) {
      var slug = clone.getAttribute('data-slug');
      var row = rowBySlug[slug] || null;
      if (row && row.hidden) return;
      var card = clone.cloneNode(true);
      if (row) applyRowToCard(card, row);
      var s = src[slug] || { html: '', date: '', cat: '' };
      var t = card.querySelector('.card-title a');
      var ex = card.querySelector('.card-ex');
      var catEl = card.querySelector('.card-cat');
      var imgEl = card.querySelector('.card-thumb img');
      POSTS[slug] = {
        slug: slug,
        title: (t && t.textContent.trim()) || (row && row.title) || '',
        excerpt: (ex && ex.textContent.trim()) || '',
        cat: (row && row.category) || (catEl && catEl.textContent.trim()) || s.cat || '',
        date: fmtDate(s.date || (staticDefaults[slug] && staticDefaults[slug].date)),
        img: (imgEl && imgEl.getAttribute('src')) || 'images/banner-1.jpg',
        bodyHtml: (row && row.body) ? renderBody(row.body) : (s.html || '<p>본문이 아직 없습니다.</p>'),
        tags: (row && row.tags) || [],
        isStatic: true
      };
      grid.appendChild(card);
    });

    // 2) 새 글 (정적 슬러그가 아닌 행)
    var customs = rows.filter(function (r) { return !src[r.slug] && !r.hidden; })
      .sort(function (a, b) {
        var sa = (a.sort_order == null ? 100 : a.sort_order), sb2 = (b.sort_order == null ? 100 : b.sort_order);
        if (sa !== sb2) return sa - sb2;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
    customs.forEach(function (row) {
      grid.appendChild(buildCard(row));
      POSTS[row.slug] = {
        slug: row.slug,
        title: row.title || '',
        excerpt: row.excerpt || '',
        cat: row.category || '분양 소식',
        date: fmtDate(row.created_at),
        img: thumbSrc(row),
        bodyHtml: renderBody(row.body),
        tags: row.tags || [],
        isStatic: false
      };
    });
  }

  /* ───────── 글 보기 ───────── */
  function openPost(slug) {
    var p = POSTS[slug];
    if (!p) return;
    $('#pmHead').textContent = p.cat || '퍼피댕 분양 소식';
    var cover = $('#pmCover img');
    cover.src = p.img; cover.alt = p.title;
    var html = '';
    html += '<span class="pm-cat">' + esc(p.cat) + '</span>';
    html += '<h1>' + esc(p.title) + '</h1>';
    html += '<p class="pm-meta">' + esc(p.date) + ' · 퍼피댕 안심분양소 대전본점</p>';
    html += p.bodyHtml;
    if (p.tags && p.tags.length) html += '<p class="pm-tags">#' + p.tags.map(function (t) { return esc(String(t).replace(/^#/, '')); }).join(' #') + '</p>';
    html += '<div class="pm-cta">' +
      '<a class="btn-read" href="tel:01072744411">전화 상담 010-7274-4411</a>' +
      '<a class="btn-out" href="https://naver.me/xXwB9o43" target="_blank" rel="noopener">네이버 예약</a>' +
      '</div>';
    $('#pmBody').innerHTML = html;
    openModal('postModal');
    try { history.replaceState(null, '', '#' + slug); } catch (e) {}
  }

  document.addEventListener('click', function (e) {
    var open = e.target.closest('[data-open]');
    if (open) {
      e.preventDefault();
      openPost(open.getAttribute('data-open'));
      return;
    }
    var ct = e.target.closest('[data-contact]');
    if (ct) { e.preventDefault(); openModal('contactModal'); return; }
    var ed = e.target.closest('[data-edit]');
    if (ed) { e.preventDefault(); startEdit(ed.getAttribute('data-edit')); return; }
    var dl = e.target.closest('[data-del]');
    if (dl) { e.preventDefault(); deletePost(dl.getAttribute('data-del')); return; }
  });

  /* ───────── Supabase ───────── */
  function initSb() {
    if (!window.supabase || !window.supabase.createClient) return false;
    try {
      sb = window.supabase.createClient(SB_URL, SB_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
      return true;
    } catch (e) { return false; }
  }

  function loadPosts() {
    if (!sb) return Promise.resolve();
    return sb.from('site_posts').select('*')
      .then(function (res) {
        if (res.error) {
          var msg = (res.error.message || '') + ' ' + (res.error.code || '');
          if (/does not exist|42P01|relation|schema cache|Could not find the table/i.test(msg)) {
            tableMissing = true;
          }
          rows = [];
          return;
        }
        tableMissing = false;
        rows = Array.isArray(res.data) ? res.data : [];
      }, function () { rows = []; })
      .then(function () {
        buildPosts();
        if (currentUser) fillManageList();
        var h = (location.hash || '').replace('#', '');
        if (h && POSTS[h] && $('#postModal').hidden) openPost(h);
      });
  }

  /* ───────── 관리자 인증 ───────── */
  function setAdminUi(isAdmin) {
    document.body.classList.toggle('is-admin', !!isAdmin);
    $$('.card .admin-only').forEach(function (el) { el.hidden = !isAdmin; });
    $$('.admin-only').forEach(function (el) { el.hidden = !isAdmin; });
    var nw = $('#adminNewWrap'); if (nw) nw.hidden = !isAdmin;
    $('#admLogin').hidden = !!currentUser;
    $('#admPanel').hidden = !isAdmin;
    $('#admDenied').hidden = !(currentUser && !isAdmin);
    if (isAdmin) {
      $('#admEmail').textContent = currentUser.email;
      fillManageList();
    }
  }

  function handleSession(session) {
    currentUser = (session && session.user) || null;
    if (!currentUser) { setAdminUi(false); return; }
    var email = String(currentUser.email || '').toLowerCase();
    if (email === ADMIN_EMAIL) {
      setAdminUi(true);
    } else {
      setAdminUi(false);
      var errEl = $('#admErr');
      if (errEl) {
        errEl.textContent = 'admin 계정만 글을 쓸 수 있어요. (' + email + ')';
        errEl.hidden = false;
      }
      toast('admin 계정만 글을 쓸 수 있어요');
      // admin이 아니면 글쓰기 권한이 없으므로 세션을 정리한다
      if (sb) { setTimeout(function () { try { sb.auth.signOut(); } catch (e) {} }, 400); }
    }
  }

  function loginErrorText(err) {
    var m = (err && (err.message || err.error_description || err.msg)) || String(err || '');
    if (/Invalid login credentials|invalid_grant|invalid_credentials/i.test(m)) return '아이디 또는 비밀번호가 맞지 않아요.';
    if (/Email not confirmed/i.test(m)) return '아직 이메일 확인이 되지 않은 계정이에요.';
    if (/Invalid API key|UNAUTHORIZED_INVALID_API_KEY|apikey/i.test(m)) return '연결 정보(anon key)가 맞지 않아요. 퍼피댕 노트와 같은 Supabase 프로젝트의 anon key인지 확인해 주세요.';
    if (/Failed to fetch|NetworkError|network|timeout/i.test(m)) return '인터넷 연결을 확인해 주세요.';
    return '로그인하지 못했어요. ' + m.slice(0, 90);
  }

  function submitLogin(e) {
    if (e) e.preventDefault();
    var idEl = $('#admId'), pwEl = $('#admPw'), btn = $('#admSubmit'), errEl = $('#admErr');
    errEl.hidden = true;
    var id = (idEl.value || '').trim();
    var pw = pwEl.value || '';
    if (!id) { errEl.textContent = '아이디를 적어 주세요.'; errEl.hidden = false; idEl.focus(); return; }
    if (!pw) { errEl.textContent = '비밀번호를 적어 주세요.'; errEl.hidden = false; pwEl.focus(); return; }
    if (!sb) { errEl.textContent = '로그인 서버에 연결하지 못했어요. 새로고침 후 다시 시도해 주세요.'; errEl.hidden = false; return; }
    var email = id.indexOf('@') >= 0 ? id : id + '@puppydaeng.app';
    btn.disabled = true; btn.textContent = '로그인 중…';
    sb.auth.signInWithPassword({ email: email, password: pw }).then(function (res) {
      btn.disabled = false; btn.textContent = '로그인';
      if (res.error) {
        errEl.textContent = loginErrorText(res.error);
        errEl.hidden = false;
        pwEl.value = ''; pwEl.focus();
        return;
      }
      pwEl.value = '';
      var u = res.data && res.data.user;
      currentUser = u || null;
      if (currentUser && String(currentUser.email || '').toLowerCase() === ADMIN_EMAIL) {
        setAdminUi(true);
        $('#admErr').hidden = true;
      } else if (currentUser) {
        setAdminUi(false);
        if (sb) { try { sb.auth.signOut(); } catch (e2) {} }
      }
    }, function (err) {
      btn.disabled = false; btn.textContent = '로그인';
      errEl.textContent = loginErrorText(err);
      errEl.hidden = false;
    });
  }

  /* ───────── 글쓰기 / 수정 / 삭제 ───────── */
  function buildThumbPicker() {
    var wrap = $('#thumbPick');
    wrap.innerHTML = BANNERS.map(function (b, i) {
      return '<button type="button" data-banner="' + b + '" aria-pressed="' + (b === chosenBanner ? 'true' : 'false') + '">' +
        '<img src="images/' + b + '" alt="기본 배너 ' + (i + 1) + '"></button>';
    }).join('');
  }

  function setThumbPreview() {
    var pv = $('#thumbPreview');
    var src = chosenDataUrl || ('images/' + chosenBanner);
    pv.hidden = false;
    pv.querySelector('img').src = src;
    $$('#thumbPick button').forEach(function (b) {
      b.setAttribute('aria-pressed', (!chosenDataUrl && b.getAttribute('data-banner') === chosenBanner) ? 'true' : 'false');
    });
  }

  function resetEditor() {
    editingSlug = null;
    chosenDataUrl = '';
    chosenBanner = 'banner-1.jpg';
    $('#edTitle').value = '';
    $('#edCat').value = '';
    $('#edTags').value = '';
    $('#edEx').value = '';
    $('#edBody').value = '';
    $('#edFile').value = '';
    $('#edMsg').hidden = true;
    $('#thumbPreview').hidden = true;
    buildThumbPicker();
    selectTab('write');
  }

  function startEdit(slug) {
    if (!currentUser || String(currentUser.email).toLowerCase() !== ADMIN_EMAIL) return;
    var p = POSTS[slug];
    var row = rows.filter(function (r) { return r.slug === slug; })[0] || null;
    editingSlug = slug;
    chosenDataUrl = (row && row.thumbnail_url && /^data:|^https?:/.test(row.thumbnail_url)) ? row.thumbnail_url : '';
    chosenBanner = (row && row.banner_key) ? row.banner_key : (p && /banner-\d\.jpg/.test(p.img) ? p.img.replace('images/', '') : 'banner-1.jpg');
    $('#edTitle').value = (p && p.title) || '';
    $('#edCat').value = (p && p.cat) || '';
    $('#edTags').value = (row && row.tags && row.tags.length) ? row.tags.join(', ') : '';
    $('#edEx').value = (p && p.excerpt) || '';
    $('#edBody').value = (row && row.body) ? row.body : '';
    $('#edMsg').hidden = true;
    buildThumbPicker();
    setThumbPreview();
    openModal('adminModal');
    selectTab('write');
    $('#edTitle').focus();
    toast('수정 모드: 저장하면 이 글이 바뀝니다');
  }

  function savePost() {
    var msg = $('#edMsg');
    msg.hidden = true;
    if (!currentUser || String(currentUser.email).toLowerCase() !== ADMIN_EMAIL) {
      msg.className = 'msg err'; msg.textContent = 'admin 계정만 글을 쓸 수 있어요.'; msg.hidden = false; return;
    }
    if (!sb) { msg.className = 'msg err'; msg.textContent = '서버에 연결하지 못했어요.'; msg.hidden = false; return; }
    var title = ($('#edTitle').value || '').trim();
    var body = ($('#edBody').value || '').trim();
    if (!title) { msg.className = 'msg err'; msg.textContent = '제목을 적어 주세요.'; msg.hidden = false; return; }
    if (!body) { msg.className = 'msg err'; msg.textContent = '본문을 적어 주세요.'; msg.hidden = false; return; }
    var tags = ($('#edTags').value || '').split(',').map(function (t) { return t.trim().replace(/^#/, ''); }).filter(Boolean);
    var slug = editingSlug || ('post-' + Date.now().toString(36));
    var payload = {
      slug: slug,
      title: title,
      excerpt: ($('#edEx').value || '').trim() || body.replace(/[#*-]/g, '').slice(0, 110),
      body: body,
      category: ($('#edCat').value || '').trim() || '분양 소식',
      tags: tags,
      thumbnail_url: chosenDataUrl || null,
      banner_key: chosenDataUrl ? null : chosenBanner,
      hidden: false,
      author_email: currentUser.email,
      updated_at: new Date().toISOString()
    };
    var btn = $('#edSave');
    btn.disabled = true; btn.textContent = '저장 중…';
    sb.from('site_posts').upsert(payload, { onConflict: 'slug' }).then(function (res) {
      btn.disabled = false; btn.textContent = '저장';
      if (res.error) {
        var m = (res.error.message || '') + ' ' + (res.error.code || '');
        if (/does not exist|42P01|schema cache|Could not find the table/i.test(m)) {
          tableMissing = true;
          msg.className = 'msg err';
          msg.innerHTML = '아직 <b>site_posts</b> 테이블이 없어요. <b>DB 설정</b> 탭에서 SQL을 한 번 실행해 주세요.';
        } else if (/row-level security|permission|policy|42501/i.test(m)) {
          msg.className = 'msg err';
          msg.textContent = 'admin 계정만 저장할 수 있어요. (권한 정책 확인 필요)';
        } else {
          msg.className = 'msg err';
          msg.textContent = '저장하지 못했어요. ' + m.slice(0, 120);
        }
        msg.hidden = false;
        return;
      }
      msg.className = 'msg ok';
      msg.textContent = editingSlug ? '수정했어요.' : '새 글을 올렸어요.';
      msg.hidden = false;
      var wasEditing = editingSlug;
      editingSlug = slug;
      loadPosts().then(function () {
        fillManageList();
        var card = document.querySelector('.card[data-slug="' + slug + '"]');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast(wasEditing ? '수정했어요' : '새 글을 올렸어요');
      });
    }, function (err) {
      btn.disabled = false; btn.textContent = '저장';
      msg.className = 'msg err';
      msg.textContent = '저장하지 못했어요. ' + String((err && err.message) || err).slice(0, 120);
      msg.hidden = false;
    });
  }

  function deletePost(slug) {
    if (!currentUser || String(currentUser.email).toLowerCase() !== ADMIN_EMAIL) return;
    var p = POSTS[slug];
    var isStatic = p && p.isStatic;
    var q = isStatic
      ? '기본 글 "' + p.title + '"을(를) 사이트에서 숨길까요?\n(나중에 [글 관리]에서 복원할 수 있어요.)'
      : '이 글을 삭제할까요?\n지우면 되돌릴 수 없어요.';
    if (!window.confirm(q)) return;
    if (!sb) { toast('서버에 연결하지 못했어요'); return; }
    var done = function (res) {
      if (res && res.error) {
        var m = (res.error.message || '') + ' ' + (res.error.code || '');
        if (/does not exist|42P01|schema cache/i.test(m)) { tableMissing = true; toast('먼저 DB 설정(SQL)을 실행해 주세요'); }
        else toast('처리하지 못했어요: ' + m.slice(0, 60));
        return;
      }
      loadPosts().then(function () { fillManageList(); });
      toast(isStatic ? '사이트에서 숨겼어요' : '삭제했어요');
    };
    if (isStatic) {
      sb.from('site_posts').upsert({
        slug: slug, title: (p && p.title) || slug, hidden: true,
        category: (p && p.cat) || null, banner_key: null,
        author_email: currentUser.email, updated_at: new Date().toISOString()
      }, { onConflict: 'slug' }).then(done, function (e) { toast('처리하지 못했어요'); });
    } else {
      sb.from('site_posts').delete().eq('slug', slug).then(done, function () { toast('삭제하지 못했어요'); });
    }
  }

  function fillManageList() {
    var list = $('#manageList');
    if (!list) return;
    if (!currentUser) { list.innerHTML = ''; return; }
    if (!rows.length) {
      list.innerHTML = '<li style="color:#8b948f">저장된 글이 아직 없어요. 기본 6개 글은 HTML에 들어 있어요.</li>';
      return;
    }
    var html = '';
    rows.forEach(function (r) {
      var isStatic = !!POSTS[r.slug] && POSTS[r.slug].isStatic;
      html += '<li><span><b>' + esc(r.title || r.slug) + '</b>' +
        (r.hidden ? ' <span style="color:#c05a5a;font-size:12px">(숨김)</span>' : '') +
        '<br><small style="color:#98a19c">' + esc(r.slug) + (isStatic ? ' · 기본 글' : ' · 새 글') + '</small></span>' +
        '<span style="white-space:nowrap">' +
        '<button class="mini" type="button" data-edit="' + esc(r.slug) + '">수정</button> ' +
        (r.hidden
          ? '<button class="mini" type="button" data-restore="' + esc(r.slug) + '">복원</button>'
          : '<button class="mini danger" type="button" data-del="' + esc(r.slug) + '">삭제</button>') +
        '</span></li>';
    });
    list.innerHTML = html;
  }

  document.addEventListener('click', function (e) {
    var rb = e.target.closest('[data-restore]');
    if (rb) {
      var slug = rb.getAttribute('data-restore');
      sb.from('site_posts').update({ hidden: false, updated_at: new Date().toISOString() }).eq('slug', slug)
        .then(function (res) {
          if (res.error) { toast('복원하지 못했어요'); return; }
          loadPosts().then(fillManageList); toast('다시 보이게 했어요');
        });
    }
  });

  /* ───────── 탭 / SQL ───────── */
  function selectTab(name) {
    $$('.adm-tabs button').forEach(function (b) {
      b.setAttribute('aria-selected', b.getAttribute('data-tab') === name ? 'true' : 'false');
    });
    $$('#admPanel [data-pane]').forEach(function (p) {
      p.hidden = p.getAttribute('data-pane') !== name;
    });
    if (name === 'setup' && tableMissing) {
      var m = $('#setupMsg');
      m.hidden = false; m.className = 'msg err';
      m.textContent = '아직 site_posts 테이블이 없어 보여요. 아래 SQL을 실행해 주세요.';
    }
  }

  var SQL = [
    '-- 퍼피댕 웹 게시판 (1회 실행)',
    'create extension if not exists pgcrypto;',
    '',
    'create table if not exists public.site_posts (',
    '  id uuid primary key default gen_random_uuid(),',
    '  slug text not null unique,',
    '  title text not null,',
    '  excerpt text,',
    '  body text,',
    '  category text,',
    '  tags text[] default \'{}\',',
    '  thumbnail_url text,',
    '  banner_key text,',
    '  sort_order integer default 100,',
    '  hidden boolean not null default false,',
    '  author_email text,',
    '  created_at timestamptz not null default now(),',
    '  updated_at timestamptz not null default now()',
    ');',
    '',
    'create index if not exists site_posts_sort_idx on public.site_posts (sort_order, created_at desc);',
    '',
    'alter table public.site_posts enable row level security;',
    '',
    'drop policy if exists "site_posts_read_all" on public.site_posts;',
    'create policy "site_posts_read_all" on public.site_posts',
    '  for select using (true);',
    '',
    'drop policy if exists "site_posts_admin_insert" on public.site_posts;',
    'create policy "site_posts_admin_insert" on public.site_posts',
    '  for insert to authenticated',
    '  with check (lower(coalesce(auth.jwt() ->> \'email\', \'\')) = \'admin@puppydaeng.app\');',
    '',
    'drop policy if exists "site_posts_admin_update" on public.site_posts;',
    'create policy "site_posts_admin_update" on public.site_posts',
    '  for update to authenticated',
    '  using (lower(coalesce(auth.jwt() ->> \'email\', \'\')) = \'admin@puppydaeng.app\')',
    '  with check (lower(coalesce(auth.jwt() ->> \'email\', \'\')) = \'admin@puppydaeng.app\');',
    '',
    'drop policy if exists "site_posts_admin_delete" on public.site_posts;',
    'create policy "site_posts_admin_delete" on public.site_posts',
    '  for delete to authenticated',
    '  using (lower(coalesce(auth.jwt() ->> \'email\', \'\')) = \'admin@puppydaeng.app\');',
    '',
    'grant select on public.site_posts to anon, authenticated;',
    'grant insert, update, delete on public.site_posts to authenticated;'
  ].join('\n');

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); resolve(); } catch (e) { reject(e); }
      ta.remove();
    });
  }

  /* ───────── 초기화 ───────── */
  function bind() {
    var f = $('#admForm'); if (f) f.addEventListener('submit', submitLogin);
    var ab = $('#btnAdmin');
    if (ab) ab.addEventListener('click', function () {
      openModal('adminModal');
      if (currentUser && String(currentUser.email).toLowerCase() === ADMIN_EMAIL) { setAdminUi(true); selectTab('write'); }
    });
    var lo = $('#admLogout');
    if (lo) lo.addEventListener('click', function () {
      if (sb) { try { sb.auth.signOut(); } catch (e) {} }
      currentUser = null; setAdminUi(false); toast('로그아웃했어요');
    });
    var dox = $('#admDeniedOut');
    if (dox) dox.addEventListener('click', function () {
      if (sb) { try { sb.auth.signOut(); } catch (e) {} }
      currentUser = null; setAdminUi(false);
    });
    var np = $('#btnNewPost');
    if (np) np.addEventListener('click', function () {
      if (!currentUser || String(currentUser.email).toLowerCase() !== ADMIN_EMAIL) { openModal('adminModal'); return; }
      resetEditor(); openModal('adminModal'); selectTab('write');
    });
    var sv = $('#edSave'); if (sv) sv.addEventListener('click', savePost);
    var rs = $('#edReset'); if (rs) rs.addEventListener('click', function () { resetEditor(); toast('새 글 쓰기로 초기화했어요'); });
    $$('.adm-tabs button').forEach(function (b) {
      b.addEventListener('click', function () { selectTab(b.getAttribute('data-tab')); });
    });
    var pick = $('#thumbPick');
    if (pick) pick.addEventListener('click', function (e) {
      var b = e.target.closest('[data-banner]');
      if (!b) return;
      chosenBanner = b.getAttribute('data-banner');
      chosenDataUrl = '';
      setThumbPreview();
    });
    var file = $('#edFile');
    if (file) file.addEventListener('change', function () {
      var f2 = file.files && file.files[0];
      if (!f2) return;
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var max = 1200, w = img.width, h = img.height;
          if (w > max || h > max) {
            var s = Math.min(max / w, max / h);
            w = Math.round(w * s); h = Math.round(h * s);
          }
          var cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          chosenDataUrl = cv.toDataURL('image/jpeg', 0.82);
          setThumbPreview();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(f2);
    });
    var sqlBtn = $('#admSqlBtn');
    if (sqlBtn) sqlBtn.addEventListener('click', function () { openModal('sqlModal'); });
    var cs = $('#copySql'), cs2 = $('#copySql2');
    function doCopy() {
      copyText(SQL).then(function () {
        var ok = $('#copyOk'); if (ok) { ok.hidden = false; setTimeout(function () { ok.hidden = true; }, 2600); }
        toast('SQL을 복사했어요');
      }, function () { toast('복사하지 못했어요. 직접 선택해 복사해 주세요.'); });
    }
    if (cs) cs.addEventListener('click', doCopy);
    if (cs2) cs2.addEventListener('click', doCopy);

    var s1 = $('#sqlBox'), s2 = $('#sqlBox2');
    if (s1) s1.textContent = SQL;
    if (s2) s2.textContent = SQL;
  }

  function init() {
    bind();
    buildThumbPicker();
    staticCards().forEach(function (c) {
      staticClones.push(c.cloneNode(true));
      var slug = c.getAttribute('data-slug');
      var tm = c.querySelector('.card-meta time');
      staticDefaults[slug] = { date: tm ? tm.getAttribute('datetime') : '' };
    });
    if (!initSb()) {
      // supabase-js를 못 불러와도 정적 카드는 그대로 보인다
      buildPosts();
    } else {
      buildPosts();
      loadPosts();
      sb.auth.getSession().then(function (res) {
        handleSession(res && res.data && res.data.session);
      }, function () { handleSession(null); });
      sb.auth.onAuthStateChange(function (evt, session) {
        if (evt === 'SIGNED_OUT') { handleSession(null); return; }
        handleSession(session);
      });
    }
    // 딥링크 (#slug)
    var h = (location.hash || '').replace('#', '');
    if (h && POSTS[h]) setTimeout(function () { openPost(h); }, 200);
    window.addEventListener('hashchange', function () {
      var s = (location.hash || '').replace('#', '');
      if (s && POSTS[s]) openPost(s);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
