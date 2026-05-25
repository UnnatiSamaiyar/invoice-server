import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { SettingsService } from './settings.service';

@Controller('settings')
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  getSettings(@Req() request: AuthenticatedRequest) {
    return this.settingsService.getSettings(request.user.id);
  }

  @Patch('profile')
  updateProfile(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.settingsService.updateProfile(request.user.id, body as any);
  }

  @Patch('company')
  updateCompany(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.settingsService.updateCompany(request.user.id, body as any);
  }

  @Patch('branding')
  updateBranding(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.settingsService.updateCompany(request.user.id, body as any);
  }

  @Patch('payment')
  updatePayment(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.settingsService.updateCompany(request.user.id, body as any);
  }

  @Patch('invoice')
  updateInvoiceSettings(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.settingsService.updateCompany(request.user.id, body as any);
  }

  @Patch('notifications')
  updateNotificationSettings(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.settingsService.updateProfile(request.user.id, body as any);
  }

  @Post('security/password')
  changePassword(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.settingsService.changePassword(request.user.id, body as any);
  }

  @Delete('assets/:assetType')
  removeAsset(@Req() request: AuthenticatedRequest, @Param('assetType') assetType: string) {
    return this.settingsService.removeAsset(request.user.id, assetType);
  }

  @Post('invoice-numbering/reset')
  resetInvoiceNumbering(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.settingsService.resetInvoiceNumbering(request.user.id, body as any);
  }
}
