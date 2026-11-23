import { AssessmentReport } from "../../../../components/assessment-report";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AssessmentReport key={id} id={id} />;
}
