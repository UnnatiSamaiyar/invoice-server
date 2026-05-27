import { Body, Controller, Get, Post, Query, Redirect, Req, Res, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import type { AuthenticatedRequest } from './auth.guard';
import type { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(@Body() body: unknown) {
    return this.authService.signup(body as any);
  }

  @Post('login')
  login(@Body() body: unknown) {
    return this.authService.login(body as any);
  }

  @Get('google/start')
  @Redirect()
  googleStart(@Query() query: Record<string, string | undefined>) {
    return {
      url: this.authService.getGoogleAuthUrl({
        mode: query.mode,
        companyName: query.companyName,
      }),
      statusCode: 302,
    };
  }

  @Get('google/callback')
  async googleCallback(@Query() query: Record<string, string | undefined>, @Res() response: Response) {
    try {
      const authResponse = await this.authService.handleGoogleCallback({
        code: query.code,
        state: query.state,
        error: query.error,
      });
      return response.redirect(this.authService.getFrontendGoogleCallbackUrl(authResponse));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google sign-in failed';
      return response.redirect(this.authService.getFrontendGoogleErrorUrl(message));
    }
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return this.authService.me(request.user.id);
  }
}
