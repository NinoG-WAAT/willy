import type { Clock } from "../../ports/clock";
import type { FolderRepository, FolderWithCount } from "../../ports/folder-repository";
import type { InboxQuery, InboxSections } from "../../ports/note-list";

export interface InboxDeps {
  inbox: InboxQuery;
  folders: FolderRepository;
  clock: Clock;
}

export interface Inbox {
  sections: InboxSections;
  /** The owner's folders: the Inbox links to them, since published notes live there. */
  folders: FolderWithCount[];
}

/** What needs the owner: upcoming, in progress and drafts. Owner comes from the session only. */
export async function loadInbox(deps: InboxDeps, ownerId: string): Promise<Inbox> {
  const [sections, folders] = await Promise.all([
    deps.inbox.inbox(ownerId, deps.clock.now()),
    deps.folders.list(ownerId),
  ]);
  return { sections, folders };
}
