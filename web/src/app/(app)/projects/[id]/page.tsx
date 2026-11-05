import { redirect } from 'next/navigation';

export default async function ProjectIndex({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/projects/${(await params).id}/tasks`);
}
