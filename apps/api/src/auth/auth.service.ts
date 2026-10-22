import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { User } from '@prisma/client';
import { isPlausibleDrugLicence, normalizeMobile, validateGstin } from '@medilink/core';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth';
import { config } from '../config';
import { OtpSender } from './otp.sender';

const OTP_WINDOW_MIN = 10;
const OTP_MAX_PER_WINDOW = 3;
export const TERMS_VERSION = '2026-10';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: { id: string; userCode: string; name: string; role: string; status: string; lang: string; retailerId: string | null; distributorId: string | null };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly otp: OtpSender,
    private readonly audit: AuditService,
  ) {}

  private hashOtp(mobile: string, code: string) {
    return createHmac('sha256', config().JWT_ACCESS_SECRET).update(`${mobile}:${code}`).digest('hex');
  }

  async requestOtp(rawMobile: string) {
    const mobile = normalizeMobile(rawMobile);
    const since = new Date(Date.now() - OTP_WINDOW_MIN * 60_000);
    const recent = await this.prisma.otpChallenge.count({ where: { mobile, createdAt: { gte: since } } });
    if (recent >= OTP_MAX_PER_WINDOW) {
      throw new HttpException(`Too many OTP requests. Please wait ${OTP_WINDOW_MIN} minutes.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.otpChallenge.create({
      data: { mobile, codeHash: this.hashOtp(mobile, code), expiresAt: new Date(Date.now() + config().OTP_TTL_SECONDS * 1000) },
    });
    await this.otp.send(mobile, code);
    const exists = await this.prisma.user.count({ where: { mobile } });
    return { sent: true, expiresInSeconds: config().OTP_TTL_SECONDS, isNewUser: exists === 0 };
  }

  /** Checks the OTP. Existing users get tokens; new users get a short-lived registration token. */
  async verifyOtp(rawMobile: string, code: string, deviceName?: string): Promise<TokenPair | { registrationToken: string }> {
    const mobile = normalizeMobile(rawMobile);
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { mobile, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw new UnauthorizedException('This OTP has expired. Please ask for a new one.');
    if (challenge.attempts >= config().OTP_MAX_ATTEMPTS) throw new UnauthorizedException('Too many wrong tries. Please ask for a new OTP.');

    const expected = Buffer.from(challenge.codeHash, 'hex');
    const given = Buffer.from(this.hashOtp(mobile, code), 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      const who = await this.prisma.user.findUnique({ where: { mobile } });
      await this.audit.log({ actorId: who?.id ?? null, actorLabel: who?.name ?? `+91 ${mobile}`, action: 'auth.otp_wrong', entity: 'User', entityId: who?.id ?? null });
      throw new UnauthorizedException('That OTP is not correct. Please check and try again.');
    }
    await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });

    const user = await this.prisma.user.findUnique({ where: { mobile } });
    if (!user) {
      const registrationToken = this.jwt.sign({ mobile, purpose: 'register' }, { secret: config().JWT_ACCESS_SECRET, expiresIn: '30m' });
      return { registrationToken };
    }
    if (user.status === 'SUSPENDED') {
      await this.audit.log({ actorId: user.id, actorLabel: user.name, action: 'auth.login_blocked', entity: 'User', entityId: user.id });
      throw new UnauthorizedException('This account is suspended. Please call support.');
    }
    await this.audit.log({ actorId: user.id, actorLabel: user.name, action: 'auth.login', entity: 'User', entityId: user.id, after: { device: deviceName ?? 'Web' } });
    return this.issueTokens(user, deviceName);
  }

  /** Self-registration for a shop (retailer). The account can browse at once; ordering opens after KYC approval. */
  async registerShop(
    registrationToken: string,
    input: { ownerName: string; shopName: string; area: string; pincode: string; address: string; gstin?: string; dl20b: string; dl21b: string; lang: 'en' | 'te' | 'hi'; acceptTerms: true },
    deviceName?: string,
  ): Promise<TokenPair> {
    let mobile: string;
    try {
      const p = this.jwt.verify<{ mobile: string; purpose: string }>(registrationToken, { secret: config().JWT_ACCESS_SECRET });
      if (p.purpose !== 'register') throw new Error();
      mobile = p.mobile;
    } catch {
      throw new UnauthorizedException('Please verify your mobile number again');
    }
    if (input.gstin) {
      const g = validateGstin(input.gstin);
      if (!g.ok) throw new BadRequestException({ message: 'GSTIN looks wrong', issues: [{ field: 'gstin', message: `GSTIN ${g.problem} check failed` }] });
    }
    if (!isPlausibleDrugLicence(input.dl20b) || !isPlausibleDrugLicence(input.dl21b)) {
      throw new BadRequestException({ message: 'Drug licence numbers are needed', issues: [{ field: 'dl20b', message: 'Enter both 20B and 21B numbers' }] });
    }
    if (await this.prisma.user.findUnique({ where: { mobile } })) throw new ConflictException('This mobile number is already registered');

    const user = await this.prisma.$transaction(async (tx) => {
      const retailer = await tx.retailer.create({
        data: {
          name: input.shopName,
          area: input.area,
          pincode: input.pincode,
          address: input.address,
          gstin: input.gstin?.toUpperCase() || null,
          dl20b: input.dl20b,
          dl21b: input.dl21b,
          pan: input.gstin ? input.gstin.toUpperCase().slice(2, 12) : null,
        },
      });
      const n = await tx.user.count({ where: { role: { in: ['RETAILER_OWNER', 'RETAILER_STAFF'] } } });
      const created = await tx.user.create({
        data: {
          mobile,
          name: input.ownerName,
          userCode: `MLR-${String(20400 + n + 1)}`,
          role: 'RETAILER_OWNER',
          status: 'ACTIVE',
          lang: input.lang,
          retailerId: retailer.id,
          termsAcceptedAt: new Date(),
          termsVersion: TERMS_VERSION,
        },
      });
      await this.audit.log({ actorId: created.id, actorLabel: input.shopName, action: 'shop.register', entity: 'Retailer', entityId: retailer.id }, tx);
      return created;
    });
    return this.issueTokens(user, deviceName);
  }

  async refresh(refreshToken: string, deviceName?: string): Promise<TokenPair> {
    const hash = sha256(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { tokenHash: hash }, include: { user: true } });
    if (!session) throw new UnauthorizedException('Please log in again');
    if (session.revokedAt) {
      // A revoked token was used again: likely stolen. End every session for this user.
      await this.prisma.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('For your safety you have been logged out. Please log in again.');
    }
    if (session.expiresAt < new Date() || session.user.status === 'SUSPENDED') throw new UnauthorizedException('Please log in again');
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(session.user, deviceName ?? session.deviceName ?? undefined);
  }

  async logout(refreshToken: string) {
    await this.prisma.session.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { retailer: true, distributor: true },
    });
    return {
      id: user.id,
      userCode: user.userCode,
      name: user.name,
      mobile: user.mobile,
      role: user.role,
      lang: user.lang,
      retailer: user.retailer && { id: user.retailer.id, name: user.retailer.name, area: user.retailer.area, kycStatus: user.retailer.kycStatus, gstin: user.retailer.gstin },
      distributor: user.distributor && { id: user.distributor.id, name: user.distributor.name, area: user.distributor.area, code: user.distributor.code, billingSoftware: user.distributor.billingSoftware },
    };
  }

  async setLang(userId: string, lang: 'en' | 'te' | 'hi') {
    await this.prisma.user.update({ where: { id: userId }, data: { lang } });
    return { lang };
  }

  private async issueTokens(user: User, deviceName?: string): Promise<TokenPair> {
    const payload: AuthUser = { sub: user.id, role: user.role, name: user.name, retailerId: user.retailerId, distributorId: user.distributorId };
    const accessToken = this.jwt.sign(payload, { secret: config().JWT_ACCESS_SECRET, expiresIn: config().JWT_ACCESS_TTL });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        deviceName: deviceName?.slice(0, 80),
        expiresAt: new Date(Date.now() + config().JWT_REFRESH_TTL_DAYS * 86_400_000),
      },
    });
    return {
      accessToken,
      refreshToken,
      user: { id: user.id, userCode: user.userCode, name: user.name, role: user.role, status: user.status, lang: user.lang, retailerId: user.retailerId, distributorId: user.distributorId },
    };
  }
}

function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex');
}
