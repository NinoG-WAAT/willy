const NOTICES: Readonly<Record<string, string>> = {
  folder_created: "Folder created.",
  folder_renamed: "Folder renamed.",
  folder_deleted: "Folder deleted.",
  template_created: "Template created.",
  template_saved: "Template saved.",
  template_default: "Default template updated.",
  template_deleted: "Template deleted.",
  regeneration_queued: "Regenerating this section. It will update here when it is ready.",
};

/**
 * Success messages travel as a fixed code in the query string after a redirect. Only known codes
 * map to text, so nothing from the URL is ever reflected into the page.
 */
export function noticeText(code: string | null): string | null {
  return code !== null && Object.hasOwn(NOTICES, code) ? (NOTICES[code] ?? null) : null;
}
