import { REPO_API_LINK } from '$lib';
import type { Release } from '$lib/types';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
  const response = await fetch(`${REPO_API_LINK}/releases/latest`, {
    headers: {
      'User-Agent': 'PhiZone Player',
    },
  });
  if (!response.ok) {
    console.error(
      `Request to GitHub API failed with status code ${response.status} (${response.statusText})`,
      await response.text(),
    );
    throw new Error('Failed to contact GitHub API');
  }
  const latestRelease = (await response.json()) as Release;
  return {
    latestRelease,
  };
};
