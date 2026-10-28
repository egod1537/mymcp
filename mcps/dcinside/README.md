# @mymcp/dcinside

DCInside 공개 갤러리의 글 목록, 검색 결과, 본문과 댓글을 읽는 read-only MCP 서버다. `mymcp` pnpm workspace 안에서 독립 패키지와 독립 stdio 서버로 동작한다.

로그인, 글쓰기, 댓글 작성, 추천, CAPTCHA 우회 기능은 구현하지 않는다.

## Installation

요구 사항:

- Node.js 22.12 이상
- pnpm 12

저장소 루트에서 설치한다.

```bash
pnpm install
```

## Development

```bash
pnpm dev:dcinside
```

또는 패키지 디렉터리에서 독립 실행할 수 있다.

```bash
cd mcps/dcinside
pnpm dev
```

## Build

```bash
pnpm build:dcinside
node mcps/dcinside/dist/index.js
```

stdio에는 MCP 메시지만 기록하고 로그는 stderr로 출력한다.

## MCP 설정 예제

일반적인 stdio MCP Client 설정 예제다. 실제 절대 경로로 변경해야 한다.

```json
{
  "mcpServers": {
    "dcinside": {
      "command": "node",
      "args": ["/absolute/path/to/mymcp/mcps/dcinside/dist/index.js"],
      "env": {
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

## Gallery type 자동 탐지

Tool 호출자가 일반·마이너·미니 갤러리를 지정할 필요가 없다. 서버가 다음 순서로 실제 페이지를 확인하고 탐지 결과를 메모리에 캐시한다.

1. `/board/lists/`
2. `/mgallery/board/lists/`
3. `/mini/board/lists/`

게시글 URL을 전달하면 URL 경로에서 타입을 바로 판별한다.

## Tools

모든 Tool은 `readOnlyHint: true`다. `content.text`에는 JSON 문자열을, `structuredContent`에는 같은 구조의 JSON 객체를 반환한다.

### `get_gallery_posts`

특정 갤러리의 최근 글을 가져온다.

Input:

```json
{
  "galleryId": "foreign_university",
  "page": 1,
  "limit": 20
}
```

Output:

```json
{
  "galleryId": "foreign_university",
  "page": 1,
  "posts": [
    {
      "id": "1597028",
      "title": "게시글 제목",
      "author": "작성자 (1.2)",
      "date": "2026-10-06 12:00:00",
      "views": 100,
      "recommendations": 2,
      "comments": 3,
      "url": "https://gall.dcinside.com/...",
      "isNotice": false
    }
  ]
}
```

기본값은 `page=1`, `limit=20`이며 `limit` 최대값은 100이다.

### `search_gallery_posts`

갤러리 안에서 키워드를 검색한다. 숫자 페이지와 DCInside의 `search_pos` 검색 구간을 순서대로 탐색하고 ID가 같은 결과는 제거한다.

Input:

```json
{
  "galleryId": "foreign_university",
  "query": "오사카",
  "page": 1,
  "maxPages": 3,
  "searchTarget": "title_content"
}
```

Output:

```json
{
  "galleryId": "foreign_university",
  "query": "오사카",
  "posts": [
    {
      "id": "1597028",
      "title": "오사카 관련 글",
      "url": "https://gall.dcinside.com/..."
    }
  ]
}
```

`searchTarget`은 `title` 또는 `title_content`이며 기본값은 `title_content`다. `maxPages` 기본값은 3, 최대값은 10이다.

### `get_post`

게시글 본문을 사람이 읽을 수 있는 텍스트로 변환한다. 링크는 본문과 `links`에, 이미지·영상 주소는 본문과 `imageUrls`에 보존한다.

Input은 두 형식 중 하나를 사용한다.

```json
{
  "galleryId": "foreign_university",
  "postId": "1597028"
}
```

```json
{
  "url": "https://gall.dcinside.com/mgallery/board/view/?id=foreign_university&no=1597028"
}
```

Output:

```json
{
  "id": "1597028",
  "galleryId": "foreign_university",
  "title": "게시글 제목",
  "author": "작성자",
  "date": "2026-10-06 12:00:00",
  "views": 100,
  "recommendations": 2,
  "content": "정리된 본문 텍스트",
  "imageUrls": ["https://dcimg..."],
  "links": ["https://example.com"],
  "url": "https://gall.dcinside.com/..."
}
```

### `get_comments`

댓글과 답글을 가져온다. 기본적으로 최대 10페이지까지 읽으며 `maxPages`로 1~20 범위에서 제한할 수 있다.

Input:

```json
{
  "galleryId": "foreign_university",
  "postId": "1597028",
  "maxPages": 10
}
```

`get_post`와 마찬가지로 `url`만 전달할 수도 있다.

Output:

```json
{
  "comments": [
    {
      "id": "12345",
      "author": "댓글 작성자",
      "content": "댓글 내용",
      "date": "10.06 12:34:56",
      "depth": 1,
      "parentId": "12340",
      "isDeleted": false
    }
  ]
}
```

### `get_post_with_comments`

본문과 댓글을 한 번에 반환한다. 여러 검색 결과를 분석할 때 MCP 왕복 횟수를 줄이는 용도다.

Input:

```json
{
  "url": "https://gall.dcinside.com/mgallery/board/view/?id=foreign_university&no=1597028",
  "maxCommentPages": 10
}
```

Output:

```json
{
  "post": {
    "id": "1597028",
    "title": "게시글 제목",
    "content": "본문"
  },
  "comments": [
    {
      "id": "12345",
      "content": "댓글"
    }
  ]
}
```

## Configuration

`mcps/dcinside/.env.example`을 `.env`로 복사해 패키지별로 설정할 수 있다. 서버는 현재 작업 디렉터리와 무관하게 이 패키지의 `.env`를 읽는다.

```env
DC_REQUEST_INTERVAL_MS=800
DC_MAX_CONCURRENCY=2
DC_REQUEST_TIMEOUT_MS=10000
LOG_LEVEL=info
```

- 요청 시작 간 최소 간격: 기본 800ms
- 최대 동시 요청: 기본 2
- 요청 timeout: 기본 10초
- retry: 네트워크 오류, HTTP 408/429/5xx에만 최대 3회, 500/1000/2000ms backoff
- cache TTL: 갤러리 30초, 게시글 5분, 댓글 1분
- `LOG_LEVEL`: `debug`, `info`, `warn`, `error`, `silent`

debug 로그에는 Tool 이름, 요청 URL, HTTP 상태, 소요시간, parser 결과 건수와 retry 정보를 기록한다. 게시글 본문과 댓글 전문은 기록하지 않는다.

로그인 쿠키는 사용하지 않는다. 다만 실제 댓글 endpoint는 게시글 GET에서 발급한 익명 `PHPSESSID`와 토큰을 같은 요청 흐름에서 요구하므로, 프로세스 메모리 안에서 이 익명 세션 값만 임시로 전달한다.

## Tests

기본 테스트는 실제 사이트에 접근하지 않고 체크인된 gallery, search, post, comment fixture를 사용한다.

```bash
pnpm test
pnpm test:dcinside
```

실제 `list -> search -> post -> comments` 흐름은 명시적으로 활성화할 때만 실행한다.

```bash
RUN_LIVE_TESTS=1 pnpm --filter @mymcp/dcinside test
```

## Architecture

- `src/dcinside/`: HTTP client, 타입 탐지, domain logic, parser, types
- `src/tools/`: domain API를 MCP Tool로 노출
- `src/server.ts`: transport와 독립적인 MCP server 생성
- `src/index.ts`: stdio transport entrypoint
- `src/utils/`: rate limit, retry, cache, logger

향후 `createServer()`를 재사용하는 Streamable HTTP entrypoint를 별도로 추가할 수 있다. 다른 MCP package와 Tool을 하나의 서버에 합치지 않는다.

## Known limitations

- DCInside HTML과 댓글 endpoint에는 공개 안정성 계약이 없으므로 구조가 바뀌면 parser 수정이 필요하다.
- 삭제·성인·회원 전용·CAPTCHA·지역 제한 콘텐츠는 읽지 못할 수 있다.
- 검색 결과는 DCInside의 시점별 `search_pos` 구간에 의존한다.
- 댓글은 `maxPages` 제한을 넘으면 일부만 반환한다.
- 미디어 파일은 다운로드하지 않고 URL만 반환한다.
- 배포 서버 IP가 차단되거나 challenge를 받으면 upstream 오류를 반환한다. 차단 회피나 proxy rotation은 하지 않는다.
- DCInside 사용자 작성 내용은 신뢰할 수 없는 외부 데이터로 취급해야 한다.

## Remote MCP follow-up

현재 버전은 stdio 전용이다. ChatGPT Remote MCP 연결 단계에서는 `createServer()`를 재사용하는 Streamable HTTP entrypoint, `/dcinside/mcp` HTTPS endpoint, 배포 health check, 인증 정책, reverse proxy 스트리밍 설정과 추가 abuse control이 필요하다.
