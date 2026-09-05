import { generateOtp, hashOtp, verifyOtpHash } from '../../src/utils/otp';

describe('otp utils', () => {
  it('generates a 6-digit numeric OTP', () => {
    const otp = generateOtp();
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('hashes an OTP deterministically for the same phone', () => {
    const otp = '123456';
    const phone = '9876543210';
    expect(hashOtp(otp, phone)).toBe(hashOtp(otp, phone));
  });

  it('verifies a matching OTP hash', () => {
    const otp = '123456';
    const phone = '9876543210';
    const hash = hashOtp(otp, phone);
    expect(verifyOtpHash(otp, phone, hash)).toBe(true);
  });

  it('rejects a wrong OTP against a stored hash', () => {
    const phone = '9876543210';
    const hash = hashOtp('123456', phone);
    expect(verifyOtpHash('654321', phone, hash)).toBe(false);
  });

  it('rejects a hash generated for a different phone number', () => {
    const otp = '123456';
    const hash = hashOtp(otp, '9876543210');
    expect(verifyOtpHash(otp, '9999999999', hash)).toBe(false);
  });
});
