import type { ReactNode } from "react";
import { BrandHeader } from "./BrandHeader.js";

export function MessagePage({
  title,
  sub,
  foot,
}: {
  title: string;
  sub: string;
  foot?: ReactNode;
}) {
  return (
    <>
      <BrandHeader />
      <h1>{title}</h1>
      <p className="sub">{sub}</p>
      {foot !== undefined && <p className="foot">{foot}</p>}
    </>
  );
}
