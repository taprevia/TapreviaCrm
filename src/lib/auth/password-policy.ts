export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const LETTER_RE = /[a-zA-Z]/;
const NUMBER_RE = /[0-9]/;

export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 8 characters and include at least one letter and one number';

/** Medium-strength password check that runs on both client and server. */
export function isPasswordCompliant(value: string): boolean {
  return (
    value.length >= PASSWORD_MIN &&
    value.length <= PASSWORD_MAX &&
    LETTER_RE.test(value) &&
    NUMBER_RE.test(value)
  );
}