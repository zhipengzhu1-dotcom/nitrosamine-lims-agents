# Japan (MHLW/PMDA) requirements beyond the FDA baseline

Research for [#27](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/27), part of map [#1](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/1). All sources were fetched on 2026-09-29. All products, batches and numbers in the examples are fictional.

The baselines are [`docs/research/part11.md`](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/blob/research/part11/docs/research/part11.md) (#2) and [`docs/research/nitrosamines.md`](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/blob/research/nitrosamines/docs/research/nitrosamines.md) (#4). This file lists **only what Japan adds or does differently**. Anything not mentioned here is covered by the baselines.

## Short answer

**Computerized systems and records.** If the LIMS is built to the Part 11 baseline plus its draft-Annex 11 superset, it already meets Japan's ER/ES guideline (電磁的記録・電子署名利用のための指針, 2005). In several places that guideline asks for *less* than Part 11: it has no two-component signature rule, no certification letter, and treats an audit trail only as "desirable". The real additions come from the 2021 GMP ordinance amendment and MHLW's GMP case book (GMP事例集):

1. **A fixed retention rule.** Keep records for 5 years from creation, or for the product's shelf life plus 1 year if that is longer ([GMP] Art. 20(1)(iii)). This settles open question 3 of the Part 11 baseline for Japanese Customers.
2. **A named data-integrity owner per record type** (あらかじめ指定した者, "person designated in advance"). Continuous checks that records are complete, accurate and consistent, with CAPA when a gap is found ([GMP] Art. 8(2), 20(2); [GMPN] §3 Art. 20).
3. **Keep paper originals.** A handwritten original stays on file even after it is scanned, unless four documented conditions are met ([JIREI] GMP20-3; [JIREI-S] 追補3).
4. **Automatic pass/fail is advisory only.** QA must make its own judgment (判定) ([JIREI] GMP20-11).
5. **Printed reports carry a signature or a printed name plus seal** (署名又は記名押印). An electronic report needs an ER/ES-compliant e-signature ([JIREI] GMP20-10).
6. **CSV lifecycle paperwork, named explicitly.** For category 5 (custom) software, the 2010 CSV guideline (コンピュータ化システム適正管理ガイドライン) lists every document: system inventory, management policy, URS/FS/DS, DQ/IQ/OQ/PQ, and a retirement plan ([CSV] §3–8, 別紙2).

Japan has been a PIC/S member since 1 July 2014. It uses PIC/S Annex 11 and PI 041 as reference texts, not as binding rules ([PICS-J]; [PICS-U]; [GMPN] §3-65). The EU work in the Part 11 baseline therefore already covers PIC/S alignment.

**Nitrosamines.** The framework is a self-inspection (自主点検) notification from 2021, not a guidance with rolling AI tables. The differences that change LIMS numbers are these:

1. **Different AIs for named nitrosamines.** The fixed 2021 table gives NMBA 96.0, NMPA 34.3, NIPEA 26.5, NDIPA 26.5, MeNP 26.5 and NMOR 127 ng/day. FDA gives 1500, 100, 400, 1500, 400 (MNP) and no value ([N1] 別添2(2)①). For NDIPA, the Japanese limit is **about 57× tighter** than FDA's.
2. **CPCA follows EMA, not FDA.** Category 1 is **18 ng/day**, not 26.5 ([NQA] A15; [EMA-CPCA] Table 1).
3. **No default AI** for an unlisted nitrosamine. The MAH must justify the limit and consult MHLW, unless it uses the CPCA ([N1] 別添2(2)②; [NPROC] 記1).
4. **The FDA "≤ 10 % of AI means no specification" shortcut does not apply.** A result below 10 % (or 30 % for skip testing) is not enough on its own ([NPROC-QA] No.1).
5. **Stability monitoring of nitrosamines** is expected for every product where one was detected, even without a specification ([NPROC-QA] No.4).
6. **Exceedances are reported "promptly"** to MHLW's 監視指導・麻薬対策課 (Compliance and Narcotics Division) with a defined content list ([NQA] A8, A12).
7. **No FDA-style less-than-lifetime factor.** Japan's nearest equivalent is an *interim control value* (暫定管理値), set only after consulting MHLW ([NQA] A16).

The Japanese Pharmacopoeia (JP19, in force 2026-04-10) has **no nitrosamine general test or reference-information chapter**. It points to ICH M7 as implemented in Japan ([JP19-GI] G0-3-181; [M7J]).

## Sources and revisions relied on

| Key | Document (Japanese title) | Notification number (通知番号) / date / status |
|---|---|---|
| ERES | 医薬品等の承認又は許可等に係る申請等における電磁的記録及び電子署名の利用について, with 別紙 「…電磁的記録・電子署名利用のための指針」 ([MHLW](https://www.mhlw.go.jp/web/t_doc?dataId=00ta8216&dataType=1&pageNo=1)) | 薬食発第0401022号, 2005-04-01. Applies to records submitted or kept from 2005-04-01 (§4) |
| CSV | 医薬品・医薬部外品製造販売業者等におけるコンピュータ化システム適正管理ガイドライン ([MHLW p.1](https://www.mhlw.go.jp/web/t_doc?dataId=00tb6573&dataType=1&pageNo=1), [p.2](https://www.mhlw.go.jp/web/t_doc?dataId=00tb6573&dataType=1&pageNo=2)) | 薬食監麻発1021第11号, 2010-10-21. Applied from 2012-04-01. No later revision found |
| GMP | 医薬品及び医薬部外品の製造管理及び品質管理の基準に関する省令 (GMP省令) ([e-Gov API](https://laws.e-gov.go.jp/api/1/lawdata/416M60000100179)) | 平成16年厚生労働省令第179号. Data-integrity text added by 令和3年厚生労働省令第90号, in force 2021-08-01. Latest amendment 令和7年厚生労働省令第117号, in force 2026-05-01 (not reviewed for content) |
| GMPN | 医薬品及び医薬部外品の製造管理及び品質管理の基準に関する省令の一部改正について (GMP interpretation notice) ([PMDA](https://www.pmda.go.jp/files/000264441.pdf)) | 薬生監麻発0428第2号, 2021-04-28. It abolished 第3章 of 薬食監麻発第0330001号 (2005), which held the old e-records clause |
| JIREI | GMP事例集（2022年版）について ([MHLW](https://www.mhlw.go.jp/web/t_doc?dataId=00tc6732&dataType=1)) | 事務連絡 (administrative notice), 2022-04-28 |
| JIREI-S | GMP事例集（2022年版）追補について ([MHLW](https://www.mhlw.go.jp/web/t_doc?dataId=00tc8501&dataType=1&pageNo=1)) | 事務連絡, 2024-04-10 |
| EDOC | 厚生労働省の所管する法令の規定に基づく民間事業者等が行う書面の保存等における情報通信の技術の利用に関する省令 (e文書省令) ([e-Gov API](https://laws.e-gov.go.jp/api/1/lawdata/417M60000100044)) | 平成17年厚生労働省令第44号 |
| PICS-J | 医薬品査察協定・医薬品査察協同スキーム（PIC/S）加盟の承認について ([MHLW press release](https://www.mhlw.go.jp/stf/houdou/0000046256.html)) | 2014-05-20. Membership effective 2014-07-01 |
| PICS-U | ＰＩＣ／ＳのＧＭＰガイドラインを活用する際の考え方について ([MHLW](https://www.mhlw.go.jp/web/t_doc?dataId=00tb8020&dataType=1&pageNo=1)); partial revision ([PMDA](https://www.pmda.go.jp/files/000274862.pdf)) | 事務連絡, 2012-02-01; revised by 事務連絡 2020-03-31 |
| N1 | 医薬品におけるニトロソアミン類の混入リスクに関する自主点検について ([MHLW](https://www.mhlw.go.jp/web/t_doc?dataId=00tc6238&dataType=1&pageNo=1)) | 薬生薬審発1008第1号・薬生安発1008第1号・薬生監麻発1008第1号, 2021-10-08 |
| NQA | 「医薬品におけるニトロソアミン類の混入リスクに関する自主点検について」に関する質疑応答集（Q&A） ([2022](https://www.pmda.go.jp/files/000249536.pdf)); revision adding Q15 ([2023](https://www.pmda.go.jp/files/000263618.pdf)); revision adding Q16–17 ([2025](https://www.pmda.go.jp/files/000275690.pdf)), with consolidated Q1–17 ([別紙1](https://www.pmda.go.jp/files/000275691.pdf)) | 事務連絡 2022-12-22; revised 2023-08-04 and 2025-06-02 |
| NEXT | 「医薬品におけるニトロソアミン類の混入リスクに関する自主点検について」の実施期限延長について ([PMDA](https://www.pmda.go.jp/files/000269782.pdf)) | 医薬薬審発0730第3号・医薬安発0730第1号・医薬監麻発0730第1号, 2024-07-30 |
| NPROC | ニトロソアミン類の混入リスクに関する自主点検に基づくリスク管理措置に係る薬事手続について ([PMDA](https://www.pmda.go.jp/files/000272870.pdf)) | 医薬薬審発1226第1号・医薬安発1226第7号・医薬監麻発1226第1号, 2024-12-26 |
| NPROC-QA | The Q&A on NPROC ([PMDA](https://www.pmda.go.jp/files/000272869.pdf)) | 事務連絡, 2024-12-26 |
| NPOST | 医薬品におけるニトロソアミン類の混入リスクに関する自主点検後の対応について ([PMDA](https://www.pmda.go.jp/files/000276222.pdf)) | 医薬薬審発0724第1号・医薬安発0724第3号・医薬監麻発0724第1号, 2025-07-24 |
| NRC | 医薬品に含まれるニトロソアミン類の体系的リスク評価手法に基づくリスクコミュニケーションガイダンスについて ([PMDA](https://www.pmda.go.jp/files/000269156.pdf)) | 医薬薬審発0618第1号・医薬安発0618第1号・医薬監麻発0618第1号, 2024-06-18 |
| NLIST | 混入が想定／確認されたニトロソアミン類の一覧 ([PMDA xlsx](https://www.pmda.go.jp/files/000276579.xlsx)) | Ver. 3.0, 2026-08-19. Names, SMILES, CAS and source API only; no AI values |
| PMDA-N | PMDA, 医薬品におけるニトロソアミン類混入リスクへの対策 ([page](https://www.pmda.go.jp/safety/info-services/drugs/0371.html)) | Index of all of the above. As fetched, the newest notification listed is NPOST (2025-07-24) |
| M7J | 「潜在的発がんリスクを低減するための医薬品中DNA反応性（変異原性）不純物の評価及び管理ガイドラインについて」の一部改正について ([PMDA](https://www.pmda.go.jp/files/000266965.pdf)) | 医薬薬審発0214第1号, 2024-02-14 (Japan's ICH M7(R2)). It amends 薬生審査発1110第3号, 2015-11-10 |
| JP19 | 第十九改正日本薬局方の制定等について ([MHLW](https://www.mhlw.go.jp/hourei/doc/tsuchi/T260413I0030.pdf)); JP19 files ([PMDA](https://www.pmda.go.jp/rs-std-jp/standards-development/jp/0260.html)) | 令和8年厚生労働省告示第193号; 医薬発0410第1号, 2026-04-10, in force the same day. Transition to 2027-09-30 |
| JP19-GI | JP19 参考情報 (General Information) ([MHLW PDF](https://www.mhlw.go.jp/content/11120000/001689444.pdf)) | Part of JP19 |
| EMA-CPCA | EMA, *Appendix 2 … Carcinogenic Potency Categorisation Approach for N-nitrosamines* ([PDF](https://www.ema.europa.eu/en/documents/other/appendix-2-carcinogenic-potency-categorisation-approach-n-nitrosamines_en.pdf)) | EMA/451665/2023, 12 Oct 2023. Cited because [NQA] A15 adopts it |
| EMA-QA | EMA, *Questions and answers … nitrosamine impurities* ([PDF](https://www.ema.europa.eu/en/documents/referral/nitrosamines-emea-h-a53-1490-questions-answers-marketing-authorisation-holders-applicants-chmp-opinion-article-53-regulation-ec-no-726-2004-referral-nitrosamine-impurities-human-medicinal-products_en.pdf)) | EMA/409815/2020 Rev.23, 10 Oct 2025. Cited because [NQA] A5 names its §8–9 as Japan's reference for analytical methods |

**Legal weight.** The GMP ordinance (省令) is binding law. The 通知 (notifications) and 事務連絡 (administrative notices) are MHLW's official interpretation. Inspectors apply them, and [JIREI] GMP20-8 says systems that create GMP records "are required" (求められる) to meet ER/ES and be managed under the CSV guideline.

## 1. Computerized systems and records: delta vs the Part 11 baseline

| # | Topic | FDA baseline (part11.md) | MHLW/PMDA requirement | Source | LIMS implication |
|---|---|---|---|---|---|
| J1 | Record retention period | Open question 3: no number from Part 11 | 「作成の日…から五年間（ただし、当該記録等に係る製品の有効期間に一年を加算した期間が五年より長い場合においては、教育訓練に係る記録を除き、その有効期間に一年を加算した期間）」 ("five years from creation, or shelf life + 1 year if longer, except training records"). SOPs count from the date they stop being used | [GMP] Art. 20(1)(iii); [GMPN] §3 Art. 20(1)③ | Default retention rule for Japanese Customers: `max(created + 5 y, product expiry + 1 y)`; training records get 5 y flat. This needs a **product expiry date** field on the submission. Deletion stays blocked until then (baseline A3). |
| J2 | Data-integrity obligations in the regulation itself | FDA puts DI in guidance (DI Q&A 2018). Part 11 says nothing about completeness or consistency | Art. 8(2): write down how record reliability (信頼性, "いわゆるデータ・インテグリティ") is ensured. Art. 20(2)(i)–(vi): keep records 欠落がない (complete), 正確 (accurate) and 不整合がない (consistent) "from creation until the retention period ends"; on a defect, find the root cause and take CAPA; record all of this | [GMP] Art. 8(2), 20(2); [GMPN] §3 Art. 8, 20(2) | (a) A **"data-integrity" Deviation category** for gaps and inconsistencies found in records, linked to CAPA. (b) Scheduled **consistency checks**, e.g. every imported instrument report maps to a sample and every result has its raw file, reported as exceptions. (c) Those check runs are records themselves. |
| J3 | Named DI owner | No equivalent | The work in Art. 20(2) is done by 「あらかじめ指定した者」 ("a person designated in advance") who knows the record type well. Their duties and authority are written into the Art. 6(4) organization document | [GMP] Art. 20(2); [GMPN] §3 Art. 20(2) | A configurable **DI-responsible assignment per record type** (likely QA). It is shown on consistency-check reports and required for paper-original disposal (J5). |
| J4 | ALCOA vs ALCOA+ | FDA defines ALCOA; "+" comes from PIC/S | MHLW states ALCOA+ outright: 帰属性 (attributable), 判読性 (legible), 同時性 (contemporaneous), 原本性 (original), 正確性 (accurate), 完全性 (complete), 一貫性 (consistent), 耐久 (enduring), 入手可能性 (available) | [JIREI] GMP8-18 | No new build: the baseline checklist already covers all nine. Use these Japanese labels if the UI or docs are localized. |
| J5 | Paper originals after scanning | Baseline D3 covers instrument dynamic data; nothing on paper | 「データインテグリティを確保する観点から元の『手書きの記録』も別途保管する必要がある」 ("the original handwritten record must also be kept separately"). The 2024 supplement lets paper be destroyed only if all four conditions hold: (1) a documented risk assessment approved by the Art. 20(2) designee; (2) a **verified scanning process** with a record that it was followed; (3) DI maintained over the whole lifecycle; (4) written procedures. Thermal paper may be scanned and then discarded | [JIREI] GMP20-3; [JIREI-S] 追補3 | For each scanned worksheet or logbook page, record: **paper-original retained (location)** or **destroyed under assessment #X**, the scan-process version, and the scanner operator. Destruction needs the DI-owner sign-off from J3. |
| J6 | Raw data (生データ) | D3/D5: keep dynamic data and every reprocessing | Raw data must let someone "verify the final result was correctly obtained". The list includes instrument printouts, chart files, photos, and 「計算、換算等を行った際の過程を記録したもの」 ("the record of the calculation or conversion process"). Store it 「得られた時の状態で」 ("in the state in which it was obtained") | [JIREI] GMP20-4 | The LIMS keeps the **calculation trace** for every reported ppm value (inputs, formula version, intermediate values), not only the result. The baseline formula from nitrosamines.md §2 gets stored with its inputs. |
| J7 | Which records fall under ER/ES | Record-type registry with a "Part 11 record" flag | ER/ES applies to records 「測定機器が生成したデータを電子的に転送して作成した記録及びコンピュータ内で2次加工や判定等を行った場合」 ("records made by electronic transfer of instrument data, and cases where the computer processes or judges"). If the paper transcript is the official original, ER/ES is only "desirable" | [JIREI] GMP20-6; [ERES] 記3 | Imported LC-MS/MS results and computed ppm/verdicts are **always** ER/ES records. Add a "JP ER/ES" flag beside the Part 11 flag in the registry, defaulting to yes for imported and computed records. |
| J8 | Three principles framing | Part 11 lists controls without a framing | Records must keep 真正性 (authenticity: complete, accurate, reliable, with clear responsibility for creation, change and deletion), 見読性 (readability: can be output in human-readable form on screen, paper or media) and 保存性 (preservability: authenticity and readability kept for the retention period). **When records are migrated to other media or formats, all three must still hold** | [ERES] 別紙3.1.1–3.1.3; [EDOC] Art. 4(3)–(4) | Nothing new beyond baseline A2/A3/D10, except **migration**: any DB migration or archive-format change needs a verification record (row counts, hash checks, readable export). Put this in the change-control template. |
| J9 | Audit trail | Mandatory, with old/new value, who, when and why (A5) | ER/ES says an automatic audit trail is only 「望ましい」 ("desirable") ([ERES] 3.1.1(2)). The GMP case book is stricter: 「すべての入力及び修正の記録を作成することが求められる。また、変更及び削除を行った場合にはその理由の記録も必要である」 ("all entries and modifications must be recorded, with the reason for any change or deletion"). It cites PI 041 | [ERES]; [JIREI] GMP20-13 | No extra build. Baseline A5 plus the reason on every change meets it. |
| J10 | E-signature rules | Two components, a certification letter to FDA, and the session rules (C3–C5) | Only four rules: (1) documented procedures under the 電子署名及び認証業務に関する法律 (Act on Electronic Signatures and Certification Business, Act No. 102 of 2000); (2) unique per person, never reused; (3) show **name, date/time, meaning (作成・確認・承認, creation/review/approval)**; (4) linked to the record so it cannot be removed or copied by ordinary means. No two-component rule and **no letter to MHLW** | [ERES] 別紙4 | The baseline's signature design is a superset. Skip C3 for Japan-only use. Add a signature SOP stub that cites the 電子署名法. Suggested meaning values: 作成 / 確認 / 承認 (creation / review / approval), mapped to Analyst / Reviewer / QA. |
| J11 | Signature on printed output | Baseline B2: the signature block appears on every print | A printed report handed on as a document must be 「署名又は記名押印」 ("signed, or name printed plus a seal (hanko)"). An electronic report needs an ER/ES e-signature | [JIREI] GMP20-9, GMP20-10 | For a printed CoA meant to be wet-signed, the PDF template gets an optional **署名／記名押印** box. When the e-signature is the official one, the print says so. Owner decision; see open question 3. |
| J12 | Automatic pass/fail | Not addressed; baseline has QA release | 「『アウトプット』すること自体は差し支えないが、品質部門はあらためて試験検査の結果を検討して適否の判定を行う必要がある」 ("outputting pass/fail automatically is acceptable, but the quality unit must review the results again and judge conformity itself") | [JIREI] GMP20-11 | The spec comparison (the 10 % / 100 % bands) is shown as **advisory**. QA release needs an explicit per-result "判定 (judgment): conforms / does not conform" signed by QA. The system must never auto-release. |
| J13 | CSV lifecycle documentation | A1: validation is procedural and IQ/OQ/PQ out of scope | Software is classified by category (別紙2, GAMP-like). **Category 5 (カスタムソフトウェア, custom software)** needs: a コンピュータ化システム管理規定 (CS management policy), a システム台帳 (system inventory), 開発計画書 (development plan), 要求仕様書 (URS), 機能仕様書 (FS), 設計仕様書 (DS), program and system tests, 受入試験 (acceptance test), a validation plan, DQ/IQ/OQ/PQ, a validation report, supplier assessment, and 廃棄計画書 (retirement plan) with a 廃棄記録 (retirement record). Named roles: 開発責任者 (development lead), 検証責任者 (validation lead), 運用責任者 (operations lead). Periodic 自己点検 (self-inspection) | [CSV] §1.3, 3–8, 別紙2 | This LIMS is category 5, and [CSV] §2(5) and (7) name systems holding QC results and documents. Keep the repo traceable (URS → FS → DS → tests), with **stable requirement IDs** in issues and tests. Add a **data-exit/retirement export** (full dataset plus audit trail in open formats), which the baseline does not have. |
| J14 | System trouble handling | Deviations exist for lab events | 逸脱（システムトラブル）("deviation (system trouble)"): assess the impact on product quality, find the root cause, prevent recurrence, **verify correct recovery before restarting**, and record it all | [CSV] §6.7 | A Deviation type **"system trouble"** with a required "restart verified by" field. Outages and failed imports raise it. |
| J15 | Backup and restore records | A3: scheduled backups and a documented restore test | Every backup and restore is recorded and kept, not only the test | [CSV] §6.5(3) | Write a backup/restore log (time, scope, result, operator or job ID) that admins can view and that sits under the audit trail. |
| J16 | Contract testing lab | Baseline: supplier agreement for the VPS | The manufacturer must sign a written agreement (取決め) with any 外部委託業者 (outsourced contractor) doing testing, confirm the contractor's competence first, check it periodically, and ask for improvement | [GMP] Art. 11-5 | The Customer record gets a **quality agreement reference and version**. Support Customer audits with read-only auditor access or an audit export per Customer. |
| J17 | PIC/S alignment | Baseline builds to EU Annex 11 (2011) plus the 2025 draft | Japan joined PIC/S on 2014-07-01 as its 45th member. The PIC/S GMP guide, Annex 11 included (別紙(10)), is a **reference method**, not binding. Firms decide whether to adopt it, and inspectors may ask for it where a firm's own method leaves unacceptable risk ([PICS-U] 記(3)–(4)). The GMP notice names PI 041 and PIC/S Annex 11 as references for e-records | [PICS-J]; [PICS-U]; [GMPN] §3 Art. 20(2), §3-65(3) | No new build. The baseline Annex 11 superset covers it. No Japanese position on the 2025 draft Annex 11 was found. |

**Things Japan asks for that are weaker than the baseline.** Build to the baseline anyway:

- ER/ES has no two-component signing, no session rule, and no lockout rule.
- ER/ES treats the audit trail as "desirable" (the case book J9 overrides this in practice).
- The CSV guideline's security section only asks for access rights on input, change and delete, protection of credentials, room access limits, and security records ([CSV] §6.4).

## 2. Nitrosamines: limit and approach comparison

### 2.1 Framework

| Topic | FDA baseline (nitrosamines.md) | MHLW/PMDA | Source | LIMS implication |
|---|---|---|---|---|
| Instrument | Guidance (Rev. 2, 2024) plus a web page of AIs revised often (rev. 30) | A self-inspection notification from 2021 with a **fixed AI table** that has not been revised. Firms follow it: 「当該限度値に従うこと」 ("follow those limits"). For root causes, risk assessment and analytical principles it refers to the **latest** FDA and EMA guidance | [N1] 別添2; [NQA] A5, A11 | The AI reference table needs a **jurisdiction** column (FDA / MHLW), and each spec names which one it uses. |
| Scope | All human drugs | Chemically synthesized Rx, 要指導 (pharmacist-guidance) and OTC drugs; high-risk biologics. **Excluded**: drugs indicated only for advanced cancer (ICH S9 scope) and drugs not used directly on the body. Crude drugs and Kampo are excluded unless combined with a synthetic API. Inorganic salts are basically excluded | [N1] 別添1; [NQA] A1–A3 | Nothing beyond a scope note on the Customer submission. |
| Timeline | FDA mitigation deadline 1 Aug 2025 (as MHLW notes in [NEXT]) | Risk evaluation by 2023-04-30. Mitigation by **2025-08-01** (extended from 2024-10-31 because of nitrite in excipients and missing NDSRI standards). Firms not done had to report by 2025-08-29. **After that the obligation continues**: re-evaluate at every new approval, every change to process, formulation or primary packaging, and every new finding | [N1] 別添3; [NEXT]; [NPOST] 記1, 記3 | Testing continues without an end date. The re-evaluation triggers are Customer-side and don't need LIMS support. |
| Watch list | W tables list AIs | PMDA publishes a list of nitrosamines expected or confirmed (Ver. 3.0, 2026-08-19). It has names, SMILES, CAS and source API, but **no AIs**. Reviewers may ask about any nitrosamine on it | [NPOST] 記2(1); [NLIST] | The analyte master can take SMILES and CAS and carry a "PMDA list v3.0" tag. The list is a structure source, not a limit source. |
| Analyte names on communications | Name + abbreviation | Information documents sent to medical institutions must give the nitrosamine's 「和名に加えて英名」 ("Japanese name in addition to the English name") | [NRC] 第3-2 | Store **`name_ja`** next to `name_en` in the analyte master. Printing Japanese names on a CoA is the owner's choice (open question 1). |

### 2.2 Acceptable intakes for named nitrosamines

| Nitrosamine | FDA AI (ng/day) [baseline W] | MHLW AI (ng/day) [N1 表] | Japan vs FDA |
|---|---|---|---|
| NDMA | 96 | **96.0** | same |
| NDEA | 26.5 | **26.5** | same |
| NMBA | 1500 (CPCA cat. 4) | **96.0** | 15.6× tighter |
| NMPA | 100 (CPCA cat. 2) | **34.3** | 2.9× tighter |
| NEIPA / NIPEA | 400 (CPCA cat. 3) | **26.5** | 15.1× tighter |
| NDIPA | 1500 (CPCA cat. 5) | **26.5** | 56.6× tighter |
| MeNP / MNP (1-methyl-4-nitrosopiperazine, rifampicin) | 400 (CPCA; interim 3,000 or 5 ppm) | **26.5** | 15.1× tighter; Japan has no published interim value |
| NDBA | none published (default 26.5) | **26.5** | same value; in Japan it is a listed limit, not a default |
| NMOR (N-nitrosomorpholine) | not in baseline | **127** | Japan only |
| NDPA | none published (default 26.5) | none | Japan has no default; see 2.3 |

MHLW's footnote: 「げっ歯類のTD50値…等から算出。10万分の1という理論上の発がんリスクに相当する変異原性不純物の1日摂取量」 ("calculated from rodent TD50 values etc.; the daily intake of a mutagenic impurity corresponding to a theoretical 1-in-100,000 cancer risk") [N1]. The risk level is the same as FDA's.

**Worked fictional example** (Zelotrin, MDD 400 mg/day, as in nitrosamines.md §2). NDMA 0.240 ppm and NDEA 0.0663 ppm are unchanged, so batch ZLT-0007 gets the same verdict under both jurisdictions. The other analytes move a lot:

| Analyte | FDA limit (ppm) | MHLW limit (ppm) | MHLW 10 % level (ppm) |
|---|---|---|---|
| NMBA | 3.75 | 0.240 | 0.0240 |
| NMPA | 0.250 | 0.0858 | 0.00858 |
| NEIPA/NIPEA | 1.00 | 0.0663 | 0.00663 |
| NDIPA | 3.75 | 0.0663 | 0.00663 |

A method validated to FDA limits may not have enough LOQ for Japan. The FDA ARB method's LOQ of 0.05 ppm for NDIPA ([baseline] M-ARB6) is below the MHLW limit (0.0663 ppm) but far above its 10 % level. **LOQ-as-%-of-limit has to be computed per jurisdiction.**

### 2.3 Limits for other nitrosamines (NDSRIs, unlisted)

| Topic | FDA baseline | MHLW/PMDA | Source |
|---|---|---|---|
| With carcinogenicity data | Compound-specific AI (W Table 2) | Set a lifetime limit using ICH M7 | [N1] 別添2(2)② |
| Without data | FDA CPCA (RAIL); category 1 = 26.5 | SAR or genotoxicity data, or **EMA's CPCA**: 「今回ＥＭＡより示された CPCA を利用して限度値を設定することは差し支えない」 ("setting limits with the CPCA just published by EMA is acceptable"). No MHLW consultation needed when the CPCA is used. EMA categories: **1 = 18**, 2 = 100, 3 = 400, 4 = 1500, 5 = 1500 ng/day | [NQA] A15; [NPROC] 記1; [EMA-CPCA] Table 1 |
| Default when nothing fits | 26.5 ng/day | **None**. Any non-CPCA limit needs prior consultation with MHLW (nitrosamines@mhlw.go.jp) | [N1] 別添2(2); [NQA] A11; [NPROC] 記1 |
| Enhanced Ames test | Accepted by FDA | Consultation possible; the test report must be submitted | [NQA] A17 |
| Less-than-lifetime (FDA LTL, 24 Sep 2026) | Factors of 80× / 13.3× / 6.67× | **No LTL factor.** Where a product exceeds its AI and supply is at risk, a duration-based **暫定管理値** (interim control value) under EMA's approach, only 「厚生労働省と協議した上で」 ("after consulting MHLW") and with a concrete mitigation schedule | [NQA] A16 |

LIMS implication: a spec's AI source enum gets **MHLW table / EMA-CPCA category / MHLW-agreed (consultation ref) / MHLW interim control value (with end date)**. An FDA-CPCA category 1 value must not be reused for a Japanese spec.

### 2.4 Multiple nitrosamines

| FDA baseline | MHLW |
|---|---|
| Default: total ≤ AI of the most potent. Flexible: Σ %AI ≤ 100 %, for n ≤ 3 | Both methods are allowed: (a) total daily intake ≤ the AI of the most potent nitrosamine found; (b) total cancer risk ≤ 1 in 100,000. **No n ≤ 3 cap** is stated. MHLW must be consulted on the limit **even when every AI comes from the table** ([N1] 別添2(2)③; [NQA] A7) |

LIMS implication: the same two rule options as the baseline, with no n ≤ 3 guard on Japanese specs, plus a "MHLW consultation reference" field that a multi-nitrosamine JP spec must fill in.

### 2.5 Specification and decision rules

| Topic | FDA baseline | MHLW/PMDA | Source | LIMS implication |
|---|---|---|---|---|
| ≤ 10 % of AI | No specification needed if the root cause is understood | 「限度値に対してある一定の割合を下回ることのみでは可能とは判断できない」 ("falling below a set fraction of the limit is not, on its own, enough"). Dropping the spec, or skip testing under 30 %, needs the risk factor identified **and** a control written into the approval (承認書), normally through a partial-change application | [NPROC-QA] No.1 | For JP specs, show the 10 % band only for information, never as "specification not required". |
| Detected elsewhere | n/a | If a drug with the **same API**, even another company's, exceeded a limit in Japan or abroad, a specification is needed in principle | [NPOST] 記2(2) | Customer-supplied flag on the product: "same-API exceedance known". |
| Stability | FDA App. C example shows growth | 「少なくともニトロソアミン類の混入が確認された品目については、安定性モニタリングにおいて経時的なニトロソアミン類の変動を測定し」 ("at least for products where nitrosamines were detected, measure the change over time in stability monitoring and confirm the limit is not exceeded through the shelf life") | [NPROC-QA] No.4; [GMP] Art. 11-2 | Stability study support: time-point results plotted against the JP limit, with a projection or alert before expiry. |
| Adding a spec | Supplement per FDA | A 軽微変更届出 (minor-change notification) was allowed only if filed by 2025-08-31. It needs **method validation per product** | [NPROC] 記2(1) | The method record keeps product-specific validation evidence (baseline §3 already asks this). |
| Adding this lab as a test site | n/a | Adding a testing facility for nitrosamine tests requires consulting MHLW's 医薬品審査管理課 (Pharmaceutical Evaluation Division) | [NPROC-QA] No.2 | Customer onboarding for Japanese products records whether this lab is named in the Customer's approval (承認書) as a test facility. |
| Excipient nitrite | Mentioned as a root cause | A nitrite spec for a JP excipient is written as a 別紙規格 (separate specification) on top of the JP monograph | [NPROC-QA] No.5; [NEXT] | Possible new test type: "nitrite in excipient". Probably not LC-MS/MS; see open question 5. |
| LOQ | No number; inferred ≤ 10 % | No number. For analytical principles, MHLW points to EMA Q&A §8–9 ([NQA] A5). EMA: LOQ ≤ limit for routine testing, **≤ 30 %** to justify skip testing, **≤ 10 %** to justify omitting the spec | [NQA] A5; [EMA-QA] Q&A 9 | Same flag as the baseline (LOQ > 10 % of limit), computed against the JP limit. |

### 2.6 Reporting

| Topic | FDA baseline | MHLW/PMDA | Source | LIMS implication |
|---|---|---|---|---|
| Exceedance | Field Alert Report by the NDA/ANDA holder | The MAH reports 「速やかに」 ("promptly") to 監視指導・麻薬対策課, and also to the prefecture for prefecture-approved products. Required content: nitrosamine name and **content**; whether a recall is needed; quality-impact assessment with **the lots measured, the lots over the limit, and each lot's distribution status**; supply impact; source (estimated); overseas actions; schedule | [N1] 別添3(2); [NQA] A8, A12; [NPROC] 記1 | On a JP-spec OOS, the Deviation gets an **"MHLW report data pack" export**: analyte, result, limit, AI source, and every lot tested for that product with its result. The lab supplies data; the MAH files. |
| Below-limit results | Not reported | Not reported, but the MAH must document and keep the risk assessment and measurement reports, and may have to produce them at GMP inspection or in a change application | [NQA] A10 | Reports stay retrievable per product for the J1 retention period. |
| Provisional assessments | n/a | If supplier data is late, a provisional assessment is allowed but must be documented so that it is **distinguishable** (区別できる形) from a full assessment | [NQA] A6 | Tag results or reports used in a provisional assessment as "暫定 (provisional)". |
| Result format | ppm to 3 s.f. ≥ LOD; "not detected" below | No Japanese reporting convention for results was found. Notices use AI in ng/日 and limits in ppm (e.g. EMA's example) | [N1]; [EMA-QA] | Keep the baseline convention. |

### 2.7 Japanese Pharmacopoeia

- **JP19** took effect on 2026-04-10 (令和8年厚生労働省告示第193号; 医薬発0410第1号). Approvals have until **2027-09-30** to move to it ([JP19] 「経過措置期間について」).
- JP19's revised and new general tests are chromatography, residual solvents, elemental impurities, particulates, dissolution and others. **None is a nitrosamine test** ([JP19] 別紙第1).
- A full-text search of the JP19 General Information PDF finds **no nitrosamine chapter** ([JP19-GI]). Its impurity chapter 「化学合成される医薬品原薬及びその製剤の不純物に関する考え方」〈G0-3-181〉 ("approach to impurities in chemically synthesized drug substances and products") sends DNA-reactive impurities to Japan's ICH M7 notification (薬生審査発1110第3号, 2015-11-10, applied to applications from 2016-01-15). That notification now stands as amended to M7(R2) by 医薬薬審発0214第1号, 2024-02-14 ([M7J]).
- JP matters to the LIMS in two places. JP excipient nitrite specs are written as 別紙規格 (2.5). A JP-product method must follow the JP 通則 (General Notices) and general tests where the approval cites them.

## Open questions for the owner

1. **Japanese localization.** None of the sources fetched requires records to be in Japanese. ER/ES asks only for 見読性 (human-readable output), and the GMP ordinance sets no language. But Japanese Customers' approval specs (承認書 「規格及び試験方法」) and test names are in Japanese, and MHLW asks for Japanese plus English nitrosamine names in communications ([NRC]). **Proposal:** make storage and PDF output UTF-8 safe for Japanese (fonts included), add `name_ja` to analytes and methods, and allow Japanese free text in Customer-facing fields. Full UI localization (ja-JP labels, 令和 dates, JST display) waits until a real Japanese Customer exists. Is that acceptable, or is ja-JP UI in scope for the demo?
2. **Jurisdiction per product.** Should each product or spec carry a jurisdiction (FDA / MHLW / both), with the AI table, CPCA table, 10 % rule behaviour, retention rule (J1) and multi-nitrosamine cap switching on it? If "both", the LIMS would evaluate against the stricter limit and show both verdicts.
3. **Hanko / 記名押印 box.** Should printed CoAs for Japanese Customers carry a signature or name-and-seal box (J11), or is the e-signed PDF always the official record?
4. **Paper originals.** Does the demo lab use any handwritten worksheets or logbooks? If so, the J5 "original retained / destroyed under assessment" fields and a verified scanning procedure are needed. If not, the feature can wait.
5. **Excipient nitrite testing.** Is nitrite-in-excipient testing (JP 別紙規格) in the lab's scope? It is usually not an LC-MS/MS nitrosamine method.
6. **MHLW data pack.** Is the Deviation export for MHLW exceedance reports (2.6) worth building, or is a generic Customer notification enough for a demo?
7. **Not verified.** The content of the 2025 GMP ordinance amendment (令和7年厚生労働省令第117号, in force 2026-05-01) was not reviewed, and no revision of the 2010 CSV guideline or the 2005 ER/ES guideline was found. Re-check both if Japan becomes a real target market.
