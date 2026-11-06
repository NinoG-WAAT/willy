import { t } from "../../i18n/translate";

/**
 * Success messages travel as a fixed code in the query string after a redirect. Only known codes
 * map to text, so nothing from the URL is ever reflected into the page. A switch with one literal
 * per code, so the words are looked up for the request's language when shown.
 */
export function noticeText(code: string | null): string | null {
  switch (code) {
    case "folder_created":
      return t("Folder created.");
    case "folder_renamed":
      return t("Folder renamed.");
    case "folder_deleted":
      return t("Folder deleted.");
    case "template_created":
      return t("Template created.");
    case "template_saved":
      return t("Template saved.");
    case "template_default":
      return t("Default template updated.");
    case "template_deleted":
      return t("Template deleted.");
    case "regeneration_queued":
      return t("Regenerating this section. It will update here when it is ready.");
    default:
      return null;
  }
}
