# Instrument raw data stays in the instrument's data system; the LIMS holds hashed exports and a manifest

The raw data of an LC-MS/MS Run (MassLynx `.raw` folders, the `.qld` quantify file, the processing method and the calibration file) stays on the instrument PC and its archive, which remain its system of record. The LIMS keeps the exported TXT and PDF of each Import, hashed and never deleted, and a Raw-Data Manifest: the Analyst selects the Run's data folder in the browser, the browser hashes every file locally, and only names, sizes and SHA-256 hashes reach the server, recorded as the Analyst's attestation at server time, together with the archive location the raw data can be retrieved from. The server ties the manifest to the Run. Every Injection's file named in the TXT must have a `.raw` entry, and the `.qld` must match the TXT's Dataset line. The processing method and calibration file named in the PDF must be in the manifest too, since MassLynx keeps them outside the Run's data folder; a manifest without them is refused. Any other `.raw` in the folder must be accounted for with a reason, which exposes trial injections that were never imported. Each Record Version of a Run, Reprocessing included, gets its own manifest.

The LIMS takes TargetLynx's concentrations as the instrument's result and never refits a calibration. It checks the instrument's work instead:
- the processing method's hash against the one approved on the Method version;
- a reused calibration by the calibration file's hash in both Runs' manifests, not by its path;
- each standard's concentration against its cited Solution;
- the calibration statistics printed in the PDF against the Method's curve type and weighting.

We chose this because a Run's raw folders run to gigabytes (about 600 GB a year at this Lab's volume), which a ≤ ~$10/month server cannot hold, while FDA and Annex 11 still require the complete raw data to be kept, attributable and provably unaltered. The hashes let QA prove at any later date that the archive still holds what was reviewed. Source: [Decide how results are entered, imported, and reviewed](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/20), reviewed twice by the Part 11, ISO/IEC 17025 and USP expert agents.

## Considered options

- **Keep only the TXT and PDF.** Rejected: nothing would show later that the archived raw data is the data that was reviewed, and trial injections outside the export would stay invisible.
- **Upload the raw folders to object storage.** Rejected for the demo on cost and upload time. A later deployment may add it without changing the manifest, which would then be checked against the uploaded copy.
- **Refit each calibration from the exported responses.** Rejected: it duplicates validated vendor software, and the export is rounded. Checking the processing method's and the calibration file's hashes catches the same tampering.

## Consequences

- The instrument's data system must be fit to be a system of record. Its Equipment record carries QA-verified settings: named accounts, audit trail on, and no Analyst with OS or MassLynx admin rights. The server refuses Runs from an instrument without them for GMP Tests and for any Test inside the Accreditation Scope. It also refuses those Runs when the PDF's "Printed By" shows a shared account. Each person maps to one MassLynx username that is never reissued.
- The instrument PC's clock decides Fitness Status at acquisition time, whether a Reinjection's reason came first, and whether acquisition preceded upload. So the PC gets its own time-sync Check with a drift limit, and an implausible gap between acquisition and upload is flagged.
- QA re-hashes a sample of archived Runs periodically, and any mismatch opens a Data Integrity Deviation. Backups and restore tests of the MassLynx archive remain the Lab's procedure. The Record Type Register lists MassLynx raw data as raw data in electronic primary form, with its retention class and data-integrity owner.
- The export's rounding becomes a Method concern. The Method pins the minimum decimals it needs, justified so that half a unit of the exported last decimal, converted to result units at the Method's largest dilution and smallest weight, stays below a tenth of a unit in the limit's last decimal, and the parser refuses an export with fewer.
