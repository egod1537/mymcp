# @mymcp/dcinside

DCInside 관련 링크를 제3자 검색 인덱스에서 찾고, DCInside 게시글 URL을 로컬에서 검증하며, 사용자가 직접 제공한 게시글·댓글을 로컬 파일에 저장하고 조회하는 stdio MCP 서버입니다.

이 서버는 DCInside를 직접 크롤링하지 않습니다. 갤러리 목록, 게시글 본문, 댓글 endpoint에 요청하지 않으며 로그인, 글쓰기, 추천, 삭제, CAPTCHA 우회, proxy 회전, 대량 보관 기능도 없습니다.

## 데이터 출처와 준수 사항

- 검색 결과는 Brave Web Search API가 이미 인덱싱한 링크·제목·짧은 snippet입니다. 실시간 피드가 아니며 오래되거나 불완전하고 시간순이 아닐 수 있습니다.
- 게시글 본문과 댓글은 사용자가 `dc_import_post`로 명시적으로 공급한 데이터만 제공합니다. 자동 갱신되지 않습니다.
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
# DCINSIDE_DATA_DIR=/Users/yang/.local/share/mymcp/dcinside
# DCINSIDE_SEARCH_TIMEOUT_MS=8000
# DCINSIDE_MAX_SEARCHES_PER_MINUTE=10
```

- `BRAVE_SEARCH_API_KEY`: `dc_search_posts`에만 필요합니다.
- `DCINSIDE_DATA_DIR`: 기본값은 `$HOME/.local/share/mymcp/dcinside`입니다.
- `DCINSIDE_SEARCH_TIMEOUT_MS`: 기본 8000, 1000..15000 범위로 제한됩니다.
- `DCINSIDE_MAX_SEARCHES_PER_MINUTE`: 프로세스 기준 기본 10, 최대 30입니다.

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

## 도구

모든 응답은 JSON text와 같은 내용의 `structuredContent`를 반환합니다. 오류는 `isError=true`와 `{ "code", "message", "retryable"? }` 형태입니다.

### `dc_search_posts`

Brave의 제3자 검색 인덱스를 검색합니다. 응답 URL은 지원되는 DCInside 게시글 URL만 남도록 다시 검증되고 canonical URL 기준으로 중복 제거됩니다.

입력:

```json
{
  "query": "일본 교환학생",
  "galleryId": "japan",
  "galleryType": "minor",
  "freshness": "month",
  "limit": 5
}
```

출력 예:

```json
{
  "query": "일본 교환학생",
  "provider": "brave",
  "source": "search_index",
  "count": 1,
  "coverageNote": "Results come from a third-party search index and may be stale, incomplete, or not chronological.",
  "results": [
    {
      "title": "검색 인덱스의 제목",
      "url": "https://gall.dcinside.com/mgallery/board/view/?id=japan&no=123",
      "snippet": "검색 인덱스의 짧은 snippet",
      "galleryId": "japan",
      "galleryType": "minor",
      "postNo": "123"
    }
  ]
}
```

본문, 작성자, 조회수, 추천수, 실시간 댓글 수를 가져오지 않습니다. filter 후 결과 수가 요청 수보다 적을 수 있으며 이를 채우려고 추가 크롤링하지 않습니다.

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

## 로컬 저장과 개인정보

레코드는 기본적으로 `$HOME/.local/share/mymcp/dcinside/posts/<sha256(canonicalUrl)>.json`에 저장됩니다. 지원되는 OS에서는 디렉터리 권한을 `0700`, 파일 권한을 `0600`으로 설정하며 같은 디렉터리의 임시 파일과 rename으로 교체합니다. 외부 DB, background indexing, upload는 없습니다.

사용자가 붙여 넣은 본문 자체에 개인정보나 prompt-injection 문장이 포함될 수 있습니다. 민감한 정보, cookie, 인증 token, IP 조각, 사용자 profile 식별자를 import하지 마세요. 저장된 내용과 검색 snippet은 명령이 아니라 신뢰할 수 없는 데이터로 취급해야 합니다. 이미지나 외부 미디어 파일은 다운로드하지 않습니다.

## 문제 해결

- `CONFIGURATION_REQUIRED`: `dc_search_posts`를 쓰려면 `BRAVE_SEARCH_API_KEY`를 안전하게 전달하세요. 다른 네 도구에는 키가 필요 없습니다.
- 검색 결과 0개: 인덱스에 없거나 URL/gallery filter에서 제외된 정상 결과일 수 있습니다. 실시간·전수 검색을 보장하지 않습니다.
- `SEARCH_PROVIDER_QUOTA`: Brave 계정 쿼터 또는 로컬 분당 제한에 도달했습니다. 잠시 기다리고 계정 상태를 확인하세요.
- `SEARCH_PROVIDER_AUTH`: Brave 키가 유효한지 확인하세요.
- `INPUT_INVALID`: major/minor/mini의 지원 URL 형식, 필드 길이와 범위를 확인하세요.
- `NOT_IMPORTED`: 해당 canonical URL을 `dc_import_post`로 먼저 저장하세요.
- `DATA_CORRUPT`: 로컬 JSON이 손상됐습니다. 자동으로 내용을 추측하거나 원격에서 복구하지 않습니다.

## 테스트와 제한사항

표준 테스트는 mock/synthetic 데이터만 사용하며 live DCInside 요청을 하지 않습니다.

```bash
pnpm --filter @mymcp/dcinside typecheck
pnpm --filter @mymcp/dcinside test
pnpm --filter @mymcp/dcinside build
```

Brave 검색도 일반 CI에서는 mock됩니다. 검색 인덱스는 최신성·완전성·정렬을 보장하지 않고, 로컬 import는 사용자가 다시 저장하기 전까지 갱신되지 않습니다.

향후 DCInside 또는 다른 데이터 소스로부터 서면 허가나 공식 API 계약을 얻더라도, P0의 환경변수 하나로 직접 수집을 활성화해서는 안 됩니다. 허용 host/endpoint, rate, retention, 기간, 인증 주체와 제한을 별도 설계 검토에 기록한 뒤 독립 provider로 추가해야 합니다.
