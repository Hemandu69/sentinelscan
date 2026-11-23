import { WebsiteDetailPage } from "../../../components/website-detail";
export const metadata = { title: "Website details · SentinelScan" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WebsiteDetailPage key={id} id={id} />;
}
