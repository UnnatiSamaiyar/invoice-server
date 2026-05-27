//@ts-nocheck
import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { PaymentsService } from './payments.service';

@Controller('payments')
@UseGuards(AuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  listPayments(
    @Req() request: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('mode') mode?: string,
  ) {
    return this.paymentsService.listPayments(request.user.id, { search, mode });
  }

  @Get('invoices')
  listPayableInvoices(
    @Req() request: AuthenticatedRequest,
    @Query('search') search?: string,
  ) {
    return this.paymentsService.listPayableInvoices(request.user.id, { search });
  }

  @Post()
  createPayment(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.paymentsService.createPayment(request.user.id, body as any);
  }

  @Delete(':id')
  deletePayment(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.paymentsService.deletePayment(request.user.id, id);
  }
}
