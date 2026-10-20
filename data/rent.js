// 자취방 시세 데이터 (직접 고쳐서 쓰는 파일입니다)
// - 가격 단위: 만원 (deposit = 보증금, rent = 월세, jeonse = 전세금)
// - building: 지도에 있는 원룸 건물 이름(OSM 기준)과 같으면 그 건물에 마커가 생겨요. 모르면 비워 두세요.
// - 새 매물을 확인하면 listings 에 한 줄씩 추가하고 checked 날짜를 바꿔 주세요.
window.RENT = {
  checked: "2026-10-20",
  area: "학교 앞 원룸촌 (대학로·대학촌길·모단길, 요도천 다리 건너)",
  sources: [
    { name: "당근부동산", url: "https://realty.daangn.com/", note: "학교 앞 원룸 10건 (월세 8 · 전세 1 · 매매 1), 투룸 0건" },
    { name: "다방", url: "https://www.dabangapp.com/", note: "학교 앞 원룸 1건" },
    { name: "직방", url: "https://www.zigbang.com/", note: "학교 주변 표시 매물 없음" },
    { name: "블루밍", url: "https://m.campuszone.net/", note: "교통대(충주) 전용 자취방 앱 · 연세 149건·학기 30건 (data/bluming.js)" },
    { name: "네이버 부동산", url: "https://new.land.naver.com/", note: "직접 확인 필요" },
    { name: "국토부 실거래가", url: "https://rt.molit.go.kr/", note: "단독/다가구 전월세 신고 33건 (최근 1년)" }
  ],
  // 국토교통부 실거래가 공개시스템 · 단독/다가구 전월세 신고 자료 (충주시 대소원면 검단리·만정리, 용두동)
  // 계약일 2025-10-21 ~ 2026-10-20 (2026-10-20 조회). dep = 보증금, rent = 월세 (만원), m2 = 계약면적
  official: {
    source: "국토교통부 실거래가 공개시스템",
    url: "https://rt.molit.go.kr/",
    period: "2025-10-21 ~ 2026-10-20",
    rows: [
      {"dong": "검단리", "m2": 199, "deal": "월세", "ym": "2026-10", "dep": 200, "rent": 45, "built": "2013", "road": "하검단1길", "kind": "신규"},
      {"dong": "만정리", "m2": 97.44, "deal": "월세", "ym": "2026-08", "dep": 0, "rent": 50, "built": "2026", "road": "만적길", "kind": "신규"},
      {"dong": "만정리", "m2": 83.68, "deal": "월세", "ym": "2026-07", "dep": 2000, "rent": 60, "built": "1983", "road": "삼밭골길", "kind": "신규"},
      {"dong": "검단리", "m2": 205.04, "deal": "월세", "ym": "2026-03", "dep": 10, "rent": 25, "built": "", "road": "모단길", "kind": "신규"},
      {"dong": "검단리", "m2": 17.82, "deal": "월세", "ym": "2026-02", "dep": 20, "rent": 33, "built": "2016", "road": "모단길", "kind": "신규"},
      {"dong": "검단리", "m2": 30, "deal": "월세", "ym": "2026-02", "dep": 20, "rent": 33, "built": "2010", "road": "모단길", "kind": "신규"},
      {"dong": "검단리", "m2": 33, "deal": "월세", "ym": "2026-02", "dep": 30, "rent": 41, "built": "", "road": "모단길", "kind": "신규"},
      {"dong": "검단리", "m2": 33, "deal": "월세", "ym": "2026-02", "dep": 20, "rent": 39, "built": "", "road": "모단길", "kind": "갱신"},
      {"dong": "검단리", "m2": 33, "deal": "월세", "ym": "2026-02", "dep": 30, "rent": 41, "built": "", "road": "모단길", "kind": "신규"},
      {"dong": "검단리", "m2": 16, "deal": "월세", "ym": "2026-02", "dep": 20, "rent": 44, "built": "", "road": "모단길", "kind": "신규"},
      {"dong": "검단리", "m2": 30, "deal": "전세", "ym": "2026-02", "dep": 4000, "rent": 0, "built": "2008", "road": "요도천변길", "kind": "-"},
      {"dong": "검단리", "m2": 16, "deal": "월세", "ym": "2026-02", "dep": 20, "rent": 31, "built": "", "road": "모단길", "kind": "신규"},
      {"dong": "검단리", "m2": 16.5, "deal": "월세", "ym": "2026-02", "dep": 20, "rent": 31, "built": "2001", "road": "모단길", "kind": "갱신"},
      {"dong": "용두동", "m2": 167.73, "deal": "월세", "ym": "2026-02", "dep": 0, "rent": 23, "built": "1994", "road": "모단길", "kind": "신규"},
      {"dong": "검단리", "m2": 16.5, "deal": "월세", "ym": "2026-02", "dep": 20, "rent": 42, "built": "", "road": "모단길", "kind": "신규"},
      {"dong": "검단리", "m2": 33, "deal": "월세", "ym": "2026-02", "dep": 30, "rent": 40, "built": "", "road": "모단길", "kind": "갱신"},
      {"dong": "검단리", "m2": 16.5, "deal": "월세", "ym": "2026-02", "dep": 20, "rent": 31, "built": "", "road": "모단길", "kind": "신규"},
      {"dong": "검단리", "m2": 33, "deal": "월세", "ym": "2026-02", "dep": 30, "rent": 41, "built": "", "road": "모단길", "kind": "신규"},
      {"dong": "검단리", "m2": 26.4, "deal": "월세", "ym": "2026-02", "dep": 30, "rent": 35, "built": "2009", "road": "모단길", "kind": "신규"},
      {"dong": "검단리", "m2": 20, "deal": "월세", "ym": "2026-02", "dep": 30, "rent": 39, "built": "2013", "road": "모단길", "kind": "신규"},
      {"dong": "검단리", "m2": 19.9, "deal": "월세", "ym": "2026-02", "dep": 30, "rent": 34, "built": "2013", "road": "요도천변길", "kind": "신규"},
      {"dong": "검단리", "m2": 23, "deal": "전세", "ym": "2026-02", "dep": 4000, "rent": 0, "built": "2008", "road": "요도천변길", "kind": "-"},
      {"dong": "검단리", "m2": 26, "deal": "전세", "ym": "2026-01", "dep": 3500, "rent": 0, "built": "2018", "road": "하검단2길", "kind": "-"},
      {"dong": "만정리", "m2": 23, "deal": "월세", "ym": "2026-01", "dep": 20, "rent": 31, "built": "2009", "road": "대학촌1길", "kind": "신규"},
      {"dong": "만정리", "m2": 33, "deal": "월세", "ym": "2025-12", "dep": 30, "rent": 42, "built": "2009", "road": "대학촌1길", "kind": "신규"},
      {"dong": "만정리", "m2": 23, "deal": "월세", "ym": "2025-12", "dep": 20, "rent": 31, "built": "2009", "road": "대학촌1길", "kind": "신규"},
      {"dong": "검단리", "m2": 26.45, "deal": "월세", "ym": "2025-12", "dep": 50, "rent": 35, "built": "2001", "road": "요도천변길", "kind": "신규"},
      {"dong": "용두동", "m2": 18, "deal": "전세", "ym": "2025-12", "dep": 3500, "rent": 0, "built": "2016", "road": "모단길", "kind": "신규"},
      {"dong": "검단리", "m2": 22.32, "deal": "월세", "ym": "2025-11", "dep": 20, "rent": 36, "built": "2009", "road": "대학촌3길", "kind": "신규"},
      {"dong": "검단리", "m2": 45, "deal": "월세", "ym": "2025-11", "dep": 200, "rent": 68, "built": "2003", "road": "대학촌3길", "kind": "신규"},
      {"dong": "만정리", "m2": 99.17, "deal": "월세", "ym": "2025-11", "dep": 60, "rent": 67, "built": "2004", "road": "대학로", "kind": "신규"},
      {"dong": "검단리", "m2": 29.75, "deal": "월세", "ym": "2025-11", "dep": 20, "rent": 32, "built": "2009", "road": "모단길", "kind": "신규"},
      {"dong": "만정리", "m2": 64.3, "deal": "월세", "ym": "2025-11", "dep": 1000, "rent": 40, "built": "", "road": "완오신촌길", "kind": "신규"}
    ]
  },
  listings: [
    { type: "오픈형 원룸", deal: "월세", deposit: 30, rent: 30, m2: 23, floor: "2층", source: "당근부동산", memo: "단기 3개월 가능" },
    { type: "오픈형 원룸", deal: "월세", deposit: 30, rent: 30, m2: 26, floor: "3층", source: "당근부동산", memo: "조용하고 가성비 좋은 원룸" },
    { type: "오픈형 원룸", deal: "월세", deposit: 100, rent: 40, m2: 23, floor: "2층", source: "당근부동산", building: "참평안텔 A동", memo: "참기쁨텔 · 풀옵션, 연세 420~440만원 가능 · 정문 도보 5분" },
    { type: "분리형 원룸", deal: "월세", deposit: 100, rent: 26, m2: 23, floor: "1층", source: "당근부동산", memo: "리모델링 · 풀옵션 · 주차 가능" },
    { type: "분리형 원룸", deal: "월세", deposit: 50, rent: 35, m2: 29, floor: "저층", source: "당근부동산", memo: "예약중" },
    { type: "오픈형 원룸", deal: "월세", deposit: 50, rent: 27, m2: 23, floor: "3층", source: "당근부동산", building: "송학원룸 C동", memo: "송학원룸 C동" },
    { type: "오픈형 원룸", deal: "월세", deposit: 50, rent: 30, m2: 26, floor: "3층", source: "당근부동산", memo: "풀옵션" },
    { type: "오픈형 원룸", deal: "월세", deposit: 30, rent: 30, m2: 26, floor: "1층", source: "당근부동산", memo: "교통대 5분 거리" },
    { type: "원룸", deal: "월세", deposit: 100, rent: 27, m2: 23, floor: "1층", source: "다방", memo: "풀옵션 · 즉시입주 · 관리비 3만" },
    { type: "오픈형 원룸", deal: "전세", jeonse: 3500, m2: 19, floor: "2층", source: "당근부동산", memo: "교통대 앞 원룸 중심지" }
  ],
  tips: [
    "학교 앞 원룸은 대부분 풀옵션(침대·냉장고·세탁기·에어컨)이라 따로 살 게 거의 없어요.",
    "1년치 월세를 한 번에 내는 '연세'로 하면 더 싸게 해주는 곳이 있어요.",
    "관리비(보통 3~5만원)와 인터넷·수도 포함 여부를 꼭 물어보세요.",
    "계약 전 등기부등본으로 집주인과 근저당을 확인하세요. (블루밍·당근 앱에서도 무료 조회 기능이 있어요)",
    "방학 때 비는 방은 단기(3~6개월) 계약이 되는 경우도 있어요."
  ]
};
