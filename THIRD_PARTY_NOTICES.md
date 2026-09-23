# Third-party notices

The Reelori source code is licensed under the MIT License in `LICENSE`.
Third-party components retain their own licenses and trademarks.

| Component | Use | License evidence |
| --- | --- | --- |
| React and React DOM | Application interface | MIT, dependency package license |
| Scheduler | React runtime scheduling | MIT, dependency package license |
| Phosphor Icons React | Interface icons | MIT, dependency package license |
| Noto Sans SC / Noto Serif SC | Bundled interface fonts | SIL Open Font License 1.1, font package licenses |
| Node.js | Bundled Windows runtime | Full upstream `runtime/LICENSE` is included in the Windows package |
| FFmpeg | User-provided Windows media tool | Not bundled in the Windows package |

The three example images under `public/assets/` were generated for this project
on 2026-09-22; see `docs/design/ASSET-PROVENANCE.md`. They are examples, not
proof that a model can reproduce a consistent character. FlowBarAI releases
these three example images under the project's MIT License. They do not depict
a real person or a third-party film still.

The Windows package includes the upstream license text for the bundled React,
React DOM, Scheduler, Phosphor Icons, and Noto font packages under
`licenses/npm/`. Its pinned Node.js runtime includes `runtime/LICENSE`.
`package-lock.json` records the full source-build dependency tree. A Docker
image that includes FFmpeg needs its own package and license inventory before
distribution.
