import { decideCapacity, DEFAULT_HIGH_DEMAND_MESSAGE, CapacitySettings } from '../../src/services/deliveryCapacity.service';

const auto = (overrides: Partial<CapacitySettings> = {}): CapacitySettings => ({
  mode: 'AUTO',
  minAvailablePartners: 1,
  radiusKm: 5,
  ...overrides,
});

describe('decideCapacity', () => {
  it('is open while at least one partner is free', () => {
    expect(decideCapacity(auto(), 1)).toMatchObject({ available: true, status: 'AVAILABLE' });
    expect(decideCapacity(auto(), 12).available).toBe(true);
  });

  it('shows high demand when every partner is busy, offline or inactive', () => {
    expect(decideCapacity(auto(), 0)).toMatchObject({
      available: false,
      status: 'HIGH_DEMAND',
      reason: 'NO_PARTNERS_AVAILABLE',
      message: DEFAULT_HIGH_DEMAND_MESSAGE,
    });
  });

  it('honours a higher minimum of free partners', () => {
    const settings = auto({ minAvailablePartners: 3 });
    expect(decideCapacity(settings, 2).available).toBe(false);
    expect(decideCapacity(settings, 3).available).toBe(true);
  });

  it('uses the admin-written message when there is one', () => {
    expect(decideCapacity(auto({ message: 'Back at 7pm' }), 0).message).toBe('Back at 7pm');
  });

  it('FORCE_OPEN ignores partner availability', () => {
    expect(decideCapacity(auto({ mode: 'FORCE_OPEN' }), 0).available).toBe(true);
  });

  it('FORCE_PAUSED stays paused even with free partners', () => {
    expect(decideCapacity(auto({ mode: 'FORCE_PAUSED' }), 20)).toMatchObject({
      available: false,
      reason: 'PAUSED_BY_ADMIN',
    });
  });
});
