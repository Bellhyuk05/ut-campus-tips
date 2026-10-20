"""교통대 꿀팁 지도 빌드 스크립트.

tools/source/places.xlsx (장소표)  +  tools/source/campus.osm (OpenStreetMap 원본)
  ->  map/campus.svg  (캠퍼스 지도 그림)
  ->  data/places.js  (마커·카테고리·동선 데이터)

인터넷/API 없이 로컬에서만 돌아갑니다.
    python tools/build.py
(엑셀을 읽으려면 openpyxl 필요: python -m pip install openpyxl)
"""
import heapq
import json
import math
import os
import re
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "source")

# ---------------------------------------------------------------- OSM 읽기
tree = ET.parse(os.path.join(SRC, "campus.osm")).getroot()
bnd = tree.find("bounds")
MINLAT, MAXLAT = float(bnd.get("minlat")), float(bnd.get("maxlat"))
MINLON, MAXLON = float(bnd.get("minlon")), float(bnd.get("maxlon"))
LAT0 = (MINLAT + MAXLAT) / 2
MX = 111320 * math.cos(math.radians(LAT0))  # 경도 1도당 m
MY = 110540  # 위도 1도당 m
W = round((MAXLON - MINLON) * MX)
H = round((MAXLAT - MINLAT) * MY)


def proj(lat, lon):
    """위경도 -> SVG 좌표(m). 원점은 왼쪽 위."""
    return ((lon - MINLON) * MX, (MAXLAT - lat) * MY)


def tags_of(el):
    return {t.get("k"): t.get("v") for t in el.iter("tag")}


nodes = {}
node_tags = {}
for n in tree.iter("node"):
    nodes[n.get("id")] = proj(float(n.get("lat")), float(n.get("lon")))
    t = tags_of(n)
    if t:
        node_tags[n.get("id")] = t

ways = {}
for w in tree.iter("way"):
    refs = [nd.get("ref") for nd in w.iter("nd") if nd.get("ref") in nodes]
    ways[w.get("id")] = {"refs": refs, "tags": tags_of(w)}

relations = []
for r in tree.iter("relation"):
    t = tags_of(r)
    if t.get("type") != "multipolygon":
        continue
    outers = [m.get("ref") for m in r.iter("member")
              if m.get("type") == "way" and m.get("role") in ("outer", "") and m.get("ref") in ways]
    relations.append({"id": r.get("id"), "tags": t, "outers": outers})


def join_rings(way_ids):
    """멀티폴리곤 외곽 조각들을 이어 붙여 닫힌 고리 목록으로."""
    segs = [list(ways[i]["refs"]) for i in way_ids if len(ways[i]["refs"]) > 1]
    rings = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for s in segs:
                if s[0] == cur[-1]:
                    cur += s[1:]
                elif s[-1] == cur[-1]:
                    cur += s[::-1][1:]
                elif s[-1] == cur[0]:
                    cur = s[:-1] + cur
                elif s[0] == cur[0]:
                    cur = s[::-1][:-1] + cur
                else:
                    continue
                segs.remove(s)
                changed = True
                break
        rings.append(cur)
    return rings


def pts(refs):
    return [nodes[r] for r in refs]


def centroid(p):
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(p, p[1:] + p[:1]):
        c = x1 * y2 - x2 * y1
        a += c
        cx += (x1 + x2) * c
        cy += (y1 + y2) * c
    if abs(a) < 1e-6:
        return (sum(x for x, _ in p) / len(p), sum(y for _, y in p) / len(p))
    return (cx / (3 * a), cy / (3 * a))


def path_d(p, close):
    s = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in p)
    return s + ("Z" if close else "")


# ---------------------------------------------------------------- 지도 SVG
areas = []  # (layer, css class, d)
lines = []

AREA_STYLE = [
    # (판정 함수, 레이어 순서, 클래스)
    (lambda t: t.get("landuse") in ("farmland", "meadow", "grass") or t.get("natural") == "grassland", 1, "farm"),
    (lambda t: t.get("landuse") in ("residential", "commercial", "construction"), 1, "urban"),
    (lambda t: t.get("natural") in ("wood", "scrub") or t.get("landuse") == "forest", 2, "wood"),
    (lambda t: t.get("leisure") == "park", 2, "park"),
    (lambda t: t.get("natural") == "water" or t.get("waterway") == "riverbank", 3, "water"),
    (lambda t: t.get("leisure") in ("pitch", "stadium"), 4, "pitch"),
    (lambda t: t.get("leisure") == "track", 5, "track"),
    (lambda t: t.get("amenity") == "parking", 4, "parking"),
]

CODE_RE = re.compile(r"\(([EW]\d+(?:-\d+)?)\)")
campus_buildings = {}  # code -> dict
bld_shapes = []


def add_building(t, p, rid):
    name = t.get("name", "")
    m = CODE_RE.search(name)
    cls = "bld-campus" if (t.get("building") in ("university", "school", "theatre") or m) else "bld"
    bld_shapes.append((cls, path_d(p, True)))
    if m:
        code = m.group(1)
        c = centroid(p)
        nm = name[: m.start()].strip()
        if code in campus_buildings:  # 같은 번호 건물(E4 시스템관/국원문화관) 합치기
            o = campus_buildings[code]
            o["x"], o["y"] = (o["x"] + c[0]) / 2, (o["y"] + c[1]) / 2
            if nm not in o["name"]:
                o["name"] += "/" + nm
        else:
            campus_buildings[code] = {"code": code, "name": nm, "x": c[0], "y": c[1]}


for wid, w in ways.items():
    t, refs = w["tags"], w["refs"]
    if len(refs) < 2:
        continue
    p = pts(refs)
    closed = refs[0] == refs[-1]
    if closed and "building" in t:
        add_building(t, p[:-1], wid)
        continue
    if closed and t.get("name", "").startswith("대운동장"):
        c = centroid(p[:-1])
        campus_buildings["W19"] = {"code": "W19", "name": "대운동장", "x": c[0], "y": c[1]}
    if closed:
        for f, layer, cls in AREA_STYLE:
            if f(t):
                areas.append((layer, cls, path_d(p[:-1], True)))
                break
    hw = t.get("highway")
    if hw and hw != "construction":
        lines.append((hw, path_d(p, False), t.get("name")))
    elif t.get("waterway") in ("river", "stream", "drain", "canal"):
        lines.append(("waterway-" + t["waterway"], path_d(p, False), t.get("name")))

campus_outline = []
for r in relations:
    t = r["tags"]
    rings = join_rings(r["outers"])
    for ring in rings:
        p = pts(ring)
        if r["id"] == "17851466":
            campus_outline.append(path_d(p, True))
        elif "building" in t:
            add_building(t, p[:-1] if ring[0] == ring[-1] else p, r["id"])
        elif t.get("leisure") == "pitch" or "테니스" in t.get("name", ""):
            areas.append((4, "pitch", path_d(p, True)))
            m = CODE_RE.search(t.get("name", ""))
            if m and m.group(1) not in campus_buildings:
                c = centroid(p)
                campus_buildings[m.group(1)] = {"code": m.group(1), "name": t["name"][: m.start()].strip(), "x": c[0], "y": c[1]}
        else:
            for f, layer, cls in AREA_STYLE:
                if f(t):
                    areas.append((layer, cls, path_d(p, True)))
                    break

# 버스정류장 노드 (지도 표시 + 정문 위치)
bus_stops = []
for nid, t in node_tags.items():
    if t.get("highway") == "bus_stop":
        x, y = nodes[nid]
        bus_stops.append({"name": t.get("name", "정류장"), "x": round(x, 1), "y": round(y, 1)})
gate = [b for b in bus_stops if b["name"] == "한국교통대 (정문)"]
if gate:
    campus_buildings["E1"] = {"code": "E1", "name": "정문", "x": gate[0]["x"], "y": gate[0]["y"]}

# OSM에 없는 건물 번호는 원본 장소표(캠퍼스 건물 안내) 기준 이름 + 인접 건물로 대략 배치
NAME_FIX = {"W13": "예성관리동(복지관)", "W18": "미래융합정보관", "E15": "학군단", "W2": "아레나K(체육관)", "W9": "공동실험관"}
for code, nm in NAME_FIX.items():
    if code in campus_buildings:
        campus_buildings[code]["name"] = nm


def near(code, dx, dy):
    b = campus_buildings[code]
    return b["x"] + dx, b["y"] + dy


APPROX = {}
if "E2" not in campus_buildings and "E1" in campus_buildings and "E3" in campus_buildings:
    a, b = campus_buildings["E1"], campus_buildings["E3"]
    campus_buildings["E2"] = {"code": "E2", "name": "국원쉼터", "x": (a["x"] + b["x"]) / 2, "y": (a["y"] + b["y"]) / 2, "approx": True}
if "E8-1" not in campus_buildings and "E8" in campus_buildings:
    x, y = near("E8", 0, 45)
    campus_buildings["E8-1"] = {"code": "E8-1", "name": "대학본부 별관(복지관)", "x": x, "y": y, "approx": True}

ROAD_W = {"trunk": 9, "primary": 8, "secondary": 7, "tertiary": 6.5, "tertiary_link": 5, "unclassified": 5,
          "residential": 5, "living_street": 4.2, "service": 3.6, "track": 2.5}
FOOT = {"footway", "path", "pedestrian", "steps", "cycleway"}


def svg():
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W * 2}" height="{H * 2}">',
         "<style>",
         ".bg{fill:#f4efe4}.farm{fill:#e8ecd0}.urban{fill:#ece6da}.wood{fill:#cfe2bf}.park{fill:#d7ebc6}",
         ".water{fill:#b9dbef}.pitch{fill:#bfe0a8;stroke:#9ccb84;stroke-width:1}.track{fill:#e7b49b;stroke:#d79c80;stroke-width:1}",
         ".parking{fill:#e9e5df}",
         ".campus{fill:#fbf8f1;stroke:#c9a86a;stroke-width:2.2;stroke-dasharray:7 5}",
         ".bld{fill:#dcd6cc;stroke:#c7bfb2;stroke-width:.6}",
         ".bld-campus{fill:#f2c98a;stroke:#b98a45;stroke-width:1}",
         ".rc{fill:none;stroke:#cfc6b6;stroke-linecap:round;stroke-linejoin:round}",
         ".rd{fill:none;stroke:#ffffff;stroke-linecap:round;stroke-linejoin:round}",
         ".ft{fill:none;stroke:#b8a98f;stroke-width:1.1;stroke-dasharray:3 2.2;stroke-linecap:round}",
         ".st{fill:none;stroke:#a48f6d;stroke-width:2.4;stroke-dasharray:1 1.2}",
         ".ww{fill:none;stroke:#9ccbe6;stroke-linecap:round}",
         ".lbl{font:600 7px sans-serif;fill:#8a7d6a;paint-order:stroke;stroke:#f4efe4;stroke-width:2.4px}",
         "</style>",
         f'<rect class="bg" width="{W}" height="{H}"/>']
    for layer, cls, d in sorted(areas, key=lambda a: a[0]):
        if layer <= 2:
            o.append(f'<path class="{cls}" d="{d}"/>')
    for d in campus_outline:
        o.append(f'<path class="campus" d="{d}"/>')
    for layer, cls, d in sorted(areas, key=lambda a: a[0]):
        if layer > 2:
            o.append(f'<path class="{cls}" d="{d}"/>')
    for kind, d, _ in lines:
        if kind.startswith("waterway"):
            o.append(f'<path class="ww" stroke-width="{6 if kind.endswith("river") else 2.2}" d="{d}"/>')
    for kind, d, _ in lines:
        if kind in FOOT:
            o.append(f'<path class="{"st" if kind == "steps" else "ft"}" d="{d}"/>')
    road = [(k, d) for k, d, _ in lines if k in ROAD_W]
    for k, d in road:
        o.append(f'<path class="rc" stroke-width="{ROAD_W[k] + 1.6}" d="{d}"/>')
    for k, d in road:
        o.append(f'<path class="rd" stroke-width="{ROAD_W[k]}" d="{d}"/>')
    for cls, d in bld_shapes:
        o.append(f'<path class="{cls}" d="{d}"/>')
    # 도로 이름
    done = set()
    for k, d, name in lines:
        if name and k in ("trunk", "tertiary", "residential", "living_street") and name not in done and not name.startswith("대한민국"):
            done.add(name)
            o.append(f'<path id="r{len(done)}" d="{d}" fill="none"/>')
            o.append(f'<text class="lbl"><textPath href="#r{len(done)}" startOffset="30%">{name}</textPath></text>')
    o.append(f'<text x="{W - 6}" y="{H - 6}" text-anchor="end" style="font:9px sans-serif;fill:#9a8f7c">© OpenStreetMap contributors (ODbL)</text>')
    o.append("</svg>")
    return "\n".join(o)


with open(os.path.join(ROOT, "map", "campus.svg"), "w", encoding="utf-8") as f:
    f.write(svg())

# ---------------------------------------------------------------- 보행 경로 그래프 (지름길 동선용)
WALKABLE = FOOT | set(ROAD_W) - {"trunk"} | {"tertiary_link"}
graph = {}


def link(a, b):
    (x1, y1), (x2, y2) = nodes[a], nodes[b]
    d = math.hypot(x2 - x1, y2 - y1)
    graph.setdefault(a, []).append((b, d))
    graph.setdefault(b, []).append((a, d))


for w in ways.values():
    if w["tags"].get("highway") in WALKABLE:
        for a, b in zip(w["refs"], w["refs"][1:]):
            link(a, b)

# 가장 큰 연결 덩어리만 사용 (따로 떨어진 짧은 길로 붙는 것 방지)
seen, comps = set(), []
for s in graph:
    if s in seen:
        continue
    comp, stack = [], [s]
    seen.add(s)
    while stack:
        u = stack.pop()
        comp.append(u)
        for v, _ in graph[u]:
            if v not in seen:
                seen.add(v)
                stack.append(v)
    comps.append(comp)
MAIN = set(max(comps, key=len))


def nearest_node(x, y):
    return min(MAIN, key=lambda n: (nodes[n][0] - x) ** 2 + (nodes[n][1] - y) ** 2)


def shortest(a, b):
    dist, prev, pq = {a: 0}, {}, [(0, a)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == b:
            break
        if d > dist[u]:
            continue
        for v, w in graph[u]:
            nd = d + w
            if nd < dist.get(v, 1e18):
                dist[v], prev[v] = nd, u
                heapq.heappush(pq, (nd, v))
    path = [b]
    while path[-1] != a:
        path.append(prev[path[-1]])
    return path[::-1], dist[b]


def route_via(codes):
    pts_out, total = [], 0.0
    stops = [campus_buildings[c] for c in codes]
    ids = [nearest_node(s["x"], s["y"]) for s in stops]
    for a, b in zip(ids, ids[1:]):
        p, d = shortest(a, b)
        total += d
        seg = [nodes[n] for n in p]
        pts_out += seg if not pts_out else seg[1:]
    return [[round(x, 1), round(y, 1)] for x, y in pts_out], total


# ---------------------------------------------------------------- 도로명 주소 -> 대략 위치
addr_pts = {}
for wid, w in ways.items():
    t = w["tags"]
    if t.get("addr:street") and t.get("addr:housenumber") and len(w["refs"]) > 2:
        addr_pts.setdefault(t["addr:street"], []).append((t["addr:housenumber"], centroid(pts(w["refs"][:-1]))))
for nid, t in node_tags.items():
    if t.get("addr:street") and t.get("addr:housenumber"):
        addr_pts.setdefault(t["addr:street"], []).append((t["addr:housenumber"], nodes[nid]))

street_lines = {}
for w in ways.values():
    nm = w["tags"].get("name")
    if w["tags"].get("highway") and nm:
        street_lines.setdefault(nm, []).append(w["refs"])


def chain(segs):
    """같은 이름 도로 조각을 가장 긴 한 줄로 잇기."""
    best = []
    pool = [list(s) for s in segs]
    while pool:
        cur = pool.pop(0)
        grow = True
        while grow:
            grow = False
            for s in pool:
                if s[0] == cur[-1]:
                    cur += s[1:]
                elif s[-1] == cur[-1]:
                    cur += s[::-1][1:]
                elif s[-1] == cur[0]:
                    cur = s[:-1] + cur
                elif s[0] == cur[0]:
                    cur = s[::-1][:-1] + cur
                else:
                    continue
                pool.remove(s)
                grow = True
                break
        if len(cur) > len(best):
            best = cur
    return [nodes[r] for r in best]


def locate_on(line, x, y):
    """점을 도로선에 투영 -> (도로 시작부터 거리, 어느 쪽인지 부호)"""
    best, acc = (1e18, 0, 1), 0.0
    for (x1, y1), (x2, y2) in zip(line, line[1:]):
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy or 1e-9
        u = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / L2))
        px, py = x1 + u * dx, y1 + u * dy
        d = math.hypot(x - px, y - py)
        side = 1 if dx * (y - y1) - dy * (x - x1) > 0 else -1
        if d < best[0]:
            best = (d, acc + u * math.sqrt(L2), side)
        acc += math.sqrt(L2)
    return best[1], best[2], acc


def point_at(line, s, side, off):
    acc = 0.0
    for (x1, y1), (x2, y2) in zip(line, line[1:]):
        L = math.hypot(x2 - x1, y2 - y1)
        if acc + L >= s or (x2, y2) == line[-1]:
            u = (s - acc) / L if L else 0
            u = max(0, min(1, u))
            nx, ny = -(y2 - y1) / (L or 1), (x2 - x1) / (L or 1)
            return x1 + u * (x2 - x1) + side * off * nx, y1 + u * (y2 - y1) + side * off * ny
        acc += L
    return line[-1]


def fit(samples):
    n = len(samples)
    if n == 0:
        return None
    if n == 1:
        return 0.0, samples[0][1]
    mx = sum(a for a, _ in samples) / n
    my = sum(b for _, b in samples) / n
    vx = sum((a - mx) ** 2 for a, _ in samples)
    if vx == 0:
        return 0.0, my
    k = sum((a - mx) * (b - my) for a, b in samples) / vx
    return k, my - k * mx


street_model = {}
for st, items in addr_pts.items():
    if st not in street_lines:
        continue
    line = chain(street_lines[st])
    if len(line) < 2:
        continue
    by_par = {0: [], 1: []}
    sides = {0: [], 1: []}
    exact = {}
    by_main = {}
    nums = []
    for hn, (x, y) in items:
        m = re.match(r"(\d+)", hn)
        if not m or int(m.group(1)) == 50 and st == "대학로":
            continue
        num = int(m.group(1))
        s, side, total = locate_on(line, x, y)
        by_par[num % 2].append((num, s))
        sides[num % 2].append(side)
        exact.setdefault(hn, (x, y))
        by_main.setdefault(num, []).append((x, y))
        nums.append(num)
    allfit = fit(by_par[0] + by_par[1])
    street_model[st] = {"line": line, "total": total, "exact": exact, "by_main": by_main,
                        "range": (min(nums), max(nums)) if nums else (0, 0),
                        "fit": {p: fit(by_par[p]) if len(by_par[p]) >= 2 else allfit for p in (0, 1)},
                        "side": {p: (1 if sum(sides[p]) >= 0 else -1) if sides[p] else (1 if p else -1) for p in (0, 1)}}

ADDR_RE = re.compile(r"(대학로|대학촌\d길|용두제방길|요도천변길|하검단\d길|상검단\d길|모단길|중원대로)\s*(\d+(?:-\d+)?)")


def geocode(text):
    m = ADDR_RE.search(text)
    if not m:
        return None
    st, hn = m.group(1), m.group(2)
    if st == "대학로" and hn == "50":
        return None
    sm = street_model.get(st)
    if not sm:
        return None
    if hn in sm["exact"]:
        x, y = sm["exact"][hn]
        return x, y, False
    main = int(hn.split("-")[0])
    # 같은 본번(220-x) 건물이 있으면 그 평균 위치
    if main in sm["by_main"]:
        ps = sm["by_main"][main]
        return sum(a for a, _ in ps) / len(ps), sum(b for _, b in ps) / len(ps), True
    # 알려진 번지 범위를 많이 벗어나면 추정하지 않음 (엉뚱한 곳에 찍히는 것 방지)
    lo, hi = sm["range"]
    if main < lo - 15 or main > hi + 15:
        return None
    f = sm["fit"][main % 2]
    if not f:
        return None
    s = f[0] * main + f[1]
    if s < -120 or s > sm["total"] + 120:
        return None
    x, y = point_at(sm["line"], max(0, min(sm["total"], s)), sm["side"][main % 2], 14)
    return x, y, True


# ---------------------------------------------------------------- 장소표 읽기
import sys

sys.path.insert(0, os.path.join(ROOT, "tools", "lib"))
import openpyxl  # noqa: E402

wb = openpyxl.load_workbook(os.path.join(SRC, "places.xlsx"), data_only=True)
ws = wb["장소표"]
rows = list(ws.iter_rows(values_only=True))
head = [str(h).strip() for h in rows[0]]
col = {h: i for i, h in enumerate(head)}
NONE = "확인 안 됨"


def cell(r, name):
    i = col.get(name)
    if i is None or i >= len(r) or r[i] is None:
        return ""
    v = str(r[i]).strip()
    return "" if v == NONE else v


# 건물 이름/별칭 -> 번호
ALIAS = [
    ("국제청년협력센터", "E18"), ("스마트 ICT", "E17"), ("스마트ICT", "E17"), ("ICT관", "E17"),
    ("대원생활관", "E16"), ("대원 ", "E16"), ("학군단", "E15"), ("학생군사교육단", "E15"),
    ("인문사회", "E14"), ("인사대", "E14"), ("건설환경관", "E13"), ("건축관", "E12"), ("창업생산동", "E11"),
    ("역학시험동", "E10"), ("항공", "E9"), ("복지관", "E8-1"), ("별관", "E8-1"), ("대학본부", "E8"), ("보건실", "E8"),
    ("경영항공관", "E7"), ("학생회관", "E6"), ("국원피트니스", "E6"), ("테크노관", "E5"), ("시스템관", "E4"), ("국원문화관", "E4"),
    ("소담스퀘어", "E3"), ("국원생활관", "E3"), ("국원 쉼터", "E2"), ("국원쉼터", "E2"), ("정문", "E1"),
    ("환경관", "W22"), ("중앙도서관", "W20"), ("도서관", "W20"), ("지스퀘어", "W20"), ("캐럴", "W20"), ("디지털정보센터", "W20"),
    ("대운동장", "W19"), ("미래융합정보관", "W18"), ("인터넷창업센터", "W17"), ("IT관", "W16"), ("동아리관", "W15"),
    ("예성관리동", "W13"), ("예성중원관리동", "W13"), ("예성", "W11"), ("중원생활관", "W10"), ("중원 ", "W10"),
    ("공동실험", "W9"), ("화학생명관", "W7"), ("휴스퀘어", "W6"), ("종합강의", "W5"), ("대학원", "W4"),
    ("노천극장", "W3"), ("아레나", "W2"), ("체육관", "W2"), ("테니스장", "W1"), ("우체국", "W5"), ("농협", "W5"),
]
CODE_IN_TEXT = re.compile(r"\b([EW])\s?(\d{1,2}(?:-\d)?)(?:동)?\b")


def find_building(name, loc):
    for text in (loc, name):
        m = CODE_IN_TEXT.search(text.replace("W 20", "W20"))
        if m and (m.group(1) + m.group(2)) in campus_buildings:
            return m.group(1) + m.group(2)
    for text in (loc, name):
        for key, code in ALIAS:
            if key in text and code in campus_buildings:
                if key == "환경관" and "건설환경관" in text:
                    continue
                if key == "IT관" and ("ICT" in text):
                    continue
                if key == "항공" and "경영항공관" in text:
                    continue
                return code
    return None


# 사이트용 카테고리 (위에서부터 먼저 걸리는 것이 대표 카테고리)
CATS = [
    ("shortcut", "지름길·동선", "🚶", ["지름길", "편하게 가는", "편하게 올라", "쉽게 올라", "편한길", "엘리베이터", "고가길"]),
    ("rest", "쉬는 곳", "🛋️", ["휴식", "휴게", "쉼터", "쉬는", "라운지", "벤치", "안정실", "잔디", "공강", "시간 보내는", "북카페", "로비"]),
    ("study", "공부하기 좋은 곳", "📚", ["열람실", "캐럴", "스터디", "독서실", "밤샘", "디지털정보", "도서관 2층", "도서관 3층", "중앙도서관 2", "중앙도서관 3", "지스퀘어", "논문"]),
    ("walk", "산책·사진", "🌸", ["산책", "벚꽃", "둘레길", "러닝", "사진", "야경", "옥상", "전망", "드라이브", "호암지", "숲길", "천변길 산책", "노천극장", "청설모", "고양이", "탄금", "수주팔봉", "악어봉", "악아봉", "낚시", "스탠드"]),
    ("food", "맛집·카페·학식", "🍚", ["학식", "식당", "카페", "커피", "간식", "아침밥", "밀크티", "베이커리", "주점", "주막", "포차", "맥주", "다방", "쿠마쿠마", "요리", "삼겹", "치킨", "피자", "버거"]),
    ("convenience", "편의시설", "🏪", ["프린트", "프린터", "복사", "제본", "은행", "계좌", "우체국", "택배", "우편", "CU", "GS25", "세븐일레븐", "이마트24", "편의점", "빨래", "세탁", "헬스", "피트니스", "운동하는", "보건", "아플 때", "약", "3D", "서점", "책", "PC", "pc", "씨방", "카피", "노래", "마트", "하나로", "편의시설", "V3", "한글", "증명서", "볼링", "영화"]),
    ("transport", "교통", "🚌", ["버스", "택시", "셔틀", "통학", "기차", "KTX", "터미널", "정류소", "주차", "콜버스", "공항", "동서울", "대전", "판교", "회차지", "주덕역"]),
    ("academic", "학사·장학", "🎓", ["수강", "장학", "근로", "학사경고", "학사관리", "학사 제도", "졸업", "재수강", "계절학기", "휴학", "등록금", "출석", "동아리", "예비군", "상담", "와이파이", "학생증", "통합정보", "UTRO", "생성형 AI", "교환학생", "외국인", "ARC", "문의", "취업", "강의실", "세미나실"]),
    ("living", "생활관·자취", "🏠", ["생활관", "원룸", "자취", "월세", "벌점", "외박", "통금", "배달", "로켓프레시", "지역화폐", "물가", "번화가", "페이코"]),
]
CAT_META = [{"id": c[0], "label": c[1], "icon": c[2]} for c in CATS] + [
    {"id": "building", "label": "건물 안내", "icon": "🏫"},
    {"id": "etc", "label": "기타", "icon": "✨"},
]


def categorize(name, loc, orig):
    text = name + " " + loc
    if orig == "캠퍼스 건물 안내":
        return ["building"]
    found = []
    for cid, _, _, keys in CATS:
        if any(k in text for k in keys):
            found.append(cid)
    if orig == "맛집":
        found = ["food"] + [f for f in found if f not in ("food", "convenience")]
    # '생활관 독서실'처럼 공부가 분명하면 생활관보다 공부를 앞으로
    if not found and re.search(r"(교통대학교 ?충주캠퍼스|교통대 ?충주캠퍼스|한국교통대학교 )", name):
        found = ["building"]
    if not found:
        found = ["etc"]
    return found


# 사이트에서 뺄 항목 (원본 엑셀은 그대로 둠). 위치를 확인하면 여기서 지우고 다시 빌드하세요.
EXCLUDE = {
    "카페 제이",  # 요도천변길 299 — 실제 위치 미확인 (2026-10-20)
}

places = []
for i, r in enumerate(rows[1:]):
    name = cell(r, "이름")
    if not name or name in EXCLUDE:
        continue
    loc, link, orig = cell(r, "위치"), cell(r, "지도"), cell(r, "분류")
    date, rec = cell(r, "확인한 날"), r[col["추천 수"]] or 1
    desc = cell(r, "설명")
    cats = categorize(name, loc, orig)
    p = {"id": i + 1, "name": name, "loc": loc, "link": link, "orig": orig, "date": date,
         "rec": int(rec), "cats": cats}
    if desc:
        p["desc"] = desc
    code = None
    if orig == "캠퍼스 건물 안내":
        code = loc if loc in campus_buildings else None
    else:
        is_campus = ("대학로 50" in loc or "대학로50" in loc or "교통대" in loc or "캠퍼스" in loc
                     or "검단리 123" in loc or "캠퍼스" in name or not re.search(r"(충주시|충청북도|충북)", loc))
        if is_campus or re.search(r"[EW]\s?\d", loc):
            code = find_building(name, loc)
    if code:
        b = campus_buildings[code]
        p["b"] = code
        p["x"], p["y"] = round(b["x"], 1), round(b["y"], 1)
        if b.get("approx"):
            p["approx"] = True
    else:
        g = geocode(loc)
        if g:
            p["x"], p["y"] = round(g[0], 1), round(g[1], 1)
            if g[2]:
                p["approx"] = True
    if date and date[:4].isdigit() and int(date[:4]) <= 2023:
        p["old"] = True
    places.append(p)

# ---------------------------------------------------------------- 중복 합치기
# 원본 정리 규칙은 이름이 완전히 같을 때만 합쳐서, "부리또인 / 부리또인 충주교통대점"처럼
# 같은 곳이 여러 줄로 남아 있음. 이름을 정규화해서 같은 곳이면 한 줄로 합침.
GENERIC = {"카페", "프린트", "버스", "버스이용", "학식먹는곳", "프린터"}
SAME_AS = {"dropby": "드랍바이", "대학로친구분식": "친구분식", "도란도락도시락본점": "도란도락",
           "쇼쿠스시충주호암점": "쇼쿠스시", "메밀마당충주중앙탑본점": "메밀마당",
           "큰집아저씨충주본점": "큰집아저씨"}
BUILDING_ALIAS = {"종합강의동": "W5", "인문사회예술대학": "E14", "인사대": "E14", "국원쉼터": "E2",
                  "대학본부별관": "E8-1", "복지관": "E8-1"}


def norm_name(n):
    n = re.sub(r"\(.*?\)", "", n)
    n = re.sub(r"(국립)?한국교통대(학교)?\s*(충주캠퍼스)?", "", n)
    n = re.sub(r"(충주)?(한국)?교통대(학교)?(앞|1호|2호)?점$", "", n.strip())
    n = re.sub(r"충주(교통대)?점$", "", n.strip())
    n = re.sub(r"[\s·,.\-–_/&]", "", n).lower()
    return SAME_AS.get(n, n)


def addr_key(loc):
    m = re.search(r"([가-힣0-9]+(?:로|길))\s*(\d+)(?:-\d+)?", loc)
    if not m or (m.group(1) == "대학로" and m.group(2) == "50"):
        return None
    return m.group(1) + m.group(2)


def compatible(a, b):
    if a.get("b") or b.get("b"):
        return a.get("b") == b.get("b") or not (a.get("b") and b.get("b"))
    ka, kb = addr_key(a["loc"]), addr_key(b["loc"])
    if ka and kb:
        return ka == kb or "x" not in a or "x" not in b
    return True  # 한쪽에 위치가 없으면 같은 곳으로 봄


def merge_into(keep, other):
    keep["rec"] += other["rec"]
    if other.get("date", "") > keep.get("date", ""):
        keep["date"] = other["date"]
    for c in other["cats"]:
        if c not in keep["cats"]:
            keep["cats"].append(c)
    if len(other["loc"]) > len(keep["loc"]) and ("x" in other or "x" not in keep):
        keep["loc"] = other["loc"]
    if not keep.get("link") and other.get("link"):
        keep["link"] = other["link"]
    if "x" not in keep and "x" in other:
        for k in ("x", "y", "b", "approx"):
            if k in other:
                keep[k] = other[k]
    if other["name"] != keep["name"]:
        keep.setdefault("aka", [])
        if other["name"] not in keep["aka"]:
            keep["aka"].append(other["name"])
    for a in other.get("aka", []):
        if a not in keep.setdefault("aka", []) and a != keep["name"]:
            keep["aka"].append(a)
    if not other.get("old"):
        keep.pop("old", None)


def better(a, b):
    """둘 중 남길 쪽: 위치 있음 > 추천 많음 > 원본 주소가 자세함"""
    sa = ("x" in a, a["rec"], len(a["loc"]))
    sb = ("x" in b, b["rec"], len(b["loc"]))
    return a if sa >= sb else b


before = len(places)
# 1) 캠퍼스 건물 이름만 있는 꿀팁("한국교통대학교 충주캠퍼스중앙도서관")은 건물 안내 줄로 합침
bld_rows = {p["b"]: p for p in places if p["orig"] == "캠퍼스 건물 안내" and p.get("b")}
bld_names = {}
for code, p in bld_rows.items():
    for part in re.split(r"[/()]", p["name"]) + [campus_buildings[code]["name"]]:
        if part.strip():
            bld_names[norm_name(part)] = code
for k, code in BUILDING_ALIAS.items():
    bld_names[norm_name(k)] = code
for p in list(places):
    if p["orig"] == "캠퍼스 건물 안내" or not p.get("b"):
        continue
    if bld_names.get(norm_name(p["name"])) == p["b"] and p["b"] in bld_rows:
        merge_into(bld_rows[p["b"]], p)
        places.remove(p)
for p in bld_rows.values():
    p["cats"] = ["building"] + [c for c in p["cats"] if c != "building"]

# 2) 이름이 같은(정규화 기준) 곳끼리 합침
groups = {}
for p in places:
    n = norm_name(p["name"])
    if n in GENERIC or p["orig"] == "캠퍼스 건물 안내":
        continue
    groups.setdefault(n, []).append(p)
for n, g in groups.items():
    while len(g) > 1:
        keep = g[0]
        for o in g[1:]:
            keep = better(keep, o)
        rest = [o for o in g if o is not keep and compatible(keep, o)]
        if not rest:
            break
        for o in rest:
            merge_into(keep, o)
            places.remove(o)
        g = [o for o in g if o is keep or o not in rest]
        if len(g) > 1 and all(not compatible(g[0], o) for o in g[1:]):
            break

# 3) 이름만 같은 다른 곳("카페", "프린트")은 위치를 붙여 구분
for p in places:
    if norm_name(p["name"]) in GENERIC and sum(1 for q in places if norm_name(q["name"]) == norm_name(p["name"])) > 1:
        where = campus_buildings[p["b"]]["name"].split("/")[0] if p.get("b") else re.sub(r"^(충청북도|충북)\s*충주시\s*(대소원면\s*)?", "", p["loc"])[:14]
        if where:
            p["name"] = p["name"] + " · " + where
# 대표 이름은 한글 이름 우선 (DROP BY -> 드랍바이)
for p in places:
    if p.get("aka") and not re.search("[가-힣]", p["name"]):
        ko = next((a for a in p["aka"] if re.search("[가-힣]", a)), None)
        if ko:
            p["aka"] = [x for x in p["aka"] if x != ko] + [p["name"]]
            p["name"] = ko
print(f"중복 합치기: {before}줄 -> {len(places)}줄")

by_name = {}
for p in places:
    by_name.setdefault(p["name"], []).append(p["id"])


def ids(*names):
    out = []
    for n in names:
        out += by_name.get(n, [])
    return out


# ---------------------------------------------------------------- 지름길·동선 (학생 원본 설명의 경유지 기준)
ROUTES = [
    {"id": "ict", "title": "스마트ICT관 편하게 올라가기", "color": "#e8590c", "via": ["E8", "E17"],
     "desc": "언덕길을 바로 오르지 말고 대학본부(E8) 건물 엘리베이터로 로비 층까지 올라간 뒤, 거기서부터 걸어가면 훨씬 편해요.",
     "tips": ids("ICT관 편하게 가는 법", "ICT관(스마트ICT관) 가장 편하게 올라가는 법", "ICT관 지름길", "스마트ICT관 가는 길 쉼터")},
    {"id": "insa", "title": "인사대(인문사회관) 쉽게 가기", "color": "#7048e8", "via": ["E8", "E12", "E14"],
     "desc": "건축관(E12) 엘리베이터를 타고 올라가서 인문사회관(E14)으로 건너가면 계단·언덕을 덜 걸어요.",
     "tips": ids("인사대 갈 때 건축관 엘리베이터 이용", "편한길", "인문사회예술대학 지름길 가는 법", "언덕 위 건물 쉽게 올라가는 법", "인문사회관 벚꽃길")},
    {"id": "ridge", "title": "건설환경관 → 스마트ICT관 고가길", "color": "#1c7ed6", "via": ["E13", "E17"],
     "desc": "건설환경관에서 스마트ICT관까지 차도 옆 인도를 따라 이어지는 중앙 고가길이에요.",
     "tips": ids("건설환경관과 스마트 ICT가는 중앙 고가길", "대학본부 뒤 산책길")},
    {"id": "loop", "title": "교통대 둘레길 한 바퀴", "color": "#2f9e44", "via": ["E1", "E5", "E17", "E16", "W16", "W4", "E1"],
     "desc": "정문 → 테크노관 → 스마트ICT관 → 생활관 → IT관 → 대학원 → 정문으로 도는 교내 산책 코스예요.",
     "tips": ids("교통대 둘레길", "교내 둘레길", "인사대 옆 숲길", "학교 내 산책길")},
]
routes = []
for r in ROUTES:
    if all(c in campus_buildings for c in r["via"]):
        line, dist = route_via(r["via"])
        r2 = {k: v for k, v in r.items()}
        r2["line"] = line
        r2["meters"] = round(dist / 10) * 10
        r2["stops"] = [{"code": c, "name": campus_buildings[c]["name"], "x": round(campus_buildings[c]["x"], 1),
                        "y": round(campus_buildings[c]["y"], 1)} for c in r["via"]]
        routes.append(r2)
        for pid in r["tips"]:
            pl = next(p for p in places if p["id"] == pid)
            pl["route"] = r["id"]
            if "shortcut" not in pl["cats"] and r["id"] != "loop" and not re.search("산책|벚꽃", pl["name"]):
                pl["cats"].insert(0, "shortcut")

buildings = sorted(({"code": b["code"], "name": b["name"], "x": round(b["x"], 1), "y": round(b["y"], 1),
                     **({"approx": True} if b.get("approx") else {})} for b in campus_buildings.values()),
                   key=lambda b: (b["code"][0], int(re.match(r"[EW](\d+)", b["code"]).group(1)), b["code"]))

# 자취방: OSM에 이름이 적힌 주거 건물(원룸·빌라 등) -> '자취방' 카테고리 마커
HOUSE_RE = re.compile(r"(원룸|빌|텔|하우스|타운|홈|파크|빌라|오피스텔|고시|집|애플|정원|top|TOP)")
housing, seen_h = [], set()
for w in ways.values():
    t = w["tags"]
    nm = t.get("name")
    if not nm or t.get("building") not in ("residential", "apartments", "yes", "house", "dormitory"):
        continue
    if CODE_RE.search(nm) or nm in seen_h or not HOUSE_RE.search(nm):
        continue
    seen_h.add(nm)
    c = centroid(pts(w["refs"][:-1]))
    hn = t.get("addr:housenumber")
    housing.append({"name": nm, "x": round(c[0], 1), "y": round(c[1], 1),
                    "addr": (t.get("addr:street", "") + " " + hn).strip() if hn else ""})
for p in places:
    if re.search(r"원룸|자취|월세|전세", p["name"]) and "rent" not in p["cats"] and "산책" not in p["name"]:
        p["cats"].insert(0 if p["cats"] == ["living"] else len(p["cats"]), "rent")
CAT_META.insert(len(CAT_META) - 2, {"id": "rent", "label": "자취방·시세", "icon": "🔑"})

data = {"size": {"w": W, "h": H}, "builtAt": wb.properties.modified.isoformat()[:10] if wb.properties.modified else "",
        "categories": CAT_META, "buildings": buildings, "busStops": bus_stops, "routes": routes, "places": places,
        "housing": housing}
with open(os.path.join(ROOT, "data", "places.js"), "w", encoding="utf-8") as f:
    f.write("// tools/build.py 가 만든 파일입니다. 직접 고치지 말고 엑셀을 고친 뒤 다시 빌드하세요.\n")
    f.write("window.CAMPUS = ")
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")

placed = sum(1 for p in places if "x" in p)
print(f"지도 {W}x{H}m, 건물 {len(buildings)}개, 장소 {len(places)}개 중 지도 표시 {placed}개, 동선 {len(routes)}개")
missing = sorted({c for c in ["E%d" % i for i in range(1, 19)] + ["W%d" % i for i in range(1, 23)]} - set(campus_buildings))
print("OSM에 없는 건물 번호:", missing)
