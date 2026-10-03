import { randomBytes } from 'node:crypto';
import type { DB } from '@lims/db';
import type { RefusalKind, Sentence } from '@lims/domain';
import type { FastifyError, FastifyReply, FastifyRequest, FastifySchemaValidationError } from 'fastify';
import type { Kysely } from 'kysely';
import { openSystemIncident, referenceOf } from './incident.ts';

/** Every refusal kind's status, chosen here and nowhere else. */
const STATUS: { readonly [K in RefusalKind]: number } = {
  unknownField: 400,
  malformed: 400,
  badCredentials: 401,
  labNotChosen: 400,
  noSession: 401,
  sessionLocked: 423,
  role: 403,
  guard: 403,
  notFound: 404,
  state: 409,
  stale: 409,
  recordChanged: 409,
  signingRefused: 409,
  checklistIncomplete: 409,
  changePending: 409,
  realDataRefused: 409,
  keyReused: 422,
  accountLocked: 423,
  failure: 500,
};

class Refused extends Error {
  kind: RefusalKind;
  constructor(kind: RefusalKind, message: Sentence) {
    super(message);
    this.kind = kind;
  }
}

/** The one place a refusal becomes HTTP: `answerThrown` writes it as the route's 4xx body with its kind's status. */
export function refuse(kind: Exclude<RefusalKind, 'failure'>, message: Sentence): never {
  throw new Refused(kind, message);
}

function fieldPath(first: FastifySchemaValidationError): string {
  return [...first.instancePath.split('/').filter(Boolean), String(first.params.additionalProperty)].join('.');
}

/** The errors Fastify throws before a handler runs: the content-type parsers (bad JSON, media type, size) and a bad URL. */
const REFUSED_BY_FASTIFY = /^FST_ERR_(CTP_|BAD_URL)/;

function refusedByFastify(error: FastifyError): Refused | null {
  const unknownField = error.validation?.find((fault) => fault.keyword === 'additionalProperties');
  if (unknownField) return new Refused('unknownField', `The LIMS does not know the field ${fieldPath(unknownField)}.`);
  const [first] = error.validation ?? [];
  if (first)
    return new Refused(
      'malformed',
      `The LIMS cannot read this request: ${error.validationContext}${first.instancePath} ${first.message}.`,
    );
  if (REFUSED_BY_FASTIFY.test(error.code))
    return new Refused('malformed', `The LIMS cannot read this request: ${error.message}.`);
  return null;
}

/** Eight Crockford base32 characters from 40 random bits, so a reference is unlikely to repeat, even across restarts of the API. */
export function requestReference(): string {
  return referenceOf(randomBytes(8));
}

/** Every non-2xx body is written here: a refusal with its kind's status, or a failure that opens a System Incident and is answered with its reference only. */
export function answerThrown(db: Kysely<DB>) {
  return async (error: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    const refused = error instanceof Refused ? error : refusedByFastify(error);
    if (refused) return reply.code(STATUS[refused.kind]).send({ kind: refused.kind, message: refused.message });
    req.log.error({ err: error }, 'unexpected failure');
    await openSystemIncident(db, req, error);
    return reply.code(STATUS.failure).send({
      kind: 'failure',
      message: `The LIMS could not finish this request. Give the Admin the reference ${req.id}, then reload to see what was saved.`,
    });
  };
}
