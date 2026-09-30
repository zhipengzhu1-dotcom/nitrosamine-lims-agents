# LC-MS/MS quantitation reports: formats and extraction

Research for ticket #8 (map #1). Checked 2026-09-29. All example data in this document is invented.

## Recommendation

1. **Build for Waters MassLynx / TargetLynx first.** The owner's sample exports come from TargetLynx. Other vendors wait until a lab actually uses one.
2. **Treat the tab-delimited TXT export as the source of values.** TargetLynx writes it with *File > Export > Current / Complete / All Groups Summary* ([WKB2176](https://support.waters.com/KB_Inf/MassLynx/WKB2176_How_to_export_Quanlynx_and_TargetLynx_results_into_Excel)). A Python parser reads it with no guessing: split the file at each `Compound N: <name>` line, read the header row, then map every cell to its column by header name.
3. **Treat the PDF as the human-readable attachment, and as a cross-check.** When both files are uploaded, extract the PDF too, compare it with the TXT and block import if any value differs. When only a PDF is uploaded, extract it with pdfplumber, using the header row's word positions to find the columns. Every value extracted from a PDF alone must then be checked by the Reviewer. Reject PDFs with no text layer (scans or rasterised prints); the LIMS will not run OCR.
4. **Look up columns by header name, never by position.** TargetLynx users can add, remove and reorder columns in both the summary table and the printed report ([WKB27131](https://support.waters.com/KB_Inf/MassLynx/WKB27131_How_do_you_add_columns_to_the_Targetlynx_Summary_Bar), [WKB49279](https://support.waters.com/KB_Inf/MassLynx/WKB49279_How_to_add_a_column_to_the_TargetLynx_report)). Layouts are saved as `.qlt` files ([WKB80971](https://support.waters.com/KB_Inf/MassLynx/WKB80971_How_to_save_and_apply_a_report_format_in_Targetlynx)). The parser needs a required-column list and must fail loudly when one of those columns is missing.
5. **Keep the uploaded file as evidence; it is not the original record.** Under FDA's terms, the TXT and PDF are *static* records. The reprocessable `.qld` dataset in MassLynx is the *dynamic* original ([FDA Data Integrity Q&A, Dec 2018, Q1.d and Q10](https://www.fda.gov/media/119267/download)). The LIMS stores the uploaded bytes with a SHA-256 hash, the parser version, and the `.qld` path taken from the file header, and links each extracted value to them. The extractor saves transcription effort. It does not replace second-person review.
6. **Test against generated fictional reports.** A seeded Python generator produces the TXT, the PDF and the expected values from one dataset. A trial in this research (below) read a synthetic PDF with 100% cell agreement using the header-anchored method and 8% using a generic table extractor.

## Sources: what was reached and what was gated

| Source | Status |
|---|---|
| Waters Knowledge Base articles (support.waters.com, WKB…) | Fetched; cited below |
| Waters PDFs on waters.com / help.waters.com: MassLynx 4.1/4.2 Interfacing Guide (71500123505), QuanLynx User's Guide, "Detection Flags and Primary Flags" tech note, TargetLynx application notes, MassLynx LIMS Interface guides | **Not reached.** Every attempt returned Akamai "Access Denied" or timed out. According to WKB19268, the LIMS-export field order is documented in the Interfacing Guide, so that field order is **unverified** here. WKB68798 says the TargetLynx manual is built into MassLynx Help. |
| SCIEX Analyst Software User Guide RUO-IDV-05-13401-B (Apr 2025) | Fetched (sciex.com PDF) |
| SCIEX OS knowledge base articles | Fetched. The full SCIEX OS user guides were not read. |
| Agilent MassHunter Quantitative Analysis Familiarization Guide | agilent.com returned 403. I read edition G3335-90031 (Dec 2007, software B.01.04) from a university mirror (cigs.unimo.it). It is old; current versions differ. |
| Thermo TraceFinder user guides (tools.thermofisher.com, documents.thermofisher.com) | **403**. I read only a Chromeleon 7 reporting brochure. |
| pdfplumber README, Camelot 2.0.0 docs, pypdf docs | Fetched |
| Owner's sample exports (one PDF+TXT pair from each of two runs) | **Not read in this session.** Permission to open them was denied. The column layout below comes from the coordinator's description of them, and no values were copied. |

## Waters MassLynx / TargetLynx (primary target)

### Ways results leave TargetLynx

| Route | What it produces | Source |
|---|---|---|
| *File > Export > Current Summary / Complete Summary / All Groups Summary* | "a tab delimited text file for the summary table". It holds only what the browser displays. *Current*: the sample or compound currently shown. *Complete*: all rows in the table, by sample or by compound. *All Groups*: every sample or compound in every group. | [WKB2176](https://support.waters.com/KB_Inf/MassLynx/WKB2176_How_to_export_Quanlynx_and_TargetLynx_results_into_Excel) |
| *File > Export > LIMS* | "a comma delimited file, but the extension added is automatically .txt". The field order is in the MassLynx 4.1 Interfacing Guide (gated). | [WKB19268](https://support.waters.com/KB_Inf/MassLynx/WKB19268_How_do_you_export_the_Targetlynx_results_to_a_comma_delimited_text_file_csv) |
| Print through a PDF printer driver | "If you have a PDF printer installed, you can print your TargetLynx results as a PDF". No particular driver is named, so the text layer depends on the lab's driver. | [WKB66485](https://support.waters.com/KB_Inf/MassLynx/WKB66485_Can_you_print_TargetLynx_results_to_PDF) |
| Edit > Copy summary and paste into Excel | The same content as Export, through the clipboard. Avoid it: SCIEX's equivalent guidance calls copy-paste "uncontrolled". | WKB2176; [SCIEX KB](https://sciex.com/support/knowledge-base-articles/what-are-the-best-ways-to-output-data-from-sciex-os_en_us) |

Results datasets are `.qld` files (the extension seen in the owner's export header and throughout Waters KB titles). Report layouts are `.qlt` files. The owner's TXT names the `.qld` path in its header, so the LIMS can tie the import back to the original dataset.

### Structure of the owner's "Quantify Compound Summary Report" TXT

As described to this session (the files themselves were not opened here):

- Plain ASCII with CRLF line endings. Tab-separated.
- File header lines: `Quantify Compound Summary Report`, a `Dataset:` line holding the `.qld` path, a `Time` line and a `Printed:` line.
- One block per compound. Each block has a `Compound N: <name>` line, then a header row, then one row per injection.
- Columns: `Name`, `Sample Text`, `Vial`, `Inj. Vol`, `RT`, `Std. Conc`, `Height`, `Area`, `IS Area`, `pguL`, `Response`, `%Rec`, `Peak Ratio`, `Acq.Date`, `Acq.Time`, `BS/Conc.`, `S/N`.

**Still to confirm against a real file:** whether a leading row-index column is present, the exact punctuation of each header line (for example `Time` vs `Time:`), how blank cells appear for non-detects, the date format, and whether the PDF shows the same columns.

### Column meanings (from Waters KBs where available)

- **Response**: for an internal-standard method, "Response = (Area Analyte / Area IS) x Concentration IS" ([WKB234165](https://support.waters.com/KB_Inf/MassLynx/WKB234165_How_do_you_calculate_the_concentration_in_Targetlynx_from_the_concentration_of_the_internal_standards_using_no_calibration_curve), [WKB6247](https://support.waters.com/KB_Inf/MassLynx/WKB6247_How_to_view_the_ratio_of_the_analyte_area_to_the_internal_standard_area_in_TargetLynx)). The LIMS can recompute it from `Area`, `IS Area` and the IS concentration as a consistency check.
- **Std. Conc**: the nominal concentration for standards, entered in the sample list. It is blank for unknowns (inferred).
- **Sample Text**: a sample-list field that must be filled before acquisition, because "it's part of the header created at the start of acquisition" ([WKB49279](https://support.waters.com/KB_Inf/MassLynx/WKB49279_How_to_add_a_column_to_the_TargetLynx_report)). It is where the lab's sample or lot ID usually lives, so it is the join key to the LIMS sample.
- **pguL** (inferred, not sourced): the calculated concentration, with the header showing the unit (pg/µL). The parser should read the unit from the header, not assume it.
- **%Rec, Peak Ratio, BS/Conc.** (unknown, owner to confirm): `%Rec` is probably calculated ÷ nominal × 100. `Peak Ratio` may be the qualifier/quantifier ion ratio. `BS/Conc.` may be a blank-subtracted concentration. None of these could be confirmed from a reachable Waters source.
- **Primary Flag** (not in the owner's layout, but available): `b` baseline, `d` drop line, `s` shoulder, `t` trace boundary, `M` "peak start or end point was manually altered", `-` manually deleted, `!` flagged, `I` indeterminate (negative or unsolvable concentration), `X` "manually excluded from the calibration curve" ([WKB1004](https://support.waters.com/KB_Inf/MassLynx/WKB1004_What_do_the_abbreviations_in_the_Primary_Flag_field_mean)). `M` and `X` are exactly what a Part 11 reviewer wants surfaced. **Recommend the lab add `Primary Flag` to its export layout.**
- **Concentration flagging**: when set in the method, the Overview report shows concentrations above the maximum limit in bold and those below the reporting limit as "Below RL" ([WKB878](https://support.waters.com/KB_Inf/MassLynx/WKB878_How_do_I_flag_concentrations_and_view_the_flagged_samples_in_the_TargetLynx_browser)). The parser must accept text such as `Below RL` in a numeric column.

## Other vendors (secondary)

**SCIEX Analyst.** Results tables "can be exported to a txt file", either all columns or only the visible ones (User Guide RUO-IDV-05-13401-B, "About Results Tables", p. 73; Quantitate-mode toolbar "Export as Text", p. 108). The Reporter add-in writes Word (docx), PDF, HTML, CSV ("Excel") and TXT, but CSV and TXT only from templates "specifically marked as text-compatible" (Reporter output formats table, pp. 89–92). [PDF](https://sciex.com/content/dam/SCIEX/pdf/customer-docs/user-guide/an-software-user-guide-en.pdf)

**SCIEX OS.** SCIEX names three controlled output routes: export the results table, transfer it to a LIMS, and create a report through *Reporting > Create Report and Save Results*. It warns that copy-paste "is not recommended because it is uncontrolled" ([KB](https://sciex.com/support/knowledge-base-articles/what-are-the-best-ways-to-output-data-from-sciex-os_en_us)). The export menu is *Reporting > Export Results > Export and Save Results Table*, with a choice of all or visible columns and visible rows only ([KB](https://sciex.com/support/knowledge-base-articles/how-to-export-results-for-specific-samples-in-sciex-os_en_us)). Admins can require exported text files to be password-encrypted ([KB](https://sciex.com/support/knowledge-base-articles/how-to-export-data-in-encrypted-text-file-in-sciex-os-sofware_en_us)). The LIMS could not read such a file without the password.

**Agilent MassHunter Quantitative Analysis** (2007 guide, B.01.04). Batches are saved as `*.batch.xml`. *File > Export > Export Table* writes the Batch Table to Excel, and reports come from Excel templates (for example an ISTD quant report). Accuracy outliers show in red (high) or blue (low) (Familiarization Guide G3335-90031, pp. 56–57, 75ff, 80ff; [mirror](https://www.cigs.unimo.it/CigsDownloads/labs/lcmstq/G3335-90031_Quant_Familiarization.pdf)). Current versions were not verified.

**Thermo TraceFinder / Chromeleon.** The user guides were gated (403). A Chromeleon 7 brochure describes spreadsheet-style report templates that include "peak analyses, calibration curves… sequence summaries, audit trails" ([brochure](https://documents.thermofisher.com/TFS-Assets/CMD/brochures/sp-70762-cds-chromeleon-deliver-results-sp70762-en.pdf)). Export formats were not verified.

**Common pattern.** Every vendor has a delimited-text export of the results table with user-configurable columns, plus a template-driven printed or PDF report. The same design works for all of them: a text parser keyed by header name, with the PDF as an attachment and cross-check. Each vendor needs only its own mapping from headers to canonical fields.

## Canonical fields the LIMS should extract

**Import-level fields** (one set per uploaded file): vendor and software (`waters-targetlynx`), report kind (`compound-summary`), `.qld` dataset path, printed timestamp, original filename, SHA-256, parser version, upload user and time. The dataset path together with the acquisition date and time is the *injection sequence reference* that typed entry also requires.

**Row-level fields** (one per compound × injection):

| Canonical field | TargetLynx column | Required | Notes |
|---|---|---|---|
| `compound` | `Compound N: <name>` line | yes | Map to the method's analyte list. Unknown names block the import. |
| `injection_name` | `Name` | yes | Data file or injection name |
| `sample_text` | `Sample Text` | yes | Join key to the LIMS sample or lot |
| `vial` | `Vial` | no | |
| `injection_volume` | `Inj. Vol` | no | |
| `retention_time_min` | `RT` | yes | Blank means not detected |
| `nominal_conc` | `Std. Conc` | cal/QC only | Its presence can suggest the sample type if no `Type` column exists |
| `height` | `Height` | no | |
| `area` | `Area` | yes | |
| `is_area` | `IS Area` | yes | Low or missing IS area triggers a review flag |
| `response` | `Response` | yes | Recompute and compare |
| `calc_conc` + `calc_conc_unit` | `pguL` (unit from header) | yes | Value may be text such as `Below RL` |
| `recovery_pct` | `%Rec` | no | |
| `ion_ratio` | `Peak Ratio` | no | Meaning to confirm |
| `acquired_at` | `Acq.Date` + `Acq.Time` | yes | Parse the vendor date format explicitly |
| `blank_sub_conc` | `BS/Conc.` | no | Meaning to confirm |
| `signal_to_noise` | `S/N` | no | |
| `primary_flag` | `Primary Flag` (ask lab to add) | recommended | `M` or `X` must reach the Reviewer |
| `sample_type` | `Type` (ask lab to add) | recommended | Otherwise the LIMS classifies from its own sequence |

**Not in the file, so the LIMS supplies it:** calibration curve details (fit, weighting, r²), IS name and concentration, dilution factor, and sample weight. These come from the method record and the ELN. The conversion from pg/µL to the reported unit (for example ng/g or ppm relative to the API) belongs to the result-calculation ticket, not to the parser.

## Extraction approaches

Trial run for this research (throwaway script, not committed; the generator in the plan below replaces it). It generated a three-compound, 13-injection fictional TXT and a matching PDF (reportlab, text without ruling lines, with numbers right-aligned as in a printed summary). It then parsed the PDF and compared every cell (702 in all) with the TXT.

| Approach | Result on the fictional fixture | Notes |
|---|---|---|
| TXT: split on tabs, key cells by header name | Reference (exact) | Deterministic. No layout inference. **Primary.** |
| pdfplumber `extract_words`, with columns anchored to header word boxes (left edge for text columns, right edge for numeric ones) | **702/702 cells agree** | Best case, since I generated the PDF myself. A real PDF printed from TargetLynx may wrap long `Sample Text` values, break pages mid-compound, or change fonts. Must be re-run on the owner's PDF. |
| pdfplumber `extract_table` with `text` strategies, page cropped to the table | 59/702 | Splits headers such as `Std. Conc` and `Sample Text` into separate columns. Not usable without per-report tuning. |
| Camelot Stream / Network / Hybrid | Not run (not installed) | Stream "can be used to parse tables that have whitespaces between cells"; Lattice needs "demarcated lines between cells" and OpenCV ([Camelot 2.0.0](https://camelot-py.readthedocs.io/en/latest/user/how-it-works.html)). This is the same guessing problem as the text strategy, with more dependencies. |
| pypdf `extract_text(extraction_mode="layout")` | Columns line up visually | Good for showing the text a reviewer sees. It has no table model, and "pypdf will also never be able to extract text from images" ([pypdf docs](https://pypdf.readthedocs.io/en/stable/user/extract-text.html)). |
| OCR | Out of scope | pdfplumber "works best on machine-generated, rather than scanned, PDFs" and lacks strong support for OCR'd tables ([pdfplumber README](https://github.com/jsvine/pdfplumber)). Reject PDFs that have no text layer. |

**Choice:** Python with pdfplumber (MIT licence) for PDFs, and the standard library `csv` module (tab dialect) for TXT, both behind one `parse(file) -> ImportResult` interface. When a TXT and a PDF from the same run are uploaded together, the result is accepted only if their cells agree.

## Plan for realistic fictional test reports

1. **One seeded generator, three outputs.** Take one in-memory run (compounds × injections, true concentrations, slope, IS areas) and emit the TXT (tab-separated, CRLF, ASCII, the owner's column layout), the PDF (reportlab, landscape, header lines, one compound block per page) and `expected.json`. Tests assert that `parse(txt)` and `parse(pdf)` each equal `expected.json`.
2. **Realistic contents.** Use generic nitrosamines (NDMA, NDEA, NEIPA, NDIPA, NDBA, NMBA) with deuterated internal standards, a 6–8-level calibration, QC low/mid/high, diluent blanks, and unknowns named `DEMO-…`. Unknowns include non-detects (blank RT and area), values below the reporting limit (`Below RL`), a high result above the top standard, an IS drop-out, and a manually integrated peak (`M`).
3. **Layout variations.** Reorder or drop optional columns, add `Primary Flag` and `Type`, use LF instead of CRLF, add trailing whitespace, use a long `Sample Text` that wraps in the PDF, break a page mid-compound, and include multiple compounds on one PDF page.
4. **Negative fixtures.** A truncated TXT, a missing required column, an unknown compound name, a TXT and PDF from different runs (mismatch must block import), an image-only PDF (must be rejected), and a SCIEX-style file (must fail vendor detection).
5. **Privacy rule.** Fixtures use only invented names and values. The owner's real files never enter the repo; they are used only for local verification, outside the repo.

Example of a fictional TXT (tabs shown as `|`; whether a leading index column exists is still to be verified):

```
Quantify Compound Summary Report
Dataset:|C:\MassLynx\DEMO.PRO\Data\DEMO_NA_BATCH_001.qld
Time|15-Mar-26 14:02:11
Printed:|15-Mar-26 14:05:40
Compound 1:  NDMA
|Name|Sample Text|Vial|Inj. Vol|RT|Std. Conc|Height|Area|IS Area|pguL|Response|%Rec|Peak Ratio|Acq.Date|Acq.Time|BS/Conc.|S/N
1|DEMO-BLK-01|Diluent blank|1:A,1|5.0|||||199772|||||15-Mar-26|08:07:13||
2|DEMO-CAL-01|Cal std L1|1:A,2|5.0|2.41|0.500|267|1272|250239|0.495|0.0508|99.1|1.001|15-Mar-26|08:14:26|0.495|36.3
```

## Open questions for the owner

1. **Vendor confirmed as Waters TargetLynx?** Which MassLynx version? Are other instruments in the lab on another vendor's software?
2. **Can the lab add `Primary Flag` and `Type` to the export layout (`.qlt`)?** Without them, manual integrations and sample types are invisible to the LIMS.
3. **What do `pguL`, `%Rec`, `Peak Ratio` and `BS/Conc.` mean in this method?**
4. **Which PDF printer driver is used?** Does the PDF contain the same columns as the TXT, plus a calibration page?
5. **Will analysts always upload the TXT together with the PDF?** That lets the LIMS require the two to agree, and makes a PDF-only import the exception.
6. **Would the lab use *File > Export > LIMS* instead?** It would need the gated MassLynx Interfacing Guide to get the field order.
7. **Permission to read the two sample exports in a future session,** so the header-anchored PDF parser and the TXT parser can be checked against real files, locally and outside the repo.
