import { useMemo } from 'react';
import { useDbVersion } from './store';
import { listTags } from './repo';
import type { Tag } from './types';

/** Runs a query and re-runs it whenever the data changes. */
export function useQuery<T>(query: () => T, deps: readonly unknown[] = []): T {
  const version = useDbVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(query, [version, ...deps]);
}

export function useTags(): Tag[] {
  return useQuery(listTags);
}

export function useTagMap(): Map<string, Tag> {
  const tags = useTags();
  return useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
}
