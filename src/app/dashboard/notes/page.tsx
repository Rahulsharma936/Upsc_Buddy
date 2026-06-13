import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants/routes";

/**
 * Legacy redirect: /dashboard/notes → /dashboard/knowledge.
 * Preserves any bookmarks or external links to the old Notes page.
 */
export default function NotesRedirect() {
  redirect(ROUTES.KNOWLEDGE);
}
