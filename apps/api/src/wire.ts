// The wire boundary for ids and decimals: zod parses the string, and the result is the branded
// domain id or a decimal the domain reads. Nothing else casts an id.

import { z } from 'zod';
import { Sha256HexSchema, uuid } from '@lims/contract';
import { parseWritten } from '@lims/domain/decimal';
import type { CommitKey, CustomerId, LabId, PersonId, RecordId, Sha256Hex, ValueRecordId, VersionId, VersionRef } from '@lims/domain/ids';

/** A decimal exactly as `parseWritten` reads it: `010` and `00.30` are refused here, not where they would crash (usp, fix 26). */
export const DecimalSchema = z.string().refine((s) => !('error' in parseWritten(s)), 'not a decimal as written');

const branded = <B>() => uuid.transform((s) => s as unknown as B);

export const RecordIdSchema = branded<RecordId>();
export const ValueRecordIdSchema = branded<ValueRecordId>();
export const PersonIdSchema = branded<PersonId>();
export const LabIdSchema = branded<LabId>();
export const CustomerIdSchema = branded<CustomerId>();
export const VersionIdSchema = branded<VersionId>();
export const CommitKeySchema = branded<CommitKey>();
export const Sha256Schema = Sha256HexSchema.transform((s) => s as unknown as Sha256Hex);
export const VersionRefSchema = z.object({ versionId: VersionIdSchema, hash: Sha256Schema }).transform((v): VersionRef => v);
