import { ProjectView } from "@/modules/projects/ui/views/project-view";
import { getQueryClient, trpc } from "@/trpc/server";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

interface Props {
    params: Promise <{
        projectId: string;
    }>
};

const Page = async ({ params }: Props) => {
  const { projectId } = await params;

  const queryClient = await getQueryClient();
  void queryClient.prefetchQuery(trpc.messages.getMany.queryOptions({
      projectId,
  }));
  void queryClient.prefetchQuery(trpc.projects.getOne.queryOptions({
      id: projectId,
  }));
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ErrorBoundary fallback={<p>Something went wrong</p>}>
        <Suspense fallback={<div>Loading...</div>}>
            <ProjectView projectId={projectId} />
        </Suspense>
      </ErrorBoundary>
    </HydrationBoundary>
  )
}

export default Page