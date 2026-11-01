import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: (n, e) => n < 2 && (e as { status?: number }).status !== 404 && (e as { status?: number }).status !== 401 },
  },
});

export const invalidateFs = () => {
  void queryClient.invalidateQueries({ queryKey: ['fs'] });
  void queryClient.invalidateQueries({ queryKey: ['stats'] });
  void queryClient.invalidateQueries({ queryKey: ['me'] });
  void queryClient.invalidateQueries({ queryKey: ['trash'] });
};
