# Japanese Vocab MCP

Personal Japanese vocabulary storage, daily distribution, search, and standalone HTML flashcard generation. User-provided spelling, reading, Korean meaning, nuance, and source metadata remain the source of truth; this server does not replace them with an external dictionary.

The package is an independent MCP server in the `mymcp` pnpm workspace.

## Installation

Requirements:

- Node.js 22.5 or newer (`node:sqlite`)
- pnpm

From the repository root:

```bash
pnpm install
cp mcps/jlpt/.env.example mcps/jlpt/.env
```

Environment variables:

```env
JAPANESE_VOCAB_DB_PATH=./data/vocab.db
JAPANESE_VOCAB_DEFAULT_DAILY_COUNT=14
LOG_LEVEL=info
```

Relative DB paths are resolved from `mcps/jlpt`, even when the compiled server is launched from the repository root.

## Database

The default database is:

```text
mcps/jlpt/data/vocab.db
```

SQLite tables:

- `words`: vocabulary, normalized comparison fields, source metadata, and distribution state
- `distribution_batches`: daily batch metadata and the filter key used for same-day reuse
- `distribution_batch_items`: stable word order within each batch

The DB file, WAL, and shared-memory files are ignored by Git. Stop the MCP process or use SQLite's backup facilities before copying an actively written WAL database. For a stopped local server:

```bash
mkdir -p backup
cp mcps/jlpt/data/vocab.db backup/vocab-$(date +%F).db
```

## Development

```bash
pnpm dev:japanese-vocab
pnpm build:japanese-vocab
pnpm test:japanese-vocab
pnpm --filter @mymcp/japanese-vocab typecheck
```

Or from `mcps/jlpt`:

```bash
pnpm dev
pnpm build
pnpm test
```

Run the compiled stdio server:

```bash
node mcps/jlpt/dist/index.js
```

## MCP client configuration

Build first, then use an absolute path:

```json
{
  "mcpServers": {
    "japanese-vocab": {
      "command": "node",
      "args": ["/absolute/path/to/mymcp/mcps/jlpt/dist/index.js"],
      "env": {
        "JAPANESE_VOCAB_DB_PATH": "./data/vocab.db"
      }
    }
  }
}
```

## Remote API MCP

The package also contains a Cloudflare Worker that exposes the live
`https://jlpt.mangagaki.net` REST API as a Streamable HTTP MCP server. The local SQLite stdio
server above remains unchanged and compatible with existing clients.

The deployed endpoint is:

```text
https://mcp-jlpt.mangagaki.net/mcp
```

Remote tools:

- `jlpt_list_books`: list live vocabulary books with bounded pagination.
- `jlpt_list_folders`: list folders and their hierarchy metadata.
- `jlpt_get_book_entries`: read one page of words from a selected book.
- `jlpt_search`: search live book titles or vocabulary fields.
- `jlpt_get_study_cards`: get a read-only study selection without recording a review.
- `jlpt_create_folder`: create a top-level or nested folder.
- `jlpt_update_folder`: rename, move, or pin an existing folder.
- `jlpt_delete_folder`: move a folder to trash while preserving or trashing its contents.
- `jlpt_create_book`: create an empty book, optionally in a selected folder.
- `jlpt_update_book`: change a book's title, category, favorite state, or folder.
- `jlpt_delete_book`: move a book to trash.
- `jlpt_add_words`: append up to 200 structured words to an existing book.
- `jlpt_update_word`: edit an existing entry while preserving unspecified vocabulary fields.
- `jlpt_delete_word`: move one vocabulary entry to trash.
- `jlpt_move_books`: move up to 50 books into a folder or back to the unfiled area.
- `jlpt_import_words`: preview and commit a new book from structured words. The deployed MCP
  enables this tool; every call requires `confirm=true` and passes through the dedicated write
  rate-limit binding.

The Worker allows only `https://jlpt.mangagaki.net` as its upstream origin, applies a 10-second
timeout, validates every tool input, and returns a reduced normalized record instead of echoing
the complete upstream payload. Live vocabulary text is untrusted data, not instructions.

The deployed MCP enables organization and import writes with `JLPT_ENABLE_WRITES=true`. Write tool
calls are limited to five per minute in addition to the overall MCP limit of 60 calls per minute.
Set the flag to `false` to remove all write tools from the advertised MCP tool list and return the
deployment to read-only mode.

Deploy or run the Worker locally:

```bash
pnpm --filter @mymcp/japanese-vocab dev:worker
pnpm --filter @mymcp/japanese-vocab deploy
```

## Tools

### `import_word_list`

Stores text, TSV, CSV, Markdown-table, or JSON vocabulary. Exact duplicates are skipped by default. A row with the same Japanese spelling, reading, and nuance but a different Korean meaning is returned as a conflict and is not overwritten.

```json
{
  "text": "訴える｜要求・主張    うったえる    호소하다, 주장하다\n訴える｜法的対応    うったえる    고소하다",
  "sourceCategory": "언지",
  "sourceSet": "2026-10 2주차 언지 단어장",
  "duplicatePolicy": "skip"
}
```

Representative output:

```json
{
  "imported": 2,
  "skippedDuplicates": 0,
  "conflicts": 0,
  "words": [
    {
      "id": "generated-uuid",
      "jp": "訴える",
      "reading": "うったえる",
      "meaningKo": "호소하다, 주장하다",
      "nuance": "要求・主張",
      "sourceCategory": "언지",
      "sourceSet": "2026-10 2주차 언지 단어장",
      "sourceIndex": 1,
      "normalizedKey": "訴える|うったえる|要求・主張",
      "status": "unseen",
      "importedAt": "2026-10-06T12:00:00.000+09:00"
    }
  ]
}
```

The actual `words` array contains the complete inserted records and UUIDs.

### `get_daily_words`

Returns unseen vocabulary and normally marks it distributed.

```json
{
  "count": 14,
  "sourceCategory": "언지",
  "strategy": "oldest_first",
  "reuseToday": true
}
```

Output includes `batchId`, local date, words, remaining unseen count, and `reusedBatch`.

### `get_words`

Lists words by source category, source set, or `unseen`/`distributed` status with limit and offset pagination.

### `search_words`

Searches Japanese spelling, reading, Korean meaning, nuance, source category, and source set. The `fields` input can restrict the search.

### `get_distribution_history`

Returns batch words grouped by date, optionally filtered by date range or source metadata.

### `reset_distribution`

Resets selected distributed words to unseen. It requires word IDs, a source filter, or explicit `all=true`. `all=true` cannot be combined with narrower filters and should only be used after an explicit user request.

### `generate_flashcard_html`

Generates HTML from exactly one source:

- `wordIds`
- `sourceCategory` and/or `sourceSet`
- directly provided `words`

```json
{
  "sourceSet": "2026-10 2주차 언지 단어장",
  "title": "2026-10 2주차 언지 단어장",
  "shuffleOnStart": true
}
```

Output:

```json
{
  "filename": "2026-10-2주차-언지-단어장.html",
  "cardCount": 14,
  "html": "<!DOCTYPE html>..."
}
```

Save the returned `html` string using the returned filename, then open it directly in a browser.

### `create_daily_flashcard`

Creates or reuses today's matching batch and returns a ready-to-save standalone HTML page in one call. The filename is `japanese-vocab-YYYY-MM-DD.html`.

## Input formats

Whitespace/TSV:

```text
素朴な    そぼくな    소박한
訴える｜요구·주장    うったえる    호소하다, 주장하다
```

CSV:

```csv
jp,reading,meaningKo,nuance
訴える,うったえる,고소하다,법적 대응
```

Markdown:

```markdown
| jp | reading | meaningKo | nuance |
| --- | --- | --- | --- |
| 滞る | とどこおる | 밀리다, 체납되다 | 支払い・家賃 |
```

JSON:

```json
[
  {
    "jp": "遂行",
    "reading": "すいこう",
    "meaningKo": "수행"
  }
]
```

Use `｜` after the Japanese expression to encode nuance inline. Nuance creates a separate sense/card and remains visible on the flashcard; it is not a hidden hint.

## Duplicate policy

Comparison uses normalized formatting while preserving display text:

1. Japanese spelling
2. reading
3. nuance, including both absent
4. Korean meaning

Different nuances remain separate cards. Same spelling/reading/nuance with a changed meaning is a conflict. Policies:

- `skip`: skip exact duplicates
- `report`: skip and return the matching stored records
- `keep`: insert exact duplicates intentionally

Conflicts are never silently overwritten by any policy.

## Daily batch policy

- Default size: 14
- Default source: all unseen words
- Default strategy: `oldest_first`
- Other strategies: Fisher–Yates `random` and half-old/half-random `mixed`
- `reuseToday=true`: reuses the latest batch created today with the same count, source filters, exclusions, and strategy
- `forceNewBatch=true`: consumes a different unseen batch and should represent explicit user intent
- `markDistributed=false`: previews the selection without changing status or creating history

Source filters and exclusions are part of the batch identity, so an unfiltered daily batch is not reused for an “언지만” request.

## Generated HTML

The output is one standalone HTML file using Vanilla HTML, CSS, and JavaScript. Only optional Google Fonts require a network connection. It includes:

- Noto Sans JP/KR and the specified dark teal/orange/gold palette
- mobile 480px layout and safe-area padding
- timer, progress, remaining count, bookmark, infinite mode, and Japanese speech
- always-visible nuance
- independently toggled Korean and hiragana hints
- hint reset before every swipe animation
- left swipe for “공부하겠음” and right swipe for “알고있음”
- primary “모르는 것만 다시” button when unknown cards exist
- secondary “처음부터 다시” button
- Fisher–Yates shuffle on normal round restarts

Vocabulary is embedded using escaped JSON. `<`, `>`, `&`, quotes, backticks, Unicode line separators, and `</script>` termination are neutralized. Runtime display uses `textContent`, not user-controlled `innerHTML`, and no `eval` is used.

## Tests

```bash
pnpm --filter @mymcp/japanese-vocab test
```

Tests cover parsing formats and nuances, duplicate/conflict rules, daily distribution, same-day reuse, forced batches, source filters, history/reset behavior, filename and script escaping, required DOM IDs, hint buttons, left/right swipes, completion, and unknown-only retry.

## Known limitations

- This is not a spaced-repetition scheduler; `unseen` and `distributed` are the only persistent learning states.
- It does not perform OCR or dictionary lookup.
- Duplicate meaning comparison is formatting-normalized exact comparison, not semantic or fuzzy dictionary matching.
- Daily dates use Korea/Japan UTC+09:00 and are not currently configurable.
- SQLite access is synchronous and intended for one personal MCP process, not a multi-replica service.
- `node:sqlite` can emit an experimental-feature warning on some supported Node 22/24 releases.
- The generated HTML is returned as MCP data; the stdio server does not write arbitrary output files.
- The remote MCP intentionally does not expose review mutations, trash restore or permanent purge,
  backup, or arbitrary sync mutations. Delete tools move entities to trash.
