import { Injectable } from '@nestjs/common';
import { Ats } from '../../generated/prisma/enums.js';
import { AshbyReader } from './ashby.reader.js';
import { GreenhouseReader } from './greenhouse.reader.js';
import { LeverReader } from './lever.reader.js';
import { SmartRecruitersReader } from './smartrecruiters.reader.js';
import type { BoardReader } from './source.types.js';
import { WorkableReader } from './workable.reader.js';

/** Finds the reader for a board's ATS. */
@Injectable()
export class BoardReaders {
  private readonly byAts: Record<Ats, BoardReader>;

  constructor(
    greenhouse: GreenhouseReader,
    lever: LeverReader,
    ashby: AshbyReader,
    smartRecruiters: SmartRecruitersReader,
    workable: WorkableReader,
  ) {
    this.byAts = {
      [Ats.GREENHOUSE]: greenhouse,
      [Ats.LEVER]: lever,
      [Ats.ASHBY]: ashby,
      [Ats.SMARTRECRUITERS]: smartRecruiters,
      [Ats.WORKABLE]: workable,
    };
  }

  get(ats: Ats): BoardReader {
    return this.byAts[ats];
  }
}
