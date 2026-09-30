# Applies one defect at a time, runs the named test file, and reports whether the tests caught it.
import subprocess, sys, pathlib
WEB = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parent.parent
MUTANTS = [
  ("CommitButton in-flight guard removed", "src/components/CommitButton.tsx", "if (inFlight.current || props.disabled === true) return;", "if (props.disabled === true) return;", "src/components/CommitButton.test.tsx"),
  ("Sign handler ignores the closing sheet", "src/components/SignaturePrompt.tsx", "if (leaving || !credentials", "if (!credentials", None),
  ("Sign button enabled while the sheet closes (both guards gone)", "src/components/SignaturePrompt.tsx", "disabled={leaving || !credentials || key.spent}", "disabled={!credentials || key.spent}", "src/components/SignaturePrompt.test.tsx"),
  ("Sheet may resend a spent key", "src/components/SignaturePrompt.tsx", "|| !eligible || !key.spend()) return;", "|| !eligible) return;", "src/components/SignaturePrompt.test.tsx"),
  ("Keypad types into the password", "src/components/CredentialFields.tsx", "onChange({ ...draft, code: applyKey(draft.code, key, CODE_LENGTH) });", "onChange({ ...draft, password: applyKey(draft.password, key) });", "src/components/SignaturePrompt.test.tsx"),
  ("Keypad types into the password (lock screen)", "src/components/CredentialFields.tsx", "onChange({ ...draft, code: applyKey(draft.code, key, CODE_LENGTH) });", "onChange({ ...draft, password: applyKey(draft.password, key) });", "src/components/LockScreen.test.tsx"),
  ("Escape ignored", "src/components/Sheet.tsx", "        escape();\n", "", "src/components/SignaturePrompt.test.tsx"),
  ("Changed-after-signature drawn as standing", "src/components/Signature.tsx", "const stands = signature.standing === 'stands';\n  return (\n    <section", "const stands = true;\n  return (\n    <section", "src/components/Signature.test.tsx"),
  ("Invalid state loses its words", "src/components/Signature.tsx", "invalid: 'SIGNATURE INVALID',", "invalid: 'Signature problem',", "src/components/Signature.test.tsx"),
  ("Unknown fitness shows the smuggled word", "src/components/FitnessTag.tsx", "look === undefined || fitness.status === 'unknown'", "fitness.status === 'unknown'", "src/components/FitnessTag.test.tsx"),
  ("Unknown fitness worded differently", "src/components/FitnessTag.tsx", "word: 'Status unknown'", "word: 'Unknown'", "src/components/FitnessTag.test.tsx"),
  ("Limit formatted from a number", "src/components/LimitText.tsx", "return `NMT ≤ ${limit.value} ${limit.unit}`;", "return `NMT ≤ ${String(+limit.value)} ${limit.unit}`;", "src/components/LimitText.test.tsx"),
  ("Limit formatted with toFixed (lint)", "src/components/LimitText.tsx", "return `NLT ≥ ${limit.value} ${limit.unit}`;", "return `NLT ≥ ${(+limit.value).toFixed(1)} ${limit.unit}`;", "src/structure.test.ts"),
  ("Zone fixed instead of derived per instant", "src/time.ts", "const local = parts(at, instant.zone, seconds);", "const local = parts(at, 'Etc/GMT+4', seconds);", "src/time.test.ts"),
  ("Gallery shipped to production", "src/main.tsx", "if (import.meta.env.DEV && window.location.pathname.startsWith('/gallery')) {", "if (window.location.pathname.startsWith('/gallery')) {", "src/bundle.test.ts"),
  ("Rough screen gains a commit", "src/screens/rough/RoughScreen.tsx", "<b>Not built in the walking skeleton.</b>", "<b>Not built in the walking skeleton.</b><input />", "src/structure.test.ts"),
  ("Blocked reason hidden", "src/components/StepBar.tsx", "<li key={r.text}>{r.text}</li>", "<li key={r.text} title={r.text} />", "src/components/StepBar.test.tsx"),
  ("Audit row loses the after-first-save word", "src/components/AuditTrailPanel.tsx", "                        Changed after first save\n", "", "src/components/AuditTrailPanel.test.tsx"),
  ("CDC accepts Other with no text", "src/components/CriticalDataChangeDialog.tsx", "(otherText.trim() === '' ? null : { kind: 'other', text: otherText.trim() })", "{ kind: 'other', text: otherText.trim() }", "src/components/CriticalDataChangeDialog.test.tsx"),
]
ok = True
held = {}
for name, file, old, new, test in MUTANTS:
    p = WEB / file; src = p.read_text()
    held.setdefault(p, src)
    if old not in src: print(f"MISSING  {name}: pattern not found"); ok = False; continue
    p.write_text(src.replace(old, new, 1))
    if test is None: continue
    try:
        r = subprocess.run(["npx", "vitest", "run", test], cwd=WEB, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    finally:
        for path, original in held.items(): path.write_text(original)
        held = {}
    caught = r.returncode != 0
    ok &= caught
    first = next((l.strip() for l in r.stdout.splitlines() if l.strip().startswith(("×", "AssertionError", "TestingLibrary"))), "")
    print(f"{'CAUGHT ' if caught else 'MISSED '} {name} [{test}] {first[:150]}")
sys.exit(0 if ok else 1)
