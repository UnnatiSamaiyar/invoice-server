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
import { ItemsService } from './items.service';

@Controller('items')
@UseGuards(AuthGuard)
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  listItems(
    @Req() request: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.itemsService.listItems(request.user.id, {
      search,
      status,
      type,
      includeInactive,
    });
  }

  @Post()
  createItem(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.itemsService.createItem(request.user.id, body as any);
  }

  @Post(':id/activate')
  activateItem(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.itemsService.activateItem(request.user.id, id);
  }

  @Get(':id')
  getItem(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.itemsService.getItem(request.user.id, id);
  }

  @Patch(':id')
  updateItem(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.itemsService.updateItem(request.user.id, id, body as any);
  }

  @Delete(':id')
  deactivateItem(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.itemsService.deactivateItem(request.user.id, id);
  }
}
