(function () {
  "use strict";

  var D = window.CAMPUS;
  var RENT = window.RENT || { listings: [], sources: [], tips: [] };
  var W = D.size.w, H = D.size.h;

  var COLORS = {
    shortcut: "#e03131", rest: "#2f9e44", study: "#5f3dc4", walk: "#d6336c",
    food: "#f08c00", convenience: "#0c8599", transport: "#1971c2", academic: "#9c36b5",
    living: "#a6611a", rent: "#0b7285", building: "#8a5a1c", etc: "#495057"
  };

  // 지도에 있는 원룸 건물을 '자취방' 장소로 합치고, 같은 건물 매물을 연결
  var houseByName = {};
  (D.housing || []).forEach(function (h, i) {
    var p = { id: 100000 + i, name: h.name, loc: h.addr ? "충북 충주시 대소원면 " + h.addr : "", link: "", orig: "주거",
      date: "", rec: 0, cats: ["rent"], x: h.x, y: h.y, house: true, listings: [] };
    houseByName[h.name] = p;
    D.places.push(p);
  });
  // 블루밍(교통대 자취방 앱) 건물별 연세·학기 가격 연결. 이름 띄어쓰기 차이, "참평안텔" -> "참평안텔 A동/B동"도 맞춤
  var BLUM = window.BLUMING || null;
  var blumMatched = 0;
  if (BLUM) {
    var nk = function (n) { return n.replace(/\s+/g, "").toLowerCase(); };
    var houses = Object.keys(houseByName).map(function (n) { return [nk(n), houseByName[n]]; });
    var attach = function (bn, key, val) {
      var b = nk(bn), hit = houses.filter(function (h) { return h[0] === b; });
      if (!hit.length && !/동$/.test(b)) hit = houses.filter(function (h) { return h[0].indexOf(b) === 0 && /동$/.test(h[0]); });
      hit.forEach(function (h) { (h[1].blum = h[1].blum || {})[key] = val; });
      return hit.length;
    };
    Object.keys(BLUM.yearly || {}).forEach(function (n) { if (attach(n, "y", BLUM.yearly[n])) blumMatched++; });
    Object.keys(BLUM.semester || {}).forEach(function (n) { attach(n, "s", BLUM.semester[n]); });
  }
  RENT.listings.forEach(function (l, i) {
    l.idx = i;
    var h = l.building && houseByName[l.building];
    if (h) { h.listings.push(l); l.place = h.id; }
  });
  var CAT = {};
  D.categories.forEach(function (c) { c.color = COLORS[c.id] || "#495057"; CAT[c.id] = c; });
  var ROUTE_CATS = { ict: ["shortcut"], insa: ["shortcut"], ridge: ["shortcut"], loop: ["shortcut", "walk"] };
  var ROUTE = {};
  D.routes.forEach(function (r) { ROUTE[r.id] = r; });
  var PLACE = {};
  D.places.forEach(function (p) { PLACE[p.id] = p; });
  var BLD = {};
  D.buildings.forEach(function (b) { BLD[b.code] = b; });

  var state = { cat: "all", q: "", onlyMap: false, sel: null, route: null,
    rf: { deal: "all", dep: 500, rent: 60, type: "all" } };

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function ll(x, y) { return [H - y, x]; }
  function mainCat(p) { return state.cat !== "all" && p.cats.indexOf(state.cat) >= 0 ? state.cat : p.cats[0]; }
  function isMobile() { return window.matchMedia("(max-width: 820px)").matches; }

  // ------------------------------------------------------------ 지도
  var map = L.map("map", {
    crs: L.CRS.Simple, minZoom: -2, maxZoom: 2.5, zoomSnap: 0.25, zoomDelta: 0.5,
    attributionControl: true, zoomControl: true, maxBoundsViscosity: 0.8
  });
  var bounds = [[0, 0], [H, W]];
  L.imageOverlay("map/campus.svg", bounds, { interactive: false }).addTo(map);
  map.setMaxBounds([[-200, -200], [H + 200, W + 200]]);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>');

  // 캠퍼스 건물이 화면에 꽉 차게
  var campusB = L.latLngBounds(D.buildings.map(function (b) { return ll(b.x, b.y); }));
  map.fitBounds(campusB.pad(0.08));
  var homeZoom = map.getZoom();

  // 화면 크기가 바뀌면 지도 크기 다시 계산 (모바일 회전, 창 크기 변경)
  if (window.ResizeObserver) new ResizeObserver(function () { map.invalidateSize(); }).observe(document.getElementById("map"));

  var pendingMove = null;
  function moveMap(fn) {
    var sz = map.getSize();
    if (!sz.x || !sz.y) { pendingMove = fn; return; }
    pendingMove = null;
    try { fn(); } catch (e) { /* 애니메이션 중 크기 변화 등은 무시 */ }
  }

  var labelLayer = L.layerGroup().addTo(map);
  D.buildings.forEach(function (b) {
    L.marker(ll(b.x, b.y), {
      keyboard: false, zIndexOffset: -500,
      icon: L.divIcon({ className: "blabel", html: "<b>" + esc(b.code) + "</b><span class='bn'>" + esc(b.name) + "</span>", iconSize: null })
    }).on("click", function () { showBuilding(b.code); }).addTo(labelLayer);
  });
  var busLayer = L.layerGroup();
  var seenBus = {};
  D.busStops.forEach(function (s) {
    var k = s.name.replace(/건너편|\(|\)|\s/g, "");
    if (seenBus[k]) return;
    seenBus[k] = 1;
    L.marker(ll(s.x, s.y), {
      icon: L.divIcon({ className: "bus", html: "🚏", iconSize: [16, 16] }), title: s.name
    }).bindTooltip(s.name, { direction: "top", offset: [0, -6] }).addTo(busLayer);
  });

  function onZoom() {
    var z = map.getZoom(), c = map.getContainer().classList;
    c.toggle("z-far", z < homeZoom + 0.5);
    c.toggle("z-far2", z < homeZoom - 0.5);
  }
  map.on("zoomend", onZoom);
  onZoom();

  var markerLayer = L.layerGroup().addTo(map);

  // ------------------------------------------------------------ 선택한 위치 강조: 그 자리 마커의 테두리만 진하게
  var focusAt = null;
  function placeLabel(p) {
    var b = p.b && BLD[p.b];
    var fl = (p.loc.match(/(\d+)\s*층/) || [])[1];
    return p.name + (b && p.name.indexOf(b.name.split("/")[0]) < 0 ? " · " + b.name.split("/")[0] : "") +
      (p.b ? " (" + p.b + ")" : "") + (fl ? " " + fl + "층" : "");
  }
  function markFocus(x, y, cls) {
    var target = ll(x, y);
    markerLayer.eachLayer(function (m) {
      var el = m.getElement && m.getElement();
      if (!el) return;
      var p = m.getLatLng();
      if (Math.abs(p.lat - target[0]) < 0.5 && Math.abs(p.lng - target[1]) < 0.5) el.classList.add(cls);
    });
  }
  function unmark(cls) {
    var on = document.querySelectorAll("." + cls);
    for (var i = 0; i < on.length; i++) on[i].classList.remove(cls);
  }
  function showFocus(x, y, label, soft) {
    unmark("focus-soft");
    if (soft) { markFocus(x, y, "focus-soft"); return; }
    unmark("focus-on");
    focusAt = [x, y];
    markFocus(x, y, "focus-on");
  }
  function clearFocus() { unmark("focus-on"); unmark("focus-soft"); focusAt = null; }

  // 상세 카드(데스크톱: 오른쪽 / 모바일: 아래)에 가리지 않는 곳으로 지도를 옮김
  function flyToVisible(target, z) {
    moveMap(function () {
      var size = map.getSize(), card = $("#detail");
      var dx = 0, dy = 0;
      if (isMobile()) dy = size.y * 0.25;
      else if (card && !card.hidden) dx = Math.min(card.offsetWidth + 24, size.x * 0.5) / 2;
      var c = map.unproject(map.project(target, z).add([dx, dy]), z);
      if (isMobile()) map.setView(c, z, { animate: false });
      else map.flyTo(c, z, { duration: 0.5 });
    });
  }
  var routeLayer = L.layerGroup().addTo(map);
  var markerByKey = {};

  // ------------------------------------------------------------ 필터
  function matches(p, cat) {
    if (cat !== "all" && p.cats.indexOf(cat) < 0) return false;
    // 전체 보기에서는 원룸 건물(116곳)을 검색할 때만 보여줌
    if (cat === "all" && p.house && !state.q) return false;
    if (p.house && cat === "rent" && rentFiltered() && !p.listings.some(listingOk) && !blumOk(p)) return false;
    if (state.onlyMap && p.x == null) return false;
    if (state.q) {
      var t = (p.name + " " + (p.aka || []).join(" ") + " " + p.loc + " " + (p.desc || "") + " " + (p.b || "") + " " + (p.b && BLD[p.b] ? BLD[p.b].name : "") +
        (p.blum ? " 블루밍 연세 " : "") + (p.house ? " 원룸 자취방 자취 " + p.listings.map(function (l) { return l.deal + " " + l.type + " " + (l.memo || ""); }).join(" ") : "")).toLowerCase();
      var words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < words.length; i++) if (t.indexOf(words[i]) < 0) return false;
    }
    return true;
  }
  function filtered() { return D.places.filter(function (p) { return matches(p, state.cat); }); }

  // ------------------------------------------------------------ 자취방 시세
  function rentFiltered() {
    var f = state.rf;
    return f.deal !== "all" || f.dep < 500 || f.rent < 60 || f.type !== "all";
  }
  function listingOk(l) {
    var f = state.rf;
    if (f.deal !== "all" && l.deal !== f.deal) return false;
    if (f.type !== "all" && l.type.indexOf(f.type) < 0) return false;
    if (l.deal === "월세" && ((f.dep < 500 && l.deposit > f.dep) || (f.rent < 60 && l.rent > f.rent))) return false;
    if (l.deal === "전세" && f.deal === "월세") return false;
    return true;
  }
  // 블루밍 연세를 월로 나눠 '월세 최대' 조건과 비교 (연세는 보통 보증금이 없음)
  function blumOk(p) {
    if (!p.blum || !p.blum.y) return false;
    var f = state.rf;
    if (f.deal === "전세") return false;
    if (f.type !== "all") return false;
    return f.rent >= 60 || p.blum.y[0] / 12 <= f.rent;
  }
  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function priceText(l) {
    return l.deal === "전세" ? "전세 " + l.jeonse.toLocaleString() + "만" : "월세 " + l.deposit + "/" + l.rent;
  }
  function pyeong(m2) { return Math.round(m2 / 3.3058); }
  function listingCard(l) {
    var h = l.place && PLACE[l.place];
    return '<li class="lst' + (h ? " has-map" : "") + '"' + (h ? ' data-id="' + h.id + '"' : "") + ">" +
      '<div class="pr">' + priceText(l) + (l.deal === "월세" ? '<small>만원</small>' : "") + "</div>" +
      '<div class="meta">' + esc(l.type) + " · " + l.m2 + "㎡(" + pyeong(l.m2) + "평) · " + esc(l.floor || "") + "</div>" +
      (l.memo ? '<div class="memo">' + esc(l.memo) + "</div>" : "") +
      '<div class="src">' + esc(l.source) + (h ? " · 📍 지도에서 보기" : "") + "</div></li>";
  }

  function renderRent() {
    var el = $("#rent");
    var show = state.cat === "rent" || (state.q && /자취|원룸|월세|전세|방|시세|보증금/.test(state.q));
    el.hidden = !show;
    if (!show) return;
    var ms = RENT.listings.filter(function (l) { return l.deal === "월세"; });
    var rents = ms.map(function (l) { return l.rent; }), deps = ms.map(function (l) { return l.deposit; });
    var sizes = RENT.listings.map(function (l) { return l.m2; });
    var js = RENT.listings.filter(function (l) { return l.deal === "전세"; });
    var list = RENT.listings.filter(listingOk).sort(function (a, b) {
      return (a.deal === "월세" ? a.rent * 12 + a.deposit * 0.05 : 1e9) - (b.deal === "월세" ? b.rent * 12 + b.deposit * 0.05 : 1e9);
    });
    var f = state.rf;
    el.innerHTML =
      "<h2>🔑 학교 앞 자취방 시세</h2>" +
      '<p class="rent-area">' + esc(RENT.area || "") + "</p>" +
      officialBlock() +
      blumBlock() +
      '<div class="o-head" style="margin-top:12px">🏷️ 지금 올라온 매물 <small>당근·다방 광고 · ' + esc(RENT.checked || "") + " 확인 · " + RENT.listings.length + "건</small></div>" +
      (ms.length ? '<div class="stats">' +
        '<div><span>월세 (중간값)</span><b>' + median(rents) + "만원</b><small>" + Math.min.apply(0, rents) + "~" + Math.max.apply(0, rents) + "만</small></div>" +
        '<div><span>보증금</span><b>' + median(deps) + "만원</b><small>" + Math.min.apply(0, deps) + "~" + Math.max.apply(0, deps) + "만</small></div>" +
        '<div><span>방 크기</span><b>' + pyeong(median(sizes)) + "평</b><small>" + Math.min.apply(0, sizes) + "~" + Math.max.apply(0, sizes) + "㎡</small></div>" +
        (js.length ? '<div><span>전세</span><b>' + (median(js.map(function (l) { return l.jeonse; })) / 1000).toFixed(1).replace(".0", "") + "천만</b><small>" + js.length + "건</small></div>" : "") +
        "</div>" : "") +
      '<div class="o-head" style="margin-top:12px">🔍 조건으로 찾기</div>' +
      '<div class="rf">' +
      '<label>거래<select data-rf="deal"><option value="all">전체</option><option>월세</option><option>전세</option></select></label>' +
      '<label>구조<select data-rf="type"><option value="all">전체</option><option value="오픈형">오픈형</option><option value="분리형">분리형</option></select></label>' +
      '<label class="wide">보증금 최대 <b>' + (f.dep >= 500 ? "제한 없음" : f.dep + "만원") + '</b><input type="range" data-rf="dep" min="30" max="500" step="10" value="' + f.dep + '"></label>' +
      '<label class="wide">월세 최대 <b>' + (f.rent >= 60 ? "제한 없음" : f.rent + "만원") + '</b><input type="range" data-rf="rent" min="20" max="60" step="1" value="' + f.rent + '"></label>' +
      "</div>" +
      '<div class="rent-count">조건에 맞는 광고 매물 <b>' + list.length + "</b>건" + (rentFiltered() ? ' <button class="linkbtn" data-rf-reset>조건 초기화</button>' : "") + "</div>" +
      '<ul class="lsts">' + (list.length ? list.map(listingCard).join("") : '<li class="empty" style="padding:16px">조건에 맞는 매물이 없어요</li>') + "</ul>" +
      '<details class="rent-tips"><summary>💡 자취방 구할 때 꿀팁</summary><ul>' + RENT.tips.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></details>" +
      '<div class="rent-src">출처 · 직접 확인하기: ' + RENT.sources.map(function (s) {
        return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener" title="' + esc(s.note || "") + '">' + esc(s.name) + "</a>";
      }).join(" · ") + '<br>매물은 금방 바뀌어요. 계약 전에는 꼭 앱·중개사무소에서 최신 가격을 확인하세요.</div>';
    el.querySelector('[data-rf="deal"]').value = f.deal;
    el.querySelector('[data-rf="type"]').value = f.type;
  }
  function blumBlock() {
    if (!BLUM) return "";
    var st = BLUM.stats, ty = st.yearlyByType || {};
    return '<div class="official">' +
      '<div class="o-head" style="margin-top:12px">🏫 블루밍 <small>교통대 전용 자취방 앱 · ' + esc(BLUM.checked) + " · 1인실</small></div>" +
      '<div class="stats">' +
      "<div><span>연세 (중간값)</span><b>" + st.yearlyMedian + "만원</b><small>" + st.yearlyMin + "~" + st.yearlyMax + "만 · " + st.yearlyCount + "건</small></div>" +
      "<div><span>월로 나누면</span><b>약 " + Math.round(st.yearlyMedian / 12) + "만원</b><small>보증금 없이 1년치 선납</small></div>" +
      "<div><span>한 학기</span><b>" + st.semesterMedian + "만원</b><small>" + st.semesterMin + "~" + st.semesterMax + "만 · " + st.semesterCount + "건</small></div>" +
      "</div>" +
      '<p class="o-note">' + (ty["일체형"] ? "일체형 중간값 " + ty["일체형"][1] + "만 · 분리형 " + ty["분리형"][1] + "만 · " : "") +
      "지금 방 있는 곳 " + st.yearlyAvailable + "건 · 지도에 건물 " + blumMatched + "곳 연결 (🔑 연OOO 표시)</p>" +
      "</div>";
  }

  // 국토부 실거래 (원룸 크기: 계약면적 50㎡ 이하)
  function officialBlock() {
    var o = RENT.official;
    if (!o || !o.rows || !o.rows.length) return "";
    var small = o.rows.filter(function (r) { return r.m2 <= 50; });
    var ms = small.filter(function (r) { return r.deal === "월세"; });
    var js = small.filter(function (r) { return r.deal === "전세"; });
    var ok = small.filter(function (r) {
      return listingOk({ deal: r.deal, type: "원룸", deposit: r.dep, rent: r.rent });
    }).sort(function (a, b) { return b.ym.localeCompare(a.ym) || a.rent - b.rent; });
    var rents = ms.map(function (r) { return r.rent; });
    return '<div class="official">' +
      '<div class="o-head">📊 실제 계약 신고 <small>' + esc(o.source) + " · " + esc(o.period) + "</small></div>" +
      '<div class="stats">' +
      "<div><span>월세 (중간값)</span><b>" + median(rents) + "만원</b><small>" + Math.min.apply(0, rents) + "~" + Math.max.apply(0, rents) + "만 · " + ms.length + "건</small></div>" +
      "<div><span>보증금</span><b>" + median(ms.map(function (r) { return r.dep; })) + "만원</b><small>대부분 20~30만</small></div>" +
      (js.length ? "<div><span>전세</span><b>" + median(js.map(function (r) { return r.dep; })).toLocaleString() + "만</b><small>" + js.length + "건</small></div>" : "") +
      "</div>" +
      '<details class="o-table"><summary>계약 ' + ok.length + "건 자세히 보기" + (rentFiltered() ? " (조건 적용)" : "") + "</summary>" +
      "<table><thead><tr><th>계약</th><th>위치</th><th>면적</th><th>가격</th></tr></thead><tbody>" +
      ok.map(function (r) {
        return "<tr><td>" + esc(r.ym) + "</td><td>" + esc(r.dong) + "<br><small>" + esc(r.road) + "</small></td><td>" + r.m2 + "㎡<br><small>" + pyeong(r.m2) + "평</small></td><td><b>" +
          (r.deal === "전세" ? "전세 " + r.dep.toLocaleString() : r.dep + "/" + r.rent) + "</b>" + (r.kind === "갱신" ? "<br><small>갱신</small>" : "") + "</td></tr>";
      }).join("") +
      '</tbody></table><p class="o-note">원룸 크기(계약면적 50㎡ 이하)만 보여줘요. 신고된 실제 계약이라 광고 매물보다 정확하지만, 정확한 번지는 공개되지 않아요.</p></details>' +
      "</div>";
  }

  $("#rent").addEventListener("input", function (e) {
    var k = e.target.dataset.rf;
    if (!k) return;
    state.rf[k] = e.target.type === "range" ? +e.target.value : e.target.value;
    if (e.target.type === "range") {
      // 슬라이더는 끄는 동안 값 표시만 바꾸고, 놓았을 때 다시 그림
      var b = e.target.parentNode.querySelector("b");
      var max = k === "dep" ? 500 : 60;
      b.textContent = state.rf[k] >= max ? "제한 없음" : state.rf[k] + "만원";
      return;
    }
    render();
  });
  $("#rent").addEventListener("change", function (e) { if (e.target.type === "range") render(); });
  $("#rent").addEventListener("click", function (e) {
    if (e.target.closest("[data-rf-reset]")) { state.rf = { deal: "all", dep: 500, rent: 60, type: "all" }; render(); return; }
    var li = e.target.closest(".lst[data-id]");
    if (li) selectPlace(+li.dataset.id);
  });

  function sortPlaces(arr) {
    return arr.slice().sort(function (a, b) {
      return ((b.listings ? b.listings.length * 10 : 0) - (a.listings ? a.listings.length * 10 : 0)) ||
        ((b.blum ? 1 : 0) - (a.blum ? 1 : 0)) ||
        ((a.house ? 1 : 0) - (b.house ? 1 : 0)) || (b.rec - a.rec) || ((b.x != null) - (a.x != null)) || ((a.old ? 1 : 0) - (b.old ? 1 : 0)) || a.name.localeCompare(b.name, "ko");
    });
  }

  // ------------------------------------------------------------ 칩
  function renderChips() {
    var all = [{ id: "all", label: "전체", icon: "🍯", color: "#2b2620" }].concat(D.categories);
    $("#chips").innerHTML = all.map(function (c) {
      var n = D.places.filter(function (p) { return matches(p, c.id); }).length;
      if (!n && c.id !== "all" && c.id !== state.cat) return "";
      return '<button class="chip" data-cat="' + c.id + '" aria-pressed="' + (state.cat === c.id) + '" style="--c:' + c.color + '">' +
        "<span>" + c.icon + "</span>" + esc(c.label) + ' <span class="n">' + n + "</span></button>";
    }).join("");
    var on = document.querySelector('.chip[aria-pressed="true"]');
    if (on && on.scrollIntoView) on.scrollIntoView({ inline: "center", block: "nearest" });
  }
  $("#chips").addEventListener("click", function (e) {
    var b = e.target.closest(".chip");
    if (!b) return;
    var c = b.dataset.cat;
    state.cat = state.cat === c && c !== "all" ? "all" : c;
    state.route = null;
    closeDetail(true);
    render();
    writeHash();
    if (state.cat !== "all") fitToCurrent();
  });

  // ------------------------------------------------------------ 동선
  function visibleRoutes() {
    if (state.route) return [ROUTE[state.route]];
    if (state.q) {
      var q = state.q.toLowerCase();
      return D.routes.filter(function (r) { return (r.title + r.desc).toLowerCase().indexOf(q) >= 0; });
    }
    return D.routes.filter(function (r) { return state.cat !== "all" && ROUTE_CATS[r.id].indexOf(state.cat) >= 0; });
  }

  function renderRoutes() {
    var rs = state.cat === "all" && !state.q ? D.routes : visibleRoutes();
    if (state.route) rs = D.routes.filter(function (r) { return ROUTE_CATS[r.id].indexOf(state.cat) >= 0 || state.cat === "all"; });
    if (state.cat !== "all" && state.cat !== "shortcut" && state.cat !== "walk") rs = [];
    $("#routes").innerHTML = rs.length ? "<h2>🚶 학생 추천 동선</h2>" + rs.map(function (r) {
      return '<button class="route-card" data-route="' + r.id + '" aria-pressed="' + (state.route === r.id) + '" style="--rc:' + r.color + '">' +
        '<span class="sw"></span><span><b>' + esc(r.title) + "</b><small>" +
        r.stops.map(function (s) { return esc(s.name.split("/")[0]); }).join(" → ") +
        " · 약 " + walkText(r.meters) + "</small></span></button>";
    }).join("") : "";
  }
  function walkText(m) {
    var min = Math.max(1, Math.round(m / 70));
    return (m >= 1000 ? (m / 1000).toFixed(1) + "km" : m + "m") + " (도보 " + min + "분)";
  }
  $("#routes").addEventListener("click", function (e) {
    var b = e.target.closest(".route-card");
    if (b) selectRoute(b.dataset.route);
  });

  function drawRoutes() {
    routeLayer.clearLayers();
    visibleRoutes().forEach(function (r) {
      var on = state.route === r.id;
      var pts = r.line.map(function (p) { return ll(p[0], p[1]); });
      L.polyline(pts, { color: "#fff", weight: on ? 10 : 7, opacity: 0.9, interactive: false }).addTo(routeLayer);
      var line = L.polyline(pts, {
        color: r.color, weight: on ? 6 : 4, opacity: on || !state.route ? 1 : 0.35,
        className: on ? "route-line" : "", lineCap: "round"
      }).addTo(routeLayer);
      line.on("click", function () { selectRoute(r.id); });
      line.bindTooltip(r.title, { sticky: true });
      if (on) {
        r.stops.forEach(function (s, i) {
          if (i === r.stops.length - 1 && s.code === r.stops[0].code) return;
          L.marker(ll(s.x, s.y), {
            interactive: false, zIndexOffset: 1000,
            icon: L.divIcon({ className: "", html: '<div class="stop" style="--rc:' + r.color + '">' + (i + 1) + "</div>", iconSize: [24, 24], iconAnchor: [12, 12] })
          }).addTo(routeLayer);
        });
      }
    });
  }

  function selectRoute(id) {
    var r = ROUTE[id];
    state.route = id;
    state.sel = null;
    if (state.cat !== "all" && ROUTE_CATS[id].indexOf(state.cat) < 0) state.cat = ROUTE_CATS[id][0];
    render();
    showRoute(r);
    var rb = L.latLngBounds(r.line.map(function (p) { return ll(p[0], p[1]); })).pad(isMobile() ? 0.5 : 0.25);
    moveMap(function () { map.flyToBounds(rb, { duration: 0.6 }); });
    writeHash();
  }

  function showRoute(r) {
    var tips = r.tips.map(function (id) { return PLACE[id]; }).filter(Boolean);
    openDetail(
      '<div class="cat" style="--c:' + r.color + '">🚶 학생 추천 동선</div>' +
      "<h3>" + esc(r.title) + "</h3>" +
      '<p class="desc">' + esc(r.desc) + "</p>" +
      '<ol class="steps" style="--rc:' + r.color + '">' + r.stops.map(function (s) {
        return "<li>" + esc(s.name) + ' <span class="bd">' + esc(s.code) + "</span></li>";
      }).join("") + "</ol>" +
      '<dl><dt>거리</dt><dd>약 ' + walkText(r.meters) + "</dd></dl>" +
      (tips.length ? '<div style="margin-top:12px;font-size:13px;color:var(--ink-2)">이 동선을 추천한 꿀팁</div><ul class="sub-list">' +
        tips.map(subItem).join("") + "</ul>" : "") +
      '<div class="note">학생들이 적은 경유지를 실제 보행로 위에 이어 그린 대략적인 경로예요. 엘리베이터·건물 안 통로는 지도에 따로 표시되지 않아요.</div>'
    );
  }

  // ------------------------------------------------------------ 마커 (같은 위치는 하나로 묶음)
  function drawMarkers(list) {
    markerLayer.clearLayers();
    markerByKey = {};
    var groups = {};
    list.forEach(function (p) {
      if (p.x == null) return;
      if (state.cat === "all" && !state.q && p.cats[0] === "building") return;
      var k = p.b ? "b:" + p.b : p.house ? "h:" + p.id : Math.round(p.x / 4) + ":" + Math.round(p.y / 4);
      (groups[k] = groups[k] || []).push(p);
    });
    Object.keys(groups).forEach(function (k) {
      var g = sortPlaces(groups[k]);
      var count = {};
      g.forEach(function (p) { var c = mainCat(p); count[c] = (count[c] || 0) + 1; });
      var top = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; })[0];
      if (state.cat !== "all") top = state.cat;
      var c = CAT[top];
      var approx = g.every(function (p) { return p.approx; });
      var sel = state.sel && g.some(function (p) { return p.id === state.sel; });
      if (g.length === 1 && g[0].house) {
        var hp = g[0], ls = hp.listings.filter(listingOk), best = ls[0];
        var by = !best && hp.blum && hp.blum.y && blumOk(hp) ? hp.blum.y : null;
        var label = best ? priceText(best).replace("월세 ", "") : by ? "연" + by[0] : "";
        var hm = L.marker(ll(hp.x, hp.y), {
          icon: L.divIcon({ className: "", html: label ? '<div class="hpin on' + (by ? " blum" : "") + (sel ? " sel" : "") + '">🔑 ' + label + "</div>" :
            '<div class="hdot' + (sel ? " sel" : "") + '"></div>', iconSize: null, iconAnchor: label ? [30, 14] : [6, 6] }),
          title: hp.name, zIndexOffset: best ? 800 : by ? 600 : -100
        }).addTo(markerLayer);
        hm.bindTooltip(esc(hp.name) + (best ? " · " + priceText(best) : by ? " · 블루밍 연세 " + by[0] + (by[1] > by[0] ? "~" + by[1] : "") + "만원" : ""), { direction: "top", offset: [0, -8] });
        hm.on("click", function () { selectPlace(hp.id, false); });
        markerByKey[hp.id] = { marker: hm, key: k, group: g };
        return;
      }
      var html = '<div class="pin' + (approx ? " approx" : "") + (sel ? " sel" : "") + '" style="--c:' + c.color + '"><span>' + c.icon + "</span>" +
        (g.length > 1 ? '<span class="cnt">' + g.length + "</span>" : "") + "</div>";
      var title = g[0].b && BLD[g[0].b] ? BLD[g[0].b].name + " (" + g[0].b + ") · 꿀팁 " + g.length + "개" : g.length > 1 ? g.length + "개 장소" : g[0].name;
      var m = L.marker(ll(g[0].x, g[0].y), {
        icon: L.divIcon({ className: "", html: html, iconSize: [34, 34], iconAnchor: [17, 40] }),
        title: title, riseOnHover: true, zIndexOffset: sel ? 900 : g.length * 5
      }).addTo(markerLayer);
      m.bindTooltip(esc(title), { direction: "top", offset: [0, -40] });
      m.on("click", function () {
        if (k.indexOf("b:") === 0) showBuilding(k.slice(2), null, null, g);
        else if (g.length === 1) selectPlace(g[0].id, false);
        else showGroup(k, g);
      });
      g.forEach(function (p) { markerByKey[p.id] = { marker: m, key: k, group: g }; });
    });
    // 검색으로 찾은 건물 (꿀팁 마커가 없는 건물만)
    findHits.forEach(function (h) {
      var b = BLD[h.code];
      if (!b || groups["b:" + h.code]) return;
      L.marker(ll(b.x, b.y), {
        icon: L.divIcon({ className: "", html: '<div class="bpin">🏫 ' + esc(b.name.split("/")[0]) + (h.floor ? " " + esc(h.floor) + "층" : "") + "</div>", iconSize: null, iconAnchor: [40, 16] }),
        zIndexOffset: 1000
      }).on("click", function () { showBuilding(h.code, h.floor, h.room); }).addTo(markerLayer);
    });
    if (focusAt) markFocus(focusAt[0], focusAt[1], "focus-on");
  }

  function subItem(p) {
    var c = CAT[mainCat(p)];
    return '<li data-id="' + p.id + '"><span class="e">' + c.icon + "</span><span>" + esc(p.name) +
      (p.rec > 1 ? ' <span class="bd hot">👍 ' + p.rec + "</span>" : "") + "</span></li>";
  }

  function showGroup(key, g) {
    state.sel = null;
    var b = g[0].b && BLD[g[0].b];
    var head = b ? esc(b.name) + ' <span class="bd">' + esc(b.code) + "</span>" : "이 근처 장소";
    openDetail(
      '<div class="cat" style="--c:#8a5a1c">📍 ' + (b ? "건물 안 꿀팁" : "같은 위치") + "</div>" +
      "<h3>" + head + "</h3>" +
      '<div style="font-size:13px;color:var(--ink-2)">' + (state.cat === "all" ? "꿀팁 " : CAT[state.cat].label + " ") + g.length + "개</div>" +
      '<ul class="sub-list">' + g.map(subItem).join("") + "</ul>" +
      (b && b.approx ? '<div class="note">이 건물은 지도 데이터에 없어 대략적인 위치에 표시했어요.</div>' : ""),
      { key: key, group: g }
    );
  }

  // ------------------------------------------------------------ 건물 층별 안내 · 강의실 찾기
  var FLOORS = (window.FLOORS && window.FLOORS.buildings) || {};
  var findHits = [];
  var BALIAS = [];
  D.buildings.forEach(function (b) {
    var f = FLOORS[b.code] || {};
    [b.name, f.name || ""].concat(f.aliases || []).join("/").split("/").forEach(function (n) {
      n = n.replace(/\(.*?\)/g, "").replace(/\s+/g, "").toLowerCase();
      if (n.length >= 2) BALIAS.push([n, b.code]);
    });
  });
  BALIAS.sort(function (a, b) { return b[0].length - a[0].length; });

  // "테크노관 213", "E5-213", "213호 테크노관", "미융관 B101" -> { code, room, floor }
  function parseRoomQuery(q) {
    var low = q.toLowerCase(), code = null, rest = low;
    var m = low.match(/(?:^|[^a-z0-9])([ew])\s?(\d{1,2})(-1(?!\d))?/);
    if (m) {
      var c = (m[1] + m[2] + (m[3] || "")).toUpperCase();
      if (BLD[c]) { code = c; rest = low.replace(m[0], " "); }
    }
    if (!code) {
      var nos = low.replace(/\s+/g, "");
      for (var i = 0; i < BALIAS.length; i++) {
        if (nos.indexOf(BALIAS[i][0]) >= 0) { code = BALIAS[i][1]; rest = nos.replace(BALIAS[i][0], " "); break; }
      }
    }
    var r = rest.match(/(?:^|[^\d])(b|지하)?\s?(\d{3,4})(?!\d)/);
    var room = null, floor = null;
    if (r) {
      var n = r[2];
      room = (r[1] ? "B" : "") + n;
      floor = r[1] ? "지하 " + n.charAt(0) : (n.length === 4 ? String(+n.slice(0, 2)) : n.charAt(0));
    }
    return { code: code, room: room, floor: floor };
  }

  function floorHas(fl, floor) {
    if (!floor) return false;
    var a = String(fl).split("~");
    return a.length === 2 ? +floor >= +a[0] && +floor <= +a[1] : String(fl) === String(floor);
  }
  function floorDepts(code, floor) {
    var f = FLOORS[code];
    if (!f) return null;
    for (var i = 0; i < f.floors.length; i++) if (floorHas(f.floors[i][0], floor)) return f.floors[i][1];
    return null;
  }
  function deptSearch(q) {
    var k = q.replace(/\s+/g, "").toLowerCase(), out = [];
    if (k.length < 2) return out;
    Object.keys(FLOORS).forEach(function (code) {
      var bn = FLOORS[code].name.replace(/\s+/g, "").toLowerCase();
      FLOORS[code].floors.forEach(function (fl) {
        fl[1].forEach(function (d) {
          var dk = d.replace(/\s+/g, "").toLowerCase();
          if (dk === bn) return; // "대운동장 1층: 대운동장" 같은 건 건너뜀
          if (dk.indexOf(k) >= 0 || (k.length >= 3 && dk.length >= 3 && k.indexOf(dk) >= 0)) out.push({ code: code, floor: fl[0], dept: d });
        });
      });
    });
    return out.slice(0, 8);
  }

  function renderFind() {
    var el = $("#find"), q = state.q;
    findHits = [];
    if (!q) { el.hidden = true; el.innerHTML = ""; return; }
    var pq = parseRoomQuery(q), html = "";
    if (pq.code) {
      var b = BLD[pq.code], f = FLOORS[pq.code];
      var depts = pq.floor ? floorDepts(pq.code, pq.floor) : null;
      findHits.push({ code: pq.code, floor: pq.floor, room: pq.room });
      html += '<button class="bcard" data-bld="' + pq.code + '"' + (pq.floor ? ' data-floor="' + esc(pq.floor) + '"' : "") + (pq.room ? ' data-room="' + esc(pq.room) + '"' : "") + ">" +
        '<span class="bcode">' + esc(pq.code) + '</span><span class="btx"><b>' + esc(b.name) + "</b>" +
        (pq.room ? '<span class="room">📍 ' + esc(pq.room) + "호 → <b>" + esc(pq.floor) + "층</b></span>" : "") +
        (depts ? "<small>" + esc(pq.floor) + "층: " + esc(depts.join(", ")) + "</small>" :
          pq.room ? "<small>학교 안내에 " + esc(pq.floor) + "층 정보는 없어요</small>" :
          f ? "<small>" + f.floors.length + "개 층 안내 · 눌러서 보기</small>" : "") +
        '</span><span class="go">›</span></button>';
    } else if (/\d{3,4}\s*호?/.test(q)) {
      html += '<p class="find-hint">강의실 번호는 건물 이름과 같이 검색해 주세요. 예: <b>테크노관 213</b>, <b>E5-213</b>, <b>인사대 302</b></p>';
    }
    var ds = deptSearch(q).filter(function (d) { return !(pq.code && d.code === pq.code && !pq.room); });
    if (ds.length) {
      html += '<ul class="dept-list">' + ds.map(function (d) {
        findHits.push({ code: d.code, floor: d.floor });
        return '<li data-bld="' + d.code + '" data-floor="' + esc(d.floor) + '"><b>' + esc(d.dept) + "</b><span>" + esc(BLD[d.code].name.split("/")[0]) + " (" + d.code + ") · " + esc(d.floor) + "층</span></li>";
      }).join("") + "</ul>";
    }
    el.hidden = !html;
    el.innerHTML = html ? "<h2>🏫 건물·강의실 찾기</h2>" + html : "";
  }
  $("#find").addEventListener("click", function (e) {
    var t = e.target.closest("[data-bld]");
    if (!t) return;
    showBuilding(t.dataset.bld, t.dataset.floor || null, t.dataset.room || null);
  });

  function showBuilding(code, hiFloor, room, group) {
    var b = BLD[code];
    if (!b) return;
    var f = FLOORS[code] || { floors: [] };
    state.sel = null;
    var self = D.places.filter(function (p) { return p.b === code && p.cats[0] === "building"; })[0];
    var tips = sortPlaces((group || D.places.filter(function (p) { return p.b === code && !p.house; }))
      .filter(function (p) { return p.cats[0] !== "building"; }));
    var floors = f.floors.slice().sort(function (a, c) { return parseInt(c[0]) - parseInt(a[0]); });
    var hasHi = hiFloor && floors.some(function (fl) { return floorHas(fl[0], hiFloor); });
    if (isMobile()) setView("map");
    $("#detail").hidden = false;
    flyToVisible(ll(b.x, b.y), Math.max(map.getZoom(), homeZoom + 0.75));
    showFocus(b.x, b.y, b.name.split("/")[0] + " (" + code + ")" + (hiFloor ? " " + hiFloor + "층" : ""));
    openDetail(
      '<div class="cat" style="--c:#8a5a1c">🏫 건물 안내</div>' +
      "<h3>" + esc(b.name) + ' <span class="bd">' + esc(code) + "</span></h3>" +
      (self && self.rec > 1 ? '<div style="font-size:13px;color:var(--ink-2)">👍 학생 ' + self.rec + "명이 추천한 건물</div>" : "") +
      (room ? '<div class="room-hit">📍 <b>' + esc(room) + "호</b>는 <b>" + esc(hiFloor) + "층</b>에 있어요" +
        "<small>호실 번호 앞자리가 층이에요 (예: 213호 = 2층 13호, 1013호 = 10층)</small></div>" : "") +
      (floors.length ? '<div class="sec-t">층별 안내</div><ul class="floors">' + floors.map(function (fl) {
        var on = floorHas(fl[0], hiFloor);
        return '<li class="' + (on ? "on" : "") + '"><span class="fl">' + esc(fl[0]) + "층</span><span>" + esc(fl[1].join(", ")) + "</span></li>";
      }).join("") + "</ul>" : '<div class="note">학교 캠퍼스지도에 이 건물의 층별 정보가 없어요.</div>') +
      (hiFloor && !hasHi && floors.length ? '<div class="note">학교 안내에 ' + esc(hiFloor) + "층 정보는 없어요. 엘리베이터 옆 층별 안내판을 확인하세요.</div>" : "") +
      (tips.length ? '<div class="sec-t">이 건물 꿀팁 ' + tips.length + '개</div><ul class="sub-list">' + tips.map(subItem).join("") + "</ul>" : "") +
      (b.approx ? '<div class="note">이 건물은 지도 데이터에 없어 대략적인 위치에 표시했어요.</div>' : "") +
      '<p class="src-note">층별 안내 출처: <a href="' + esc((window.FLOORS || {}).url || "#") + '" target="_blank" rel="noopener">학교 캠퍼스지도</a> (' + esc((window.FLOORS || {}).checked || "") + " 확인)</p>",
      { bld: code, group: tips, floor: hiFloor, room: room }
    );
  }

  // ------------------------------------------------------------ 상세
  var detailCtx = null;
  function openDetail(html, ctx) {
    var el = $("#detail");
    detailCtx = ctx || detailCtx;
    el.innerHTML = '<button class="x" aria-label="닫기">✕</button>' + html;
    el.hidden = false;
    el.scrollTop = 0;
  }
  function closeDetail(silent) {
    $("#detail").hidden = true;
    clearFocus();
    detailCtx = null;
    if (!silent) {
      state.sel = null;
      if (state.route) { state.route = null; render(); }
      else drawMarkers(filtered());
      writeHash();
    }
  }
  $("#detail").addEventListener("click", function (e) {
    if (e.target.closest(".x")) return closeDetail();
    var li = e.target.closest("[data-id]");
    if (li) return selectPlace(+li.dataset.id, true, true);
    var back = e.target.closest(".back");
    if (back && detailCtx && detailCtx.bld) return showBuilding(detailCtx.bld, detailCtx.floor, detailCtx.room, detailCtx.group);
    if (back && detailCtx && detailCtx.group) return showGroup(detailCtx.key, detailCtx.group);
    var lc = e.target.closest("[data-locate]");
    if (lc) {
      var lp = PLACE[+lc.dataset.locate];
      if (isMobile()) setView("map");
      flyToVisible(ll(lp.x, lp.y), Math.max(map.getZoom(), homeZoom + 1));
      showFocus(lp.x, lp.y, placeLabel(lp));
      return;
    }
    var cg = e.target.closest("[data-cat-go]");
    if (cg) { state.cat = cg.dataset.catGo; state.sel = null; closeDetail(true); render(); writeHash(); if (isMobile()) setView("list"); return; }
    var rb = e.target.closest("[data-goroute]");
    if (rb) return selectRoute(rb.dataset.goroute);
  });

  function showPlace(p, fromGroup) {
    var c = CAT[mainCat(p)];
    var b = p.b && BLD[p.b];
    var rows = [];
    if (p.aka && p.aka.length) rows.push(["다른 이름", esc(p.aka.join(", "))]);
    rows.push(["위치", p.loc ? esc(p.loc) : '<span style="color:var(--ink-3)">원본에 위치가 없어요</span>']);
    if (b) rows.push(["건물", esc(b.name) + " (" + esc(b.code) + ")"]);
    rows.push(["추천", p.rec > 1 ? "학생 " + p.rec + "명이 추천했어요 👍" : "학생 1명 추천"]);
    rows.push(["확인한 날", p.date ? esc(p.date) : "확인 안 됨"]);
    rows.push(["분류", p.cats.map(function (id) { return CAT[id].icon + " " + CAT[id].label; }).join(", ")]);
    var notes = [];
    if (p.old) notes.push("확인한 지 오래된 정보라 지금은 달라졌을 수 있어요.");
    if (p.approx) notes.push("주소(번지)로 추정한 대략적인 위치예요.");
    if (p.x == null) notes.push("지도에 표시할 위치 정보가 없는 꿀팁이에요.");
    var r = p.route && ROUTE[p.route];
    if (p.house) {
      openDetail(
        '<div class="cat" style="--c:' + CAT.rent.color + '">🔑 학교 주변 원룸 건물</div>' +
        "<h3>" + esc(p.name) + "</h3>" +
        "<dl><dt>주소</dt><dd>" + (p.loc ? esc(p.loc) : "지도 데이터에 주소 없음") + "</dd></dl>" +
        (p.blum ? '<div class="blum-box"><div class="o-head">🏫 블루밍 가격 <small>' + esc(BLUM.checked) + " 기준 · 1인실</small></div>" +
          (p.blum.y ? "<div>연세 <b>" + p.blum.y[0] + (p.blum.y[1] > p.blum.y[0] ? "~" + p.blum.y[1] : "") + "만원</b> <small>(월 약 " +
            Math.round(p.blum.y[0] / 12) + (p.blum.y[1] > p.blum.y[0] ? "~" + Math.round(p.blum.y[1] / 12) : "") + "만원)</small>" +
            (p.blum.y[2] ? ' <span class="bd hot" style="background:#d3f9d8;color:#2b8a3e">방 있어요</span>' : "") + "</div>" : "") +
          (p.blum.s ? "<div>한 학기 <b>" + p.blum.s[0] + (p.blum.s[1] > p.blum.s[0] ? "~" + p.blum.s[1] : "") + "만원</b></div>" : "") +
          "</div>" : "") +
        (p.listings.length ? '<div style="margin-top:12px;font-size:13px;color:var(--ink-2)">확인된 매물 (' + esc(RENT.checked) + ")</div><ul class=\"lsts\">" +
          p.listings.map(listingCard).join("") + "</ul>" :
          (p.blum ? "" : '<div class="note" style="background:#e3fafc;color:#0b7285">이 건물은 현재 확인된 매물 정보가 없어요. 가격은 부동산 앱에서 건물 이름으로 찾아보세요.</div>')) +
        '<div class="actions"><a class="btn primary" href="https://map.naver.com/p/search/' + encodeURIComponent("충주 " + p.name) + '" target="_blank" rel="noopener">네이버지도에서 검색 ↗</a>' +
        '<button class="btn" data-cat-go="rent">🔑 자취방 시세 보기</button></div>'
      );
      return;
    }
    openDetail(
      (fromGroup && detailCtx && detailCtx.group ? '<button class="back">← 목록으로</button>' : "") +
      '<div class="cat" style="--c:' + c.color + '">' + c.icon + " " + esc(c.label) + "</div>" +
      "<h3>" + esc(p.name) + "</h3>" +
      (p.desc ? '<p class="desc">' + esc(p.desc) + "</p>" : "") +
      "<dl>" + rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>"; }).join("") + "</dl>" +
      notes.map(function (n) { return '<div class="note">' + n + "</div>"; }).join("") +
      '<div class="actions">' +
      (p.x != null ? '<button class="btn locate" data-locate="' + p.id + '">📍 지도에서 위치 보기</button>' : "") +
      (r ? '<button class="btn route" data-goroute="' + r.id + '" style="--rc:' + r.color + '">🚶 동선 보기</button>' : "") +
      (p.link ? '<a class="btn primary" href="' + esc(p.link) + '" target="_blank" rel="noopener">네이버지도에서 보기 ↗</a>' :
        '<a class="btn" href="https://map.naver.com/p/search/' + encodeURIComponent(p.name.replace(/\(.*?\)/g, "")) + '" target="_blank" rel="noopener">네이버지도에서 검색 ↗</a>') +
      "</div>"
    );
  }

  function selectPlace(id, fromGroup, keepView) {
    var p = PLACE[id];
    if (!p) return;
    // 건물 안내 항목은 건물 카드(층별 안내)로
    if (p.cats[0] === "building" && p.b && BLD[p.b]) { showBuilding(p.b); return; }
    state.sel = id;
    state.route = null;
    routeLayer.clearLayers();
    drawRoutes();
    if (!markerByKey[id] && p.x != null) {
      // 현재 필터에 안 걸린 장소면 전체 보기로 전환
      if (!matches(p, state.cat)) { state.cat = "all"; state.q = ""; $("#q").value = ""; render(); }
    }
    drawMarkers(filtered());
    highlightList();
    if (isMobile() && p.x != null) setView("map");
    if (p.x != null && !keepView) {
      var z = Math.max(map.getZoom(), homeZoom + 0.75);
      var target = ll(p.x, p.y);
      $("#detail").hidden = false; // 카드 크기를 알고 옮기도록 먼저 표시
      flyToVisible(target, z);
    }
    if (p.x != null) showFocus(p.x, p.y, placeLabel(p)); else clearFocus();
    var info = markerByKey[id];
    var keepBld = fromGroup && detailCtx && detailCtx.bld ? detailCtx : null;
    showPlace(p, fromGroup);
    if (keepBld) detailCtx = keepBld;
    else if (info && info.group.length > 1) detailCtx = info.key.indexOf("b:") === 0 ? { bld: info.key.slice(2), group: info.group } : { key: info.key, group: info.group };
    writeHash();
  }

  // ------------------------------------------------------------ 목록
  // 같은 주제를 여러 학생이 다른 제목으로 남긴 꿀팁을 소제목으로 묶음
  var TOPICS = {
    academic: [["수강신청", /수강|장바구니|재수강|계절학기/], ["국가근로·장학금·등록금", /장학|근로|등록금/], ["동아리", /동아리/],
      ["학사 제도·졸업", /학사경고|졸업|휴학|출석인정|예비군|강의실|세미나실|취업/], ["학교 시스템·학생증·와이파이", /통합정보|UTRO|와이파이|학생증|생성형|홈페이지|문의/],
      ["상담·외국인·교환학생", /상담|외국인|ARC|교환학생|일본/]],
    transport: [["버스", /버스|정류|셔틀|통학|콜버스|회차|페이코|PAYCO/i], ["기차·KTX", /기차|KTX|주덕역|판교|대전|동서울/], ["택시", /택시/], ["주차", /주차/]]
  };
  function itemHtml(p) {
    var c = CAT[mainCat(p)];
    var b = [];
    if (p.blum && p.blum.y) b.push('<span class="bd" style="background:#e7f5ff;color:#1864ab">🏫 연 ' + p.blum.y[0] + "만~</span>");
    if (p.house) b.push(p.listings.length ? '<span class="bd hot" style="background:#e3fafc;color:#0b7285">🔑 매물 ' + p.listings.length + "건</span>" : '<span class="bd">원룸 건물</span>');
    if (p.rec > 1) b.push('<span class="bd hot">👍 ' + p.rec + "명 추천</span>");
    if (p.b) b.push('<span class="bd">' + esc(p.b) + "</span>");
    if (p.route) b.push('<span class="bd" style="background:#ffe8cc;color:#d9480f">🚶 동선</span>');
    if (p.old) b.push('<span class="bd old">오래된 정보</span>');
    if (p.x == null) b.push('<span class="bd nomap">지도 위치 없음</span>');
    return '<li class="item' + (state.sel === p.id ? " on" : "") + '" data-id="' + p.id + '" style="--c:' + c.color + '" tabindex="0">' +
      '<span class="ic">' + c.icon + '</span><div class="tx"><div class="nm">' + esc(p.name) + "</div>" +
      '<div class="lc">' + (p.loc ? esc(p.loc) : "위치 정보 없음") + "</div>" +
      (b.length ? '<div class="badges">' + b.join("") + "</div>" : "") + "</div></li>";
  }
  function renderList(list) {
    var sorted = sortPlaces(list);
    $("#listCount").textContent = (state.cat === "all" ? "전체" : CAT[state.cat].label) + " " + list.length + "개";
    if (!sorted.length) {
      $("#list").innerHTML = '<li class="empty">검색 결과가 없어요 🥲<br>다른 단어로 찾아보세요.</li>';
      return;
    }
    var topics = !state.q && TOPICS[state.cat];
    if (!topics) { $("#list").innerHTML = sorted.map(itemHtml).join(""); return; }
    var buckets = topics.map(function () { return []; }), rest = [];
    sorted.forEach(function (p) {
      var t = p.name + " " + p.loc;
      for (var i = 0; i < topics.length; i++) if (topics[i][1].test(t)) { buckets[i].push(p); return; }
      rest.push(p);
    });
    var html = "";
    topics.forEach(function (tp, i) {
      if (!buckets[i].length) return;
      html += '<li class="topic">📌 ' + esc(tp[0]) + " <small>" + buckets[i].length + "개" +
        (buckets[i].length > 1 ? " · 여러 학생이 비슷한 꿀팁을 남겼어요" : "") + "</small></li>" + buckets[i].map(itemHtml).join("");
    });
    if (rest.length) html += '<li class="topic">📌 그 밖의 꿀팁 <small>' + rest.length + "개</small></li>" + rest.map(itemHtml).join("");
    $("#list").innerHTML = html;
  }
  function highlightList() {
    var on = document.querySelectorAll(".item.on");
    for (var i = 0; i < on.length; i++) on[i].classList.remove("on");
    var el = document.querySelector('.item[data-id="' + state.sel + '"]');
    if (el) el.classList.add("on");
  }
  $("#list").addEventListener("mouseover", function (e) {
    var li = e.target.closest(".item");
    if (!li || isMobile()) return;
    var p = PLACE[+li.dataset.id];
    if (p && p.x != null && state.sel !== p.id) showFocus(p.x, p.y, placeLabel(p), true);
  });
  $("#list").addEventListener("mouseleave", function () { unmark("focus-soft"); });
  $("#list").addEventListener("click", function (e) {
    var li = e.target.closest(".item");
    if (li) selectPlace(+li.dataset.id);
  });
  $("#list").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { var li = e.target.closest(".item"); if (li) selectPlace(+li.dataset.id); }
  });

  // ------------------------------------------------------------ 범례
  $("#legend").innerHTML =
    '<span><i style="background:#f2c98a;border:1px solid #b98a45"></i>교내 건물</span>' +
    '<span><i style="background:#dcd6cc"></i>주변 건물</span>' +
    '<span><i style="background:#fff;border:1px solid #cfc6b6"></i>도로</span>' +
    '<span><i style="background:repeating-linear-gradient(90deg,#b8a98f 0 3px,transparent 3px 5px);height:3px"></i>보행로</span>' +
    '<span><i style="border:2px dashed #c9a86a;background:none"></i>캠퍼스</span>';

  // ------------------------------------------------------------ 전체 렌더
  function render() {
    var list = filtered();
    $("#totalCount").textContent = D.places.filter(function (p) { return !p.house; }).length;
    renderChips();
    renderFind();
    renderRent();
    renderRoutes();
    renderList(list);
    drawMarkers(list);
    drawRoutes();
    if (state.cat === "transport") busLayer.addTo(map); else busLayer.remove();
  }

  function fitToCurrent() {
    var pts = filtered().filter(function (p) { return p.x != null; }).map(function (p) { return ll(p.x, p.y); });
    visibleRoutes().forEach(function (r) { r.line.forEach(function (q) { pts.push(ll(q[0], q[1])); }); });
    if (state.q) findHits.forEach(function (h) { var b = BLD[h.code]; if (b) pts.push(ll(b.x, b.y)); });
    if (pts.length) { var fb = L.latLngBounds(pts).pad(0.15); moveMap(function () { map.flyToBounds(fb, { duration: 0.5, maxZoom: homeZoom + 1 }); }); }
  }

  var qTimer;
  $("#q").addEventListener("input", function (e) {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () {
      state.q = e.target.value.trim();
      state.route = null;
      if (state.q && state.cat !== "all" && !filtered().length) state.cat = "all";
      closeDetail(true);
      render();
      if (state.q) fitToCurrent();
      if (isMobile() && state.q) setView("list");
    }, 150);
  });
  $("#onlyMap").addEventListener("change", function (e) { state.onlyMap = e.target.checked; render(); });

  // 모바일 지도/목록 전환
  function setView(v) {
    $(".layout").dataset.view = v;
    document.querySelectorAll(".view-toggle button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.view === v); });
    if (v === "map") setTimeout(function () { map.invalidateSize(); if (pendingMove) moveMap(pendingMove); }, 0);
  }
  document.querySelector(".view-toggle").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (b) setView(b.dataset.view);
  });

  // ------------------------------------------------------------ 주소창 공유 (#c=rest, #p=12, #r=ict)
  var writing = false;
  function writeHash() {
    var h = [];
    if (state.cat !== "all") h.push("c=" + state.cat);
    if (state.route) h.push("r=" + state.route);
    else if (state.sel) h.push("p=" + state.sel);
    writing = true;
    history.replaceState(null, "", h.length ? "#" + h.join("&") : location.pathname + location.search);
    writing = false;
  }
  function readHash() {
    var h = {};
    location.hash.replace(/^#/, "").split("&").forEach(function (kv) { var a = kv.split("="); if (a[0]) h[a[0]] = decodeURIComponent(a[1] || ""); });
    state.cat = h.c && CAT[h.c] ? h.c : "all";
    render();
    if (h.r && ROUTE[h.r]) selectRoute(h.r);
    else if (h.p && PLACE[+h.p]) selectPlace(+h.p);
    else if (state.cat !== "all") fitToCurrent();
  }
  window.addEventListener("hashchange", function () { if (!writing) readHash(); });
  window.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("#detail").hidden) closeDetail(); });

  var rc = document.getElementById("rentChecked");
  if (rc) rc.textContent = RENT.checked || "";
  readHash();
})();
