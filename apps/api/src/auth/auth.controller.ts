import { Body, Controller, Get, Headers, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { isIndianMobile } from '@medilink/core';
import { AllowWithout2fa, AuthUser, CurrentUser, Public } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';

const mobile = z.string().refine(isIndianMobile, 'Enter a 10-digit Indian mobile number');
const RequestOtp = z.object({ mobile });
const VerifyOtp = z.object({ mobile, code: z.string().regex(/^\d{6}$/, 'The OTP has 6 digits') });
const RegisterShop = z.object({
  registrationToken: z.string().min(10),
  ownerName: z.string().trim().min(2).max(80),
  shopName: z.string().trim().min(2).max(120),
  area: z.string().trim().min(2).max(80),
  pincode: z.string().regex(/^[1-9]\d{5}$/, 'Enter a 6-digit pincode'),
  address: z.string().trim().min(5).max(300),
  gstin: z.string().trim().toUpperCase().optional().or(z.literal('').transform(() => undefined)),
  dl20b: z.string().trim().min(4),
  dl21b: z.string().trim().min(4),
  lang: z.enum(['en', 'te', 'hi']).default('en'),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Please accept the terms to continue' }) }),
});
const SecondStep = z.object({ twoFactorToken: z.string().min(10), code: z.string().trim().min(6, 'Enter the 6-digit code').max(20) });
const EnableTwoFactor = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from the app') });
const Refresh = z.object({ refreshToken: z.string().min(20) });
const Lang = z.object({ lang: z.enum(['en', 'te', 'hi']) });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body(new ZodPipe(RequestOtp)) body: z.infer<typeof RequestOtp>) {
    return this.auth.requestOtp(body.mobile);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body(new ZodPipe(VerifyOtp)) body: z.infer<typeof VerifyOtp>, @Headers('x-device-name') device?: string) {
    return this.auth.verifyOtp(body.mobile, body.code, device);
  }

  /** Admin login, step 2: the code from the authenticator app (or a recovery code). */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('2fa/verify')
  @HttpCode(200)
  verifySecondStep(@Body(new ZodPipe(SecondStep)) body: z.infer<typeof SecondStep>, @Headers('x-device-name') device?: string) {
    return this.auth.verifySecondStep(body.twoFactorToken, body.code, device);
  }

  /** Admin: start authenticator-app setup (secret + QR code). */
  @ApiBearerAuth()
  @AllowWithout2fa()
  @Post('2fa/setup')
  @HttpCode(200)
  startSetup(@CurrentUser() user: AuthUser) {
    return this.auth.startTwoFactorSetup(user.sub);
  }

  /** Admin: confirm setup with a working code. Returns recovery codes (shown once) and a new session. */
  @ApiBearerAuth()
  @AllowWithout2fa()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('2fa/enable')
  @HttpCode(200)
  enable(@CurrentUser() user: AuthUser, @Body(new ZodPipe(EnableTwoFactor)) body: z.infer<typeof EnableTwoFactor>, @Headers('x-device-name') device?: string) {
    return this.auth.enableTwoFactor(user.sub, body.code, device);
  }

  @Public()
  @Post('register/shop')
  registerShop(@Body(new ZodPipe(RegisterShop)) body: z.infer<typeof RegisterShop>, @Headers('x-device-name') device?: string) {
    const { registrationToken, ...rest } = body;
    return this.auth.registerShop(registrationToken, rest, device);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodPipe(Refresh)) body: z.infer<typeof Refresh>, @Headers('x-device-name') device?: string) {
    return this.auth.refresh(body.refreshToken, device);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Body(new ZodPipe(Refresh)) body: z.infer<typeof Refresh>) {
    return this.auth.logout(body.refreshToken);
  }

  @ApiBearerAuth()
  @AllowWithout2fa()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.sub);
  }

  @ApiBearerAuth()
  @AllowWithout2fa()
  @Put('me/lang')
  setLang(@CurrentUser() user: AuthUser, @Body(new ZodPipe(Lang)) body: z.infer<typeof Lang>) {
    return this.auth.setLang(user.sub, body.lang);
  }
}
