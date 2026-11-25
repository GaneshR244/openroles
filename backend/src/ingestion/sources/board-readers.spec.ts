import type { HttpClient } from '../../common/http/http-client.js';
import { Ats } from '../../generated/prisma/enums.js';
import { AshbyReader } from './ashby.reader.js';
import { BoardReaders } from './board-readers.js';
import { GreenhouseReader } from './greenhouse.reader.js';
import { LeverReader } from './lever.reader.js';
import { SmartRecruitersReader } from './smartrecruiters.reader.js';
import { WorkableReader } from './workable.reader.js';

describe('BoardReaders', () => {
  it('returns the reader for every ATS', () => {
    const http = {} as HttpClient;
    const readers = new BoardReaders(
      new GreenhouseReader(http),
      new LeverReader(http),
      new AshbyReader(http),
      new SmartRecruitersReader(http),
      new WorkableReader(http),
    );

    for (const ats of Object.values(Ats)) {
      expect(readers.get(ats).ats).toBe(ats);
    }
    expect(readers.get(Ats.LEVER)).toBeInstanceOf(LeverReader);
  });
});
