import { Controller, HttpCode, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /** Run the nightly process now, for the signed-in user's company. Useful for demos. */
  @Roles('ADMIN', 'MANAGER')
  @Post('nightly')
  @HttpCode(200)
  nightly() {
    return this.jobs.nightly();
  }

  /** Follow up this company's pending MoMo requests now. */
  @Roles('ADMIN', 'MANAGER')
  @Post('poll-momo')
  @HttpCode(200)
  poll() {
    return this.jobs.pollMomo();
  }
}
