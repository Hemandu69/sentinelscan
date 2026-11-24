import { Workspace } from "../../../../components/workspace";
export const metadata = { title: "Website findings · SentinelScan" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ assessment?: string | string[] }>;
}) {
  const { id } = await params;
  const { assessment } = await searchParams;
  return (
    <Workspace
      key={id}
      id={id}
      section="findings"
      assessment={typeof assessment === "string" ? assessment : undefined}
    />
  );
}
