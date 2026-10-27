import { groupMeetings, type MeetingGroups } from "../../domain/meetings/home";
import type { Clock } from "../../ports/clock";
import type { FolderRepository, FolderWithCount } from "../../ports/folder-repository";
import type { MeetingListFilter, MeetingListQuery } from "../../ports/meeting-list";

export interface HomeDeps {
  list: MeetingListQuery;
  folders: FolderRepository;
  clock: Clock;
}

export interface MeetingsHome {
  groups: MeetingGroups;
  /** The owner's folders, for the filter control. */
  folders: FolderWithCount[];
  total: number;
}

export async function loadMeetingsHome(
  deps: HomeDeps,
  ownerId: string,
  filter: MeetingListFilter,
): Promise<MeetingsHome> {
  const [items, folders] = await Promise.all([
    deps.list.list(ownerId, filter),
    deps.folders.list(ownerId),
  ]);
  return { groups: groupMeetings(items, deps.clock.now()), folders, total: items.length };
}
