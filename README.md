# 🍯 교통대 꿀팁 지도

국립한국교통대학교 **충주캠퍼스** 학생들이 직접 모은 꿀팁 468개를 캠퍼스 지도 위에 보여주는 사이트예요.

- 🗺️ 캠퍼스 지도 그림 (OpenStreetMap 건물·도로로 만든 SVG) 위에 카테고리별 마커
- 🚶 지름길·동선: 학생들이 적은 경유지를 실제 보행로 위에 경로로 표시
- 🛋️ 쉬는 곳 · 📚 공부 · 🌸 산책 · 🍚 맛집 · 🏪 편의시설 · 🚌 교통 · 🎓 학사 등 카테고리별 보기
- 🔍 검색하면 결과가 카테고리 색깔 마커로 지도에 표시
- 🏫 강의실 찾기: "테크노관 213", "E5-213" → 2층, 그 층 학과까지 / 건물을 누르면 층별 안내
- 🧹 같은 곳이 이름만 달라 여러 번 들어간 꿀팁은 빌드할 때 자동으로 합쳐요 (468 → 417줄)
- 🔑 자취방 시세: 학교 앞 원룸 매물 요약 + 보증금·월세·방구조 조건 검색, 주변 원룸 건물 116곳 지도 표시
- 📱 모바일에서는 지도/목록 전환

👉 **사이트 주소: https://bellhyuk05.github.io/ut-campus-tips/**

**API 키나 서버가 필요 없는 정적 사이트**라 GitHub Pages에 그대로 올리면 됩니다.

## 폴더 구조

```
index.html            페이지
assets/app.js         지도·검색·필터 동작
assets/style.css      디자인
assets/vendor/leaflet 지도 라이브러리 (외부 CDN 없이 포함)
map/campus.svg        캠퍼스 지도 그림 (자동 생성)
data/places.js        꿀팁·건물·동선 데이터 (자동 생성)
data/rent.js          자취방 시세 (직접 수정하는 파일)
data/bluming.js       블루밍 건물별 연세·학기 가격 (직접 수정하는 파일)
data/floors.js        건물 층별 안내 (직접 수정하는 파일, 학교 캠퍼스지도 기준)
tools/build.py        엑셀 + OSM → 지도/데이터 만드는 스크립트
tools/source/         원본 엑셀(places.xlsx), OSM 지도 원본(campus.osm)
```

## GitHub Pages로 배포하기 (GitHub Desktop)

1. GitHub Desktop → **File → Add local repository** → `C:\dev\ut-campus-tips` 선택
   (저장소가 아니라고 나오면 **create a repository** 클릭)
2. 왼쪽 아래 Summary에 `첫 배포` 입력 → **Commit to main**
3. **Publish repository** 클릭 → *Keep this code private* **체크 해제** → Publish
4. 웹에서 저장소 페이지 → **Settings → Pages** → Source: *Deploy from a branch*, Branch: `main` / `/(root)` → Save
5. 1~2분 뒤 `https://<내아이디>.github.io/ut-campus-tips/` 로 접속

수정 후에는 GitHub Desktop에서 Commit → **Push origin** 만 하면 자동으로 반영돼요.

## 내용 고치기

### 자취방 시세 업데이트
`data/rent.js`를 메모장/VS Code로 열어 `listings`에 한 줄 추가하고 `checked` 날짜를 바꾸면 끝이에요.
`building`에 지도에 있는 원룸 건물 이름(예: `"송학원룸 C동"`)을 적으면 그 건물에 🔑 가격 마커가 생겨요.

### 건물 층별 안내 고치기
`data/floors.js`에서 건물 번호(예: `"E5"`)의 `floors`에 `["3", ["학과 이름"]]`처럼 층을 추가하면 돼요. `aliases`에 줄임말(예: `"미융관"`)을 넣으면 "미융관 302"처럼 검색돼요.

### 꿀팁 추가·수정
1. `tools/source/places.xlsx`의 장소표 시트를 고칩니다. (`설명` 열을 새로 만들면 팝업에 설명이 같이 나와요)
2. 다시 빌드:
   ```
   python -m pip install openpyxl
   python tools/build.py
   ```
3. 바뀐 `data/places.js`, `map/campus.svg`를 커밋·푸시

### 지름길 동선 추가
`tools/build.py`의 `ROUTES` 목록에 건물 번호 경유지(예: `["E8", "E12", "E14"]`)를 넣고 다시 빌드하면 보행로를 따라 경로가 그려져요.

## 알아둘 점
- 지도 위치는 건물 번호(E1~E18, W1~W22)·건물 이름으로 잡았고, 학교 밖 가게는 도로명 번지로 **대략** 추정했어요 (점선 테두리 마커).
- 충주 시내 등 지도 범위 밖 장소와 위치가 없는 꿀팁(수강신청, 장학금 등)은 목록에만 나와요.
- 원본 장소표에는 꿀팁의 자세한 설명이 없어 이름·위치·추천 수·확인한 날 위주로 보여줘요.
- 자취방 시세는 2026-10-20 기준 **국토교통부 실거래가 공개시스템**의 단독/다가구 전월세 신고(검단리·만정리·용두동, 최근 1년 33건)와 블루밍(연세 149건·학기 30건)·당근부동산·다방 공개 매물이에요. 블루밍은 건물 이름과 가격만 정리했고 사진·설명은 넣지 않았어요. 실거래는 `data/rent.js`의 `official.rows`에 있고, rt.molit.go.kr → 자료제공 → 단독/다가구 → 전월세에서 다시 받아 갱신할 수 있어요.
- 지도 데이터 © OpenStreetMap contributors (ODbL) — 출처 표기를 지우지 마세요.
