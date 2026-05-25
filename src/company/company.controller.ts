import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { CompanyService } from './company.service';

@Controller('company')
@UseGuards(AuthGuard)
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get('me')
  getMyCompany(@Req() request: AuthenticatedRequest) {
    return this.companyService.getMyCompany(request.user.id);
  }

  @Patch('me')
  updateMyCompany(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.companyService.updateMyCompany(request.user.id, body as any);
  }
}