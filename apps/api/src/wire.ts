// The wire boundary for ids: zod parses the string, and the result is the branded domain id.
// Nothing else casts an id.

import { z } from 'zod';
import { Sha256HexSchema, uuid } from '@lims/contract';
import type { CommitKey, CustomerId, LabId, PersonId, RecordId, Sha256Hex, ValueRecordId, VersionId, VersionRef } from '@lims/domain/ids';

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
