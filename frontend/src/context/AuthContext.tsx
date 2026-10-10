import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { useIntervalWhen } from "rooks";
import {
	getToken,
	isTwoFactorChallenge,
	loginAsUser,
	refreshToken,
	verify2FA,
	type TokenResponse,
} from "src/api/backend";
import AuthStore, { AUTH_CHANGED_EVENT, TOKEN_KEY } from "src/modules/AuthStore";

// 2FA challenge state
export interface TwoFactorChallenge {
	challengeToken: string;
}

// Context
export interface AuthContextType {
	authenticated: boolean;
	twoFactorChallenge: TwoFactorChallenge | null;
	login: (username: string, password: string) => Promise<void>;
	verifyTwoFactor: (code: string) => Promise<void>;
	cancelTwoFactor: () => void;
	loginAs: (id: number) => Promise<void>;
	logout: () => void;
	token?: string;
}

const initalValue = null;
const AuthContext = createContext<AuthContextType | null>(initalValue);

// Provider
interface Props {
	children?: ReactNode;
	tokenRefreshInterval?: number;
}
function AuthProvider({ children, tokenRefreshInterval = 5 * 60 * 1000 }: Props) {
	const queryClient = useQueryClient();
	const [authenticated, setAuthenticated] = useState(AuthStore.hasActiveToken());
	const [twoFactorChallenge, setTwoFactorChallenge] = useState<TwoFactorChallenge | null>(null);
	const [sessionExpiry, setSessionExpiry] = useState(AuthStore.expires);

	// API 401, cross-tab logout and browser focus all synchronize React auth state.
	useEffect(() => {
		const sync = () => {
			const valid = AuthStore.hasActiveToken();
			setAuthenticated(valid);
			setSessionExpiry(AuthStore.expires);
			if (!valid) {
				queryClient.clear();
				setTwoFactorChallenge(null);
				if (window.location.pathname !== "/login") {
					// Update the URL and auth state together without a hard reload. The
					// Router renders Login directly, with no intermediate error view.
					window.history.replaceState(null, "", "/login");
					window.dispatchEvent(new PopStateEvent("popstate"));
				}
			}
		};
		const onStorage = (event: StorageEvent) => {
			if (event.key === TOKEN_KEY || event.key === null) sync();
		};
		const onVisibility = () => {
			if (document.visibilityState === "visible") sync();
		};
		window.addEventListener(AUTH_CHANGED_EVENT, sync);
		window.addEventListener("storage", onStorage);
		window.addEventListener("focus", sync);
		document.addEventListener("visibilitychange", onVisibility);
		if (!AuthStore.hasActiveToken()) sync();
		return () => {
			window.removeEventListener(AUTH_CHANGED_EVENT, sync);
			window.removeEventListener("storage", onStorage);
			window.removeEventListener("focus", sync);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [queryClient]);

	// Expiry is enforced even when the page makes no further requests.
	// A successful token refresh supplies a new sessionExpiry and resets this timer.
	useEffect(() => {
		if (!authenticated) return;
		const remainingMs = (sessionExpiry ?? 0) * 1000 - Date.now();
		if (remainingMs <= 0) {
			AuthStore.clear();
			return;
		}
		const timer = window.setTimeout(() => {
			if (!AuthStore.hasActiveToken()) AuthStore.clear();
		}, remainingMs + 100);
		return () => window.clearTimeout(timer);
	}, [authenticated, sessionExpiry]);

	const handleTokenUpdate = (response: TokenResponse) => {
		AuthStore.set(response);
		setAuthenticated(true);
		setTwoFactorChallenge(null);
	};

	const login = async (identity: string, secret: string) => {
		const response = await getToken(identity, secret);
		if (isTwoFactorChallenge(response)) {
			setTwoFactorChallenge({ challengeToken: response.challengeToken });
			return;
		}
		handleTokenUpdate(response);
	};

	const verifyTwoFactor = async (code: string) => {
		if (!twoFactorChallenge) {
			throw new Error("No 2FA challenge pending");
		}
		const response = await verify2FA(twoFactorChallenge.challengeToken, code);
		handleTokenUpdate(response);
	};

	const cancelTwoFactor = () => {
		setTwoFactorChallenge(null);
	};

	const loginAs = async (id: number) => {
		const response = await loginAsUser(id);
		AuthStore.add(response);
		queryClient.clear();
		window.location.reload();
	};

	const logout = () => {
		if (AuthStore.count() >= 2) {
			AuthStore.drop();
			queryClient.clear();
			window.location.reload();
			return;
		}
		AuthStore.clear();
		setAuthenticated(false);
		queryClient.clear();
	};

	const refresh = async () => {
		if (!AuthStore.hasActiveToken()) {
			AuthStore.clear();
			return;
		}
		try {
			const response = await refreshToken();
			handleTokenUpdate(response);
		} catch {
			// 401 invalidates centrally. Transient network errors do not sign out.
			if (!AuthStore.hasActiveToken()) AuthStore.clear();
		}
	};

	useIntervalWhen(
		() => {
			if (authenticated) {
				void refresh();
			}
		},
		tokenRefreshInterval,
		true,
	);

	const value = {
		authenticated,
		twoFactorChallenge,
		login,
		verifyTwoFactor,
		cancelTwoFactor,
		loginAs,
		logout,
	};

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuthState() {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error("useAuthState must be used within a AuthProvider");
	}
	return context;
}

export { AuthProvider, useAuthState };
export default AuthContext;
