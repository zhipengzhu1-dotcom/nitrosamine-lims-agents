import { ensureTemplate } from '@lims/db/testing';

export default async function setup(): Promise<void> {
  await ensureTemplate();
}
