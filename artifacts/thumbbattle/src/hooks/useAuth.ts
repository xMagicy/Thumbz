import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchMe,
  postGoogleAuth,
  postLogout,
  getGoogleClientId,
  waitForGoogleIdentity,
  type MeResponse,
  type User,
} from "@/lib/auth";

const ME_QUERY_KEY = ["auth", "me"] as const;

export function useUser(): {
  user: User | null;
  isLoading: boolean;
  isError: boolean;
} {
  const query = useQuery<MeResponse>({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    staleTime: 60_000,
    retry: 1,
  });
  return {
    user: query.data?.user ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postLogout,
    onSuccess: () => {
      queryClient.setQueryData<MeResponse>(ME_QUERY_KEY, { user: null });
    },
  });
}

// Mounts a real Google "Sign in with Google" button into the given container
// ref. On a successful sign-in the user query is populated and onSuccess fires
// so callers can close their dialog.
export function useGoogleSignInButton(
  containerRef: React.RefObject<HTMLDivElement>,
  options: { onSuccess?: () => void; onError?: (err: unknown) => void } = {},
): void {
  const queryClient = useQueryClient();
  // Pin the latest callbacks in a ref so the effect can stay free of them in
  // its dep list — re-rendering the dialog should not re-init Google.
  const onSuccessRef = useRef(options.onSuccess);
  const onErrorRef = useRef(options.onError);
  onSuccessRef.current = options.onSuccess;
  onErrorRef.current = options.onError;

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    const clientId = getGoogleClientId();

    void waitForGoogleIdentity().then((api) => {
      if (cancelled || !containerRef.current) return;

      api.initialize({
        client_id: clientId,
        callback: async (response) => {
          try {
            const result = await postGoogleAuth(response.credential);
            queryClient.setQueryData<MeResponse>(ME_QUERY_KEY, {
              user: result.user,
            });
            onSuccessRef.current?.();
          } catch (err) {
            onErrorRef.current?.(err);
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      // Clear any stale button before re-rendering (e.g. dialog re-open).
      containerRef.current.innerHTML = "";
      api.renderButton(containerRef.current, {
        theme: "filled_black",
        size: "large",
        type: "standard",
        shape: "pill",
        text: "continue_with",
        logo_alignment: "left",
        width: 320,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [containerRef, queryClient]);
}
