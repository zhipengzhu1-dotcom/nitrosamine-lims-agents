import { ensureTemplate } from './template.ts';

export default async function setup(): Promise<void> {
  await ensureTemplate();
}
