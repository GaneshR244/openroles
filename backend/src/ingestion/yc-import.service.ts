import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { HttpClient } from '../common/http/http-client.js';
import { SchemaChangedError } from '../common/http/errors.js';
import { normalizeCompany } from './pipeline/normalize.js';
import { chunk } from './job-store.service.js';

// One-time seed: YC companies marked as hiring become Company rows (docs/ARCHITECTURE.md §3.9).

const YC_URL = 'https://yc-oss.github.io/api/companies/all.json';

const ycSchema = z.array(
  z.looseObject({
    name: z.string(),
    website: z.string().nullish(),
    isHiring: z.boolean().nullish(),
  }),
);

@Injectable()
export class YcImportService {
  private readonly logger = new Logger(YcImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpClient,
  ) {}

  async run(): Promise<{ total: number; hiring: number; created: number }> {
    const raw = await this.http.getJson<unknown>(YC_URL, { timeoutMs: 60_000 });
    const parsed = ycSchema.safeParse(raw);
    if (!parsed.success)
      throw new SchemaChangedError(YC_URL, parsed.error.issues[0]?.message ?? 'bad shape');

    const byName = new Map<string, { name: string; website: string | null }>();
    for (const c of parsed.data) {
      if (!c.isHiring || !c.name.trim()) continue;
      const key = normalizeCompany(c.name);
      if (key && !byName.has(key))
        byName.set(key, { name: c.name.trim(), website: c.website || null });
    }

    let created = 0;
    for (const part of chunk([...byName.entries()])) {
      const result = await this.prisma.company.createMany({
        data: part.map(([normalizedName, c]) => ({
          name: c.name,
          normalizedName,
          website: c.website,
          discoveredVia: 'yc',
        })),
        skipDuplicates: true,
      });
      created += result.count;
    }
    const stats = { total: parsed.data.length, hiring: byName.size, created };
    this.logger.log(
      `YC import: ${stats.total} companies · ${stats.hiring} hiring · ${stats.created} new`,
    );
    return stats;
  }
}
