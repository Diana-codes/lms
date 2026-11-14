import { Controller, Get, NotFoundException } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { CompaniesService } from './companies.service';
import { currentCompanyId } from './company-context';

/** The company the request is for (from its subdomain): name and branding. */
@Controller('company')
export class CompanyController {
  constructor(private readonly companies: CompaniesService) {}

  @Public()
  @Get()
  async profile() {
    const id = currentCompanyId();
    const profile = id ? await this.companies.publicProfile(id) : null;
    if (!profile) throw new NotFoundException('Unknown company');
    return profile;
  }
}
