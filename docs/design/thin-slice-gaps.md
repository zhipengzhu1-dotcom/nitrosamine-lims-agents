# Spec gaps found by the #24 thin slice

For the grilling ticket after [#24](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/24) closes. Each is something the spec must decide, not something the slice builds.

## From the database unit (96957a3)

1. Are sign-ins, sign-outs, failed logins and lockouts Audit Trail entries, or a separate security log? Decision 13 says the trail covers accounts but not whether sessions count.
2. Password hashes and TOTP secrets are stripped from audit rows, so a credential reset shows as an UPDATE with no visible change. Does a credential change need its own audit event?
3. The database trusts the app's actor setting and does not check that the actor has a live session. Is the API the trust boundary for "who"?
4. A transaction that writes company and Lab rows puts entries in two chains with no link or order between them, and two such transactions could deadlock on the chain locks. Should each entry record the other chains its transaction touched?
5. A superuser can recompute a whole chain so it still verifies. Only anchoring catches that, and anchoring is deferred under the demo exception.
6. The reason recorded for a workflow step is the step's name. Decision 13 asks for a reason on every entry; is a picklist needed for workflow steps?
7. With several Labs, how does a Customer's Submission pick which Lab gets each Test?
8. Is a Sample's Lab-coded number assigned at submission or at receipt? The slice assigns it at submission.
9. Nothing in the database stops one person inserting a Signature in another person's name.

Decided controls the slice does not build (hardening, not gaps): the 1-second clock-drift refusal, the TOTP encryption key, the password pepper, and the rule that an Admin holds no business role.

## From the API unit (105ea61)

10. A signing asks for the password but not the username. Part 11 §11.200(a)(1) and CONTEXT.md's "re-entering their user ID" call for it.
11. The signer never confirms the hash of the Record Version they saw; the client does not send back the hash it was shown.
12. A locked account has no unlock path, because there are no Admin screens.
13. Lab choice at login takes the first membership. Choosing among several Labs is not handled.
14. Sample and Test Report numbers come from a count plus one, so two writes at once collide on the unique key.
15. Customers see no Audit Trail, and the Result and Signatures are hidden from them until the Test is Reported. Is that the intended rule?
16. A Test's Audit Trail panel leaves out the Submission's entries, which sit on the company chain.
17. Failed sign-ins land on the company chain with role `authentication`, successful ones are not recorded, and nothing reports on either.
18. An unknown username and a wrong password answer in different times, which reveals which usernames exist.

## Decided controls the slice loosens or leaves out (owner, 2026-09-30)

- The TOTP second factor at login and at signing (decisions 7 and 13).
- The 15-character password with all four character types (decisions 7 and 22): the slice takes 4 characters.
- Lockout at 5 failures (decision 13): the slice locks at 20.
- The 15-minute idle limit (decision 7): the slice uses 8 hours.
- One password per person: the demo accounts share one, set at seed time.

## From the web unit (24504a1)

19. The worklist does not mark which Tests wait on the signed-in person.
20. There is no one-time commit key; a double press is blocked only by disabling the button.
21. The signature sheet shows the content but not the Record Version hash before signing, and gives no eligibility answer before the password is asked for.
22. The rail has no idle countdown, Lock or Switch user, though the UI direction (#23) names them.
23. Times show the browser's zone abbreviation, not the Lab's IANA zone, and the chain-verify receipt uses client time.
24. The Audit Trail panel shows raw column names and UUIDs and cuts values at 40 characters. What is the readable form of an entry?
25. The Test Report shows raw record names and has no page header, footer or numbering (already under "Report format" on the map).
26. A wrong signing password and an ended session both answer 401, so the UI asks who-am-I to tell them apart.
27. Caddy sends no security headers or CSP, and the API image carries dev dependencies.

## From the compliance pass on `main..prototype/thin-slice` (part11, iso17025 and usp experts, 2026-09-30)

Each expert returned a verdict per requirement. Gaps already on the design note's left-out list are not repeated here.

### Fixed in the slice, because it showed or recorded something wrong

- The Released signature's hash now covers every field the Test Report prints (ISO/IEC 17025 7.8.1).
- Times print in UTC, not the viewer's zone (7.8.2.1; draft Annex 11 §12.2).
- One Result per Test is a database constraint.
- The chain-verify answer gives the server's time and says the chain is not anchored off-server.
- The report's GxP Class line and the signature sheet say which controls the demo lacks.

### Questions for the map

28. Does the Analyst type each Preparation's full-precision Result and let the LIMS round the Reportable Result once (USP GN 7.20, decision 37), or type a Reportable Result already rounded? If the second, must it carry at least the limit's decimals?
29. How are below-LOQ, not-detected and negative values entered and printed? The slice accepts only a number.
30. Is the issued Test Report a stored, immutable rendition with its own hash that Released signs, or a view re-rendered from rows? Today it is a live view, and Print gives an uncontrolled copy.
31. What must the Test Report state and keep: lab address, Customer contact, condition at receipt, issue date, "results relate only to the items tested", page x of y, report status (ISO/IEC 17025 7.8.2.1, 7.8.8)? This is the map's open Report format item.
32. Should `performed_on` be bounded by the receipt date and the entry time, and which plausibility checks apply to a typed Result? Does a failure save as an Unconfirmed Value (decision 38)?
33. Is the searchable login and logout log the `session` table or Audit Trail entries, and are attempts against an unknown username logged (§11.300(d))? Merges with questions 1 and 17.
34. Must the Reviewed and Released meanings say the Audit Trail was reviewed, and must a Test's trail be searchable and include its company-chain rows (FDA data-integrity Q7 and Q8)? Merges with question 16.
35. What record turns signing on for a person (identity check and the signature-accountability acknowledgement, §11.100(b) and (c)), and does the server refuse a signing without it?
36. In which zone do records and reports show times, the Lab's configured zone or UTC, and where is the zone stored? The slice prints UTC.
37. Is "an Admin holds no business role" (decision 13) a database constraint on membership, or a rule on the grant screen?
38. Does a signature row show the signer's username and signing role as well as the printed name (§11.50(a), draft Annex 11 §13.6)?
39. Does a signing re-enter the User ID as well as the password (§11.200(a)(1)(i))? Merges with question 10.
