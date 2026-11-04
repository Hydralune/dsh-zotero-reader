# Changelog

## 0.4.0 — 2026-11-04

- Add one-click full-paper analysis with an editable general academic prompt, persistent custom shortcut (default Alt+Shift+S), the original PDF and all-page context.
- Include local PDF paths, Zotero identifiers, document coordinates and complete source paragraphs in text/image references and direct explanations.
- Preserve text and screenshot selections through scrolling, restore offscreen controls and clear pending references on explicit cancellation.
- Keep image context menus and outlines stable on the first right click, follow their source image and preserve selection after copying/downloading.
- Limit text screenshot rendering to selected content, coalesce interaction updates and prevent duplicate outer scrolling.
- Recover malformed/truncated page translations, retry missing blocks and resume partial results.
- Unify PDF/text translation cards with full-width text, a separate close-button header, responsive bounds and scrollable long translations.


## 0.3.0 — 2026-11-04

First GitHub release of the Hydralune-maintained Zotero reader variant.

- PDF and continuous text views with double-click navigation and brief location feedback.
- Collapsible Zotero folders, current-paper selection, PDF import, outline and thumbnails.
- Independent PDF/text marks, Markdown formatting, font scaling and page-oriented bilingual translation.
- PyMuPDF plus cached MinerU page/full-document enhancement, cancellation and closable progress.
- Unified SVG controls, text-image context actions and PDF/text screenshot selection.
- Sparkle actions submit explanation requests independently of the current draft; quote actions prepare references.
- Provisional and confirmed reference strips, grouped screenshots, and composer-placeholder compatibility fixes.
- First-use setup guidance, local API preferences and optional parser/translation environments.

Parser accuracy remains document-dependent. Explanation integration has contract and simulated browser coverage; provider behavior must be checked in the installed DSH environment.
