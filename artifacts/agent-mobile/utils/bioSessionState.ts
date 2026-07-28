/**
 * bioSessionState — in-memory one-shot signals shared between the sign-in
 * screen and the home layout.
 *
 * Two signals:
 *
 * 1. bypassOnce
 *    Set by the sign-in screen immediately before router.replace('/(home)')
 *    after any successful authentication (biometric, password, or MFA).
 *    Consumed by the home layout on its initial mount to skip the opening
 *    biometric lock — the user just proved their identity on the sign-in
 *    screen, so the layout must not lock again.
 *    Consumed on first read; a subsequent mount (deep link, cold restart
 *    without going through sign-in) finds it false and locks normally.
 *
 * 2. offerEnrollment
 *    Set by the sign-in screen after password/MFA success when biometric
 *    hardware is available but not yet enrolled.
 *    Consumed by the home layout, which shows the enrollment modal after
 *    its first render — at that point useAuth() has already updated and
 *    userId is the correct, authenticated value, so SecureStore writes
 *    the per-account key reliably.
 */
let _bypassOnce = false;
let _offerEnrollment = false;

export const bioSessionState = {
  /** Call immediately before router.replace('/(home)') after a successful auth. */
  setBypassOnce: () => {
    _bypassOnce = true;
  },
  /** Read and atomically clear the bypass flag. */
  consumeBypass: (): boolean => {
    const value = _bypassOnce;
    _bypassOnce = false;
    return value;
  },
  /**
   * Call after password/MFA success when hardware is available and the user
   * has not yet enrolled biometrics.  The home layout picks this up after it
   * renders with the correct userId.
   */
  setOfferEnrollment: () => {
    _offerEnrollment = true;
  },
  /** Read and atomically clear the enrollment-offer flag. */
  consumeOfferEnrollment: (): boolean => {
    const value = _offerEnrollment;
    _offerEnrollment = false;
    return value;
  },
};
