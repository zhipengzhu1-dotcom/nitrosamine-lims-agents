// Takes one new Test through the UI, as each role does, up to the state named on the command line:
//   node .claude/skills/verify/scripts/chain.ts [Requested|Ready|Assigned|SubmittedForReview|Reviewed|Reported]
// Screenshots each state, then saves the Test's rows and Audit Trail entries from the database.
import { expect, open } from './drive.ts';

const order = ['Requested', 'Ready', 'Assigned', 'SubmittedForReview', 'Reviewed', 'Reported'];
const until = process.argv[2] ?? 'Reported';
if (!order.includes(until)) throw new Error(`the Test states are ${order.join(', ')}, not ${until}`);
const reaches = (state: string) => order.indexOf(state) <= order.indexOf(until);

const v = await open(`chain-to-${until}`);
const { page } = v;
let sample = '';
const openTheTest = async () => {
  await page.getByRole('link', { name: sample, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(sample);
};
try {
  await v.signIn('cora.customer');
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByLabel('Method').selectOption({ index: 1 });
  await page.getByLabel('Sample description').fill('Metformin HCl 500 mg tablets, lot NW-0042 (fictional)');
  await page.getByRole('button', { name: 'Submit' }).click();
  await v.railSays('now Requested');
  sample = v.sql('sample', 'select number from lims.sample order by number desc limit 1').split('\n')[1] ?? '';
  if (!/^RD-S\d{5}$/.test(sample)) throw new Error(`the newest Sample number is ${JSON.stringify(sample)}`);
  v.note(`submitted ${sample}`);
  await v.shot('requested');
  await v.signOut();

  if (reaches('Ready')) {
    await v.signIn('samir.custodian');
    await openTheTest();
    await page.getByRole('button', { name: 'Receive' }).click();
    await v.railSays('now Ready');
    await v.shot('ready');
    await v.signOut();
  }
  if (reaches('Assigned')) {
    await v.signIn('lena.manager');
    await openTheTest();
    await page.getByRole('button', { name: 'Assign' }).click();
    await page.getByLabel('Analyst').selectOption({ label: 'Ana Ferreira' });
    await page.getByRole('button', { name: 'Assign' }).click();
    await v.railSays('now Assigned');
    await v.shot('assigned');
    await v.signOut();
  }
  if (reaches('SubmittedForReview')) {
    await v.signIn('ana.analyst');
    await openTheTest();
    await page.getByRole('button', { name: 'Enter Result' }).click();
    const result = {
      Analyte: 'NDMA',
      'Result as written': '0.0300',
      Unit: 'ppm',
      'Injection sequence': 'SEQ-2026-0042',
      'Notebook reference': 'RD-NB-0007-012',
      'Performed on': '2026-09-30',
    };
    for (const [label, value] of Object.entries(result)) await page.getByLabel(label, { exact: true }).fill(value);
    await v.sign('Performed');
    await v.railSays('now Submitted For Review');
    await v.shot('submitted-for-review');
    await v.signOut();
  }
  if (reaches('Reviewed')) {
    await v.signIn('rui.reviewer');
    await openTheTest();
    await page.getByRole('button', { name: 'Review' }).click();
    await v.sign('Reviewed');
    await v.railSays('now Reviewed');
    await v.shot('reviewed');
    await v.signOut();
  }
  if (reaches('Reported')) {
    await v.signIn('quinn.qa');
    await openTheTest();
    await page.getByRole('button', { name: 'Release' }).click();
    await v.sign('Released');
    await v.railSays('now Reported');
    await page.getByRole('link', { name: /^RD-R\d{5}$/ }).click();
    await expect(page.getByRole('heading', { name: /Test Report RD-R\d{5}/ })).toBeVisible();
    await v.shot('test-report');
    await v.signOut();
  }

  const test = `(select t.id from lims.test t join lims.sample s on s.id = t.sample_id where s.number = '${sample}')`;
  v.sql(
    'test',
    `select s.number, t.state, t.assignee_id is not null as assigned from lims.test t
    join lims.sample s on s.id = t.sample_id where s.number = '${sample}'`,
  );
  const records = `(select ${test} union select id from lims.test_report where test_id = ${test})`;
  v.sql(
    'signatures',
    `select s.meaning, v.record_table, v.version, s.signed_at from lims.signature s
    join lims.record_version v on v.lab_id = s.lab_id and v.id = s.record_version_id
    where v.record_id in ${records} order by s.signed_at`,
  );
  v.sql(
    'audit-trail',
    `select chain, seq, at, actor, role, reason, table_name, op from lims.audit_entry
    where (coalesce(new_row, old_row)->>'id')::uuid in ${records}
       or (coalesce(new_row, old_row)->>'id') = (select id::text from lims.sample where number = '${sample}')
       or (coalesce(new_row, old_row)->>'test_id')::uuid = ${test}
       or (coalesce(new_row, old_row)->>'record_id')::uuid in ${records}
       or (coalesce(new_row, old_row)->>'record_version_id')::uuid in
          (select id from lims.record_version where record_id in ${records})
    order by at, chain, seq`,
  );
  v.note(`${sample} reached ${until}`);
} finally {
  await v.close();
}
