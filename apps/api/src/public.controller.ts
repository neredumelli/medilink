import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from './common/auth';
import { SettingsService } from './common/settings.service';

/** No login needed. The apps poll this to know when maintenance is over or an update is required. */
@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get('status')
  async status() {
    const s = await this.settings.get();
    return {
      ok: !s.maintenance.on,
      maintenance: s.maintenance,
      minAppVersion: s.minAppVersion,
      serverTime: new Date().toISOString(),
    };
  }
}
