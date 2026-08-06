/**
 * Paths that are universally safe and should never trigger external-directory checks.
 * These are OS device files: read returns EOF or process streams, write discards or goes to process streams.
 */
export const SAFE_SYSTEM_PATHS: ReadonlySet<string> = new Set([
  "/dev/null",
  "/dev/stdin",
  "/dev/stdout",
  "/dev/stderr",
]);

const WINDOWS_DEVICE_NAMES: ReadonlySet<string> = new Set([
  "aux",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "con",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
  "nul",
  "prn",
]);

/**
 * Returns true when a Windows path names a reserved DOS device.
 *
 * Windows reserves these names case-insensitively, including when an
 * extension or trailing dot/space is supplied (for example, `NUL.txt`).
 * This helper is deliberately separate from {@link isSafeSystemPath}: POSIX
 * systems may contain ordinary files named `NUL`.
 */
export function isWindowsDevicePath(pathValue: string): boolean {
  if (!pathValue || pathValue.startsWith("\\\\?\\")) return false;
  const basename = pathValue.replaceAll("/", "\\").split("\\").pop() ?? "";
  const trimmed = basename.replace(/[ .]+$/g, "");
  const deviceName = trimmed.split(/[.:]/, 1)[0]?.toLowerCase() ?? "";
  return WINDOWS_DEVICE_NAMES.has(deviceName);
}

/**
 * Returns true if the given normalized path is a safe POSIX OS device file
 * that should never trigger external-directory checks.
 */
export function isSafeSystemPath(normalizedPath: string): boolean {
  return SAFE_SYSTEM_PATHS.has(normalizedPath);
}
