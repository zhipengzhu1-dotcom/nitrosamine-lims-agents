# Report PDF fonts

The issued Test Report PDF embeds these fonts, subset again to the glyphs each report uses, so a Chinese or Vietnamese name prints instead of throwing.

| File | Font | Version | SHA-256 |
| --- | --- | --- | --- |
| `NotoSansSC-Regular.ttf` | Noto Sans SC Regular, subset | 2.004-H2 | `d2608d7e1a62adade06a97e5ca224f4c03ea00933d2088ebe6881bbfb589e22d` |
| `NotoSansSC-Bold.ttf` | Noto Sans SC Bold, subset | 2.004-H2 | `8659af5678a3f50cc95bc2195a8623579a521247d144ea383886b3db1bd3636e` |

- **Source.** The static TrueType instances Google Fonts serves for Noto Sans SC, from the npm package `@expo-google-fonts/noto-sans-sc@0.4.3`. Upstream: <https://fonts.google.com/noto/specimen/Noto+Sans+SC> and <https://github.com/notofonts/noto-cjk>.

  | Source file in the package | SHA-256 |
  | --- | --- |
  | `400Regular/NotoSansSC_400Regular.ttf` | `d45f67f0a7c0ca3f256950777ce6a61cc7ce5f9696d02900cbbaac25f8aa7d16` |
  | `700Bold/NotoSansSC_700Bold.ttf` | `9a38ae0ab28cd5a256f9ea8e00dedc688aac17f7915fcb000572990afa956b96` |

- **Subsetting.** `subset.py` fetches the package, checks the source hashes, and subsets each font with fonttools 4.64.0 to Basic Latin, Latin-1, Latin Extended-A and -B, the combining marks and Latin Extended Additional (for Vietnamese), General Punctuation, CJK Symbols and Punctuation, the Halfwidth and Fullwidth Forms, and the 6,763 hanzi of GB 2312. It keeps the source's timestamps, so a rerun reproduces the hashes above. Run `python3 apps/api/assets/fonts/subset.py`.
- **Licence.** SIL Open Font License 1.1, Copyright 2014-2021 Adobe, with Reserved Font Name 'Source'. The full text is `OFL.txt`, copied from the package's `LICENSE_FONT`. The OFL allows subsetting the fonts and embedding them in documents.
- **Coverage.** Anything outside those ranges, such as a hanzi beyond GB 2312, kana, Hangul, Greek or Cyrillic, has no glyph.
- **Changing them.** The bytes of an issued PDF depend on these files, and its SHA-256 is recorded with the Released signature. A font change changes the renderer, so it ships only in a new release, whose `LIMS_RELEASE` each `report_issue.renderer_release` records.
