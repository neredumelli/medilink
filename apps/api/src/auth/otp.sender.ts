import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { config } from '../config';

/** Sends login OTPs. "console" prints the code for local development; "msg91" sends a DLT-registered SMS. */
@Injectable()
export class OtpSender {
  private readonly logger = new Logger('OTP');

  async send(mobile: string, code: string): Promise<void> {
    const cfg = config();
    if (cfg.OTP_PROVIDER === 'console') {
      this.logger.warn(`OTP for ${mobile}: ${code}  (development only)`);
      return;
    }
    if (!cfg.MSG91_AUTH_KEY || !cfg.MSG91_TEMPLATE_ID) throw new ServiceUnavailableException('SMS is not configured');
    const res = await fetch('https://control.msg91.com/api/v5/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authkey: cfg.MSG91_AUTH_KEY },
      body: JSON.stringify({ template_id: cfg.MSG91_TEMPLATE_ID, mobile: `91${mobile}`, otp: code }),
    });
    if (!res.ok) {
      this.logger.error(`MSG91 failed: ${res.status}`);
      throw new ServiceUnavailableException('Could not send the OTP right now. Please try again in a minute.');
    }
  }
}
