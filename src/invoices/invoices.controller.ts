//@ts-nocheck
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from '../pdf/pdf.service';
import type { Response } from 'express';

@Controller('invoices')
@UseGuards(AuthGuard)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  @Get()
  listInvoices(
    @Req() request: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.invoicesService.listInvoices(request.user.id, { search, status });
  }

  @Get('next-number')
  getNextInvoiceNumber(@Req() request: AuthenticatedRequest) {
    return this.invoicesService.getNextInvoiceNumber(request.user.id);
  }

  @Post()
  createInvoice(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.invoicesService.createInvoice(request.user.id, body as any);
  }

  @Post('draft')
  saveDraft(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.invoicesService.createInvoice(request.user.id, {
      ...(body as Record<string, unknown>),
      status: 'DRAFT',
    });
  }

  @Post('finalize')
  createFinalized(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.invoicesService.createInvoice(request.user.id, {
      ...(body as Record<string, unknown>),
      status: 'FINALIZED',
    });
  }


  @Get(':id/payments')
  getPayments(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.invoicesService.getInvoicePayments(request.user.id, id);
  }

  @Post(':id/payments')
  recordPayment(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.invoicesService.recordPayment(request.user.id, id, body as any);
  }

  @Post(':id/payments/mark-paid')
  markPaid(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.invoicesService.markInvoicePaid(request.user.id, id, body as any);
  }

  @Delete(':id/payments/:paymentId')
  deletePayment(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.invoicesService.deletePayment(request.user.id, id, paymentId);
  }

  @Get(':id')
  getInvoice(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.invoicesService.getInvoice(request.user.id, id);
  }



  @Get(':id/preview')
  async previewInvoice(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('print') print?: string,
    @Res() response: Response,
  ) {
    const html = print === '1' || print === 'true'
      ? await this.invoicePdfService.getPrintableHtml(request.user.id, id)
      : await this.invoicePdfService.getPreviewHtml(request.user.id, id);

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.send(html);
  }

  @Get(':id/pdf')
  async downloadInvoicePdf(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const result = await this.invoicePdfService.generatePdf(request.user.id, id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    response.setHeader('Content-Length', result.buffer.length.toString());
    response.send(result.buffer);
  }

  @Post(':id/pdf/save')
  saveInvoicePdfCopy(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.invoicePdfService.savePdfCopy(request.user.id, id);
  }

  @Patch(':id')
  updateInvoice(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.invoicesService.updateInvoice(request.user.id, id, body as any);
  }

  @Post(':id/finalize')
  finalizeInvoice(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.invoicesService.finalizeInvoice(request.user.id, id);
  }

  @Patch(':id/status')
  updateStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.invoicesService.updateStatus(request.user.id, id, body as any);
  }

  @Delete(':id')
  cancelInvoice(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.invoicesService.updateStatus(request.user.id, id, { status: 'CANCELLED' });
  }
}
