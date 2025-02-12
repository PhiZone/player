import { REPO_API_LINK } from '$lib';
import type { Release } from '$lib/types';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
  const latestRelease = (await (await fetch(`${REPO_API_LINK}/releases/latest`)).json()) as Release;
  return {
    latestRelease,
  };
};
