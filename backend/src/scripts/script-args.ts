import { Ats } from '../generated/prisma/enums.js';

/** Reads `--name=value` flags. */
export function flag(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

/** `--source=lever` → 'LEVER'; unknown values throw so a typo never runs everything. */
export function parseSource(value: string | undefined): Ats | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  if (!(upper in Ats)) {
    throw new Error(
      `Unknown --source "${value}". Use one of: ${Object.keys(Ats).join(', ').toLowerCase()}`,
    );
  }
  return upper as Ats;
}
