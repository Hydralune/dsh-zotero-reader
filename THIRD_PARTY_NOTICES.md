# Third-party notices

The application uses the MIT license in [LICENSE](LICENSE). Original GGboya copyright and the Hydralune contribution notice are retained.

This repository builds on the DSH paper-reader plugin work by GGboya: https://github.com/GGboya/dsh-paper-reader . Selection geometry also references LightRead's line-fragment handling approach, as recorded in source comments.

## Distributed assets and bundled dependencies

| Component | License | Included notice |
| --- | --- | --- |
| PDF.js | Apache-2.0 | `vendor/LICENSE-pdfjs`; original asset headers retained |
| PDF CMaps | See Adobe notices | `vendor/LICENSE-cmaps` |
| KaTeX and its fonts | MIT | `vendor/LICENSE-katex` |
| markdown-it | MIT | `vendor/LICENSE-markdown-it` |
| html2canvas | MIT | `vendor/LICENSE-html2canvas` |
| linkify-it, mdurl, punycode.js, uc.micro | MIT | Corresponding `vendor/LICENSE-*` |
| entities | BSD-2-Clause | `vendor/LICENSE-entities` |
| css-line-break, text-segmentation, utrie, base64-arraybuffer | MIT | Corresponding `vendor/LICENSE-*` |

Bundled code retains license comments where supplied. Additional dependency notices, including argparse when present, are included in `vendor/`. React and DSH services are supplied by the production host; development preview bundles are excluded from the installable package.

## Optional external programs

PyMuPDF, MinerU, pdf2zh, their model weights and their transitive dependencies are installed separately by the user. They are not included in the archive. Their respective licenses and model/service terms apply to those independent installations.
