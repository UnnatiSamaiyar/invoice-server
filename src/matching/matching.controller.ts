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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { BillMatchingService } from './matching.service';

@Controller('bill-matching')
@UseGuards(AuthGuard)
export class BillMatchingController {
  constructor(private readonly billMatchingService: BillMatchingService) {}

  @Get()
  listEntries(
    @Req() request: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('matchStatus') matchStatus?: string,
    @Query('status') status?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.billMatchingService.listEntries(request.user.id, {
      search,
      matchStatus,
      status,
      includeArchived,
    });
  }

  @Get('invoices')
  searchInvoices(@Req() request: AuthenticatedRequest, @Query('search') search?: string) {
    return this.billMatchingService.searchInvoices(request.user.id, search);
  }

  @Get('party-options')
  searchPartyOptions(@Req() request: AuthenticatedRequest, @Query('search') search?: string) {
    return this.billMatchingService.searchPartyOptions(request.user.id, search);
  }

  @Get('party-invoices')
  getPartyInvoices(
    @Req() request: AuthenticatedRequest,
    @Query('clientId') clientId?: string,
    @Query('search') search?: string,
  ) {
    return this.billMatchingService.getPartyInvoices(request.user.id, { clientId, search });
  }

  @Post()
  createEntry(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.billMatchingService.createEntry(request.user.id, body as any);
  }

  @Get(':id')
  getEntry(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.billMatchingService.getEntry(request.user.id, id);
  }

  @Patch(':id')
  updateEntry(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.billMatchingService.updateEntry(request.user.id, id, body as any);
  }

  @Delete(':id')
  archiveEntry(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.billMatchingService.archiveEntry(request.user.id, id);
  }

  @Post(':id/suggest')
  refreshSuggestions(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.billMatchingService.refreshSuggestions(request.user.id, id);
  }

  @Post(':id/match')
  matchInvoice(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.billMatchingService.matchInvoice(request.user.id, id, body as any);
  }

  @Post(':id/unmatch')
  unmatchInvoice(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.billMatchingService.unmatchInvoice(request.user.id, id);
  }
}
