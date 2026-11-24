import { RecordsPage } from "../../../components/records";
export const metadata = { title: "Assessment details · SentinelScan" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RecordsPage key={id} view="assessments" id={id} />;
}
