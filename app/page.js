"use client";
import dynamic from "next/dynamic";

const RuangWorkspace = dynamic(() => import("../components/RuangWorkspace"), { ssr: false });

export default function Page() {
  return <RuangWorkspace />;
}
