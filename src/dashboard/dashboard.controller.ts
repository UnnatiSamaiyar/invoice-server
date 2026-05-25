import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  overview(
    @Req() request: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('invoiceStatus') invoiceStatus?: string,
    @Query('billMatchStatus') billMatchStatus?: string,
  ) {
    return this.dashboardService.getOverview(request.user.id, {
      search,
      invoiceStatus,
      billMatchStatus,
    });
  }
}
