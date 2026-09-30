export function assertPlatformJwtTiming(input: { iat: number; exp: number; now: Date }): void {
  if (input.exp - input.iat > 300) throw new Error("token lifetime exceeds five minutes");
  if (input.iat > Math.floor(input.now.getTime() / 1000) + 30) {
    throw new Error("issued in the future");
  }
}
