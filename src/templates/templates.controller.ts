import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { InvoiceTemplatesService } from './templates.service';

@Controller('templates')
@UseGuards(AuthGuard)
export class InvoiceTemplatesController {
  constructor(private readonly templatesService: InvoiceTemplatesService) {}

  @Get('settings')
  getSettings(@Req() request: AuthenticatedRequest) {
    return this.templatesService.getSettings(request.user.id);
  }

  @Patch('settings')
  updateSettings(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.templatesService.updateSettings(request.user.id, body as any);
  }
}
