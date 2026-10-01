# Released signs the Test Report's Record Version; the PDF is rendered once

A Released signature binds the Test Report's Record Version, the sealed content the report prints. It does not bind the PDF's bytes. Before credentials, the signer sees the PDF rendered from that content with the signature block blank. The releasing transaction renders it once more with the Released signature printed: name, username, role, meaning, time with zone, Record Version and hash. The PDF's SHA-256 is stored in an audited Test Report issue entry on the Lab chain, and that file is the issued report.

We chose this for three reasons (§11.50(b), §11.70; ISO/IEC 17025 7.8.1):

- The PDF must contain the signature, so the signature cannot bind the PDF's own bytes. It binds the content the PDF is made from.
- The person who authorises the report must see the document before releasing it, not only the rows behind it.
- The file's hash must live in the audited chain, not beside the file.

What the report prints and how it is laid out is not decided here; the map's Test Report format item holds what it must carry. Source: [Decide the spec gaps the walking skeleton found](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/45), gap 30, reviewed by the Part 11, ISO/IEC 17025 and USP expert agents.

## Considered options

- **Released signs the PDF's bytes.** Rejected: the issued PDF prints the Released signature, so its bytes do not exist until after the signing.
- **A view re-rendered from rows on demand.** What the thin slice does. Rejected: nothing fixes what was issued, and Print gives an uncontrolled copy.

## Consequences

- **The file is never re-rendered.** Every later copy is the stored file.
- **Printing from the live screen is removed.**
- **Every download is checked.** The file's SHA-256 is compared with the issue entry before it is served.
- **A rendering fault blocks release.** The releasing transaction refuses release if rendering fails or any character is unprintable.
