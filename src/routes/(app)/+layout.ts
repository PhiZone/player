import { REPO_API_LINK } from '$lib';
import type { Release } from '../../player/types';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ fetch }) => {
  const latestRelease = (await (await fetch(`${REPO_API_LINK}/releases/latest`)).json()) as Release;
  return {
    latestRelease,
  };
};
