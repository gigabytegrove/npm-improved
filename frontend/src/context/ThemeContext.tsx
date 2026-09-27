import type React from "react";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

const StorageKey = "npm-improved-theme";
const LegacyStorageKey = "tabler-theme";
export const Light = "light";
export const Dark = "dark";

export type Theme = "light" | "dark";

interface ThemeContextType {
	theme: Theme;
	toggleTheme: () => void;
	setTheme: (theme: Theme) => void;
	getTheme: () => Theme;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
	children: ReactNode;
}

const getBrowserDefault = (): Theme => {
	if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
		return Dark;
	}
	return Light;
};

const getStoredTheme = (): Theme => {
	if (typeof window === "undefined") {
		return Light;
	}

	const stored = localStorage.getItem(StorageKey) as Theme | null;
	if (stored === Light || stored === Dark) {
		return stored;
	}

	const legacy = localStorage.getItem(LegacyStorageKey) as Theme | null;
	if (legacy === Light || legacy === Dark) {
		return legacy;
	}

	return getBrowserDefault();
};

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
	const [theme, setThemeState] = useState<Theme>(getStoredTheme);

	useEffect(() => {
		document.body.dataset.theme = theme;
		document.body.classList.remove(theme === Light ? Dark : Light);
		document.body.classList.add(theme);
		document.documentElement.setAttribute("data-bs-theme", theme);
		localStorage.setItem(StorageKey, theme);
		localStorage.removeItem(LegacyStorageKey);
	}, [theme]);

	const toggleTheme = () => {
		setThemeState((prev) => (prev === Light ? Dark : Light));
	};

	const setTheme = (newTheme: Theme) => {
		setThemeState(newTheme);
	};

	const getTheme = () => theme;

	return <ThemeContext.Provider value={{ theme, toggleTheme, setTheme, getTheme }}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextType {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return context;
}
