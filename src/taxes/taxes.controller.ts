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
import { TaxesService } from './taxes.service';

@Controller('taxes')
@UseGuards(AuthGuard)
export class TaxesController {
  constructor(private readonly taxesService: TaxesService) {}

  @Get('profiles')
  listProfiles(
    @Req() request: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.taxesService.listProfiles(request.user.id, {
      search,
      status,
      type,
      includeInactive,
    });
  }

  @Post('profiles')
  createProfile(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.taxesService.createProfile(request.user.id, body as any);
  }

  @Post('calculate')
  calculateTax(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.taxesService.calculateTax(request.user.id, body as any);
  }

  @Post('profiles/:id/activate')
  activateProfile(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.taxesService.activateProfile(request.user.id, id);
  }

  @Get('profiles/:id')
  getProfile(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.taxesService.getProfile(request.user.id, id);
  }

  @Patch('profiles/:id')
  updateProfile(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.taxesService.updateProfile(request.user.id, id, body as any);
  }

  @Delete('profiles/:id')
  deactivateProfile(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.taxesService.deactivateProfile(request.user.id, id);
  }
}
