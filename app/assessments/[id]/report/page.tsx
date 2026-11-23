import { AssessmentReport } from "../../../../components/assessment-report";

export const metadata = { title: "Assessment report · SentinelScan" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AssessmentReport key={id} id={id} />;
}
