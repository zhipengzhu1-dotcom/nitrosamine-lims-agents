import {
  type ActorContext,
  type DocumentFacts,
  type DocumentRow,
  type DocumentStepName,
  type DocumentView,
  documentStepRole,
  documentStepRoute,
  documentSteps,
  documentTypes,
  mayAuthorDocuments,
  routes,
} from '@lims/domain';
import { type ReactNode, useMemo } from 'react';
import { api, useApi, useFresh } from './api.ts';
import { type Field, type RailAction, Shell, Status, words } from './rail.tsx';
import { Split } from './split.tsx';
import { type Column, StackTable } from './stack.tsx';
import { Signatures, unsignedNotice } from './tests.tsx';

/** `awaits` names the step a version waits on when this step leaves its status as it was. */
const documentUi: { [K in DocumentStepName]: { label: string; fields: readonly Field[]; awaits?: string } } = {
  signAuthored: { label: 'Sign Authored', fields: [] },
  signReviewed: { label: 'Sign Reviewed', fields: [], awaits: "QA's Approved" },
  signApproved: { label: 'Sign Approved', fields: [] },
  abandon: { label: 'Abandon', fields: [{ name: 'reason', label: 'Reason', kind: 'text' }] },
};

/** What the step registry decides on, read from the newest version the server sent. */
function factsOf(view: DocumentView): DocumentFacts | null {
  const [newest] = view.versions;
  if (!newest) return null;
  const signers = (meaning: string) => newest.signatures.filter((s) => s.meaning === meaning).map((s) => s.username);
  return {
    status: newest.status,
    author: newest.author.username,
    authored: signers('Authored'),
    reviewed: signers('Reviewed'),
  };
}

/** The rail's action for a step the person may take on the newest version; a signing carries its Record Version. */
function documentAction(
  me: ActorContext,
  name: DocumentStepName,
  view: DocumentView,
  onDone: () => Promise<void>,
): RailAction | null {
  const [newest] = view.versions;
  const facts = factsOf(view);
  const role = facts && documentStepRole(name, facts, { username: me.person.username, roles: me.roles });
  if (!newest || !role) return null;
  const step = documentSteps[name];
  const ui = documentUi[name];
  const what = [
    `${view.number} version ${newest.version}: ${newest.title}`,
    `Effective Date: ${newest.effectiveDate}`,
    `Author: ${newest.author.displayName} (${newest.author.username})`,
  ];
  const { recordVersion } = view;
  return {
    label: ui.label,
    context: what[0] ?? '',
    fields: ui.fields,
    signs:
      step.signs && recordVersion
        ? { meaning: step.signs, what, role, recordVersion, statement: view.statement }
        : null,
    async run(input, credentials) {
      const signature = credentials &&
        recordVersion && {
          ...credentials,
          recordVersion: { version: recordVersion.version, contentHash: recordVersion.contentHash },
          statementVersion: view.statement.version,
        };
      const answer = await api(documentStepRoute(name), {
        documentId: view.id,
        input: name === 'abandon' ? { reason: input['reason'] ?? '' } : {},
        ...(signature && { signature }),
      });
      await onDone();
      const status = answer.versions[0]?.status ?? newest.status;
      const then =
        status === newest.status && ui.awaits ? `stays ${words(status)} for ${ui.awaits}` : `is now ${words(status)}`;
      return `${step.signs ? `${step.signs} Signature` : ui.label} recorded in the Audit Trail. The version ${then}.`;
    },
  };
}

/** The rail's action on the vault: a new Document, whose first version is a Draft the person authors. */
const newDocumentAction: RailAction = {
  label: 'New Document',
  context: 'A Draft you author. The database numbers the Document.',
  fields: [
    { name: 'documentType', label: 'Type', kind: 'choice', options: documentTypes },
    { name: 'title', label: 'Title', kind: 'text' },
    { name: 'body', label: 'Content', kind: 'text' },
    { name: 'effectiveDate', label: 'Effective Date', kind: 'date' },
  ],
  signs: null,
  async run(input) {
    const documentType = documentTypes.find((t) => t === input['documentType']);
    if (!documentType) throw new Error('the Type field offers only Document types');
    const created = await api(routes.createDocument, {
      documentType,
      title: input['title'] ?? '',
      body: input['body'] ?? '',
      effectiveDate: input['effectiveDate'] ?? '',
    });
    location.hash = `#/documents/${created.id}`;
    return `${created.number} is written as a Draft.`;
  },
};

const noDocuments: DocumentRow[] = [];
const documentColumns = (open: string | null): Column<DocumentRow>[] => [
  {
    head: 'Number',
    cell: (d) => (
      <a className="tap" href={`#/documents/${d.id}`} aria-current={d.id === open ? 'true' : undefined}>
        {d.number}
      </a>
    ),
  },
  { head: 'Title', cell: (d) => d.title },
  { head: 'Type', cell: (d) => words(d.documentType) },
  { head: 'Version', cell: (d) => d.version },
  { head: 'Status', cell: (d) => <Status mark={d.status} /> },
];
const besideHeads = new Set(['Number', 'Status']);

/** One Document: its newest version with its Signatures, the versions before it, and the rail's open steps. */
function DocumentRecord({
  me,
  id,
  list,
  afterStep,
}: {
  me: ActorContext;
  id: string;
  list: ReactNode;
  afterStep: () => Promise<void>;
}) {
  const { data: view, error, reload } = useApi(routes.document, { id });
  const freshStatus = useFresh(view, (v) => v.versions.slice(0, 1).map((n) => n.status));
  const done = async () => {
    await Promise.all([reload(), afterStep()]);
  };
  // oxlint-disable-next-line react-perf/jsx-no-new-array-as-prop -- the rail is not memoized and each action is rebuilt per render, so a stable array would save nothing
  const [action = null, ...secondary] = view
    ? view.steps.flatMap((name) => documentAction(me, name, view, done) ?? [])
    : [];
  const [newest, ...earlier] = view?.versions ?? [];
  const frame = (record: ReactNode) => (
    <Shell
      me={me}
      active="documents"
      action={action}
      secondary={secondary}
      notice={newest ? unsignedNotice(newest.signatures) : undefined}
      railKey={id}
    >
      <Split list={list} record={record} closeHref="#/documents" />
    </Shell>
  );
  if (!view || !newest) return frame(error ? <p className="note--bad">{error}</p> : null);
  return frame(
    <>
      <h1 className="record-head">
        {view.number} <Status key={newest.status} mark={newest.status} fresh={freshStatus.has(newest.status)} />
        {newest.signatures.some((s) => s.unsigned) && <Status mark="Signatures unsigned" />}
      </h1>
      <dl className="facts">
        <dt>Title</dt>
        <dd>{newest.title}</dd>
        <dt>Type</dt>
        <dd>{words(view.documentType)}</dd>
        <dt>Version</dt>
        <dd>{newest.version}</dd>
        <dt>Author</dt>
        <dd>
          {newest.author.displayName} ({newest.author.username})
        </dd>
        <dt>Effective Date</dt>
        <dd>{newest.effectiveDate}</dd>
        {newest.abandonReason && (
          <>
            <dt>Abandon reason</dt>
            <dd>{newest.abandonReason}</dd>
          </>
        )}
        {view.recordVersion && (
          <>
            <dt>Record Version</dt>
            <dd>
              {view.recordVersion.version} · <code className="hash">{view.recordVersion.contentHash}</code>
            </dd>
          </>
        )}
      </dl>
      <h2>Content</h2>
      <p className="document-body">{newest.body}</p>
      <h2>Signatures</h2>
      <p className="muted">
        Authored by its author, Reviewed by a Reviewer, and Approved by QA: three different people.
      </p>
      <Signatures rows={newest.signatures} />
      {earlier.length > 0 && (
        <>
          <h2>Earlier versions</h2>
          <ul>
            {earlier.map((v) => (
              <li key={v.id}>
                Version {v.version}, {v.title} <Status mark={v.status} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>,
  );
}

/** The Lab's Document vault, each Document by its newest version, with one open beside it. */
export function DocumentsPage({ me, open }: { me: ActorContext; open: string | null }) {
  const { data: rows, error, reload } = useApi(routes.documents);
  const fresh = useFresh(rows, (r) => r.map((d) => `${d.id}:${d.status}`));
  const columns = useMemo(() => documentColumns(open).filter((c) => !open || besideHeads.has(c.head)), [open]);
  const Title = open ? 'h2' : 'h1';
  const list = (
    <>
      <Title className="worklist__head">Documents</Title>
      {error && <p className="note--bad">{error}</p>}
      <StackTable
        columns={columns}
        rows={rows ?? noDocuments}
        rowKey={(d) => d.id}
        rowClass={(d) =>
          [fresh.has(`${d.id}:${d.status}`) ? 'row--fresh' : '', d.id === open ? 'row--open' : ''].join(' ').trim() ||
          undefined
        }
      />
      {rows?.length === 0 && <p className="muted">No Documents yet.</p>}
    </>
  );
  if (open) return <DocumentRecord key={open} me={me} id={open} list={list} afterStep={reload} />;
  return (
    <Shell me={me} active="documents" action={mayAuthorDocuments(me.roles) ? newDocumentAction : null}>
      {list}
    </Shell>
  );
}
