import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./copyText";

describe("NPMX code copying on HTTP-administered nodes", () => {
	const initialExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand");
	afterEach(() => {
		if (initialExecCommand) Object.defineProperty(document, "execCommand", initialExecCommand);
		else Reflect.deleteProperty(document, "execCommand");
		vi.restoreAllMocks();
	});

	it("falls back to document copy when navigator.clipboard is unavailable", async () => {
		const originalClipboard = navigator.clipboard;
		const execCommand = vi.fn(() => true);
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
		Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
		try {
			expect(await copyText("npmxr1.example")).toBe(true);
			expect(execCommand).toHaveBeenCalledWith("copy");
			expect(document.querySelectorAll("textarea[aria-hidden='true']")).toHaveLength(0);
		} finally {
			Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
		}
	});

	it("reports an automatic-copy failure so the code can be selected manually", async () => {
		const originalClipboard = navigator.clipboard;
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
		Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
		try {
			expect(await copyText("npmxr1.example")).toBe(false);
		} finally {
			Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
		}
	});

	it("prefers the native Clipboard API on secure origins", async () => {
		const originalClipboard = navigator.clipboard;
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
		try {
			expect(await copyText("npmxr1.example")).toBe(true);
			expect(writeText).toHaveBeenCalledWith("npmxr1.example");
		} finally {
			Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
		}
	});
});
