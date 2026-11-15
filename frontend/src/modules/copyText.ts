/**
 * Clipboard API requires a secure context in Chromium. NPMi is frequently
 * administered over LAN HTTP, so keep a user-gesture fallback for those nodes.
 * Returns false rather than throwing when browser policy blocks both methods.
 */
export async function copyText(text: string): Promise<boolean> {
	if (!text) return false;
	if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Continue to the document-selection fallback.
		}
	}
	if (typeof document === "undefined" || !document.body) return false;

	const field = document.createElement("textarea");
	field.value = text;
	field.setAttribute("readonly", "");
	field.setAttribute("aria-hidden", "true");
	field.style.position = "fixed";
	field.style.left = "-9999px";
	field.style.top = "0";
	field.style.opacity = "0";
	const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	document.body.appendChild(field);
	try {
		field.focus();
		field.select();
		return document.execCommand?.("copy") === true;
	} catch {
		return false;
	} finally {
		field.remove();
		previousFocus?.focus({ preventScroll: true });
	}
}
