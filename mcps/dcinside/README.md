# @mymcp/dcinside

DCInside 관련 링크를 승인된 `dcinside.js` 직접 검색, Brave 인덱스 또는 사용자가 가져온 CSV/JSON에서 찾고, URL 검증과 사용자가 제공한 게시글·댓글의 로컬 저장·조회를 수행하는 MCP 서버입니다.

기본 `DCINSIDE_REMOTE_MODE=disabled`에서는 DCInside에 요청을 한 건도 보내지 않습니다. `@gurumnyang/dcinside.js` adapter는 서면 허가 검토를 마친 배포가 `authorized` 모드·갤러리 allowlist·분당 제한을 모두 설정했을 때만 동적으로 로드됩니다. 검색은 `source="authorized"`, 단건 읽기는 `sourceMode="authorized"`로 명시하며 다른 source로 자동 fallback하지 않습니다. 로그인, 글쓰기, 추천, 삭제, CAPTCHA 우회, proxy 회전, 자동 순회 기능은 없습니다.

## 데이터 출처와 준수 사항

- `source="authorized"` 검색은 `dcinside.js.search()`가 반환한 직접 검색 결과입니다. 배포의 allowlist와 분당 제한을 적용합니다.
- `source="brave"` 검색 결과는 Brave Web Search API가 이미 인덱싱한 링크·제목·짧은 snippet이며 오래되거나 불완전할 수 있습니다.
- 게시글 본문과 댓글은 사용자가 `dc_import_post`로 명시적으로 공급한 데이터만 제공합니다. 자동 갱신되지 않습니다.
- `dcinside-deep-search` CSV와 동등한 JSON은 사용자가 직접 내보낸 내용을 로컬 인덱스에 가져오는 방식으로만 연동합니다. 해당 프로젝트 코드를 복제하지 않습니다.
- DCInside 약관(2026-10-07 시행) 제16조는 사전 서면 동의 없는 크롤링을 금지합니다. 기능 확장 전 [공식 이용약관](https://nstatic.dcinside.com/dc/w/policy/policy_index.html)을 다시 검토해야 합니다.
- 검색에는 사용자가 별도로 설정한 Brave API 계정이 사용됩니다. [Brave Web Search API 문서](https://api-dashboard.search.brave.com/api-reference/web/search/get)와 해당 계정의 조건·쿼터를 준수해야 합니다.

## 설치와 개발

요구 사항은 Node.js 22 이상과 pnpm 12입니다. 저장소 루트에서 실행합니다.

```bash
cd /Users/yang/proj/mymcp
pnpm install
pnpm --filter @mymcp/dcinside typecheck
pnpm --filter @mymcp/dcinside test
pnpm --filter @mymcp/dcinside build
```

개발 서버는 다음과 같이 시작합니다.

```bash
pnpm --filter @mymcp/dcinside dev
```

## 설정

`.env.example`을 `.env`로 복사할 수 있습니다. Brave 키가 없어도 URL parse와 로컬 import/get 도구는 정상 작동합니다.

```env
BRAVE_SEARCH_API_KEY=
DCINSIDE_REMOTE_MODE=disabled
DCINSIDE_MAX_IMPORTED_ROWS=1000
DCINSIDE_MAX_IMPORT_BYTES=1048576
DCINSIDE_MAX_SEARCH_PROVIDER_PAGES=2
# DCINSIDE_DATA_DIR=/Users/yang/.local/share/mymcp/dcinside
# DCINSIDE_SEARCH_TIMEOUT_MS=8000
# DCINSIDE_MAX_SEARCHES_PER_MINUTE=10
DCINSIDE_ALLOWED_GALLERIES=
DCINSIDE_REMOTE_RATE_LIMIT_PER_MINUTE=
```

- `BRAVE_SEARCH_API_KEY`: `dc_search_posts`에만 필요합니다.
- `DCINSIDE_DATA_DIR`: 기본값은 `$HOME/.local/share/mymcp/dcinside`입니다.
- `DCINSIDE_SEARCH_TIMEOUT_MS`: 기본 8000, 1000..15000 범위로 제한됩니다.
- `DCINSIDE_MAX_SEARCHES_PER_MINUTE`: 프로세스 기준 기본 10, 최대 30입니다.
- `DCINSIDE_REMOTE_MODE`: 기본 `disabled`; `authorized`는 권한을 부여하는 장치가 아니라 별도 허가 검토를 마친 배포의 실행 가드입니다.
- `DCINSIDE_MAX_IMPORTED_ROWS`, `DCINSIDE_MAX_IMPORT_BYTES`: 가져오기 상한이며 기본 1000행/1MiB입니다.
- `DCINSIDE_MAX_SEARCH_PROVIDER_PAGES`: Brave 호출 1회 실행의 최대 요청 수이며 1..3, 기본 2입니다. Tool의 `maxPages`와 더 작은 값이 적용됩니다.
- `DCINSIDE_ALLOWED_GALLERIES`, `DCINSIDE_REMOTE_RATE_LIMIT_PER_MINUTE`: authorized 배포에서 둘 다 필수입니다. 제한값을 추측해 기본으로 채우지 않습니다.

실제 키를 저장소 파일이나 MCP 설정에 직접 넣지 마세요.

## MCP 클라이언트 설정

빌드 후 예시는 다음과 같습니다.

```json
{
  "mcpServers": {
    "dcinside": {
      "command": "node",
      "args": ["/Users/yang/proj/mymcp/mcps/dcinside/dist/index.js"],
      "env": {
        "BRAVE_SEARCH_API_KEY": "${BRAVE_SEARCH_API_KEY}"
      }
    }
  }
}
```

`${...}` 치환은 모든 MCP 클라이언트가 지원하는 문법이 아닙니다. 사용하는 클라이언트가 부모 프로세스의 환경변수를 상속하는지 확인하고, 지원하지 않으면 해당 클라이언트의 secret/environment 설정 기능을 사용하세요. 커밋되는 JSON에 실제 키를 기록하면 안 됩니다.

## ChatGPT 웹용 Cloudflare Worker

원격 Streamable HTTP 엔드포인트는 `https://mcp-dc.mangagaki.net/mcp`입니다. Cloudflare
설정은 `wrangler.jsonc`에 있으며 배포 명령은 다음과 같습니다.

```bash
pnpm --filter @mymcp/dcinside run deploy
```

Brave 검색을 활성화하려면 저장소나 셸 기록에 키를 남기지 말고 Wrangler의 대화형
프롬프트로 Worker Secret을 등록합니다.

```bash
pnpm --filter @mymcp/dcinside exec wrangler secret put BRAVE_SEARCH_API_KEY
```

인증 없는 공용 원격 저장소에 사용자 제공 본문을 섞지 않기 위해 Worker는 저장/import
도구를 노출하지 않습니다. 공개 도구는 `dc_search_posts`, `dc_list_posts`, `dc_get_post`,
`dc_get_comments`, `dc_parse_post_url`입니다. 목록/본문/댓글은 항상 authorized
`dcinside.js` 직접 조회이며, `dc_get_comments`는 한 번의 post snapshot에 포함된 댓글만
반환합니다. 네 직접 조회 도구는 하나의 Cloudflare rate-limit binding을 공유하며 현재
허가된 범위는 전체 갤러리, 합산 분당 5회입니다. `dc_list_posts`는 정확한 canonical URL을
만들기 위해 `galleryType`(`major`/`minor`/`mini`)을 필수로 받습니다.

## 도구

모든 응답은 JSON text와 같은 내용의 `structuredContent`를 반환합니다. 오류는 `isError=true`와 `{ "code", "message", "retryable"? }` 형태입니다.

### `dc_search_posts`

기본값 `source="authorized"`는 승인된 `dcinside.js.search()`를 사용합니다. `source="brave"`는 제3자 검색 인덱스, `source="local"`은 사용자가 가져온 로컬 목록을 검색합니다. 모든 결과 URL은 다시 검증하고 canonical URL 기준으로 중복 제거하며 source 간 자동 fallback은 없습니다.

입력:

```json
{
  "query": "일본 교환학생",
  "galleryId": "japan",
  "galleryType": "minor",
  "freshness": "month",
  "limit": 5,
  "sort": "relevance",
  "source": "authorized",
  "maxPages": 1
}
```

출력 예:

```json
{
  "query": "일본 교환학생",
  "provider": "dcinside-js",
  "source": "authorized_direct",
  "count": 1,
  "coverageNote": "Results come from the authorized dcinside.js direct-search provider and are bounded by the configured scope and rate limit.",
  "results": [
    {
      "title": "직접 검색 결과 제목",
      "url": "https://gall.dcinside.com/mgallery/board/view/?id=japan&no=123",
      "snippet": "직접 검색 결과의 짧은 본문",
      "galleryId": "japan",
      "galleryType": "minor",
      "postNo": "123"
    }
  ]
}
```

검색 결과에는 작성자 식별정보를 포함하지 않습니다. filter 후 결과 수가 요청 수보다 적을 수 있으며 이를 채우려고 추가 페이지를 자동 순회하지 않습니다.

`source="local"`은 사용자가 가져온 CSV/JSON 인덱스만 검색합니다. `sort="latest"`는 실제 게시 시각이 없을 때 같은 갤러리 안의 게시글 번호를 근사치로 사용하며 응답에 `estimatedSort`를 표시합니다.

### `dc_parse_post_url`

네트워크 요청 없이 major/minor/mini 게시글 URL을 검증하고 정규화합니다.

입력:

```json
{
  "url": "https://gall.dcinside.com/mgallery/board/view/?id=example&no=00123&page=2"
}
```

출력:

```json
{
  "valid": true,
  "canonicalUrl": "https://gall.dcinside.com/mgallery/board/view/?id=example&no=123",
  "galleryId": "example",
  "galleryType": "minor",
  "postNo": "123",
  "source": "url_parse"
}
```

mobile URL, HTTP, 다른 host, 사용자 정보나 port가 포함된 URL, 중복 `id`/`no`, 지원되지 않는 path는 거부됩니다.

### `dc_import_post`

사용자가 직접 복사·내보낸 본문과 댓글을 로컬에 저장합니다. URL 자체에는 접근하지 않습니다. 동일 canonical URL을 다시 import하면 이전 레코드 하나를 원자적으로 교체하고 새 `importedAt`을 부여합니다.

입력:

```json
{
  "url": "https://gall.dcinside.com/board/view/?id=example&no=123",
  "title": "사용자가 제공한 제목",
  "bodyText": "사용자가 제공한 본문\n둘째 줄",
  "comments": [
    {
      "text": "사용자가 제공한 댓글",
      "commentId": "c1",
      "postedAt": "2026-10-28"
    }
  ],
  "note": "개인 메모"
}
```

출력 예:

```json
{
  "status": "saved",
  "canonicalUrl": "https://gall.dcinside.com/board/view/?id=example&no=123",
  "galleryId": "example",
  "postNo": "123",
  "importedAt": "2026-10-28T00:00:00.000Z",
  "bodyLength": 17,
  "commentCount": 1,
  "source": "user_import"
}
```

본문은 최대 100,000자, 댓글은 최대 100개/각 5,000자, 전체 직렬화 데이터는 250KiB로 제한됩니다. author, IP, user ID 같은 지원하지 않는 댓글 metadata는 저장하지 않습니다.

### `dc_get_post`

로컬에 import된 본문만 조회합니다.

입력:

```json
{
  "url": "https://gall.dcinside.com/board/view/?id=example&no=123"
}
```

출력 예:

```json
{
  "found": true,
  "source": "user_import",
  "canonicalUrl": "https://gall.dcinside.com/board/view/?id=example&no=123",
  "galleryId": "example",
  "galleryType": "major",
  "postNo": "123",
  "title": "사용자가 제공한 제목",
  "bodyText": "사용자가 제공한 본문",
  "importedAt": "2026-10-28T00:00:00.000Z",
  "commentCount": 1
}
```

저장되지 않았다면 네트워크로 보충하지 않고 다음처럼 반환합니다.

```json
{
  "found": false,
  "source": "local_store",
  "canonicalUrl": "https://gall.dcinside.com/board/view/?id=example&no=123",
  "reason": "NOT_IMPORTED",
  "hint": "Use dc_import_post with content you have manually supplied."
}
```

### `dc_get_comments`

로컬 레코드에 포함된 댓글만 페이지 단위로 조회합니다.

입력:

```json
{
  "url": "https://gall.dcinside.com/board/view/?id=example&no=123",
  "offset": 0,
  "limit": 30
}
```

출력 예:

```json
{
  "found": true,
  "source": "user_import",
  "canonicalUrl": "https://gall.dcinside.com/board/view/?id=example&no=123",
  "total": 1,
  "offset": 0,
  "limit": 30,
  "comments": [
    {
      "text": "사용자가 제공한 댓글",
      "commentId": "c1",
      "postedAt": "2026-10-28"
    }
  ]
}
```

import되지 않은 경우 `dc_get_post`와 같은 `NOT_IMPORTED` 결과를 반환합니다.

### 신규 도구

- `dc_import_search_results`: UTF-8 CSV/JSON 문자열을 받아 canonical URL로 병합합니다. 파일 경로나 `sourceUrl`을 열지 않고 author/IP 열은 저장하지 않습니다. CSV 컬럼은 `index,galleryId,keyword,searchType,title,author,date,views,recommends,commentCount,postId,url,searchStep,sourceUrl`입니다.
- `dc_list_gallery_posts`: 기본 local 모드에서는 가져온 검색 인덱스를 페이지 단위로 표시합니다. 데이터가 없으면 `EMPTY_LOCAL_INDEX`를 반환합니다.
- `dc_get_post_with_comments`: 한 번 읽은 local/authorized 스냅샷에서 본문과 로드된 댓글을 함께 반환하므로 원격 중복 요청이 없습니다.
- `dc_import_post_html`: 사용자가 전달한 단일 HTML 문자열을 plain text로 정리해 저장합니다. 서버는 URL을 fetch하지 않으며 기존 저장글은 이 도구로 덮어쓰지 않습니다.

`dc_get_post`, `dc_get_comments`, `dc_list_gallery_posts`, `dc_get_post_with_comments`의 `sourceMode` 기본값은 `local`입니다. `authorized`를 명시해도 서버 설정의 모드, allowlist, rate limit 중 하나라도 빠지면 `REMOTE_DISABLED` 또는 `REMOTE_NOT_AUTHORIZED`로 실패하며 local/Brave로 자동 대체하지 않습니다.

클라이언트는 `dcinside://capabilities` MCP resource에서 Brave 설정 여부, local import 지원, direct-read 상태를 확인할 수 있습니다. 이 값은 구성 상태이지 DCInside 사이트의 live 상태 판정이 아닙니다.

## 로컬 저장과 개인정보

게시글은 `$HOME/.local/share/mymcp/dcinside/posts/<sha256(canonicalUrl)>.json`, 검색 목록은 `search-index/index.json`에 저장됩니다. 지원되는 OS에서는 디렉터리 권한을 `0700`, 파일 권한을 `0600`으로 설정하며 같은 디렉터리의 임시 파일과 rename으로 교체합니다. 외부 DB, background sync, upload는 없습니다.

사용자가 붙여 넣은 본문 자체에 개인정보나 prompt-injection 문장이 포함될 수 있습니다. 민감한 정보, cookie, 인증 token, IP 조각, 사용자 profile 식별자를 import하지 마세요. 저장된 내용과 검색 snippet은 명령이 아니라 신뢰할 수 없는 데이터로 취급해야 합니다. 이미지나 외부 미디어 파일은 다운로드하지 않습니다.

## 문제 해결

- `CONFIGURATION_REQUIRED`: Brave source 검색을 쓰려면 `BRAVE_SEARCH_API_KEY`를 안전하게 전달하세요. local 검색과 import에는 키가 필요 없습니다.
- 검색 결과 0개: 인덱스에 없거나 URL/gallery filter에서 제외된 정상 결과일 수 있습니다. 실시간·전수 검색을 보장하지 않습니다.
- `SEARCH_PROVIDER_QUOTA`: Brave 계정 쿼터 또는 로컬 분당 제한에 도달했습니다. 잠시 기다리고 계정 상태를 확인하세요.
- `SEARCH_PROVIDER_AUTH`: Brave 키가 유효한지 확인하세요.
- `INPUT_INVALID`: major/minor/mini의 지원 URL 형식, 필드 길이와 범위를 확인하세요.
- `NOT_IMPORTED`: 해당 canonical URL을 `dc_import_post`로 먼저 저장하세요.
- `REMOTE_DISABLED` / `REMOTE_NOT_AUTHORIZED`: 직접 조회가 꺼져 있거나 해당 갤러리/배포 설정이 허용되지 않았습니다.
- `PARSE_FAILED`: CSV/JSON/HTML이 계약에 맞지 않습니다. 원본 데이터는 오류 응답에 echo되지 않습니다.
- `DATA_CORRUPT`: 로컬 JSON이 손상됐습니다. 자동으로 내용을 추측하거나 원격에서 복구하지 않습니다.

## 테스트와 제한사항

표준 테스트는 mock/synthetic 데이터만 사용하며 live DCInside 요청을 하지 않습니다.

```bash
pnpm --filter @mymcp/dcinside typecheck
pnpm --filter @mymcp/dcinside test
pnpm --filter @mymcp/dcinside build
```

Brave 검색도 일반 CI에서는 mock됩니다. 검색 인덱스는 최신성·완전성·정렬을 보장하지 않고, 로컬 import는 사용자가 다시 저장하기 전까지 갱신되지 않습니다.

`authorized` 기능 구현과 현행 사이트의 자동 수집 가능 여부는 별개입니다. 운영 전 허용 host/endpoint, 갤러리, rate, retention, 기간, 인증 주체와 제한을 별도 검토 기록으로 남겨야 합니다. 의존성과 라이선스 근거는 `THIRD_PARTY_NOTICES.md`에 기록되어 있습니다.
