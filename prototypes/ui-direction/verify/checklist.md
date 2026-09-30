# Flow checklist for each UI direction

Drive one prototype through every item below by clicking and typing, the way an Analyst or Lab Manager would. Do not edit the prototype. Record each item as **pass**, **partial** or **fail**, with one sentence of evidence and the screenshot that shows it. Reload the page between sections so earlier failures or signatures don't carry over.

Demo credentials (from `data.js`): `praman` / `bench-demo-2026` / `314159` (Test workspace), `kwatanabe` / `bench-demo-2026` / `271828` (Today's Checks), `hkowalski` / `bench-demo-2026` / `161803` (Lab queue).

## A. Deep links (fresh load each)
1. `#queue`, `#assign`, `#test`, `#imported`, `#sign`, `#checks` and `#check-fail` each open straight into their state.

## B. Lab queue and assignment (`#queue`)
2. The count of open Tests is 327; filtering to Ready shows 28; the overdue filter shows 19.
3. Searching `T26-04176` finds that Test.
4. Opening assignment for T26-04176 lists all 20 Analysts: 13 who can be chosen and 7 who cannot, each refused one with a reason. A refused Analyst cannot be chosen.
5. Assigning it to an eligible Analyst moves it to Assigned and says the step was recorded in the audit trail without a signature.

## C. Shared PC
6. The signed-in person is visible on every screen, and moving to another persona's screen is shown as a change of user.
7. Lock hides the work; getting back in needs that person's credentials, or a switch of user.

## D. Test workspace (`#test`, then the flow)
8. Uploading the TargetLynx export leads to the imported state, showing the file name, its SHA-256, the dataset path, the parser and the PDF cross-check.
9. Draft values look different from signed results.
10. Trying to sign before the NDMA flag and the checklist are handled is prevented, with the reason shown.
11. Accepting the flag with a comment and completing the checklist makes signing available.

## E. Signature (continue from D)
12. The prompt shows who is signing, the meaning Performed with its statement, the record, the Record Version and the hash. The user ID has to be typed.
13. A wrong password shows an error and the attempts left go down. Typing `kwatanabe` as the user ID is refused.
14. The correct credentials sign. A signature block appears with printed name, username, role, meaning, UTC and lab-local time with the zone, the record version and the first 8 characters of the hash, and the Test moves to Submitted for Review.
15. After reloading, 5 wrong attempts in a row lock the account.

## F. Today's Checks (`#checks`)
16. A room reading inside its limits saves as Done with the server's time. There is no time field to type.
17. An out-of-limit storage reading (for example FRZ-01 current −60 °C) must be typed a second time, and the screen says before saving that it opens an Excursion Deviation and refuses new placements.
18. The BAL-04 verification with the `focus.checkFail` weighings shows the failing error, states what saving will do, needs the value typed again, and then signs Performed through the same kind of prompt as in E, with `kwatanabe`. Afterwards BAL-04 shows as Suspended with a Deviation.

## G. Overall
19. The browser console stays free of errors through all the flows.
20. Anything broken, misleading or confusing that a lab user would trip over.
