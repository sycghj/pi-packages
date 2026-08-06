import { describe, expect, test } from "vitest";

import {
  isSafeSystemPath,
  isWindowsDevicePath,
  SAFE_SYSTEM_PATHS,
} from "#src/safe-system-paths";

describe("SAFE_SYSTEM_PATHS", () => {
  test("contains /dev/null, /dev/stdin, /dev/stdout, /dev/stderr", () => {
    expect(SAFE_SYSTEM_PATHS.has("/dev/null")).toBe(true);
    expect(SAFE_SYSTEM_PATHS.has("/dev/stdin")).toBe(true);
    expect(SAFE_SYSTEM_PATHS.has("/dev/stdout")).toBe(true);
    expect(SAFE_SYSTEM_PATHS.has("/dev/stderr")).toBe(true);
  });
});

describe("isWindowsDevicePath", () => {
  test.each([
    "NUL",
    "nul.txt",
    "C:\\temp\\NUL",
    "C:/temp/PRN.",
  ])("%s is a Windows device path", (pathValue) => {
    expect(isWindowsDevicePath(pathValue)).toBe(true);
  });

  test.each([
    "NULL.txt",
    "C:\\temp\\NULX",
    "",
    "\\\\?\\C:\\temp\\NUL",
  ])("%s is not a Windows device path", (pathValue) => {
    expect(isWindowsDevicePath(pathValue)).toBe(false);
  });
});

describe("isSafeSystemPath", () => {
  test("returns true for /dev/null", () => {
    expect(isSafeSystemPath("/dev/null")).toBe(true);
  });

  test("returns true for /dev/stdin", () => {
    expect(isSafeSystemPath("/dev/stdin")).toBe(true);
  });

  test("returns true for /dev/stdout", () => {
    expect(isSafeSystemPath("/dev/stdout")).toBe(true);
  });

  test("returns true for /dev/stderr", () => {
    expect(isSafeSystemPath("/dev/stderr")).toBe(true);
  });

  test("returns false for an arbitrary absolute path", () => {
    expect(isSafeSystemPath("/etc/passwd")).toBe(false);
  });

  test("returns false for a path prefixed with a safe system path", () => {
    expect(isSafeSystemPath("/dev/null/subdir")).toBe(false);
  });

  test("returns false for an empty string", () => {
    expect(isSafeSystemPath("")).toBe(false);
  });

  test("returns false for a relative path", () => {
    expect(isSafeSystemPath("dev/null")).toBe(false);
  });

  test("does not treat a Windows NUL name as a POSIX safe path", () => {
    expect(isSafeSystemPath("NUL")).toBe(false);
  });
});
