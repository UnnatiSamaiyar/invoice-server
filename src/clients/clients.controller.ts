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
import { ClientsService } from './clients.service';

@Controller('clients')
@UseGuards(AuthGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  listClients(
    @Req() request: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.clientsService.listClients(request.user.id, {
      search,
      status,
      includeArchived,
    });
  }

  @Post()
  createClient(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.clientsService.createClient(request.user.id, body as any);
  }

  @Post(':id/activate')
  activateClient(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.clientsService.setClientStatus(request.user.id, id, 'ACTIVE');
  }

  @Post(':id/deactivate')
  deactivateClient(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.clientsService.setClientStatus(request.user.id, id, 'INACTIVE');
  }

  @Post(':id/restore')
  restoreClient(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.clientsService.setClientStatus(request.user.id, id, 'ACTIVE');
  }

  @Get(':id/ledger')
  getClientLedger(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.clientsService.getClientLedger(request.user.id, id);
  }

  @Get(':id')
  getClient(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.clientsService.getClient(request.user.id, id);
  }

  @Patch(':id')
  updateClient(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.clientsService.updateClient(request.user.id, id, body as any);
  }

  @Delete(':id')
  archiveClient(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.clientsService.archiveClient(request.user.id, id);
  }
}
