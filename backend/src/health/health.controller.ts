import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from '../common/guards/api-key.guard.js';

// GET /api/health: for uptime checks. Needs no API key (docs/ARCHITECTURE.md §3.13).
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ ok: boolean; db: boolean }> {
    const db = await this.prisma.isHealthy();
    // 503 so uptime checks that only look at the status code notice an outage.
    if (!db) throw new ServiceUnavailableException({ ok: false, db: false });
    return { ok: true, db };
  }
}
