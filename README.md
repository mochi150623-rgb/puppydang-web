# 퍼피댕 안심분양소 대전본점 — 웹사이트

대전 강아지분양·고양이분양 안내 사이트입니다. GitHub Pages로 배포됩니다.

- 주소: https://mochi150623-rgb.github.io/puppydang-web/
- 매장: 대전광역시 유성구 지족동로 184 · 010-7274-4411 · 매일 11:00–21:00

## 글쓰기 (admin 전용)
1. 사이트 하단 `관리자` 버튼 → 아이디 `admin`, 비밀번호 입력
2. 처음 한 번: `DB 설정` 탭의 SQL을 Supabase SQL Editor에서 실행 (`public.site_posts` 생성 + RLS)
3. `+ 새 글 쓰기`로 글을 올리고, 카드의 `수정`/`삭제`로 관리

기본 6개 SEO 글은 `index.html`에 들어 있어 검색엔진과 첫 방문자에게 항상 보입니다.
추가·수정·삭제한 글은 Supabase `public.site_posts`에서 읽어 옵니다. (누구나 읽기, admin만 쓰기)
