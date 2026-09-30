// A small bundled breach list, lower-cased. The decided check is the Pwned Passwords range API
// at every login; this stands in for it in the skeleton (a spec gap the design records), so the
// rule and its refusal exist and the source of the list is the one thing that changes.

export const BREACHED: ReadonlySet<string> = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword1!', 'password1!', 'password123!',
  '123456', '12345678', '123456789', '1234567890', 'qwerty', 'qwerty123', 'qwertyuiop', 'abc123', 'iloveyou',
  'admin', 'admin123', 'administrator', 'welcome', 'welcome1', 'welcome123', 'letmein', 'monkey', 'dragon',
  'sunshine', 'princess', 'football', 'baseball', 'master', 'shadow', 'superman', 'michael', 'jennifer',
  'trustno1', 'changeme', 'changeme123', 'secret', 'summer2024', 'winter2025', 'laboratory', 'chemistry',
  'nitrosamine', 'nitrosamines2026!', 'lims2026', 'lims-2026-password', 'correcthorsebatterystaple',
  'thequickbrownfox', 'passwordpassword', 'letmein123!', 'welcome2026!', 'qwertyuiop123!', 'iloveyou2026!',
  'nitrosamine-lims-2026!', 'password-password-1!', 'welcome-to-the-lab-1!', 'p@ssw0rd-p@ssw0rd-1!',
]);
