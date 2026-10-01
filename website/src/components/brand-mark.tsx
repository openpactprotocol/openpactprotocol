import { FingerprintPattern } from "lucide-react";

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <FingerprintPattern size={Math.round(size * 0.64)} strokeWidth={2} />
    </span>
  );
}
