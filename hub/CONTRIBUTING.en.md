# Contributing

Thank you for helping. Chinese version: [CONTRIBUTING.md](CONTRIBUTING.md)

Three ground rules:
1. Never commit personal information: real names, shops, device names, addresses, chat logs, keys. Examples and
   demo data must be fictional.
2. Done means one command passes everything: `npm test` (offline, no keys needed).
3. Only submit what you have the right to redistribute. Character packs, images and fonts need a stated source
   and license; anything that cannot be redistributed is not accepted.

The license is in [LICENSE](../LICENSE) at the repo root. Issues, ideas, manuals and PRs are welcome.

## Four levels, small to large

### Level 1: manuals (one page of text, easiest)

A manual uses the DSH skill format: `defaults/manuals/<kebab-case-name>/SKILL.md`, with frontmatter holding
`name` (kebab-case) and `description` (one sentence, at most 80 characters). The body tells the assistant when to
use it, how to do it and how to report afterwards. Register it in `defaults/manifest.json`. Look at the existing six,
for example `defaults/manuals/use-board/SKILL.md`. (The existing manuals are in Chinese; English ones are welcome.)

### Level 2: character packs and skins

A character pack is an assistant's look; a skin is the UI colour scheme. The format design:
- Skin: `skins/<id>/skin.json`, only tokens (light and dark colour sets, corner radius, font name), no scripts or
  stylesheets.
- Character pack: `characters/<id>/character.json` with `name`, `license`, `attribution`, `redistributable`, and the
  file and size limit for each state (idle, thinking, working, done, confused). Packs with `redistributable: false`
  stay in your own run directory and are not accepted into the repository.

The loader is **not built yet**, so these two levels are design and asset contributions for now: please open an
issue to comment on the format. The formats carry `schema: 1`; changing them requires a version bump.

### Level 3: assistant templates

An assistant is one roster row (`defaults/bots.example.yaml`), one persona (`defaults/personas/<id>.md`, at most
900 characters, with `{{owner}}`, `{{bot_name}}`, `{{manuals}}` placeholders) and the manuals it carries. Keep it
generic: no specific people, shops or business terms. Read the existing chief, writer and research first.

### Level 4: code

- Zero dependencies: Node built-ins only (Node 22); no npm packages.
- Prefer new files and new functions that take directories and config as arguments; no default personal paths,
  device names or internal addresses in code.
- One comment line above each exported function; one statement per line, at most 120 columns.
- Changes come with tests, and tests write only to temporary directories.
- Scripts only simulate by default; acting for real needs an explicit `--apply` and an explicit target directory.

## Before you submit

```sh
npm test
```

A repository hygiene scan (`test/publish-scan.test.mjs`) checks for personal paths, internal addresses, key-like
strings and oversized files. Your change must not add new hits.

## Known failing older tests

On the author's machine these three already fail on the baseline (cause not yet investigated, not caused by recent
additions):
- `packages/hub-bff/test/r23.contract.test.mjs`: "目录不存在报 BOTS_DIR_MISSING ..."
- `packages/hub-web/test/c6-contract.test.mjs` (the whole file)
- `packages/hub-web/test/https-serve.test.mjs`: "HTTPS: Serve 写入必须已有有效 cookie ..."

If they pass or fail differently for you, please open an issue.

## Questions

Use the templates in `.github/ISSUE_TEMPLATE/`. Do not report security problems publicly; see
[SECURITY.md](SECURITY.md).
